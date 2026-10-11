// 声音（替身）：macOS 自带 `say` + ffmpeg 转 m4a。不花钱、不联网、随时能跑。
//
// 这一档是给「还没有 ELEVENLABS_API_KEY」的时候用的：导演开的单里 spec.voice 是音色档位
// （zh-old-male 这种），不是音色名。这里把档位映射到系统里真实存在的 zh_* 音色。
//
// 坑（在这台机器上实测出来的，必须防）：`say -v '?'` 列得出 19 个中文音色，但其中大多数
// 只是「没下载」的空壳——对着它们合成，退出码是 0、文件也有，可时长只有 0.016 秒的全静音。
// 所以这里不信列表：候选音色逐个真合一句短句探一次底，只有真出得了声的才算可用；
// 正式合成之后还要按「文本长度 vs 实际时长」再验一遍，太短就换下一个音色，全都不行就报错，
// 绝不把一条哑文件当成资产写进 manifest。
//
// spec.rate 是语速倍数（0.85–1.15，导演按雕琢推的），换算成 `say -r` 的每分钟词数；
// spec.pause 是句间停顿秒数，用 say 的内嵌命令 [[slnc 毫秒]] 插在句子之间。

import fs from 'node:fs';
import path from 'node:path';
import { hasBin, runCmd, mkTemp, cleanup, saveBuffer } from './util.mjs';

export const name = 'say';
export const kinds = ['voice'];
export const ext = 'm4a';

const BASE_WPM = Number(process.env.SAY_BASE_WPM || 180);
const PROBE_TEXT = '风起。';
const PROBE_MIN_SECONDS = 0.25;
const PROBE_MAX_TRIES = 8;

/** 音色档 → 系统音色名。映射不到就退到「真出得了声」的第一个音色 */
export const TIER_VOICE = {
  'zh-old-male': 'Grandpa',
  'zh-old-female': 'Grandma',
  'zh-mid-male': 'Reed',
  'zh-mid-female': 'Flo',
  'zh-young-male': 'Rocko',
  'zh-young-female': 'Shelley',
};

/** 探底优先级：这几个人声最老、最常被预装；先探它们，省得每次都把 19 个探一遍 */
const PROBE_FIRST = ['Tingting', 'Ting-Ting', 'Meijia', 'Sinji', 'Eddy', 'Flo', 'Reed'];

let installedCache = null;
let workingCache = null;

export function ffmpegReady() {
  return hasBin('ffmpeg', ['-version']);
}

/** `say -v '?'` 里的 zh_* 音色（这是「装没装」的列表，不等于能出声） */
export function listVoices() {
  if (installedCache) return installedCache;
  let rows = [];
  try {
    const r = runCmd('say', ['-v', '?'], { timeoutMs: 20000 });
    rows = String(r.stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s{2,}/);
        const head = (parts[0] || '').trim();
        return { name: head.split(' (')[0].trim(), locale: (parts[1] || '').trim() };
      })
      .filter((v) => v.name && /^zh/.test(v.locale));
  } catch {
    rows = [];
  }
  installedCache = rows;
  return rows;
}

function probeOrder() {
  const zh = listVoices();
  const byLower = new Map(zh.map((v) => [v.name.toLowerCase(), v.name]));
  const first = PROBE_FIRST.map((n) => byLower.get(n.toLowerCase())).filter(Boolean);
  const rest = zh.filter((v) => v.locale === 'zh_CN').map((v) => v.name).filter((n) => !first.includes(n));
  return [...new Set([...first, ...rest])];
}

/** 真合一句短句，看时长够不够——只信这个结果，不信下拉列表 */
export function rendersVoice(voice) {
  if (!ffmpegReady()) return false;
  const tmp = mkTemp('sayprobe-');
  try {
    const aiff = path.join(tmp, 'p.aiff');
    runCmd('say', ['-v', voice, '-r', '180', PROBE_TEXT, '-o', aiff], { timeoutMs: 20000 });
    const sec = durationOf(aiff);
    return sec >= PROBE_MIN_SECONDS;
  } catch {
    return false;
  } finally {
    cleanup([tmp]);
  }
}

/** 真能出声的中文音色（探底结果缓存；最多探 PROBE_MAX_TRIES 个，够用就停） */
export function workingVoices(need = 3) {
  if (workingCache) return workingCache;
  const order = probeOrder();
  const ok = [];
  for (const v of order) {
    if (ok.length >= need || ok.length + 1 > PROBE_MAX_TRIES) break;
    if (rendersVoice(v)) ok.push(v);
  }
  workingCache = ok;
  return ok;
}

/** 档位或音色名 → 这台机器上真出得了声的音色名 */
export function pickVoice(tier) {
  const ok = workingVoices();
  if (ok.length === 0) return TIER_VOICE[tier] || tier || 'Tingting';
  const byLower = new Map(ok.map((v) => [v.toLowerCase(), v]));
  const want = TIER_VOICE[tier] || tier || '';
  const norm = String(want).toLowerCase().replace(/[^a-z]/g, '');
  if (byLower.has(norm)) return byLower.get(norm);
  const forced = process.env.SAY_VOICE && byLower.get(String(process.env.SAY_VOICE).toLowerCase());
  return forced || ok[0];
}

/** 秒数（没有 ffprobe 就用字节数兜底：静音的空壳不可能是大文件） */
export function durationOf(file) {
  if (!fs.existsSync(file)) return 0;
  if (hasBin('ffprobe', ['-version'])) {
    try {
      const r = runCmd('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeoutMs: 20000 });
      const sec = Number(String(r.stdout || '').trim());
      if (Number.isFinite(sec)) return sec;
    } catch {
      /* 接着走字节兜底 */
    }
  }
  return fs.statSync(file).size > 12000 ? 1 : 0;
}

/**
 * 这条文本至少该有多长才不像空壳。
 * 不是「猜正常语速」——短台词本来就短（「诺。」念出来不到一秒），这条线只用来把
 * 「没下载的哑音色」那种 0.016 秒的静音挡掉，所以取一个很宽的每字下限。
 */
function minPlausibleSeconds(text, rate) {
  const chars = String(text || '').replace(/\s/g, '').length;
  return Math.min(1, Math.max(0.25, (chars * 0.08) / Math.max(0.5, rate)));
}

export async function available() {
  const isMac = process.platform === 'darwin';
  const sayOk = isMac ? hasBin('say', ['-v', '?']) : false;
  const ffOk = ffmpegReady();
  const ffprobeOk = hasBin('ffprobe', ['-version']);
  const installed = sayOk ? listVoices() : [];
  const working = sayOk && ffOk ? workingVoices() : [];
  const ok = isMac && sayOk && ffOk && working.length > 0;
  return {
    ok,
    name,
    voices: installed.map((v) => v.name),
    working,
    note: !isMac
      ? 'say 只有 macOS 有'
      : !sayOk
        ? '没有 say 命令'
        : !ffOk
          ? '没有 ffmpeg（转 m4a 要用）'
          : installed.length === 0
            ? '系统里没有中文音色（say -v ? 里没有 zh_*）'
            : `列出 ${installed.length} 个中文音色，真出得了声的只有 ${working.join('/') || '无'}（其余是没下载的空壳）${ffprobeOk ? '' : '；没有 ffprobe，改用字节数兜底'}`,
  };
}

/** 句间停顿：在句号/问号这类断点后面插 [[slnc 毫秒]] */
export function withPauses(text, pauseSeconds) {
  const ms = Math.round(Math.max(0, Math.min(2, Number(pauseSeconds) || 0)) * 1000);
  const s = String(text || '');
  if (!ms || !s) return s;
  const parts = s.split(/(?<=[。！？!?；;])/).filter((x) => x.trim());
  if (parts.length < 2) return s;
  return parts.join(`[[slnc ${ms}]]`);
}

/** 用一个指定音色合成一条，成功返回 {seconds, bytes, usedPause} */
function render(voice, text, rate, pause, outPath) {
  const wpm = Math.max(90, Math.min(400, Math.round(BASE_WPM * rate)));
  const paused = withPauses(text, pause);
  const bodies = paused !== text ? [paused, text] : [text];
  const tmp = mkTemp('say-');
  try {
    const txtFile = path.join(tmp, 'line.txt');
    const aiff = path.join(tmp, 'line.aiff');
    let lastErr = null;
    for (const body of bodies) {
      try {
        saveBuffer(txtFile, Buffer.from(body, 'utf8'));
        runCmd('say', ['-v', voice, '-r', String(wpm), '-f', txtFile, '-o', aiff], { timeoutMs: 60000 });
        runCmd('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-c:a', 'aac', '-b:a', '128k', outPath], { timeoutMs: 60000 });
        const seconds = durationOf(outPath);
        if (seconds <= 0) throw new Error('没转出音频');
        return { seconds, bytes: fs.statSync(outPath).size, usedPause: body === paused, wpm };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('say 失败');
  } finally {
    cleanup([tmp]);
  }
}

export async function make(brief, outPath) {
  const spec = (brief && brief.spec) || {};
  const text = String(spec.text || '');
  if (!text.trim()) throw new Error('这条 voice 没有文本');
  const rate = Math.max(0.5, Math.min(2, Number(spec.rate) || 1));
  const need = minPlausibleSeconds(text, rate);

  const tier = spec.voice || 'zh-mid-male';
  const first = pickVoice(tier);
  const tried = new Set();
  const order = [first, ...workingVoices()].filter((v) => v && !tried.has(v) && (tried.add(v), true));

  const reasons = [];
  for (const voice of order) {
    try {
      const r = render(voice, text, rate, spec.pause, outPath);
      if (r.seconds < need) {
        reasons.push(`${voice} 只出了 ${r.seconds.toFixed(2)}s（不到 ${need.toFixed(2)}s，像是没下载的哑音色）`);
        continue;
      }
      const swapped = voice !== first;
      return {
        model: `say:${voice} r=${r.wpm}`,
        fallback: true,
        provider: name,
        bytes: r.bytes,
        seconds: Number(r.seconds.toFixed(2)),
        note: [
          swapped ? `档位 ${tier}→${TIER_VOICE[tier] || '?'} 出不了声，换成 ${voice}` : null,
          r.usedPause ? null : '（没用停顿标记）',
        ].filter(Boolean).join(' ') || undefined,
      };
    } catch (err) {
      reasons.push(`${voice}: ${err.message}`);
    }
  }
  throw new Error(`没有一个中文音色能读这句（${reasons.slice(0, 3).join('；')}）`);
}
