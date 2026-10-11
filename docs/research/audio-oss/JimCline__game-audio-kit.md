# JimCline/game-audio-kit 审查报告

审查人：sim2（t20）· 审查日期：2026-10-11 · 规则见本目录 [README.md](README.md)
审查快照：`JimCline/game-audio-kit` @ `97471abfb24fb1bc79840ef394184e0049dbac8e`（+ 两个被它引用的仓库，见 §2）
> 复用结论（§9）按队长 2026-10-11 转达的新方向写：**先做 Web、基于 Web 扩多端、尽量不上游戏引擎**；因此引擎专属的导出/插件一律归「放弃/只参考」，重点看「浏览器页面 + 本机 Node 服务能调到的后端（HTTP/CLI/MCP）」以及「能不能纯浏览器跑」。

---

## 1. 一句话：它到底是什么

**它不是音频引擎，是一条「工作流 + 两个别人写的 MCP 服务」的接线方案。** 本仓库自己的代码只有：一个 bash 安装器、一个 Claude Code 技能（markdown 手册）和 **3 个可独立运行的 Python 脚本**（`build_audition.py` 96 行、`sfx_client.py` 83 行、`tighten.py` 38 行）。真正干活的两块在仓库外：

- **本地 SFX** = 另一个仓库 [`JimCline/sfx-gen-mcp`](https://github.com/JimCline/sfx-gen-mcp)（**300 行** Python，把 Stability 的 **Stable Audio Open 1.0** 用 `stable-audio-tools` 跑在本地 GPU 上，暴露成 MCP）；
- **音乐/语音** = 第三方 Go 二进制 [`mordor-forge/gemini-media-mcp`](https://github.com/mordor-forge/gemini-media-mcp)（Apache-2.0，走 **Google Gemini API**：音乐 = **Lyria**，语音 = **Gemini TTS**，**付费、要 key**）。

对「Web 优先」的我们，最值钱的是**听证台（audition booth）那套「生成候选 → 浏览器里点选/写笔记 → 把选择粘回给 agent → 只重做落选的」人机挑选循环**，以及 38 行的 `tighten.py`；本地模型那套（PyTorch + 10 GB gated 权重 + `stable-audio-tools` 要求 Python <3.11）可以先不装，但它的形态（**本机 HTTP 服务**）恰好是 Node 侧一个 provider 就能接的；**gemini-media-mcp 是当前最直接可接的付费 TTS/音乐后端**（单二进制、stdio + HTTP、自带预算账本与确认阈值）。

## 2. 审查快照

**主仓库 `JimCline/game-audio-kit`**

| 项 | 值 |
|---|---|
| commit | `97471abfb24fb1bc79840ef394184e0049dbac8e`（main） |
| 克隆 | 普通 `git clone --depth 50` → 168 KB（无需 partial） |
| 提交数 / 贡献者 | **5 个提交**，1 位作者（Jim Cline） |
| 全部提交时间 | 2026-07-23（3 次）、2026-07-24（2 次）——**两天写完就停了** |
| ★ / fork / issue | 0 / 0 / 0（自用分享，无外部用户） |
| CI | **无**（`.git` 外只有 `LICENSE/README/install.sh/uninstall.sh/skills/`，无 `.github`） |
| 测试 | **无任何测试文件** |
| LICENSE | MIT（`LICENSE:1`） |
| 自述定位 | README:13-16 自己写明「experimental proof of concept… treat it as a starting point, not a product」 |

**它依赖的两个仓库**（我没把它们的 README 当证据，能克隆的都克隆并读了源码）

| 仓库 | HEAD | 规模 | 快照 | 许可证 |
|---|---|---|---|---|
| `JimCline/sfx-gen-mcp` | `f6ba5616f1ad99d0e72869d9b471b147ebf4d6e4` | 8 个文件，`server.py` **300 行** + `control.py` 367 行 | 创建 2026-07-24、最后推 2026-08-02；★1；0 issue；**无 CI、无测试** | MIT |
| `mordor-forge/gemini-media-mcp` | `747f3b876f548cf1dd0fa4063f5de0ac4f220eda` | Go，~1 MB 源码、10+ 内部包 | 创建 2026-04-02、最后推 **2026-10-09**（活跃）；★9 / fork 5 / 4 open issues | **Apache-2.0** |

## 3. 架构（≤15 行）

```
game-audio-kit（本仓库：安装器 + 技能 + 3 个脚本）
├─ install.sh ──┬─ uv tool install git+…/sfx-gen-mcp        ← 本地 SFX 守护进程（端口 8756）
│               ├─ launchd plist / systemd user unit          ← 守护 + KeepAlive/Restart=always
│               ├─ 下载 gemini-media-mcp 二进制（v0.1.1）      ← 音乐/语音（付费 Gemini）
│               ├─ macOS：key 进 Keychain + with-gemini-key 包装脚本；Linux：明文写进 ~/.claude.json
│               └─ claude mcp add …                          ← 把两个服务注册给 agent
└─ skills/game-audio-audition/  ← Claude Code 技能（markdown 手册 + 脚本）
   ├─ SKILL.md        五步循环：盘点 → 生成候选 → 发布听证页 → 收选择/重做 → 落地
   ├─ REFERENCE.md    守护进程运维、提示词工艺、页面约定、Godot 提取/接线
   ├─ build_audition.py  manifest.json → 单文件自包含 HTML（音频内嵌 data URI）
   ├─ audition_template.html  浏览器里的听证台（localStorage 记选择 + 笔记，Copy selections）
   ├─ sfx_client.py    绕过 MCP 客户端、直接对 8756 发 MCP JSON-RPC（批量、后台跑）
   └─ tighten.py       静音裁剪 + atempo 变速 + 淡出（用户说「短一点」时用）

运行期的真实数据流（音频本身）：
agent → MCP(sfx-gen:8756) → sfx-gen-mcp(server.py) → stable-audio-tools → Stable Audio Open 1.0(.safetensors, 本地 GPU)
agent → MCP(stdio) → gemini-media-mcp(Go) → generativelanguage.googleapis.com …:generateContent → Lyria / Gemini TTS
两者落 .wav/.mp3 到磁盘 → build_audition.py(ffmpeg) → 单页 HTML → 人点选 → 粘回 agent
```

## 4. 真实已实现功能表

图例：✅已验证运行（本机实跑）｜🟦源码完整未运行｜🟨半成品｜⬜README 声称，源码未见

| 功能 | 证据（路径:行号） | 状态 |
|---|---|---|
| 一键安装：SFX 守护进程 + 音乐/语音二进制 + 技能 + MCP 注册 | `install.sh:73`（`uv tool install --force git+…/sfx-gen-mcp`）、`:90-121`（launchd plist，`KeepAlive`、端口 8756）、`:122-140`（systemd user unit）、`:146-150`（`claude mcp add --transport http …/mcp`）、`:153-214`（按 `uname -s/-m` 下 gemini 二进制）、`:220-224`（拷技能到 `~/.claude/skills/`） | 🟦（本机未安装，见 §10 说明） |
| 本地 SFX 生成（Stable Audio Open 1.0，免费无限） | sfx-gen-mcp `src/sfx_gen_mcp/server.py:44`（`SFX_MODEL` 默认 `stabilityai/stable-audio-open-1.0`）、`:117`（`get_pretrained_model`）、`:214-227`（`generate_diffusion_cond`，`dpmpp-3m-sde`，`sigma_min 0.03/sigma_max 500`） | 🟦（需 ~10 GB gated 权重，按规则未下） |
| Apple Silicon MPS 补丁（上游 float64 在 MPS 不支持） | `server.py:64-91`（重绑 `dit.DiffusionTransformer.apg_project`，MPS 下用 float32；`:119-121` 判定设备） | 🟦（代码完整，未在 MPS 实跑） |
| 共享守护进程 + 惰性加载 + 空闲自杀 + 生成串行锁 | `server.py:52`（`_gen_lock`）、`:190`（`with _gen_lock`）、`:54`（`SFX_IDLE_TIMEOUT` 默认 1800）、`:94-103`（空闲到点 `os._exit(0)`）、`:132-134`（起看门狗） | 🟦 |
| stdio/stdout 卫生（库的 print 不能污染 MCP 协议流） | `server.py:115`、`:190`（`contextlib.redirect_stdout(sys.stderr)`） | 🟦 |
| HTTP（streamable）与 stdio 双传输 | `server.py:284-296`（`--transport http` → `mcp.run(transport="streamable-http")`，默认 `127.0.0.1:8756`） | 🟦 |
| 控制面 MCP（守护进程死了也能被叫醒；不 import torch） | `control.py:1-30`（docstring 讲清为什么必须独立）、`:157` `sfx_ensure_server`、`:214` `sfx_status`、`:234` `sfx_troubleshoot`（`:241` 逐项体检 add(name, ok, detail, fix)） | 🟦 |
| 批量客户端（绕开 MCP 客户端直连 8756，供后台跑） | `sfx_client.py:19-41`（自己发 `initialize`/`tools/call`，解析 SSE `data:` 行）、`:61`（调 `generate_sfx`）、`:70-74`（归一化服务器 `.wav` 重复后缀） | 🟦（本机没起守护进程） |
| **听证台页面生成**：manifest → 单文件 HTML（音频内嵌，>8 s 自动压 MP3） | `build_audition.py:38-61`（`ffprobe` 测时长；≤8 s → mono 16-bit 44.1k WAV data URI，>8 s → mono 128k MP3）、`:83-87`（模板占位 `__DATA__/__STORAGE__/__DEFAULTS__`） | ✅**本机实跑**：manifest 1 行 3 变体 → `page.html` 664 KB，内嵌 2×`data:audio/wav` + 1×`data:audio/mpeg`，页面无任何外部引用 |
| 听证台交互（浏览器里点选、写笔记、复制选择） | `audition_template.html:68`（Copy selections）、`:88,152`（`localStorage[STORAGE]` 存选择）、`:90,186`（笔记）、`:108`（✎ 按钮）、`:122`（长音暂停切换）、`:205`（`navigator.clipboard`） | ✅（编译进上面的页面，自包含） |
| **「短一点」工具**：静音裁剪 + 保音高变速 + 淡出 + 备份 | `tighten.py:24-26`（`silenceremove` 两端 −45 dB）、`:28`（`atempo=max(1.0, trimmed/target)`，只会更快）、`:30-31`（40 ms `afade`）、`:20-22`（首次运行留 `.orig.wav`） | ✅**本机实跑**：1.50 s → 0.60 s（tempo 2.5），生成 `a.orig.wav` 备份 |
| 音乐生成（Lyria：30 s clip / 完整歌） | 不在本仓库：`gemini-media-mcp` `internal/server/tools.go:83`（`generate_music`）、`internal/media/music.go:83`（`ResponseModalities: ["AUDIO","TEXT"]`）、`internal/catalog/models.yaml:467,486`（`lyria-3-clip-preview`/`lyria-3.5`） | 🟦（需 key，未验证） |
| 语音生成（Gemini TTS，单人或双人对话，style 控制） | `gemini-media-mcp` `tools.go:75`、`internal/media/speech.go:63,159`（`ResponseModalities:["AUDIO"]` + `SpeechConfig`）、`models.yaml:356`（`gemini-3.8-flash-tts`） | 🟦（需 key，未验证） |
| 挑选循环的「状态」约定（picks.txt / 每轮换 storage_key / 已选不可变） | `SKILL.md:74-77`、`REFERENCE.md:65-79` | ⬜→其实是**流程约定**，无代码可跑（技能手册，靠 agent 执行） |
| 提示词工艺（SFX 三类锚点、重做要换角度、sibling take vs 种子复现） | `REFERENCE.md:47-63` | 手册（无代码） |
| Godot 专属落地（`res://` 导入、headless import 冒烟、AudioStreamPlayer 队列） | `SKILL.md:79-91`、`REFERENCE.md:81-107` | 手册；**按新方向归「放弃」**（见 §9） |
| Windows 支持 | `install.sh:90/122`（只有 `Darwin`/`Linux` 分支，其余 `warn` 手工跑）、README:182-183（Requirements 只写 macOS Apple Silicon / Linux CUDA） | ❌**不支持**（但依赖的 gemini-media-mcp 本身有 Windows zip，见 §8） |

**README 可信度**：README 对本仓库、sfx-gen-mcp 的描述**逐条对得上源码**（「~300 line」= `server.py` 恰好 300 行；端口 8756、串行锁、惰性加载、30 分钟空闲自杀、MPS 补丁、stdout 卫生全部在源码里找到）。没发现虚标。

## 5. MCP

**本仓库自己没有任何 MCP 代码**——它是 MCP 的**消费者**（`install.sh:146-150,199-206` 用 `claude mcp add` 注册别人的服务）。相关三方：

| 服务 | SDK / 传输 | 工具（参数） | 能否直接接 |
|---|---|---|---|
| `sfx-gen`（本地 SFX，sfx-gen-mcp） | Python **FastMCP**（`mcp>=1.9,<2`）；stdio 或 streamable HTTP（`http://127.0.0.1:8756/mcp`） | `generate_sfx(prompt, duration_seconds=4.0, steps=50, cfg_scale=7.0, seed=-1, negative_prompt="", variations=1, output_dir="", filename="")` → 返回 `{files, seed, sample_rate, steps, cfg_scale, generation_time_seconds}`；`sfx_server_status()` | ✅ Claude Code/Codex/Cursor 都能接（HTTP 直接写 URL；stdio 直接当命令起） |
| `sfx-gen-ctl`（控制面，同一个包） | FastMCP，**stdio only**（`control.py:1-16` 解释：守护进程挂了它的工具就没了，所以救援工具必须另起一个） | `sfx_ensure_server(timeout_seconds=120, attempts=3)`、`sfx_status()`、`sfx_troubleshoot()`（逐项体检带修复建议） | ✅（`claude mcp add --scope user -- sfx-gen-ctl sfx-gen-ctl`） |
| `gemini-media`（音乐/语音/图像/视频） | Go，**MCP 2026-07-28**；stdio **或** streamable HTTP（默认 `127.0.0.1:8765`，可配 bearer token） | 12 个工具：`generate_image`、`edit_image`、`generate_video`、`get_video`、`extend_video`、`edit_video`、**`generate_speech`**、**`generate_music`**、`list_models`、**`estimate_cost`**、**`get_usage`**、`get_config` | ✅ 自带多客户端打包（Claude Code/Codex/Gemini CLI/VS Code·Copilot/Cursor，README:47-70） |

**浏览器能不能直接调？不能。** 三个都是 MCP（stdio 或 streamable-HTTP-MCP），不是普通 REST；浏览器页面要调它们，必须经过**本机 Node/服务端桥**——这正是我们 `docs/WORKSHOP.md` 的 `mcp-agent` 协议要解决的事，所以形态是合的，只是不能省掉那一层。

## 6. 测试

- `game-audio-kit`：**没有测试、没有 CI**（`git ls-files` 只有 LICENSE/README/两个 shell/skills）。
- `sfx-gen-mcp`：**没有测试、没有 CI**（8 个文件，无 `tests/`、无 `.github/`）。本地模型这条路**零自动化验证**。
- `gemini-media-mcp`：有真测试（`internal/*/*_test.go`，含 `catalog_test.go` 392 行、`service_test.go` 845 行、`ledger_test.go` 320 行）。**本机实跑（无需任何 key）**：`go test ./...` → 全部 `ok`（10 个有测试的包 + 3 个 `no test files`），exit 0。
- 我自己补的冒烟（本报告 §4 的 ✅ 两条）：用 `ffmpeg` 合成 1.5 s 正弦 / 2 s 粉噪 / 12 s 长音 → `tighten.py a.wav 0.6` 得 `orig=1.50s trimmed=1.50s tempo=2.5 final=0.60s` → `build_audition.py manifest.json page.html` 得 `wrote page.html: 1 rows, 3 variants, 664 KB`，页面内 `2×data:audio/wav + 1×data:audio/mpeg`、无外部引用。**这两个脚本在我们这边的价值是可验证的**。

## 7. 依赖与授权

### 7.1 三个仓库的源码
| 仓库 | 许可证 |
|---|---|
| game-audio-kit（本仓库） | **MIT**（`LICENSE:1`） |
| sfx-gen-mcp | **MIT**（`pyproject.toml:5` `license = { text = "MIT" }`，LICENSE 同） |
| gemini-media-mcp | **Apache-2.0**（README:251；GitHub API `license.spdx_id = Apache-2.0`） |

### 7.2 运行时依赖（sfx-gen-mcp `pyproject.toml:15-23` + 实测）
| 依赖 | 版本约束 | 许可证 | 备注 |
|---|---|---|---|
| `mcp` | `>=1.9,<2` | MIT | **坑已写在源码注释里**：`pyproject.toml:16`「mcp 2.0 removed `mcp.server.fastmcp`」；PyPI 现已是 2.3.0 → 这个上界是必需的，不是保守 |
| `stable-audio-tools` | `>=0.0.19` | **MIT**（`Stability-AI/stable-audio-tools`，注意组织名带连字符；我一开始按 `stabilityai/…` 查是 404，核对后确认是 `Stability-AI/…`） | PyPI 最新 **0.0.20**；`requires_python <3.11,>=3.10`（**不支持 3.11+**）；**硬 pin `torch==2.7.1`/`torchaudio==2.7.1`**；依赖链含 `nnAudio`、`PyWavelets==1.4.1`、`sentencepiece==0.1.99`、`v-diffusion-pytorch`、`vector-quantize-pytorch==1.14.41` 等一堆钉死版本（PyPI metadata 实测） |
| `torch` / `torchaudio` | `>=2.5`（实际被上游 pin 到 2.7.1） | BSD-3 / BSD-2（PyPI classifiers） | ~2–3 GB 安装体积 |
| `numpy` / `soundfile` | 无约束 | BSD-3 / BSD-3 | ⚠️ `soundfile` 底下是 **libsndfile = LGPL-2.1**（动态链接通常可接受，写进合规清单） |
| `ffmpeg` / `ffprobe` | 系统依赖 | ⚠️ 取决于构建（Homebrew 为 GPL 系） | `build_audition.py:39`、`tighten.py:13,24,30` 都直接调命令行 |
| gemini-media-mcp | 单二进制（Go 1.26+ 也能 `go install`） | Apache-2.0 | 无 Python 依赖 |

### 7.3 模型权重（HF API 核对，**未接受任何 gate**）
| 模型 | 仓库 | gated | 许可证 | 判断 |
|---|---|---|---|---|
| **Stable Audio Open 1.0**（本地 SFX 唯一模型） | `stabilityai/stable-audio-open-1.0` | **auto（要接受协议）** | `cardData.license = other`，`license_name = **stable-audio-community**` | ⚠️ 需接受 Stability 社区许可；README:253-256 自述「<$1M 年营收可商用，产出归你」与社区许可一致；18.2k downloads / 1730 likes（实测） |
| （对照）Stable Audio 3 Small SFX | `stabilityai/stable-audio-3-small-sfx` | auto | 同上 `stable-audio-community` | 与本仓库无关，仅供横向参考 |

### 7.4 云 API（音乐/语音，无权重）
- **只有闭源付费服务**：Google Gemini API（`generativelanguage.googleapis.com`，`models/{id}:generateContent`；音乐 `ResponseModalities:["AUDIO","TEXT"]`、语音 `["AUDIO"]+SpeechConfig`）。**没有可自托管的权重**。
- 价格（`gemini-media-mcp` 自带目录 `internal/catalog/models.yaml`，`asOf 2026-09-24`）：`lyria-3-clip-preview` **$0.04/次**（30 s MP3）、`lyria-3.5` **$0.08/次**（≤184 s，MP3/WAV 44.1 kHz）、Gemini TTS 按 token（`audioTokensPerSecond: 25`，`outputPer1M.audio: 10.00–20.00`，工具描述写「约 $0.01–0.02/分钟」）。⚠️ 这是**那个仓库自己的快照**，会漂移，接入时必须以官方价目表为准。
- Gemini 输出受 [Google 条款](https://ai.google.dev/gemini-api/terms) 管（README:257）。

## 8. 平台与资源

- **一等公民只有两个**：**macOS（Apple Silicon，MPS）** 与 **Linux（CUDA，systemd）**。`install.sh:90/122` 只有 `Darwin`/`Linux` 分支，其它平台直接 `warn` 让你手工起进程。
- **Windows：本仓库不支持**（bash 安装器 + launchd/systemd + `plistlib`）；但**依赖的 gemini-media-mcp 支持 Windows**（README:29 有 windows zip，配置目录 `%AppData%`）——也就是说「只接云端音乐/语音」这条路在 Windows 上是通的，卡住的只是本地 SFX 那块。
- **资源**：README:184-185 自述「~10 GB 磁盘（权重）+ 生成时 ~12 GB 内存」；`stable-audio-tools` 要求 **Python 3.10（<3.11）**；生成 50 步在 M 系 GPU 上自述 15–30 s，加载模型 20–40 s（`server.py:112` 日志文案）。
- **CPU 兜底**：`server.py:124-125` 有 cpu 分支，能跑但慢；本机 16 GB 内存属于「能跑但别指望舒服」。
- **本机实测（macOS arm64）**：`ffmpeg`/`ffprobe` 在 `/opt/homebrew/bin`（跑通）；**Go 1.26.8** 在 `/opt/homebrew/bin`（`go test ./...` 跑通）；`uv` 在 `~/.local/bin`；**没有**安装 sfx-gen-mcp（会拖 torch 栈 + 10 GB gated 权重，按规则不下、不接 gate）；**没有**任何 key，所以云端音乐/语音一次都没调。

## 9. 复用结论（Web 优先口径）

| 它的东西 | 结论 | 理由（含 Web 判断） |
|---|---|---|
| **听证台工作流**（manifest → 自包含 HTML → 点选+笔记 → Copy selections → 回填 `defaults`、每轮换 `storage_key`） | **直接参考（可抄设计与脚本）** | 这是**纯浏览器页面**，正好落在「先做 Web」上；我们 `web/assets.html` 现在是只读预览，这套「可点选、可回填、可轮次迭代」的交互是明确增量。`build_audition.py` 96 行、MIT、只依赖 stdlib+ffmpeg，改写进我们的 Node 管线没有障碍。 |
| `tighten.py`（静音裁剪 + `atempo` 变速 + 淡出 + `.orig.wav` 备份） | **直接抄** | 38 行、无第三方库、本机已实跑验证；「用户说短一点」是个真实高频需求。 |
| `SKILL.md`/`REFERENCE.md` 里的**提示词工艺 + 页面约定 + 落地检查** | **直接参考（抄进文档/UI）** | 变体 id 词汇（`proc/gen/alt`）、`storage_key` 每轮必换、已选不可变（promote 而不是覆盖）、radio 处理链 `highpass=f=300,lowpass=f=3400,acompressor=ratio=4:threshold=-18dB,volume=4dB`、响度用 per-key gain 表而不是改文件——都是与引擎无关的通用约定。 |
| `sfx-gen-mcp`（本地 SFX 引擎，Stable Audio Open） | **只参考，暂不装** | 形态是合的（本机 HTTP 服务，Node 一个 provider 就能接），但代价是：torch 栈 + **Python <3.11** + 10 GB **gated** 权重 + 上游 `stable-audio-tools` 只 pin 到 0.0.20；对我们当前「Web 优先 + 先审查再决定」的阶段，**先不做本地 SFX**，等真有「免费无限迭代短音效」的刚需再评它（评估时优先看它的 http 传输与 `generate_sfx` 参数面，别抄它的运维脚本）。 |
| **`gemini-media-mcp`**（音乐 Lyria / 语音 Gemini TTS） | **直接依赖（候选第一顺位）** | Go 单二进制、**stdio + streamable HTTP**、Apache-2.0、活跃维护（2026-10-09）、有真测试（本机 `go test ./...` 全绿），并且**它自己就实现了我们契约里要的那套花钱纪律**：append-only JSONL 账本 + 会话/日/月预算上限 + 超阈值要 `approvedCostUsd` 显式确认 + `estimate_cost`/`get_usage` 工具（`internal/spend/ledger.go:1-2,93-94,279-296`）。接它 = 我们 Node 侧一个 `mcp-agent` provider；**代价**是要 key、按次付费、且服务是闭源的。 |
| **「控制面独立 MCP」模式**（sfx-gen-ctl：重活守护进程可能挂，救援工具必须是另一个轻进程、不 import torch） | **直接参考（设计模式可抄）** | 对我们以后任何「重模型本机服务 + 会挂」的场景都适用：把 `status/ensure/restart/troubleshoot` 放独立进程，别和模型同生共死。 |
| 守护进程运维模式（launchd `KeepAlive` + 惰性加载 + 30 分钟空闲自杀 + 固定端口 + 日志） | **只参考** | 与引擎无关、思路好；但它是 macOS/Linux 专属，Windows 与「纯浏览器」都覆盖不到。 |
| Godot 落地段（`res://` 路径、`.import` 标志、`godot --headless --import` 冒烟、AudioStreamPlayer 跨淡/队列、程序化合成器 dump 脚本） | **放弃** | 按新方向（不上游戏引擎）这一整段作废；它在 `SKILL.md` 里只是「一个 markdown 小节」，删掉即与引擎无关。 |
| 图像/视频工具（gemini-media-mcp 顺手带的） | **本次不评** | 与本轮音频目标无关；但既然接了这个二进制，「同一个服务顺手给图」这件事值得在 DECISION 里记一笔。 |
| Fork 本仓库 | **放弃** | 5 个提交、两天写完、零测试、零 CI、0 issue；本仓库剩下的价值是三个脚本和一本手册——直接抄，不需要 fork。 |

## 10. 风险与未验证项

- **未运行任何生成**：本地 SFX（要 10 GB gated 权重 + torch 栈）与云端音乐/语音（要 key、付费）**一次都没跑**。§4 里所有 🟦 都只是「源码完整」，不是「能用」。唯一 ✅ 的两条是我用 `ffmpeg` 合成音做的脚本冒烟。
- **供应链**：`install.sh:73` 用 `uv tool install git+https://…/sfx-gen-mcp` —— **不锁 commit、不锁 tag**，装的是 main 的最新；`install.sh:161-169` 下载的 gemini 二进制**只按版本号 URL、不校验 sha256**。两者都建议我们以后自己接的时候加锁（我们 `docs/WORKSHOP.md` 的 `command` 条目天然有这个问题，值得在 DECISION 里提一句）。
- **单点依赖**：本地 SFX 完全押在 `stable-audio-tools` 0.0.20（**要求 Python <3.11**、硬 pin torch 2.7.1、个人/小团队维护）与 gated 权重上；上游一旦不兼容新 Python/torch，这条路就断。
- **平台缺口**：本仓库在 Windows 上不可用；「先做 Web」意味着我们的安装/运维脚本不能照抄它的 launchd/systemd 那套。
- **gemini-media-mcp 的成熟度**：★9、1 MB Go、活跃（2026-10-09 仍在推），有测试，但只有一位主要维护者、4 个 open issue（未逐条看）；它的**价目与模型目录是自带快照**（`asOf 2026-09-24`），会漂移，接入后要能容忍/校验。
- **未读/未验证**：`gemini-media-mcp` 的 `docs/architecture-review.md`（30 KB）、5 个 `skills/*/SKILL.md` 与 `packaging/INSTALL-SNIPPETS.md` 未细读；`sfx-gen-mcp` 的 `control.py`（367 行）只读了结构与工具签名，未逐行看实现；`audition_template.html`（215 行）只验证了自包含与关键交互点，未逐行读。
- **邻居**：`/tmp/oss-audit/` 下同时存在队友克隆的 `AIEGOBOT__agent-audio`、`neomorrison__elevenlabs-mcp`、`stable-audio-3-source` 等，本报告只按自己的两个目标仓库出结论，未引用它们。
