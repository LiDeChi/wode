# AIEGOBOT/agent-audio 源码审查

## 1. 一句话：它到底是什么

一个把固定版本 Stable Audio 3 本地推理包接成两个 stdio MCP 工具的 Python 部署器；能按文字生成 WAV 音乐/音效，不能承担 TTS、声音克隆、STT 或云端多 Provider 引擎。**推荐直接依赖其本地生成侧，先完成模型授权和资源 PoC；不要把模型注册表里的能力当作已暴露接口。**

## 2. 审查快照

审查日期 2026-10-11；仓库 https://github.com/AIEGOBOT/agent-audio ，克隆 `/tmp/oss-audit/AIEGOBOT__agent-audio`，SHA `975d804594f515e81cdb8858587af5469cf78ebf`。以下相对路径证据均属于此 SHA；Stable Audio 上游证据另属 `779434a908193105335fd8d833418603625b2859`。

`--depth 50` 克隆得到 32 个提交、2 个作者身份（不能据此认定两位独立维护者）。最近十次提交：975d804 2026-10-05；d7708a5/732196c 2026-10-04；a46d453 2026-10-03；651c005/25c5591/38893b1 2026-10-02；4435a8b/eb8e19e/6b94799 2026-09-29。匿名 GitHub API 快照：40 stars、8 forks、7 个 open 条目均为 Dependabot PR；另有 3 个 closed PR（#1、#9、#10），未见普通 issue。不是长期成熟度证明。

`.github/workflows/ci.yml` 有 Windows/macOS/Linux Python 3.12 与 Linux 3.11/3.13 矩阵，运行冻结依赖同步、ruff、compile、pytest、doctor；还有 pip-audit、CodeQL、Dependabot。这里只核实配置，未宣称远端 CI 最近成功。

## 3. 架构（入口、模块、数据流）

1. `src/agent_audio/mcp_server.py:11` 创建 FastMCP；`:55` 默认 stdio 启动。
2. `audio_status` → `detect.py:90` 选后端 → `runtime.py:89` 检查文件与头信息。
3. `generate_audio` → `runtime.py:325` 验证输入/输出 → 文件锁串行推理。
4. `backends.py:43` 固定 medium DiT / same-l decoder / CFG 1.0。
5. `runtime.py:21` 固定 Stable Audio 源码版本，在独立 Python 3.12 runtime 调子进程。
6. `download_models.py:12` 固定 optimized 权重仓库与 revision。
7. 推理离线环境 → staging WAV 校验 → `os.link` 排他发布 → 返回路径。
8. `installer.py:106` 将独立解释器与 MCP 模块登记到 Agent 配置；Skill 另行复制。

## 4. 真实已实现功能表

| 功能 | 证据 | 状态 |
|---|---|---|
| MCP 启动、工具发现、后端状态 | `mcp_server.py:11`、`:15`；真实 initialize/tools/list，协议 2025-11-25，2 工具 | 已验证运行 |
| 提示词生成音乐/音效 WAV | `mcp_server.py:33`、`runtime.py:325`、`backends.py:43` | 源码完整未运行；未下载权重 |
| 输入校验与缺 runtime 错误 | 同上；seconds=0 返回 isError=true；3 秒请求返回 runtime not ready | 已验证运行 |
| 安全输出、锁、超时、进程清理 | `runtime.py:23`、`:325`、`:393`；上游 tests 覆盖 | 已验证测试路径；未验证真推理 |
| 固定源/权重下载与独立缓存 | `runtime.py:142`、`:199`、`download_models.py:55` | 源码完整未运行；不能自动接受许可 |
| Codex/Claude/Cursor 配置安装 | `installer.py:86`、`:106`、`:261`、`:334`、`:347` | 源码完整未运行；未改用户配置 |
| 小模型切换 | `profiles.py:14` 存在 small-sfx，但 `backends.py:43` 固定 medium | 半成品：仅 benchmark 路径，MCP 不可选 |
| negative_prompt | `backends.py:34` 非空即拒绝 | 参数可见但功能不支持 |
| 音频续写、inpaint、audio-to-audio | `models/registry.json` 有上游能力记录；MCP 只两工具 | 半成品：注册表记录，不是可调用实现 |
| TTS/克隆/STT/云 BYOK/预算账本 | 工具清单与 runtime 无这些路径 | 不支持 |

## 5. MCP

运行依赖 `mcp>=1.30,<2`，本次安装 1.30.0；FastMCP stdio，源码 `mcp_server.py:55` 未启用 HTTP。真实握手成功，因此标准 stdio MCP 客户端可接；各 Agent 专用安装器尚未实际登记。

| 工具 | 实际参数 | 返回/限制 |
|---|---|---|
| audio_status | 无 | dict；`runtime_ready` 只表示 files_and_headers，不等于生成验收 |
| generate_audio | `prompt:str` 必需；`seconds:float=10.0`；`output_path:str|null=None`；`negative_prompt:str|null=None` | 文本路径；秒数须有限、>0、≤380；只接受 WAV 目标、拒已有目标；负提示词不支持 |

状态实测 selected backend=mlx、runtime_ready=false、generation=not_checked。MCP tool 返回正确 isError；正常音频结果未验证。

## 6. 测试

在 `/tmp/oss-audit/audio-audit-venv` 用 Python 3.12.11、mcp 1.30.0、psutil 7.2.2、pytest 8.4.2 安装并运行：

```sh
/tmp/oss-audit/audio-audit-venv/bin/python -m pytest -q /tmp/oss-audit/AIEGOBOT__agent-audio/tests
# 98 passed in 7.36s
/tmp/oss-audit/audio-audit-venv/bin/python /tmp/oss-audit/probe-mcp.py
```

11 个 test 模块包含输入、下载 mock、runtime、缓存、配置保护与进程清理；`tests/test_mcp.py` 实际通过 stdio ClientSession 连接。probe 另记录真实 initialize/tools/list/audio_status/非法 seconds/缺 runtime。没有调用生成模型、下载 >1GB 权重、接受 HF 条款或使用任何 key；这些测试不能证明音质/延迟。临时记录 `/tmp/oss-audit/agent-audio-mcp.json`。完成后删除 venv，保留小型审查证据。

## 7. 依赖与授权（三层）

源码 `LICENSE:1` 是 MIT；`THIRD_PARTY_NOTICES.md:3` 明说权重不随仓库分发、Stable Audio/Gemma 有独立条款。固定上游 Stable Audio 源码 `LICENSE:1` 也是 MIT，不能把源码 MIT 延伸到权重。

直接依赖与安装推理时新增依赖逐项如下。许可证核对公共 PyPI JSON 的 license/license_expression/classifiers；版本范围来自 `pyproject.toml:8`、固定上游 `optimized/{mlx,tflite}/requirements.txt`、`runtime.py:199`。表为运行时直接依赖，非完整传递依赖 SBOM；推理依赖未安装，未宣称对其最终二进制做合规验收。

| 依赖 | 适用路径 | 许可证/注意 |
|---|---|---|
| mcp >=1.30,<2 | MCP | MIT；本次 1.30.0；禁止把 PyPI 最新 2.x 当已验证版本 |
| psutil >=6,<8 | 资源/进程 | BSD-3-Clause |
| pywin32 >=311 | Windows 条件依赖 | PSF；本机未安装 |
| mlx >=0.30 | Apple MLX | MIT |
| numpy >=1.24 | 两后端 | BSD-3-Clause；当前分发元数据含 0BSD/MIT/Zlib/CC0-1.0 打包组件 |
| sentencepiece >=0.2 | 两后端 | Apache-2.0 |
| huggingface_hub >=0.20 | 下载 | Apache-2.0 |
| soundfile >=0.12 | 音频 IO | BSD-3-Clause；二进制 libsndfile 另属 LGPL，打包时另查 |
| ai_edge_litert >=2.2.0 | TFLite | Apache 分类，元数据未给 SPDX；需最终 wheel LICENSE 复核 |
| socksio >=1,<2 | 安装器补充 | MIT |

未在这些直接依赖发现 AGPL/GPL/非商用。soundfile 的原生传递依赖不可忽略。

| 权重/来源 | HF API 核对 | 商用与限制 |
|---|---|---|
| stabilityai/stable-audio-3-optimized，源码固定 revision `da6edc54ddba10bfd79a077102ded687f80e882b` | 当前 cardData `license=other`、`license_name=stable-audio-community`、`license_link=LICENSE.md`，gated=false | **🔴 有商用条件**：免费商用须注册；Licensee 与 Affiliates 年收入合计超过 $1M 时许可终止，须企业许可；要求协议副本/NOTICE/Powered by Stability AI；输出不得用于改进其他基础生成模型。出口法规/AUP适用，无用户数上限见于条款 |
| stabilityai/stable-audio-3-medium（原始上游参照） | `license=other`、Community，gated=auto；gate 要求 Gemma terms | 同上；此项不是本包装器另行下载目标 |
| google/t5gemma-b-b-ul2（上游 encoder 来源） | `optimized/mlx/models/defs/t5gemma_mlx.py:1`；HF `license=gemma`、gated=manual | **🔴 使用/再分发限制**：Gemma Terms；可商用但需下游执行禁止用途、协议和 NOTICE；未见营收/用户量门槛，法律/出口条件仍适用。optimized 仓库不 gated 不等于免除 encoder 条款 |

匿名元数据与条款读取未接受许可。Community 文件核查的是当前 main，未声称精确 pin 的文本已核对；授权 PoC 前必须复核固定版本条款。

来源：[optimized HF API](https://huggingface.co/api/models/stabilityai/stable-audio-3-optimized)、[medium HF API](https://huggingface.co/api/models/stabilityai/stable-audio-3-medium)、[T5Gemma HF API](https://huggingface.co/api/models/google/t5gemma-b-b-ul2)、[Community 原文](https://huggingface.co/stabilityai/stable-audio-3-optimized/blob/main/LICENSE.md)、[Gemma Terms](https://ai.google.dev/gemma/terms)。Gemma 条款日期 2026-04-01，Community 2024-07-05。二者均非无条件 OSI 模型授权。

## 8. 平台与资源

- Apple Silicon：`detect.py:90` 选 MLX 原生路径；本机 Darwin arm64 已成功状态探测。不是 MPS/Torch 路径；未实测推理。
- Windows/Linux：选择 TFLite；`runtime.py:75` 区分 Scripts/python.exe 与 bin/python，CI 有跨平台配置。CUDA/XPU 被检测但不是包装器实际生成后端，不能宣传 GPU 自动路由。
- 资源：`docs/resource-requirements.md:34` 给默认 TFLite 四权重合计 7,362,275,200 bytes；`:73` MLX 四权重 6,883,369,494 bytes。当前 HF 主分支 TFLite 文件尺寸已变化，不能把 API latest 当 pin 精确尺寸。
- 项目 Windows 建议 25GB 磁盘/32GB RAM，报告工作集 11.56GiB（`docs/resource-requirements.md:7`）；MLX 文档为 24GiB M5 Pro 用户记录，3秒约8.02秒，非本次测量。固定上游 `optimized/mlx/README.md:147`、`:176` 又报告 M1 8GB 与 M4 Pro 48GB 多时长峰值约3.8–5.21GB；这是上游测量，不足以保证本机16GB全程可靠。
- 本机约19GB空闲磁盘：权重+缓存/硬链接+venv总占用尚未核算，不能直接安装全套；small profile未接生成，TFLite small单DiT仍约1.838GB；本次全部跳过下载。上游 `scripts/sa3_mlx.py:452` 默认分阶段释放模型有助峰值，但需真实 PoC。

## 9. 复用结论（逐功能）

| 功能 | 选择 | 必要条件/改造 |
|---|---|---|
| 本地文字→音乐/音效 | 直接依赖，条件性 | 独立 stdio MCP 服务；明确授权并先测16GB资源、3秒音效与短音乐；保留其安装/锁/安全落盘 |
| 小模型/风格参数/negative prompt | Fork 改造 | 接真实可选profile与参数，不能只改 registry；审查小模型授权与资源 |
| Agent 自动登记 | 直接依赖，条件性 | 用户明确选择客户端后运行；避免我们的整合器重复写配置 |
| TTS/克隆/STT/云 BYOK | 放弃此项目承担 | 源码无能力，应接其他服务 |
| 模型 registry/资源报告 | 只参考 | 用于能力/授权展示；readiness必须区分文件可用与生成通过 |
| 成本、许可、任务账本 | 外层最小整合 | 本项目没有统一云端费用/许可确认层；无需为此重写其推理 |

## 10. 风险与未验证项

最先解决的是权重商用条件和16GB/19GB部署成本，而非 MCP 连通性。其安全安装/隔离/输出验证比单文件包装器完整，但 files_and_headers readiness 未验依赖和完整模型checksum；MLX校验仅缓存与目标一致，没有独立预期SHA（`download_models.py:25`、`:55`）。生成固定medium，模型表比可调用能力宽。尚未验证真实音质、循环音乐、长音频、Windows推理、低内存失败恢复、Agent客户端登记、模型固定许可和完整传递依赖。可复验的小例子：无模型运行 `audio_status` 应显示 mlx/runtime_ready=false，再请求 `generate_audio(prompt='rain',seconds=0)` 应返回 isError=true，不能被 UI 显示为成功音频。
