# Audio Engine — Agent 音頻生成系統開發需求

## 1. 產品目標

為可分發、可由終端用戶自行部署的 AI Agent 建立通用音頻能力模組。

需要覆蓋：

- Text-to-Speech（TTS）
- Voice Cloning（聲音克隆）
- Text-to-Music（音樂生成）
- Text-to-SFX（音效生成）
- Speech-to-Text（語音識別）
- Streaming TTS（實時語音，第二階段）
- Audio-to-Audio（音頻編輯、變體，第二階段）

設計原則：Local-first、BYOK、按量付費、低使用門檻、跨平台、模型可替換。

**不將任何一個雲端平台、模型或 API 聚合商設計成不可替換的系統依賴。**

## 2. 技術架構

建立獨立的 `AudioEngine`，與 Agent 核心推理、工具調度解耦。

內部包含：

- `AudioRouter`：根據能力、延遲、成本、隱私與用戶偏好選擇 Provider。
- `ProviderRegistry`：記錄各供應商模型、功能、價格、授權和可用狀態。
- `MonidAdapter`：Monid API。
- `FalAdapter`：fal.ai API。
- `LocalAudioAdapter`：通過本地推理服務接入開源模型。
- `VoiceRegistry`：管理聲線、參考錄音、Voice ID、授權與 Provider 映射。
- `AudioAssetStore`：本地音頻存儲、快取與元數據。
- `AudioJobManager`：非同步任務、進度、取消、重試。
- `AudioBudgetManager`：估算成本、限制付費、記錄帳單。

不要直接把 Monid 的 discover/run 暴露為 Agent 可無限制執行的工具。

## 3. Provider 接入

### A. Monid — 首選雲端聚合入口

官網：https://monid.ai/

API 文檔：https://docs.monid.ai/api/overview.html

API Key：https://app.monid.ai/access/api-keys

OAuth：https://docs.monid.ai/guide/quickstart-oauth.html

計費：https://docs.monid.ai/guide/pricing.html

Agent Skill：https://monid.ai/SKILL.md

接入流程：

1. `POST /v1/discover` 發現能力。
2. `POST /v1/inspect` 讀取模型參數、價格與輸入 Schema。
3. AudioRouter 檢查能力與預算。
4. `POST /v1/run` 執行。
5. 按需輪詢 `GET /v1/runs/:runId`。
6. 下載生成結果到本地資產庫。
7. 記錄實際費用。

初期使用用戶自帶 API Key。

OAuth 2.0 + PKCE 作為第二階段功能，需要向 Monid 申請應用憑證。

**優先驗證 ElevenLabs TTS、多角色語音、音效、音樂，以及 MiniMax Music。端點名稱必須通過 discover/inspect 確認，不要猜測或寫死。**

### B. fal.ai — 專業生成模型備選

官網：https://fal.ai/

文檔：https://docs.fal.ai/

推薦模型：

- TTS：https://fal.ai/models/fal-ai/minimax/speech-2.8-turbo
- TTS HD：https://fal.ai/models/fal-ai/minimax/speech-2.8-hd
- 聲音克隆：https://fal.ai/models/fal-ai/minimax/voice-clone
- 音樂：https://fal.ai/models/minimax/music-3
- 音效：https://fal.ai/models/fal-ai/stable-audio-3/small/sfx/text-to-audio
- 音效變體：https://fal.ai/models/fal-ai/stable-audio-3/small/sfx/audio-to-audio

實現隊列提交、結果輪詢、超時與失敗處理。

不要把 fal.ai 的計費規則寫成固定常量。

### C. Local — 可選本地模型

Qwen3-TTS：
https://github.com/QwenLM/Qwen3-TTS

ACE-Step 1.5：
https://github.com/ace-step/ACE-Step-1.5

ACE-Step 安裝文檔：
https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/zh/INSTALL.md

Stable Audio 3：
https://stability.ai/news-updates/meet-stable-audio-3-the-model-family-built-for-artistic-experimentation-with-open-weight-models

分別封裝模型服務。

MVP 不要求直接把全部模型權重打包進 Agent。先支援用戶自行安裝本地推理服務，Agent 檢測服務是否存在及能力是否可用。

本地模型的安裝、啟動、硬件需求和商用授權應獨立管理。

## 4. Agent 對外工具接口

先實現以下統一操作：

- `audio.generate_speech(text, voice_id?, language?, emotion?, provider?)`
- `audio.clone_voice(audio_file, name, consent)`
- `audio.generate_music(prompt, duration?, instrumental?, lyrics?, provider?)`
- `audio.generate_sfx(prompt, duration?, provider?)`
- `audio.transcribe(audio_file, language?)`
- `audio.list_voices()`
- `audio.list_models(capability?)`
- `audio.get_job(job_id)`
- `audio.get_usage()`

進階階段增加：

- `audio.stream_speech()`
- `audio.transform_audio()`
- `audio.generate_variation()`

接口名稱為內部設計約定，具體 Provider 參數由 Adapter 翻譯。

所有付費操作使用統一執行流程：

`Validate → Estimate → Authorize → Execute → Persist → Report`

對 Agent 返回標準化結果，包括：

- Job ID、狀態、Provider、Model ID
- 本地文件路徑、格式、時長
- Voice ID（如適用）
- 預估與實際費用
- 授權及來源元數據
- 錯誤碼與重試資訊

## 5. 音頻路由策略

用戶可以選：

**Local Only**：完全不發出雲端音頻請求。

**Auto**：本地優先；如需雲端則遵守用戶明確設定的權限與預算。

**Cloud Quality**：優先選擇符合品質要求的雲端模型。

**Manual**：指定 Provider 和 Model。

路由規則：

- 本地模式不得隱式調用雲端。
- 雲端失敗後不得自動切換到更貴的服務，除非事先授權。
- 沒有可用 Provider 時，返回可操作的配置錯誤。
- 同一能力至少允許配置兩個 Provider。
- 價格未知時禁止無確認的自動付費調用。
- 讓用戶能夠限制單次、每日及每月費用。
- 支持用戶指定預設音色與角色聲線。

## 6. 安全與資產管理

API Key 保存於操作系統憑證庫或安全的本地祕密存儲，不寫入項目文件、日誌、Prompt。

Voice Cloning 必須提供聲音使用授權確認，記錄授權狀態，不允許未經授權克隆第三人聲音。

對上傳的錄音提供明確的雲端傳輸提示、刪除入口及保存期限說明。

雲端生成文件必須下載到本地，不能依賴臨時 CDN URL 長期存在。

每個文件保存 Provider、模型版本、Prompt、Seed（如有）、生成時間、成本和授權來源。

## 7. MVP 實施次序

**P0 — 可運行骨架**

- 檢查現有項目架構與技術棧，不重建既有 Agent。
- 建立 AudioEngine、Adapter 和 ProviderRegistry。
- 完成用戶 BYOK 配置和安全存儲。
- 提供 MockProvider，先測通全部任務流程。

**P1 — 四種主要能力**

- Monid TTS。
- fal.ai MiniMax Voice Clone。
- Monid MiniMax Music。
- fal.ai Stable Audio 3 SFX。
- 非同步任務管理、音頻預覽和本地保存。
- 完成費用控制。

**P2 — 多模型與本地能力**

- Qwen3-TTS 本地接入。
- ACE-Step 音樂服務。
- Stable Audio 本地 SFX。
- STT。
- 自動路由和故障回退。

**P3 — 實時交互**

- 流式 TTS。
- 可中斷播放、音頻緩衝。
- Agent 語音對話。
- 更精細的聲音及音頻編輯。

## 8. MVP 驗收標準

1. 新用戶安裝 Agent，不需要開發者提供 API Key。
2. 用戶填入自己的 Monid 或 fal.ai Key 後，可以生成並保存語音、音樂、音效。
3. 可以上傳授權錄音，創建並重用克隆音色。
4. 用戶可以在同一工具接口下替換 Provider。
5. 開啟 Local Only 後不產生雲端調用。
6. 超出預算時停止執行，無未授權的付費重試。
7. 重啟 Agent 後任務記錄、Voice ID、資產仍存在。
8. 網絡故障、餘額不足、服務限流均有明確提示。
9. 使用 MockProvider 能在沒有付費 API 的情況下完成自動化測試。
10. 交付 README、配置樣例、Provider 接入說明和可實際運行的端到端測試。

## 9. Coding Agent 的執行要求

先檢查當前倉庫的架構、現有工具系統、配置與存儲方式。

優先復用既有技術棧，避免額外引入大型框架。

先完成 Provider 抽象和一條真實端到端調用，再擴展其他供應商。

所有 API 字段以官方實時文檔為準，不要臆造端點或請求格式。

不要把 LLM 產生的模型選擇結果直接作為付費執行指令；須經過 AudioRouter 的能力、成本與權限校驗。

每完成一個階段，運行測試並報告已實現能力、未實現能力、實測成本和剩餘風險。
