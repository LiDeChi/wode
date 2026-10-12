// 音效/音乐（替身）：纯 ffmpeg 合成，不联网、不花钱、确定性听得见。
//
//   sfx   → 一层正弦 + 一层粉噪声，按 intensity 调响度、两头做淡入淡出（不炸耳朵）
//   music → 三个八度关系的正弦叠成底，再用 tremolo 按 bpm 打拍子，首尾淡入淡出，循环用
//
// 这两条都不需要素材，所以「一台机器上没配任何服务」时游戏里照样有声音（docs/ASSETS.md §4）。

import fs from 'node:fs';
import { hasBin, runCmd, scrub } from './util.mjs';

export const name = 'synth';
export const kinds = ['sfx', 'music'];
export const ext = 'm4a';

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

export async function available() {
  const ffOk = hasBin('ffmpeg', ['-version']);
  return {
    ok: ffOk,
    name,
    note: ffOk ? 'ffmpeg 可用：音效用 sine+噪声包络，音乐用按 bpm 的节拍循环' : '没有 ffmpeg，合成不了',
  };
}

function ffmpeg(args, outPath) {
  runCmd('ffmpeg', ['-y', '-loglevel', 'error', ...args, '-c:a', 'aac', '-b:a', '128k', outPath], { timeoutMs: 120000 });
  const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  if (!size) throw new Error('ffmpeg 没产出文件');
  return size;
}

/** 一声音效：正弦 + 粉噪声，强度 0–1 决定响度 */
export function sfxFilter(seconds, intensity) {
  const s = clamp(seconds, 0.4, 12, 2);
  const i = clamp(intensity, 0, 1, 0.5);
  const vol = (0.12 + 0.7 * i).toFixed(3);
  const outAt = Math.max(0, s - 0.18).toFixed(3);
  return {
    seconds: s,
    filter: `[0:a][1:a]amix=inputs=2:weights=1 0.5:duration=first,afade=t=in:st=0:d=0.05,afade=t=out:st=${outAt}:d=0.18,volume=${vol},alimiter=limit=0.95[out]`,
  };
}

/** 一条循环：三个正弦叠底 + 按 bpm 打拍子，循环长度就是 seconds */
export function musicFilter(seconds, bpm) {
  const s = clamp(seconds, 4, 180, 30);
  const b = clamp(bpm, 40, 200, 80);
  const hz = (b / 60).toFixed(3);
  const outAt = Math.max(0, s - 1.2).toFixed(3);
  return {
    seconds: s,
    bpm: b,
    filter:
      `[0:a][1:a][2:a]amix=inputs=3:weights=1 0.5 0.25:duration=first,` +
      `tremolo=f=${hz}:d=0.85,afade=t=in:st=0:d=0.6,afade=t=out:st=${outAt}:d=1.2,volume=0.55,alimiter=limit=0.95[out]`,
  };
}

export async function make(brief, outPath) {
  const spec = (brief && brief.spec) || {};
  const kind = (brief && brief.kind) || 'sfx';

  if (kind === 'sfx') {
    const { seconds, filter } = sfxFilter(spec.seconds, spec.intensity);
    const bytes = ffmpeg(
      [
        '-f', 'lavfi', '-i', `sine=frequency=180:duration=${seconds}`,
        '-f', 'lavfi', '-i', `anoisesrc=color=pink:duration=${seconds}:amplitude=0.4`,
        '-filter_complex', filter,
        '-map', '[out]',
      ],
      outPath,
    );
    return { model: `ffmpeg/sfx ${seconds}s i=${spec.intensity ?? 0.5}`, fallback: true, provider: name, bytes };
  }

  if (kind === 'music') {
    const { seconds, bpm, filter } = musicFilter(spec.seconds, spec.bpm);
    const bytes = ffmpeg(
      [
        '-f', 'lavfi', '-i', `sine=frequency=110:duration=${seconds}`,
        '-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`,
        '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`,
        '-filter_complex', filter,
        '-map', '[out]',
      ],
      outPath,
    );
    return { model: `ffmpeg/music ${bpm}bpm ${seconds}s`, fallback: true, provider: name, bytes };
  }

  throw new Error(`synth 不管 ${kind}（只做 sfx/music）：${scrub(kind)}`);
}
