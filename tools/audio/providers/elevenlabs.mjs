import { AudioError, httpError } from '../errors.mjs';
export class ElevenLabsAdapter {
  constructor(options = {}) { this.id = 'elevenlabs'; this.local = false; this.options = options; }
  options(ctx) { return {...this.options,...ctx.config.providers?.[this.id]}; }
  async available(req,ctx) { return {ok:Boolean(await ctx.secrets.get('ELEVENLABS_API_KEY')),action:'在钥匙串或环境变量设置 ELEVENLABS_API_KEY'}; }
  async capabilities(ctx) { const o = this.options(ctx); return [{capability:'speech',model:o.model || 'eleven_multilingual_v2',quality:'cloud',license:'ElevenLabs terms'},...['music','sfx'].map(capability=>({capability,model:`elevenlabs/${capability}`,quality:'cloud',license:'ElevenLabs terms'}))]; }
  async estimate(req,ctx) { const price = this.options(ctx).priceOverride; const estimated = typeof price === 'number' ? price : price?.[req.capability] ?? null; return {estimated,currency:'USD',priceSource:estimated === null ? 'unknown' : 'user-priceOverride'}; }
  async run(req,ctx) {
    const o = this.options(ctx), key = await ctx.secrets.get('ELEVENLABS_API_KEY');
    if (!key) throw new AudioError('auth','没有 ElevenLabs 密钥','配置 ELEVENLABS_API_KEY');
    const base = (o.base || 'https://api.elevenlabs.io').replace(/\/+$/,''), voice = req.provider_voice_id || o.voices?.[req.voice_id] || o.defaultVoice || '21m00Tcm4TlvDq8ikWAM';
    let endpoint, body;
    if (req.capability === 'speech') { endpoint = `/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`; body = {text:req.text,model_id:req.model,voice_settings:{stability:0.5,similarity_boost:0.75,style:0,use_speaker_boost:true}}; }
    else if (req.capability === 'sfx') { endpoint = '/v1/sound-generation'; body = {text:req.prompt,duration_seconds:Math.max(0.5,Math.min(22,req.duration || 2)),prompt_influence:req.intensity ?? 0.5}; }
    else if (req.capability === 'music') { endpoint = '/v1/music?output_format=mp3_44100_128'; body = {prompt:req.prompt,music_length_ms:Math.max(10000,Math.min(300000,Math.round((req.duration || 30)*1000)))}; }
    else throw new AudioError('config','ElevenLabs Adapter 暂未接克隆','选择 fal 的 clone 模型');
    let r;
    try { r = await ctx.fetch(`${base}${endpoint}`,{method:'POST',headers:{'xi-api-key':key,'content-type':'application/json',accept:'audio/mpeg'},body:JSON.stringify(body),signal:AbortSignal.timeout(o.timeoutMs || 120000)}); }
    catch { throw new AudioError('network','ElevenLabs 网络请求失败','检查网络后手动重试',true); }
    if (!r.ok) throw httpError(r.status);
    return {buffer:Buffer.from(await r.arrayBuffer()),format:'mp3',seconds:req.duration ?? null,actual:null,quality:'cloud',license:'ElevenLabs terms'};
  }
}
export default ElevenLabsAdapter;
