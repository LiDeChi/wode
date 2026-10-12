import path from 'node:path';
import { AudioError, readJSON, writeJSON, assertNoSecrets } from './errors.mjs';
export class ProviderRegistry {
  constructor(home, { providers = [], now = Date.now, sanitize = v=>v } = {}) { this.file = path.join(home,'registry.json'); this.providers = new Map(); this.now = now; this.sanitize = sanitize; for (const p of providers) this.register(p); }
  register(p) {
    if (!p?.id || ['capabilities','estimate','run','available'].some(k => typeof p[k] !== 'function')) throw new AudioError('config','Provider 接口不完整','按 README 的 Adapter 接口实现');
    if (this.providers.has(p.id)) throw new AudioError('config','Provider ID 重复','给每个 Provider 唯一 ID');
    this.providers.set(p.id,p); return this;
  }
  get(id) { return this.providers.get(id); }
  adapters() { return [...this.providers.values()]; }
  upsert(provider, models) { assertNoSecrets(models); models = this.sanitize(models); const data = readJSON(this.file,{}); data[provider] = {provider,models,updatedAt:new Date(this.now()).toISOString()}; writeJSON(this.file,data); return models; }
  cached(provider) { return readJSON(this.file,{})[provider]?.models || []; }
  async models(provider, ctx) {
    const p = this.get(provider); if (!p) return [];
    const models = await p.capabilities(ctx);
    if (!Array.isArray(models)) throw new AudioError('config','Provider 模型列表无效','capabilities 返回模型数组');
    this.upsert(provider,models); return models;
  }
  async list(capability, ctx, adapters = this.adapters()) {
    const rows = [];
    for (const p of adapters) {
      const availability = await p.available({capability},ctx);
      if (!availability?.ok) continue;
      for (const m of await this.models(p.id,ctx)) if (!capability || m.capability === capability) rows.push({...m,provider:p.id,local:Boolean(p.local)});
    }
    return rows;
  }
}
