import { AudioError } from './errors.mjs';
export async function pickProvider(capability, request, registry, policy = {}) {
  const {ctx, mode = 'auto'} = policy;
  if (!['auto','local-only','cloud-quality','manual'].includes(mode)) throw new AudioError('config','音频模式无效','使用 auto/local-only/cloud-quality/manual');
  if (mode === 'manual' && (!request.provider || !request.model)) throw new AudioError('config','manual 必须指定 Provider 和 Model','传 provider 和 model');
  const allowedLocal = p => p.local && ['local','mock'].includes(p.id);
  if (mode === 'local-only' && request.provider && !allowedLocal(registry.get(request.provider) || {})) throw new AudioError('local_only','本地模式拒绝云端 Provider','切到 auto 并配置 MONID_API_KEY 或 FAL_KEY');
  let adapters = registry.adapters().filter(p => !request.provider || p.id === request.provider);
  if (mode === 'local-only') adapters = adapters.filter(allowedLocal);
  else if (mode === 'cloud-quality' || request.quality === 'cloud') adapters = adapters.filter(p=>!p.local);
  const order = policy.providerOrder || ['local','monid','fal','elevenlabs','mock'];
  if (!request.provider) adapters.sort((a,b) => (mode === 'auto' ? Number(!a.local)-Number(!b.local) : 0) || ((order.indexOf(a.id) < 0 ? 999 : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 999 : order.indexOf(b.id))));
  const actions = []; let deferred;
  for (const p of adapters) {
    const avail = await p.available({...request,capability},ctx);
    if (!avail?.ok) { if (avail?.action) actions.push(avail.action); continue; }
    const models = await registry.models(p.id,ctx);
    const m = models.find(m=>m.capability === capability && (!request.model || m.model === request.model));
    if (!m) continue;
    const req = {...request,capability,model:m.model,provider:p.id};
    const estimate = await p.estimate(req,ctx);
    const candidate = {provider:p,model:m.model,estimate,why:p.local ? '本地服务能满足请求，优先本地' : '按已配置的服务顺序选择可用云端模型'};
    if (!request.provider && policy.canAfford && !policy.canAfford(estimate)) { deferred ||= candidate; continue; }
    return candidate;
  }
  if (deferred) return deferred; // 交给统一 Authorize 返回 price_unknown/budget，不伪装成配置错误。
  throw new AudioError(mode === 'local-only' ? 'local_only' : 'config','没有可用的音频 Provider', mode === 'local-only' ? '安装 say/ffmpeg，或切到 auto 并配置 MONID_API_KEY 或 FAL_KEY' : actions.join('；') || '配置 MONID_API_KEY/FAL_KEY/ELEVENLABS_API_KEY 或使用本地服务');
}
