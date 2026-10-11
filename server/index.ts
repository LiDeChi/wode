import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createApi } from './api.ts';
import { WorldStore } from './store.ts';

const store = new WorldStore();
const api = createApi(store);
const production = process.env.NODE_ENV === 'production';
const vite = production ? null : await (await import('vite')).createServer({ server: { middlewareMode: true }, appType: 'spa' });
const root = resolve('dist');
const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try { if (await api(req, res)) return; }
  catch { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: '剧场未能保存这一步，请重新打开。' })); return; }
  if (vite) { vite.middlewares(req, res); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    const candidate = resolve(root, '.' + pathname);
    if (!candidate.startsWith(root + sep) && candidate !== root) { res.writeHead(403).end(); return; }
    let file = candidate;
    try { if (!(await stat(file)).isFile()) file = resolve(root, 'index.html'); }
    catch { if (extname(candidate)) { res.writeHead(404).end('没有这个资源。'); return; } file = resolve(root, 'index.html'); }
    res.writeHead(200, { 'Content-Type': contentTypes[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('没有这个入口。'); }
});
server.listen(Number(process.env.PORT || 4318), '127.0.0.1', () => console.log(`数字世界剧场已就绪 http://127.0.0.1:${process.env.PORT || 4318}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { server.close(); void vite?.close(); store.close(); process.exit(0); });
