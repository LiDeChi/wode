// 规则表：场景写成数据，内核只负责“从上到下，第一条匹配的生效”（等价于旧的 if/else 链）。
//
// when 能读的事实（docs/KERNEL.md §4）：
//   intent（id 或 id 数组）、person、accepted、backlash、stoppedAt、action（字符串，可写正则）、
//   flag:{k:v}、trust:{person,gte|lt}、at（位置）、ctrl.<id>.<key>（控制器状态）。
// 全部条件按 AND 组合；顶层 when.not 取反。匹配不到的事实一律不算满足。
// 内核还额外提供 facts.seen / facts.seenBy（被谁看见了）、facts.verdict（导演批没批），
// 以及 facts.<控制器id> 的快捷别名（例如 facts.space.pos），供场景作者少写一层。

const isPlain = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
/** 这些键不是条件，是规则的结果字段 */
const RESULT_KEYS = new Set(['then', 'text', 'cost', 'choice', 'end', 'why', 'id', 'note']);

/** 读一条虚线路径：readPath({ctrl:{space:{pos:2}}}, 'ctrl.space.pos') -> 2 */
export function readPath(obj, path) {
  let cur = obj;
  for (const k of String(path || '').split('.')) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

const same = (want, got) => {
  if (want === null) return got == null;
  if (typeof want === 'boolean') return !!got === want;
  return want === got;
};
const oneOf = (want, got) => (Array.isArray(want) ? want.some((w) => same(w, got)) : same(want, got));
const regexOf = (want) => (want instanceof RegExp ? want : new RegExp(String(want)));

/** 子集匹配：want 里写的每个键都要在 got 里对上（ctrl.<id>.<key> 就靠它） */
function deepMatch(want, got) {
  if (!isPlain(want)) return same(want, got);
  if (!isPlain(got)) return false;
  for (const [k, v] of Object.entries(want)) if (!deepMatch(v, got[k])) return false;
  return true;
}

function matchTrust(want, facts) {
  const v = facts.trust?.[want.person] ?? 0.3;
  if (want.gte != null && !(v >= want.gte)) return false;
  if (want.gt != null && !(v > want.gt)) return false;
  if (want.lte != null && !(v <= want.lte)) return false;
  if (want.lt != null && !(v < want.lt)) return false;
  if (want.eq != null && !same(want.eq, v)) return false;
  return true;
}

/** 一条 when 是否成立 */
export function matchRule(when, facts = {}) {
  if (!when) return true;
  for (const [k, want] of Object.entries(when)) {
    if (RESULT_KEYS.has(k)) continue;
    if (k === 'not') { if (matchRule(want, facts)) return false; continue; }
    if (k === 'action') { if (!regexOf(want).test(String(facts.action ?? ''))) return false; continue; }
    if (k === 'flag') { for (const [fk, fv] of Object.entries(want)) if (!same(fv, facts.flag?.[fk])) return false; continue; }
    if (k === 'trust') { if (!matchTrust(want, facts)) return false; continue; }
    if (k === 'ctrl') { if (!deepMatch(want, facts.ctrl)) return false; continue; }
    if (!oneOf(want, facts[k])) return false;
  }
  return true;
}

/** 第一条匹配的规则；都不匹配返回 null */
export function firstRule(rules, facts) {
  for (const r of rules || []) if (matchRule(r?.when, facts)) return r;
  return null;
}

/** 把 '{action}'、'{ctrl.space.pos}' 换成事实里的值；取不到就留空 */
export function fillText(text, facts) {
  if (typeof text !== 'string' || text.indexOf('{') < 0) return text;
  return text.replace(/\{([A-Za-z_][\w.]*)\}/g, (m, path) => {
    const v = readPath(facts, path);
    return v == null ? '' : String(v);
  });
}

/**
 * 场景数据里的小表达式（控制器配置用）：字面量原样返回。
 *   { path:'ctrl.attention.seen' }  读一条路径
 *   { trust:'ruji', add:0.1 }       某人对你的信任，加一点
 *   { flag:'kingSuspicious' }       读一个世界旗标
 *   { unit:'risk' }                 由 perceive 单独解释（是不是这个单元的动作）
 */
export function readValue(spec, facts) {
  if (!isPlain(spec)) return spec;
  if ('path' in spec) return readPath(facts, spec.path);
  if ('flag' in spec) return facts.flag?.[spec.flag];
  if ('trust' in spec) return (facts.trust?.[spec.trust] ?? 0.3) + (spec.add || 0);
  return spec;
}
