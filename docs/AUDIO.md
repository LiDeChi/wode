# 声音引擎（AudioEngine）：落地契约

> 需求原文：`docs/asset-generation.md`（用户 2026-10-11 给出）。本文件只回答「在这个仓库里怎么落」。
> 和 `docs/ASSETS.md` 的关系：**导演开单（stagecraft）→ 导演的笔（tools/assets/run.mjs）**；图片仍走 `tools/assets/providers/`，
> **声音（voice / sfx / music）一律交给 AudioEngine**，run.mjs 不再直接调任何声音服务。

## 0. 硬约束（来自需求 §1 §5 §6 §9）

1. 零依赖：只用 node ≥ 22 自带的 fetch/fs/child_process。不引框架、不引 SDK。
2. 任何一个云平台都可替换：每种能力至少能配两个 Provider；没有可用 Provider 时返回**可操作的配置错误**（告诉用户填哪个 key、改哪个设置）。
3. 付费调用一律走 `Validate → Estimate → Authorize → Execute → Persist → Report`。**价格未知禁止无确认付费**；失败后不自动换更贵的服务；Local Only 下绝不发云端请求。
4. API Key 只存 macOS 钥匙串（`security` 命令，服务名 `digital-world-audio`，账户名 = 变量名如 `MONID_API_KEY`），其次读环境变量。**不写进项目文件、日志、manifest、报错信息**。
5. 端点名不猜：Monid 的音频端点必须由 `/v1/discover` + `/v1/inspect` 找到并缓存进 ProviderRegistry；fal 的模型 id 来自需求文档列出的链接，入参以 `docs/vendor/fal/*.txt` 为准。
6. 云端结果必须下载到本地；每个文件记 Provider、模型、Prompt、Seed、时间、预估与实际费用、授权来源。
7. 不运行测试、不 build（AGENT.md）；真实付费调用只由 captain 执行。

## 1. 文件

```
tools/audio/
  engine.mjs        createAudioEngine({ home, mode, fetch, now, secrets, providers }) → 对外接口（§2）
  router.mjs        pickProvider(capability, request, registry, policy) → { provider, model, why } | ConfigError
  registry.mjs      ProviderRegistry：能力、模型、价格（来源+时间）、授权、可用状态；读/写 <home>/registry.json
  budget.mjs        AudioBudgetManager：单次/每日/每月上限，估算、授权、记账；<home>/usage.json
  jobs.mjs          AudioJobManager：job 状态机 queued→running→succeeded|failed|cancelled，重试一次，<home>/jobs.json
  voices.mjs        VoiceRegistry：声线、参考录音、Voice ID、授权、各 Provider 映射；<home>/voices.json
  store.mjs         AudioAssetStore：落盘 + 元数据（文件旁写 <file>.json）+ 按 key 查
  secrets.mjs       get(name) / set(name, value) / has(name)：钥匙串优先，环境变量其次
  errors.mjs        AudioError{ code, message, action, retryable }：code ∈ config|auth|budget|price_unknown|network|rate_limit|insufficient_balance|provider|consent|local_only
  providers/
    mock.mjs        MockProvider：全部能力，确定性产物（合成的短 wav），可设价格、可模拟失败/限流/欠费
    local.mjs       LocalAudioAdapter：macOS say（TTS）+ ffmpeg 合成（sfx/music 占位），免费；另做「检测」Qwen3-TTS / ACE-Step / Stable Audio 本地服务（配置 URL，探活即可，P2 再接生成）
    monid.mjs       MonidAdapter：discover/inspect/run/runs/wallet（docs/vendor/monid/*.txt）
    fal.mjs         FalAdapter：queue 提交 / 状态轮询 / 取结果 / 取消（docs/vendor/fal/queue.txt），模型见 §4
    elevenlabs.mjs  可选的直连 BYOK（从 tools/assets/providers/elevenlabs.mjs 搬来）
  cli.mjs           node tools/audio/cli.mjs <speech|music|sfx|clone|voices|models|job|usage|config|key> …
  README.md         配置样例、各 Provider 接入说明、模式与预算说明
tools/audio/audio.example.json   配置样例（不含 key）
```

`home` 默认 `~/.digital-world/audio`，环境变量 `DW_AUDIO_HOME` 可覆盖（测试用临时目录）。重启后 job、Voice ID、资产、用量都在。

## 2. 对外接口（需求 §4，方法名照抄）

```js
const audio = createAudioEngine({ home })
await audio.generate_speech({ text, voice_id?, language?, emotion?, provider?, rate?, out? })
await audio.clone_voice({ audio_file, name, consent })   // consent = { by, statement, at, subject:'self'|'licensed' }，缺就 code:'consent'
await audio.generate_music({ prompt, duration?, instrumental?, lyrics?, provider?, out? })
await audio.generate_sfx({ prompt, duration?, provider?, out? })
await audio.transcribe({ audio_file, language? })          // P2：先返回 code:'config'「还没有接 STT」
await audio.list_voices()
await audio.list_models(capability?)
await audio.get_job(job_id)
await audio.get_usage()
// 授权钩子：Estimate 之后、Execute 之前调用；返回 false 就停。
// createAudioEngine({ authorize: async (estimate) => boolean })；不给钩子时：价格已知且在预算内 → 放行；价格未知 → 拒绝（code:'price_unknown'）
```

每个生成返回统一结果：

```js
{ job_id, status, provider, model, file, format, seconds, voice_id?,
  cost: { estimated, actual, currency, priceSource }, license, meta: { prompt, seed?, createdAt },
  error?: { code, message, action, retryable } }
```

## 3. 路由（需求 §5）

`mode`：`local-only` | `auto`（默认）| `cloud-quality` | `manual`（必须给 provider+model）。

- `local-only`：只看 local / mock；没有就 `code:'local_only'`，`action` 写「切到 auto 并配置 MONID_API_KEY 或 FAL_KEY」。
- `auto`：本地能满足请求的质量档就用本地；否则按配置里的 Provider 顺序挑第一个「有 key、可用、价格已知且在预算内」的。
- `cloud-quality`：只挑云端，按配置的质量顺序。
- 失败回退：只能回退到**不更贵**的 Provider；更贵的要 `policy.allowEscalation === true`。
- 每次选择都返回 `why`（一句人话），进结果元数据。

预算（`config.budget`）：`perCall`、`daily`、`monthly`（美元）。超了就 `code:'budget'`，**不执行、不重试**。实际费用以 Provider 返回为准（Monid 的 run 结果带 cost；fal 价格从 registry 来，来源和时间都记上；拿不到就记 `actual:null, priceSource:'unknown'`）。

## 4. Provider 细节

**Monid**（首选云端聚合）：Base `https://api.monid.ai`，`Authorization: Bearer <key>`。
- `capabilities()`：对 `speech|music|sfx` 各 `POST /v1/discover {query}`（query 如 "elevenlabs text to speech"、"minimax music"、"sound effects generation"），再对候选 `POST /v1/inspect` 读 input schema 与价格；把选中的 `{provider, endpoint, schema, price}` 写进 registry（带时间），之后直接用。**优先验证 ElevenLabs TTS / 多角色语音 / 音效 / 音乐、MiniMax Music。**
- `run`：`POST /v1/run {provider, endpoint, input}`；200 同步出结果，202 拿 runId 轮询 `GET /v1/runs/:runId`；结果里的音频 URL 立即下载到本地。
- 402 → `insufficient_balance`；401 → `auth`；408/429 → `rate_limit|network`（可重试一次）。`GET /v1/wallet/balance` 供 `get_usage` 显示余额。

**fal.ai**（备选）：`Authorization: Key <FAL_KEY>`，队列 `POST https://queue.fal.run/<model>` → `status_url` 轮询 → `response_url` 取结果；超时可 `cancel_url`。模型：
- speech `fal-ai/minimax/speech-2.8-turbo`（质量档 `fal-ai/minimax/speech-2.8-hd`）
- clone `fal-ai/minimax/voice-clone`
- music `minimax/music-3`
- sfx `fal-ai/stable-audio-3/small/sfx/text-to-audio`
入参字段以 `docs/vendor/fal/<model>.txt` 为准。**价格不写死**：没有可靠来源就 `price_unknown`，要用户在 config 里填 `priceOverride` 或经 authorize 确认。

**Local**：`say -v <中文音色> -r <语速>` → ffmpeg 转 m4a；sfx/music 用 ffmpeg lavfi 合成，元数据标 `quality:'placeholder'`。质量档低于云端，所以 `auto` 下有云端可用时，`placeholder` 资产会被导演的笔重做。

**Mock**：给测试用，行为可编排（价格、失败、限流、欠费、延时），产物确定。

## 5. 声线（VoiceRegistry）与导演

- 导演开单里的 `spec.voice` 是档位（stagecraft 的 `voiceOf`，如 `zh-old-male`），`spec.speaker` 是人物 id。
- VoiceRegistry 映射：先查「人物 → 声线」，再查「档位 → 声线」，声线里存各 Provider 的 voice id（Monid/ElevenLabs、fal/MiniMax、local 的 say 音色）。换 Provider 不换角色的声音身份。
- 克隆：只能克隆自己或已授权的声音；consent 记进 voices.json；提供 `remove_voice(id)` 删除本地记录并提示云端删除方式。

## 6. 导演的笔怎么接

`tools/assets/run.mjs`：`kind ∈ voice|sfx|music` 的 Brief → `audio.generate_speech / generate_sfx / generate_music`，`out` 指向 `web/assets/gen/<key>.<ext>`；manifest 条目加 `job_id`、`cost`、`quality`。`--audio-mode` 透传 mode；`--confirm` 才允许价格未知或超过 `perCall` 的调用（逐条打印估算后询问，非交互时一律拒绝）。

## 7. 验收（需求 §8 对应到这里）

1. 没有任何 key：`--dry` 与 local/mock 全流程能跑通。
2. 填入 Monid 或 fal key（钥匙串）后能生成并保存语音、音乐、音效。（captain 实测）
3. 授权录音 → 克隆 → 复用 Voice ID。
4. 同一接口下 `provider:` 换 Provider。
5. Local Only 零云端请求（测试里注入 fetch 计数为 0）。
6. 超预算停止，无未授权付费重试。
7. 重启（新建 engine 同一 home）后 job / voice / 资产 / 用量都在。
8. 网络故障、欠费、限流各有明确 code + action。
9. MockProvider 下自动化测试全过（`tests/audio-engine.test.js`）。
10. README、配置样例、Provider 说明、端到端测试脚本 `tools/audio/e2e.mjs`（有 key 才跑真实一条，没 key 打印怎么配）。
