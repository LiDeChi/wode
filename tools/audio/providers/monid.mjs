import { AudioError, httpError } from '../errors.mjs';

const queries = [
  ['speech','elevenlabs text to speech'], ['speech','elevenlabs multi character dialogue speech'],
  ['sfx','elevenlabs sound effects generation'], ['music','elevenlabs music generation'], ['music','minimax music'],
];
const base = 'https://api.monid.ai';
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const formats = { 'audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/flac':'flac','audio/ogg':'ogg','audio/mp4':'m4a','audio/aac':'aac' };
function pick(object, dotted) { return dotted.split('.').reduce((v,k)=>v?.[k],object); }
function urls(value) {
  if (typeof value === 'string') { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? [u.href] : []; } catch { return []; } }
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(urls);
}
function validateSchema(value,schema,label='input') {
  const fail=()=>{throw new AudioError('config',`Monid ${label} 不符合已发现的 schema`,'查看 registry.json 的类型、枚举和长度/范围；修正 providers.monid.inputs');};
  if (schema.type==='object') { if (!value || typeof value!=='object' || Array.isArray(value)) fail(); for(const k of schema.required || []) if(value[k]===undefined) fail();for(const [k,v] of Object.entries(value)) { if(schema.additionalProperties===false && !Object.hasOwn(schema.properties || {},k)) fail();if(schema.properties?.[k]) validateSchema(v,schema.properties[k],`${label}.${k}`); } }
  if (schema.type==='array') { if(!Array.isArray(value)) fail();if(schema.minItems!==undefined && value.length<schema.minItems || schema.maxItems!==undefined && value.length>schema.maxItems) fail();if(schema.items) value.forEach((v,i)=>validateSchema(v,schema.items,`${label}.${i}`)); }
  if (schema.type==='string') { if(typeof value!=='string') fail();if(schema.minLength!==undefined && value.length<schema.minLength || schema.maxLength!==undefined && value.length>schema.maxLength) fail(); }
  if (['number','integer'].includes(schema.type)) { if(!Number.isFinite(value) || schema.type==='integer' && !Number.isInteger(value)) fail();if(schema.minimum!==undefined && value<schema.minimum || schema.maximum!==undefined && value>schema.maximum) fail(); }
  if(schema.type==='boolean' && typeof value!=='boolean') fail();
  if(schema.enum && !schema.enum.includes(value) || schema.const!==undefined && value!==schema.const) fail();
}
function cost(data) {
  if (data.cost?.currency === 'USD' && Number.isFinite(data.cost.value)) return data.cost.value;
  const actual = data.billing?.actualCost;
  return actual?.currency === 'USD' && actual.unit === 'MICRO_DOLLAR' && Number.isFinite(actual.value) ? actual.value/1e6 : null;
}
export class MonidAdapter {
  constructor(options = {}) { this.id='monid'; this.local=false; this.options=options; }
  config(ctx) { return {...(ctx.config?.providers?.monid || {}),...this.options}; }
  async available(req,ctx) { return {ok:this.config(ctx).enabled !== false && Boolean(await ctx.secrets.get('MONID_API_KEY')),action:'把 MONID_API_KEY 放进 digital-world-audio 钥匙串或环境变量'}; }
  async request(route,body,ctx,timeout) {
    const key = await ctx.secrets.get('MONID_API_KEY');
    if (!key) throw new AudioError('config','没有 Monid Key','设置 MONID_API_KEY');
    let r;
    try { r = await ctx.fetch(base+route,{method:body === undefined ? 'GET':'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:body === undefined ? undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(timeout || this.config(ctx).requestTimeoutMs || 30000)}); }
    catch { throw new AudioError('network','Monid 网络请求失败或超时','检查网络；不要重复提交已收费任务',true); }
    if (!r.ok) throw httpError(r.status);
    try { return {status:r.status,data:await r.json()}; } catch { throw new AudioError('provider','Monid 返回的 JSON 无效','检查服务状态'); }
  }
  async capabilities(ctx) {
    const cfg=this.config(ctx), cached=ctx.registry.cached(this.id), ttl=cfg.cacheTtlMs ?? 86400000;
    if (cached.length && cached.every(m=>Number.isFinite(Date.parse(m.discoveredAt)) && ctx.now()-Date.parse(m.discoveredAt)<ttl)) return cached;
    const rows=[];
    for (const [capability,query] of queries) {
      const {data}=await this.request('/v1/discover',{query,limit:cfg.discoveryLimit || 2},ctx);
      const candidates=(data.results || []).filter(v=>typeof v.provider === 'string' && typeof v.endpoint === 'string' && ['elevenlabs','minimax'].includes(v.provider));
      candidates.sort((a,b)=>(Number(a.provider!=='elevenlabs')-Number(b.provider!=='elevenlabs')) || ((a.price?.amount?.value ?? a.price?.amount ?? Infinity)-(b.price?.amount?.value ?? b.price?.amount ?? Infinity)));
      for (const c of candidates) {
        const model=`${c.provider}:${c.endpoint}`;
        if (rows.some(m=>m.model===model || m.model.startsWith(model+'#'))) continue;
        const inspected=(await this.request('/v1/inspect',{provider:c.provider,endpoint:c.endpoint},ctx)).data;
        const description=[inspected.description,...(inspected.categories || [])].join(' ').toLowerCase();
        const detected=/sound effect|foley/.test(description) ? 'sfx':/music|song/.test(description) ? 'music':/speech|dialogue/.test(description) && !/transcrib|speech.to.text|speech.to.speech/.test(description) ? 'speech':null;
        if(detected!==capability) continue;
        const schema=inspected.inputSchema || inspected.input?.body;
        if (!schema || typeof schema !== 'object') continue;
        const properties=schema.properties || {};
        if (!(capability==='speech' ? ['text','prompt','inputs']:['text','prompt']).some(k=>Object.hasOwn(properties,k))) continue;
        const rawPrice=inspected.price || c.price || null;
        const price=rawPrice?.selectors ? {...rawPrice,selectors:rawPrice.selectors.map(({key,...s})=>({...s,field:key}))}:rawPrice;
        const row={capability,model,quality:'cloud',license:'Monid 与原供应商条款',upstreamProvider:c.provider,endpoint:c.endpoint,schema,wrappedInput:Boolean(inspected.input?.body),price,priceSource:'monid/inspect',discoveredAt:new Date(ctx.now()).toISOString(),docUrl:inspected.docUrl || null};
        if (row.price?.type==='PER_UNIT_MATRIX') {
          for (const variant of row.price.variants || []) rows.push({...row,model:`${model}#${Object.values(variant.when || {}).join(',')}`,variant:variant.when});
        } else rows.push(row);
      }
    }
    // 精确 schema/price 一起缓存；端点名只来自 discover，绝不从模型名拼接。
    return ctx.registry.upsert(this.id,rows);
  }
  async descriptor(req,ctx) {
    const rows=await this.capabilities(ctx), row=rows.find(m=>m.model===req.model && m.capability===req.capability);
    if (!row) throw new AudioError('config','Monid 没有这个已发现的音频模型','运行 models 刷新发现结果后选择 model');
    return row;
  }
  input(req,row,ctx) {
    const cfg=this.config(ctx), properties=row.schema.properties || {}, supplied=cfg.inputs?.[row.model] || cfg.inputs?.[req.capability] || {}, input={...supplied,...row.variant};
    const values={text:req.text || req.prompt,prompt:req.prompt || req.text,duration:req.duration,duration_seconds:req.duration,duration_ms:req.duration === undefined ? undefined:req.duration*1000,music_length_ms:req.duration === undefined ? undefined:Math.round(req.duration*1000),seed:req.seed,lyrics:req.lyrics,instrumental:req.instrumental,force_instrumental:req.instrumental,is_instrumental:req.instrumental,voice_id:req.provider_voice_id || supplied.voice_id || cfg.voiceId};
    for (const [name,schema] of Object.entries(properties)) {
      if (input[name] === undefined && values[name] !== undefined) input[name]=values[name];
      if (input[name] === undefined && schema.default !== undefined) input[name]=schema.default;
    }
    if (row.schema.additionalProperties === false && Object.keys(input).some(k=>!Object.hasOwn(properties,k))) throw new AudioError('config','Monid input 有 schema 不接受的字段','按 registry.json 中的 schema 配置 providers.monid.inputs');
    for (const name of row.schema.required || []) if (input[name] === undefined) throw new AudioError('config',`Monid input 缺少必填字段 ${name}`,'按 registry.json 中的 schema 填 providers.monid.inputs[model]，多角色语音需提供完整对话结构');
    validateSchema(input,row.schema);
    return input;
  }
  async estimate(req,ctx) {
    const row=await this.descriptor(req,ctx), body=this.input(req,row,ctx);
    const cfg=this.config(ctx), override=typeof cfg.priceOverride === 'number' ? cfg.priceOverride:cfg.priceOverride?.[row.model] ?? cfg.priceOverride?.[req.capability];
    let estimated=Number.isFinite(override) && override>=0 ? override:null;
    let priceSource=estimated === null ? 'unknown':'config/priceOverride';
    let price=row.price;
    if(price?.type==='PER_UNIT_MATRIX') {
      const selectors=price.selectors || [];
      price=selectors.every(s=>s.in==='body' && body[s.field]!==undefined) ? price.variants?.find(v=>selectors.every(s=>v.when?.[s.field]===body[s.field]))?.price:null;
    }
    const amount=typeof price?.amount==='number' ? price.amount:price?.amount?.value, currency=price?.currency || price?.amount?.currency;
    if(estimated===null && currency==='USD' && Number.isFinite(amount) && amount>=0) {
      if(price.type==='PER_CALL') estimated=amount;
      if(price.type==='PER_UNIT' && price.per>0) {
        const quantity=price.unit==='character' ? (typeof body.text==='string' ? Array.from(body.text).length:Array.isArray(body.inputs) ? body.inputs.reduce((n,v)=>n+Array.from(v.text || '').length,0):null):price.unit==='second' ? body.duration_seconds ?? (body.music_length_ms===undefined ? null:body.music_length_ms/1000):null;
        if(Number.isFinite(quantity) && quantity>=0) estimated=amount*quantity/price.per;
      }
      if(estimated!==null) priceSource=row.priceSource;
    }
    return {estimated:estimated===null ? null:Number(estimated.toFixed(12)),currency:'USD',priceSource,pricedAt:row.discoveredAt};
  }
  async poll(job,ctx) { return (await this.request(`/v1/runs/${encodeURIComponent(job.runId)}`,undefined,ctx)).data; }
  async wallet(ctx) { const data=(await this.request('/v1/wallet/balance',undefined,ctx)).data; return {balance:data.balance?.currency === 'USD' ? data.balance.value:null,currency:'USD'}; }
  async run(req,ctx) {
    const row=await this.descriptor(req,ctx), cfg=this.config(ctx), start=ctx.now(), timeout=cfg.timeoutMs ?? 180000;
    const body=this.input(req,row,ctx);
    let {status,data}=await this.request('/v1/run',{provider:row.upstreamProvider,endpoint:row.endpoint,input:row.wrappedInput ? {body}:body},ctx,timeout);
    if(ctx.job_id && ctx.jobs && data.runId) ctx.jobs.update(ctx.job_id,{remote:{runId:data.runId}});
    if (status === 202) {
      if (typeof data.runId !== 'string' || !data.runId) throw new AudioError('provider','Monid 202 没有 runId','检查 Monid 返回格式');
      const runId=data.runId;
      for (let n=0;!['COMPLETED','FAILED'].includes(data.status);n++) {
        if (ctx.now()-start>=timeout || n>=(cfg.maxPolls ?? 180)) throw new AudioError('network','Monid 任务轮询超时','用 Monid 控制台查看 run；官方快照未提供取消接口，勿重新提交',true);
        await sleep(cfg.pollIntervalMs ?? 1000); data=await this.poll({runId},ctx);
      }
    }
    if (data.status === 'FAILED') throw new AudioError('provider','Monid 任务基础设施失败','查看 Monid run；避免再次付费');
    if (data.providerResponse?.httpStatus>=400) throw httpError(data.providerResponse.httpStatus);
    if (data.status !== 'COMPLETED') throw new AudioError('provider','Monid 同步结果没有完成状态','查看 Monid run');
    const seconds=body.duration_seconds ?? (body.music_length_ms===undefined ? null:body.music_length_ms/1000);
    if(typeof data.output?.audio_base64==='string') {
      const encoded=data.output.audio_base64;
      if(!encoded || !/^[A-Za-z0-9+/\s]+={0,2}$/.test(encoded)) throw new AudioError('provider','Monid 音频 Base64 无效','查看 run 输出');
      return {buffer:Buffer.from(encoded,'base64'),format:'mp3',seconds,actual:cost(data),model:row.model,quality:'cloud',license:row.license};
    }
    const explicit=cfg.outputUrlPath ? pick(data.output,cfg.outputUrlPath):data.output?.audio?.download_link;
    const found=explicit ? urls(explicit):urls(data.output).sort((a,b)=>Number(/\.(mp3|wav|m4a|flac|ogg|opus|aac)(?:\?|$)/i.test(b))-Number(/\.(mp3|wav|m4a|flac|ogg|opus|aac)(?:\?|$)/i.test(a)));
    if (!found.length) throw new AudioError('provider','Monid 输出没有 HTTPS 音频 URL','按实际输出设置 providers.monid.outputUrlPath；不猜未知字段');
    let media; try { media=await ctx.fetch(found[0],{redirect:'error',signal:AbortSignal.timeout(cfg.requestTimeoutMs || 60000)}); } catch { throw new AudioError('network','Monid 音频下载失败','结果 URL 可能过期；查看 run'); }
    if (!media.ok) throw httpError(media.status);
    const mime=(media.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const ext=new URL(found[0]).pathname.match(/\.(mp3|wav|m4a|flac|ogg|opus|aac)$/i)?.[1]?.toLowerCase();
    const format=formats[mime] || (/^(application\/octet-stream)?$/.test(mime) ? ext:null);
    if (!format) throw new AudioError('provider','Monid 返回内容无法确认为音频','检查实际输出 URL 与 Content-Type');
    return {buffer:Buffer.from(await media.arrayBuffer()),format,seconds,actual:cost(data),model:row.model,quality:'cloud',license:row.license};
  }
}
export default MonidAdapter;
