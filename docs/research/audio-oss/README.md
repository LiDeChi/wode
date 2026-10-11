# 开源音频项目复用审查（2026-10-11）

用户要求（m00508）：暂停从零开发 AudioEngine，先审查 6 个开源项目，判断哪些能直接复用；目标是**终端用户可自行部署**的 AudioEngine：TTS、声音克隆、音乐、音效、STT、本地模型 + 云端 BYOK，可被不同 Coding Agent 经 MCP 调用。

| 仓库 | GitHub 元数据（captain 2026-10-11 查） | 审查人 |
|---|---|---|
| AIEGOBOT/agent-audio | ★40 MIT Python，建 2026-09-22，推 2026-10-05，「本地音频生成 MCP + Agent Skill」 | sol |
| neomorrison/elevenlabs-mcp | ★0 MIT Python，建/推 2026-07-01，「ElevenLabs MCP，28 个工具」 | sol |
| laurentvv/generator-assets | ★6 MIT Python，推 2026-10-10，仓库 ~582MB，「本地 AI 资产管线 Godot/Blender」 | sim2 |
| JimCline/game-audio-kit | ★0 MIT Shell，建/推 2026-07-24，42KB，「自托管游戏音频管线」 | sim2 |
| EricSun0218/OpenGameAgent | ★53 MIT TypeScript，推 2026-10-08，「AI 原生游戏角色/世界运行时」 | qa2 |
| chasmlol/chasm | ★56 **无 LICENSE（GitHub 识别为 None）** Rust，推 2026-07-10，「本地优先 agentic NPC 后端」 | qa2 |

## 审查规则（硬约束）

1. **不信 README**：每一条「已实现」都要给出源码证据 `路径:行号`（以审查时的 commit sha 为准），或给出你实际跑过的命令与输出。只在 README 出现、源码里找不到的，写「README 声称，源码未见」。
2. 克隆到 `/tmp/oss-audit/<owner>__<repo>`，记录 `git rev-parse HEAD`。用 `--depth 50` 足够看维护节奏；generator-assets 很大，用 `--filter=blob:limit=5m` 或 sparse checkout，别把 LFS 大文件拉下来。
3. **不得接受任何模型授权**（Hugging Face gated 模型的 accept、任何 EULA 点击）；**不得调用任何付费 API**；不得使用任何 API key（包括钥匙串里的）。需要 key 才能验证的功能写「需 key，未验证」。
4. 本机磁盘只剩约 19GB、内存 16GB：允许建隔离 venv / node_modules 跑项目自带测试与不需要权重的路径；**单次下载超过 1GB 的权重不要下**，写明「需下载 X GB 权重，未验证」。跑完删掉 venv。
5. 授权要分三层查：①仓库源码 LICENSE（以及文件头是否另有声明）；②直接依赖（pyproject/requirements/package.json/Cargo.toml 里每个运行时依赖的许可证，重点找 AGPL/GPL/非商用）；③项目会用到的**模型权重**各自的许可证（去 Hugging Face 模型卡 `https://huggingface.co/api/models/<id>` 的 cardData.license / license_name 与 gated 字段核对），标注是否 gated、是否可商用、是否有营收/地区/用户量限制。AGPL 与任何带商用限制的模型必须单独标红。
6. 平台：从源码判断 macOS Apple Silicon（mps/mlx/cpu 路径）、Windows（路径分隔、shell 脚本、CUDA 依赖）、低内存设备（模型显存/内存需求、是否有 CPU/量化/小模型路径）。能实测的就在本机实测并写命令。

## 每个仓库一份报告：`docs/research/audio-oss/<owner>__<repo>.md`

固定小节：
1. 一句话：它到底是什么（基于源码，不是基于 README）
2. 审查快照：commit sha、提交数/贡献者数/最近 10 次提交日期、issue/PR 情况、有无 CI
3. 架构：入口、模块、数据流（≤15 行）
4. 真实已实现功能表：功能 | 证据（路径:行号 或 运行记录）| 状态（已验证运行 / 源码完整未运行 / 半成品 / README 声称源码未见）
5. MCP：有没有 MCP server；用的哪个 SDK 与传输（stdio/http）；工具清单与参数；能否被 Claude Code / Codex / Cursor 等直接接
6. 测试：有哪些测试、你跑了没有、结果
7. 依赖与授权：源码 LICENSE；运行时依赖许可证表；模型权重许可证表（gated / 商用 / 限制）
8. 平台与资源：macOS Apple Silicon / Windows / 低内存 的判断与证据
9. 复用结论（逐功能）：**直接依赖** / **Fork 改造**（改什么）/ **只参考**（参考什么）/ **放弃**（为什么）
10. 风险与未验证项

## 汇总（sol 负责，等六份报告齐）：`docs/research/audio-oss/DECISION.md`

复用决策表 + 最小整合架构 + PoC 计划，见对应任务说明。
