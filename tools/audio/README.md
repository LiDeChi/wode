# AudioEngine

零依赖 Node ≥22 音频工具；契约见 docs/AUDIO.md。默认 home 为 ~/.digital-world/audio，DW_AUDIO_HOME 可覆盖。业务接口从 engine.mjs 导入 createAudioEngine，配置从 <home>/config.json 读取，也可传 config。

## Provider 接入说明（固定接口）

Adapter 是对象或类实例：

```js
{
  id: 'provider-id',
  local: false, // local-only 只允许 local:true 且 id 为 local 或 mock
  async capabilities(ctx) {
    return [{ capability:'speech', model:'model-id', quality:'cloud', license:'provider terms' }];
  },
  async available(req, ctx) { return { ok:true, action:'如何配置' }; },
  async estimate(req, ctx) {
    return { estimated:null, currency:'USD', priceSource:'unknown' };
  },
  async run(req, ctx) {
    return { buffer:Buffer.from(/* audio */), format:'mp3', seconds:2,
      actual:null, voice_id:undefined, license:'provider terms', quality:'cloud' };
  },
  // 可选 async poll(job,ctx), async cancel(job,ctx)
}
```

capability = speech | music | sfx | clone；transcribe 为 P2 留位，目前 engine 抛 config「还没有接 STT」。每个能力可注册任意多个 Provider 和模型；不固定只能一个服务。

req 为已校验的纯数据，含 capability、provider、model 和用户参数：text、prompt、duration、voice_id（引擎本地身份）、provider_voice_id（该 Provider 的映射）、language、emotion、rate、pause、bpm、intensity、instrumental、lyrics、seed；clone 有 audio_file、name、consent。req 不携带 key。available 不发付费请求；capabilities 可以发现模型（local-only 不会触及云 Adapter）。estimate 不执行生成，价格未知必须返回 estimated:null / priceSource:'unknown'，由 engine 决定是否得到明确授权。

ctx = {fetch, now, secrets, registry, store, config, mode}。now() 返回时间戳毫秒；secrets 只暴露 async get(name) 读口（变量名，如 FAL_KEY）；fetch 可注入计数/模拟响应，Adapter 所有 HTTP 都经它。ctx.registry.upsert(provider, models) 缓存发现结果（来源和时间）；ctx.config.providers[id] 存 Provider 配置。

run 可以返回 buffer、file 或 url 三者之一；engine 会立即将云结果下载并复制到资产库，旁边写元数据，不持久化临时 URL。clone 返回 voice_id（远端 ID），可不带音频，engine 会分配稳定本地 Voice ID 并保存 consent/Provider 映射。实际费未知返回 actual:null；数值实际费必须美元且非负。Adapter 不输出凭据、headers 或原始服务响应体。HTTP 错误用 errors.mjs 的 httpError；其他外部异常由 engine 隐去原文。异步服务的 run 应自行轮询到终态；poll/cancel 为可选的恢复/取消辅助方法。

## 调用与模式

```js
const audio = createAudioEngine({home:'/tmp/audio-demo', mode:'local-only'});
const result = await audio.generate_speech({text:'风起。'});
console.log(result.file, result.job_id);
```

local-only 只允许 local/mock，零云请求；auto 本地优先，请求 quality:'cloud' 时挑云端；cloud-quality 只用云端；manual 必须 provider+model。失败不自动换 Provider。仅本地或费用为零的 retryable 错误重试一次；收费/价格未知任务不自动重复付费。

Validate → Estimate → Authorize → Execute → Persist → Report。价格已知且预算足够默认授权；未知必须 authorize 钩子确认。预算 perCall/daily/monthly 都是硬上限，确认不越过预算。未知收费需配置 unknownPriceCeiling（最大预留美元），否则即使确认也拒绝，防止无法计量的任务绕过预算。usage 记录实际值；未知实际值保守按预留计账。预留在执行前落盘，重启不会把未结任务当成免费。可配置价格 provider.priceOverride 数值或 capability→数值对象，来源标为用户配置。

job 状态 queued→running→succeeded|failed|cancelled；所有状态和结果持久化。生成校验/路由/授权失败抛 AudioError；执行后失败返回 status:'failed' 和标准 error。get_job(id) 可查已成功或失败任务；list_voices、list_models、get_usage、remove_voice 和 cancel_job 可用。取消正在付费执行的任务会保持预留，云端能否真正停止由 Provider 决定。

## 配置和钥匙

复制 audio.example.json 的非敏感配置到 <home>/config.json。Key 只走 macOS 钥匙串 digital-world-audio，账户名为 MONID_API_KEY / FAL_KEY / ELEVENLABS_API_KEY；其次读环境变量，不读取 .env。CLI key set NAME 从标准输入读取（避免 key 出现在命令行参数）。密钥不可放请求/config；不记录请求 headers、认证响应或外部错误原文。

```sh
node tools/audio/cli.mjs speech --text '风起。' --mode local-only
node tools/audio/cli.mjs music --prompt '沉稳节拍' --duration 4 --provider mock
node tools/audio/cli.mjs voices
node tools/audio/cli.mjs usage
node tools/audio/cli.mjs job JOB_ID
```

CLI 也支持 sfx、clone --audio-file PATH --name NAME --consent-json JSON、models、config、key has NAME / key set NAME；--dry 只估价，不生成。输出统一 JSON。

## 当前能力和限制

Mock 支持 speech/music/sfx/clone，输出确定性短 wav，可编排价格、delay、failures 与错误。Local 复用 say 的实际发声检查与 ffmpeg 合成，music/sfx quality:'placeholder'；服务探活只接受 loopback URL，Qwen3-TTS/ACE-Step/Stable Audio 的生成待 P2。ElevenLabs 为可选 BYOK 直连 speech/music/sfx（价格不猜，必须配置或确认）。Monid/fal 已接入（见下文）；STT/streaming/audio-to-audio/OAuth 未实现。

克隆只能 consent.subject=self|licensed 且 by/statement/at 完整；参考录音会发送给所选云端，云端保存期限按服务政策；本地只保留路径和授权。remove_voice 删除本地身份/映射并返回到供应商删除远端 Voice ID 的提示，不替用户静默删云数据。

## Monid 接入

设置 MONID_API_KEY 后可直接使用默认 engine 或 CLI。Adapter 向 /v1/discover 查询 ElevenLabs TTS、多角色语音、音效、音乐和 MiniMax Music，再用 /v1/inspect 读取真实 schema/价格；不拼音频端点。默认优先 ElevenLabs/MiniMax，仅接受发现结果中能确认为该能力的描述与 schema。完整结果带 discoveredAt、priceSource 缓存到 home/registry.json，默认24小时有效（cacheTtlMs 可改）。官方快照见 docs/vendor/monid/ 和 live/；旧式 inputSchema 及真实 input.body 均支持，真实 run 入参使用 input:{body:{...}}。

PER_UNIT_MATRIX 的 selectors 从 body 取值并选择 variant，每个 variant 都在 list_models 中单独出现，例如 `elevenlabs:/text-to-speech#eleven_flash_v2_5`。按 schema 的默认值、req text/prompt/duration 等构造 body，检查必填、类型、枚举、范围和长度；多角色完整 inputs 可写 providers.monid.inputs[model]。已验证的定价类型为 PER_CALL、按字符/秒的 PER_UNIT，以及上述矩阵；算不出单位数量就返回未知价。价格来自 inspect 并记录时间，不把快照数字写死进适配器。sfx 的 duration 秒映射 duration_seconds，music 映射 music_length_ms；TTS 模型与 voice_id 默认值来自 inspect。

```js
const audio = createAudioEngine({mode:'cloud-quality'});
const models = await audio.list_models('speech'); // 得到 model 后可明确选择
await audio.generate_speech({text:'风起。',provider:'monid',model:models.find(m=>m.model.endsWith('#eleven_flash_v2_5')).model});
await audio.generate_sfx({prompt:'木门缓缓打开',duration:3,provider:'monid'});
await audio.generate_music({prompt:'古琴与笛子，安静的纯音乐',duration:3,instrumental:true,provider:'monid'});
```

run 处理同步200与202轮询，COMPLETED 后仍检查 providerResponse.httpStatus；401/402/408/429 分别为 auth/insufficient_balance/network/rate_limit。音频 download_link/CDN URL 立即无认证下载成 buffer，已文档化的 audio_base64 也可解码；签名链接不保存。实际费用取 cost.value 或 billing.actualCost 的 MICRO_DOLLAR（换算美元），没账单就 actual:null。get_usage 在非 local-only 且可用时加 wallet；读余额失败返回 wallet:null 与 walletReason。Monid 快照没有取消接口，超时后保留 runId 以便人工核对，绝不猜取消 URL 或重新提交。

## fal.ai 接入

设置 FAL_KEY；默认模型为 speech-2.8-turbo（另有hd）、voice-clone、minimax/music-3、stable-audio-3/small/sfx/text-to-audio。完整 id 来自 docs/AUDIO.md §4，所有发出的字段来自 docs/vendor/fal/ 快照。speech 用 prompt、voice_setting、audio_setting 和 output_format:url；rate 是0.5–2倍速，emotion 使用快照枚举。music 必须传 lyrics，纯音乐可传 instrumental:true（转换为文档支持的 `[instrumental]` 标签），duration 是秒；sfx 用 prompt/duration/seed。

请求统一使用官方 queue.fal.run，POST提交、status_url轮询、response_url取结果、PUT cancel_url取消。附 X-Fal-No-Retry:1 禁止供应商默认重试；不自动重复收费。超时请求取消后报 network，正在执行的任务仍可能完成或收费。队列 URL 必须是官方 HTTPS 主机，拒绝向其他主机或重定向发送 Key；文件下载不带认证。默认 timeoutMs=180000、pollIntervalMs=1000，可在 providers.fal 配置。engine 对 run 额外注入 ctx.job_id/ctx.jobs，让适配器持久化远端队列标识；重启后 get_job 可定位任务，cancel_job 能用保存的 remote 取消；不会自动续跑未完成付费任务。

官方快照没有可靠价格端点，所以 estimated:null。可在 providers.fal.priceOverride 填核实过的单次美元估价（数字，或 model/capability→数字）；actual 始终 null，账单须到控制台核对。不确认未知价格就停止；确认仍需 unknownPriceCeiling 及预算。克隆使用官方支持的 data URI 上传本地已授权录音，或请求 reference_url 提供公开 HTTPS 录音；不增加第三方上传服务。参考录音需至少10秒，本工具上限20MiB；10秒限制由供应商验证。返回 custom_voice_id 存为本地身份的 fal 映射，之后 generate_speech({voice_id:本地ID,provider:'fal'}) 复用。MiniMax 要求克隆后7天内至少调用一次TTS才能长期保留声线，脚本不会偷偷执行这笔调用。

## 端到端脚本

`node tools/audio/e2e.mjs` 无 Key 时打印钥匙串与 config 配法并退出0。有 Key 时只选择 Monid/fal 中能算出可靠单次价格的模型：默认短中文、3秒音效、3秒纯音乐各一条，先打印完整估算和总价/余额，总价须≤$0.50并满足现有预算；无法读 Monid 余额不执行 Monid。只跑最便宜的一条/能力，失败立即停，不改预算、不升级Provider、不重复生成。fal 缺价格配置就打印跳过提示，不擅自授权。输出估算/实际费用（未知记null）、本地文件路径，clone 只在 config.e2e.clone 给了录音与 consent 时执行。真实付费验收由负责人运行；开发自查只注入假 fetch/假 secrets。例子：Monid flash 的3字语音估算$0.00012，3秒音效$0.006，3秒音乐$0.0075，总价$0.01362；这些数字只是当前官方快照的复验例子，脚本始终用实时inspect或有效缓存。

