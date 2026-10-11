# chasmlol/chasm 复用审查

审查人：qa2｜审查日期：2026-10-11｜审查时 commit：`d740b9742869e436576d93180f7b5886afdfa9db`
克隆：`git clone --depth 50 https://github.com/chasmlol/chasm /tmp/oss-audit/chasmlol__chasm`（8.5MB）

## 1. 一句话

它是 Rust 写的**本地优先 agentic NPC 后端**：自建 HTTP API（`127.0.0.1:7341`）+ 游戏 mod 桥，把 LLM / STT / TTS / 音乐 / 检索都当成**随游戏起停的本地托管服务**来编排（llama.cpp 5001、TTS 5002、Parakeet STT 5003、ACE-Step 音乐 5004），同时支持把这些换成云端 API。
音频这块是**真材实料**：三套本地 Python 服务（PocketTTS / faster-qwen3-tts / Parakeet TDT）+ 本地音乐生成（ACE-Step DiT）+ 三家云 TTS/克隆 + 四家云 STT + 词表增强。
**授权是 AGPL-3.0**（`Cargo.toml:16` 与 `README.md:184` 均声明，但仓库里没有任何 LICENSE 文件，所以 GitHub 识别为 None）——**不能直接依赖或 Fork 进我们的闭环产品，只能参考思路**；若按「没有 LICENSE 文件＝未授权」的保守解读，则应视为默认保留所有权利。

## 2. 审查快照

| 项 | 值 |
|---|---|
| commit | `d740b9742869e436576d93180f7b5886afdfa9db`（2026-07-10「raw-chat: persist to a live-chat」） |
| 提交数 | 48（GitHub API `/commits` 一页 100 内共 48） |
| 贡献者 | 1 人：chasmlol（48 次，无他人、无 bot 合入） |
| stars / forks | 56 / 9 |
| issue / PR | open issues 1，是一个人类 PR（#1「Reject invalid meridiem hours in scheduler clock p…」），无 issue 讨论 |
| 创建 / 最后推送 | 2026-06-25 / 2026-07-10（**距今约 3 个月无提交**） |
| 最近 10 次提交日期 | 07-10、07-10、07-10、07-10、07-09、07-09、07-09、07-09、07-09、07-08 |
| CI | 有但只做打包：`.github/workflows/nightly.yml` —— `windows-latest` 上 `npm ci && npm run build`（前端）+ `tauri build` + 发 nightly release；**不跑 `cargo test`** |
| 语言 / 规模 | Rust 96 个 `.rs`，1 个 workspace：`crates/{chasm-core,chasm-embed,chasm-prompt,chasm-web,chasm-fnv-bridge,chasm-st-compat}` + `apps/{chasm,chasm-desktop}` |

## 3. 架构（≤15 行）

- `apps/chasm`：二进制入口（tokio + tracing；`apps/chasm/Cargo.toml` 的 `default = ["cuda"]`，GPU 检索默认开）。
- `crates/chasm-core`：设置与常量（`crates/chasm-core/src/lib.rs:26` `DEFAULT_BIND_ADDR = "127.0.0.1:7341"`、`:38` LLM 5001、`:44` TTS 5002、`:50-51` Parakeet STT 5003、`:57` ACE-Step 音乐 5004），profile 导入、设置持久化。
- `crates/chasm-web`：axum HTTP 层（74 条路由：`/api/game/v1/turn`、`/generate`、`/journals`、`/engines/:id/install`、`/connection/status`…）+ Askama 模板 + `ui/`（React/TS，Vite 打包）。
- `crates/chasm-fnv-bridge`：与游戏 mod 的桥——可以是 HTTP（`api/headless/v1`），也可以在同进程内直调以免 localhost 绕行（`crates/chasm-web/src/fnv_bridge.rs:4,134`）；**语音输入走文件侧车**：游戏把按住说话的录音写成 `*.stt.wav`，桥等文件写完（size/mtime settle + Windows 文件锁重试）后识别（`crates/chasm-fnv-bridge/src/stt.rs:1-11,53,121`）。
- `crates/chasm-prompt` / `chasm-st-compat` / `chasm-embed`：提示词构造、SillyTavern 兼容、检索嵌入（fastembed + `ort`）。
- 本地服务编排：`crates/chasm-web/src/launcher.rs`（拼 RuntimeSpec 并 spawn）+ `stack_lifecycle.rs`（2s 轮询、边沿触发、10s 停止宽限）。
- 数据流（一轮对话）：游戏 mod → 桥/HTTP → `llm_api`/`llm.rs` → llama.cpp（或云 LLM）→ 回复 → `tts_api` → 本地/云 TTS → WAV/PCM 回游戏；语音输入反向经 `stt_api`；「唱首歌」走 `music.rs` → ACE-Step。

## 4. 真实已实现功能表

| 功能 | 证据 | 状态 |
|---|---|---|
| 云 TTS 三家：ElevenLabs / Inworld / Cartesia | `crates/chasm-web/src/tts_api.rs:35` `pub async fn synthesize(...)`、`:57` `elevenlabs_url`、`:66` `build_elevenlabs_body`、`:70` `synthesize_elevenlabs`、`:106` `build_inworld_body`、`:115` `synthesize_inworld`、`:152` `build_cartesia_body`、`:165` `synthesize_cartesia` | 源码完整未运行（**需 key，未验证**；有单测见 §6） |
| 云声音克隆（三家 provider，含 multipart 上传样本） | 同文件 `:201` `clone_voice`、`:219` `wav_part`、`:228` `clone_elevenlabs`、`:254` `clone_cartesia`、`:282` `build_inworld_clone_body`、`:292` `clone_inworld`、`:320` `parse_clone_voice_id` | 源码完整未运行（需 key） |
| 本地 TTS：faster-qwen3-tts（流式，OpenAI 兼容 `/v1/audio/speech`） | `scripts/qwen3_tts_server.py:269` 默认模型 `Qwen/Qwen3-TTS-12Hz-1.7B-Base`、`:272` `--voices-dir`、`:280` `--device` 默认 `cuda`、`:317-318` `FasterQwen3TTS.from_pretrained(...)`；编排见 `launcher.rs:286` `build_qwen3_spec`（用 `engines/faster-qwen3-tts/.venv/Scripts/python.exe`） | 源码完整未运行（引擎未装、权重未下） |
| 本地 TTS：PocketTTS（24kHz Mimi，逐角色缓存声线状态） | `scripts/pockettts_server.py:11` `/v1/audio/speech`、`:50` `SAMPLE_RATE = 24000`、`:317` `from pocket_tts import TTSModel`；`launcher.rs:326` `build_pockettts_spec` | 源码完整未运行（需权重，见 §7） |
| **本地零样本声音克隆**（参考音频 + 参考文本 / xvec_only） | `scripts/qwen3_tts_server.py:300-312`（voices 配置里 `{ref_audio, ref_text, language, xvec_only}`，无 ref_text 时 `xvec_only=True`）、`:269` Base 模型 | 源码完整未运行 |
| 本地 STT：Parakeet TDT 0.6B v3（独立进程/端口 5003） | `scripts/parakeet_stt_server.py:244` `nvidia/parakeet-tdt-0.6b-v3`、`:250` `from nano_parakeet import from_pretrained`、`:255` `asr_model = from_pretrained(args.model, device=device)`；`launcher.rs:397` `parakeet_addr`、`:412` `build_parakeet_spec`、`:451` `kill_parakeet_servers` | 源码完整未运行 |
| 云 STT 四路（OpenAI 兼容 / OpenRouter / Deepgram / AssemblyAI 轮询） | `crates/chasm-web/src/stt_api.rs:32` `transcribe`、`:63` `transcribe_openai_compat`、`:111` `parse_openai_transcript`、`:124` `build_openrouter_stt_body`、`:136` `transcribe_openrouter`、`:168` `transcribe_deepgram`、`:223` `transcribe_assemblyai`、`:306` `enum AssemblyPoll` | 源码完整未运行（需 key） |
| STT 词表增强（把游戏专名喂给解码，含模糊匹配） | `crates/chasm-web/src/stt_vocab.rs`、`scripts/stt_vocab_boost.py`（**纯标准库** `re`/`typing`）；测试 `scripts/test_stt_vocab_boost.py` | **已验证运行**：`python3 test_stt_vocab_boost.py` → `ALL TESTS PASSED`（exit 0） |
| 本地音乐生成（ACE-Step DiT，歌词+风格标签→WAV） | `crates/chasm-web/src/music.rs:182` `generate_song_lyrics`、`:273` `acestep_endpoint()`、`:281` `request_acestep_wav`（超时 600s）、`:504` `spawn_song_job`、`:539` `run_song_job`；歌词由 LLM 写（`:48` `song_system_prompt`）、用 NPC 自己的声音做音色参考（`:257` `npc_voice_reference`） | 源码完整未运行（需 ACE-Step 权重/引擎） |
| ACE-Step 服务端：懒加载 + 空闲释放 VRAM | `scripts/acestep_music_server.py:1-25`（DiT-only，`thinking=False`、`llm_handler=None` 绕开 5Hz LM/vllm）、`/health` 暴露 `model_loaded`/`generating` | 源码完整未运行 |
| 语音输入：游戏侧车 WAV 的等待/稳定/识别 | `crates/chasm-fnv-bridge/src/stt.rs:29` `is_native_voice_request`、`:46` `has_audio_sidecar`、`:53` `recognize_native_speech`、`:121` `wait_for_native_speech_audio`、`:197` `recognize_wav_file`、`:268` `retry_file` | 源码完整未运行（有单测通过） |
| 本地引擎随游戏起停（只在连接/断开边沿动作，不重复 spawn、不忙等） | `crates/chasm-web/src/stack_lifecycle.rs:35` `POLL_INTERVAL = 2s`、`:40` `STOP_GRACE_SECS = 10.0`、`:46` `enum Phase`、`:70` `struct StackLifecycle`、`:109` `try_begin_warmup`、`:226` `spawn_lifecycle` | 源码完整未运行（有单测） |
| 「引擎没装就报未安装，而不是起一个坏进程」 | `launcher.rs:260` `tts_spec_for_engine`（`""`/未知引擎 → `None`，从不回退默认）、`:286`/`:326`（venv/python 或脚本缺失 → `None`） | 源码完整未运行 |
| 停服务 = 按端口杀进程（**Windows 专用**） | `crates/chasm-web/src/lib.rs:695` `kill_process_on_port`（`netstat -ano -p tcp` 找 LISTENING 行的 PID → `taskkill /F /PID`） | 源码完整未运行（本机 macOS 无法执行） |
| MCP | 全仓 `grep -rniE "\bmcp\b|modelcontextprotocol"` → **零命中** | **未实现**（对外只有自建 HTTP API + mod 桥） |

## 5. MCP

- **完全没有**：仓库里没有任何 MCP server、也没有 MCP client（`*.rs`/`*.toml`/`*.ts`/`*.py`/`*.md` 全量 grep 无命中）。它对外只提供自建 HTTP headless API（`chasm-fnv-bridge/src/config.rs:32` `DEFAULT_API_BASE = "http://127.0.0.1:8000/api/headless/v1"`，另有一个 74 条路由的 axum 管理/游戏 API）以及游戏 mod 桥。
- 因此 **Claude Code / Codex / Cursor 不能直接接**。要接就得我们另写一层 MCP server（把它的 HTTP 端点包成工具）；但它的 HTTP 契约本身是清晰的 REST/JSON，包壳成本不高——只是 AGPL 决定了壳里不能包含它的代码，只能当外部进程调用（且需评估 AGPL 网络条款）。

## 6. 测试

- 规模：`grep -rn "#\[test\]\|#\[tokio::test\]" --include='*.rs'` 共 **502 处**，分布在 59 个文件；按包计 `#[test]`：`crates/chasm-web` 269、`crates/chasm-core` 84、`crates/chasm-prompt` 61、`crates/chasm-fnv-bridge` 44、`crates/chasm-st-compat` 27、`crates/chasm-embed` 8。Python 侧另有 `scripts/test_stt_vocab_boost.py`、`scripts/test_parakeet_server_integration.py`。
- 我实际跑了的（本机 rustc/cargo 1.97.1；**未跑** chasm-web 与 chasm-prompt，前者要编译 axum/sqlx 全家桶，后者依赖 `chasm-embed` → fastembed/ort 可能拉模型）：

| 命令 | 结果 |
|---|---|
| `cargo test -p chasm-core` | **84 passed; 0 failed** |
| `cargo test -p chasm-fnv-bridge -p chasm-st-compat` | **44 + 27 passed; 0 failed** |
| `python3 scripts/test_stt_vocab_boost.py`（纯标准库） | `ALL TESTS PASSED`，exit 0 |

- 合计 **155 个 Rust 用例 + 1 个 Python 测试全绿**；测试质量不错（TTS/STT 的 body 构造、WAV 头、解析分支、`kill_process_on_port`、热重载、调度时钟边界都有覆盖）。
- 注意：CI **不跑测试**，测试只能靠本地跑——上游不会发现回归。

## 7. 依赖与授权

**源码授权（重点，按规则逐处核实）**

- 仓库根**没有任何** `LICENSE` / `COPYING` 文件（`find . -path ./.git -prune -o -iname '*licen*' -print` 为空），这就是 GitHub API `license: None` 的原因。
- 但 `Cargo.toml:16` 在 `[workspace.package]` 里写了 `license = "AGPL-3.0"`；8 个子 crate/app 的 `Cargo.toml:5` 全部 `license.workspace = true` 继承（`crates/{chasm-core,chasm-embed,chasm-prompt,chasm-web,chasm-fnv-bridge,chasm-st-compat}/Cargo.toml`、`apps/{chasm,chasm-desktop}/Cargo.toml`）。
- `README.md:184` 也写明「AGPL-3.0 (see `Cargo.toml`)」；所有 `.rs` 文件**没有**额外的 SPDX 头或许可声明。
- 结论：**授权按 AGPL-3.0 处理**。AGPL 的第 13 条（网络使用即需向用户提供源码）会传染到我们任何「集成了它的代码并对外提供服务」的形态；**不能直接依赖、不能 Fork、只能参考思路**。若有人坚持「缺 LICENSE 文件＝未授权」，结论只会更严：**默认保留所有权利，同样不能依赖或 Fork**。另外 `README.md:184` 明确游戏数据/角色卡/提取的语音不在此许可范围内（本来也不在仓库里）。

**运行时依赖许可证**（按 `Cargo.lock` 实际版本查 crates.io）：全部为宽松许可，未见 AGPL/GPL：

| crate | 版本 | 许可证 |
|---|---|---|
| axum | 0.7.9 | MIT |
| tokio | 1.52.3 | MIT |
| reqwest | 0.13.4 | MIT OR Apache-2.0 |
| askama | 0.12.1 | MIT OR Apache-2.0 |
| fastembed | 5.17.2 | Apache-2.0 |
| ort | 2.0.0-rc.12 | MIT OR Apache-2.0 |
| notify | 6.1.1 | CC0-1.0 |
| serde / serde_json / base64 / thiserror / regex / anyhow / sha2 / rand / futures-util / async-trait / semver / tower-http / tracing(-subscriber) / mime_guess / urlencoding / async-stream | 见 `Cargo.lock` | MIT 或 MIT OR Apache-2.0 |
| sqlx | workspace 声明 0.8（MIT/Apache-2.0） | **未核验**：`Cargo.lock` 里未找到直接条目（可能被 feature 排除），我只核了实际出现在 lock 里的 crate |

**模型权重许可证**（HF API `cardData.license` / `gated`，只做只读查询，未接受任何条款、未下载）：

| 权重 | 用途 | 许可证 | gated | 商用 |
|---|---|---|---|---|
| `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | 本地 TTS + 零样本克隆（脚本默认模型） | apache-2.0 | 否 | 可（无附加限制字段） |
| `nvidia/parakeet-tdt-0.6b-v3` | 本地 STT（`.nemo`） | cc-by-4.0 | 否 | 可（需署名） |
| `kyutai/pocket-tts` | PocketTTS 引擎（`install-engine.ps1:214` 首次加载时下载） | cc-by-4.0 | **是（`gated: "auto"`）** | 可（需署名）；**gated 需登录接受条款，按规则我们不接受** |
| ACE-Step 权重 | 本地音乐生成 | — | — | **未识别**：脚本从 `https://github.com/ace-step/ACE-Step-1.5.git`（GitHub API: MIT，13.4k★）clone 后用其自带 `acestep.model_downloader.download_main_model` 拉取（`install-engine.ps1:172,234,244`），HF 仓库名未能识别 |
| `unsloth/gemma-4-E2B-it-GGUF`（Q4_K_XL） | 默认本地 LLM（`scripts/download-llm.ps1:11`） | — | — | 与音频无关，未核 |

**体积提示**：`install-engine.ps1:208` 自己注明 `kyutai/pocket-tts` 约 **9.8GB**（含所有语言目录）→ 「需下载约 9.8GB 权重，未验证」；Qwen3-TTS 1.7B（约 3–4GB 量级）、Parakeet `.nemo`（约 2.4GB 量级）同样未下载。

## 8. 平台与资源

- **macOS Apple Silicon：本地引擎跑不起来（本机实测范围：未跑）**。证据都在源码里：安装器 `scripts/install-engine.ps1:3` 自述「Windows-oriented (uses uv + PowerShell)」；venv 解释器路径写死 Windows 布局 `engines/<id>/.venv/Scripts/python.exe`（`launcher.rs:286-296`、`:326`）；停服务用 `netstat -ano` + `taskkill /F /PID`（`lib.rs:695`）；发行物只有 Windows 安装器（`nightly.yml:22` `runs-on: windows-latest` + Tauri build）。→ 它只服务 Windows 游戏（参考桥是 Fallout: New Vegas mod）。
- **Windows**：一等公民；`install-engine.ps1:48-96` 会用 `nvidia-smi` 探驱动、按 CUDA 版本挑 torch wheel，并**真跑一次矩阵乘验证 kernel 可用**（作者的注释：Blackwell 上旧 wheel 会谎报 `is_available()` 然后在启动时 "no kernel image"），失败则回退 CPU wheel；`apps/chasm/Cargo.toml` 默认 `cuda` feature（无 GPU 时 ort 回退 CPU）。
- **低显存/低内存**：有明确设计——四个引擎各自独立进程与端口（5001/5002/5003/5004），ACE-Step **懒加载 + 空闲卸载**（`acestep_music_server.py:1-25`），TTS 只保留一个说话模型；但 LLM 默认是本地 GGUF（Gemma-4-E2B），内存预算还是绕不开。
- 引擎「装不上就报未安装」的降级路径（`launcher.rs:260,286,326`）对终端用户友好，值得学。

## 9. 复用结论（逐功能）

| 功能 | 结论 | 说明 |
|---|---|---|
| 本地引擎编排（`engines/<id>` 独立 venv、按选中引擎 spawn、缺文件→未安装、端口=进程归属、随游戏起停的边沿触发状态机 + 10s 停止宽限 + 2s 轮询） | **只参考** | 这正是我们工坊 `localsvc` 生命周期要的形状；AGPL 不能抄代码，但协议/状态机思路可照做（我们自己做端口占用检测与健康探针） |
| 「按端口杀进程」的实现 | **只参考（且不移植）** | `netstat`+`taskkill` 是 Windows 专属；我们要跨平台就得用 `lsof`/`ps` 或让子进程自己退出 |
| 本地 TTS 引擎选择与 OpenAI 兼容服务端（faster-qwen3-tts / PocketTTS） | **只参考** | 权重层面 Qwen3-TTS 是 apache-2.0、Parakeet 是 cc-by-4.0，可**自建同类服务**接我们自己的 AudioEngine；不要复制它的代码 |
| 本地零样本声音克隆（参考音频+参考文本 / xvec_only） | **只参考** | 路线本身值得自研（Qwen3-TTS Base 直接支持），是我们的 clone_voice 本地实现的重要候选 |
| STT 词表增强（游戏专名/角色名喂给解码 + 模糊纠正） | **照思路自研** | 实现纯标准库、很小，我已跑通它的测试；对我们「角色名/地名识别准确率」直接有用 |
| 本地音乐生成（ACE-Step DiT 直采、懒加载+空闲卸载、用 NPC 自己的音色做风格参考） | **只参考** | 我们若有音乐需求：ACE-Step 生态是 MIT/Apache，可自行集成；懒加载/空闲卸载策略直接学 |
| 云 TTS/克隆/STT 多 provider 适配（ElevenLabs/Inworld/Cartesia；OpenAI 兼容/OpenRouter/Deepgram/AssemblyAI） | **只参考** | 我们 `tools/audio` 已有 ElevenLabs/magpie 通道；它的 provider body/解析分支可当回归样例 |
| 游戏侧车文件式语音输入（等 WAV 写完、稳定后识别、重试） | **只参考** | 若将来要接「按键说话」的游戏集成，这是成熟做法 |
| 游戏 mod 桥 / SillyTavern 兼容 / 提示词工程 / Tauri 打包 | **放弃** | 与 AudioEngine 无关（打包流水线只在做桌面端时再看） |
| 整仓代码依赖或 Fork | **放弃（AGPL 传染）** | 见 §7 |

## 10. 风险与未验证项

- **授权风险最高**：AGPL-3.0（且仓库缺 LICENSE 文件，GitHub 显示 None）。任何形式的代码复用都会把 AGPL 义务带进我们的产品；对外服务形态还要满足「向用户提供对应源码」。**建议：完全隔离，只吸收设计思路，不复制任何代码片段。**
- **未跑大量测试**：`crates/chasm-web`（269 个用例，含大部分音频 API 测试）与 `crates/chasm-prompt`（61 个）未跑——前者要完整编译 axum/sqlx/reqwest，后者依赖 `chasm-embed`（fastembed/ort，可能在运行时拉模型）。因此「音频 API 的测试是否真绿」在本报告里**没有实测证据**，只给到了源码行号。
- **未验证任何真实音频链路**：不装引擎（Windows-only 安装器）、不下权重（>1GB 且部分 gated）、不用任何 key → 本地 TTS/STT/音乐与三家云 TTS、四家云 STT **全部未运行**。
- 权重许可只核了 HF API 元数据；ACE-Step 的实际权重仓库未识别；`sqlx` 的许可证未在 lock 中核到。
- 项目状态：单人 48 次提交、最后推送 2026-07-10（约 3 个月前）、CI 不跑测试、README 有大量「本地方案」承诺但只有 Windows 一条路——**外部依赖它做长期基座不现实**。
- 我的测试运行会创建 `target/`（Rust 构建产物）；按审查规则，跑完应连同 `node_modules`/venv 一起清理。
