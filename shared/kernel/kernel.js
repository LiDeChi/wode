// 交互内核（docs/KERNEL.md §4）。所有场景共用这一个五步循环：
//   玩家做一件事 → 变成一个事件 → 感知得到它的心智收到 → 心智自己算反应 → 反应改变世界
//
// 心智是唯一的裁判：反应只在 react / perceive 里算（mind.hear 与 mind.perceive）。
// 规则只读心智的输出，永远不能直接设定反应——否则“一种诉求说服所有人”会回来。
//
// 记账的字段名与顺序照搬旧的 shared/engine/play.js（账本 hash 对 JSON.stringify 的字段顺序敏感）：
// react.user.act / react.actor.react 逐字段照抄 reactOf；trust 照抄 setTrust；claim 照抄 claim()。
import { clamp, explainPerception } from '../core/mind.js';
import { PLAYER, HOLDER, DEFAULT_PRESENTATION } from './roles.js';
import { applyEffect, setTrust, specOf } from './effects.js';
import { firstRule, fillText, readPath, readValue } from './rules.js';

export { PLAYER, HOLDER };

/** 等 / 看 / 问 不用导演授予 */
export const ALWAYS = ['wait', 'watch', 'ask'];
/** 全场的默认起始天数（围城的时间刻度）；场景可在 createKernel 的 days 里改 */
export const DEFAULT_DAYS = 30;

const round = (v) => Math.round(v * 1000) / 1000;

/** 心智停在哪一层 → 你能先看到的前兆（照搬旧 play.js） */
const TELL = {
  mind: (n) => `${n}停住了，半天没出声`,
  module: (n) => `${n}皱了皱眉，看了旁人一眼`,
  unit: (n) => `${n}没等你说完，已经有了动作`,
  backlash: (n) => `${n}的脸色变了`,
};

const isPlain = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * 在一个 session 上建内核。
 * opts.store：内核状态放哪（默认 session.state.kernel）。play.js 薄外壳可传 session.state.play，
 *             这样 world 随 session.save() 一起走。
 */
export function createKernel(session, { scenes = {}, controllers = {}, store, days = DEFAULT_DAYS } = {}) {
  const { ledger, claims, minds } = session;
  const holder = store || session.state || (session.state = {});
  const root = holder.kernel || (holder.kernel = { days, flags: {}, worlds: {}, current: null });
  if (root.days == null) root.days = days;
  if (!root.flags) root.flags = {};
  if (!root.worlds) root.worlds = {};
  const cached = new Map();          // sceneId -> [{id, ctrl}]
  const instances = new Map();       // sceneId -> [{id, ctrl}]

  const sceneOf = (id) => { const s = scenes[id]; if (!s) throw new Error(`没有这一场：${id}`); return s; };
  const workOf = (id) => sceneOf(id).work || (id === 'granary' ? 'weicheng' : 'qiefu');
  const openSeqOf = (work) => ledger.last((e) => e.kind === 'present.open' && e.payload.presentation === work)?.seq;
  const name = (id) => minds[id]?.name || id;
  const trustOf = (id) => round(minds[id]?.state.trust[PLAYER] ?? 0.3);

  // ---- world：这一场共享的状态（控制器状态、最近一次反应、被谁看见了）----
  function linkWorld(w) {
    Object.defineProperty(w, 'days', { enumerable: true, configurable: true, get: () => root.days, set: (v) => { root.days = v; } });
    Object.defineProperty(w, 'flags', { enumerable: true, configurable: true, get: () => root.flags, set: (v) => { root.flags = v; } });
    Object.defineProperty(w, 'scene', { configurable: true, get: () => scenes[w.sceneId] });
    w.noticed ||= {};
    return w;
  }
  function worldOf(sceneId) {
    let w = root.worlds[sceneId];
    if (!w) { w = { sceneId, ctrl: {}, last: null, noticed: {}, watched: [], asked: [], entered: false }; root.worlds[sceneId] = w; }
    return linkWorld(w);
  }

  function instancesOf(sceneId) {
    if (instances.has(sceneId)) return instances.get(sceneId);
    const scene = sceneOf(sceneId);
    const list = (scene.controllers || []).map(([id, cfg]) => {
      const factory = controllers[id];
      if (typeof factory !== 'function') throw new Error(`没有这个控制器：${id}`);
      const ctrl = factory(cfg || {});
      return { id: ctrl.id || id, ctrl };
    });
    instances.set(sceneId, list);
    return list;
  }

  /** 建控制器实例、init 状态；第二次 enter 同一场不再重来（watched/asked/last 留着） */
  function enter(sceneId) {
    const world = worldOf(sceneId);
    root.current = sceneId;
    const list = instancesOf(sceneId);
    if (!world.entered) {
      world.entered = true;
      const ctx = ctxOf(sceneId, world);
      world.ctrl = {};
      for (const { id, ctrl } of list) world.ctrl[id] = ctrl.init ? (ctrl.init(ctx) || {}) : {};
      for (const { ctrl } of list) ctrl.enter?.(ctx);      // 入场感知：这一场开门时谁意识到了什么
    }
    return world;
  }

  // ---- ctx：控制器拿到的全部东西 ----
  function ctxOf(sceneId, world) {
    const scene = sceneOf(sceneId);
    const ctx = {
      session, ledger, claims, minds, scene, sceneId, world,
      holder: HOLDER, round, clamp, name, trustOf,
      work: workOf(sceneId),
      openSeq: openSeqOf(workOf(sceneId)),
      grants: () => grants(sceneId),
      ctrl: (id) => world.ctrl[id],
      facts: () => buildFacts(sceneId, world, ctx._intent, null, ctx),
      react: (person, opts) => { const r = react(sceneId, ctx._intent, person, opts); ctx._lastSeq = r.userSeq; return r; },
      perceive: (person, event, extra) => perceive(sceneId, world, ctx, person, event, extra),
      setTrust: (person, value, why, cause) => setTrust(ctx, person, value, why, cause),
      effect: (spec, cause) => applyEffect(ctx, spec, cause ?? [ctx._lastSeq ?? lastSeq].filter(Boolean)),
      act: (intent, extra) => actRecord(sceneId, ctx, intent, extra),
      move: (person, to) => moveTo(sceneId, world, person, to),
      attention: (person, mode) => callCtrl(sceneId, 'attention', 'set', person, mode),
      playWork: (workId, choice, opts) => session.playWork(workId, choice, opts),
      notice: (by, reason) => { if (!world.noticed[by]) world.noticed[by] = reason; },
      seen: () => { const k = Object.keys(world.noticed)[0]; return k ? world.noticed[k] : null; },
      _end: null, _verdict: null, _work: null, _intent: null, _lastSeq: null, bar: null,
    };
    Object.defineProperty(ctx, 'days', { get: () => root.days, set: (v) => { root.days = v; } });
    return ctx;
  }

  function callCtrl(sceneId, id, method, ...args) {
    const inst = instancesOf(sceneId).find((i) => i.id === id);
    return inst?.ctrl?.[method]?.(...args);
  }
  function moveTo(sceneId, world, person, to) {
    const got = callCtrl(sceneId, 'space', 'move', person, to, world);
    if (got === undefined) world.places = { ...(world.places || {}), [person]: to };
    return got;
  }

  // ---- 授予闸门 ----
  function grants(sceneId) {
    const work = workOf(sceneId);
    const beatId = sceneOf(sceneId).beat;
    const beat = session.state.designs?.[work]?.beats?.find((b) => b.id === beatId);
    return { verbs: beat?.grants || [], level: beat?.level ?? 0, why: beat?.why || '', language: beat?.language || '看不见' };
  }

  function allowed(sceneId, intent) {
    if (ALWAYS.includes(intent.verb)) return true;
    const g = grants(sceneId).verbs;
    return [intent.verb, ...(intent.needs || [])].every((v) => g.includes(v));
  }

  /** 意图清单：按控制器在场景里的顺序（可用 order 覆盖），wait 收尾 */
  function intents(sceneId) {
    const world = enter(sceneId);
    const ctx = ctxOf(sceneId, world);
    const list = [];
    instancesOf(sceneId).forEach((inst, ci) => {
      for (const [ii, it] of (inst.ctrl.intents?.(ctx) || []).entries()) {
        list.push({ ...it, owner: it.owner || inst.id, _order: it.order ?? ci * 1000 + ii });
      }
    });
    const wait = sceneOf(sceneId).wait;
    if (wait && !list.some((i) => i.id === wait.id)) {
      list.push({ ...wait, verb: wait.verb || 'wait', owner: null, _order: wait.order ?? Number.MAX_SAFE_INTEGER });
    }
    list.sort((a, b) => a._order - b._order);
    return list.map((it) => {
      const { _order, ...rest } = it;
      return { ...rest, allowed: allowed(sceneId, rest) && rest.usable !== false };
    });
  }

  // ---- 心智裁决 ----
  /** 一个人对玩家这件事的反应；payload 逐字段照搬旧 reactOf */
  function react(sceneId, intent, personId, { channels, appeal, bar } = {}) {
    const mind = minds[personId];
    if (!mind) throw new Error(`没有这个人：${personId}`);
    const scene = sceneOf(sceneId);
    const world = worldOf(sceneId);
    const openSeq = openSeqOf(workOf(sceneId));
    const userSeq = ledger.append({
      kind: 'user.act', from: 'user', to: `actor:${personId}`, cause: [openSeq].filter(Boolean),
      payload: { act: sceneId, option: intent.id, verb: intent.verb, line: intent.line, item: intent.item || null },
    }).seq;
    let heard = null;
    if (appeal) heard = mind.hear(appeal, PLAYER);
    const ch = channels || intent.channels || scene.ambient?.channels || { 人: 0.4 };
    const perception = mind.perceive({ kind: intent.verb, signature: `${sceneId}:${intent.id}`, channels: ch, reliability: heard ? clamp(0.5 + heard.trustBefore) : 1 });
    const accepted = heard ? heard.moved >= (bar ?? mind.def.threshold ?? 0.35) : null;
    const backlash = heard ? heard.backlash > 0.15 : false;
    const n = name(personId);
    const tell = backlash ? TELL.backlash(n) : TELL[perception.stoppedAt](n);
    const reactSeq = ledger.append({
      kind: 'actor.react', from: `actor:${personId}`, to: PLAYER, cause: [userSeq],
      payload: {
        act: sceneId, person: personId, option: intent.id, stoppedAt: perception.stoppedAt, action: perception.action.act,
        accepted, moved: heard?.moved ?? null, bar: heard ? (bar ?? mind.def.threshold) : null,
        backlash: heard?.backlash ?? 0, trust: heard ? [heard.trustBefore, heard.trustAfter] : null,
        reason: heard?.reason || explainPerception(perception, n),
      },
    }).seq;
    const r = { person: personId, name: n, tell, perception, heard, accepted, backlash, userSeq, reactSeq };
    remember(world, {
      person: personId, reactSeq, stoppedAt: perception.stoppedAt, action: perception.action.act,
      reason: heard?.reason || null, explain: explainPerception(perception, n),
      accepted, moved: heard?.moved ?? null, bar: heard ? round(bar ?? mind.def.threshold) : null,
    });
    // 把刚写的那条 user.act 记下来，规则里的效果要用它当 cause
    lastSeq = userSeq;
    return r;
  }

  let lastSeq = null;   // 本次 dispatch 里最近的 user.act（没有反应时效果拿它当 cause）

  /** 没有玩家动作的感知（例如取符之夜开门时如姬自己心里转几转）；只写 actor.react */
  function perceive(sceneId, world, ctx, personId, event = {}, extra = {}) {
    const mind = minds[personId];
    if (!mind) throw new Error(`没有这个人：${personId}`);
    const scene = sceneOf(sceneId);
    const ch = event.channels || scene.ambient?.channels || { 人: 0.4 };
    const perception = mind.perceive({ kind: event.kind || 'look', signature: event.signature, channels: ch, reliability: event.reliability });
    const n = name(personId);
    const fields = {};
    for (const [k, v] of Object.entries(extra || {})) fields[k] = valueFor(v, personId, perception, world);
    const reason = reasonFor(event.reason, personId, perception, n);
    const reactSeq = ledger.append({
      kind: 'actor.react', from: `actor:${personId}`, to: PLAYER,
      cause: (event.cause || [openSeqOf(workOf(sceneId))]).filter(Boolean),
      payload: { act: sceneId, person: personId, stoppedAt: perception.stoppedAt, action: perception.action.act, ...fields, reason },
    }).seq;
    remember(world, { person: personId, reactSeq, stoppedAt: perception.stoppedAt, action: perception.action.act, explain: explainPerception(perception, n), reason });
    const r = { person: personId, name: n, perception, reactSeq, accepted: null, backlash: false, heard: null, tell: TELL[perception.stoppedAt](n) };
    if (ctx) ctx._perception = r;
    return r;
  }

  /** extra 里的值：{unit:'risk'} 看这次感知是不是那个单元的动作；其余交给 readValue */
  function valueFor(spec, personId, perception, world) {
    if (isPlain(spec) && 'unit' in spec) {
      const u = (minds[personId].def.units || []).find((x) => x.id === spec.unit);
      return !!u && perception.action.act === u.act;
    }
    return readValue(spec, { trust: trustMap(world), flag: world.flags, ctrl: world.ctrl });
  }

  /** event.reason 写成 { unit:'risk', then:'…', else:'…' } 时按单元命中选一句 */
  function reasonFor(spec, personId, perception, n) {
    if (typeof spec === 'string') return spec;
    if (isPlain(spec) && 'unit' in spec) {
      const u = (minds[personId].def.units || []).find((x) => x.id === spec.unit);
      return u && perception.action.act === u.act ? (spec.then || '') : (spec.else || '');
    }
    return explainPerception(perception, n);
  }

  function remember(world, last) { world.last = last; }

  /** 记一次玩家的动作，不产生反应；payload = { act, option, ...extra }（旧取符之夜的位置就靠它） */
  function actRecord(sceneId, ctx, intent, extra = {}) {
    const work = workOf(sceneId);
    const seq = ledger.append({
      kind: 'user.act', from: 'user', to: `presentation:${work}`,
      cause: [openSeqOf(work)].filter(Boolean),
      payload: { act: sceneId, option: intent.id, ...extra },
    }).seq;
    lastSeq = seq;
    return seq;
  }

  // ---- 事实 ----
  function trustMap(world) {
    const out = {};
    for (const id of Object.keys(minds)) out[id] = trustOf(id);
    return out;
  }
  function buildFacts(sceneId, world, intent, r, ctx) {
    const trust = trustMap(world);
    const person = r?.person ?? intent?.to ?? null;
    const space = world.ctrl?.space;
    const by = Object.keys(world.noticed || {})[0] ?? null;
    return {
      scene: sceneId, work: workOf(sceneId), intent: intent?.id ?? null,
      person, name: person ? name(person) : null, voice: person ? (minds[person]?.def?.voice || '') : '',
      accepted: r?.accepted ?? null, backlash: r?.backlash ?? false,
      stoppedAt: r?.perception?.stoppedAt ?? null, action: r?.perception?.action?.act ?? null,
      moved: r?.heard?.moved ?? null, tell: r?.tell ?? null,
      flag: root.flags, flags: root.flags, ctrl: world.ctrl, world, days: root.days, trust,
      at: space?.at ?? null, place: space?.at ?? null, tile: space?.at ?? null,
      noticed: world.noticed, seen: !!by, seenBy: by, seenReason: by ? world.noticed[by] : null,
      verdict: ctx?._verdict ?? null, workOut: ctx?._work ?? null,
    };
  }

  // ---- 一次动作：before* → apply → tick* → 规则 → 效果 → 记账 ----
  function dispatch(sceneId, intentId) {
    const scene = sceneOf(sceneId);
    const world = enter(sceneId);
    const intent = intents(sceneId).find((i) => i.id === intentId);
    if (!intent) throw new Error(`没有这个选项：${intentId}`);
    if (intent.usable === false) return { r: null, text: intent.refusedText || '这件事已经做过了。', claims: [], refused: true };
    if (!allowed(sceneId, intent)) throw new Error(`导演这一幕没有授予「${intent.verb}」`);
    const ctx = ctxOf(sceneId, world);
    ctx._intent = intent; ctx._end = null; lastSeq = null; ctx._verdict = null; ctx._work = null; ctx.bar = null;
    const list = instancesOf(sceneId);
    for (const { ctrl } of list) ctrl.before?.(intent, ctx);
    let res = null;
    const owner = list.find((i) => i.id === intent.owner && i.ctrl.apply);
    const who = intent.to || intent.person;
    if (owner) res = owner.ctrl.apply(intent, ctx) || null;
    // 等/看/问 没人认领时走内核自己那三条路（看与问不改世界，只读）
    else if (intent.verb === 'watch' && who) res = { text: watch(sceneId, who).preview?.explain ?? null, readOnly: true };
    else if (intent.verb === 'ask' && who) res = { text: ask(sceneId, who).answer, readOnly: true };
    else if (intent.to) res = { r: react(sceneId, intent, resolveTo(world, intent.to), { channels: intent.channels, appeal: intent.appeal, bar: intent.bar ?? ctx.bar }) };
    const partial = normalizeResult(res);
    if (partial.refused) return { ...partial, refused: true };
    for (const { ctrl } of list) ctrl.tick?.(intent, ctx);
    const outcome = { r: partial.r ?? null, text: partial.text ?? ctx._endText ?? '', claims: [...(partial.claims || [])] };
    if (partial.cost != null) outcome.cost = partial.cost;
    if (partial.choice != null) outcome.choice = partial.choice;
    if (ctx._end != null) outcome.end = ctx._end;
    else if (partial.end != null) outcome.end = partial.end;
    const rule = firstRule(scene.rules || [], buildFacts(sceneId, world, intent, outcome.r, ctx));
    if (rule) {
      const auto = [outcome.r?.reactSeq ?? lastSeq].filter(Boolean);
      for (const item of rule.then || []) {
        const { effect, cause } = specOf(item);
        const patch = applyEffect(ctx, effect, cause ?? auto);
        if (patch.claimId) outcome.claims.push(patch.claimId);
        if (patch.end !== undefined) outcome.end = patch.end;
        if (patch.work) { outcome.work = patch.work; ctx._work = patch.work; }
        if (patch.verdict) ctx._verdict = patch.verdict;
      }
      if (rule.choice !== undefined) outcome.choice = rule.choice;
      const txt = pickText(rule.text, intent, ctx);
      if (txt != null) outcome.text = fillText(txt, buildFacts(sceneId, world, intent, outcome.r, ctx));
      if (rule.cost !== undefined) outcome.cost = fillText(String(rule.cost), buildFacts(sceneId, world, intent, outcome.r, ctx));
    }
    return outcome;
  }

  function resolveTo(world, to) { return to === '@focus' ? world.focus : to; }

  function normalizeResult(res) {
    if (!res) return { r: null };
    if (res.reactSeq !== undefined || res.perception !== undefined) return { r: res };   // 裸 Reaction
    return { r: res.r ?? null, text: res.text, cost: res.cost, claims: res.claims, choice: res.choice, refused: res.refused, end: res.end, work: res.work };
  }

  /** text 可以写成字符串、按意图 id 分档，或再按导演批没批分档 */
  function pickText(spec, intent, ctx) {
    if (spec == null) return null;
    if (typeof spec === 'string') return spec;
    let cur = spec[intent.id] ?? spec.default ?? spec['*'];
    const kind = ctx?._verdict?.kind;
    if (isPlain(cur)) cur = (kind && cur[kind]) ?? cur.default ?? null;
    return typeof cur === 'string' ? cur : null;
  }

  // ---- 心智入口 ----
  function watch(sceneId, personId) {
    const mind = minds[personId];
    if (!mind) throw new Error(`没有这个人：${personId}`);
    const has = !!scenes[sceneId];
    if (has) {
      const g = grants(sceneId);
      if (g.verbs.length && !g.verbs.includes('watch')) throw new Error('导演这一幕没有授予「看心思」');
    }
    const world = has ? enter(sceneId) : null;
    if (world && !world.watched.includes(personId)) world.watched.push(personId);
    const last = world?.last ?? null;
    const mine = last && last.person === personId ? last : null;
    let preview = null;
    if (!mine && has) {
      const ch = sceneOf(sceneId).ambient?.channels || { 人: 0.4 };
      const r = mind.perceive({ kind: 'look', signature: `look:${sceneId}:${personId}`, channels: ch });
      // perceive 会写记忆；看心思不该改人，所以撤回这一笔
      delete mind.state.memory[`look:${sceneId}:${personId}`];
      mind.state.log.pop();
      preview = { trace: r.trace, stoppedAt: r.stoppedAt, action: r.action.act, explain: explainPerception(r, mind.name) };
    }
    return {
      person: personId, name: mind.name, title: mind.def.title, bio: mind.def.bio,
      temperament: mind.temperament, values: mind.def.values, resist: mind.def.resist,
      trust: trustOf(personId), stress: round(mind.state.stress),
      wants: (mind.def.goals || [])[0] || null,
      units: mind.units.map((u) => ({ id: u.id, label: u.label, cap: u.cap, reads: u.reads, act: u.act })),
      modules: mind.modules.map((m) => ({ id: m.id, label: m.label, cap: m.cap })),
      last: mine, preview,
    };
  }

  function ask(sceneId, personId) {
    const has = !!scenes[sceneId];
    const world = has ? enter(sceneId) : null;
    if (world && !world.asked.includes(personId)) world.asked.push(personId);
    const last = world?.last ?? null;
    const n = name(personId);
    let answer;
    if (!last || last.person !== personId) answer = `${n}看了你一眼，没说什么。（你还没对${n}做过什么）`;
    else if (last.accepted === true) answer = `${n}：「你的话说到我心里去了。」（${last.reason}；打动 ${last.moved} ≥ 门槛 ${last.bar}）`;
    else if (last.accepted === false) answer = `${n}：「你不懂我在想什么。」（${last.reason}；打动 ${last.moved} < 门槛 ${last.bar}）`;
    else answer = `${n}：「我本来就要这么做。」（${last.explain}）`;
    const seq = ledger.append({ kind: 'user.ask', from: 'user', to: `actor:${personId}`, cause: last ? [last.reactSeq] : [], payload: { act: scenes[sceneId] ? sceneId : null, person: personId, answer } }).seq;
    return { person: personId, answer, seq };
  }

  /** 页面按控制器顺序找小部件（docs/KERNEL.md §5） */
  function views(sceneId) {
    const world = enter(sceneId);
    const ctx = ctxOf(sceneId, world);
    return instancesOf(sceneId).map(({ id, ctrl }) => ({ id, view: ctrl.view ? ctrl.view(ctx) : null }));
  }

  return {
    grants, allowed, enter, intents, dispatch, react, watch, ask, views,
    perceive: (sceneId, personId, event, extra) => perceive(sceneId, worldOf(sceneId), null, personId, event, extra),
    world: (sceneId) => worldOf(sceneId),
    days: () => root.days,
    flags: () => root.flags,
    root: () => root,
  };
}
