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

Mock 支持 speech/music/sfx/clone，输出确定性短 wav，可编排价格、delay、failures 与错误。Local 复用 say 的实际发声检查与 ffmpeg 合成，music/sfx quality:'placeholder'；服务探活只接受 loopback URL，Qwen3-TTS/ACE-Step/Stable Audio 的生成待 P2。ElevenLabs 为可选 BYOK 直连 speech/music/sfx（价格不猜，必须配置或确认）。Monid/fal 将由独立适配器接入；STT/streaming/audio-to-audio/OAuth 未实现。

克隆只能 consent.subject=self|licensed 且 by/statement/at 完整；参考录音会发送给所选云端，云端保存期限按服务政策；本地只保留路径和授权。remove_voice 删除本地身份/映射并返回到供应商删除远端 Voice ID 的提示，不替用户静默删云数据。
