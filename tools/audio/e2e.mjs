#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAudioEngine } from './engine.mjs';
import { createSecrets } from './secrets.mjs';
import { AudioError, normalizeError, readJSON } from './errors.mjs';

export const setupInstructions=`没有云端 Key。先把 Key 放进 macOS 钥匙串（命令示例，替换占位符）：
security add-generic-password -U -s digital-world-audio -a MONID_API_KEY -w '<MONID_KEY>'
security add-generic-password -U -s digital-world-audio -a FAL_KEY -w '<FAL_KEY>'
也可用 node tools/audio/cli.mjs key set MONID_API_KEY 从标准输入读取。
Key 不写进 config.json。配置放在 DW_AUDIO_HOME/config.json（默认 ~/.digital-world/audio/config.json）：
{"mode":"cloud-quality","budget":{"perCall":0.10,"daily":0.50,"monthly":1.00},"providers":{"monid":{"enabled":true},"fal":{"enabled":true,"priceOverride":{"speech":null,"music":null,"sfx":null}}}}
fal 价格未知时把 priceOverride 的 null 换为你核实的单次美元估算；未知价不会自动付费。
然后由负责人运行 node tools/audio/e2e.mjs。它最多执行每种能力一条、总估算不超过 $0.50；不会自动改预算。
克隆需 e2e.clone={audio_file,name,consent:{by,statement,at,subject:'self'|'licensed'}}；默认没有参考录音，不执行克隆。`;

export async function main(options={}) {
  const log=options.log || console.log, secrets=options.secrets || createSecrets();
  const keyMonid=Boolean(await secrets.get('MONID_API_KEY')), keyFal=Boolean(await secrets.get('FAL_KEY'));
  if(!keyMonid && !keyFal) { log(setupInstructions);return {status:'setup',executed:0}; }
  const home=options.home || process.env.DW_AUDIO_HOME || path.join(os.homedir(),'.digital-world/audio');
  const config=options.config ?? readJSON(path.join(home,'config.json'),{});
  const audio=createAudioEngine({...options,home,secrets,config,mode:'cloud-quality'});
  const usage=await audio.get_usage(), all=await audio.list_models();
  const samples={speech:{text:'风起。'},sfx:{prompt:'A wooden door creaks open',duration:3},music:{prompt:'Quiet ancient Chinese flute, instrumental',duration:3,instrumental:true}};
  if(config.e2e?.clone) samples.clone=config.e2e.clone;
  const plans=[];
  for(const [capability,sample] of Object.entries(samples)) {
    const candidates=[];
    for(const model of all.filter(m=>m.capability===capability && ['monid','fal'].includes(m.provider))) {
      const request={...sample,provider:model.provider,model:model.model};
      try { const estimate=await audio.estimate(capability,request);if(Number.isFinite(estimate.estimated)) candidates.push({capability,request,estimate}); }
      catch(err) { if(!['config','price_unknown','budget'].includes(err.code)) throw err; }
    }
    candidates.sort((a,b)=>a.estimate.estimated-b.estimate.estimated);
    if(!candidates.length) { log(JSON.stringify({capability,status:'skipped',reason:'缺有效入参或可靠价格，未调用生成',action:'核对 registry schema、参考录音与 providers.fal.priceOverride'}));continue; }
    plans.push(candidates[0]);
  }
  const estimated=plans.reduce((sum,p)=>sum+p.estimate.estimated,0), balance=usage.wallet?.balance ?? null;
  log(JSON.stringify({phase:'estimate',currency:'USD',estimated,wallet:balance,capabilities:plans.map(p=>({capability:p.capability,...p.estimate}))}));
  if(estimated>.50 || Number.isFinite(balance) && estimated>balance) throw new AudioError('budget','端到端总估算超过 $0.50 或 Monid 余额','减少时长或选更便宜的已知价模型');
  if(usage.daily+estimated>usage.limits.daily || usage.monthly+estimated>usage.limits.monthly || plans.some(p=>p.estimate.estimated>usage.limits.perCall)) throw new AudioError('budget','端到端计划超过配置预算','检查已有用量，脚本不会自动提预算');
  if(keyMonid && balance===null && plans.some(p=>p.request.provider==='monid')) throw new AudioError('config','读不到 Monid 余额，未执行生成','修复 wallet 查询后再运行');
  const results=[];
  for(const plan of plans) {
    const method={speech:'generate_speech',music:'generate_music',sfx:'generate_sfx',clone:'clone_voice'}[plan.capability];
    const result=await audio[method](plan.request);
    results.push(result);log(JSON.stringify({phase:'report',capability:plan.capability,status:result.status,provider:result.provider,model:result.model,cost:result.cost,file:result.file,voice_id:result.voice_id,error:result.error}));
    if(result.status!=='succeeded') break; // 一次失败就停，不重提、不升级服务。
  }
  if(!config.e2e?.clone) log('克隆未执行：未提供已授权参考录音与 consent。');
  return {status:results.some(r=>r.status!=='succeeded') ? 'failed':plans.length ? 'succeeded':'setup',estimated,executed:results.length,results};
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().then(r=>{if(r.status==='failed') process.exitCode=1;}).catch(err=>{console.error(JSON.stringify(normalizeError(err).toJSON()));process.exitCode=1;});
