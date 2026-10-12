// tests/workshop.test.js —— docs/WORKSHOP.md §5「验收（全部用假服务）」九条，一条一组。
//
// 硬约束（§0）：不装模型、不在开发机上验证真模型。所有验证都用测试里现起的
// loopback http 假服务，以及一个写在临时目录里的小 node 脚本扮 MCP stdio agent。
// 每个测试独立临时 DW_AUDIO_HOME / DW_WORKSHOP_CONFIG，互不污染。
//
// 实现还在写（§6 分工：sol=t15/t17，kernel2=t16，sim2=t15），所以每组的写法是
// 「先看模块在不在」：模块缺席、或缺少约定导出，就 t.skip('等 tXX：<路径>')，
// 绝不让整个文件崩。模块在了就跑到断言。
//
// 假定的导出名（与实现冲突时以实现为准，并写信给 captain）：
//   tools/local/net.mjs                 地址规则校验器 assertLocalUrl|checkUrl|validateUrl(url, service)
//                                       HTTP 客户端 request|fetchLocal|httpGet|getJson(url, init)
//   tools/local/license.mjs             checkLicense(service, policy) → {ok, action?, license}
//   tools/local/mcp.mjs                 probeAgent/callAgent(service, {brief, style, outDir}, ctx) → {files}
//   tools/audio/providers/localsvc.mjs  类（LocalServiceAudioAdapter 等）或工厂；或由
//                                       createAudioEngine 按 config.local 自动注册（t15 的「注册这一行」）
//   tools/assets/providers/localsvc.mjs 模块级 name/kinds/ext + available(ctx) / make(brief, outPath, ctx)
//                                       （同 providers/magpie.mjs 的约定）
//   tools/assets/review.mjs             review(brief, file, lock, opts) → {verdict, why, checks}（已落地核对：
//                                       brief.spec 带 seconds/size/quality，opts 里 attempt/maxRedo 决定 redo 还是 reject，
//                                       opts.critic + opts.fetch 注入评审模型，opts.{ffmpeg,ffprobe}=false 可当没装）
//   tools/local/doctor.mjs              CLI：node doctor.mjs [--config <path>] [--json]
// openai.mjs / comfyui.mjs 不直接 import：§2 要求两侧适配器都只调 tools/local 的客户端，
// 所以这里经适配器 / 引擎触发它们，断言落在假服务收到的请求上。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1x1 PNG（假服务出图用它，纯字节，不含任何模型）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

// ---------- 通用小工具 ----------

async function loadOptional(rel) {
  try {
    return await import(pathToFileURL(path.join(ROOT, rel)).href);
  } catch (err) {
    if (err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND')) return null;
    throw err;
  }
}

/** 契约要求：模块/导出缺席 → 本组 skip 并写明等哪个任务，而不是失败。 */
function need(t, cond, why) {
  if (cond) return true;
  t.skip(why);
  return false;
}

function pickExport(mod, names) {
  if (!mod) return null;
  for (const name of names) if (typeof mod[name] === 'function') return { name, fn: mod[name] };
  if (typeof mod.default === 'function') return { name: 'default', fn: mod.default };
  return null;
}

function construct(fn, arg) {
  try { return new fn(arg); } catch { return fn(arg); }
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

/** 44 字节 WAV 头 + 16bit 正弦，够 ffprobe 报出时长。 */
function wavBuffer(seconds = 0.25) {
  const rate = 8000, count = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + count * 2);
  buf.write('RIFF'); buf.writeUInt32LE(buf.length - 8, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) buf.writeInt16LE(Math.round(3000 * Math.sin(i * 2 * Math.PI * 300 / rate)), 44 + i * 2);
  return buf;
}

function parseJson(buf) {
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

/** 起一个 loopback 假服务。routes 的 key 是 "METHOD /path"。 */
async function startFakeServer(routes) {
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://127.0.0.1');
      const entry = { method: req.method, path: url.pathname, search: url.search, headers: req.headers, body, json: parseJson(body) };
      calls.push(entry);
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) {
        json(res, 404, { error: { message: `假服务未定义 ${req.method} ${url.pathname}` } });
        return;
      }
      try { handler(entry, res, url); } catch (err) { json(res, 500, { error: { message: String(err && err.message) } }); }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    url: base,
    port,
    calls,
    hits: (key) => calls.filter((c) => `${c.method} ${c.path}` === key).length,
    last: (key) => calls.filter((c) => `${c.method} ${c.path}` === key).at(-1) || null,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** 每个测试独立临时 DW_AUDIO_HOME / DW_WORKSHOP_CONFIG。 */
async function sandbox(t, tag) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `dw-workshop-${tag}-`));
  const audioHome = path.join(dir, 'audio');
  const workshopConfig = path.join(dir, 'workshop.json');
  await mkdir(audioHome, { recursive: true });
  const prev = { audio: process.env.DW_AUDIO_HOME, workshop: process.env.DW_WORKSHOP_CONFIG };
  process.env.DW_AUDIO_HOME = audioHome;
  process.env.DW_WORKSHOP_CONFIG = workshopConfig;
  await writeFile(workshopConfig, JSON.stringify({ license: { requireCommercial: true, allowUnknown: false }, services: {} }, null, 2), 'utf8');
  t.after(async () => {
    if (prev.audio === undefined) delete process.env.DW_AUDIO_HOME; else process.env.DW_AUDIO_HOME = prev.audio;
    if (prev.workshop === undefined) delete process.env.DW_WORKSHOP_CONFIG; else process.env.DW_WORKSHOP_CONFIG = prev.workshop;
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, audioHome, workshopConfig };
}

async function writeAudioConfig(audioHome, config) {
  await writeFile(path.join(audioHome, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function writeWorkshopConfig(workshopConfig, config) {
  await writeFile(workshopConfig, JSON.stringify(config, null, 2), 'utf8');
}

// ---------- 服务条目（§1 的形状） ----------

const speechService = (url, over = {}) => ({
  protocol: 'openai-speech', url, model: 'kokoro', capabilities: ['speech'],
  license: { id: 'apache-2.0', commercial: true }, quality: 'production', ...over,
});
const imageService = (url, over = {}) => ({
  protocol: 'openai-image', url, model: 'qwen-image', capabilities: ['image'],
  license: { id: 'apache-2.0', commercial: true }, ...over,
});
const comfyService = (url, workflowFile, over = {}) => ({
  protocol: 'comfyui', url, capabilities: ['image', 'image_edit'],
  workflows: { image: workflowFile },
  inputs: { image: { prompt: '6.inputs.text', negative: '6.inputs.negative_text', seed: '3.inputs.seed', plate: '12.inputs.image' } },
  license: { id: 'apache-2.0', commercial: true }, quality: 'production', ...over,
});
const mcpService = (command, over = {}) => ({
  protocol: 'mcp-agent', command, tool: 'render_brief', capabilities: ['image'],
  license: { id: 'mit', commercial: true }, quality: 'draft', ...over,
});

// ---------- 四个假协议服务 ----------

function startSpeechFake() {
  return startFakeServer({
    'GET /v1/models': (c, res) => json(res, 200, { object: 'list', data: [{ id: 'kokoro', object: 'model' }] }),
    'POST /v1/audio/speech': (c, res) => { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(wavBuffer(0.25)); },
  });
}

async function startImageFake() {
  let fake = null;
  fake = await startFakeServer({
    'GET /v1/models': (c, res) => json(res, 200, { object: 'list', data: [{ id: 'qwen-image', object: 'model' }] }),
    'POST /v1/images/generations': (c, res) => json(res, 200, { created: 1, data: [{ b64_json: PNG_B64 }] }),
    'POST /v1/images/edits': (c, res) => json(res, 200, { created: 1, data: [{ url: `${fake.url}/files/plate-out.png` }] }),
    'GET /files/plate-out.png': (c, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); },
  });
  return fake;
}

function startComfyFake() {
  return startFakeServer({
    'GET /system_stats': (c, res) => json(res, 200, { system: { os: 'fake', ram_free: 1 }, devices: [{ name: 'fake-gpu' }] }),
    'GET /object_info': (c, res) => json(res, 200, { '6': { input: { required: {} } } }),
    'POST /upload/image': (c, res) => json(res, 200, { name: 'plate.png', subfolder: '', type: 'input' }),
    'POST /prompt': (c, res) => json(res, 200, { prompt_id: 'p-123', number: 1 }),
    'GET /history/p-123': (c, res) => json(res, 200, {
      'p-123': { status: { completed: true }, outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } },
    }),
    'GET /view': (c, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); },
  });
}

/**
 * 扮 MCP stdio agent 的小脚本（§2 mcp-agent 那一行）：
 *   initialize → tools/list 里有 render_brief → tools/call 造三个文件：
 *     agent-shot.png    在 outDir 里，报回去（应该被认）
 *     agent-stray.png   在 outDir 里，不报（多余文件，应该被删）
 *     agent-escape.png  在 outDir 外，报回去（越界，应该被丢弃并删除）
 */
const MCP_AGENT_SOURCE = `
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const PNG = Buffer.from('${PNG_B64}', 'base64');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.trim()) handle(line);
  }
});
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
function handle(line) {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'painter-fake', version: '0.1' } } });
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: [{ name: 'render_brief', description: '假 agent', inputSchema: { type: 'object', properties: { brief: {}, style: {}, outDir: { type: 'string' } }, required: ['brief', 'outDir'] } }] } });
  if (method === 'tools/call') {
    const args = (params && params.arguments) || {};
    const outDir = String(args.outDir || '');
    mkdirSync(outDir, { recursive: true });
    const good = path.join(outDir, 'agent-shot.png');
    const stray = path.join(outDir, 'agent-stray.png');
    const escape = path.join(path.dirname(outDir), 'agent-escape.png');
    writeFileSync(good, PNG); writeFileSync(stray, PNG); writeFileSync(escape, PNG);
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ files: [good, escape] }) }] } });
  }
  return send({ jsonrpc: '2.0', id, result: {} });
}
`;

async function writeFakeAgent(dir) {
  const file = path.join(dir, 'fake-agent.mjs');
  await writeFile(file, MCP_AGENT_SOURCE, 'utf8');
  return file;
}

// ---------- 适配器发现 ----------

const AUDIO_ADAPTER_NAMES = ['LocalServiceAudioAdapter', 'LocalServicesAudioAdapter', 'LocalServiceAdapter', 'LocalsvcAudioAdapter', 'LocalsvcAdapter', 'LocalSvcAdapter', 'createLocalServiceAudioAdapter', 'createLocalsvcAdapter'];
const IMAGE_ADAPTER_NAMES = ['LocalServiceProvider', 'LocalServicesProvider', 'LocalsvcProvider', 'LocalServiceImageProvider', 'createLocalServiceProvider', 'createLocalsvcProvider'];

/** assets 侧的 localsvc 按 providers/magpie.mjs 的约定：模块级 available(ctx) / make(brief, outPath, ctx)。 */
async function assetsLocalsvc() {
  const mod = await loadOptional('tools/assets/providers/localsvc.mjs');
  if (!mod) return null;
  if (typeof mod.make !== 'function') return null;
  return mod;
}

/** audio 侧的 localsvc 要么能自己 new，要么已由引擎按 config.local 注册进 registry。 */
async function audioLocalsvc(ctxConfig) {
  const mod = await loadOptional('tools/audio/providers/localsvc.mjs');
  const picked = pickExport(mod, AUDIO_ADAPTER_NAMES);
  if (!picked) return null;
  return construct(picked.fn, ctxConfig);
}

function localAdapters(engine) {
  try {
    return engine.registry.adapters().filter((p) => p && p.local === true && !['local', 'mock'].includes(p.id));
  } catch { return []; }
}

function assetCtx({ box, services, service, lock = null, key = 'K1' }) {
  return {
    config: { license: { requireCommercial: true, allowUnknown: false }, services, critic: null },
    services, service, lock, key,
    fetch: globalThis.fetch,
    log: () => {},
  };
}

// =====================================================================
// §5.1 无任何本地服务配置时，现有流程与测试不变
// =====================================================================

test('没有登记任何本地服务时，planRun 与声音引擎的既有行为一笔不变', async (t) => {
  const box = await sandbox(t, 'no-local');

  const run = await loadOptional('tools/assets/run.mjs');
  if (!need(t, run && typeof run.planRun === 'function', '等 t8：tools/assets/run.mjs 未落地')) return;

  const briefs = [
    { key: 'K1', kind: 'image', prompt: '山间小路' },
    { key: 'K2', kind: 'voice', prompt: '旁白' },
  ];
  const manifest = { assets: {} };
  const bare = run.planRun(manifest, briefs, {});
  const withEmptyWorkshop = run.planRun(manifest, briefs, {});
  assert.deepEqual(withEmptyWorkshop, bare, 'planRun 必须是纯函数：同一输入两次结果逐字一致');
  // 工坊配置存在但 services 为空：形状与完全不配置时一致
  const emptyServices = JSON.parse(await readFile(box.workshopConfig, 'utf8'));
  assert.deepEqual(emptyServices.services, {}, '§5.1：没有本地服务时 services 就是空对象');
  const afterEmpty = run.planRun(manifest, briefs, {});
  assert.deepEqual(afterEmpty, bare, '空 services 的工坊配置不能改变 planRun 的结果');

  const engineMod = await loadOptional('tools/audio/engine.mjs');
  const mockMod = await loadOptional('tools/audio/providers/mock.mjs');
  if (!need(t, engineMod && mockMod && typeof engineMod.createAudioEngine === 'function' && typeof mockMod.MockProvider === 'function', '等 t10：tools/audio/engine.mjs 或 providers/mock.mjs 未落地')) return;

  await writeAudioConfig(box.audioHome, { mode: 'auto', mock: { enabled: false }, local: { services: {} } });
  const engine = engineMod.createAudioEngine({ home: box.audioHome, providers: [new mockMod.MockProvider({ id: 'mock' })] });
  const out = await engine.generate_speech({ text: '乱世里怎么选' });
  assert.equal(out.status, 'succeeded', '空 local.services 时声音引擎仍应照常出活');
  assert.ok(out.file && existsSync(out.file), '既有流程仍然落盘一个文件');
});

// =====================================================================
// §5.2 四种协议各一个 loopback 假服务，能生成并落盘；探活与 doctor 能列出
// =====================================================================

test('四种协议各有一个 loopback 假服务：能生成落盘、能探活、doctor 能列出', async (t) => {
  const box = await sandbox(t, 'protocols');
  await mkdir(path.join(box.dir, 'out'), { recursive: true });
  await mkdir(path.join(box.dir, 'flows'), { recursive: true });
  const workflowFile = path.join(box.dir, 'flows', 'image.json');
  await writeFile(workflowFile, JSON.stringify({
    '6': { class_type: 'TextEncode', inputs: { text: '', negative_text: '' } },
    '3': { class_type: 'KSampler', inputs: { seed: 0 } },
    '12': { class_type: 'LoadImage', inputs: { image: '' } },
    '9': { class_type: 'SaveImage', inputs: {} },
  }), 'utf8');

  // ---- openai-speech ----
  await t.test('openai-speech：探活 + 生成落盘', async (t2) => {
    const fake = await startSpeechFake();
    t2.after(() => fake.close());
    const config = { license: { requireCommercial: true }, local: { services: { kokoro: speechService(fake.url) } } };
    await writeAudioConfig(box.audioHome, config);

    const engineMod = await loadOptional('tools/audio/engine.mjs');
    if (!need(t2, engineMod && typeof engineMod.createAudioEngine === 'function', '等 t10：tools/audio/engine.mjs 未落地')) return;

    const adapter = await audioLocalsvc(config.local);
    const engine = engineMod.createAudioEngine({
      home: box.audioHome,
      mode: 'auto',
      config,
      ...(adapter ? { providers: [adapter] } : {}),
    });
    if (adapter) {
      const alive = await adapter.available({ config, mode: 'auto', fetch: globalThis.fetch });
      assert.equal(alive.ok, true, '假服务在跑，localsvc 应当探活成功');
      assert.equal(fake.hits('GET /v1/models') >= 1, true, '探活应该打 GET /v1/models');
    } else if (!need(t2, localAdapters(engine).length > 0, '等 sim2 t15：tools/audio/providers/localsvc.mjs 未落地（或引擎未注册这一行）')) {
      return;
    }

    const out = await engine.generate_speech({ text: '大梁的风很冷', service: 'kokoro' });
    assert.equal(out.status, 'succeeded', '本地 openai-speech 服务应当出活');
    assert.ok(out.file && existsSync(out.file), '生成结果要落盘');
    assert.ok(fake.hits('POST /v1/audio/speech') >= 1, '假服务应当收到 POST /v1/audio/speech');
    const body = fake.last('POST /v1/audio/speech')?.json;
    assert.ok(body && typeof body.input === 'string' && body.input.includes('大梁'), '请求体要带 input 文本');
    assert.equal(body.model, 'kokoro', '请求体要带登记的 model');
    assert.ok(body.voice, '请求体要带 voice');
    assert.equal(out.cost?.estimated, 0, '本地服务价格是 0（§0.5 local-free）');
  });

  // ---- openai-image ----
  await t.test('openai-image：探活 + b64 生成落盘 + 带 plate 走 edits', async (t2) => {
    const fake = await startImageFake();
    t2.after(() => fake.close());
    const services = { 'gpu-box': imageService(fake.url) };
    const mod = await assetsLocalsvc();
    if (!need(t2, mod, '等 sim2 t15：tools/assets/providers/localsvc.mjs 未落地')) return;

    const plate = path.join(box.dir, 'plate.png');
    await writeFile(plate, PNG);
    const brief = { key: 'IMG1', kind: 'image', prompt: '山间小路', service: 'gpu-box' };
    const outPath = path.join(box.dir, 'out', 'IMG1.png');

    const ctx = assetCtx({ box, services, service: 'gpu-box', key: 'IMG1', lock: { plateKey: 'plate.png' } });
    const made = await mod.make(brief, outPath, ctx);
    assert.ok(existsSync(outPath), '假 openai-image 服务出的图要落盘');
    assert.notEqual(made?.fallback, true, '本地服务成功时不能是 fallback');
    assert.ok(fake.hits('POST /v1/images/generations') >= 1, '无 plate 时应打 /v1/images/generations');

    const withPlateKey = 'IMG2';
    const outPlate = path.join(box.dir, 'out', 'IMG2.png');
    const ctxPlate = assetCtx({
      box, services, service: 'gpu-box', key: withPlateKey,
      lock: { plateKey: plate, palette: ['#334455'], negative: ['现代楼'], seedBase: 7, voices: {}, loudness: -16 },
    });
    await mod.make({ key: withPlateKey, kind: 'image', prompt: '城门', service: 'gpu-box' }, outPlate, ctxPlate);
    assert.ok(existsSync(outPlate), '带 plate 的图也要落盘');
    const edits = fake.last('POST /v1/images/edits');
    assert.ok(edits, '§2/§5.7：有 plate 时必须走 /v1/images/edits（plate 作 image）');
    assert.match(String(edits.headers['content-type'] || ''), /multipart\/form-data/, 'plate 必须以 multipart 上传');
    assert.ok(edits.body.length > PNG.length, 'multipart 请求体里应当带上 plate 的字节');
  });

  // ---- comfyui ----
  await t.test('comfyui：/prompt → /history → /view 能出图', async (t2) => {
    const fake = await startComfyFake();
    t2.after(() => fake.close());
    const services = { comfy: comfyService(fake.url, workflowFile) };
    const mod = await assetsLocalsvc();
    if (!need(t2, mod, '等 sim2 t15：tools/assets/providers/localsvc.mjs 未落地')) return;

    const brief = { key: 'CF1', kind: 'image', prompt: '城门口的雨', service: 'comfy' };
    const outPath = path.join(box.dir, 'out', 'CF1.png');
    const ctx = assetCtx({
      box, services, service: 'comfy', key: 'CF1',
      lock: { plateKey: path.join(box.dir, 'plate.png'), palette: ['#334455'], negative: ['现代楼'], seedBase: 7, voices: {}, loudness: -16 },
    });
    const made = await mod.make(brief, outPath, ctx);
    assert.ok(existsSync(outPath), 'ComfyUI 假服务出的图要落盘');
    assert.notEqual(made?.fallback, true, '本地服务成功时不能是 fallback');
    assert.ok(fake.hits('POST /prompt') >= 1, '应当 POST /prompt');
    assert.ok(fake.hits('GET /history/p-123') >= 1, '应当轮询 /history/{prompt_id}');
    assert.ok(fake.hits('GET /view') >= 1, '应当用 /view 取文件');
    assert.ok(fake.hits('GET /system_stats') + fake.hits('POST /prompt') >= 1, '探活或生成至少打过一次假服务');
  });

  // ---- mcp-agent ----
  await t.test('mcp-agent：stdio 假 agent 经 tools/call 出图', async (t2) => {
    const agent = await writeFakeAgent(box.dir);
    const mcp = await loadOptional('tools/local/mcp.mjs');
    if (!need(t2, mcp, '等 sol t17：tools/local/mcp.mjs 未落地')) return;

    const service = mcpService(['node', agent]);
    const ctx = assetCtx({ box, services: { painter: service }, service: 'painter', key: 'MCP1' });

    const probe = await mcp.probeAgent(service, ctx);
    assert.equal(probe?.ok, true, 'tools/list 里有 render_brief，探活应当成功');

    const outDir = path.join(box.dir, 'out', 'mcp1');
    await mkdir(outDir, { recursive: true });
    const res = await mcp.callAgent(service, { brief: { key: 'MCP1', kind: 'image', prompt: '雨夜' }, style: { palette: ['#222'] }, outDir }, ctx);
    const files = res?.files || [];
    assert.ok(files.some((f) => path.resolve(f) === path.join(outDir, 'agent-shot.png')), 'outDir 内的产物要认');
    assert.ok(files.every((f) => path.resolve(f).startsWith(path.resolve(outDir) + path.sep)), '返回的每个路径都必须在 outDir 内');
  });

  // ---- doctor ----
  await t.test('doctor --json 能列出已登记服务且零写入', async (t2) => {
    const speech = await startSpeechFake();
    const comfy = await startComfyFake();
    t2.after(() => { speech.close(); comfy.close(); });

    const doctorPath = path.join(ROOT, 'tools/local/doctor.mjs');
    if (!need(t2, existsSync(doctorPath), '等 sol t17：tools/local/doctor.mjs 未落地')) return;

    await writeWorkshopConfig(box.workshopConfig, {
      license: { requireCommercial: true, allowUnknown: false },
      services: { kokoro: speechService(speech.url), comfy: comfyService(comfy.url, workflowFile) },
    });
    const before = (await stat(box.workshopConfig)).mtimeMs;

    const proc = spawn(process.execPath, [doctorPath, '--config', box.workshopConfig, '--json'], { cwd: ROOT });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    const code = await new Promise((resolve) => proc.on('close', resolve));
    assert.equal(code, 0, `doctor 应当正常退出；stderr=${stderr}`);
    const report = parseJson(Buffer.from(stdout));
    assert.ok(report, `doctor --json 应当输出 JSON；stdout=${stdout.slice(0, 400)}`);
    const text = JSON.stringify(report);
    assert.ok(text.includes('kokoro') && text.includes('comfy'), 'doctor 报告里要列出已登记的两个服务');
    assert.ok(speech.hits('GET /v1/models') + comfy.hits('GET /system_stats') >= 1, 'doctor 应当逐个探活已登记服务');
    assert.equal((await stat(box.workshopConfig)).mtimeMs, before, '§3：doctor 零写入');
  });
});

// =====================================================================
// §5.3 公网被拒；私网仅在 allowLan:true 时放行；重定向被拒
// =====================================================================

test('地址规则：公网拒绝、私网要 allowLan、重定向不跟随', async (t) => {
  const box = await sandbox(t, 'addr');
  const net = await loadOptional('tools/local/net.mjs');
  if (!need(t, net, '等 sol t17：tools/local/net.mjs 未落地')) return;

  const validator = pickExport(net, ['assertLocalUrl', 'checkUrl', 'validateUrl', 'checkLocalUrl', 'assertAddress']);
  const client = pickExport(net, ['request', 'fetchLocal', 'httpRequest', 'getJson', 'fetchJson', 'httpGet']);

  /** 校验器可能抛（code 'config'）也可能返回 {ok:false, code:'config'}，两种都算拒绝。 */
  const rejection = (fn) => {
    try {
      const out = fn();
      if (out && typeof out.then === 'function') return out.then((v) => (v === false || v?.ok === false ? true : (v?.ok === true ? false : Boolean(v?.error || v?.code))));
      if (out === false) return true;
      if (out && typeof out === 'object') return out.ok === false || Boolean(out.error || out.code);
      return false;
    } catch (err) {
      return true;
    }
  };

  if (validator) {
    const check = (service, policy) => rejection(() => validator.fn(service.url, { ...service, ...(policy || {}) }));
    assert.equal(await check({ url: 'https://example.com:443' }), true, '公网地址一律拒绝');
    assert.equal(await check({ url: 'http://192.168.1.20:9000' }), true, '非 allowLan 时私网拒绝');
    assert.equal(await check({ url: 'http://192.168.1.20:9000', allowLan: true }), false, 'allowLan:true 时私网放行');
    assert.equal(await check({ url: 'http://127.0.0.1:8880' }), false, 'loopback 放行');
    assert.equal(await check({ url: 'http://localhost:8880' }), false, 'localhost 放行');
    assert.equal(await check({ url: 'http://[::1]:8880' }), false, '[::1] 放行');
    assert.equal(await check({ url: 'http://user:pass@127.0.0.1:8880' }), true, 'URL 不许带用户名密码');
  }

  // ---- 重定向：loopback → loopback 也不许跟 ----
  if (!need(t, client, '等 sol t17：tools/local/net.mjs 还没有约定名下的 HTTP 客户端（request/fetchLocal/httpGet）')) return;
  const target = await startFakeServer({ 'GET /v1/models': (c, res) => json(res, 200, { object: 'list', data: [] }) });
  const hop = await startFakeServer({
    'GET /v1/models': (c, res) => { res.writeHead(302, { location: `${target.url}/v1/models` }); res.end(); },
  });
  t.after(() => { hop.close(); target.close(); });

  let threw = false;
  try { await client.fn(`${hop.url}/v1/models`, { method: 'GET' }); } catch { threw = true; }
  assert.equal(hop.hits('GET /v1/models'), 1, '应当只请求了第一跳');
  assert.equal(target.calls.length, 0, '重定向一律拒绝：不许跟着跳到第二跳');
  assert.equal(threw, true, '被拒的重定向应当以错误收场，而不是把 302 当成结果');
});

// =====================================================================
// §5.4 授权：commercial:false 不可用且 action 说明原因；"unknown" 默认不可用
// =====================================================================

test('授权闸门：非商用的服务不可用且说明原因，"unknown" 默认不放行', async (t) => {
  await sandbox(t, 'license');
  const mod = await loadOptional('tools/local/license.mjs');
  if (!need(t, mod && typeof mod.checkLicense === 'function', '等 sol t17：tools/local/license.mjs 未落地')) return;

  const policy = { requireCommercial: true, allowUnknown: false };

  const nonCommercial = mod.checkLicense({ license: { id: 'cc-by-nc-4.0', commercial: false } }, policy);
  assert.equal(nonCommercial.ok, false, '非商用服务不可用');
  assert.equal(typeof nonCommercial.action === 'string' && nonCommercial.action.trim().length > 0, true, '不可用必须给出为什么（action）');
  assert.equal(nonCommercial.license?.id, 'cc-by-nc-4.0', '把判定依据的 license 一并带回来');

  const unknownDefault = mod.checkLicense({ license: { id: 'unknown', commercial: 'unknown' } }, policy);
  assert.equal(unknownDefault.ok, false, '协议/授权未知的服务默认不可用');
  assert.ok(String(unknownDefault.action || '').trim().length > 0, '未知也要说明原因');

  const unknownAllowed = mod.checkLicense({ license: { id: 'unknown', commercial: 'unknown' } }, { requireCommercial: true, allowUnknown: true });
  assert.equal(unknownAllowed.ok, true, 'allowUnknown:true 才放行未知服务');

  const commercial = mod.checkLicense({ license: { id: 'apache-2.0', commercial: true } }, policy);
  assert.equal(commercial.ok, true, '商业可用的服务放行');

  const missing = mod.checkLicense({}, policy);
  assert.equal(missing.ok, false, '没写 license 条目一律当未知，默认不可用');
});

// =====================================================================
// §5.5 local-only：用本地服务成功，且对外 fetch 计数为 0（loopback 之外）
// =====================================================================

test('local-only 模式下本地服务能出活，且对外 fetch 计数为 0', async (t) => {
  const box = await sandbox(t, 'local-only');
  const fake = await startSpeechFake();
  t.after(() => fake.close());

  const engineMod = await loadOptional('tools/audio/engine.mjs');
  if (!need(t, engineMod && typeof engineMod.createAudioEngine === 'function', '等 t10：tools/audio/engine.mjs 未落地')) return;

  const config = { license: { requireCommercial: true }, local: { services: { kokoro: speechService(fake.url) } } };
  await writeAudioConfig(box.audioHome, config);

  const spy = [];
  const rawFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    spy.push(href);
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(href)) throw new Error(`local-only 不许外呼：${href}`);
    return rawFetch(url, init);
  };
  t.after(() => { globalThis.fetch = rawFetch; });

  const engine = engineMod.createAudioEngine({ home: box.audioHome, mode: 'local-only', config, fetch: globalThis.fetch });
  if (!need(t, localAdapters(engine).length > 0, '等 sim2 t15：引擎没有按 config.local 注册 localsvc 适配器')) return;

  const out = await engine.generate_speech({ text: 'local-only 也要能出声', service: 'kokoro' });
  assert.equal(out.status, 'succeeded', 'local-only 下本地服务应当出活');
  assert.ok(out.file && existsSync(out.file), 'local-only 的产物也要落盘');
  const outside = spy.filter((href) => !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(href));
  assert.deepEqual(outside, [], 'local-only 下 loopback 之外的外呼计数必须是 0');
});

// =====================================================================
// §5.6 mcp-agent 返回 outDir 外的路径 → 丢弃并报 provider；多余文件被删
// =====================================================================

test('mcp-agent 越界：outDir 外的产物被丢弃删除，outDir 内多余文件被删', async (t) => {
  const box = await sandbox(t, 'mcp-escape');
  const agentDir = path.join(box.dir, 'agent');
  await mkdir(agentDir, { recursive: true });
  const agent = await writeFakeAgent(agentDir);

  const mcp = await loadOptional('tools/local/mcp.mjs');
  if (!need(t, mcp, '等 sol t17：tools/local/mcp.mjs 未落地')) return;

  const service = mcpService(['node', agent]);
  const ctx = assetCtx({ box, services: { painter: service }, service: 'painter', key: 'MCP2' });
  const outDir = path.join(box.dir, 'out', 'mcp2');
  await mkdir(outDir, { recursive: true });

  const escape = path.join(box.dir, 'out', 'agent-escape.png');
  const stray = path.join(outDir, 'agent-stray.png');

  let res = null, err = null;
  try { res = await mcp.callAgent(service, { brief: { key: 'MCP2', kind: 'image', prompt: '越界' }, style: {}, outDir }, ctx); } catch (e) { err = e; }

  const files = (res?.files || []).map((f) => path.resolve(f));
  assert.ok(!files.includes(path.resolve(escape)), 'outDir 外的路径必须被丢弃');
  assert.equal(existsSync(escape), false, 'outDir 外的产物必须被删除');
  assert.equal(existsSync(stray), false, 'outDir 内没被认领的多余文件必须被删');
  if (err) {
    const code = err.code || (typeof err.toJSON === 'function' ? err.toJSON()?.code : null);
    assert.equal(code, 'provider', '越界要报 provider 错误');
    assert.ok(String(err.action || err.toJSON?.().action || '').trim().length > 0, 'provider 错误要给出下一步（action）');
  } else {
    assert.ok(files.includes(path.resolve(outDir, 'agent-shot.png')), '正常的那个产物仍然要认');
  }
});

// =====================================================================
// §5.7 风格锁进请求（plate/seed/negative）；同一 key 两次 seed 相同
// =====================================================================

test('风格锁随单走：plate/seed/negative 进入 ComfyUI 请求，同一 key 两次 seed 相同', async (t) => {
  const box = await sandbox(t, 'lock');
  const fake = await startComfyFake();
  t.after(() => fake.close());
  await mkdir(path.join(box.dir, 'out'), { recursive: true });

  const workflowFile = path.join(box.dir, 'flow.json');
  await writeFile(workflowFile, JSON.stringify({
    '6': { class_type: 'TextEncode', inputs: { text: '', negative_text: '' } },
    '3': { class_type: 'KSampler', inputs: { seed: 0 } },
    '12': { class_type: 'LoadImage', inputs: { image: '' } },
    '9': { class_type: 'SaveImage', inputs: {} },
  }), 'utf8');
  const plate = path.join(box.dir, 'plate.png');
  await writeFile(plate, PNG);

  const mod = await assetsLocalsvc();
  if (!need(t, mod, '等 sim2 t15：tools/assets/providers/localsvc.mjs 未落地')) return;

  const services = { comfy: comfyService(fake.url, workflowFile) };
  const lock = { plateKey: plate, palette: ['#334455', '#8899aa'], negative: ['现代建筑', '霓虹灯'], seedBase: 4242, voices: {}, loudness: -16 };
  const brief = { key: 'LOCK1', kind: 'image', prompt: '城门下的人', service: 'comfy' };

  await mod.make(brief, path.join(box.dir, 'out', 'LOCK1.png'), assetCtx({ box, services, service: 'comfy', key: 'LOCK1', lock }));
  await mod.make(brief, path.join(box.dir, 'out', 'LOCK1b.png'), assetCtx({ box, services, service: 'comfy', key: 'LOCK1', lock }));

  const posts = fake.calls.filter((c) => `${c.method} ${c.path}` === 'POST /prompt');
  assert.equal(posts.length, 2, '同一个 key 跑两次应当有两次 /prompt');
  const flow = posts[0].json?.prompt;
  assert.ok(flow, '/prompt 要带 workflow（API 格式）');
  assert.ok(String(flow['6'].inputs.text || '').includes('城门下的人'), 'prompt 要填进 inputs 指定的路径');
  assert.ok(String(flow['6'].inputs.negative_text || '').trim().length > 0, 'negative 要填进 inputs 指定的路径');
  assert.equal(posts[0].json.client_id != null, true, '/prompt 要带 client_id');
  const seed1 = flow['3'].inputs.seed;
  const seed2 = posts[1].json?.prompt['3'].inputs.seed;
  assert.equal(typeof seed1, 'number', 'seed 必须是数字');
  assert.equal(seed1, seed2, '§5.7：同一导演同一作品的同一 key，seed 必须可复现');
  assert.ok(String(flow['12'].inputs.image || '').trim().length > 0, 'plate 要进请求（本地文件先上传或直接给路径）');
  assert.ok(fake.hits('GET /view') >= 2, '两次都要把产物取回来');
});

// =====================================================================
// §5.8 审片：超差 → redo；重做仍超 → reject；critic 低分 → redo；缺 ffmpeg/critic → skipped
// =====================================================================

test('导演审片：时长超差判 redo，重做仍超判 reject，critic 低分判 redo，缺工具记 skipped', async (t) => {
  const box = await sandbox(t, 'review');
  await mkdir(path.join(box.dir, 'out'), { recursive: true });
  const mod = await loadOptional('tools/assets/review.mjs');
  if (!need(t, mod && typeof mod.review === 'function', '等 kernel2 t16：tools/assets/review.mjs 未落地')) return;
  assert.equal(typeof mod.default?.review, 'function', 'review.mjs 也要有默认导出（review 在内）');

  // 量具用假的，这一组才不取决于开发机装没装 ffmpeg/ffprobe。
  // 两条假命令写成 /bin/sh 脚本（不依赖 node 在哪）：假 ffprobe 报 0.25s（图片报 1536x1024），
  // 假 ffmpeg 在取平均色那条路上吐 3 字节 RGB(#334455)，在量响度那条路上往 stderr 报 -30 LUFS。
  // 真实签名是 review(brief, file, lock, opts)：规格在 brief.spec（seconds/size/quality），
  // 重做次数由 opts.{attempt,maxRedo} 给。
  const binDir = path.join(box.dir, 'bin');
  await mkdir(binDir, { recursive: true });
  const fakeProbe = path.join(binDir, 'ffprobe');
  await writeFile(fakeProbe, `#!/bin/sh
for a in "$@"; do last="$a"; done
case "$last" in
	*.png|*.jpg|*.jpeg|*.webp) printf '%s' '{"streams":[{"width":1536,"height":1024}],"format":{"format_name":"png"}}' ;;
	*) printf '%s' '{"streams":[],"format":{"duration":"0.25","format_name":"wav"}}' ;;
esac
`, { mode: 0o755 });
  const fakeFfmpeg = path.join(binDir, 'ffmpeg');
  await writeFile(fakeFfmpeg, `#!/bin/sh
case " $* " in
	*" scale=1:1 "*) printf '\\063\\104\\125' ;;
	*) printf '  I: -30.0 LUFS\\n' >&2 ;;
esac
`, { mode: 0o755 });
  const tools = { ffprobe: fakeProbe, ffmpeg: fakeFfmpeg };

  const shortFile = path.join(box.dir, 'out', 'V1.wav');
  await writeFile(shortFile, wavBuffer(0.25));   // 规格 5 秒，实际 0.25 秒：远超声纳 ±20%
  const brief = { key: 'V1', kind: 'voice', why: '旁白', spec: { prompt: '旁白', seconds: 5, quality: 'generated' } };
  const lock = { plateKey: null, palette: ['#334455'], negative: [], seedBase: 1, voices: {}, loudness: -16 };
  const verdicts = new Set(['accept', 'redo', 'reject']);

  const first = await mod.review(brief, shortFile, lock, tools);
  assert.ok(verdicts.has(first.verdict), `verdict 只能是 accept/redo/reject，实际 ${first.verdict}`);
  assert.equal(first.verdict, 'redo', '时长不在 spec ±20% 内、还有一次重做机会 → redo');
  assert.equal(typeof first.why, 'string', 'why 要说清退在哪');
  assert.ok(Array.isArray(first.checks) && first.checks.length > 0, 'checks 要逐项列出');
  for (const c of first.checks) {
    assert.equal(typeof c.name, 'string', '每条 check 要有 name');
    assert.equal(typeof c.ok, 'boolean', '每条 check 要有 ok');
    assert.ok('value' in c && 'expect' in c, '每条 check 要有 value 与 expect');
  }
  const durationCheck = first.checks.find((c) => c.name === 'duration');
  assert.ok(durationCheck, '必须有一条量时长的 check');
  assert.equal(durationCheck.ok, false, '时长超差这条要判 false');
  assert.equal(first.critic, undefined, '没配评审模型时不留 critic 记录');

  // 第几次重做、还能重做几次，由调用方给：attempt > maxRedo 才 reject
  const retry = await mod.review(brief, shortFile, lock, { ...tools, attempt: 1, maxRedo: 1 });
  assert.equal(retry.verdict, 'redo', '第 1 次尝试、允许重做 1 次 → redo');
  const second = await mod.review(brief, shortFile, lock, { ...tools, attempt: 2, maxRedo: 1 });
  assert.equal(second.verdict, 'reject', '重做一次还是超差（attempt 2 > maxRedo 1）→ reject');
  assert.match(second.why, /重做/, 'reject 的 why 要说明重做次数已经用完');

  // 没配量具：对应检查记 skipped，不算失败 → 其余都过就该收下
  const offline = await mod.review(brief, shortFile, lock, { ffprobe: false, ffmpeg: false });
  assert.ok(offline.checks.some((c) => c.skipped === true), '缺 ffmpeg / ffprobe 时对应检查要记 skipped');
  assert.equal(offline.verdict, 'accept', 'skipped 不是失败：量不出来不能拦着收下');

  // critic 注入 fetch：低分 → redo，高分 → accept（评审配置走 opts.critic，图片才有视觉评审）
  const criticCalls = [];
  const criticFetch = (score) => async (url) => {
    criticCalls.push(String(url));
    const payload = { choices: [{ message: { content: JSON.stringify({ score, reason: '色调不像同一位导演' }) } }] };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  const seen = path.join(box.dir, 'out', 'bright.png');
  await writeFile(seen, PNG);
  const plate = path.join(box.dir, 'out', 'PLATE.png');
  await writeFile(plate, PNG);
  const imageBrief = { key: 'P1', kind: 'image', why: '城门', spec: { prompt: '城门', size: '1536x1024', quality: 'generated' } };
  const imageLock = { plateKey: 'PLATE-1', palette: ['#334455'], negative: [], seedBase: 1, voices: {}, loudness: -16, words: ['低饱和', '留白'] };
  const withCritic = { ...tools, critic: { url: 'http://127.0.0.1:9/', model: 'qwen-vl', threshold: 0.6 }, plates: { 'PLATE-1': plate } };

  const low = await mod.review(imageBrief, seen, imageLock, { ...withCritic, fetch: criticFetch(0.2) });
  assert.equal(criticCalls.length, 1, '配了评审模型就要问一次');
  assert.ok(criticCalls[0].endsWith('/v1/chat/completions'), `评审要打到 OpenAI 兼容的 chat/completions，实际 ${criticCalls[0]}`);
  const criticCheck = low.checks.find((c) => c.name === 'critic');
  assert.ok(criticCheck, '评审结果要进 checks');
  assert.equal(criticCheck.ok, false, '0.2 < threshold 0.6 → 这条判 false');
  assert.equal(low.verdict, 'redo', 'critic 低于 threshold(0.6) → redo');
  assert.equal(low.critic?.score, 0.2, 'review 结果里要留 critic 分数');
  assert.equal(low.critic?.ok, false, 'critic 留痕要带上 ok');

  const high = await mod.review(imageBrief, seen, imageLock, { ...withCritic, fetch: criticFetch(0.95) });
  assert.equal(high.verdict, 'accept', 'critic 高分、确定性检查全过 → accept');
  assert.equal(high.critic?.ok, true, '高分时 critic 留痕要 ok:true');
});

// =====================================================================
// §5.9 账本里有 director.review，manifest 有 source 与 review
// =====================================================================

test('留痕：manifest 条目带 source 与 review，账本里有 director.review', async (t) => {
  const box = await sandbox(t, 'ledger');
  const run = await loadOptional('tools/assets/run.mjs');
  if (!need(t, run && typeof run.writeManifest === 'function' && typeof run.readManifest === 'function', '等 t8：tools/assets/run.mjs 的 writeManifest/readManifest 未落地')) return;

  await t.test('manifest 条目能带上 source 与 review 且原样读回', async () => {
    const file = path.join(box.dir, 'manifest.json');
    const manifest = {
      assets: {
        K1: {
          key: 'K1', kind: 'image', file: 'K1.png',
          source: { service: 'comfy', protocol: 'comfyui', model: 'qwen-image', license: { id: 'apache-2.0', commercial: true } },
          review: { verdict: 'accept', why: '时长与风格都过', checks: [{ name: 'format', ok: true, value: 'png', expect: 'png' }] },
          fallback: false,
        },
      },
    };
    run.writeManifest(manifest, file);
    const back = run.readManifest(file);
    assert.deepEqual(back.assets.K1.source, manifest.assets.K1.source, '§5.4：manifest 要留 source{service,protocol,model,license}');
    assert.equal(back.assets.K1.review.verdict, 'accept', '§5.4：manifest 要留 review{verdict,why,checks}');
    assert.ok(Array.isArray(back.assets.K1.review.checks), 'review.checks 要一起留下');
  });

  await t.test('一次真跑之后，账本里有 director.review（等 t15/t16 接线）', async (t2) => {
    const providers = Object.keys(run.PROVIDERS || {});
    const spec = await loadOptional('tools/local/mcp.mjs');
    if (!need(t2, providers.some((p) => /local|comfy|mcp|svc/i.test(p)) && spec, '等 sim2 t15：run.mjs 的 PROVIDERS 里还没有本地服务适配器（§6「engine/run 里注册这一行」）')) return;
    if (!need(t2, typeof run.main === 'function', '等 t8：tools/assets/run.mjs 没有可调用的 main()')) return;

    const agentDir = path.join(box.dir, 'agent');
    await mkdir(agentDir, { recursive: true });
    const agent = await writeFakeAgent(agentDir);
    const manifestFile = path.join(box.dir, 'run-manifest.json');
    await writeWorkshopConfig(box.workshopConfig, {
      license: { requireCommercial: true, allowUnknown: false },
      services: { painter: mcpService(['node', agent]) },
    });
    await run.main([
      '--manifest', manifestFile,
      '--briefs', path.join(box.dir, 'briefs.json'),
      '--only-missing', '--max', '1',
      '--service', 'painter',
    ].flatMap((v, i, arr) => (i > 0 && ['--manifest', '--briefs', '--max', '--service'].includes(arr[i - 1]) ? [] : [v])));

    const notes = [];
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.jsonl$/.test(entry.name)) {
          const text = await readFile(full, 'utf8');
          if (text.includes('director.review')) notes.push(full);
        }
      }
    };
    await walk(box.dir);
    if (!need(t2, notes.length > 0, '等 kernel2 t16：没找到带 director.review 的账本文件（run.mjs 尚未记这条）')) return;
    const text = await readFile(notes[0], 'utf8');
    assert.ok(text.includes('director.review'), '§5.9：账本里要有 director.review');
  });
});
