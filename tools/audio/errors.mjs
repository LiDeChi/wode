import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export class AudioError extends Error {
  constructor(code, message, action = '检查音频配置后重试', retryable = false) { super(message); this.name = 'AudioError'; Object.assign(this, { code, action, retryable }); }
  toJSON() { return { code: this.code, message: this.message, action: this.action, retryable: this.retryable }; }
}
export function normalizeError(err) { return err instanceof AudioError ? err : new AudioError('provider', '音频服务执行失败', '检查服务状态和配置后重试'); }
export function httpError(status) {
  const code = status === 402 ? 'insufficient_balance' : [401,403].includes(status) ? 'auth' : status === 429 ? 'rate_limit' : 'network';
  return new AudioError(code, `音频服务 HTTP ${status}`, code === 'auth' ? '检查钥匙串中的 API Key' : code === 'insufficient_balance' ? '充值或切换本地模式' : '稍后重试或切换本地模式', [408,429,502,503,504].includes(status));
}
export function readJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return structuredClone(fallback); throw new AudioError('config', '音频存储文件无法读取', `检查 ${path.basename(file)} 是否是有效 JSON`); } }
export function writeJSON(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const tmp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
export function assertNoSecrets(value) { if (!value || typeof value !== 'object') return; for (const [key,v] of Object.entries(value)) { if (/^(?:key|api[_-]?key|token|authorization|headers|secrets|.*_API_KEY|FAL_KEY)$/i.test(key)) throw new AudioError('config', '配置和请求不能携带密钥', '使用钥匙串或环境变量设置 API Key'); assertNoSecrets(v); } }
