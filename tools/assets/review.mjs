// 导演审片（docs/WORKSHOP.md §4.3）。
//
// 一件事：生成完一个东西，导演先自己看一遍——对不对得上他开的单、对不对得上他的风格锁。
// 先跑确定性检查（格式、时长、响度、尺寸、平均色），有 ffmpeg/ffprobe 才量得出来，
// 没有就记 skipped，不算失败（§5.8）。再可选地问一次评审模型（critic）像不像同一个导演。
//
// 判词只有三种：accept 收下、redo 重做、reject 退回。重做次数由调用方给（maxRedo，默认 1），
// 这一次是第几次也由调用方给（attempt）——本文件不记状态，只按一次尝试给判词。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hasBin, runCmd, scrub } from './providers/util.mjs';

export const DEFAULT_CRITIC_THRESHOLD = 0.6;
export const DURATION_TOLERANCE = 0.2; // 时长 ±20%（§4.3）
export const LOUDNESS_TOLERANCE = 3; // 响度 ±3 LU（§4.3）
export const SIZE_TOLERANCE = 0.02; // 尺寸/比例 ±2%
export const PALETTE_MAX_DISTANCE = 140; // 平均色到 palette 的最近距离上限（0–441.7）

/** 认得的扩展名 → 它属于哪几类产物 */
export const EXT_KINDS = {
  '.png': ['image'],
  '.jpg': ['image'],
  '.jpeg': ['image'],
  '.webp': ['image'],
  '.m4a': ['voice', 'sfx', 'music'],
  '.mp3': ['voice', 'sfx', 'music'],
  '.wav': ['voice', 'sfx', 'music'],
  '.ogg': ['voice', 'sfx', 'music'],
  '.oga': ['voice', 'sfx', 'music'],
  '.opus': ['voice', 'sfx', 'music'],
  '.aac': ['voice', 'sfx', 'music'],
  '.flac': ['voice', 'sfx', 'music'],
  '.caf': ['voice', 'sfx', 'music'],
};

const IMAGE_EXPECT = '.png / .jpg / .webp';
const AUDIO_EXPECT = '.m4a / .mp3 / .wav / .ogg / .opus / .aac / .flac';

/* ===================== 量具 ===================== */

/** 这台机器上有没有 ffmpeg/ffprobe；opts.ffmpeg === false 可以强行当没有（测试用） */
export function probeTools(opts = {}) {
  const ffmpeg = opts.ffmpeg === false ? false : hasBin(opts.ffmpeg || 'ffmpeg');
  const ffprobe = opts.ffprobe === false ? false : hasBin(opts.ffprobe || 'ffprobe');
  return { ffmpeg, ffprobe };
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 用 ffprobe 读尺寸/时长/容器格式；读不出来返回 null 字段，不抛 */
export function probe(file, opts = {}) {
  const bin = opts.ffprobe || 'ffprobe';
  const out = { width: null, height: null, seconds: null, format: null };
  try {
    const r = runCmd(bin, ['-v', 'error', '-show_entries', 'stream=width,height:format=duration,format_name', '-of', 'json', file], { timeoutMs: 20000 });
    const j = JSON.parse(r.stdout || '{}');
    const st = (j.streams || [])[0] || {};
    const fm = j.format || {};
    out.width = num(st.width);
    out.height = num(st.height);
    out.seconds = num(fm.duration);
    out.format = fm.format_name || null;
  } catch {
    /* 读不出来就留空：上层记 skipped 或按格式检查失败 */
  }
  return out;
}

/** 响度：优先 ebur128 的 I（LUFS），退到 volumedetect 的 mean_volume（dB） */
export function loudnessOf(file, opts = {}) {
  const bin = opts.ffmpeg || 'ffmpeg';
  try {
    // ebur128 每 100ms 打一行 I，开头几行还在门限以下（-70），
    // 积分响度是累积的——取最后一行才是整段的 I。
    const r = runCmd(bin, ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=none', '-f', 'null', '-'], { timeoutMs: 120000 });
    const all = [...String(r.stderr || '').matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
    if (all.length) return { lufs: Number(all[all.length - 1][1]), source: 'ebur128' };
  } catch {
    /* 退到 volumedetect */
  }
  try {
    const r = runCmd(bin, ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { timeoutMs: 120000 });
    const m = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(r.stderr || '');
    if (m) return { lufs: Number(m[1]), source: 'volumedetect' };
  } catch {
    /* 量不出来 */
  }
  return null;
}

/** 整张图缩到 1x1 当平均色 */
export function averageColor(file, opts = {}) {
  const bin = opts.ffmpeg || 'ffmpeg';
  try {
    // 这里要的是原始字节，不能用 runCmd（它按 utf8 解码，会把颜色解坏）
    const r = spawnSync(bin, ['-hide_banner', '-v', 'error', '-i', file, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeout: 60000 });
    if (r.status !== 0) return null;
    const buf = r.stdout || Buffer.alloc(0);
    if (buf.length >= 3) return [buf[0], buf[1], buf[2]];
  } catch {
    /* 取不出来 */
  }
  return null;
}

export function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function colorDistance(a, b) {
  if (!a || !b) return null;
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** 平均色离 palette 里最近的那个有多远 */
export function nearestPalette(color, palette) {
  let best = null;
  for (const hex of palette || []) {
    const d = colorDistance(color, hexToRgb(hex));
    if (d == null) continue;
    if (!best || d < best.distance) best = { hex, distance: d };
  }
  return best;
}

/* ===================== 检查 ===================== */

const check = (name, ok, value, expect, extra = {}) => ({ name, ok, value, expect, ...extra });
const skipped = (name, value, expect, extra = {}) => ({ name, ok: true, skipped: true, value, expect, ...extra });

export function checkFormat(brief, file) {
  const kind = brief.kind || 'asset';
  const expect = kind === 'image' ? IMAGE_EXPECT : AUDIO_EXPECT;
  if (!fs.existsSync(file)) return check('format', false, '文件不存在', expect);
  const ext = path.extname(file).toLowerCase();
  const kinds = EXT_KINDS[ext];
  if (!kinds) return check('format', false, `${ext || '（没有扩展名）'} 不认识`, expect);
  return check('format', kinds.includes(kind), `${ext}（${kinds.join('/')}）`, expect);
}

export function checkDuration(brief, file, opts = {}, tools = probeTools(opts)) {
  const want = num(brief.spec && brief.spec.seconds);
  if (brief.kind === 'image') return skipped('duration', '图片没有时长', '声音才有');
  if (want == null) return skipped('duration', '这一单没写秒数', `${DURATION_TOLERANCE * 100}% 以内`);
  if (!tools.ffprobe) return skipped('duration', '这台机器没有 ffprobe，量不了时长', `${want}s ±${DURATION_TOLERANCE * 100}%`);
  const p = probe(file, opts);
  if (p.seconds == null) return skipped('duration', 'ffprobe 读不出时长', `${want}s ±${DURATION_TOLERANCE * 100}%`);
  const lo = want * (1 - DURATION_TOLERANCE);
  const hi = want * (1 + DURATION_TOLERANCE);
  return check('duration', p.seconds >= lo && p.seconds <= hi, `${p.seconds.toFixed(2)}s`, `${want}s ±${DURATION_TOLERANCE * 100}%（${lo.toFixed(2)}–${hi.toFixed(2)}s）`);
}

export function checkLoudness(brief, lock, file, opts = {}, tools = probeTools(opts)) {
  const want = num(lock && lock.loudness);
  if (brief.kind === 'image') return skipped('loudness', '图片没有响度', '声音才有');
  if (want == null) return skipped('loudness', '这张单没有风格锁的响度', `±${LOUDNESS_TOLERANCE} LU`);
  if (!tools.ffmpeg) return skipped('loudness', '这台机器没有 ffmpeg，量不了响度', `${want} LUFS ±${LOUDNESS_TOLERANCE} LU`);
  const l = loudnessOf(file, opts);
  if (!l) return skipped('loudness', 'ffmpeg 量不出响度', `${want} LUFS ±${LOUDNESS_TOLERANCE} LU`);
  const ok = Math.abs(l.lufs - want) <= LOUDNESS_TOLERANCE;
  return check('loudness', ok, `${l.lufs} LUFS（${l.source}）`, `${want} LUFS ±${LOUDNESS_TOLERANCE} LU`);
}

export function checkSize(brief, file, opts = {}, tools = probeTools(opts)) {
  const want = brief.spec && brief.spec.size;
  if (brief.kind !== 'image') return skipped('size', '声音没有画面尺寸', '图片才有');
  if (!want) return skipped('size', '这一单没写尺寸', `±${SIZE_TOLERANCE * 100}%`);
  if (!tools.ffprobe) return skipped('size', '这台机器没有 ffprobe，量不了尺寸', `${want} ±${SIZE_TOLERANCE * 100}%`);
  const p = probe(file, opts);
  if (p.width == null || p.height == null) return skipped('size', 'ffprobe 读不出尺寸', `${want} ±${SIZE_TOLERANCE * 100}%`);
  const m = /^(\d+)x(\d+)$/.exec(String(want));
  if (!m) return skipped('size', `这一单的尺寸写法看不懂：${want}`, '宽x高');
  const [w, h] = [Number(m[1]), Number(m[2])];
  const okW = Math.abs(p.width - w) / w <= SIZE_TOLERANCE;
  const okH = Math.abs(p.height - h) / h <= SIZE_TOLERANCE;
  const okR = Math.abs(p.width / p.height - w / h) / (w / h) <= SIZE_TOLERANCE;
  return check('size', okW && okH && okR, `${p.width}x${p.height}`, `${want} ±${SIZE_TOLERANCE * 100}%`);
}

export function checkPalette(brief, lock, file, opts = {}, tools = probeTools(opts)) {
  const palette = (lock && lock.palette) || [];
  if (brief.kind !== 'image') return skipped('palette', '声音没有画面颜色', '图片才有');
  if (!palette.length) return skipped('palette', '这张单没有风格锁的色板', `平均色距 palette ≤ ${PALETTE_MAX_DISTANCE}`);
  if (!tools.ffmpeg) return skipped('palette', '这台机器没有 ffmpeg，取不了平均色', `平均色距 palette ≤ ${PALETTE_MAX_DISTANCE}`);
  const c = averageColor(file, opts);
  if (!c) return skipped('palette', 'ffmpeg 取不出平均色', `平均色距 palette ≤ ${PALETTE_MAX_DISTANCE}`);
  const near = nearestPalette(c, palette);
  if (!near) return skipped('palette', '色板里的颜色看不懂', `平均色距 palette ≤ ${PALETTE_MAX_DISTANCE}`);
  return check('palette', near.distance <= PALETTE_MAX_DISTANCE, `平均色 rgb(${c.join(',')})，最近 ${near.hex} 距离 ${near.distance.toFixed(1)}`, `≤ ${PALETTE_MAX_DISTANCE}（贴住色板）`);
}

/** quality:'draft' 的产物最多算草稿：导演要正式交付时它不算数（§4.3） */
export function checkQuality(brief, opts = {}) {
  const q = opts.quality || (brief.spec && brief.spec.quality) || 'generated';
  const want = opts.want === 'draft' ? 'draft' : 'production';
  if (want === 'draft') return skipped('quality', `${q}（导演说这次先看草稿）`, '草稿即可');
  return check('quality', q !== 'draft', q, '正式交付（不是 draft）');
}

/* ===================== 评审模型（可选） ===================== */

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function dataUrl(file) {
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** 从评审模型的一段话里抠出 0–1 分和一句理由 */
export function parseCritic(text) {
  const s = String(text || '').trim();
  const j = /\{[\s\S]*\}/.exec(s);
  if (j) {
    try {
      const o = JSON.parse(j[0]);
      const raw = Number(o.score);
      if (Number.isFinite(raw)) return { score: raw > 1 ? raw / 100 : raw, reason: String(o.reason || o.why || '').trim() };
    } catch {
      /* 不是 JSON，继续按文字找 */
    }
  }
  const m = /(\d+(?:\.\d+)?)\s*(?:\/\s*100|分)?/.exec(s);
  if (!m) return { score: null, reason: s.slice(0, 120) };
  const raw = Number(m[1]);
  return { score: raw > 1 ? raw / 100 : raw, reason: s.replace(/\s+/g, ' ').slice(0, 120) };
}

/**
 * 评审模型：把导演的风格底版和刚生成的东西一起给它，问像不像同一个导演。
 * 没配、没 fetch、答不上来、不是图片 → skipped（评审缺席不算失败，§5.8）。
 */
export async function checkCritic(brief, file, lock, cfg, opts = {}) {
  const threshold = num(cfg && cfg.threshold) ?? DEFAULT_CRITIC_THRESHOLD;
  const expect = `≥ ${threshold}`;
  if (!cfg || !cfg.url || !cfg.model) return skipped('critic', '没配评审模型', '可选');
  if (brief.kind !== 'image') return skipped('critic', '视觉评审看不了声音', '可选');
  const f = opts.fetch || globalThis.fetch;
  if (typeof f !== 'function') return skipped('critic', '这个环境没有 fetch', '可选');
  const platePath = opts.platePath || (opts.plates && lock && opts.plates[lock.plateKey]);
  try {
    const images = [];
    if (platePath && fs.existsSync(platePath)) images.push({ type: 'image_url', image_url: { url: dataUrl(platePath) } });
    images.push({ type: 'image_url', image_url: { url: dataUrl(file) } });
    const words = (lock && lock.words) || [];
    const ask = [
      words.length ? `这位导演的口味：${words.join('；')}。` : '',
      `这一单要的是：${(brief.spec && (brief.spec.prompt || brief.spec.text)) || brief.why || brief.key}。`,
      images.length > 1 ? '第一张是他的风格底版，第二张是刚生成的东西。' : '这张是刚生成的东西。',
      '它像这位导演拍的吗？只回一个 JSON：{"score":0到1,"reason":"一句话"}。',
    ].filter(Boolean).join('\n');
    const res = await f(`${String(cfg.url).replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: 'system', content: '你是导演的审片人，只看像不像同一个导演，别夸也别客气。' },
          { role: 'user', content: [{ type: 'text', text: ask }, ...images] },
        ],
      }),
      signal: AbortSignal.timeout(num(cfg.timeoutMs) || 60000),
    });
    if (!res.ok) return skipped('critic', `评审模型回了 ${res.status}`, expect);
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content ?? body?.choices?.[0]?.text ?? '';
    const { score, reason } = parseCritic(typeof text === 'string' ? text : JSON.stringify(text));
    if (score == null) return skipped('critic', `评审模型没给分：${reason || '（空回答）'}`, expect);
    return check('critic', score >= threshold, score, expect, { reason, words });
  } catch (e) {
    return skipped('critic', `评审模型没答上来：${scrub(e && e.message ? e.message : String(e))}`, expect);
  }
}

/* ===================== 判词 ===================== */

export function failedChecks(checks) {
  return (checks || []).filter((c) => !c.skipped && !c.ok);
}

const whyOf = (checks) =>
  failedChecks(checks)
    .map((c) => `${c.name}：要 ${c.expect}，实测 ${c.value}`)
    .join('；');

/**
 * 审一条：review(brief, file, lock, opts) → { verdict, why, checks, critic? }
 * opts: { quality, want:'production'|'draft', attempt=1, maxRedo=1, critic, platePath, plates,
 *         ffmpeg, ffprobe, fetch }
 * 全过 → accept；有过不去的 → 还有重做机会就 redo，机会用完就 reject（§4.3）。
 */
export async function review(brief, file, lock, opts = {}) {
  const tools = probeTools(opts);
  const checks = [
    checkFormat(brief, file),
    checkSize(brief, file, opts, tools),
    checkDuration(brief, file, opts, tools),
    checkLoudness(brief, lock, file, opts, tools),
    checkPalette(brief, lock, file, opts, tools),
    checkQuality(brief, opts),
  ];
  const critic = await checkCritic(brief, file, lock, opts.critic, opts);
  checks.push(critic);

  const bad = failedChecks(checks);
  const attempt = num(opts.attempt) || 1;
  const maxRedo = num(opts.maxRedo) ?? 1;
  if (!bad.length) {
    const skippedNames = checks.filter((c) => c.skipped).map((c) => c.name);
    return {
      verdict: 'accept',
      why: `确定性检查全过${skippedNames.length ? `（没量的：${skippedNames.join('、')}）` : ''}`,
      checks,
      critic: critic.skipped ? undefined : { score: critic.value, reason: critic.reason, ok: critic.ok },
    };
  }
  if (attempt > maxRedo) {
    return {
      verdict: 'reject',
      why: `重做 ${maxRedo} 次还是不行——${whyOf(checks)}`,
      checks,
      critic: critic.skipped ? undefined : { score: critic.value, reason: critic.reason, ok: critic.ok },
    };
  }
  return {
    verdict: 'redo',
    why: whyOf(checks),
    checks,
    critic: critic.skipped ? undefined : { score: critic.value, reason: critic.reason, ok: critic.ok },
  };
}

export default { review, probeTools, probe, loudnessOf, averageColor, failedChecks };
