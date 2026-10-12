// 适配器共用的零件：带时限的 fetch、读 key、落盘、调外部命令、清理临时文件。
//
// 一条硬规矩：任何日志和报错里都不许出现密钥本身。只报「有没有」，
// 所有从这个文件出去的字符串都过一遍 scrub()。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_TIMEOUT = 8000;

export class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** 把看起来像密钥的东西抹掉（报错要给人看，但不能泄漏） */
export function scrub(s) {
  return String(s ?? '')
    .replace(/sk-[A-Za-z0-9._-]{4,}/g, 'sk-<redacted>')
    .replace(/((?:xi-api-key|api[-_]?key|authorization|bearer|token)\s*[:=]?\s*)[A-Za-z0-9._-]{8,}/gi, '$1<redacted>');
}

/** 带时限的 fetch；不 ok 就抛 HttpError（body 截断且已抹密钥） */
export async function fetchWithTimeout(url, init = {}, ms = DEFAULT_TIMEOUT) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new HttpError(`${init.method || 'GET'} ${url} → ${r.status}`, r.status, scrub(text).slice(0, 300).trim());
    }
    return r;
  } catch (err) {
    if (err instanceof HttpError) return Promise.reject(err);
    if (err && err.name === 'AbortError') throw new Error(`超时 ${ms}ms：${url}`);
    throw new Error(scrub(err && err.message ? err.message : err));
  } finally {
    clearTimeout(timer);
  }
}

export function readFileSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * 取密钥：先看环境变量，再看 .env 文件（LITELLM 那种只写在文件里的）。
 * 只回报字符串本身给调用方用，绝不打印；没找到返回 ''。
 */
export function readKey(names, file) {
  for (const n of [].concat(names)) {
    const v = process.env[n];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const text = file ? readFileSafe(file) : '';
  if (!text) return '';
  for (const n of [].concat(names)) {
    const m = new RegExp(`^\\s*(?:export\\s+)?${n}\\s*=\\s*(.*)$`, 'm').exec(text);
    if (!m) continue;
    const v = m[1].trim().replace(/^['"]|['"]$/g, '').trim();
    if (v) return v;
  }
  return '';
}

export function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

/** 落盘，返回写进去的字节数 */
export function saveBuffer(file, buf) {
  ensureDir(file);
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  fs.writeFileSync(file, bytes);
  return bytes.length;
}

export function saveB64(b64, file) {
  const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!clean) throw new Error('返回里没有 b64_json，也没有 url');
  return saveBuffer(file, Buffer.from(clean, 'base64'));
}

/**
 * 下载到本地。图片网关给的常是外链（apimart 那种），
 * 有的要带 key、有的外链带签名反而不能带 —— 所以先不带认证试一次，401/403 再带上。
 */
export async function downloadTo(url, file, { headers = {}, ms = 60000, auth } = {}) {
  let r;
  try {
    r = await fetchWithTimeout(url, { headers }, ms);
  } catch (err) {
    if (auth && err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      r = await fetchWithTimeout(url, { headers: { ...headers, ...auth } }, ms);
    } else {
      throw err;
    }
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error(`下载到 0 字节：${url}`);
  return saveBuffer(file, buf);
}

export function hasBin(bin, args = ['-version']) {
  try {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 8000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** 跑一条外部命令；失败时把 stderr 尾部带回来（已抹密钥） */
export function runCmd(cmd, args, { timeoutMs = 120000, input } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, input });
  const ok = r.status === 0;
  if (!ok) {
    const tail = scrub(`${r.stderr || r.error || ''}`.trim()).slice(-300);
    throw new Error(`${cmd} 退出码 ${r.status}${tail ? `：${tail}` : ''}`);
  }
  return r;
}

export function mkTemp(prefix = 'asset-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanup(list) {
  for (const f of list || []) {
    try {
      fs.rmSync(f, { recursive: true, force: true });
    } catch {
      /* 清理失败不算错误 */
    }
  }
}
