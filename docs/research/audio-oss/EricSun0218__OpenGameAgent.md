# EricSun0218/OpenGameAgent 复用审查

审查人：qa2｜审查日期：2026-10-11｜审查时 commit：`06294f101b5df8a7efa41ff979ef75ec31a5a35c`
克隆：`git clone --depth 50 https://github.com/EricSun0218/OpenGameAgent /tmp/oss-audit/EricSun0218__OpenGameAgent`（13MB）

## 1. 一句话

它**不是一个音频项目**，而是一个 MIT 许可的 TypeScript「AI 原生游戏角色/世界运行时」库（30 个 workspace 包，430 个 `.ts`，没有可执行服务）；音频只是它的一条输入/输出通道：`packages/realtime-local` 提供**本地 VAD（Silero ONNX，宿主自带模型 + sha256 校验）+ OpenAI 兼容的 STT/TTS 适配器**，`packages/realtime` 提供语音会话与打断协调，`packages/integrations` 额外提供**豆包（ByteDance）实时语音 WebSocket** 适配器。除 Silero VAD 外，它**自己不做任何模型推理**——STT/TTS 全部打到外部 OpenAI 兼容端点。

## 2. 审查快照

| 项 | 值 |
|---|---|
| commit | `06294f101b5df8a7efa41ff979ef75ec31a5a35c`（2026-09-27「Publish the complete MIT TypeScript runtime and engine integrations」） |
| 提交数 | 85（GitHub API `/commits` 一页 100 内共 85） |
| 贡献者 | 2 人：EricSun0218（79 次）、dependabot[bot]（6 次） |
| stars / forks | 53 / 7 |
| issue / PR | open issues 18，其中绝大多数是未合的 dependabot PR（#77–#81：undici / ip-address / @grpc/grpc-js / hono）；未见人类讨论型 issue |
| 创建 / 最后推送 | 2026-07-28 / 2026-10-08 |
| 最近 10 次提交日期 | 09-27、08-26、08-26、08-25、08-25、08-25、08-24、08-24、08-24、08-24 |
| CI | 有：`.github/workflows/linux-gate.yml`、`codeql.yml`、`dependency-review.yml`；`package.json:56` 的 `gate` = format:check / lint / generate:check / typecheck / test / build / example:local / benchmark:media:check / package:check / security / unreal:structure:check / public-tree |
| 包管理器 / Node | `packageManager: npm@11.12.1`，`engines.node: 24.x`（本机 Node 26.2.0 也能装、能 build、能跑，见 §6） |

## 3. 架构（≤15 行）

- 入口：库 + 示例（`examples/local-runtime.mjs`，`npm run example:local`），单 Agent 循环（README:88「There is one Agent loop」）。
- `packages/protocol`：版本化运行时协议；`packages/agent`：把 Pi（`@earendil-works/pi-ai`）适配到游戏输入/事件。
- `packages/runtime` + `packages/storage-sqlite`：actor 生命周期与 SQLite 权威存储（动作、审批、记忆、事件）。
- **音频链路**：麦克风（宿主负责设备权限）→ `packages/realtime-local` 的 VAD/端点切分（`game-local-speech-pipeline.ts`）→ `RealtimeSpeechRecognizer`（STT）→ 文本进 Agent → `RealtimeSpeechSynthesizer`（TTS）→ 回放。
- `packages/realtime`：`game-realtime-voice.ts` 协调「识别 / 精确打断 / 文本轮次 / 合成」，自述不持有对话状态、不给第二个 Agent 循环。
- `packages/integrations`：外部世界的适配层——MCP 客户端（stdio / StreamableHTTP）、Agent Skill/Plugin、Ark 图像、**豆包实时语音**、把合成结果落成持久 WAV 的 media 适配器。
- `packages/server`（`@hono/node-server`）+ `packages/client`（OpenAPI 生成）：对外 HTTP/SSE 运行时服务，供 Unity/Godot/Unreal 适配器接入（`engines/`）。

## 4. 真实已实现功能表

| 功能 | 证据 | 状态 |
|---|---|---|
| 本地语音活动检测（Silero VAD，ONNX，WASM EP） | `packages/realtime-local/src/silero-voice-activity.ts:74`（`class SileroVoiceActivityDetector`）、`:149`（`InferenceSession.create(bytes,{executionProviders:["wasm"]})`）、`:384` `readVerifiedModel`、`:411` sha256 比对、`:18-23` 16k/512 帧/64 上下文常量 | 源码完整未运行（需宿主提供 ONNX 模型文件） |
| 模型文件完整性校验 | `silero-voice-activity.ts:26`（`SileroModelArtifact{path,sha256}`）、`:316` 校验 sha256 格式、`:411` 实算比对 | 已验证（单测通过，见 §6） |
| OpenAI 兼容 STT | `packages/realtime-local/src/openai-compatible-speech.ts:66` `OpenAICompatibleSpeechRecognizer`、`:116` `recognize()`、`:134` `client.audio.transcriptions.create({file: toFile(wav,"speech.wav",{type:"audio/wav"}), model, response_format:"json"})` | 已验证（用假 server 的单测通过；真实端点需 key） |
| OpenAI 兼容流式 TTS | 同文件 `:165` `OpenAICompatibleSpeechSynthesizer`、`:223` `synthesize()`、`:237` `client.audio.speech.create({model, voice: voiceProfileId, response_format, stream_format:"audio"})` | 同上 |
| 端点安全策略：明文 HTTP 仅限 loopback | 同文件 `:449` `captureEndpoint()`（https，或 http 且 loopback；username/password/search/hash 必须为空，否则 `LocalSpeechConfigurationError`）、`:472` `isLoopback()`（`localhost` / `[::1]` / `127.x.x.x`） | 已验证（单测通过） |
| PCM(s16le) → WAV 封装 | `packages/realtime-local/src/pcm-s16le-wav.ts:34` `collectPcmS16LeWav()` | 已验证（单测通过） |
| 语音活动切段（utterance capture） | `packages/realtime-local/src/voice-activity-utterance.ts:55` `class VoiceActivityUtteranceCapture` | 已验证（单测通过） |
| 连续说话会话（有界、可取消） | `packages/realtime-local/src/game-continuous-local-speech-session.ts`、`game-local-speech-pipeline.ts:28` `GameLocalSpeechPipeline`、`:57` `startWhenSpeechDetected()` | 已验证（单测通过） |
| 豆包实时语音（ASR + TTS，WebSocket 双向流） | `packages/integrations/src/doubao-realtime-speech.ts`（同时实现 `RealtimeSpeechRecognizer`/`RealtimeSpeechSynthesizer`）、`doubao-realtime-speech-protocol.ts`（`createDoubaoAsrConfigFrame`/`createDoubaoTtsEventFrame`/`parseDoubaoTtsResponse`…）、`doubao-realtime-websocket.ts` `connectDoubaoWebSocket`；凭据走 `CredentialStore`（`@earendil-works/pi-ai`） | 源码完整未运行（**需 key，未验证**） |
| 合成结果 → 持久媒体 | `packages/integrations/src/realtime-speech-media-provider.ts:66`（`captured.synthesize(...)`）、`:97-126`（构造时捕获并 `Reflect.apply` 绑定，防方法被换） | 已验证（单测通过） |
| 语音克隆 / 音乐生成 / 音效生成 | 全仓无 `clone_voice`、无音乐/音效生成调用；`SpeechSynthesisRequest.voiceProfileId`（`packages/realtime/src/types.ts:40`）只是服务端预置声线名 | **未实现** |

## 5. MCP

- **没有 MCP server**：全仓只有 `@modelcontextprotocol/sdk/client/*` 的 import（`packages/integrations/src/mcp-transports.ts:2-3`），`sdk/server/*` 仅出现在两个测试文件里（`packages/integrations/test/mcp-source.test.ts:6`、`test/agent-plugins.test.ts:499-500`，用来起**假 server**）。README:74 也只说「connects explicitly admitted MCP servers through the official client transports」。
- 它引入的是 **MCP 客户端**：`@modelcontextprotocol/sdk` 1.30.0，传输两种——`createGameMcpStdioTransportFactory()`（`mcp-transports.ts:40`，`StdioClientTransport` + 参数/env 冻结与 NUL 校验）和 `createGameMcpStreamableHttpTransportFactory()`（`:55`，`StreamableHTTPClientTransport` + 重连策略），另有 `mcp-url.ts` / `mcp-scoped-fetch.ts`（作用域 fetch）/ `mcp-sse-retry.ts`。
- **工具清单不是固定的**：来自用户配置的 MCP server 目录（`mcp-source.ts` 的 `GameMcpRequestSource`，`:78`），带字节上限 `maxCatalogBytes`（`:197,254`）、渐进披露（`:84` `lazyToolNames`、`:147` `createLazyTools`）、每请求选择（`:85` `select`）与**每次调用的授权回调** `:86` `authorizeCall`；`permission_denied` 映射成 `unavailable/permission-denied`（`:817-818`）。
- 对 Coding Agent 的意义：**Claude Code / Codex / Cursor 不能通过 MCP 接它**（它是客户端不是服务端）。反过来，它这套「官方 SDK 传输 + 目录字节上限 + 逐次授权」正是我们要在 AudioEngine MCP server 侧对调用的处理方式，可当**参考实现**。

## 6. 测试

- 规模：144 个测试文件、2364 个用例（`npx vitest run` 输出）。
- 我跑的命令与结果（隔离安装：`/tmp/oss-audit/EricSun0218__OpenGameAgent`，因仓库 `.npmrc` 写了 `engine-strict=true` 而本机 Node 26.2.0 ≠ 声明的 24.x，需要显式关掉）：
  1. `npm ci --ignore-scripts --engine-strict=false` → exit 0，409 包 / 557MB（`node_modules` 稍后按规则删除）。
  2. `npm run build`（= `tsc -b`）→ exit 0。
  3. `npx vitest run` → **2359 通过 / 3 失败 / 2 跳过，7 个文件失败**（144 文件）。
  4. 音频相关定向：`npx vitest run packages/realtime-local packages/realtime packages/integrations packages/actions` → **714 通过 / 1 失败**（31 文件）。
- 3 个失败全部是**环境问题，不是产品缺陷**：
  - `packages/credentials-windows/test/*`（4 个文件）：Windows DPAPI 包 + `fs-ext-extra-prebuilt` 在 darwin-arm64/Node 26 无预编译产物 → `Failed to load fs-ext native module`。
  - `packages/integrations/test/owned-local-model-process.test.ts`：`expected cwd: /var/... received /private/var/...`——macOS `/var`→`/private/var` 软链，断言写死了真实路径。
  - `packages/storage-sqlite/test/{sqlite-authority,sqlite-process-crash-recovery}.test.ts`：5s 超时 / 崩溃夹具被 `code=9` 杀掉，属时序/环境。
- 音频包自己的测试文件 6 个（`packages/realtime-local/test/*.test.ts`）在上述定向跑里全通过。

## 7. 依赖与授权

- 源码：根 `LICENSE` = MIT（1096B）；**每个包各带一份 MIT LICENSE**（`packages/{realtime-local,realtime,integrations,actions}/LICENSE` 均为「MIT License, Copyright (c) 2026 Eric Sun and OpenGameAgent contributors」）；`package.json` 声明 `"license": "MIT"`。
- 运行时依赖许可证（我核到的音频/进程相关）：

| 依赖 | 版本 | 许可证 |
|---|---|---|
| `onnxruntime-web` | 1.29.0 | MIT |
| `openai` | 6.40.0 | Apache-2.0 |
| `@modelcontextprotocol/sdk` | 1.30.0 | MIT |
| `execa` | 10.0.1（实际安装） | MIT |
| `hono` | 4.13.13 | MIT |

- 仓库自带 `THIRD_PARTY_NOTICES.md`，明确提示：图像链路里的 `sharp` 内含 **LGPL-3.0-or-later 的 libvips 二进制**、`lightningcss` 是 MPL-2.0、`lru-cache` 是 BlueOak-1.0.0。`package-lock.json` 里没有直接的 AGPL/GPL 运行时依赖声明。**音频链路不碰这些**（音频不用 sharp）。
- **模型权重**：仓库不含任何权重（`THIRD_PARTY_NOTICES.md` 明说「model weights and engine editor distributions are not included」）。唯一的本地模型是 Silero VAD ONNX，**由宿主提供文件路径 + sha256**（`silero-voice-activity.ts:26-31`），项目不下载、不 gated、不涉及许可证转移。
- 分发现实：所有包 `"private": true`，npm 上**未发布**（`npm view @opengameagent/realtime-local` → E404）。要用只能**拷源码**（MIT 允许，保留 LICENSE/notice）。

## 8. 平台与资源

- **macOS Apple Silicon**：可用。纯 Node 库，VAD 走 `onnxruntime-web` 的 **wasm** 执行后端（`silero-voice-activity.ts:149`），无 GPU 依赖；本项目在本机 arm64 上完成安装 + `tsc -b` + 2364 个用例（除 Windows 专属包）。
- **Windows**：有专门实现 `packages/credentials-windows`（DPAPI CurrentUser、每写一 entropy、跨进程串行化、原子文件、reparse point 校验），说明作者认真支持 Windows；该包在 macOS 上必然失败（§6）。
- **低内存设备**：友好。不跑本地 LLM、不下载权重；Silero VAD 模型属几 MB 级；重活（STT/TTS）由外部端点承担。
- 约束：`engines.node 24.x`（我强行用 26 能跑通 build + 绝大多数测试）；`fs-ext-extra-prebuilt` 是 Windows 包独有的原生依赖。

## 9. 复用结论（逐功能）

| 功能 | 结论 | 说明 |
|---|---|---|
| OpenAI 兼容 STT/TTS 适配器（含可注入 fetch、超时、字节上限） | **直接依赖 / 拷源码改造** | MIT，正好补我们 AudioEngine「本地优先 + BYOK」缺的那层契约；注意包私有，只能拷代码 |
| 端点准入规则（明文 HTTP 仅 loopback，禁止凭据/query/hash） | **直接依赖（照抄规则）** | `captureEndpoint:449` + `isLoopback:472`，与工坊 §5 的本地服务地址规则同构，可直接落地成我们 `tools/local/net.mjs` 的校验器 |
| Silero VAD（hash 校验 + wasm 单例 + 有界会话 + 可取消） | **Fork 改造** | 换成我们需要的长会话/切段参数与模型来源即可 |
| `pcm-s16le-wav.ts`（PCM→WAV 信封） | **只参考** | 小工具，思路清楚 |
| `owned-local-model-process.ts`（受控子进程：env 逐项校验并冻结、stdio 白名单 `ignore|inherit`、pid、`AsyncDisposable`、dispose 时 kill） | **Fork 改造** | 我们要的本地后端进程管理可直接以它为骨架，补上端口占用检测/健康探针/重启退避（它没有） |
| `actions/admission.ts`（一次性、内容绑定的审批原子消费） | **只参考** | 与我们「未知价要显式 authorize、只认导演的单」同构，可借鉴 revision 校验 |
| MCP 客户端（stdio/StreamableHTTP、目录字节上限、渐进披露、逐调用 `authorizeCall`） | **只参考** | 我们做的是 MCP **server**，但「发现 ≠ 执行、每次调用过闸门」要照这个体例 |
| 豆包实时语音 WS 适配器 | **只参考** | 需 key，未验证；若将来要接国内实时语音可当模板 |
| 角色/记忆/引擎集成/HTTP 运行时（Unity/Godot/Unreal） | **放弃** | 与音频链路无关 |

## 10. 风险与未验证项

- **未验证真实音频后端**：豆包实时语音需要 key（未验证）；OpenAI 兼容 STT/TTS 只跑了假 server 单测，没打真端点。
- **未在声明版本上跑**：仓库要 Node 24.x，本机 26.2.0（`--engine-strict=false` 绕过）；未验证 24.x 下行为是否完全一致。
- **未跑**：`npm run gate` 的完整门禁（format/lint/generate:check/security/package/public-tree 等），只跑了 build + vitest；`tsc -p tsconfig.test.json`（typecheck 的后半）未单独跑（build 只覆盖 `tsc -b`）。
- **法律面**：MIT 覆盖源码，但 `THIRD_PARTY_NOTICES.md` 提示图像链路里 `sharp` 二进制含 LGPL-3.0-or-later 组件；若我们整包依赖它，需自行评估再分发义务（音频链路不涉及）。
- **项目健康度**：单人主导（79/85 提交），最后一次实质提交 2026-09-27，open issue 全是 dependabot；alpha 版本、包 `private` 未发布 → 上游不会为我们的用法兜底，必须自带测试。
- 未核验其 MCP 客户端与真实第三方 MCP server 的连通（只在测试里对 SDK 假 server 跑过）。
