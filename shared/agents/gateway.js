// 说话网关：NPC 说的每一句话都经过这里。模型只负责“润色”，失败或超额就用规则台词兜底。
// 不在这里直接调 fetch：call 由宿主注入，保证 shared/ 在浏览器和 Node 里都能跑，测试也能塞假的。

const TIMEOUT_MS = 8000;
// 出戏词：一旦模型说漏嘴（自称 AI、模型），整句作废，改用规则台词。
const BANNED = /\bAI\b|模型|作为一个/i;
const QUOTES = /["'“”‘’「」『』]/g;

const PURPOSES = ['对白', '设想', '改造'];

/** 清理模型输出：去换行、去引号、去首尾空白；空或出戏返回 null；超长截断。 */
export function cleanLine(text, maxChars = 40) {
  if (typeof text !== 'string') return null;
  const s = text.replace(/[\r\n]+/g, '').replace(QUOTES, '').trim();
  if (!s || BANNED.test(s)) return null;
  // 按字符（码点）截断，避免把汉字或 emoji 切成两半
  return Array.from(s).slice(0, maxChars).join('');
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('gateway timeout');
      err.code = 'TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildSystem(persona, view, maxChars) {
  const facts = (view || []).map((v) => `- ${v}`).join('\n');
  return `你是${persona}，生活在公元前258年。只知道下面这些事：\n${facts}\n用你的口吻说一句话，不超过${maxChars}字，不要旁白，不要引号。`;
}

export function createSpeaker({ ledger, call, limits = { 对白: 30, 设想: 6, 改造: 1 } }) {
  const keys = [...new Set([...PURPOSES, ...Object.keys(limits)])];
  const used = Object.fromEntries(keys.map((k) => [k, 0]));

  const fallbackOut = (fallback) => ({ text: fallback ?? '', source: 'rule' });

  async function say({ purpose, role, persona, view = [], line, fallback, maxChars = 40, cause = [] }) {
    const limit = limits[purpose] ?? 0;
    // 超额：不调用、不记账，直接兜底
    if ((used[purpose] ?? 0) >= limit) return fallbackOut(fallback);
    // 先占名额，防止并发时超出上限
    used[purpose] = (used[purpose] ?? 0) + 1;

    const request = {
      system: buildSystem(persona, view, maxChars),
      user: line,
      maxTokens: Math.max(64, maxChars * 4),
    };

    let out = null;
    let meta = { model: null, ms: 0, tokens: 0 };
    try {
      // 用 Promise.resolve().then 包一层，让 call 同步抛错也走 catch
      const res = await withTimeout(Promise.resolve().then(() => call(request)), TIMEOUT_MS);
      meta = { model: res?.model ?? null, ms: res?.ms ?? 0, tokens: res?.tokens ?? 0 };
      out = cleanLine(res?.text, maxChars);
    } catch (err) {
      meta.ms = err?.code === 'TIMEOUT' ? TIMEOUT_MS : 0;
    }

    // 真的调用过（成功或失败）都要留痕，cause 把它接回用户
    ledger?.append({
      kind: 'gateway.call',
      from: 'gateway',
      payload: { purpose, model: meta.model, ms: meta.ms, tokens: meta.tokens, ok: out !== null },
      cause,
    });

    if (out === null) return fallbackOut(fallback);
    return { text: out, source: 'model', model: meta.model, ms: meta.ms };
  }

  function usage() {
    return Object.fromEntries(keys.map((k) => [k, { used: used[k] ?? 0, limit: limits[k] ?? 0 }]));
  }

  return { say, usage };
}

/**
 * 浏览器端的 call：把请求 POST 到本机服务器 /api/speak，凭据只留在服务器。
 * 返回 call(request)，request = { system, user, maxTokens }。
 */
export function makeBrowserCall() {
  return async function call({ system, user, maxTokens }) {
    const res = await globalThis.fetch('/api/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system, user, maxTokens }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data; // { text, model, ms, tokens }
  };
}
