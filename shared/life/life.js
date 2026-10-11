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
import { createMemoryStore, sigOf } from '../core/memory.js';
import { createLifeView } from './view.js';

const round = (v) => Math.round(v * 1000) / 1000;

export function createLife({ session, kernel, plan, seed = 'life', store, scenes = {}, input, view, memory: memoryOpts } = {}) {
  const state = store || {};
  const designs = plan?.policies || {};
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
  state.experiences ??= {};    // 去重标记：person|key|tick -> seq
  state.store ??= null;        // 记忆存储的存档形状
  state.paused ??= false;
  state.ended ??= false;
  state.pause ??= { sinceTick: 0, recorded: null };
  const mem = createMemoryStore({ ...(memoryOpts || {}), saved: state.store });
  const lifeView = view || createLifeView({ session, kernel, life: { state: () => state, recall, perception } });

  const rngFor = (tick, actorId, eventId) => makeRng(`${state.seed}/${state.episodeId}/${state.sceneId}/${tick}/${actorId ?? '-'}/${eventId}`);

  function policyOf(sceneId) {
    const p = state.policies[sceneId] || designs[sceneId];
    return p || null;
  }

  function enter(sceneId, policy) {
    state.sceneId = sceneId;
    if (policy) state.policies[sceneId] = policy;
    return state.sceneId;
  }

  function recall(query = {}) { return mem.recall(query); }
  function perception(seq) { return state.perceptions[seq] || null; }

  /** 收一段真经历：只有真感知过的东西才收；同一件事同一拍只收一次 */
  function remember(rec) {
    const key = rec.key ?? rec.signature ?? 'event';
    const dedup = `${rec.person ?? '-'}|${key}|${rec.tick ?? state.tick}`;
    if (state.experiences[dedup] != null) return { id: state.experiences[dedup], stored: false };
    // 签名由 store 的规则算（含「谁 / 哪一场 / 账本位置」）：同一件事同一个人才算同一段记忆
    const sig = rec.sig ?? sigOf({ kind: rec.kind ?? 'event', actorId: rec.person, sceneId: rec.scene, seq: rec.seq, tick: rec.tick ?? state.tick, keywords: rec.keywords });
    const already = mem.has(sig);
    const id = mem.remember({ ...rec, sig, tick: rec.tick ?? state.tick, episode: state.episodeId });
    state.experiences[dedup] = id;
    return { id, stored: !already };
  }

  function dispatch(sceneId, event, out) {
    const policy = policyOf(sceneId);
    const res = kernel.dispatchEvent(sceneId, { ...event, policy, policySeq: policy?.sourceSeq ?? null });
    if (!res || res.silent) return res;
    if (res.reactionSeqs?.length) {
      for (const seq of res.reactionSeqs) out.reactions.push({ seq, scene: sceneId, tick: state.tick, person: res.person ?? event.from ?? null });
      // 感知那一刻就把真实片段留下来（不用现在的记忆倒算）
      for (const seq of res.reactionSeqs) state.perceptions[seq] = { ...(res.fragment || {}), seq, tick: state.tick, scene: sceneId, person: res.person ?? event.from ?? null };
      const sig = res.fragment?.signature;
      if (sig) remember({ key: sig, person: res.person ?? event.from ?? null, scene: sceneId, seq: res.reactionSeqs[0], kind: 'perception', note: res.fragment?.reasonId ?? null, trace: res.fragment?.trace ?? 0 });
    }
    if (res.actSeq) {
      state.queue.push({ id: `act:${sceneId}:${res.person}:${state.tick}`, tick: state.tick + 1, origin: 'actor', from: res.person, kind: 'act', channels: event.channels || {}, cause: [res.actSeq] });
      out.outcomes.push({ tick: state.tick, kind: 'actor.act', person: res.person, seq: res.actSeq, text: res.text ?? null, choice: res.choice ?? null });
    }
    if (res.text || res.choice) out.outcomes.push({ tick: state.tick, kind: event.origin, from: event.from, seq: res.seq ?? null, text: res.text ?? null, choice: res.choice ?? null, end: res.end ?? null });
    if (res.end) state.ended = true;
    return res;
  }

  function runTick(tick, out) {
    const sceneId = state.sceneId;
    if (!sceneId) return;
    const policy = policyOf(sceneId);
    const cadence = Math.max(1, Number(policy?.cadenceTicks ?? 2));
    const env = policy?.environment || {};
    const envCadence = Math.max(1, Number(env.cadenceTicks ?? 8));
    const people = policy?.autonomy?.people || [];
    const verbs = policy?.autonomy?.verbs || ['think'];

    // 环境：这一拍该不该落一次 pulse（内核只在世界真的变了才落）
    if (tick % envCadence === 0) {
      dispatch(sceneId, { id: `env:${sceneId}:${tick}`, tick, origin: 'environment', from: 'world', kind: env.kind ?? 'idle', channels: env.channels || {} }, out);
    }
    // 演员：按场景声明顺序，每 cadence 拍看一眼
    if (tick % cadence === 0) {
      for (const actor of people) {
        if (state.ended) break;
        dispatch(sceneId, {
          id: `actor:${sceneId}:${actor}:${tick}`, tick, origin: 'actor', from: actor, kind: 'think',
          channels: env.channels || {}, verbs, rng: rngFor(tick, actor, `check:${tick}`),
        }, out);
      }
    }
    // 排队的演员动作：到拍就跑，一旦结束就不再执行
    const due = state.queue.filter((q) => q.tick <= tick);
    state.queue = state.queue.filter((q) => q.tick > tick);
    for (const q of due) {
      if (state.ended) break;
      dispatch(sceneId, { ...q, rng: rngFor(tick, q.from, q.id) }, out);
    }
    // 逻辑时间往前走：记忆只会变淡，不会自己长出来
    // 逻辑时间往前走：记忆只会变淡，不会自己长出来；巩固与遗忘按计数器到位才发生
    mem.tick({ toTick: tick });
    mem.consolidate({ toTick: tick });
    mem.forget({ toTick: tick });
    for (const actor of people) session?.minds?.[actor]?.tick?.(1);
  }

  function advance({ toTick, inputs = [], paused } = {}) {
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
    if (state.ended || state.paused) return finish(out);
    while (state.tick < target && !state.ended) {
      state.tick += 1;
      const t = state.tick;
      // 同一拍：先玩家输入
      const due = state.pendingInputs.filter((x) => x.tick <= t);
      state.pendingInputs = state.pendingInputs.filter((x) => x.tick > t);
      for (const inp of due) {
        state.processed[inp.id] = { tick: t, op: inp.op };
        state.pause.sinceTick = t;
        const res = typeof input === 'function' ? input({ ...inp, tick: t }) : null;
        out.processed.push({ id: inp.id, tick: t, op: inp.op, outcome: res || null });
        if (res?.end) state.ended = true;
      }
      // 再环境与演员
      runTick(t, out);
      observePause(t);
    }
    return finish(out);
  }

  /** 场中停留八秒记一次：持续停留不重复写，暂停时 advance 根本不走 */
  function observePause(tick) {
    const mentor = session?.mentor;
    if (!mentor?.observe || state.pause.sinceTick == null) return;
    if (tick - state.pause.sinceTick < 8) return;
    if (state.pause.recorded === state.pause.sinceTick) return;
    state.pause.recorded = state.pause.sinceTick;
    mentor.observe({ kind: 'pause', tick, scene: state.sceneId, sinceTick: state.pause.sinceTick, cause: [] });
  }

  function finish(out) {
    state.store = mem.save();
    return {
      tick: state.tick,
      scene: state.sceneId,
      processed: out.processed,
      reactions: out.reactions,
      outcomes: out.outcomes,
      ended: state.ended,
      paused: state.paused,
      view: viewOf(),
    };
  }

  function viewOf() { return state.sceneId ? lifeView.read(state.sceneId) : null; }

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
    save: () => ({ ...state, store: mem.save() }),
    state: () => state,
    tick: () => state.tick,
    rngFor,
    cadence: () => policyOf(state.sceneId)?.cadenceTicks ?? 2,
    policy: policyOf,
    pause: () => { state.paused = true; },
    resume: () => { state.paused = false; state.pause.sinceTick = state.tick; },
  };
}
