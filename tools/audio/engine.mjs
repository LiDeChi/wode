import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AudioError, normalizeError, readJSON, assertNoSecrets } from './errors.mjs';
import { ProviderRegistry } from './registry.mjs';
import { AudioBudgetManager } from './budget.mjs';
import { AudioJobManager } from './jobs.mjs';
import { VoiceRegistry } from './voices.mjs';
import { AudioAssetStore } from './store.mjs';
import { createSecrets } from './secrets.mjs';
import { pickProvider } from './router.mjs';
import { MockProvider } from './providers/mock.mjs';
import { LocalAudioAdapter } from './providers/local.mjs';
import { ElevenLabsAdapter } from './providers/elevenlabs.mjs';

const tails = new Map();
async function serial(home, work) {
  const prior = tails.get(home) || Promise.resolve();
  const next = prior.catch(()=>{}).then(async()=>{
    fs.mkdirSync(home,{recursive:true,mode:0o700});
    const lock = path.join(home,'.execution.lock'), started = Date.now();
    let fd;
    for (;;) {
      try { fd = fs.openSync(lock,'wx',0o600); fs.writeFileSync(fd,String(process.pid)); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        // 保守等待活进程；仅清理由已退出进程留下的锁。
        const pid = Number(fs.readFileSync(lock,'utf8'));
        if (pid > 0) { try { process.kill(pid,0); } catch (err) { if (err.code === 'ESRCH' && path.resolve(lock) === path.join(home,'.execution.lock')) { fs.unlinkSync(lock); continue; } } }
        if (Date.now()-started > 120000) throw new AudioError('config','音频资产库正被其他进程占用','等待正在执行的任务结束');
        await new Promise(r=>setTimeout(r,50));
      }
    }
    try { return await work(); }
    finally { fs.closeSync(fd); if (path.resolve(lock) === path.join(home,'.execution.lock')) fs.unlinkSync(lock); }
  });
  tails.set(home,next); try { return await next; } finally { if (tails.get(home) === next) tails.delete(home); }
}
function validate(capability,input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AudioError('config','音频请求必须是对象','传入 text 或 prompt 等参数');
  assertNoSecrets(input);
  const req = {...input,capability};
  if (capability === 'speech' && (typeof req.text !== 'string' || !req.text.trim())) throw new AudioError('config','语音文本为空','提供 text');
  if (['music','sfx'].includes(capability) && (typeof req.prompt !== 'string' || !req.prompt.trim())) throw new AudioError('config','生成描述为空','提供 prompt');
  if (req.duration === undefined && req.seconds !== undefined) req.duration = req.seconds;
  for (const k of ['duration','rate']) if (req[k] !== undefined && (!Number.isFinite(req[k]) || req[k] <= 0)) throw new AudioError('config',`${k} 必须大于零`,'检查请求中的数值');
  if (capability === 'clone') {
    const c = req.consent;
    if (!c || !['self','licensed'].includes(c.subject) || !['by','statement','at'].every(k=>typeof c[k]==='string' && c[k].trim()) || !Number.isFinite(Date.parse(c.at))) throw new AudioError('consent','克隆必须提供自己或已授权声音的确认','传 consent:{by,statement,at,subject:self|licensed}');
    if (typeof req.name !== 'string' || !req.name.trim()) throw new AudioError('config','克隆声线需要名称','提供 name');
    if (typeof req.audio_file !== 'string' || !fs.existsSync(req.audio_file) || !fs.statSync(req.audio_file).isFile()) throw new AudioError('config','参考录音不存在','提供有效 audio_file 路径');
    req.audio_file = path.resolve(req.audio_file);
  }
  return req;
}
export function createAudioEngine(options = {}) {
  const home = path.resolve(options.home || process.env.DW_AUDIO_HOME || path.join(os.homedir(),'.digital-world/audio'));
  const config = options.config ?? readJSON(path.join(home,'config.json'),{}); assertNoSecrets(config);
  const now = options.now || Date.now, mode = options.mode || config.mode || 'auto';
  const secretSource = options.secrets || createSecrets(), secretValues = new Set();
  const secrets = {async get(name) { const value = await secretSource.get(name); if (value) secretValues.add(String(value)); return value; }};
  const safe = value => {
    if (typeof value === 'string') { for (const key of secretValues) value = value.split(key).join('<redacted>'); return value; }
    if (Array.isArray(value)) return value.map(safe);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,safe(v)]));
    return value;
  };
  const defaultProviders = [new LocalAudioAdapter(config.local),new ElevenLabsAdapter(config.providers?.elevenlabs)];
  if (config.mock?.enabled) defaultProviders.push(new MockProvider(config.mock));
  const registry = new ProviderRegistry(home,{providers:options.providers || defaultProviders,now,sanitize:safe});
  const budget = new AudioBudgetManager(home,{...config.budget,unknownPriceCeiling:config.unknownPriceCeiling ?? config.budget?.unknownPriceCeiling},now);
  const jobs = new AudioJobManager(home,now), voices = new VoiceRegistry(home,now), store = new AudioAssetStore(home);
  const rawFetch = options.fetch || globalThis.fetch;
  const ctx = {now,secrets,registry,store,config,mode,fetch:async(url,init)=>{
    if (mode === 'local-only') throw new AudioError('local_only','本地模式拒绝网络请求','返回本地 buffer/file，探活请显式调用 probe_local');
    return rawFetch(url,init);
  }};
  async function select(req) {
    let selected;
    try { selected = await pickProvider(req.capability,req,registry,{ctx,mode,providerOrder:config.policy?.providerOrder,canAfford:estimate=>{
      if (estimate.estimated == null) return Boolean(options.authorize) && Number.isFinite(budget.unknownPriceCeiling);
      try { budget.check(estimate.estimated); return true; } catch { return false; }
    }}); }
    catch(e) { throw normalizeError(e); }
    if (req.capability === 'speech') Object.assign(req,voices.resolve(req,selected.provider.id));
    return selected;
  }
  async function execute(capability,input) {
    const req = validate(capability,input);
    return serial(home,async()=>{
      const selected = await select(req), {provider,model} = selected;
      Object.assign(req,{provider:provider.id,model});
      const estimate = {...selected.estimate,provider:provider.id,model,capability};
      const authorization = await budget.authorize(estimate,options.authorize);
      const job = jobs.create(safe({provider:provider.id,model,capability}));
      budget.reserve(job.job_id,authorization.amount,safe(estimate),authorization.source);
      const base = {job_id:job.job_id,status:'running',provider:provider.id,model,file:null,format:null,seconds:null,
        cost:{estimated:estimate.estimated ?? null,actual:null,currency:'USD',priceSource:estimate.priceSource || 'unknown'},
        license:null,meta:{prompt:req.text || req.prompt || req.name,seed:req.seed,createdAt:new Date(now()).toISOString(),why:selected.why,authorizationSource:authorization.source}};
      jobs.update(job.job_id,{status:'running'});
      let result, executed = false;
      try {
        for (let attempt=1;attempt<=2;attempt++) {
          if (jobs.get(job.job_id).status === 'cancelled') throw new AudioError('provider','任务已取消','查看 get_job 中的取消记录');
          jobs.update(job.job_id,{attempts:attempt}); executed = true;
          try { result = await provider.run(req,ctx); break; }
          catch(err) {
            const e = normalizeError(err);
            // 免费且可重试才再执行一次，绝不换服务或重复收费。
            if (attempt === 1 && estimate.estimated === 0 && e.retryable && !['budget','auth','consent','insufficient_balance','price_unknown'].includes(e.code)) { budget.check(0); continue; }
            throw e;
          }
        }
        if (!result || typeof result !== 'object') throw new AudioError('provider','Provider 没有返回结果','检查 Adapter.run');
        assertNoSecrets(result);
        const actual = result.actual ?? null;
        budget.settle(job.job_id,actual);
        const final = {...base,status:'succeeded',cost:{...base.cost,actual,priceSource:actual === null ? 'unknown' : base.cost.priceSource},license:result.license || 'provider terms',quality:result.quality || (provider.local ? 'placeholder' : 'cloud'),meta:{...base.meta,renderedModel:result.model,quality:result.quality || (provider.local ? 'placeholder' : 'cloud')}};
        if (capability === 'clone') {
          if (typeof result.voice_id !== 'string' || !result.voice_id) throw new AudioError('provider','克隆结果没有远端 Voice ID','检查 Provider 的 clone 结果');
          if (jobs.get(job.job_id).status !== 'cancelled') {
            const voice = voices.add(safe({name:req.name,audio_file:req.audio_file,consent:req.consent,providers:{[provider.id]:result.voice_id},license:final.license}));
            final.voice_id = voice.id;
          }
        } else {
          const asset = await store.persist(req,result,safe({...final,voice_id:req.voice_id}),ctx);
          Object.assign(final,{file:asset.file,format:asset.format,seconds:result.seconds ?? null,voice_id:req.voice_id});
        }
        if (jobs.get(job.job_id).status === 'cancelled') return safe({...final,status:'cancelled'});
        final.status = 'succeeded'; const clean = safe(final); jobs.update(job.job_id,{status:'succeeded',result:clean}); return clean;
      } catch(err) {
        const error = safe(normalizeError(err).toJSON());
        // 执行请求可能已收费：保留预留，不能把失败当免费。
        if (!executed) budget.settle(job.job_id,null,{release:true});
        const final = safe({...base,status:jobs.get(job.job_id).status === 'cancelled' ? 'cancelled' : 'failed',error});
        if (final.status === 'failed') jobs.update(job.job_id,{status:'failed',result:final,error});
        return final;
      }
    });
  }
  return {
    generate_speech:input=>execute('speech',input), generate_music:input=>execute('music',input), generate_sfx:input=>execute('sfx',input), clone_voice:input=>execute('clone',input),
    async transcribe() { throw new AudioError('config','还没有接 STT','P2 接入语音识别 Provider 后再使用'); },
    async estimate(capability,input) { const req = validate(capability,input), s = await select(req); return safe({...s.estimate,provider:s.provider.id,model:s.model,why:s.why}); },
    async list_voices() { return voices.list(); },
    async list_models(capability) { return registry.list(capability,ctx,mode === 'local-only' ? registry.adapters().filter(p=>p.local && ['local','mock'].includes(p.id)) : registry.adapters()); },
    async get_job(id) { return jobs.get(id); }, async get_usage() { return budget.get_usage(); },
    async get_asset(key) { return store.get(key); }, async remove_voice(id) { return voices.remove(id); },
    async probe_local() { const p = registry.get('local'); if (!p?.probe) return []; return p.probe({...ctx,fetch:async(url,init)=>rawFetch(url,{...init,redirect:'error'})}); },
    async cancel_job(id) {
      const job = jobs.get(id); if (!job) throw new AudioError('config','找不到任务','提供有效 job_id');
      if (!['queued','running'].includes(job.status)) return job;
      jobs.update(id,{status:'cancelled'});
      const p = registry.get(job.provider); if (p?.cancel) { try { await p.cancel(job,ctx); } catch { /* 取消记录仍然保留，费用预留不退 */ } }
      return jobs.get(id);
    },
    registry,voices,store,budget,jobs,home,mode,
  };
}
