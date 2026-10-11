// 角色记忆（docs/research/agent-memory/DECISION.md §2.1、§3）。
//
// 这一层是结构，不是 LLM：一条记忆只存「指向账本的 seq + 由规则算出来的分量」，
// 事实本身不复制（账本 session.ledger.entries 是唯一事实源，LIVING §7）。
//
//   remember(entry) -> id        去重（同 sig 同 id）+ 规则算 impact + 只存 seq
//   recall(query)               无向量：三路召回 → RRF 1/(rank+1) 融合 → 归一再加权精排
//   consolidate({toTick})       计数器到位才巩固：原始 → 观察(depth1) → 反思(depth2)
//   forget({toTick})            activation 衰减 + expires 过期 + 容量淘汰（高 impact 豁免）
//   tick({toTick})              只推进时序（activation / lastAccess 节流），不巩固不遗忘
//   save() / restore(saved)     纯 JSON 往返（没有 Map/Set/函数）
//
// 零依赖、纯 ES 模块、没有 Math.random / Date / fs / process；种子要随机就走 shared/core/rng.js。

const round3 = (v) => Math.round(Number(v) * 1000) / 1000;
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const copy = (x) => JSON.parse(JSON.stringify(x));

export const MEMORY_DEFAULTS = {
  capacity: 240,        // 条目上限（超过就淘汰，高 impact 豁免）
  decay: 0.99,          // 新近度指数衰减：decay^(now - tick)
  consolidateAt: 1.2,   // 累积 impact 达到这么多就巩固一次
  bucketSize: 8,        // 一桶多少条 → 出一条上一层的摘要
  overFetch: 4,         // 先多取几倍候选再精排（3–5 倍）
  throttleTicks: 5,     // lastAccess 按逻辑拍节流：不足这么多拍不重复写
  forgetRatio: 0.3,     // 一次最多淘汰三成（letta 的比例思想）
  keepRecent: 15,       // 无论如何保留最近这么多条
  exemptImpact: 0.6,    // impact >= 这个数的记忆豁免淘汰
  levels: 2,            // 分层：原始 → 观察 → 反思
  weights: { relevance: 3, importance: 2, recency: 0.5 },
};

/** 稳定签名：调用方可以自己传 sig；不传就按「型/人/场/账本位置（或关键词）」算 */
export function sigOf(entry = {}) {
  const key = entry.seq != null ? `s${entry.seq}` : (Array.isArray(entry.keywords) && entry.keywords.length ? entry.keywords.slice().sort().join('+') : `t${entry.tick ?? 0}`);
  return `${entry.kind || 'event'}|${entry.actorId ?? entry.person ?? '-'}|${entry.sceneId ?? entry.scene ?? '-'}|${key}`;
}

/**
 * impact 由规则算（替换 LLM 的 poignancy）：
 *   0.4*error + 0.3*命中目标 + 0.2*首次发生 + 0.1*min(1,|moved|)
 * error 来自 perceive 的停层/剩余权重，moved 来自 hear——都是现成的确定性量。
 */
export function impactOf(entry = {}) {
  if (entry.impact != null) return clamp01(entry.impact);
  const error = clamp01(entry.error ?? 0);
  const goal = entry.goalHit === true || (entry.goals || []).length > 0 ? 1 : 0;
  const first = entry.first === true ? 1 : 0;
  const moved = Math.min(1, Math.abs(Number(entry.moved) || 0));
  return round3(clamp01(0.4 * error + 0.3 * goal + 0.2 * first + 0.1 * moved));
}

function normalize(entry = {}) {
  const tick = Number(entry.tick ?? 0);
  const actorId = entry.actorId ?? entry.person ?? null;
  const sceneId = entry.sceneId ?? entry.scene ?? null;
  const keywords = [...new Set((entry.keywords || []).map(String))].sort();
  const e = {
    id: entry.id || null,
    seq: entry.seq ?? null,               // 唯一事实源在账本：这里只有指针
    kind: entry.kind || 'event',          // event | thought | claim
    tick,
    sceneId,
    actorId,
    who: [...new Set((entry.who || []).map(String))].sort(),
    sig: String(entry.sig || sigOf({ ...entry, actorId, sceneId, keywords, tick })),
    keywords,
    impact: impactOf(entry),
    depth: Number(entry.depth ?? 0),
    activation: entry.activation != null ? round3(entry.activation) : 0.6,
    consolidation: Number(entry.consolidation ?? 0),
    lastAccess: Number(entry.lastAccess ?? tick),
    expires: entry.expires ?? null,
    from: Array.isArray(entry.from) ? entry.from.slice() : [],
    episode: entry.episode ?? null,
  };
  return e;
}

/**
 * 确定性记忆存储。opts.saved 是 save() 的原样返回；opts 里同名的键覆盖 MEMORY_DEFAULTS。
 */
export function createMemoryStore(opts = {}) {
  const cfg = { ...MEMORY_DEFAULTS, ...(opts || {}) };
  cfg.weights = { ...MEMORY_DEFAULTS.weights, ...((opts || {}).weights || {}) };

  let entries = [];
  let byId = new Map();
  let bySig = new Map();
  let nextId = 1;
  let now = 0;
  let pending = 0;          // 累积的 impact：到 consolidateAt 才巩固

  function reindex() {
    byId = new Map(entries.map((e) => [e.id, e]));
    bySig = new Map(entries.map((e) => [e.sig, e]));
  }

  function restore(saved) {
    const s = saved || {};
    entries = Array.isArray(s.entries) ? s.entries.map(normalize) : [];
    nextId = s.nextId ?? entries.length + 1;
    now = s.now ?? 0;
    pending = s.pending ?? 0;
    reindex();
    return api;
  }

  /** 写：同 sig 只留一条（返回同一个 id）；impact 由规则算；只存 seq */
  function remember(entry = {}) {
    const e = normalize(entry);
    const dup = bySig.get(e.sig);
    if (dup) {
      // 同一件事再次发生：只让它更亮一点，不新增条目
      dup.activation = round3(Math.min(2, dup.activation + 0.2));
      if (e.seq != null && dup.seq == null) dup.seq = e.seq;
      return dup.id;
    }
    e.id = e.id || `m${nextId++}`;
    e.episode = entry.episode ?? e.episode;
    entries.push(e);
    byId.set(e.id, e);
    bySig.set(e.sig, e);
    pending = round3(pending + e.impact);
    return e.id;
  }

  function get(id) { const e = byId.get(id); return e ? copy(e) : null; }
  function has(sig) { return bySig.has(String(sig)); }
  function all() { return entries.map(copy); }
  function size() { return entries.length; }

  /** 三路召回：按人 / 按场 / 按关键词；每一路各自排名 */
  function routes(query = {}) {
    const actorId = query.actorId ?? null;
    const sceneId = query.sceneId ?? null;
    const people = new Set([...(query.people || []), ...(actorId ? [actorId] : [])]);
    const keywords = new Set((query.keywords || []).map(String));
    const hitPeople = (e) => (e.actorId && people.has(e.actorId)) || e.who.some((w) => people.has(w));
    const kwHits = (e) => e.keywords.filter((k) => keywords.has(k)).length;
    const out = [];
    const byActor = actorId || people.size
      ? entries.filter(hitPeople).sort((a, b) => (b.impact - a.impact) || (b.tick - a.tick) || (a.id < b.id ? -1 : 1))
      : [];
    const byScene = sceneId
      ? entries.filter((e) => e.sceneId === sceneId).sort((a, b) => (b.tick - a.tick) || (b.impact - a.impact) || (a.id < b.id ? -1 : 1))
      : [];
    const byKeyword = keywords.size
      ? entries.filter((e) => kwHits(e) > 0).sort((a, b) => (kwHits(b) - kwHits(a)) || (b.impact - a.impact) || (a.id < b.id ? -1 : 1))
      : [];
    out.push({ name: 'actor', list: byActor }, { name: 'scene', list: byScene }, { name: 'keyword', list: byKeyword });
    return { routes: out, hitPeople, kwHits, keywords };
  }

  /**
   * 读：结构化查询，没有自然语言、没有向量。
   * query = { actorId, sceneId, tick, appeals:[], keywords:[], people:[], need, k, budget }
   * 返回 [{ id, seq, kind, tick, depth, impact, score:{ relevance, importance, recency, rrf } }]
   */
  function recall(query = {}) {
    const nowTick = Number(query.tick ?? now);
    const k = Math.max(1, Number(query.k ?? 8));
    const { routes: rs, hitPeople, kwHits, keywords } = routes(query);
    const appeals = new Set((query.appeals || []).map(String));
    const appealHit = (e) => (appeals.size ? e.keywords.filter((x) => appeals.has(x)).length : 0);

    // 多路召回：RRF 1/(rank+1) 求和（不同量纲不用对齐）
    const rrf = new Map();
    for (const r of rs) {
      r.list.forEach((e, i) => {
        const cur = rrf.get(e.id) || { e, rrf: 0, rank: {} };
        cur.rrf += 1 / (i + 1);
        cur.rank[r.name] = i;
        rrf.set(e.id, cur);
      });
    }
    const pool = [...rrf.values()].sort((a, b) => (b.rrf - a.rrf) || (b.e.impact - a.e.impact) || (a.e.id < b.e.id ? -1 : 1));
    const take = Math.min(pool.length, k * Math.max(1, Number(cfg.overFetch)));
    const short = pool.slice(0, take);

    // 精排：三路各自归一到 0..1，再按 相关度 3 : 重要度 2 : 新近度 0.5 加权
    const raw = short.map(({ e, rrf: r }) => ({
      e,
      rrf: r,
      relevance: clamp01(
        0.5 * (hitPeople(e) ? 1 : 0)
        + 0.2 * (query.sceneId && e.sceneId === query.sceneId ? 1 : 0)
        + 0.2 * (appealHit(e) > 0 ? 1 : 0)
        + 0.1 * (keywords.size ? Math.min(1, kwHits(e) / keywords.size) : 0),
      ),
      importance: clamp01(e.impact),
      recency: clamp01(Math.pow(Number(cfg.decay), Math.max(0, nowTick - e.tick))),
    }));
    const maxOf = (key) => raw.reduce((m, x) => Math.max(m, x[key]), 0) || 1;
    const mr = maxOf('relevance'), mi = maxOf('importance'), mc = maxOf('recency');
    const scored = raw.map((x) => {
      const relevance = x.relevance / mr, importance = x.importance / mi, recency = x.recency / mc;
      return {
        e: x.e,
        rrf: x.rrf,
        score: {
          relevance: round3(relevance),
          importance: round3(importance),
          recency: round3(recency),
          rrf: round3(x.rrf),
          total: round3(cfg.weights.relevance * relevance + cfg.weights.importance * importance + cfg.weights.recency * recency),
        },
      };
    });
    scored.sort((a, b) => (b.score.total - a.score.total) || (b.score.rrf - a.score.rrf) || (a.e.id < b.e.id ? -1 : 1));

    // 命中即更新 lastAccess，按逻辑拍节流
    const out = scored.slice(0, k).map(({ e, score }) => {
      if (nowTick - e.lastAccess >= Number(cfg.throttleTicks)) e.lastAccess = nowTick;
      return { id: e.id, seq: e.seq, kind: e.kind, tick: e.tick, depth: e.depth, impact: e.impact, score: { ...score } };
    });
    return out;
  }

  function decayTo(toTick) {
    const target = Math.max(now, Math.floor(Number(toTick ?? now)));
    const dt = target - now;
    if (dt > 0) {
      for (const e of entries) e.activation = round3(Math.max(0, e.activation - 0.15 * dt));
    }
    now = target;
    return now;
  }

  /**
   * 巩固：计数器到位才做。原始条目按桶抽出一条 depth+1 的 thought（关键词并集、who 并集、
   * impact 取最大、seq 指向最新那一条）；每 bucketSize 条上一层再抽一条反思。
   * 返回这一拍新产出的条目（没有就返回空数组）。
   */
  function consolidate({ toTick } = {}) {
    decayTo(toTick);
    const made = [];
    let guard = 0;
    while (pending >= Number(cfg.consolidateAt) && guard < 16) {
      guard += 1;
      const pool = entries.filter((e) => e.depth === 0 && !e.bucketed).sort((a, b) => (b.tick - a.tick) || (a.id < b.id ? -1 : 1));
      if (pool.length < Number(cfg.bucketSize)) break;
      const bucket = pool.slice(0, Number(cfg.bucketSize));
      const made1 = summarize(bucket, 1, `sum1:${bucket.map((e) => e.id).join('+')}`);
      made.push(made1);
      pending = round3(pending - Number(cfg.consolidateAt));
    }
    // 上一层：攒够一桶 depth1 就抽一条 depth2 的反思
    const lvl1 = entries.filter((e) => e.depth === 1 && !e.bucketed).sort((a, b) => (b.tick - a.tick) || (a.id < b.id ? -1 : 1));
    if (lvl1.length >= Number(cfg.bucketSize) * Number(cfg.bucketSize) && Number(cfg.levels) >= 2) {
      const made2 = summarize(lvl1.slice(0, Number(cfg.bucketSize)), 2, `sum2:${lvl1.slice(0, Number(cfg.bucketSize)).map((e) => e.id).join('+')}`);
      made.push(made2);
    }
    return made;
  }

  /** 一桶 → 一条上一层条目（关键词并集、who 并集、impact 取最大、seq 指最新） */
  function summarize(bucket, depth, sig) {
    const newest = bucket.slice().sort((a, b) => (b.tick - a.tick) || (a.id < b.id ? -1 : 1))[0];
    for (const e of bucket) e.bucketed = true;
    const e = normalize({
      id: `m${nextId++}`,
      kind: 'thought',
      depth,
      tick: newest.tick,
      sceneId: newest.sceneId,
      actorId: newest.actorId,
      who: bucket.flatMap((x) => [x.actorId, ...x.who]).filter(Boolean),
      keywords: bucket.flatMap((x) => x.keywords),
      sig,
      seq: bucket.map((x) => x.seq).filter((x) => x != null).sort((a, b) => b - a)[0] ?? newest.seq,
      impact: Math.max(...bucket.map((x) => x.impact)),
      activation: round3(Math.max(...bucket.map((x) => x.activation))),
      consolidation: Math.max(...bucket.map((x) => x.consolidation)) + 1,
      lastAccess: now,
      from: bucket.map((x) => x.id),
      episode: newest.episode,
    });
    entries.push(e);
    byId.set(e.id, e);
    bySig.set(e.sig, e);
    return copy(e);
  }

  /**
   * 遗忘：activation 衰减（tick 已经做过）+ expires 过期 + 容量淘汰。
   * 高 impact（>= exemptImpact）豁免；一次最多丢三成；最近 keepRecent 条无论如何留着。
   * 返回 { dropped: [id], kept: n }
   */
  function forget({ toTick } = {}) {
    decayTo(toTick);
    // 明写 expires 的按期限过期（明确指令，不受豁免）；「冷掉」的才受高 impact 豁免
    const hardExpired = (e) => e.expires != null && now > Number(e.expires);
    const cold = (e) => e.activation <= 0 && e.impact < Number(cfg.exemptImpact);
    const forgettable = (e) => hardExpired(e) || cold(e);
    const dropped = [];
    const recent = entries.slice().sort((a, b) => (b.tick - a.tick) || (a.id < b.id ? -1 : 1)).slice(0, Number(cfg.keepRecent));
    const keepSet = new Set(recent.map((e) => e.id));
    let budget = Math.max(0, Math.ceil(entries.length * Number(cfg.forgetRatio)));
    const byWeakest = entries.slice().sort((a, b) => (a.activation - b.activation) || (a.impact - b.impact) || (a.id < b.id ? -1 : 1));
    for (const e of byWeakest) {
      if (budget <= 0) break;
      if (keepSet.has(e.id)) continue;
      if (e.impact >= Number(cfg.exemptImpact) && !hardExpired(e)) continue;
      const over = entries.length - dropped.length > Number(cfg.capacity);
      if (!forgettable(e) && !over) continue;
      dropped.push(e.id);
      budget -= 1;
    }
    if (dropped.length) {
      const gone = new Set(dropped);
      entries = entries.filter((e) => !gone.has(e.id));
      reindex();
    }
    return { dropped, kept: entries.length };
  }

  /** 只推进时序：activation 变淡、lastAccess 节流；不巩固、不遗忘 */
  function tick({ toTick } = {}) { return decayTo(toTick); }

  function save() {
    return copy({ v: 1, nextId, now, pending, entries, cfg: { capacity: cfg.capacity, decay: cfg.decay, consolidateAt: cfg.consolidateAt, bucketSize: cfg.bucketSize, overFetch: cfg.overFetch } });
  }

  const api = {
    remember, recall, consolidate, forget, tick, save, restore,
    get, has, all, size, sigOf, impactOf,
    state: () => ({ now, pending, size: entries.length }),
  };
  restore(opts.saved);
  return api;
}

export default createMemoryStore;
