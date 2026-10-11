// v1 is an input recording, not a saved session. Only these engine methods can run.
export const STORAGE_KEY = 'dw.lastFilm';
export const OPS = ['begin', 'next', 'choose', 'watch', 'ask', 'chooseKeeper'];
export const PRESETS = {
  A: { wait: .8, polish: .8, depth: .85 },
  B: { wait: .2, polish: .2, depth: .25 },
};
export const DEFAULT_NEED = '我想看一个人在乱世里怎么做选择';

export function directorInput(director = 'B') {
  if (typeof director === 'string') {
    const key = ({ lu: 'A', shan: 'B', A: 'A', B: 'B' })[director];
    if (!key) throw new Error('录制中的导演不认识，请从游戏页重新录一局。');
    return { answers: { ...PRESETS[key] }, need: DEFAULT_NEED };
  }
  if (!director || typeof director !== 'object') throw new Error('录制缺少导演的口味。');
  const answers = director.answers;
  if (!answers || ['wait', 'polish', 'depth'].some(k => !Number.isFinite(answers[k]) || answers[k] < 0 || answers[k] > 1)) {
    throw new Error('导演口味要包含 0 到 1 之间的 wait、polish、depth。');
  }
  return { answers: { ...answers }, need: String(director.need ?? DEFAULT_NEED) };
}

function validate(record) {
  if (!record || record.v !== 1 || !Array.isArray(record.steps) || record.steps.length > 5000) {
    throw new Error('这份电影录制无法读取。请打开示范片，或回游戏页重新录制。');
  }
  directorInput(record.director);
  for (const step of record.steps) {
    if (!step || !OPS.includes(step.op) || !Array.isArray(step.args) || step.args.length > 1 ||
        step.args.some(a => typeof a !== 'string' || a.length > 200) ||
        (['begin', 'next'].includes(step.op) ? step.args.length !== 0 : step.args.length !== 1)) {
      throw new Error('录制中有不认识的动作，请回游戏页重新录制。');
    }
  }
  return record;
}

/** UTF-8 base64url, safe as a URLSearchParams film value. JSON/URI JSON also decode. */
export function encode(record) {
  const json = JSON.stringify(validate(record));
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > 128000) throw new Error('这局太长，分享链接装不下；请在本机看上一局。');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decode(value) {
  if (typeof value === 'object') return validate(value);
  if (typeof value !== 'string' || value.length > 256000) throw new Error('电影录制为空或太长。');
  let text = value.trim();
  if (text.startsWith('%')) text = decodeURIComponent(text);
  if (!text.startsWith('{')) {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
  }
  return validate(JSON.parse(text));
}

// Source: tests/fixtures/play-scripts.mjs B/yi/back/clean/en and B/yi/back/seen/yi.
// Their runScript shorthand auto-advances; replay.js applies exactly that convention.
const choose = choices => choices.map(arg => ({ op: 'choose', args: [arg] }));
export const DEMOS = {
  history: { v: 1, director: 'B', steps: choose(['yi', 'back', 'step', 'token_b', 'rush', 'step', 'en', 'seal', 'report']) },
  broken: { v: 1, director: 'B', steps: choose(['yi', 'back', 'step', 'step', 'yi', 'seal', 'report']) },
};
