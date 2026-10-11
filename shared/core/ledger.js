// 账本：整个产品唯一的写入口。只追加，不修改。
// 每一条都是一条“消息”：谁（from）发给谁（to），说了什么（payload），因为哪几条（cause）。
// “为用户服务”因此可以被检验：任何一个导师或导演的决定，沿 cause 往回走，必须走到用户做过或说过的某件事。

/** 角色标识：'user' | 'mentor' | 'director:<id>' | 'actor:<id>' | 'world' | 'gateway' | 'presentation:<id>' */
export function roleKind(role) {
  const r = String(role || '');
  const i = r.indexOf(':');
  return i < 0 ? r : r.slice(0, i);
}

export function roleId(role) {
  const r = String(role || '');
  const i = r.indexOf(':');
  return i < 0 ? r : r.slice(i + 1);
}

/* 64 位 FNV 变体，只用于给每条记录一个可复验的指纹，不用于安全。 */
export function hashHex(input) {
  const s = typeof input === 'string' ? input : JSON.stringify(input);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * 一条记录的形状：
 * { seq, kind, from, to, payload, cause:number[], said?, saidSource?, scene?, hash }
 * - kind：'user.*' 用户的输入；'mentor.*' / 'director.*' / 'actor.*' 角色的决定；'claim.*' 主张图的变化；'present.*' 呈现的交付
 * - payload：硬的部分（输入、选项、所选），可重算
 * - said：软的部分（“他当时的说法”），可以来自模型，只算说话人自己的主张
 */
export function createLedger(initial = []) {
  const entries = [];
  const listeners = new Set();

  function append({ kind, from, to = 'world', payload = {}, cause = [], said, saidSource, scene }) {
    if (!kind || !from) throw new Error('ledger.append 需要 kind 和 from');
    const seq = entries.length + 1;
    const causes = [...new Set((cause || []).filter((c) => Number.isInteger(c) && c > 0 && c < seq))];
    const prev = entries.length ? entries[entries.length - 1].hash : '0';
    const entry = { seq, kind, from, to, payload, cause: causes };
    if (said !== undefined) { entry.said = said; entry.saidSource = saidSource || 'rule'; }
    if (scene) entry.scene = scene;
    entry.hash = hashHex([prev, seq, kind, from, to, payload, causes]);
    entries.push(entry);
    for (const fn of listeners) fn(entry);
    return entry;
  }

  for (const e of initial) {
    append(e);
  }

  return {
    entries,
    append,
    get: (seq) => entries[seq - 1],
    get size() { return entries.length; },
    filter: (pred) => entries.filter(pred),
    ofKind: (prefix) => entries.filter((e) => e.kind === prefix || e.kind.startsWith(prefix + '.')),
    last: (pred = () => true) => { for (let i = entries.length - 1; i >= 0; i--) if (pred(entries[i])) return entries[i]; return undefined; },
    since: (seq) => entries.slice(seq),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** 只保存可重建的部分；hash 在载入时重算并比对 */
    toJSON: () => entries.map(({ hash, ...rest }) => ({ ...rest, hash })),
  };
}

/** 从 JSON 重建；任何一条指纹不符就报错，说明账本被改过。 */
export function loadLedger(json) {
  const ledger = createLedger();
  for (const raw of json || []) {
    const { seq, hash, ...rest } = raw;
    const e = ledger.append(rest);
    if (hash && e.hash !== hash) throw new Error(`账本第 ${seq} 条指纹不符：被改过`);
  }
  return ledger;
}

/** 某条记录往回追，最短的一条走到用户的路径。返回 { ok, path:[seq...从用户到这一条], root } */
export function traceToUser(ledger, seq) {
  const start = ledger.get(seq);
  if (!start) return { ok: false, path: [], root: null };
  if (roleKind(start.from) === 'user') return { ok: true, path: [seq], root: seq };
  const prevOf = new Map([[seq, null]]);
  const queue = [seq];
  while (queue.length) {
    const cur = queue.shift();
    for (const c of ledger.get(cur).cause) {
      if (prevOf.has(c)) continue;
      prevOf.set(c, cur);
      if (roleKind(ledger.get(c).from) === 'user') {
        const path = [c];
        let p = cur;
        while (p !== null) { path.push(p); p = prevOf.get(p); }
        return { ok: true, path, root: c };
      }
      queue.push(c);
    }
  }
  return { ok: false, path: [], root: null };
}

/** 往回追的全部祖先（含自己），用于“这件事是因为哪些事”的展开 */
export function ancestors(ledger, seq) {
  const seen = new Set();
  const stack = [seq];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur) || !ledger.get(cur)) continue;
    seen.add(cur);
    stack.push(...ledger.get(cur).cause);
  }
  return [...seen].sort((a, b) => a - b);
}

/** 往前追的全部后代：用户的一件事，后来长出了什么 */
export function descendants(ledger, seq) {
  const children = new Map();
  for (const e of ledger.entries) for (const c of e.cause) {
    if (!children.has(c)) children.set(c, []);
    children.get(c).push(e.seq);
  }
  const seen = new Set();
  const stack = [seq];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(children.get(cur) || []));
  }
  return [...seen].sort((a, b) => a - b);
}

/** 决定类的记录：导师和导演做出的、需要对用户负责的那些 */
export const DECISION_KINDS = ['mentor.allot', 'mentor.brief', 'mentor.note', 'mentor.learn', 'director.design', 'director.predict', 'director.grant', 'director.schedule', 'director.learn'];

/**
 * 服务审计：每一个决定都必须能追到用户。
 * 返回 { total, served, orphans:[seq], byRole:{mentor:{total,served}, director:{...}}, ok }
 */
export function auditService(ledger, kinds = DECISION_KINDS) {
  const out = { total: 0, served: 0, orphans: [], byRole: {} };
  for (const e of ledger.entries) {
    if (!kinds.includes(e.kind)) continue;
    const k = roleKind(e.from);
    out.byRole[k] ||= { total: 0, served: 0 };
    out.total++; out.byRole[k].total++;
    if (traceToUser(ledger, e.seq).ok) { out.served++; out.byRole[k].served++; }
    else out.orphans.push(e.seq);
  }
  out.ok = out.total > 0 && out.orphans.length === 0;
  return out;
}
