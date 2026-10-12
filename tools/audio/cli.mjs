#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { createAudioEngine } from './engine.mjs';
import { createSecrets } from './secrets.mjs';
import { AudioError, normalizeError, readJSON } from './errors.mjs';
import { LocalAudioAdapter } from './providers/local.mjs';
import { MockProvider } from './providers/mock.mjs';
import { ElevenLabsAdapter } from './providers/elevenlabs.mjs';
function parse(args) {
  const opts = {}, rest = [];
  for (let i=0;i<args.length;i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { rest.push(arg); continue; }
    const k = arg.slice(2).replace(/-/g,'_');
    if (['dry','confirm','instrumental'].includes(k)) opts[k] = true;
    else { if (!args[i+1] || args[i+1].startsWith('--')) throw new AudioError('config',`${arg} 缺少值`,'在参数后填写值'); opts[k] = args[++i]; }
  }
  for (const k of ['duration','rate','bpm','intensity','pause','seed']) if (opts[k] !== undefined) opts[k] = Number(opts[k]);
  if (opts.consent_json) { try { opts.consent = JSON.parse(opts.consent_json); } catch { throw new AudioError('consent','consent JSON 无效','填写 by/statement/at/subject'); } delete opts.consent_json; }
  return {opts,rest};
}
async function defaultAdapters(config) {
  const adapters = [new LocalAudioAdapter(config.local),new ElevenLabsAdapter(config.providers?.elevenlabs),new MockProvider(config.mock)];
  // 独立云适配器落地后自动加载；缺文件不会阻断 local/mock。
  for (const [file,names] of [['monid.mjs',['MonidAdapter']],['fal.mjs',['FalAdapter']]]) {
    try { const m = await import(`./providers/${file}`); const C = m[names[0]] || m.default; if (C) adapters.push(new C(config.providers?.[file.split('.')[0]])); }
    catch(err) { if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err; }
  }
  return adapters;
}
export async function main(args = process.argv.slice(2)) {
  const [command,...tail] = args, {opts,rest} = parse(tail), secrets = createSecrets();
  if (command === 'key') {
    const [action,name] = rest;
    if (action === 'has') return {name,available:await secrets.has(name)};
    if (action === 'set') {
      let value = ''; for await (const chunk of process.stdin) value += chunk;
      return secrets.set(name,value.trim());
    }
    throw new AudioError('config','key 命令无效','用 key has NAME 或 key set NAME（从标准输入提供值）');
  }
  const home = opts.home || process.env.DW_AUDIO_HOME || path.join(os.homedir(),'.digital-world/audio');
  const config = readJSON(opts.config ? path.resolve(opts.config) : path.join(home,'config.json'),{});
  const adapters = await defaultAdapters(config);
  const authorize = opts.confirm ? async estimate => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
    process.stdout.write(`估算 ${estimate.estimated ?? '未知'} USD，最多预留 ${estimate.reserved} USD；云端 clone 会上传参考录音。\n`);
    const rl = createInterface({input:process.stdin,output:process.stdout});
    try { return /^(y|yes|是)$/i.test((await rl.question('授权本次调用？[y/N] ')).trim()); } finally { rl.close(); }
  } : undefined;
  const audio = createAudioEngine({home,mode:opts.mode,config,providers:adapters,authorize});
  if (command === 'voices') return audio.list_voices();
  if (command === 'models') return audio.list_models(rest[0]);
  if (command === 'job') return audio.get_job(rest[0]);
  if (command === 'usage') return audio.get_usage();
  if (command === 'config') return {home:audio.home,mode:audio.mode,config:config || readJSON(path.join(audio.home,'config.json'),{}),action:'复制 audio.example.json 到 home/config.json；key 只用钥匙串或环境变量'};
  const capability = {speech:'speech',music:'music',sfx:'sfx',clone:'clone'}[command];
  if (!capability) throw new AudioError('config','音频命令无效','用 speech|music|sfx|clone|voices|models|job|usage|config|key');
  const {dry,confirm,mode,home:unusedHome,config:unusedConfig,...request} = opts;
  if (dry) return audio.estimate(capability,request);
  return audio[{speech:'generate_speech',music:'generate_music',sfx:'generate_sfx',clone:'clone_voice'}[capability]](request);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result=>{process.stdout.write(JSON.stringify(result,null,2)+'\n'); if (result?.status === 'failed') process.exitCode = 1;}).catch(err=>{process.stderr.write(JSON.stringify(normalizeError(err).toJSON(),null,2)+'\n');process.exitCode=1;});
}
