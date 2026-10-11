import fs from 'node:fs';
import path from 'node:path';
import { AudioError, httpError } from '../errors.mjs';
const models=[['speech','fal-ai/minimax/speech-2.8-turbo'],['speech','fal-ai/minimax/speech-2.8-hd'],['clone','fal-ai/minimax/voice-clone'],['music','minimax/music-3'],['sfx','fal-ai/stable-audio-3/small/sfx/text-to-audio']];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function queueURL(value) {
  let u; try { u=new URL(value); } catch { throw new AudioError('provider','fal 没有有效队列 URL','检查提交结果'); }
  if (u.origin !== 'https://queue.fal.run' || u.username || u.password) throw new AudioError('provider','fal 队列 URL 不属于官方服务','检查提交结果，拒绝向其他主机发送 Key');
  return u.href;
}
export class FalAdapter {
  constructor(options={}) { this.id='fal';this.local=false;this.options=options;this.active=new Map(); }
  config(ctx) { return {...(ctx.config?.providers?.fal || {}),...this.options}; }
  async available(req,ctx) { return {ok:this.config(ctx).enabled !== false && Boolean(await ctx.secrets.get('FAL_KEY')),action:'把 FAL_KEY 放入 digital-world-audio 钥匙串或环境变量'}; }
  async capabilities(ctx) { return models.map(([capability,model])=>({capability,model,quality:'cloud',license:'fal 与模型供应商条款',priceSource:'unknown',discoveredAt:new Date(ctx.now()).toISOString()})); }
  input(req,ctx) {
    const cfg=this.config(ctx);
    if (!models.some(([c,m])=>c===req.capability && m===req.model)) throw new AudioError('config','fal model 与能力不匹配','选择 list_models 返回的模型');
    if (req.capability==='speech') {
      const voice_setting={};
      if (req.provider_voice_id || cfg.voiceId) voice_setting.voice_id=req.provider_voice_id || cfg.voiceId;
      if (req.rate !== undefined) { if(req.rate<.5 || req.rate>2) throw new AudioError('config','fal 语速范围为 0.5–2','使用 fal 的 speed 比例'); voice_setting.speed=req.rate; }
      if (req.emotion) { if(!['happy','sad','angry','fearful','disgusted','surprised','neutral'].includes(req.emotion)) throw new AudioError('config','fal emotion 无效','使用文档给出的情绪枚举');voice_setting.emotion=req.emotion; }
      const input={prompt:req.text,output_format:'url',audio_setting:{format:'mp3'},voice_setting};
      if (req.language) input.language_boost=({zh:'Chinese',en:'English','zh-CN':'Chinese'}[req.language] || req.language);
      return input;
    }
    if (req.capability==='music') {
      if (!req.instrumental && !req.lyrics) throw new AudioError('config','MiniMax Music 3 需要 lyrics','传 lyrics，纯音乐传 instrumental:true');
      return {prompt:req.prompt,lyrics:req.lyrics || '[instrumental]',...(req.duration !== undefined ? {duration:req.duration}:{}),...(req.seed !== undefined ? {seed:req.seed}:{})};
    }
    if (req.capability==='sfx') return {prompt:req.prompt,output_format:'mp3',...(req.duration !== undefined ? {duration:req.duration}:{}),...(req.seed !== undefined ? {seed:req.seed}:{})};
    // 官方 Files 章节明确支持 Base64 data URI；无需 SDK 或臆造上传 API。
    const types={wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',flac:'audio/flac',ogg:'audio/ogg'};
    const mime=types[path.extname(req.audio_file).slice(1).toLowerCase()];
    if (!mime) throw new AudioError('config','fal 克隆参考录音格式不支持','提供至少10秒的 wav/mp3/m4a/flac/ogg');
    if (fs.statSync(req.audio_file).size>20*1024*1024) throw new AudioError('config','参考录音超过本工具20MiB上限','提供更短的已授权录音');
    if (req.reference_url && !/^https:\/\//.test(req.reference_url)) throw new AudioError('config','reference_url 必须是 HTTPS','提供公开的已授权录音 URL');
    return {audio_url:req.reference_url || `data:${mime};base64,${fs.readFileSync(req.audio_file).toString('base64')}`,text:req.text || '风起。',model:'speech-02-turbo'};
  }
  async estimate(req,ctx) {
    this.input(req,ctx);
    const cfg=this.config(ctx), value=typeof cfg.priceOverride==='number' ? cfg.priceOverride:cfg.priceOverride?.[req.model] ?? cfg.priceOverride?.[req.capability];
    // 官方快照没有实时美元报价：不猜、不把估价当实际账单。
    return {estimated:Number.isFinite(value) && value>=0 ? value:null,currency:'USD',priceSource:Number.isFinite(value) && value>=0 ? 'config/priceOverride':'unknown'};
  }
  async request(url,method,body,ctx,timeout) {
    const key=await ctx.secrets.get('FAL_KEY');if (!key) throw new AudioError('config','没有 fal Key','设置 FAL_KEY');
    let r;try { r=await ctx.fetch(queueURL(url),{method,headers:{Authorization:`Key ${key}`,'Content-Type':'application/json','X-Fal-No-Retry':'1'},body:body===undefined ? undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(timeout || this.config(ctx).requestTimeoutMs || 30000)}); }
    catch(err) { if (err instanceof AudioError) throw err;throw new AudioError('network','fal 网络请求失败或超时','查看队列记录，勿重复提交付费任务',true); }
    if (!r.ok) throw httpError(r.status);
    try { return await r.json(); } catch { throw new AudioError('provider','fal JSON 返回无效','检查服务状态'); }
  }
  async poll(job,ctx) { return this.request(job.status_url,'GET',undefined,ctx); }
  async cancel(job,ctx) {
    const remote=job.remote || (job.cancel_url ? job:this.active.get(job.job_id));
    if (!remote?.cancel_url) return {cancelled:false,action:'没有活动的 fal 队列记录'};
    return this.request(remote.cancel_url,'PUT',undefined,ctx);
  }
  async run(req,ctx) {
    const cfg=this.config(ctx), start=ctx.now(), deadline=cfg.timeoutMs ?? 180000;
    const submitted=await this.request(`https://queue.fal.run/${req.model}`,'POST',this.input(req,ctx),ctx);
    if (!submitted.request_id) throw new AudioError('provider','fal 提交没有 request_id','检查队列服务');
    for(const k of ['status_url','response_url','cancel_url']) queueURL(submitted[k]);
    const remote={request_id:submitted.request_id,status_url:submitted.status_url,response_url:submitted.response_url,cancel_url:submitted.cancel_url};
    const token=ctx.job_id || `${req.model}:${submitted.request_id}`;this.active.set(token,remote);
    if (ctx.job_id && ctx.jobs) ctx.jobs.update(ctx.job_id,{remote});
    try {
      for(let n=0;;n++) {
        if (ctx.job_id && ctx.jobs?.get(ctx.job_id)?.status==='cancelled') throw new AudioError('provider','fal 任务已取消','查看队列记录确认是否停止');
        if(ctx.now()-start>=deadline || n>=(cfg.maxPolls ?? 180)) {
          try { await this.cancel(submitted,ctx); } catch { /* 超时仍报告，取消不保证已运行任务停止 */ }
          throw new AudioError('network','fal 任务超时，已请求取消','用 fal 控制台核对结果和账单；取消可能赶不上正在运行的任务',true);
        }
        const state=await this.poll(submitted,ctx);
        if (state.status==='COMPLETED') {
          if(state.error) throw new AudioError('provider','fal 队列任务失败','查看 fal 队列记录；没有自动重试');
          break;
        }
        if (!['IN_QUEUE','IN_PROGRESS'].includes(state.status)) throw new AudioError('provider','fal 返回未知队列状态','查看 fal 队列记录');
        await sleep(cfg.pollIntervalMs ?? 1000);
      }
      const result=await this.request(submitted.response_url,'GET',undefined,ctx);
      if (req.capability==='clone') {
        if (!result.custom_voice_id) throw new AudioError('provider','fal 克隆没有 custom_voice_id','检查克隆输出');
        return {voice_id:result.custom_voice_id,actual:null,license:'MiniMax 声音克隆条款',quality:'cloud',model:req.model};
      }
      const url=result.audio?.url;if (!url || !/^https:\/\//.test(url)) throw new AudioError('provider','fal 没有返回 HTTPS audio.url','检查模型输出');
      let media;try { media=await ctx.fetch(url,{redirect:'error',signal:AbortSignal.timeout(cfg.requestTimeoutMs || 60000)}); } catch { throw new AudioError('network','fal 音频下载失败','重新查看队列响应中的文件链接'); }
      if (!media.ok) throw httpError(media.status);
      return {buffer:Buffer.from(await media.arrayBuffer()),format:req.capability==='music' ? 'wav':'mp3',seconds:req.capability==='speech' ? (result.duration_ms===undefined ? null:result.duration_ms/1000):req.capability==='music' ? result.duration ?? null:req.duration ?? null,actual:null,license:'fal 与模型供应商条款',quality:'cloud',model:req.model};
    } catch(err) {
      if (err.code==='network' && !err.message.includes('已请求取消')) { try { await this.cancel(submitted,ctx); } catch {} }
      throw err;
    } finally { this.active.delete(token); }
  }
}
export default FalAdapter;
