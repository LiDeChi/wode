// 生活循环：一秒一个整数逻辑拍（docs/design/LIVING.md §2、§9）。
//
// advance({toTick, inputs}) 把逻辑时间推到 toTick：
//   1. 同一拍先处理玩家输入（走 play 原来的路，行为一笔不变）
//   2. 再按场景声明顺序处理环境和演员：环境先落一次 world.pulse（只在世界真的变了才落），
//      演员每 cadenceTicks 拍看一眼有没有新 pulse——有新东西才形成真感知，没有就不伪造经历
//   3. 心智判到「手已经动了」且导演给了这个动词，才落 actor.act（from 是演员，不是玩家）
//
// 幂等：重复 toTick 不推进；同一个输入 id 只跑一次。
// 确定性：唯一随机入口是调用方传进来并保存的 seed，按
// seed/episodeId/sceneId/tick/actorId/eventId 派生子种子；不需要抽签就不消费随机。
// 暂停：paused 时 advance 一拍都不走（前台切走、后台都不算生活时间）。

import { makeRng } from '../core/rng.js';
import { createMemoryStore } from '../core/memory.js';
import { createLifeView } from './view.js';

const round = (v) => Math.round(v * 1000) / 1000;

export function createLife({ session, kernel, plan, seed = 'life', store, scenes = {}, input, sync, refresh, ended, view, memory: memoryOpts } = {}) {
  const state = store || {};
  const designs = () => plan?.policies || {};
  state.v ??= 1;
  state.seed ??= String(seed);
  state.episodeId ??= String(session?.state?.episode?.id ?? 'ep1');
  state.tick ??= 0;
  state.sceneId ??= null;
  state.policies ??= {};
  state.processed ??= {};      // 输入 id -> { tick, op }（重复 id 只跑一次）
  state.pendingInputs ??= [];  // 还没到拍的输入
  state.queue ??= [];          // 排队中的演员动作
  state.perceptions ??= {};    // 反应 seq -> 感知当时留下的真实片段
  state.experiences ??= {};    // 去重标记：真实反应 seq -> 记忆 id
  state.store ??= null;        // 记忆存储的存档形状
  state.paused ??= false;
  state.ended ??= false;
  state.endedOutcome ??= null;   // 演员自己把这幕做完时留下的结果
  state.pause ??= { sinceTick: 0, sceneId: null, recorded: {} };
  const mem = createMemoryStore({ ...(memoryOpts || {}), saved: state.store });
  // 读镜拿到的是「只读的这几件」：状态、召回、原始片段、记忆条目（投影用，不走 recall）
  const lifeView = view || createLifeView({ session, kernel, life: { state: () => state, recall, perception, memory: () => mem } });

  const rngFor = (tick, actorId, eventId) => makeRng(`${state.seed}/${state.episodeId}/${state.sceneId}/${tick}/${actorId ?? '-'}/${eventId}`);

  function policyOf(sceneId) {
    const p = state.policies[sceneId] || designs()[sceneId];
    return p || null;
  }

  function enter(sceneId, policy) {
    if (sceneId !== state.sceneId) {
      // 停留时长按「入场那一拍」算，不是全局绝对拍
      state.sceneId = sceneId;
      state.sceneTick = 0;
      state.ended = false;
      state.endedOutcome = null;
      state.queue = [];
      state.pause = { sinceTick: state.tick, sceneId, recorded: {} };
    }
    if (policy) state.policies[sceneId] = policy;
    return state.sceneId;
  }

  /**
   * 召回：query 给结构化条件（actorId / sceneId / keywords / tick / k）。
   * 每条补上「谁的哪一段」——person / key / activation 等索引字段（仍是派生量，不带账本原文）。
   */
  function recall(query = {}) {
    return mem.recall(query).map((m) => {
      const e = mem.get(m.id) || null;
      return {
        ...m,
        person: e?.actorId ?? null,
        key: (e?.keywords || []).join('、') || e?.sig || null,
        sig: e?.sig ?? null,
        keywords: (e?.keywords || []).slice(),
        activation: e?.activation ?? null,
        consolidation: e?.consolidation ?? null,
      };
    });
  }
  function perception(seq) { return state.perceptions[seq] || null; }

  /** 收一段真经历：只有真感知过的东西才收；同一件事同一拍只收一次 */
  function indexPerceptions() {
    for (const [seq, rec] of Object.entries(state.perceptions)) {
      const frag = rec || {};
      remember({ person: frag.person, scene: frag.scene, seq: Number(seq), tick: frag.tick ?? state.tick,
        key: frag.signature, signature: frag.signature, kind: 'perception', error: frag.error,
        goalHit: frag.goalHit === true, first: frag.first === true, moved: frag.moved,
        keywords: [frag.kind, frag.action, frag.stoppedAt].filter(Boolean), who: [frag.person].filter(Boolean) });
    }
  }

  function remember(rec) {
    const key = rec.key ?? rec.signature ?? 'event';
    const dedup = rec.seq != null ? `seq:${rec.seq}` : `${rec.person ?? '-'}|${key}|${rec.tick ?? state.tick}`;
    if (state.experiences[dedup] != null) return { id: state.experiences[dedup], stored: false };
    // 两把钥匙分开：
    //   sig  = 「同类心智槽」——同一类刺激（谁 / 哪一场 / 停在哪一层 / 什么动作）落在同一条记忆上，
    //          再遇到同类事只会更亮、trace 更长，不会每次开一条新的；
    //   seq  = 「事件唯一指针」——这一条记忆最后指向账本上的哪一次真实发生。
    const mental = rec.mental ?? `${rec.kind ?? 'event'}|${rec.person ?? '-'}|${rec.scene ?? '-'}|${rec.signature ?? key}`;
    const sig = rec.sig ?? mental;
    const already = mem.has(sig);
    const id = mem.remember({
      ...rec,
      sig,
      // 记忆条目用 actorId / sceneId 做检索键（与 memory.js 的字段名对齐）
      actorId: rec.person ?? rec.actorId ?? null,
      sceneId: rec.scene ?? rec.sceneId ?? null,
      seq: rec.seq ?? null,
      tick: rec.tick ?? state.tick,
      episode: state.episodeId,
      // 成长材料：重要度、检索字段都由真实感知算出来，不是摆设
      error: rec.error ?? null,
      goalHit: rec.goalHit ?? null,
      first: rec.first ?? null,
      moved: rec.moved ?? null,
      keywords: rec.keywords ?? [],
      who: rec.who ?? [rec.person].filter(Boolean),
    });
    state.experiences[dedup] = id;
    return { id, stored: !already };
  }

  function dispatch(sceneId, event, out) {
    const policy = policyOf(sceneId);
    const res = kernel.dispatchEvent(sceneId, { ...event, policy, policySeq: policy?.sourceSeq ?? null });
    if (!res || res.silent) return res;
    const frags = res.fragments?.length ? res.fragments : (res.reactionSeqs || []).map((seq) => ({ person: res.person ?? event.from ?? null, seq, fragment: res.fragment || null }));
    for (const f of frags) {
      const person = f.person ?? event.from ?? null;
      const frag = f.fragment || {};
      out.reactions.push({ seq: f.seq, scene: sceneId, tick: state.tick, person });
      // 感知那一刻就把真实片段留下来（不用现在的记忆倒算）
      state.perceptions[f.seq] = { ...frag, seq: f.seq, tick: state.tick, scene: sceneId, person };
    }
    indexPerceptions();
    for (const person of res.receivers || []) state.queue.push({ id: `act:${res.actSeq}:${person}`, tick: state.tick + 1, scene: sceneId, origin: 'actor', from: person, kind: 'act', actSeq: res.actSeq, cause: [res.actSeq] });
    if (res.actSeq) out.outcomes.push({ tick: state.tick, kind: 'actor.act', person: res.person, seq: res.actSeq, text: res.text ?? null, choice: res.choice ?? null });
    if (res.text || res.choice) out.outcomes.push({ tick: state.tick, kind: event.origin, from: event.from, seq: res.seq ?? null, text: res.text ?? null, choice: res.choice ?? null, end: res.end ?? null });
    if (res.end) {
      state.ended = true;
      state.endedOutcome = { scene: sceneId, tick: state.tick, from: event.origin === 'actor' ? event.from : 'world', seq: res.actSeq ?? res.seq ?? null, outcome: res.end, text: res.text ?? null, claims: res.claims ?? [], work: res.work ?? null, choice: res.choice ?? null };
      ended?.(state.endedOutcome);
    }
    return res;
  }

  function runTick(tick, out) {
    const sceneId = state.sceneId;
    if (!sceneId || state.ended) return;
    const policy = policyOf(sceneId);
    const cadence = Math.max(1, Number(policy?.cadenceTicks ?? 2));
    const env = policy?.environment || {};
    const envCadence = Math.max(1, Number(env.cadenceTicks ?? 8));
    const people = policy?.autonomy?.people || [];
    const verbs = policy?.autonomy?.verbs || ['think'];

    // 环境：日程到拍就跑规则（force）。日程刻度（巡灯挪到哪、更鼓几巡）本身算一次真变化，
    // 所以它不会被「世界没变」的去重挡住——这正是外部条件与演员手艺分账的地方。
    state.sceneTick = (state.sceneTick ?? 0) + 1;
    const localTick = state.sceneTick;
    const entry = Array.isArray(env.schedule) ? env.schedule.find((x) => Number(x?.at) === localTick) : null;
    if (scenes[sceneId]?.life && (entry || localTick === 1 || localTick % envCadence === 0)) {
      dispatch(sceneId, {
        id: `env:${sceneId}:${tick}`, tick, origin: 'environment', from: 'world',
        kind: env.kind ?? 'idle', channels: env.channels || {}, force: !!entry, sceneTick: localTick,
        mark: entry?.at ?? null, warn: entry?.warn ?? null,
      }, out);
    }
    // 演员：按场景声明顺序，每 cadence 拍看一眼
    if (localTick % cadence === 0) {
      for (const actor of people) {
        if (state.ended) break;
        // 已有真实动作正送给他，先收那件事；普通巡查不能抢先消费其后果。
        if (state.queue.some((q) => q.scene === sceneId && q.from === actor)) continue;
        dispatch(sceneId, {
          id: `actor:${sceneId}:${actor}:${tick}`, tick, origin: 'actor', from: actor, kind: 'think', sceneTick: localTick,
          channels: env.channels || {}, verbs, rng: rngFor(tick, actor, `check:${tick}`),
        }, out);
      }
    }
    // 排队的演员动作：到拍就跑，一旦结束就不再执行
    const due = state.queue.filter((q) => q.tick <= tick);
    state.queue = state.queue.filter((q) => q.tick > tick);
    for (const q of due) {
      if (state.ended) break;
      if (q.scene && q.scene !== sceneId) continue;
      dispatch(sceneId, { ...q, tick, sceneTick: localTick, rng: rngFor(tick, q.from, q.id) }, out);
    }
    // 逻辑时间往前走：记忆只会变淡，不会自己长出来；巩固与遗忘按计数器到位才发生
    mem.tick({ toTick: (state.memoryOffset ?? 0) + tick });
    mem.consolidate({ toTick: (state.memoryOffset ?? 0) + tick });
    mem.forget({ toTick: (state.memoryOffset ?? 0) + tick });
    for (const actor of people) session?.minds?.[actor]?.tick?.(1);
  }

  function advance({ toTick, inputs = [], paused } = {}) {
    const from = state.tick;
    if (paused === true) state.paused = true;
    if (paused === false) state.paused = false;
    // 经历跨局留、历史不串台：新一段只换这一段的编号，记忆本身接着用
    if (session?.state?.episode?.id) state.episodeId = session.state.episode.id;
    const out = { processed: [], reactions: [], outcomes: [] };
    const target = Math.max(state.tick, Math.floor(Number(toTick ?? state.tick)));
    // 输入先入队：同一拍先玩家输入，未到拍的下次再跑
    for (const raw of inputs) {
      const id = String(raw.id ?? `${raw.op}:${raw.tick ?? state.tick + 1}`);
      if (state.processed[id]) { out.processed.push({ id, tick: raw.tick ?? null, op: raw.op, repeated: true }); continue; }
      if (state.pendingInputs.some((x) => x.id === id)) continue;
      state.pendingInputs.push({ id, tick: Math.max(1, Math.floor(raw.tick ?? state.tick + 1)), op: raw.op, args: raw.args || {} });
    }
    if (state.paused) return finish(out, from, false);
    if (state.ended && !state.pendingInputs.some((x) => ['next', 'begin'].includes(x.op))) return finish(out, from);
    while (state.tick < target) {
      if (state.ended && !state.pendingInputs.some((x) => ['next', 'begin'].includes(x.op))) break;
      state.tick += 1;
      const t = state.tick;
      refresh?.();
      // 同一拍：先玩家输入
      const due = state.pendingInputs.filter((x) => x.tick <= t && (!state.ended || ['next', 'begin'].includes(x.op)));
      state.pendingInputs = state.pendingInputs.filter((x) => x.tick > t);
      for (const inp of due) {
        state.processed[inp.id] = { tick: t, op: inp.op };
        state.pause.sinceTick = t;
        const res = typeof input === 'function' ? input({ ...inp, tick: t }) : null;
        out.processed.push({ id: inp.id, tick: t, op: inp.op, outcome: res || null });
        if (res?.end || res?.view?.done || res?.stage === 'done' || res?.stage === 'coda') state.ended = true;
        // 每个输入之后立刻同步：换场了就按新场走，结束了就断掉剩下的输入与队列
        if (typeof sync === 'function') sync();
        if (state.ended) {
          state.pendingInputs = state.pendingInputs.filter((x) => ['next', 'begin'].includes(x.op));
          state.queue = [];
          break;
        }
      }
      // 再环境与演员
      indexPerceptions();
      if (!state.ended) runTick(t, out);
      if (!state.ended) observePause(t);
    }
    return finish(out, from);
  }

  /**
   * 场中停留八秒记一次：停留时长按「入场那一拍」算；每场每段停留只记一次；
   * 先落一条原始的 user.pause（可追溯），再让导师写一条轻墨（手改过的那页不覆盖）。
   */
  function observePause(tick) {
    const mentor = session?.mentor;
    const p = state.pause;
    if (!mentor?.observe || !p || p.sinceTick == null) return;
    const stayed = tick - p.sinceTick;
    if (stayed < 8) return;
    const key = `${p.sceneId ?? state.sceneId}:${p.sinceTick}`;
    p.recorded = p.recorded || {};
    if (p.recorded[key]) return;
    p.recorded[key] = tick;
    const raw = typeof session?.recordPause === 'function'
      ? session.recordPause({ scene: p.sceneId ?? state.sceneId, fromTick: p.sinceTick, toTick: tick, ticks: stayed })
      : null;
    mentor.observe({ kind: 'pause', tick, scene: p.sceneId ?? state.sceneId, fromTick: p.sinceTick, ticks: stayed }, (raw?.seqs || []));
  }

  function finish(out, from = state.tick, index = true) {
    if (index) indexPerceptions();
    state.store = mem.save();
    return {
      from,
      to: state.tick,
      tick: state.tick,
      scene: state.sceneId,
      processed: out.processed,
      reactions: out.reactions,
      outcomes: out.outcomes,
      events: out.outcomes,
      ended: state.ended,
      end: state.endedOutcome,
      paused: state.paused,
      view: viewOf(),
    };
  }

  /** 读镜：给场就读那一场；不给就读当前这一场（别把「看别场」看成当前场） */
  function viewOf(sceneId) { const id = sceneId ?? state.sceneId; return id ? lifeView.read(id) : null; }

  return {
    advance,
    enter,
    read: viewOf,
    view: lifeView,
    trace: (seq) => lifeView.trace(seq),
    recall,
    consolidate: (a) => mem.consolidate(a),
    forget: (a) => mem.forget(a),
    memory: () => mem,
    perception,
    remember,
    save: () => { indexPerceptions(); return { ...state, store: mem.save() }; },
    state: () => state,
    tick: () => state.tick,
    rngFor,
    cadence: () => policyOf(state.sceneId)?.cadenceTicks ?? 2,
    policy: policyOf,
    pause: () => { state.paused = true; },
    resume: () => { state.paused = false; state.pause.sinceTick = state.tick; },
  };
}
