import { spawnSync } from 'node:child_process';
import { AudioError } from './errors.mjs';
const SERVICE = 'digital-world-audio';
function valid(name) { if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new AudioError('config', '密钥变量名无效', '使用 MONID_API_KEY、FAL_KEY 或 ELEVENLABS_API_KEY'); }
export function createSecrets({ env = process.env } = {}) {
  return {
    async get(name) {
      valid(name);
      if (process.platform === 'darwin') {
        const r = spawnSync('security', ['find-generic-password','-s',SERVICE,'-a',name,'-w'], {encoding:'utf8', timeout:5000});
        if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
      }
      return typeof env[name] === 'string' ? env[name].trim() : '';
    },
    async has(name) { return Boolean(await this.get(name)); },
    async set(name, value) {
      valid(name);
      if (process.platform !== 'darwin') throw new AudioError('config', '此系统暂未接凭据库', '用环境变量设置密钥');
      if (typeof value !== 'string' || !value.trim()) throw new AudioError('config', '密钥为空', '从标准输入提供密钥');
      const r = spawnSync('security', ['add-generic-password','-U','-s',SERVICE,'-a',name,'-w',value.trim()], {encoding:'utf8', timeout:5000});
      if (r.status !== 0) throw new AudioError('auth', '写入钥匙串失败', '在系统钥匙串中授权 security 命令');
      return { name, stored:true };
    },
  };
}
const secrets = createSecrets();
export const get = (name) => secrets.get(name);
export const set = (name,value) => secrets.set(name,value);
export const has = (name) => secrets.has(name);
