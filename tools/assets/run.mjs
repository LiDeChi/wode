// 导演手里的笔：把 stagecraft 开出的资产单（docs/ASSETS.md §3 的 Brief[]）真的生成出来。
//
//   node tools/assets/run.mjs --work qiefu --director lu [--kinds image,voice] [--max 20] [--dry] [--only-missing]
//
// 流程（§4）：建会话 → 请一位导演 → 让他 dress 出这一部作品的全部单子 → 对照 manifest 算一遍账 →
// 按单生成 → 每条生成完立刻写回 manifest → 结尾打一张汇总表。
//
// 三条硬规矩：
//   · 花钱和写文件只发生在这个工具里。演出（createPlay）和场景数据一条都不碰资产。
//   · 缺 key 不卡住：该用替身就用替身（voice→say、sfx/music→synth），manifest 里 fallback:true。
//     以后配了正式服务，再跑一次就会把替身条目重做成正式版本。
//   · 图片没有替身：magpie 和 litellm 都不通时，这一条记 unavailable 并报告，不假装成功。
//
// 每一条网络错误只记一笔、继续往下做，最后汇总；重试不超过一次（在 provider 内部）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createSession } from '../../shared/engine/session.js';
import { ensureDir, scrub } from './providers/util.mjs';
import * as magpie from './providers/magpie.mjs';
import * as litellm from './providers/litellm.mjs';
import * as elevenlabs from './providers/elevenlabs.mjs';
import * as say from './providers/say.mjs';
import * as synth from './providers/synth.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
// 产物落在 web/assets/（manifest.json + gen/**）。测试想换个地方落地时可以 ASSETS_DIR=... 指过去。
const ASSETS_DIR = process.env.ASSETS_DIR ? path.resolve(process.env.ASSETS_DIR) : path.join(REPO, 'web', 'assets');
const MANIFEST_FILE = process.env.MANIFEST_FILE ? path.resolve(process.env.MANIFEST_FILE) : path.join(ASSETS_DIR, 'manifest.json');

export const PROVIDERS = { magpie, litellm, elevenlabs, say, synth };

/**
 * 每个类型走哪条通道。official 是「真货」，substitute 是「不花钱的替身」。
 * image 没有替身（docs/ASSETS.md §4 的 provider 表）：magpie 不通就用备用通道 litellm，两个都不通就跳过并报告。
 */
export const PROVIDER_CHAIN = {
  image: { official: ['magpie', 'litellm'], substitute: [] },
  voice: { official: ['elevenlabs'], substitute: ['say'] },
  sfx: { official: ['elevenlabs'], substitute: ['synth'] },
  music: { official: ['elevenlabs'], substitute: ['synth'] },
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

/** 这条单子走哪个 provider：official 里第一个可用的，否则 substitute 里第一个可用的 */
function pickProvider(kind, available) {
  const chain = PROVIDER_CHAIN[kind] || { official: [], substitute: [] };
  const official = chain.official.find((n) => available?.[n]?.ok);
  if (official) return { provider: official, fallback: false, official: true };
  const sub = chain.substitute.find((n) => available?.[n]?.ok);
  if (sub) return { provider: sub, fallback: true, official: false };
  return { provider: null, fallback: false, official: false };
}

/**
 * 纯函数：算这一轮该做什么，不碰盘、不碰网、不看钟。
 *   manifest  —— manifest.json 的内容（可为空对象）；manifest.assets[key] 是已有条目
 *   briefs    —— 导演开的单子（stagecraft 的 Brief[]）
 *   available —— { providerName: { ok } }，各通道探活结果
 * 返回和 briefs 一一对应、顺序不变的清单，每条：
 *   { key, kind, action, provider, fallback, reason, brief }
 * action 四种：
 *   skip        已经有了（正式版就直接用；替身版而正式服务仍不可用，也先用着）
 *   generate    还没有，现在开一张（provider 是替身时会带 fallback:true）
 *   substitute  已有的是替身，现在正式服务通了 → 重做
 *   unavailable 这个类型连替身都没有（图片），跳过并报告
 */
export function planRun(manifest, briefs, available = {}) {
  const have = (manifest && manifest.assets) || {};
  return (briefs || []).map((brief) => {
    const key = brief?.key;
    const kind = brief?.kind;
    const entry = key ? have[key] : null;
    const pick = pickProvider(kind, available);
    const base = { key, kind, brief };

    if (entry && !entry.fallback) {
      return { ...base, action: 'skip', provider: entry.provider || null, fallback: false, reason: 'manifest 里已有正式版本' };
    }
    if (entry && entry.fallback) {
      if (pick.official) {
        return { ...base, action: 'substitute', provider: pick.provider, fallback: false, reason: `原先是替身（${entry.provider || '?'}），现在 ${pick.provider} 可用，重做` };
      }
      return { ...base, action: 'skip', provider: entry.provider || null, fallback: true, reason: '正式服务还没通，继续用替身' };
    }
    if (pick.provider) {
      return {
        ...base,
        action: 'generate',
        provider: pick.provider,
        fallback: pick.fallback,
        reason: pick.fallback ? `${PROVIDER_CHAIN[kind].official.join('/')} 都不可用，先用替身 ${pick.provider}` : `${pick.provider} 可用`,
      };
    }
    return { ...base, action: 'unavailable', provider: null, fallback: false, reason: `${kind} 没有可用通道${(PROVIDER_CHAIN[kind]?.substitute || []).length ? '' : '（这一类型没有替身）'}` };
  });
}

export function parseArgs(argv = []) {
  const opts = { work: null, director: 'lu', kinds: null, max: null, dry: false, onlyMissing: false, help: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--work') opts.work = next();
    else if (a === '--director' || a === '--dir') opts.director = next();
    else if (a === '--kinds') opts.kinds = String(next() || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--max') opts.max = Number(next());
    else if (a === '--dry') opts.dry = true;
    else if (a === '--only-missing') opts.onlyMissing = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`不认识的参数：${a}（--help 看用法）`);
  }
  return opts;
}

const USAGE = `用法：node tools/assets/run.mjs --work <qiefu|weicheng> [--director lu|shan] [--kinds image,voice,sfx,music] [--max N] [--dry] [--only-missing]

  --work          哪一部作品（要 shared/scenes/<work>.js 存在），默认 qiefu
  --director      哪位导演：lu（陆导，重雕琢）或 shan（单导，放开），默认 lu
  --kinds         只做这几个类型
  --max N         这一轮最多真做 N 条（跳过的不算）
  --dry           只算账、打印计划，一个文件都不写、一次生成都不调
  --only-missing  只做还没有的（已经有的连替身重做也跳过）
  --json          结尾把汇总按 JSON 打出来（给脚本用）
`;

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

async function probeAll() {
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

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const work = opts.work || 'qiefu';

  const available = await probeAll();
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
  for (const [name, a] of Object.entries(available)) {
    console.log(`  通道 ${pad(name, 11)} ${a.ok ? '通' : '不通'}  ${a.note || ''}`);
  }

  // ---- 计划表 ----
  const label = { generate: '生成', substitute: '重做替身', skip: '跳过', unavailable: '无通道' };
  console.log(`\n  计划：${plan.length} 条${dropped ? `（--max ${opts.max}，另有 ${dropped} 条这一轮不做）` : ''}`);
  for (const it of executeOrder(plan)) {
    const tag = pad(label[it.action], 8);
    const who = it.provider ? pad(it.provider + (it.fallback ? '(替身)' : ''), 16) : pad('-', 16);
    console.log(`    ${tag} ${pad(it.kind, 6)} ${pad(it.key, 28)} ${who} ${it.reason}`);
  }
  if (opts.dry) {
    console.log('\n  --dry：只算账，没写任何文件、没调任何生成接口。\n');
    return 0;
  }

  // ---- 真做 ----
  const made = [];
  const failed = [];
  const skipped = plan.filter((it) => it.action === 'skip').length;
  const noChannel = plan.filter((it) => it.action === 'unavailable');
  const done = new Map(); // key → 本地文件，plate 做完了后面的图要拿它当参考
  for (const [key, e] of Object.entries(manifest.assets)) if (e?.file) done.set(key, path.join(ASSETS_DIR, e.file));

  let i = 0;
  for (const it of executeOrder(plan)) {
    if (it.action === 'skip') continue;
    if (it.action === 'unavailable') {
      console.log(`  无通道 ${it.kind} ${it.key} —— ${it.reason}`);
      continue;
    }
    i += 1;
    const mod = PROVIDERS[it.provider];
    const ext = mod.ext || 'bin';
    const rel = path.join('gen', `${it.key}.${ext}`);
    const outPath = path.join(ASSETS_DIR, rel);
    const ctx = {};
    const needPlate = it.brief?.spec?.plate;
    if (it.kind === 'image' && needPlate) {
      const p = done.get(needPlate);
      if (p && fs.existsSync(p)) ctx.platePath = p;
      else console.log(`  注意 ${it.key} 的底版 ${needPlate} 还没有，这张先不带上底版`);
    }
    try {
      ensureDir(outPath); // provider 可能直接让 ffmpeg 写这个路径，目录得先有
      const r = await mod.make(it.brief, outPath, ctx);
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
        fallback: r.fallback === true,
        bytes: r.bytes || (fs.existsSync(outPath) ? fs.statSync(outPath).size : 0),
      };
      if (r.note) entry.note = r.note;
      if (r.seconds) entry.seconds = r.seconds;
      manifest.assets[it.key] = entry;
      delete manifest.errors[it.key];
      done.set(it.key, outPath);
      manifest.updatedAt = new Date().toISOString();
      manifest.counts = countAssets(manifest.assets);
      writeManifest(manifest); // 每条生成完立刻写回：中途断了也不丢已花的钱
      made.push({ ...entry, key: it.key, action: it.action });
      console.log(`  [${i}] ${it.action === 'substitute' ? '重做' : '生成'} ${pad(it.key, 28)} ${pad(entry.provider, 12)} ${humanBytes(entry.bytes)}${entry.fallback ? ' 替身' : ''}${entry.note ? ` —— ${entry.note}` : ''}`);
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
    byKind[m.kind] = byKind[m.kind] || { 正式: 0, 替身: 0 };
    byKind[m.kind][m.fallback ? '替身' : '正式'] += 1;
  }
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
    fallback: made.filter((m) => m.fallback).length,
    dropped,
    byKind,
    errors: failed,
    manifest: (() => {
      const rel = path.relative(REPO, MANIFEST_FILE);
      return rel.startsWith('..') ? MANIFEST_FILE : rel;
    })(),
  };
  console.log('\n  —— 汇总 ——');
  console.log(`  这一部作品 ${briefs.length} 条单子：生成 ${made.length}（正式 ${made.length - summary.fallback} / 替身 ${summary.fallback}，其中重做替身 ${summary.substituted}）、跳过 ${skipped}、无通道 ${noChannel.length}、出错 ${failed.length}${dropped ? `、这一轮没做 ${dropped}` : ''}`);
  for (const [kind, c] of Object.entries(byKind)) console.log(`    ${pad(kind, 6)} 正式 ${c.正式} / 替身 ${c.替身}`);
  for (const e of failed) console.log(`    出错 ${e.key}（${e.provider}）：${e.message}`);
  for (const it of noChannel) console.log(`    无通道 ${it.key}：${it.reason}`);
  console.log(`  manifest：${summary.manifest}（每条做完就写回）\n`);
  if (opts.json) console.log(JSON.stringify(summary, null, 2));

  return failed.length ? 1 : 0;
}

export function countAssets(assets = {}) {
  const counts = { image: 0, voice: 0, sfx: 0, music: 0 };
  let fallback = 0;
  for (const e of Object.values(assets)) {
    if (!e || !e.kind) continue;
    counts[e.kind] = (counts[e.kind] || 0) + 1;
    if (e.fallback) fallback += 1;
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
