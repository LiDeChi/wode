import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AudioError, httpError, readJSON, writeJSON, assertNoSecrets } from './errors.mjs';
const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')}}` : JSON.stringify(v);
export class AudioAssetStore {
  constructor(home) { this.home = home; this.file = path.join(home,'assets.json'); }
  key(req) { const {out,...spec} = req; return `${req.capability}-${createHash('sha256').update(stable(spec)).digest('hex').slice(0,24)}`; }
  get(key) { const row = readJSON(this.file,{})[key]; return row && fs.existsSync(row.file) ? row : null; }
  async persist(req,result,meta,ctx) {
    assertNoSecrets(meta); const key = req.key || this.key(req), format = result.format || 'wav';
    if (!/^[a-z0-9]{2,6}$/.test(format) || !/^[a-zA-Z0-9_-]+$/.test(key)) throw new AudioError('provider','资产格式或 key 无效','Provider 返回简短文件扩展名');
    let buffer;
    if (result.buffer) buffer = Buffer.from(result.buffer);
    else if (result.file) buffer = fs.readFileSync(result.file);
    else if (result.url) {
      if (ctx.mode === 'local-only') throw new AudioError('local_only','本地模式不下载网络结果','本地 Adapter 返回 buffer 或 file');
      const r = await ctx.fetch(result.url,{signal:AbortSignal.timeout(60000)}); if (!r.ok) throw httpError(r.status); buffer = Buffer.from(await r.arrayBuffer());
    } else throw new AudioError('provider','服务没有返回音频','Provider 返回 buffer/file/url');
    if (!buffer.length) throw new AudioError('provider','服务返回空音频','检查 Provider 结果');
    const canonical = path.join(this.home,'assets',`${key}.${format}`);
    fs.mkdirSync(path.dirname(canonical),{recursive:true,mode:0o700});
    const tmp = `${canonical}.${randomUUID()}.tmp`; fs.writeFileSync(tmp,buffer,{mode:0o600}); fs.renameSync(tmp,canonical);
    const row = {key,file:canonical,format,bytes:buffer.length,...meta}; writeJSON(`${canonical}.json`,row);
    if (req.out) { const out = path.resolve(req.out); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,buffer); writeJSON(`${out}.json`,{...row,file:out}); }
    const assets = readJSON(this.file,{}); assets[key] = row; writeJSON(this.file,assets);
    return {...row,file:req.out ? path.resolve(req.out) : canonical};
  }
}
