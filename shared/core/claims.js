// 主张图：世界状态不是事实表。每条记录是“某个视角认为某事如此”。
// 当前的“事实”只是认可度最高的那一组主张；推翻要付代价，被推翻的留作“曾经的共识”。
// 主张图的每一次变化都写进账本（kind 'claim.*'），所以主张的来历也能追到用户。

export const CHANNELS = ['亲历', '被告知', '公开', '设定'];
export const STATUS = { ACTIVE: 'active', FORMER: 'former', DISPUTED: 'disputed' };
/** 推翻成本低于它：自动成为“误会”并存；高于它：必须有人批准，成为“反转事件” */
export const REVERSAL_THRESHOLD = 4;

const keyOf = (c) => `${c.subject}|${c.predicate}`;

export function createClaimGraph(ledger, saved) {
  const claims = new Map();
  let nextId = 1;
  // 存档重开：主张图整张带回来（claim.add 的 payload 不含证据、依赖、认可者，从账本重放会丢东西）
  if (saved) {
    for (const c of saved.claims || []) claims.set(c.id, JSON.parse(JSON.stringify(c)));
    nextId = saved.nextId || claims.size + 1;
  }

  function weightOf(c) {
    let w = 0;
    for (const v of Object.values(c.endorsers)) w += v;
    return w;
  }

  function downstream(id) {
    const out = [];
    const stack = [id];
    const seen = new Set([id]);
    while (stack.length) {
      const cur = stack.pop();
      for (const c of claims.values()) {
        if (c.deps.includes(cur) && !seen.has(c.id)) { seen.add(c.id); out.push(c.id); stack.push(c.id); }
      }
    }
    return out;
  }

  /** 推翻成本 = 认可度 + 下游依赖数 + 被引用交付次数 */
  function overturnCost(id) {
    const c = claims.get(id);
    if (!c) return 0;
    return +(weightOf(c) + downstream(id).length + 1.5 * c.citedBy.length).toFixed(2);
  }

  function rivalsOf(c) {
    return [...claims.values()].filter((o) => o.id !== c.id && keyOf(o) === keyOf(c) && o.status !== STATUS.FORMER && !sameObject(o.object, c.object));
  }

  function sameObject(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /** 新主张进入前先检查：和谁冲突，各要付多少 */
  function checkConflict(draft) {
    const k = keyOf(draft);
    const conflicts = [...claims.values()]
      .filter((o) => keyOf(o) === k && o.status !== STATUS.FORMER && !sameObject(o.object, draft.object))
      .map((o) => ({ id: o.id, holder: o.holder, object: o.object, cost: overturnCost(o.id) }));
    const maxCost = conflicts.reduce((m, c) => Math.max(m, c.cost), 0);
    const verdict = !conflicts.length ? 'none' : maxCost < REVERSAL_THRESHOLD ? 'misunderstanding' : 'reversal-needed';
    return { conflicts, maxCost, verdict };
  }

  /**
   * 加一条主张。presentation 是它出自哪个呈现；cause 是账本里让它产生的记录。
   * 冲突代价小：两个版本并存（误会）；代价大：这条以 disputed 状态进入，不能成为共识，除非走 overturn。
   */
  function add({ subject, predicate, object, holder, channel = '亲历', evidence = [], deps = [], presentation = null, weight = 1, cause = [], note }) {
    if (!subject || !predicate || !holder) throw new Error('主张需要 subject、predicate、holder');
    if (!CHANNELS.includes(channel)) throw new Error(`未知渠道：${channel}`);
    const check = checkConflict({ subject, predicate, object });
    const id = `c${nextId++}`;
    const status = check.verdict === 'reversal-needed' ? STATUS.DISPUTED : STATUS.ACTIVE;
    const entry = ledger.append({
      kind: 'claim.add', from: presentation ? `presentation:${presentation}` : holder, to: 'world', cause,
      payload: { id, subject, predicate, object, holder, channel, presentation, verdict: check.verdict, conflicts: check.conflicts.map((c) => c.id) },
    });
    const claim = {
      id, subject, predicate, object, holder, channel, evidence, deps: [...deps],
      endorsers: { [holder]: weight }, citedBy: [], presentation, readBy: [], status, seq: entry.seq, note,
      history: [{ seq: entry.seq, what: 'add', verdict: check.verdict }],
    };
    claims.set(id, claim);
    if (check.verdict === 'misunderstanding') {
      for (const c of check.conflicts) claims.get(c.id).history.push({ seq: entry.seq, what: 'misunderstanding', with: id });
    }
    return { claim, check, seq: entry.seq };
  }

  function endorse(id, holder, weight = 1, cause = [], presentation = null) {
    const c = claims.get(id);
    if (!c) throw new Error(`没有这条主张：${id}`);
    c.endorsers[holder] = Math.max(c.endorsers[holder] || 0, weight);
    const e = ledger.append({ kind: 'claim.endorse', from: presentation ? `presentation:${presentation}` : holder, to: 'world', cause, payload: { id, holder, weight, presentation } });
    c.history.push({ seq: e.seq, what: 'endorse', holder });
    return e.seq;
  }

  /** 一个呈现读取了某条主张（承接的起点） */
  function read(id, presentation, cause = []) {
    const c = claims.get(id);
    if (!c) throw new Error(`没有这条主张：${id}`);
    if (!c.readBy.includes(presentation)) c.readBy.push(presentation);
    const e = ledger.append({ kind: 'claim.read', from: `presentation:${presentation}`, to: 'world', cause, payload: { id, presentation } });
    return e.seq;
  }

  /** 一个呈现沿用了某条主张：认可度上升，推翻成本变高 */
  function cite(id, presentation, cause = []) {
    const c = claims.get(id);
    if (!c) throw new Error(`没有这条主张：${id}`);
    if (!c.citedBy.includes(presentation)) c.citedBy.push(presentation);
    c.endorsers[`presentation:${presentation}`] = 1;
    const e = ledger.append({ kind: 'claim.cite', from: `presentation:${presentation}`, to: 'world', cause, payload: { id, presentation, cost: overturnCost(id) } });
    c.history.push({ seq: e.seq, what: 'cite', presentation });
    return e.seq;
  }

  /**
   * 推翻：三件事缺一不可——新证据、解释旧共识为何会错、处理下游。
   * 代价大时还要 approvedBy（导演或导师）。旧主张不删，标为“曾经的共识”。
   */
  function overturn(oldId, { replacement, evidence, explanation, approvedBy, presentation, cause = [] }) {
    const old = claims.get(oldId);
    if (!old) throw new Error(`没有这条主张：${oldId}`);
    const cost = overturnCost(oldId);
    const missing = [];
    if (!evidence || !evidence.length) missing.push('新证据');
    if (!explanation) missing.push('解释旧共识为什么会错');
    if (cost >= REVERSAL_THRESHOLD && !approvedBy) missing.push('导演或导师的批准');
    if (missing.length) {
      const e = ledger.append({ kind: 'claim.overturn-refused', from: presentation ? `presentation:${presentation}` : 'world', to: 'world', cause, payload: { id: oldId, cost, missing } });
      return { ok: false, cost, missing, seq: e.seq };
    }
    let newClaim = replacement && claims.get(replacement);
    if (!newClaim && replacement && typeof replacement === 'object') newClaim = add({ ...replacement, presentation, cause }).claim;
    const affected = downstream(oldId);
    const e = ledger.append({
      kind: 'claim.overturn', from: approvedBy || (presentation ? `presentation:${presentation}` : 'world'), to: 'world', cause,
      payload: { id: oldId, by: newClaim?.id, cost, explanation, evidence, approvedBy, presentation, affected },
    });
    old.status = STATUS.FORMER;
    old.overturnedBy = newClaim?.id;
    old.history.push({ seq: e.seq, what: 'overturned', by: newClaim?.id, explanation });
    if (newClaim) {
      newClaim.status = STATUS.ACTIVE;
      newClaim.evidence = [...newClaim.evidence, ...evidence];
      newClaim.history.push({ seq: e.seq, what: 'won', over: oldId });
    }
    for (const a of affected) {
      const d = claims.get(a);
      d.history.push({ seq: e.seq, what: 'upstream-overturned', upstream: oldId });
      if (d.status === STATUS.ACTIVE) d.status = STATUS.DISPUTED;
    }
    return { ok: true, cost, affected, seq: e.seq, newId: newClaim?.id };
  }

  /** 某个 subject|predicate 当前的共识：未被推翻、认可度最高的那一条 */
  function consensus(subject, predicate) {
    const pool = [...claims.values()].filter((c) => c.subject === subject && c.predicate === predicate && c.status === STATUS.ACTIVE);
    pool.sort((a, b) => weightOf(b) - weightOf(a) || a.seq - b.seq);
    return pool[0];
  }

  /** 角色可得视图：他自己持有的、别人告诉他的、公开的、设定的；不含他看不到的亲历 */
  function viewFor(holder, { told = [] } = {}) {
    return [...claims.values()].filter((c) => c.status !== STATUS.FORMER && (
      c.holder === holder || c.channel === '公开' || c.channel === '设定' || told.includes(c.id) || c.endorsers[holder]
    ));
  }

  /**
   * 两个呈现之间的关系，全部由主张图算出，不是手写的标签：
   * 承接：A 产生的主张被 B 读到；引用：B 沿用了 A 的主张；并行：两者对同一件事各有主张且都成立；
   * 争议：两者的主张冲突、都未被推翻；反转：B 推翻了 A 的主张。
   */
  function relations(a, b) {
    const out = [];
    const fromA = [...claims.values()].filter((c) => c.presentation === a);
    const fromB = [...claims.values()].filter((c) => c.presentation === b);
    for (const c of fromA) {
      if (c.readBy.includes(b)) out.push({ type: '承接', claims: [c.id] });
      if (c.citedBy.includes(b)) out.push({ type: '引用', claims: [c.id] });
      if (c.status === STATUS.FORMER && c.overturnedBy && claims.get(c.overturnedBy)?.presentation === b) out.push({ type: '反转', claims: [c.id, c.overturnedBy] });
      for (const d of fromB) {
        if (keyOf(c) !== keyOf(d)) continue;
        if (sameObject(c.object, d.object)) continue;
        if (c.status === STATUS.FORMER || d.status === STATUS.FORMER) continue;
        const both = c.status === STATUS.ACTIVE && d.status === STATUS.ACTIVE;
        out.push({ type: both ? '并行' : '争议', claims: [c.id, d.id] });
      }
    }
    return out;
  }

  return {
    claims,
    add, endorse, read, cite, overturn, checkConflict, overturnCost, consensus, viewFor, relations, downstream,
    weightOf: (id) => weightOf(claims.get(id)),
    get: (id) => claims.get(id),
    all: () => [...claims.values()],
    find: (pred) => [...claims.values()].filter(pred),
    rivalsOf: (id) => rivalsOf(claims.get(id)),
    /** 存档用：和 createClaimGraph(ledger, saved) 成对 */
    toJSON: () => ({ nextId, claims: [...claims.values()] }),
  };
}
