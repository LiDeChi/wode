// 导演手里的笔：把 stagecraft 开出的资产单（docs/ASSETS.md §3 的 Brief[]）真的生成出来。
//
//   node tools/assets/run.mjs --work qiefu --director lu [--kinds image,voice] [--max 20] [--dry] [--only-missing]
//                             [--audio-mode auto|local-only|cloud-quality|manual] [--confirm]
//
// 分工（docs/AUDIO.md 头部）：
//   · 图片（image）    → tools/assets/providers/ 的 magpie / litellm，这个工具直接调。
//   · 声音（voice/sfx/music）→ 一律交给 AudioEngine（tools/audio/engine.mjs 的 createAudioEngine），
//     run.mjs 自己不再直调任何声音服务：没配 key、价格未知、超预算这些判断都在引擎里。
//
// 流程（docs/ASSETS.md §4）：建会话 → 请一位导演 → 让他 dress 出这一部作品的全部单子 → 对照 manifest 算一遍账 →
// 按单生成（底版先做）→ 每条过一遍导演审片（docs/WORKSHOP.md §4.3：不过就重做，重做到头还不像就退回）→
// 每条生成完立刻写回 manifest → 结尾打一张汇总表。
//
// 三条硬规矩：
//   · 花钱和写文件只发生在这个工具里。演出（createPlay）和场景数据一条都不碰资产。
//   · 缺 key 不卡住：图片没有替身就记 unavailable 并报告；声音的占位档由 AudioEngine 自己出
//     （local/mock，质量标 'placeholder'），manifest 里 fallback:true —— 以后云端通了再跑一次就重做。
//   · 声音引擎还没就绪（t10 未落地）时，声音条目一律跳过并说明，**不回退**去直调服务。
//
// 每一条错误只记一笔、继续往下做，最后汇总；重试不超过一次（在 provider / 引擎内部）。

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createSession } from '../../shared/engine/session.js';
import { ensureDir, scrub } from './providers/util.mjs';
import { review } from './review.mjs';
import * as magpie from './providers/magpie.mjs';
import * as litellm from './providers/litellm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
// 产物落在 web/assets/（manifest.json + gen/**）。测试想换个地方落地时可以 ASSETS_DIR=... 指过去。
const ASSETS_DIR = process.env.ASSETS_DIR ? path.resolve(process.env.ASSETS_DIR) : path.join(REPO, 'web', 'assets');
const MANIFEST_FILE = process.env.MANIFEST_FILE ? path.resolve(process.env.MANIFEST_FILE) : path.join(ASSETS_DIR, 'manifest.json');
const ENGINE_FILE = process.env.AUDIO_ENGINE ? path.resolve(process.env.AUDIO_ENGINE) : path.join(REPO, 'tools', 'audio', 'engine.mjs');
const AUDIO_HOME = () => process.env.DW_AUDIO_HOME || path.join(process.env.HOME || '.', '.digital-world', 'audio');

// 图片通道。声音走 AudioEngine，所以不在这张表里。
export const PROVIDERS = { magpie, litellm };
export const PROVIDER_CHAIN = { image: { official: ['magpie', 'litellm'], substitute: [] } };

/** 声音三类各自对应引擎的哪个方法（docs/AUDIO.md §2 §6） */
export const AUDIO = {
  voice: { capability: 'speech', api: 'generate_speech' },
  sfx: { capability: 'sfx', api: 'generate_sfx' },
  music: { capability: 'music', api: 'generate_music' },
};

// 这一部作品用哪套答案建会话：和 tests/fixtures/play-scripts.mjs 的 ANSWERS 一致。
// 导师按「雕琢」这一项挑人：A（重雕琢）挑到陆导 lu，B（放开）挑到单导 shan。
const NEED = '我想看一个人在乱世里怎么做选择';
const ANSWERS = {
  A: { wait: 0.8, polish: 0.8, depth: 0.85 },
  B: { wait: 0.2, polish: 0.2, depth: 0.25 },
};
export const DIRECTOR_ANS = { lu: 'A', shan: 'B' };

const isPlate = (brief) => brief?.kind === 'image' && brief?.spec?.role === 'plate';

/**
 * 服务出处（docs/WORKSHOP.md §4.4）：manifest 里每条都要写清是谁做的、按什么协议、什么授权。
 * provider 自己声明了就用它声明的，没声明就照实写 unknown —— 不替服务方猜授权。
 */
export const PROVIDER_SOURCE = {
  magpie: { protocol: 'openai-image', license: { id: 'gateway-unknown', commercial: 'unknown' } },
  litellm: { protocol: 'openai-image', license: { id: 'gateway-unknown', commercial: 'unknown' } },
};

export function sourceOf(item, entry) {
  const mod = PROVIDERS[item.provider];
  const declared = PROVIDER_SOURCE[item.provider] || {};
  const service = (entry && entry.provider) || item.provider || 'unknown';
  const protocol = (mod && mod.protocol) || declared.protocol || (AUDIO[item.kind] ? 'audio-engine' : 'unknown');
  const license = (entry && entry.license) || (mod && mod.license) || declared.license || { id: 'unknown', commercial: 'unknown' };
  return { service, protocol, model: (entry && entry.model) || '', license };
}

/** 评审模型的配置：调用方给的 > 环境变量 DW_ASSETS_CRITIC(JSON) > ~/.digital-world/workshop.json 的 critic */
export function loadCritic(opts = {}) {
  if (opts.noCritic) return null;
  if (opts.critic) return opts.critic;
  const raw = process.env.DW_ASSETS_CRITIC;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  try {
    const file = process.env.DW_WORKSHOP_CONFIG || path.join(process.env.HOME || '.', '.digital-world', 'workshop.json');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cfg.critic || null;
  } catch {
    return null;
  }
}

/** 这条重做要不要再问一次钱：本地档、免费、占位、明码 0 元 → 直接放行（§0.5） */
export function isFreeRetry(item, entry) {
  const mod = PROVIDERS[item.provider];
  if (mod && (mod.local === true || mod.free === true)) return true;
  if (!entry) return false;
  if (entry.priceSource === 'local-free') return true;
  if (entry.quality === 'placeholder') return true;
  if (entry.cost && entry.cost.estimated === 0) return true;
  return false;
}

/** 占位/替身条目：本地合成或 mock 出来的（quality:'placeholder'），或早期 say/synth 留下的 fallback:true */
export const isPlaceholder = (entry) => Boolean(entry && (entry.fallback === true || entry.quality === 'placeholder'));

/** 图片走这条：official 里第一个探活通过的 */
function pickImageProvider(available) {
  return PROVIDER_CHAIN.image.official.find((n) => available?.[n]?.ok) || null;
}

/**
 * 纯函数：算这一轮该做什么，不碰盘、不碰网、不看钟。
 *   manifest  —— manifest.json 的内容（可为空对象）；manifest.assets[key] 是已有条目
 *   briefs    —— 导演开的单子（stagecraft 的 Brief[]）
 *   available —— { providerName: { ok }, audio: { ok, cloud, note } }，各通道探活结果
 * 返回和 briefs 一一对应、顺序不变的清单，每条：
 *   { key, kind, action, provider, fallback, placeholder, capability?, reason, brief }
 * action 四种：
 *   skip        已经有了（正式版直接用；占位版而云端仍不通，也先用着）
 *   generate    还没有，现在开一张
 *   substitute  已有的是占位，现在云端通了 → 重做
 *   unavailable 这条没有可用通道（图片没替身；或者声音引擎还没就绪），跳过并报告
 */
export function planRun(manifest, briefs, available = {}) {
  const have = (manifest && manifest.assets) || {};
  return (briefs || []).map((brief) => {
    const key = brief?.key;
    const kind = brief?.kind;
    const entry = key ? have[key] : null;
    const base = { key, kind, brief };

    if (entry && !isPlaceholder(entry)) {
      return { ...base, action: 'skip', provider: entry.provider || null, fallback: false, placeholder: false, reason: 'manifest 里已有正式版本' };
    }

    const audio = AUDIO[kind];
    if (audio) {
      const a = available.audio || { ok: false, cloud: false, note: '声音引擎不可用' };
      const tag = { provider: 'audio', capability: audio.capability };
      if (!a.ok) {
        return { ...base, action: 'unavailable', provider: null, fallback: false, placeholder: false, capability: audio.capability, reason: a.note || '声音引擎不可用' };
      }
      if (entry) {
        if (a.cloud) {
          return { ...base, ...tag, action: 'substitute', fallback: false, placeholder: false, reason: `原先是占位（${entry.provider || '?'}），现在云端可用，重做` };
        }
        return { ...base, ...tag, action: 'skip', fallback: true, placeholder: true, reason: '云端还没通，继续用占位' };
      }
      return { ...base, ...tag, action: 'generate', fallback: !a.cloud, placeholder: !a.cloud, reason: `声音引擎可用 —— ${a.note || ''}` };
    }

    const official = pickImageProvider(available);
    if (entry) {
      if (official) {
        return { ...base, action: 'substitute', provider: official, fallback: false, placeholder: false, reason: `原先是 ${entry.provider || '?'}，现在换成 ${official}` };
      }
      return { ...base, action: 'skip', provider: entry.provider || null, fallback: false, placeholder: false, reason: '还没有可用通道，先留着' };
    }
    if (official) {
      return { ...base, action: 'generate', provider: official, fallback: false, placeholder: false, reason: `${official} 可用` };
    }
    return { ...base, action: 'unavailable', provider: null, fallback: false, placeholder: false, reason: `${kind} 没有可用通道（这一类型没有替身）` };
  });
}

export function parseArgs(argv = []) {
  const opts = {
    work: null, director: 'lu', kinds: null, max: null, dry: false, onlyMissing: false,
    help: false, json: false, audioMode: null, confirm: false,
    maxRedo: 1, noCritic: false, want: 'production', critic: null, ledger: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--work') opts.work = next();
    else if (a === '--director' || a === '--dir') opts.director = next();
    else if (a === '--kinds') opts.kinds = String(next() || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--max') opts.max = Number(next());
    else if (a === '--audio-mode') opts.audioMode = next();
    else if (a === '--max-redo') opts.maxRedo = Number(next());
    else if (a === '--no-critic') opts.noCritic = true;
    else if (a === '--draft') opts.want = 'draft';
    else if (a === '--ledger') opts.ledger = next();
    else if (a === '--confirm') opts.confirm = true;
    else if (a === '--dry') opts.dry = true;
    else if (a === '--only-missing') opts.onlyMissing = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`不认识的参数：${a}（--help 看用法）`);
  }
  if (!Number.isFinite(opts.maxRedo) || opts.maxRedo < 0) opts.maxRedo = 1;
  return opts;
}

const USAGE = `用法：node tools/assets/run.mjs --work <qiefu|weicheng> [--director lu|shan] [--kinds image,voice,sfx,music] [--max N] [--dry] [--only-missing]

  --work          哪一部作品（要 shared/scenes/<work>.js 存在），默认 qiefu
  --director      哪位导演：lu（陆导，重雕琢）或 shan（单导，放开），默认 lu
  --kinds         只做这几个类型
  --max N         这一轮最多真做 N 条（跳过的不算）
  --dry           只算账、打印计划，一个文件都不写、一次生成都不调
  --only-missing  只做还没有的（已经有的连占位重做也跳过）
  --audio-mode    透传给 AudioEngine：local-only | auto | cloud-quality | manual（默认引擎自己的 auto）
  --max-redo N    审片不过时最多重做几次（默认 1；0 = 一次不过就退回）
  --no-critic     这次不叫评审模型（只跑确定性检查）
  --draft         这一轮只当草稿看（quality:'draft' 的产物不算违约）
  --ledger FILE   把这一轮的会话账本（含每笔 director.review）写到 FILE，便于对账
  --confirm       允许价格未知或超过单次上限的付费调用（逐条打印估算再问；非交互环境一律拒绝）
  --json          结尾把汇总按 JSON 打出来（给脚本用）

图片走 tools/assets/providers/（magpie → litellm）；声音一律交给 tools/audio 的 AudioEngine。
每条生成完都过一遍导演审片（tools/assets/review.mjs）：不过就重做，重做到头还不像就退回、不算交付。`;

export function readManifest(file = MANIFEST_FILE) {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!m || typeof m !== 'object') return { assets: {} };
    if (!m.assets || typeof m.assets !== 'object') m.assets = {};
    return m;
  } catch {
    return { assets: {} };
  }
}

export function writeManifest(manifest, file = MANIFEST_FILE) {
  ensureDir(file);
  const ordered = {
    work: manifest.work,
    director: manifest.director,
    providerNote: manifest.providerNote,
    updatedAt: manifest.updatedAt,
    counts: manifest.counts,
    assets: manifest.assets || {},
    errors: manifest.errors && Object.keys(manifest.errors).length ? manifest.errors : undefined,
  };
  fs.writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`);
}

async function probeImages() {
  const out = {};
  for (const [name, mod] of Object.entries(PROVIDERS)) {
    try {
      out[name] = await mod.available();
    } catch (err) {
      out[name] = { ok: false, name, note: `探活失败：${scrub(err.message)}` };
    }
  }
  return out;
}

/**
 * 探一探声音引擎在不在、云端通不通。
 * t10 还没落地时 engine.mjs 不存在 —— 那就把声音条目跳过并明说，绝不回退去直调服务。
 */
async function probeAudio({ mode, confirm }) {
  try {
    const mod = await import(pathToFileURL(ENGINE_FILE).href);
    if (typeof mod.createAudioEngine !== 'function') throw new Error('tools/audio/engine.mjs 里没有 createAudioEngine');
    const engine = mod.createAudioEngine({
      home: AUDIO_HOME(),
      ...(mode ? { mode } : {}),
      authorize: makeAuthorize(confirm),
    });
    let models = [];
    try {
      models = (await engine.list_models()) || [];
    } catch {
      models = [];
    }
    const providers = [...new Set(models.map((m) => m && m.provider).filter(Boolean))];
    const cloudProviders = providers.filter((p) => !['local', 'mock'].includes(p));
    const cloud = cloudProviders.length > 0;
    return {
      ok: true,
      cloud,
      engine,
      models,
      note: cloud
        ? `就绪，云端可用（${cloudProviders.join('/')}）`
        : providers.length
          ? `就绪，但只有本地档（${providers.join('/')}）—— 产物会标 placeholder`
          : '就绪，但还没有可用模型（没配 key）—— 产物会是占位档',
    };
  } catch (err) {
    const code = err && err.code;
    const note = code === 'ERR_MODULE_NOT_FOUND' || code === 'ENOENT'
      ? '声音引擎还没就绪（缺 tools/audio/engine.mjs，t10 落地后自动接上）'
      : `声音引擎加载失败：${scrub(err && err.message ? err.message : err)}`;
    return { ok: false, cloud: false, engine: null, models: [], note };
  }
}

/** 授权钩子（docs/AUDIO.md §2 §6）：--confirm 才可能放行；非交互一律拒绝 */
function makeAuthorize(confirm) {
  return async (estimate) => {
    const c = (estimate && estimate.cost) || {};
    // 不花钱的调用不用问人：本地档 / 明码 0 元（docs/WORKSHOP.md §0.5）
    if (c.estimated === 0 || c.priceSource === 'local-free') return true;
    const money = c.estimated == null ? '价格未知' : `${c.estimated} ${c.currency || 'USD'}`;
    const who = `${(estimate && estimate.provider) || '?'} / ${(estimate && estimate.model) || '?'}`;
    if (!confirm) {
      console.log(`  这一条要确认才敢花钱：${who} ${money}（没给 --confirm，拒绝）`);
      return false;
    }
    console.log(`\n  估算：${who} ${money}${c.priceSource ? `（价格来源 ${c.priceSource}）` : ''}`);
    if (estimate && estimate.prompt) console.log(`  内容：${String(estimate.prompt).slice(0, 80)}`);
    if (!process.stdin.isTTY) {
      console.log('  非交互环境，问不了人，一律拒绝（docs/AUDIO.md §6）');
      return false;
    }
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('  确认付费生成？[y/N] ', (ans) => {
        rl.close();
        resolve(/^y(es)?$/i.test(String(ans).trim()));
      });
    });
  };
}

/** 重做也要过一次预算闸门（docs/WORKSHOP.md §4.3）：不花钱的放行，要花钱的走同一条授权钩子 */
async function gateRedo(item, entry, opts) {
  if (isFreeRetry(item, entry)) return true;
  return makeAuthorize(opts.confirm)({
    provider: (entry && entry.provider) || item.provider,
    model: (entry && entry.model) || '',
    prompt: item.brief?.spec?.prompt || item.brief?.spec?.text || '',
    cost: (entry && entry.cost) || { estimated: null, currency: 'USD', priceSource: 'unknown' },
  });
}

function makeSession(director) {
  const s = createSession();
  const ans = ANSWERS[DIRECTOR_ANS[director]];
  if (!ans) throw new Error(`不认识的导演：${director}（只有 ${Object.keys(DIRECTOR_ANS).join(' / ')}）`);
  s.meet(ans, NEED);
  if (s.state.directorId !== director) {
    // 导师按雕琢挑人；--director 说了算，直接换到指定的人（directors 是按 id 存的一张表）
    if (!s.directors[director]) throw new Error(`没有这位导演：${director}`);
    s.state.directorId = director;
  }
  const d = s.director();
  if (!d || d.id !== director) throw new Error(`没能让 ${director} 接手（现在是 ${s.state.directorId}）`);
  return s;
}

/** 按 work 动态取场景数据（会话不再静态依赖场景文件），整份递进去 */
async function loadScenes(work) {
  if (!/^[a-z0-9_-]+$/i.test(String(work || ''))) throw new Error(`作品名不合法：${work}`);
  const file = path.join(REPO, 'shared', 'scenes', `${work}.js`);
  if (!fs.existsSync(file)) throw new Error(`没有这部作品的场景数据：${work}（缺 shared/scenes/${work}.js）`);
  const mod = await import(pathToFileURL(file).href);
  if (!mod.SCENES || typeof mod.SCENES !== 'object') throw new Error(`shared/scenes/${work}.js 里没有导出 SCENES`);
  return mod.SCENES;
}

/** 执行顺序：底版 plate 先做（后面的图要拿它当参考），其余按导演开的顺序 */
function executeOrder(plan) {
  const plates = plan.filter((it) => isPlate(it.brief));
  const rest = plan.filter((it) => !isPlate(it.brief));
  return [...plates, ...rest];
}

const pad = (s, n) => String(s).padEnd(n);
const humanBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : b >= 1024 ? `${Math.round(b / 1024)}KB` : `${b || 0}B`);

/** 声音：按 brief 的 kind 交给引擎，参数照 docs/AUDIO.md §2 的名字 */
async function generateAudio(item, engine, outPath) {
  const spec = item.brief?.spec || {};
  if (item.capability === 'speech') {
    return engine.generate_speech({
      text: spec.text,
      voice_id: spec.voice || undefined,
      language: 'zh',
      rate: spec.rate,
      out: outPath,
    });
  }
  if (item.capability === 'sfx') {
    return engine.generate_sfx({ prompt: spec.prompt, duration: spec.seconds, out: outPath });
  }
  return engine.generate_music({ prompt: spec.prompt, duration: spec.seconds, instrumental: true, out: outPath });
}

/** 引擎的返回 → manifest 条目（docs/AUDIO.md §2 的统一结果 + §6 的 job_id/cost/quality） */
async function transferAudio(item, engine, outPath, opts, work) {
  const r = await generateAudio(item, engine, outPath);
  if (!r) throw new Error('声音引擎没有返回结果');
  if (r.error || r.status === 'failed') {
    const e = r.error || {};
    throw new Error(`[${e.code || 'provider'}] ${e.message || '声音生成失败'}${e.action ? ` —— ${e.action}` : ''}`);
  }
  const actual = r.file && fs.existsSync(r.file) ? r.file : outPath;
  if (!fs.existsSync(actual)) throw new Error(`声音引擎说好了，但盘上没有这个文件：${r.file || outPath}`);
  const quality = r.quality || (r.meta && r.meta.quality) || (['local', 'mock'].includes(r.provider) ? 'placeholder' : 'cloud');
  const entry = {
    kind: item.kind,
    file: path.relative(ASSETS_DIR, actual),
    director: opts.director,
    work,
    for: item.brief.for || {},
    spec: item.brief.spec || {},
    why: item.brief.why || '',
    provider: r.provider || 'audio',
    model: r.model || '',
    quality,
    fallback: quality === 'placeholder',
    bytes: fs.statSync(actual).size,
  };
  if (r.job_id) entry.job_id = r.job_id;
  if (r.cost) entry.cost = r.cost;
  if (r.seconds) entry.seconds = r.seconds;
  if (r.license) entry.license = r.license;
  if (r.voice_id) entry.voice_id = r.voice_id;
  return entry;
}

/**
 * 真做一条：声音交给引擎，图片交给 provider，返回 manifest 条目。
 * 抽成函数是为了审片不过时能原样再做一次（§4.3 的 redo）。
 */
async function generateEntry(it, { audio, done, opts, work, outPath, rel }) {
  ensureDir(outPath); // provider 可能直接让外部命令写这个路径，目录得先有
  if (AUDIO[it.kind]) {
    if (!audio.ok || !audio.engine) throw new Error(audio.note); // 不回退去直调声音服务
    return transferAudio(it, audio.engine, outPath, opts, work);
  }
  const ctx = {};
  const needPlate = it.brief?.spec?.plate;
  if (it.kind === 'image' && needPlate) {
    const p = done.get(needPlate);
    if (p && fs.existsSync(p)) ctx.platePath = p;
    else console.log(`  注意 ${it.key} 的底版 ${needPlate} 还没有，这张先不带上底版`);
  }
  const r = await PROVIDERS[it.provider].make(it.brief, outPath, ctx);
  const entry = {
    kind: it.kind,
    file: rel,
    director: opts.director,
    work,
    for: it.brief.for || {},
    spec: it.brief.spec || {},
    why: it.brief.why || '',
    provider: r.provider || it.provider,
    model: r.model || '',
    quality: 'generated',
    fallback: r.fallback === true,
    bytes: r.bytes || (fs.existsSync(outPath) ? fs.statSync(outPath).size : 0),
  };
  if (r.note) entry.note = r.note;
  if (r.seconds) entry.seconds = r.seconds;
  if (r.license) entry.license = r.license;
  return entry;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const work = opts.work || 'qiefu';

  const images = await probeImages();
  const audio = await probeAudio({ mode: opts.audioMode, confirm: opts.confirm });
  const available = { ...images, audio: { ok: audio.ok, cloud: audio.cloud, note: audio.note } };

  const session = makeSession(opts.director);
  const scenes = await loadScenes(work);
  const sheet = session.dress(work, scenes);

  let briefs = sheet.assets || [];
  if (opts.kinds) {
    const want = new Set(opts.kinds);
    briefs = briefs.filter((b) => want.has(b.kind));
  }

  const manifest = readManifest();
  manifest.work = work;
  manifest.director = opts.director;
  manifest.assets = manifest.assets || {};
  manifest.errors = manifest.errors || {};

  let plan = planRun(manifest, briefs, available);
  if (opts.onlyMissing) plan = plan.filter((it) => it.action !== 'skip');
  const todo = plan.filter((it) => it.action === 'generate' || it.action === 'substitute');
  let dropped = 0;
  if (Number.isFinite(opts.max) && opts.max >= 0 && todo.length > opts.max) {
    dropped = todo.length - opts.max;
    // 按真正的执行顺序取前 N 条（底版优先），其余这一轮不做
    const keep = new Set(executeOrder(todo).slice(0, opts.max).map((it) => it.key));
    plan = plan.filter((it) => it.action === 'skip' || keep.has(it.key));
  }

  // ---- 头顶：谁在开单、通道通不通 ----
  const dirName = session.director()?.def?.name || opts.director;
  // sheet.plate 是底版那张图的 key（字符串）
  const plateKey = typeof sheet.plate === 'string' ? sheet.plate : sheet.plate?.key || null;
  console.log(`\n${work} · 导演 ${opts.director}（${dirName}）`);
  console.log(`  这一部作品 ${briefs.length} 条单子（${Object.entries(sheet.counts).map(([k, v]) => `${k} ${v}`).join(' / ')}）`);
  console.log(`  底版 ${plateKey || '（无）'}`);
  for (const [name, a] of Object.entries(images)) {
    console.log(`  通道 ${pad(name, 11)} ${a.ok ? '通' : '不通'}  ${a.note || ''}`);
  }
  console.log(`  通道 ${pad('audio', 11)} ${audio.ok ? '通' : '不通'}  ${audio.note}`);
  if (audio.ok) console.log(`       引擎 home ${AUDIO_HOME()}${opts.audioMode ? ` · mode ${opts.audioMode}` : ''}${opts.confirm ? ' · --confirm 已开' : ''}`);

  // ---- 计划表 ----
  const label = { generate: '生成', substitute: '重做占位', skip: '跳过', unavailable: '无通道' };
  console.log(`\n  计划：${plan.length} 条${dropped ? `（--max ${opts.max}，另有 ${dropped} 条这一轮不做）` : ''}`);
  for (const it of executeOrder(plan)) {
    const tag = pad(label[it.action], 8);
    const who = it.provider ? pad(it.provider + (it.placeholder ? '(占位)' : ''), 16) : pad('-', 16);
    console.log(`    ${tag} ${pad(it.kind, 6)} ${pad(it.key, 28)} ${who} ${it.reason}`);
  }
  if (opts.dry) {
    console.log('\n  --dry：只算账，没写任何文件、没调任何生成接口。\n');
    return 0;
  }
  if (!images.magpie?.ok && !images.litellm?.ok) console.log('\n  注意：图片两个通道都不通，图片条目只能跳过。');

  // ---- 真做 ----
  const made = [];
  const failed = [];
  const skipped = plan.filter((it) => it.action === 'skip').length;
  const noChannel = plan.filter((it) => it.action === 'unavailable');
  const done = new Map(); // key → 本地文件，plate 做完了后面的图要拿它当参考
  for (const [key, e] of Object.entries(manifest.assets)) if (e?.file) done.set(key, path.join(ASSETS_DIR, e.file));

  const lock = sheet.lock || null;
  const criticCfg = loadCritic(opts);
  const maxRedo = Number.isFinite(opts.maxRedo) ? opts.maxRedo : 1;
  if (lock) console.log(`  风格锁：底版 ${lock.plateKey} · 色板 ${lock.palette.join(' ')} · 响度 ${lock.loudness} LUFS${criticCfg ? ` · 评审模型 ${criticCfg.model || '?'}` : ' · 没配评审模型（只跑确定性检查）'}`);

  let i = 0;
  for (const it of executeOrder(plan)) {
    if (it.action === 'skip') continue;
    if (it.action === 'unavailable') {
      console.log(`  无通道 ${it.kind} ${it.key} —— ${it.reason}`);
      continue;
    }
    i += 1;
    const rel = path.join('gen', `${it.key}.${it.kind === 'image' ? PROVIDERS[it.provider].ext : 'm4a'}`);
    const outPath = path.join(ASSETS_DIR, rel);
    try {
      // 生成 → 审片 → 不过就重做（redo 的次数由 review 按 maxRedo 把关）
      let entry = null;
      let attempt = 1;
      for (;;) {
        entry = await generateEntry(it, { audio, done, opts, work, outPath, rel });
        entry.source = sourceOf(it, entry);
        if (entry.quality === 'draft') entry.draft = true;
        const platePath = it.brief?.spec?.plate ? done.get(it.brief.spec.plate) : undefined;
        const rv = await review(it.brief, path.join(ASSETS_DIR, entry.file), lock, {
          quality: entry.quality,
          want: opts.want,
          attempt,
          maxRedo,
          critic: criticCfg,
          platePath,
        });
        entry.review = { verdict: rv.verdict, why: rv.why, checks: rv.checks, ...(rv.critic ? { critic: rv.critic } : {}) };
        if (rv.verdict !== 'redo') break;
        const allowed = await gateRedo(it, entry, opts);
        if (!allowed) {
          entry.review = { verdict: 'reject', why: `重做要再花一次钱，没过闸门 —— ${rv.why}`, checks: rv.checks };
          console.log(`  退回 ${it.key}：重做要再花一次钱，没有 --confirm 不敢重做`);
          break;
        }
        console.log(`  重做 ${pad(it.key, 28)} 第 ${attempt + 1} 次 —— ${rv.why}`);
        attempt += 1;
      }
      entry.delivered = entry.review.verdict === 'accept';
      manifest.assets[it.key] = entry;
      delete manifest.errors[it.key];
      done.set(it.key, path.join(ASSETS_DIR, entry.file));
      manifest.updatedAt = new Date().toISOString();
      manifest.counts = countAssets(manifest.assets);
      writeManifest(manifest); // 每条生成完立刻写回：中途断了也不丢已花的钱
      // 导演审片留痕（§4.4）：账本里一笔，沿 cause 追得回用户
      session.ledger.append({
        kind: 'director.review',
        from: `director:${opts.director}`,
        to: 'user',
        cause: [sheet.seq].filter(Boolean),
        payload: { key: it.key, verdict: entry.review.verdict, why: entry.review.why },
      });
      made.push({ ...entry, key: it.key, action: it.action, attempt });
      const cost = entry.cost && entry.cost.actual != null ? ` $${entry.cost.actual}` : '';
      const verdictTag = entry.review.verdict === 'accept' ? (entry.draft ? ' 草稿' : '') : entry.review.verdict === 'redo' ? ' 待重做' : ' 退回';
      console.log(`  [${i}] ${it.action === 'substitute' ? '重做' : '生成'} ${pad(it.key, 28)} ${pad(entry.provider, 12)} ${humanBytes(entry.bytes)}${entry.fallback ? ' 占位' : ''}${cost}${entry.job_id ? ` job ${String(entry.job_id).slice(0, 10)}` : ''}${verdictTag}${entry.note ? ` —— ${entry.note}` : ''}`);
      if (entry.review.verdict !== 'accept') console.log(`       导演退回：${entry.review.why}`);
    } catch (err) {
      // 报错只留一行、截断，免得一张表被一条长串冲垮（密钥已在 scrub 里抹掉）
      const message = scrub(err && err.message ? err.message : err).replace(/\s+/g, ' ').trim().slice(0, 240);
      failed.push({ key: it.key, kind: it.kind, provider: it.provider, message });
      manifest.errors[it.key] = { kind: it.kind, provider: it.provider, message, at: new Date().toISOString() };
      writeManifest(manifest);
      console.log(`  [${i}] 出错 ${pad(it.key, 28)} ${it.provider} —— ${message}`);
    }
  }

  // ---- 结尾汇总 ----
  const byKind = {};
  for (const m of made) {
    byKind[m.kind] = byKind[m.kind] || { 正式: 0, 占位: 0 };
    byKind[m.kind][m.fallback ? '占位' : '正式'] += 1;
  }
  const spent = made.reduce((s, m) => s + (m.cost && typeof m.cost.actual === 'number' ? m.cost.actual : 0), 0);
  const reviewed = made.filter((m) => m.review);
  const accepted = reviewed.filter((m) => m.review.verdict === 'accept');
  const rejected = reviewed.filter((m) => m.review.verdict !== 'accept');
  const summary = {
    work,
    director: opts.director,
    briefs: briefs.length,
    plan: plan.length,
    made: made.length,
    substituted: made.filter((m) => m.action === 'substitute').length,
    skipped,
    unavailable: noChannel.length,
    failed: failed.length,
    placeholder: made.filter((m) => m.fallback).length,
    reviewed: reviewed.length,
    accepted: accepted.length,
    rejected: rejected.length,
    redone: accepted.filter((m) => m.attempt > 1).length,
    draft: made.filter((m) => m.draft).length,
    dropped,
    spent: Number(spent.toFixed(4)),
    byKind,
    errors: failed,
    audio: { ok: audio.ok, cloud: audio.cloud, note: audio.note, mode: opts.audioMode || null },
    manifest: (() => {
      const rel = path.relative(REPO, MANIFEST_FILE);
      return rel.startsWith('..') ? MANIFEST_FILE : rel;
    })(),
  };
  console.log('\n  —— 汇总 ——');
  console.log(`  这一部作品 ${briefs.length} 条单子：生成 ${made.length}（正式 ${made.length - summary.placeholder} / 占位 ${summary.placeholder}，其中重做占位 ${summary.substituted}）、跳过 ${skipped}、无通道 ${noChannel.length}、出错 ${failed.length}${dropped ? `、这一轮没做 ${dropped}` : ''}`);
  for (const [kind, c] of Object.entries(byKind)) console.log(`    ${pad(kind, 6)} 正式 ${c.正式} / 占位 ${c.占位}`);
  if (spent > 0) console.log(`    这一轮花掉约 $${spent.toFixed(4)}（引擎记的账为准）`);
  console.log(`    声音引擎：${audio.ok ? audio.note : audio.note}`);
  if (reviewed.length) {
    console.log(`    导演审片：收下 ${accepted.length}${summary.redone ? `（其中 ${summary.redone} 条是重做后才收的）` : ''}、退回 ${rejected.length}${rejected.length ? '（退回的不算交付）' : ''}${summary.draft ? `、草稿 ${summary.draft}` : ''}`);
    for (const m of rejected) console.log(`    导演退回 ${m.key}：${m.review.why}`);
  }
  for (const e of failed) console.log(`    出错 ${e.key}（${e.provider}）：${e.message}`);
  for (const it of noChannel) console.log(`    无通道 ${it.key}：${it.reason}`);
  console.log(`  manifest：${summary.manifest}（每条做完就写回）\n`);
  if (opts.ledger) {
    const file = path.resolve(opts.ledger);
    ensureDir(file);
    fs.writeFileSync(file, `${JSON.stringify(session.ledger.toJSON(), null, 2)}\n`);
    console.log(`  账本：${file}（${session.ledger.size} 笔）\n`);
  }
  if (opts.json) console.log(JSON.stringify(summary, null, 2));

  return failed.length ? 1 : 0;
}

export function countAssets(assets = {}) {
  const counts = { image: 0, voice: 0, sfx: 0, music: 0 };
  let fallback = 0;
  for (const e of Object.values(assets)) {
    if (!e || !e.kind) continue;
    counts[e.kind] = (counts[e.kind] || 0) + 1;
    if (isPlaceholder(e)) fallback += 1;
  }
  return { ...counts, fallback };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`\n跑不下去了：${scrub(err && err.message ? err.message : err)}\n`);
      process.exitCode = 2;
    },
  );
}
