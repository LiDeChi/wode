# 工坊契约：本地模型 + Agent 接入（导演 hold 得住）

> 版本 2026-10-11。上游：docs/ASSETS.md（导演开单）、docs/AUDIO.md（声音引擎）。
> 用户原话：「多模态方面，加入本地模型和 agent 接入。前提是导演 hold 得住。」「用户的机器配置或许够呢？你先支持配置。但不必用我的机器验证。」

## 0. 硬约束

1. **只做配置与接入，不装模型**。仓库代码不下载权重、不起模型进程；用户自己把本地服务跑起来，在配置里登记地址与协议。
2. **不在 captain 的机器上验证真模型**。所有验证用测试里起的假本地服务（loopback 上的 node http server / 假 MCP 进程）。
3. **导演 hold 得住**（§4）：只有导演开的单能被生成；风格锁随单走；每个产物过导演审片才算数；本地服务和 agent 都不能写 manifest、不能写账本。
4. 授权默认按商用来：`license.requireCommercial` 默认 `true`。非商用的服务不可用；协议未知的服务默认不可用（`license.allowUnknown:true` 才放行）。
5. 与声音引擎同一套闸门：local-only 零云请求、预算、未知价、付费不重试，全部照旧（本地服务价格为 0，`priceSource:'local-free'`）。

## 1. 配置：用户登记自己的本地服务

声音沿用 `~/.digital-world/audio/config.json`（DW_AUDIO_HOME）的 `local.services`；图片读 `~/.digital-world/workshop.json`（`DW_WORKSHOP_CONFIG` 可改）。两者条目形状相同：

```json
{ "license": { "requireCommercial": true, "allowUnknown": false },
  "services": {
    "kokoro":  { "protocol":"openai-speech", "url":"http://127.0.0.1:8880", "model":"kokoro",
                 "capabilities":["speech"], "license":{"id":"apache-2.0","commercial":true}, "quality":"production" },
    "comfy":   { "protocol":"comfyui", "url":"http://127.0.0.1:8188",
                 "capabilities":["image","image_edit","music","sfx"],
                 "workflows": { "image":"~/comfy/flows/qwen-image.json", "music":"~/comfy/flows/ace-step.json" },
                 "inputs": { "image": { "prompt":"6.inputs.text", "seed":"3.inputs.seed", "plate":"12.inputs.image" } },
                 "license":{"id":"apache-2.0","commercial":true}, "quality":"production" },
    "gpu-box": { "protocol":"openai-image", "url":"http://192.168.1.20:9000", "allowLan":true, "model":"qwen-image",
                 "capabilities":["image"], "license":{"id":"apache-2.0","commercial":true} },
    "painter": { "protocol":"mcp-agent", "command":["node","~/agents/painter/server.mjs"], "tool":"render_brief",
                 "capabilities":["image"], "license":{"id":"mit","commercial":true}, "quality":"draft" } } }
```

字段：`protocol`（§2）、`url` 或 `command`、`capabilities` ⊆ `speech|music|sfx|clone|image|image_edit|model3d|video`、`model`、`license{id,commercial:true|false|"unknown"}`、`quality` = `draft|production`、`timeoutSec`（默认 300）、`concurrency`（默认 1）、`allowLan`（默认 false）。

地址规则：默认只允许 loopback（127.0.0.1 / localhost / [::1]）；`allowLan:true` 时还允许私网段（10/8、172.16/12、192.168/16）；公网地址一律拒绝（code `config`），本地服务不准变成隐形云。URL 不许带用户名密码；重定向一律拒绝。

## 2. 协议（P1 支持四种）

| protocol | 生成请求 | 结果 | 探活 |
|---|---|---|---|
| `openai-speech` | `POST {url}/v1/audio/speech` `{model,input,voice,response_format,speed}` | 音频字节 | `GET {url}/v1/models` |
| `openai-image` | `POST {url}/v1/images/generations`；有 plate 时 `/v1/images/edits`（multipart，plate 作 image） | `b64_json` 或 `url`（url 也必须过 §1 地址规则） | `GET {url}/v1/models` |
| `comfyui` | `POST {url}/prompt {prompt:<workflow>, client_id}` → 轮询 `GET /history/{prompt_id}` → `GET /view?filename&subfolder&type` | 输出节点里的第一个文件 | `GET {url}/system_stats` |
| `mcp-agent` | stdio 启 `command`（或 `url` 走 streamable-http）→ `initialize` → `tools/call {name:tool, arguments:{brief, style, outDir}}` | 只认 `outDir` 内的文件路径（或 resource blob 由我们落盘）；别的路径、多余文件一律丢弃并删除 | `tools/list` 里有 `tool` |

ComfyUI workflow 是用户导出的 API 格式 JSON；`inputs` 用「节点 id.inputs.字段」路径告诉我们把 prompt / negative / seed / duration / plate 填到哪里。我们不改用户 workflow 的其余部分。

共享客户端放 `tools/local/`：`net.mjs`（地址规则 + 超时 + 禁重定向）、`openai.mjs`、`comfyui.mjs`、`mcp.mjs`。声音侧在 `tools/audio/providers/` 加一个 `localsvc.mjs` 适配器（`local:true`，按 service 条目分发到上面的客户端）；图片侧在 `tools/assets/providers/` 加 `localsvc.mjs`。两边都只调 `tools/local/` 的客户端，不各写一份。

## 3. 目录与体检（不装、不下）

- `tools/local/catalog.json`：已知开源模型的「身份证」：`{id, use, license, commercial, protocols[], hints{minMemoryGB, gpu}, homepage}`。首批：Qwen3-TTS、CosyVoice2、Kokoro-82M、Chatterbox（语音）；ACE-Step 1.5（音乐）；Stable Audio Open Small（音效，社区许可：营收上限内可商用 → `commercial:"conditional"`）；Qwen-Image / Qwen-Image-Edit（图）；TRELLIS（3D）；Wan2.2（视频）；以及要避开的：FLUX.1-Kontext-dev、FLUX.2-dev、MMAudio、AudioGen（非商用）、Hunyuan3D-2.1、HunyuanVideo-Foley（地区/规模限制）。只作提示，不作授权依据——授权以用户在 service 条目里写的 `license` 为准。
- `node tools/local/doctor.mjs [--config <path>] [--json]`：打印本机内存/芯片/显卡（读得到就读，读不到写「未知」），逐个探活已登记服务，按 catalog 提示「这台机器大概跑得动哪些」。零写入、零下载、零生成。

## 4. 导演 hold 得住

1. **只认导演的单**：生成入口只有 `tools/assets/run.mjs`；每次调用带 `brief.key`；产物文件名 = key；对不上 key 的产物丢弃。agent 收到的是 brief + 风格锁 + 一个临时 outDir，拿不到 manifest 路径。
2. **风格锁**：`shared/agents/stagecraft.js` 的 `dress()` 给每位导演产出 `lock = { plateKey, palette[], negative[], seedBase, voices{人物→声线档} , loudness }`，随每张单进入请求（ComfyUI 填 plate/negative/seed，openai-image 走 edits 带 plate，语音按 voices 选声线）。同一导演同一作品的 seed 由 `seedBase + key` 确定，可复现。
3. **审片**：`tools/assets/review.mjs` 的 `review(brief, file, lock, opts) → { verdict:'accept'|'redo'|'reject', why, checks:[{name, ok, value, expect, skipped?}] }`。
   - 确定性检查先跑：格式对、时长在 spec ±20%、响度在 lock.loudness ±3 LU（有 ffmpeg 才测，没有记 skipped）、图片尺寸/比例、画面平均色与 palette 的距离（有 ffmpeg 才测）。
   - 可选评审模型：配置 `critic:{ url, model }`（OpenAI 兼容的视觉对话接口），把 plate 和产物一起给它，用导演的 taste 词问「像不像同一个导演的戏」，回 0–1 分与一句理由；低于 `critic.threshold`（默认 0.6）判 redo。没配就跳过，不影响确定性检查。
   - `redo` 最多重做 `maxRedo` 次（默认 1），每次重做也过预算闸门；重做后仍不过 → `reject`，该条在 manifest 里记 `review.verdict:'reject'` 并且不算交付。
   - `quality:'draft'` 的服务产物最多算「草稿」，导演的 taste 要求正式时不能当交付（manifest `draft:true`）。
4. **留痕**：manifest 条目加 `source{service, protocol, model, license}` 与 `review{verdict, why, checks, critic?}`；`run.mjs` 在 session 账本记 `director.review`（payload：key、verdict、why）。web/assets.html 显示「导演退回：<why>」。
5. **本地服务/agent 永远不能**：写 manifest、写账本、改 brief、追加单子、选别的导演的 plate。

## 5. 验收（全部用假服务）

1. 无任何本地服务配置时，现有流程与测试（tests/audio-engine.test.js 18 例、tests/assets.test.js）不变。
2. 四种协议各有一个 loopback 假服务，能生成并落盘；探活与 doctor 能列出它们。
3. 公网地址被拒；私网地址仅在 `allowLan:true` 时放行；重定向被拒。
4. `license.commercial:false` 的服务不可用且 action 说明原因；`"unknown"` 默认不可用。
5. local-only 模式下用本地服务成功，且对外 fetch 计数为 0（loopback 之外）。
6. mcp-agent 返回 outDir 外的路径 → 丢弃并报 `provider`；多余文件被删。
7. 风格锁进入请求（假服务能读到 plate/seed/negative）；同一 key 两次 seed 相同。
8. review：时长超差 → redo；重做仍超 → reject 且不算交付；critic 低分 → redo；没 ffmpeg / 没 critic → 对应检查 skipped 而不是失败。
9. 账本里有 `director.review`，manifest 有 source 与 review。

## 6. 分工

| 任务 | 写 | 不许碰 |
|---|---|---|
| 本地协议与体检 | `tools/local/**`、`tools/audio/providers/localsvc.mjs`、`tools/assets/providers/localsvc.mjs`、engine/run 里注册这一行 | 审片逻辑、stagecraft |
| 导演审片与风格锁 | `tools/assets/review.mjs`、`shared/agents/stagecraft.js` 的 lock、`tools/assets/run.mjs` 接审片与账本、`web/assets.html` 显示审片 | tools/local 客户端内部 |
| Agent 接入与授权策略 | `tools/local/mcp.mjs`、授权过滤（`tools/local/license.mjs`，被两侧 localsvc 调用） | 其余 tools/local 客户端 |
| 测试 | `tests/workshop.test.js`（假服务） | 实现 |
