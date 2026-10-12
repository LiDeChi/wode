// 本地服务器：托管静态文件、代理模型调用、存取世界存档。只用 node:http / node:fs / node:path，零依赖。
// 凭据只在这里读取，绝不发给浏览器。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 仓库根目录：server/ 的上一级
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4320;
const GATEWAY = (process.env.MODEL_GATEWAY_URL || 'http://127.0.0.1:3425/v1').replace(/\/+$/, '');
const KEY = process.env.MODEL_GATEWAY_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';
const PRIMARY = process.env.MODEL_FAST || 'opencode-go/glm-5.3-flash';
// 备用是推理模型时，max_tokens 要给够（推理会把 content 吃光，只剩 finish_reason:length）
const FALLBACK = process.env.MODEL_FALLBACK || 'opencode-go/deepseek-v4.1-flash';
const FALLBACK_MIN_TOKENS = 800;
// 主模型和备用模型各给各的时限：主模型慢只是慢，不能占掉备用模型的时间
const PRIMARY_MS = 6000;
const FALLBACK_MS = 10000;
const STATIC_DIRS = ['web', 'shared', 'docs'];
const WORLD_FILE = path.join(ROOT, '.runtime', 'world.json');
const MAX_SPEAK_BODY = 64 * 1024;
const MAX_WORLD_BODY = 5 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  // 资产管线产出的声音（web/assets/gen/**）：缺了这几个，Safari 拿到 octet-stream 会拒绝播放
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        const err = new Error('body too large');
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// 调用单个模型；只取 message.content，忽略任何推理字段；去掉 <think> 块以防模型把推理写进正文
async function callModel(model, { system, user, maxTokens }, ms = PRIMARY_MS) {
  const started = Date.now();
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const headers = { 'content-type': 'application/json' };
    if (KEY) headers.authorization = `Bearer ${KEY}`;
    const r = await fetch(`${GATEWAY}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`gateway ${r.status}`);
    const json = await r.json();
    const raw = json?.choices?.[0]?.message?.content;
    const text = typeof raw === 'string' ? raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() : '';
    if (!text) throw new Error('empty content');
    const u = json.usage || {};
    const tokens = u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
    return { text, model, ms: Date.now() - started, tokens };
  } finally {
    clearTimeout(timer);
  }
}

async function speak({ system, user, maxTokens }) {
  try {
    return await callModel(PRIMARY, { system, user, maxTokens }, PRIMARY_MS);
  } catch (primaryErr) {
    try {
      // 备用是推理模型：给足自己的时限，也要够多的 max_tokens 留给推理
      return await callModel(FALLBACK, { system, user, maxTokens: Math.max(FALLBACK_MIN_TOKENS, maxTokens) }, FALLBACK_MS);
    } catch (fallbackErr) {
      throw new Error(`primary: ${primaryErr.message}; fallback: ${fallbackErr.message}`);
    }
  }
}

async function handleSpeak(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req, MAX_SPEAK_BODY));
  } catch (err) {
    return sendJson(res, err.status === 413 ? 413 : 400, { error: err.status === 413 ? 'body too large' : 'bad json' });
  }
  const system = typeof body.system === 'string' ? body.system : '';
  const user = typeof body.user === 'string' ? body.user : '';
  if (!user) return sendJson(res, 400, { error: 'user required' });
  const maxTokens = Math.min(2000, Math.max(16, Number(body.maxTokens) || 300));
  try {
    const out = await speak({ system, user, maxTokens });
    sendJson(res, 200, out);
  } catch (err) {
    sendJson(res, 502, { error: String(err.message || err) });
  }
}

// 只证明“网关注册表拿得到”；能不能真的说话，用模型名在不在表里判断。
// 以前只看网关首页活没活，所以模型名 404 时 /api/health 还在报 gateway:true。
async function probeGateway() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const headers = {};
    if (KEY) headers.authorization = `Bearer ${KEY}`;
    const r = await fetch(`${GATEWAY}/models`, { headers, signal: controller.signal });
    if (!r.ok) return { ok: false, ids: null };
    const json = await r.json();
    const ids = Array.isArray(json?.data) ? json.data.map((m) => m?.id).filter((x) => typeof x === 'string') : null;
    return { ok: true, ids };
  } catch {
    return { ok: false, ids: null };
  } finally {
    clearTimeout(timer);
  }
}

async function handleWorld(req, res) {
  if (req.method === 'GET') {
    try {
      const data = await fs.promises.readFile(WORLD_FILE, 'utf8');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(data);
    } catch (err) {
      if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'no world yet' });
      return sendJson(res, 500, { error: 'read failed' });
    }
  }
  // PUT：整份世界覆盖写入；先写临时文件再改名，避免写一半断电留下坏档
  let raw;
  try {
    raw = await readBody(req, MAX_WORLD_BODY);
    JSON.parse(raw);
  } catch (err) {
    return sendJson(res, err.status === 413 ? 413 : 400, { error: err.status === 413 ? 'body too large' : 'bad json' });
  }
  try {
    await fs.promises.mkdir(path.dirname(WORLD_FILE), { recursive: true });
    const tmp = `${WORLD_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, raw, 'utf8');
    await fs.promises.rename(tmp, WORLD_FILE);
    sendJson(res, 200, { ok: true, bytes: Buffer.byteLength(raw, 'utf8') });
  } catch {
    sendJson(res, 500, { error: 'write failed' });
  }
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { error: 'bad path' });
  }
  if (decoded.includes('\0') || decoded.split(/[\\/]/).includes('..')) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  let parts = decoded.split('/').filter(Boolean);
  if (parts.length === 0) parts = ['web', 'index.html'];
  // 不带目录前缀的路径（如 /app.js）默认从 web/ 找
  if (!STATIC_DIRS.includes(parts[0])) parts = ['web', ...parts];

  let file = path.resolve(ROOT, ...parts);
  if (!file.startsWith(ROOT + path.sep)) return sendJson(res, 403, { error: 'forbidden' });

  let stat = await fs.promises.stat(file).catch(() => null);
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = await fs.promises.stat(file).catch(() => null);
  }
  if (!stat?.isFile()) return sendJson(res, 404, { error: 'not found' });

  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'cache-control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${HOST}`);
    const p = url.pathname;

    if (p === '/api/speak') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      return await handleSpeak(req, res);
    }
    if (p === '/api/health') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET only' });
      const probe = await probeGateway();
      const listed = probe.ids ? (m) => probe.ids.includes(m) : () => null;
      return sendJson(res, 200, {
        ok: true,
        model: PRIMARY,
        fallback: FALLBACK,
        gateway: probe.ok,
        // null = 网关注册表没读到，不知道；false = 表里没有这个名字，调用一定 404
        models: { primary: listed(PRIMARY), fallback: listed(FALLBACK) },
      });
    }
    if (p === '/api/world') {
      if (req.method !== 'GET' && req.method !== 'PUT') return sendJson(res, 405, { error: 'GET or PUT only' });
      return await handleWorld(req, res);
    }
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, p);
    return sendJson(res, 405, { error: 'method not allowed' });
  } catch {
    if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
  }
}

export function createServer() {
  return http.createServer(handler);
}

// 直接运行 node server/index.mjs 时才监听端口
if (process.argv[1] && process.argv[1].endsWith(path.join('server', 'index.mjs'))) {
  createServer().listen(PORT, HOST, () => {
    console.log(`数字世界 运行在 http://${HOST}:${PORT}`);
  });
}
