# laurentvv/generator-assets 审查报告

审查人：sim2（t20）· 审查日期：2026-10-11 · 规则见本目录 [README.md](README.md)
审查快照 commit：`5a400d8e4267489322e774046f6ca0b6e9ac156a`（partial clone，见 §2）

---

## 1. 一句话：它到底是什么

**一个给 Godot/Blender 用的单机 AI 资产管线**：Python 只做编排（拼命令行、管路径、写 Godot 资源文件、做 ffmpeg 后处理），**所有模型推理都在仓库外的 C++ 二进制里**（`sd-cli`/`llama-cli`/`audiocpp_cli`/`trellis-cli`/`ffmpeg`，通过 `subprocess` 调用，`core/process.py` 的 `run_engine`）。它**不是一个音频库，也不是一个可被别处 import 的 SDK**；音频只是它 50 个 workflow 里的一支（14 个音频 workflow），且音频推理 100% 由上游项目 **audio.cpp**（Apache-2.0，3450★）执行——这个仓库贡献的是**配方**（命令行 family 名、采样率坑、响度/循环/去人声的后处理链），不是引擎。

对我们（要做可自部署 AudioEngine + MCP）的直接含义：**能偷的是配方和参数，不是代码**；真正值得评估的依赖是 audio.cpp 本身（§9）。

## 2. 审查快照

| 项 | 值 |
|---|---|
| commit | `5a400d8e4267489322e774046f6ca0b6e9ac156a`（main） |
| 克隆方式 | `git clone --depth 50 --filter=blob:limit=5m` → 94 MB（仓库 GitHub 报 595 938 KB ≈ 582 MB；LFS 大文件被过滤掉，**未下任何权重**） |
| 提交数 / 贡献者 | `git rev-list --count HEAD` = 68（**浅克隆下限**）；2 个 author 身份，同一人（Laurent VOLFF / laurentvv） |
| 最近 10 次提交日期 | 2026-10-09（4 次）、2026-10-10（6 次）；全部是同一个人的 docs/veille/chore 节奏，一天多批 |
| 建仓 / 最后推送 | 2026-08-25 → 2026-10-10（GitHub API `pushed_at`），非常活跃 |
| issue / PR | open issues = **0**；全量 issue = 0，PR = 10（作者自己的单人流程，无外部协作痕迹） |
| ★ / fork | 6 / 0 |
| CI | 有：`.github/workflows/ci.yml` — matrix `ubuntu-latest, windows-latest`，Python 3.12（uv），`ruff check .` + `pytest tests/ -v`，注释明确「no engine required — fake executables and synthetic signals」 |
| LICENSE | MIT（`LICENSE:1`，Copyright 2026 Laurent VOLFF） |

> LFS 说明：本机没装 `git-lfs`，`--filter=blob:limit=5m` 克隆会在 checkout 阶段失败（`git-lfs filter-process: git-lfs: command not found`）。绕法：`git config filter.lfs.smudge cat` + `filter.lfs.process ""` + `filter.lfs.required false`，再 `git restore --source=HEAD :/`；期间 `git status` 会假报 734 条删除，`git reset -q HEAD` 即恢复（文件数与 HEAD 一致）。

## 3. 架构（≤15 行）

```
main.py                         CLI 入口（唯一入口，无 server、无 HTTP）
└─ cli/parser.py                参数表（-w/--workflow, -i, -o, --seed, ...）
   └─ workflows/base.py          WorkflowRegistry（@register 装饰器自注册，50 个 workflow）
      └─ workflows/<name>.py     一个功能一个文件，声明 PARAMETRES + run()
         └─ core/<domain>.py     真正干活：路径解析、命令行拼装、后处理、Godot 资源导出
            ├─ core/config.py    所有模型/二进制路径的常量表（每个都有 env 覆盖）
            ├─ core/process.py   run_engine([...]) → subprocess.run，日志、超时、返回码
            └─ 外部二进制        C:\SD\sd-cli.exe · C:\audio-cpp\audiocpp_cli.exe · llama-cli · trellis-cli · ffmpeg
```
音频这一支：`workflows/{music_bg,chanson,musique_adn,musique_essence,acestep_cover,sfx,audio_ambience,audio_upscale,retrait_voix,tts_dialogue,voix_off,voix_perso,voix_robot,voix_conversion}.py` → `core/{music_ai,music_essence,voix_off,voix_perso,voix_robot,voix_conversion,sfx_ia,separation,audio_upscale,audio_ops}.py` → `audiocpp_cli --task {tts,gen,sep,s2s,asr,vc} --family <family> --model <gguf> --backend {vulkan,cpu}`。数据流是「文件进 → 文件出」，没有进程内模型对象、没有缓存、没有任务队列。

## 4. 真实已实现功能表

**音频**（全部为「源码完整，未在本机运行」——需要 audio.cpp 二进制 + GGUF 权重，本机不下 >1GB 权重、不接 gate）：

| 功能 | 证据（路径:行号） | 状态 |
|---|---|---|
| TTS 朗读 + 音色克隆（qwen3-tts / VoxCPM2 / Fish S2-Pro 三引擎可切） | `core/voix_off.py:35,44,48`（三个 GGUF）、`:209`（`--task tts --family qwen3_tts`） | 源码完整未运行 |
| ASR（给克隆用的参考音频转写） | `core/voix_off.py:169`（`--task asr --family qwen3_asr`） | 源码完整未运行 |
| 角色音（Kokoro 预置音色 / Qwen3-TTS VoiceDesign 指令设计音色） | `core/voix_perso.py:72,104`；`core/voix_robot.py:84`（`--family kokoro_tts`） | 源码完整未运行 |
| 声音转换 VC（用参考音色重说一段已有录音，保节奏保时长） | `core/voix_conversion.py:57`（`--task vc --family chatterbox`） | 源码完整未运行 |
| 音乐生成：MiniMax-Music3 | `core/music_ai.py:104`（`--task gen --family minimax_music3`） | 源码完整未运行 |
| 音乐生成：ACE-Step 1.5（含 cover / DNA 改写 / 带歌词全曲） | `core/music_ai.py:229`（`--family ace_step --task-route text2music`）、`:298`（cover）；`workflows/{musique_adn,chanson}.py` | 源码完整未运行 |
| 音乐生成：Stable Audio 3 Medium + 参考音频（`init_audio`，保 groove/timbre） | `core/music_essence.py:59`（`--task gen --family stable_audio`） | 源码完整未运行 |
| 音效生成：SA3 Small SFX（有反静音护栏：近静音判失败） | `core/sfx_ia.py:50,137`；`core/music_ai.py:148,284`（`near-silent output (model collapse)`） | 源码完整未运行 |
| 程序化音效/氛围（**纯 Python**：numpy+scipy+soundfile 合成，ADSR、多层无缝环境音、WAV/OGG/Godot bus 导出） | `core/audio_ops.py:1-11`（docstring 列了 5 种环境音）、`workflows/audio_ambience.py` | 源码完整未运行（但**不依赖引擎**，本机可跑） |
| 去人声/分轨：HTDemucs（4 轨）+ SAM-Audio（文本提示分轨，CPU） | `core/separation.py:124`（`--task sep --family htdemucs`）、`:71`（`--task s2s --family sam_audio`） | 源码完整未运行 |
| 音频超分 →48 kHz（UniverSR，输入 8/12/16/24 kHz） | `core/audio_upscale.py:141`（`--task s2s --family universr`） | 源码完整未运行 |
| 循环/BPM/LUFS/ducking 后处理链（BPM 估计、无缝循环拼接、LUFS 测量、sidechain ducking 配方、循环质量校验） | `core/music_ai.py:408,487,581,670,750,851` | **源码完整且部分已实测**：`core/music_ai.py:122` 的 ducking 配方在本机用真 ffmpeg 跑过（见 §6） |
| 循环质量 QA（用本地 LLM/flamingo 分析音频） | `core/music_ai.py:796`（`analyser_boucle_flamingo`）、`core/config.py:147` | 源码完整未运行 |
| 唇形 viseme 抽取（给 Godot lip-sync） | `core/audio_ops.py`（viseme 段）、`workflows/tts_dialogue.py` | 源码完整未运行 |

**图像/视频/3D 骨架**（非本次重点，仅供判断「值不值得 fork」）：Flux.1/SDXL 出图（`core/diffusion.py:139` `sd-cli --diffusion-model`）、Qwen-Image-2.1、ESRGAN/4x-UltraSharp 超分、RIFE 插帧、Wan2.1/2.2 + VACE + LTX-2.5 + MiniMax-H3 视频、TRELLIS.2 图生 3D、PBR 材质、Blender headless GLB、MakeHuman/MPFB2 — 全部同样是「Python 拼命令行 + 外部 C++ 引擎」。

**README 声称但源码未见**：无重大虚标。README 的音频条目（14 个 workflow、上面每条 family）都能在源码里找到对应行；`main.py --list-workflows` 在本机跑通并逐条列出（见 §6）。唯一要小心的是 README 里的**性能数字**（RTF、分钟数、显存）全来自作者自测，本机无法复核。

## 5. MCP

**没有 MCP server。** 全仓库与 MCP 相关的只有 3 个文件：`scripts/proto_rig/demarrer_blender_mcp.py:15,25`（在 Blender 里启动 `blender_mcp` addon）、`scripts/proto_rig/blender_client.py:4`（注释说明它用的是「uvx blender-mcp 那套 JSON-over-socket 协议」）、`scripts/proto_rig/capture_multivues.py:10`（用法说明）。这是**作者用它自己的 Coding Agent 去驱动 Blender**，不是本仓库对外提供的 MCP 面，也不覆盖音频。

结论：**不能被 Claude Code / Codex / Cursor 直接接**。要接只有两种走法：① 自己包一层 MCP server 去调 `main.py -w <workflow>`；②（更实际）把它的**配方**搬进我们自己的 provider 里 —— 见 §9。

## 6. 测试

- 测试文件：`tests/{test_unit,test_cli_contract,test_manifest,test_process}.py` + `conftest.py`，共 **59 个 test**（`grep -c '^def test_'`：27 + 22 + 5 + 5）。
- **本机实测（macOS）**：
  - `uv sync --frozen` → exit 0，venv 338 MB（uv 自带 Python 3.12）。
  - `uv run --no-sync pytest tests/ -q` → **`59 passed in 38.97s`**（与 CI 的 ubuntu/windows 矩阵一致：不需要任何引擎/GPU）。
  - `uv run --no-sync python main.py --list-workflows` → exit 0，逐条列出 50 个 workflow（其中音频 14 个），文案与我们读到的源码一致。
- 覆盖到什么：音频侧有 **10 个真实单测**——BPM 估计（`test_unit.py:65,70`）、循环拼接三种（`:76,86,94`）、峰值归一（`:101`）、重采样（`:108`）、ducking 配方字符串（`:114`）与**真 ffmpeg 执行 ducking 链**（`:122`）、视觉循环（`:178,183`）。引擎调用本身用 monkeypatch 的假 `sd-cli`（`test_cli_contract.py:20,111`）——**没有任何 test 真的调用 audio.cpp**。
- 我们判断：测试质量在本类「个人 AI 管线」里算高（有 CI、有假引擎契约测试、有真 ffmpeg 集成），但它验证的是「命令行拼得对」，**不验证音频好不好听**（作者本人也把结论写成「user verdict」）。

## 7. 依赖与授权

### 7.1 仓库源码
MIT（`LICENSE:1`）。文件头无额外声明。

### 7.2 运行时依赖（`pyproject.toml:8-16`）
`pillow, numpy, onnxruntime, opencv-python-headless, scipy, soundfile, requests` + dev `pytest, ruff`。

| 依赖 | 许可证 | 备注 |
|---|---|---|
| pillow | MIT-CMU (HPND) | 无碍 |
| numpy | BSD-3-Clause | 无碍 |
| scipy | BSD-3-Clause | 无碍 |
| soundfile | BSD-3-Clause（Python 壳） | ⚠️ 底下链接 **libsndfile = LGPL-2.1**；动态链接、不修改则通常可接受，但要写进合规清单 |
| onnxruntime | MIT | 无碍 |
| opencv-python-headless | Apache-2.0 | 无碍 |
| requests | Apache-2.0 | 无碍 |

### 7.3 外部引擎（不经 pip，安装器从上游 release 拉）
| 引擎 | 上游 | 许可证 | 平台资产 |
|---|---|---|---|
| audio.cpp（音频全部能力） | `0xShug0/audio.cpp` | **Apache-2.0**（LICENSE 头 `Copyright 2026 ShugoAI LLC`；GitHub 显示 NOASSERTION 只是识别不出自定义头） | win vulkan / linux vulkan / **macos-arm64-metal** / macos-x64-metal |
| sd-cli | `leejet/stable-diffusion.cpp` | MIT | 三平台 |
| llama.cpp | `ggml-org/llama.cpp` | MIT | 三平台 |
| trellis.cpp | `pwilkin/trellis.cpp` | MIT | 无 macOS 构建（需源码编译） |
| FFmpeg | win/linux = **BtbN GPL 构建**；macOS = Homebrew | 🔴 **GPL-3.0**（BtbN `-gpl` 包） | 见 `scripts/engines_manifest.json` |

> 🔴 **FFmpeg GPL 构建**：如果我们的产品把「下载 BtbN GPL 构建」写进安装脚本，就等于把 GPL 二进制分发进用户环境（不传染我们的代码，但要对用户明示、且不能声称全链路宽松许可）。这一条对我们的 AudioEngine 安装器是个真实决策点（可换 LGPL 构建）。

### 7.4 模型权重（去 Hugging Face API 逐条核对 `cardData.license/license_name` + `gated`，**未接受任何 gate**）

**音频（本仓库真正用到、且来源能在源码里定位的）**

| 模型 | 仓库 | gated | 许可证 | 判断 |
|---|---|---|---|---|
| MiniMax-Music3（音乐生成主力） | `audio-cpp/MiniMax-Music3-GGUF`（`:142`） | false | `license_name = minimax-music3-community-license`（自定义） | ⚠️ 自定义社区许可，**商用条款必须逐条读**；上游 `MiniMaxAI/MiniMax-Music3` 卡上无 license 字段 |
| ACE-Step 1.5（音乐/cover/全曲） | `audio-cpp/audio.cpp-gguf/ACE-Step1.5-GGUF`（`:146`）；上游 `ACE-Step/Ace-Step1.5` | false | **MIT** | ✅ 最干净的音乐模型 |
| Stable Audio 3 Small SFX（音效） | `stabilityai/stable-audio-3-small-sfx` | **auto（要接受协议）** | `stable-audio-community` | ⚠️ 需接受 Stability 社区许可 + 卡上写明**含 Gemma Terms of Use 组件**（额外使用限制）；<$1M 营收可商用 |
| Stable Audio 3 Medium（`init_audio` essence） | `stabilityai/stable-audio-3-medium` | **auto** | `stable-audio-community` | ⚠️ 同上 |
| Qwen3-TTS 1.7B（Base/VoiceDesign/CustomVoice） | `Qwen/Qwen3-TTS-12Hz-1.7B-Base`；GGUF 走 `audio-cpp/...`、另用 `Serveurperso/Qwen3-TTS-GGUF` | false | **Apache-2.0** | ✅ |
| VoxCPM2 | `openbmb/VoxCPM2`（GGUF `audio-cpp/VoxCPM2-GGUF`） | false | **Apache-2.0** | ✅ |
| Kokoro-82M | `hexgrad/Kokoro-82M`（GGUF `audio-cpp/Kokoro-82M-GGUF`） | false | **Apache-2.0** | ✅ |
| Fish-Audio S2-Pro（TTS 之一） | `fishaudio/s2-pro` | false，但打勾项写着 **“I agree to use this model for non-commercial use ONLY”** | `fish-audio-research-license` | 🔴 **非商用**（另有地点/日期采集） |
| Chatterbox（声音转换 VC） | `audio-cpp/audio.cpp-gguf/Chatterbox-GGUF`；上游 ResembleAI Chatterbox | — | 上游为 MIT（本次只核到 GGUF 目录，**未逐条核对卡**） | ⚠️ 待核对（VC 这条链只有它） |
| HTDemucs（去人声/4 轨） | 代码默认 `C:\Modeles_LLM\HTDemucs-GGUF\htdemucs-f16.gguf`（`:23`）；GGUF 在 `audio-cpp/audio.cpp-gguf/HTDemucs-GGUF` | false | 上游 Demucs 权重 MIT；GGUF 卡未写许可证 | ⚠️ 待核对（预期 MIT，但**仓库没记录来源**） |
| SAM-Audio（文本提示分轨） | `facebook/sam-audio-base`（GGUF `audio-cpp/SAM-Audio-GGUF`，`:39`） | **manual（人工审批，要姓名/生日/国籍/单位/职位 + IP 定位）** | `sam-license` | 🔴 **人工 gate + 非开放条款**，终端用户自行部署会被卡 |
| UniverSR（音频超分） | GGUF `audio-cpp/audio.cpp-gguf/UniverSR-GGUF`（`core/audio_upscale.py:141`） | — | 本次未核到上游卡 | ⚠️ 待核对 |
| music-flamingo（循环 QA） | `mradermacher/music-flamingo-hf-GGUF`（`core/config.py:147`），base `nvidia/music-flamingo-hf` | false | 上游 license=`other`（NVIDIA 自定义；同族 `nvidia/audio-flamingo` 为 OneWay-Noncommercial） | 🔴 视为**非商用**，需读条款 |
| Audio-Flamingo（audio.cpp 生态同族，仓库未直接引用） | `audio-cpp/Audio-Flamingo-GGUF` | false | `nvidia-oneway-noncommercial` | 🔴 非商用（备查） |
| RE-USE（音频修复，仓库未引用） | `audio-cpp/RE-USE-GGUF` | false | `nvidia-one-way-noncommercial` | 🔴 非商用（备查） |
| Yue2-3B / SheetSage2（仓库未引用） | `audio-cpp/*-GGUF` | false | `cc-by-nc-4.0` | 🔴 非商用（备查） |
| VibeVoice-7B / AuK / Nemotron-3-Diarization（仓库未引用） | `audio-cpp/*-GGUF` | false | MIT / MIT / `openmdw-1.1` | ✅（备查） |
| Index-Echo-S2TT | `IndexTeam/Index-Echo-S2TT-*` | false | **Apache-2.0** | ✅（备查） |

**图像/视频/3D 里必须标红的**

| 模型 | 仓库（源码出处） | gated | 许可证 | 判断 |
|---|---|---|---|---|
| **FLUX.1-dev（默认出图模型！）** | `city96/FLUX.1-dev-gguf`（`core/config.py:79`、`scripts/download_models.py:35`） | auto | `flux-1-dev-non-commercial-license` | 🔴 **非商用**，且是整条 2D 链的默认底模 |
| MiniMax-H3（视频+音频） | `Comfy-Org/MiniMax-H3` / `leejet/MiniMax-H3-GGUF`（`core/config.py:109`） | false | `minimax-h3-community-license-agreement` | ⚠️ 自定义社区许可 |
| LTX-2.5 | `realrebelai/LTX-2.5_GGUFs`（卡写 `see-base-model`）；`Lightricks/LTX-Video` license=`other` 无 license_name | 部分镜像 **401/私有**（`dummy9996/LTX-2.5-22b-ungate`） | 「see base model」 | ⚠️ 需读 Lightricks 条款；「ungate」镜像本身就说明官方有 gate |
| Juggernaut XL（SDXL） | `RunDiffusion/Juggernaut-XL-v9` 系（`core/config.py:85`） | false | `creativeml-openrail-m` | ⚠️ 商用可，但带使用限制 |
| Qwen-Image-2.1 | `core/config.py:91`（`qwen-image-2.1-UC-Q8_0.gguf`） | — | HF `Qwen/Qwen-Image` = Apache-2.0，但仓库自己的 workflow 文案写「RESEARCH license = personal/non-commercial use only」 | ⚠️ **仓库自述与 HF 冲突**，2.1 权重来源未记录，须核对 |
| RMBG-1.4（抠图） | `briaai/RMBG-1.4`（`download_models.py:49`） | false | `bria-rmbg-1.4`（免费版仅非商用） | ⚠️ 商用需另签 |
| Real-ESRGAN x4plus / anime | GitHub release `xinntao/Real-ESRGAN`（`download_models.py:43,44`） | — | BSD-3-Clause（仓库） | ✅/⚠️（权重随仓库发布，按 BSD-3 处理） |
| 4x-UltraSharp | `uwg/upscaler` | false | MIT | ✅ |
| RIFE | `FuryTMP/RIFE_fp32` | false | MIT | ✅ |
| DeepBump | `shiertier/deepbump` | false | 卡上**无** license；上游 HugoTini/DeepBump 为 **GPL-3.0** | 🔴/⚠️ GPL 沿链 |
| Wan 2.1/2.2 | `city96/Wan2.1-*-gguf`、`Comfy-Org/Wan_2.1_ComfyUI_repackaged` | false | Apache-2.0 | ✅ |
| TRELLIS.2 | `microsoft/TRELLIS-image-large` | false | MIT | ✅ |
| Pixal3D（TRELLIS 微调） | `vegax87/Pixal3D`（README 提到） | — | 未核 | ⚠️ |
| LFM2.5-8B-A1B（本地「艺术指导」LLM） | `LiquidAI/LFM2.5-8B-A1B-GGUF` | false | `lfm1.0`（LFM Open License） | ⚠️ 营收门槛型商用许可 |
| Gemma-4 微调文本编码器（LTX） | `DeepNeuralNerd/Gemma-4-12B-...-LTX_2.5` | — | 继承 Gemma Terms | ⚠️ Gemma 附加条款 |

一句话：**这个仓库的图像链默认就是非商用的（FLUX.1-dev）**，音频链里干净的是 ACE-Step(MIT)/Qwen3-TTS(apache)/VoxCPM2(apache)/Kokoro(apache)，脏的是 Fish S2-Pro(非商用)、SAM-Audio(人工 gate)、SA3(需接受 + Gemma 条款)、MiniMax-Music3(自定义)。

## 8. 平台与资源

- **架构上跨平台，但默认值是 Windows**：
  - `core/config.py:46-199` 全是 `C:\...\*.exe` 默认路径，每个都能被 env 覆盖（`AUDIOCPP_PATH`、`SD_CLI_PATH`、`MODEL_DIR`…）。`core/` 里**没有任何 `sys.platform`/`darwin`/`linux` 分支**（grep 只命中了 `C:\` 与 `.exe`）。
  - 但安装器是真的跨平台：`scripts/install_unix.sh:75-86` 用 `uname -s`/`uname -m` 判定 `linux` / `macos-arm64` / `macos-x64`，`scripts/engines_manifest.json` 里 **audio.cpp 有 `macos-arm64`/`macos-x64` 的 `audio-*-bin-macos-*-metal.tar.gz`**，ffmpeg 在 macOS 走 brew，README:148 的 support matrix 也这么写（trellis.cpp 明确没有 macOS 构建）。
  - ⇒ **audio.cpp 在 macOS（Metal）是可用的**，本仓库在 macOS 上只差「env 指路径」这一步。
- **本机实测（macOS，Apple Silicon）**：`uv sync --frozen` OK、`pytest` 59 passed、`main.py --list-workflows` OK（见 §6）。**没有**实测任何生成（无二进制、无权重；不下 >1GB）。
- **低内存/CPU 路径**：模型全是 GGUF 量化（Q4-Q8），README 自述工作站是 AMD RX 6950 XT 16 GB 显存；CPU 路径明确存在但很慢——`core/audio_upscale.py:14-18` 记录 UniverSR 的 Vulkan 后端坏掉、**必须 CPU、RTF≈13**（28 s → 6 min；3 分钟语音 → 40 min）；SAM-Audio 也走 CPU（`--backend cpu --threads 16`，`core/separation.py:71`）。对 16 GB 内存的 Mac：量化模型能跑，但「CPU 兜底」的体验会很差，除非 Metal 后端真的在（audio.cpp macos-metal 构建）。
- Windows：路径、PowerShell 安装器、`C:\` 默认值都在，显然是作者的主力平台（第一公民）。

## 9. 复用结论（逐功能）

**总判断：不把它作为依赖，也不值得 fork；把它当「配方书」+ 把 audio.cpp 当作候选引擎。**

| 它的功能 | 结论 | 理由 |
|---|---|---|
| 音频生成全家桶（TTS/克隆/VC/音乐/SFX/分轨/超分） | **只参考**（并另评 audio.cpp） | 本仓库自己不推理：它只是 audio.cpp 的命令行包装。我们要复用的是**配方**（family 名、`--task`、采样率约束、后处理链、反静音护栏），代码可读性尚可（法语命名 + 全局路径常量），但直接搬会连带其配置体系。 |
| 纯 Python 音频 DSP：BPM 估计、无缝循环拼接、峰值/重采样、LUFS 测量、ducking 配方、循环校验 | **可直接抄参数/算法（MIT）** | 不依赖引擎、有真 ffmpeg 集成测试（`test_unit.py:122`）。对「游戏 BGM 无缝循环 + 语音底噪 ducking」这类需求，`core/music_ai.py:408-620,670-773,851-901` 是现成答案，MIT 允许直接改写进我们的代码。 |
| 程序化音效/氛围合成（`core/audio_ops.py`，numpy/scipy） | **只参考 / 局部直接抄** | 纯 CPU、无模型，适合做「零依赖兜底音效」；但它是给 Godot 场景造的（导出 .tres、5 种固定环境音），接口不是通用库。 |
| 音频超分（UniverSR） | **只参考 + 记下坑** | 结论很实用：只能 CPU、RTF≈13、只出 mono——我们要做的话必须自己测 Metal。 |
| 分轨/去人声（HTDemucs/SAM-Audio） | **只参考** | SAM-Audio 需要人工 gate + 非开放条款；HTDemucs 干净但仓库没记录 GGUF 来源。 |
| 它的输入输出契约（文件进文件出、Godot 资源导出） | **放弃** | 与我们的 AudioEngine（job_id/cost/quality/license 的结构化返回）完全不同层。 |
| 作为 MCP 后端 | **放弃** | 无 MCP，无 server，CLI 一次一个 workflow，没有并发/队列/成本模型。 |
| Fork 整个仓库 | **放弃** | 582 MB、50 个 workflow 里只有 14 个沾音频、价值全在仓库外的二进制里；fork 后我们还得自己维护它对上游 sd-cli/audio.cpp 的版本适配（`engines_manifest.json` 里那些 fix 就是证据）。 |
| **audio.cpp（引擎本身）** | **候选直接依赖（下一步单独评估）** | Apache-2.0、3450★、**官方 macOS Metal 构建**、103 个模型族的 GGUF 规格、`--task {tts,gen,sep,s2s,asr,vc}` 一个二进制的统一接口——这比本仓库更接近我们要的 AudioEngine 底座。风险在模型侧许可（§7.4）和 CLI 而非库的形态。 |

**建议我们直接吸收的 8 条配方**（都可写进自己的 provider，不涉及它的代码）：
1. 音频引擎统一形态：`--task <任务> --family <模型族> --model <gguf> --backend {metal,vulkan,cpu}`，一个二进制覆盖 6 类任务。
2. 反静音护栏：生成后检查「近静音」并判失败（`core/music_ai.py:148,284`）——我们 t8 里踩过的 say 哑音频同款问题，作者也是同样的处理。
3. 音乐循环：BPM 估计 → 找零交叉/稳定区 → 循环拼接（`core/music_ai.py:408-620`）。
4. 响度规范：语音 -16 LUFS、BGM 底噪 -30 LUFS、ducking 用 ffmpeg `sidechaincompress`（`core/music_ai.py:670,851`）。
5. 语音后处理链：pitch 用 `asetrate`（按源采样率算）+ 补偿 `atempo`；whisper = lowpass 1800 Hz + volume 0.5 + aecho 60 ms（`core/voix_perso.py:141-174`）。
6. 参考音频克隆前先 ASR 转写（`core/voix_off.py:152`）。
7. 输入采样率约束：HTDemucs 必须 44.1 kHz；SAM-Audio 自己重采样到 48 kHz mono（`core/separation.py:12-14,62-66`）。
8. 提示词质量是最大杠杆（`core/sfx_ia.py:11` 明说）——对我们生成 SFX 的 prompt 模板有直接参考价值。

### 9.1 按「Web 优先」重判（2026-10-11 队长转达的用户方向）

方向确认：**先做 Web、基于 Web 扩多端、尽量不上游戏引擎（Godot/Unity/Unreal）**。据此对上面每一行重新过一遍：

| 它的东西 | Web 优先下的结论 | 原因 |
|---|---|---|
| 一切「导出到 Godot/Blender」的部分：`.tres`/Godot bus 导出（`core/audio_ops.py`）、Blender headless GLB、MakeHuman/MPFB2、Godot 资源命名与 import 元数据 | **放弃** | 我们不上游戏引擎；这些是纯引擎耦合，删掉不影响它的音频推理部分。 |
| 图像/视频/3D 整条链（sd-cli 出图、ESRGAN 超分、RIFE 插帧、Wan/LTX 视频、TRELLIS 3D、PBR） | **本次放弃（不在评测范围）** | 与音频目标无关，且默认底模 FLUX.1-dev 非商用（§7.4）；要图时单独评。 |
| 它的**运行形态**（`python main.py -w <workflow>` 一次一进程、文件进文件出） | **只参考** | 无 server、无 MCP、无 HTTP；**浏览器不能直接调**。要接只有两条：本机 Node/HTTP 服务去 subprocess 调它的 CLI，或（更直接）引它背后的 audio.cpp 二进制。 |
| 音频后处理配方：BPM/循环拼接、LUFS、ducking、radio/whisper 处理链、反静音护栏 | **只参考（可抄进 Node / 浏览器侧）** | 这些是**纯算法/ffmpeg 参数**，与引擎无关；其中响度与循环判定也能在浏览器用 Web Audio 量测复现。 |
| 程序化音效/氛围合成（`core/audio_ops.py`，numpy+scipy） | **只参考** | 想在**纯浏览器**里做同样的事必须换 Web Audio API（它的实现是 Python 侧离线合成），所以只能抄"参数与包络设计"，不能抄代码。 |
| **audio.cpp**（它的引擎） | **候选直接依赖（形态正好）** | 若我们要本机音频后端：Apache-2.0、有 macOS Metal 构建、一个二进制覆盖 6 类任务，**由本机 Node 服务以 HTTP/CLI 包住即可给浏览器页面用**。 |
| 作为纯浏览器方案 | **无** | 仓库里没有任何能在浏览器里跑的部分（Python + 外部 C++ 二进制 + ffmpeg）。Web 端要音频，要么接云端 API（如 Lyria/Gemini TTS），要么本机服务转一层。 |

一句话：**Web 优先把它的「引擎导出」整段判死、把它的「配方」整段保留，把它的引擎（audio.cpp）留作本机服务候选。**

## 10. 风险与未验证项

- **未运行任何真实生成**（按规则：不下 >1GB 权重、不接 gate、不给 key）。所以所有音频能力的「质量」都只是**作者自述**（例如「去人声 OK」「UniverSR 完美」），我们一条都没复现。
- **未核对**：Chatterbox、HTDemucs、UniverSR 三个 GGUF 的**权重许可**（GGUF 卡上没写，仓库也没记来源）；`Qwen-Image-2.1` 的权重来源（仓库文案说研究/非商用，HF 上 `Qwen/Qwen-Image` 是 Apache-2.0，二者冲突）。
- **许可风险集中三处**：① 默认图像底模 FLUX.1-dev 是**非商用**；② 音频里 Fish S2-Pro（非商用）、SAM-Audio（人工审批 + 非开放条款）、SA3（需接受 + Gemma 条款）会挡住「终端用户自行部署」；③ 安装器拉的是 **FFmpeg GPL 构建**、DeepBump 沿链 GPL、soundfile 底下是 LGPL。
- **工程风险**：无 MCP/无 server/无并发/无成本模型；配置全是进程级全局常量（`core/config.py`），要嵌进我们的引擎等于重写适配层；作者的「版本 pin + 更新护栏」是他的工作站运维，不随仓库交付。
- **平台未验证**：audio.cpp 的 `macos-arm64-metal` 构建**存在但没在本机跑过**（本机没下）。16 GB Mac 上跑 MiniMax-Music3/ACE-Step 的实际速度、Metal 后端是否真的可用，都需要下一步实测才能定。
- **仓库规模**：582 MB（含 examples/LFS），浅克隆 94 MB；里面大量内容是作者的中文/法文日志与 veille 笔记，信息密度低——这也是「只抄配方、不 fork」的一个理由。
