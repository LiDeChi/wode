import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as say from '../../assets/providers/say.mjs';
import * as synth from '../../assets/providers/synth.mjs';
import { AudioError } from '../errors.mjs';
export class LocalAudioAdapter {
  constructor({services = {}} = {}) { this.id = 'local'; this.local = true; this.services = services; }
  async capabilities() { return [{capability:'speech',model:'local/say',quality:'placeholder',license:'system voice'},...['sfx','music'].map(capability=>({capability,model:`local/ffmpeg-${capability}`,quality:'placeholder',license:'generated placeholder'}))]; }
  async available(req = {}) {
    const caps = req.capability === 'speech' ? await say.available() : await synth.available();
    return {ok:Boolean(caps.ok),action:caps.ok ? undefined : '安装 ffmpeg；macOS 下载可发声的中文 say 音色',note:caps.note};
  }
  async estimate() { return {estimated:0,currency:'USD',priceSource:'local-free'}; }
  async probe(ctx) {
    const rows = [];
    for (const [name,address] of Object.entries(this.services)) {
      let url;
      try { url = new URL(address); } catch { throw new AudioError('config','本地服务 URL 无效','填写 loopback HTTP URL'); }
      if (!['http:','https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password) throw new AudioError('local_only','本地探活只允许 loopback 地址','使用 http://127.0.0.1:端口');
      try { const r = await ctx.fetch(url.toString(),{redirect:'error',signal:AbortSignal.timeout(3000)}); rows.push({name,url:url.toString(),ok:r.ok,generation:false}); }
      catch { rows.push({name,url:url.toString(),ok:false,generation:false}); }
    }
    return rows;
  }
  async run(req) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'dw-audio-local-')), file = path.join(tmp,'audio.m4a');
    try {
      let r;
      if (req.capability === 'speech') r = await say.make({kind:'voice',spec:{...req,voice:req.provider_voice_id || req.voice_id || (typeof req.voice==='object' ? req.voice.id : req.voice)}},file);
      else if (['music','sfx'].includes(req.capability)) r = await synth.make({kind:req.capability,spec:{...req,seconds:req.duration}},file);
      else throw new AudioError('config','本地暂不支持声音克隆','选择已授权的云端 clone Provider');
      return {buffer:fs.readFileSync(file),format:'m4a',seconds:r.seconds ?? say.durationOf(file),actual:0,quality:'placeholder',license:'local placeholder',model:r.model};
    } finally { const resolved = path.resolve(tmp); if (resolved.startsWith(path.join(os.tmpdir(),'dw-audio-local-'))) fs.rmSync(resolved,{recursive:true,force:true}); }
  }
}
export default LocalAudioAdapter;
