// 声音（正牌）：ElevenLabs。三条接口，按 brief.kind 分派：
//   voice → POST /v1/text-to-speech/{voice}        一句台词
//   sfx   → POST /v1/sound-generation              一声音效
//   music → POST /v1/music                         一条循环
//
// 没配 ELEVENLABS_API_KEY 时 available() 就是 false（不探测额度，省一次请求），
// run.mjs 会退回本机的 say / ffmpeg 替身，游戏照常跑（docs/ASSETS.md §4）。
//
// 音色档映射：导演开的单里 spec.voice 是档位 id（zh-mid-male 这种，见 stagecraft 的 VOICE_TABLE），
// 不是 ElevenLabs 的 voice id —— 用环境变量把档位接到具体音色，没配就用默认音色。

import { fetchWithTimeout, saveBuffer, scrub } from './util.mjs';

export const name = 'elevenlabs';
export const kinds = ['voice', 'sfx', 'music'];
export const ext = 'mp3';

const API = () => (process.env.ELEVENLABS_BASE || 'https://api.elevenlabs.io').replace(/\/+$/, '');
const MODEL = () => process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const DEFAULT_VOICE = () => process.env.ELEVENLABS_DEFAULT_VOICE || '21m00Tcm4TlvDq8ikWAM';
const TIMEOUT = Number(process.env.ELEVENLABS_TIMEOUT_MS || 120000);

/** 档位 id → 环境变量名：zh-mid-male → ELEVENLABS_VOICE_ZH_MID_MALE */
export function voiceEnvName(tier) {
  return `ELEVENLABS_VOICE_${String(tier || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

export function voiceId(tier) {
  const env = process.env[voiceEnvName(tier)];
  return (env && env.trim()) || DEFAULT_VOICE();
}

export function hasKey() {
  return typeof process.env.ELEVENLABS_API_KEY === 'string' && process.env.ELEVENLABS_API_KEY.trim() !== '';
}

export async function available() {
  return hasKey()
    ? { ok: true, name, note: '有 ELEVENLABS_API_KEY（没探测额度）', voice: { default: DEFAULT_VOICE() } }
    : { ok: false, name, note: '没有 ELEVENLABS_API_KEY，走替身 say / synth' };
}

function headers(extra = {}) {
  return { 'xi-api-key': process.env.ELEVENLABS_API_KEY || '', ...extra };
}

function clampInt(v, lo, hi, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d;
}

/** 音频响应是二进制，不能当 json 读 */
async function saveAudio(url, init, outPath) {
  const r = await fetchWithTimeout(url, init, TIMEOUT);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error(`返回 0 字节：${url}`);
  return saveBuffer(outPath, buf);
}

export async function make(brief, outPath) {
  const spec = (brief && brief.spec) || {};
  const kind = (brief && brief.kind) || 'voice';

  if (kind === 'voice') {
    const tier = spec.voice || 'zh-mid-male';
    const vid = voiceId(tier);
    const body = {
      text: spec.text || '',
      model_id: MODEL(),
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
    };
    const bytes = await saveAudio(`${API()}/v1/text-to-speech/${encodeURIComponent(vid)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json', accept: 'audio/mpeg' }),
      body: JSON.stringify(body),
    }, outPath);
    return { model: `${MODEL()}/${tier}→${vid.slice(0, 6)}…`, fallback: false, provider: name, bytes };
  }

  if (kind === 'sfx') {
    const body = {
      text: spec.prompt || '',
      duration_seconds: Math.max(0.5, Math.min(22, Number(spec.seconds) || 2)),
      prompt_influence: Math.max(0, Math.min(1, Number(spec.intensity) || 0.5)),
    };
    const bytes = await saveAudio(`${API()}/v1/sound-generation`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json', accept: 'audio/mpeg' }),
      body: JSON.stringify(body),
    }, outPath);
    return { model: 'elevenlabs/sound-generation', fallback: false, provider: name, bytes };
  }

  if (kind === 'music') {
    const body = {
      prompt: spec.prompt || '',
      music_length_ms: clampInt((Number(spec.seconds) || 30) * 1000, 10000, 300000, 30000),
    };
    const bytes = await saveAudio(`${API()}/v1/music?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json', accept: 'audio/mpeg' }),
      body: JSON.stringify(body),
    }, outPath);
    return { model: 'elevenlabs/music', fallback: false, provider: name, bytes };
  }

  throw new Error(`elevenlabs 不管 ${kind}（只做 voice/sfx/music）：${scrub(kind)}`);
}
