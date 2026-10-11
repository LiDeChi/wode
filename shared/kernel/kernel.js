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
import { DEFAULT_TIER, ELIDED_NOTE, briefText, depthDebug, depthLine, downgrade, normalizeTier, oneLine, watchDepth, TIER_COST } from './depth.js';

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
export function createKernel(session, { scenes = {}, controllers = {}, store, days = DEFAULT_DAYS, tiers, tierOf, budget } = {}) {
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

  // ---- 档位：导师手里的算力分到这一场，这一场的人就演得多细（docs/KERNEL.md §6）----
  // 没传档位（tiers 与 tierOf 都没给）时一律「普通」，而且连状态都不碰——旧行为一笔不变。
  //   tiers: {'night':'细演'} 或 {'night':3}；也可以按 beat 或按作品给
  //   tierOf: (sceneId, scene) => 档位
  //   tiers: 'mentor' 读 session 里导师的分配结果（mentor.allot 的 chosen，按 beat 记）
  const tierSource = tierOf || tiers || null;
  const mentorChosen = () => { try { return session.mentor?.state?.().chosen || null; } catch { return null; } };

  /** 这一场演到哪一档：解析一次就记在 root.tierPlan 里（随存档走，重进不重算） */
  function sceneTier(sceneId) {
    if (!tierSource || !sceneId || !scenes[sceneId]) return DEFAULT_TIER;
    const plan = root.tierPlan || (root.tierPlan = {});
    if (plan[sceneId]) return plan[sceneId];
    const scene = sceneOf(sceneId);
    let want = DEFAULT_TIER;
    if (typeof tierSource === 'function') want = normalizeTier(tierSource(sceneId, scene)) || DEFAULT_TIER;
    else if (tierSource === 'mentor') {
      const chosen = mentorChosen() || {};
      want = normalizeTier(chosen[scene.beat] ?? chosen[sceneId]) || DEFAULT_TIER;
    } else if (typeof tierSource === 'object') {
      want = normalizeTier(tierSource[sceneId] ?? tierSource[scene.beat] ?? tierSource[scene.work]) || DEFAULT_TIER;
    }
    let tier = want;
    if (budget != null) {
      // 算力用完就往下降，降到底也照常演完——不抛错、不中断
      while (tier !== '一笔带过' && (root.tierSpend || 0) + (TIER_COST[tier] ?? 1) > budget) tier = downgrade(tier);
      root.tierSpend = round((root.tierSpend || 0) + (TIER_COST[tier] ?? 1));
    }
    plan[sceneId] = tier;
    return tier;
  }

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

  // 本内核实例已经为哪几场做过「开场那一遍」（init+enter，或者恢复存档时的 restore）。
  const started = new Set();

  /**
   * 建控制器实例、init 状态；第二次 enter 同一场不再重来（watched/asked/last 留着）。
   * 恢复存档时（world.entered 已经是 true，而本实例还没碰过这一场）不重跑 init——那会把存档里的
   * 控制器状态盖掉——只调一次 ctrl.restore(ctx)，给控制器补装「不进存档的东西」（如把演员装进
   * 人物心智）。restore 必须幂等；没写 restore 的控制器行为一字不变（docs/KERNEL.md §3）。
   */
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
      started.add(sceneId);
    } else if (!started.has(sceneId)) {
      started.add(sceneId);
      const ctx = ctxOf(sceneId, world);
      for (const { ctrl } of list) ctrl.restore?.(ctx);    // 恢复存档：补装一次（幂等）
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
      act: (intent, extra) => actRecord(sceneId, ctx, intent, extra),      move: (person, to) => moveTo(sceneId, world, person, to),
      attention: (person, mode) => callCtrl(sceneId, 'attention', 'set', person, mode, world),
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
    // 场景可以声明 gate:false：这一场不受导演授权约束（围城粮仓——旧 view() 对粮仓选项一律
    // allowed:true，granaryChoose 也从不查闸门）。只有粮仓这么写。
    if (sceneOf(sceneId).gate === false) return true;
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
    else if (intent.verb === 'watch' && who) {
      const w = watch(sceneId, who);
      res = { text: w.preview?.explain ?? null, readOnly: true, depth: w.depth ?? null, debug: w.debug ?? null };
    }
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
    // ---- 档位只改文字厚薄与能看多深，不改胜负：结局、天数、旗标、账本一个字节都不动 ----
    const tier = sceneTier(sceneId);
    if (tier === '细演') {
      const line = partial.depth || (outcome.r
        ? depthLine({ name: outcome.r.name, mind: minds[outcome.r.person], perception: outcome.r.perception, heard: outcome.r.heard, trust: trustOf(outcome.r.person) })
        : null);
      if (line) {
        outcome.depth = line;
        outcome.text = outcome.text ? `${outcome.text} ${line}` : line;
      }
      // 那句话背后的读数只放在 debug 里（?dev=1 与科研台），不进玩家看到的文字
      if (outcome.r) outcome.debug = { depth: depthDebug({ name: outcome.r.name, mind: minds[outcome.r.person], perception: outcome.r.perception, heard: outcome.r.heard, trust: trustOf(outcome.r.person) }) };
    } else if (tier === '一笔带过') {
      // 一笔带过：旁白只留一两句，括号里的机制说明（打动多少、门槛多少）先不说
      if (outcome.text) {
        const cut = briefText(oneLine(outcome.text));
        if (cut.text !== outcome.text) outcome.text = `${cut.text}（${ELIDED_NOTE}）`;
      }
      outcome.elided = true;
      outcome.elidedNote = ELIDED_NOTE;
    }
    return outcome;
  }

  function resolveTo(world, to) { return to === '@focus' ? world.focus : to; }

  function normalizeResult(res) {
    if (!res) return { r: null };
    if (res.reactSeq !== undefined || res.perception !== undefined) return { r: res };   // 裸 Reaction
    return { r: res.r ?? null, text: res.text, cost: res.cost, claims: res.claims, choice: res.choice, refused: res.refused, end: res.end, work: res.work, depth: res.depth };
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
    const tier = has ? sceneTier(sceneId) : DEFAULT_TIER;
    if (world && !world.watched.includes(personId)) world.watched.push(personId);
    const last = world?.last ?? null;
    const mine = last && last.person === personId ? last : null;
    let preview = null;
    let look = null;
    if (has && (!mine || tier === '细演')) {
      // 细演时即便刚对他做过事，也再感知一次「他现在怎么看你」——只为拿到真实拉扯，
      // 感知会写记忆，所以照旧撤回这一笔（看心思不该改人）
      const ch = sceneOf(sceneId).ambient?.channels || { 人: 0.4 };
      look = mind.perceive({ kind: 'look', signature: `look:${sceneId}:${personId}`, channels: ch });
      delete mind.state.memory[`look:${sceneId}:${personId}`];
      mind.state.log.pop();
      if (!mine) preview = { trace: look.trace, stoppedAt: look.stoppedAt, action: look.action.act, explain: explainPerception(look, mind.name) };
    }
    const out = {
      person: personId, name: mind.name, title: mind.def.title, bio: mind.def.bio,
      temperament: mind.temperament, values: mind.def.values, resist: mind.def.resist,
      trust: trustOf(personId), stress: round(mind.state.stress),
      wants: (mind.def.goals || [])[0] || null,
      units: mind.units.map((u) => ({ id: u.id, label: u.label, cap: u.cap, reads: u.reads, act: u.act })),
      modules: mind.modules.map((m) => ({ id: m.id, label: m.label, cap: m.cap })),
      last: mine, preview,
    };
    if (tier === '细演') {
      const w = watchDepth({ name: mind.name, mind, perception: look, trust: trustOf(personId) });
      if (w.line) out.depth = w.line;          // 玩家看的是人话
      out.debug = { watch: w.debug };          // 数字给 ?dev=1 与科研台
    } else if (tier === '一笔带过') { out.elided = true; out.elidedNote = ELIDED_NOTE; }
    return out;
  }

  function ask(sceneId, personId) {
    const has = !!scenes[sceneId];
    const world = has ? enter(sceneId) : null;
    if (world && !world.asked.includes(personId)) world.asked.push(personId);
    const last = world?.last ?? null;
    const n = name(personId);
    let answer;
    // 玩家看到的只有人话：读数（打动多少、门槛多少）不往眼前放，放在下面的 debug 里
    if (!last || last.person !== personId) answer = `${n}看了你一眼，没说什么。（你还没对${n}做过什么）`;
    else if (last.accepted === true) answer = `${n}：「你的话说到我心里去了。」${last.reason ? `（${last.reason}）` : ''}`;
    else if (last.accepted === false) answer = `${n}：「你不懂我在想什么。」${last.reason ? `（${last.reason}）` : ''}`;
    else answer = `${n}：「我本来就要这么做。」${last.explain ? `（${last.explain}）` : ''}`;
    const tier = has ? sceneTier(sceneId) : DEFAULT_TIER;
    let extra = null;
    if (tier === '细演') {
      // 答得更细：把现在真实的心思接在回答后面（他自己的目标、信任、压力）
      const line = depthLine({ name: n, mind: minds[personId], perception: null, heard: null, trust: trustOf(personId) });
      const goal = (minds[personId]?.def?.goals || [])[0];
      extra = [goal ? `他要的是「${goal}」` : null, line].filter(Boolean).join('；');
      if (extra) answer = `${answer} ${extra}`;
    } else if (tier === '一笔带过') answer = oneLine(answer);
    const seq = ledger.append({ kind: 'user.ask', from: 'user', to: `actor:${personId}`, cause: last ? [last.reactSeq] : [], payload: { act: scenes[sceneId] ? sceneId : null, person: personId, answer } }).seq;
    // 数字只走这里：?dev=1 与科研台读它，玩家看到的是上面那句人话
    const debug = {
      accepted: last?.accepted ?? null,
      moved: last?.moved ?? null,
      bar: last?.bar ?? null,
      stoppedAt: last?.stoppedAt ?? null,
      action: last?.action ?? null,
      reason: last?.reason ?? null,
      goal: (minds[personId]?.def?.goals || [])[0] ?? null,
      trust: trustOf(personId),
      stress: round(minds[personId]?.state?.stress ?? 0),
      depth: depthDebug({ name: n, mind: minds[personId], perception: null, heard: null, trust: trustOf(personId) }),
    };
    return { person: personId, answer, seq, extra, debug };
  }

  /** 页面按控制器顺序找小部件（docs/KERNEL.md §5） */
  function views(sceneId) {
    const world = enter(sceneId);
    const ctx = ctxOf(sceneId, world);
    return instancesOf(sceneId).map(({ id, ctrl }) => ({ id, view: ctrl.view ? ctrl.view(ctx) : null }));
  }

  return {
    grants, allowed, enter, intents, dispatch, react, watch, ask, views,
    /** 只在账本上记一笔玩家动作，不产生反应（取符之夜里走一格就靠它） */
    act: (sceneId, intent, extra) => actRecord(sceneId, null, intent, extra),
    perceive: (sceneId, personId, event, extra) => perceive(sceneId, worldOf(sceneId), null, personId, event, extra),
    /** 控制器实例：需要调它的方法（不只是读它的状态）时用 */
    ctrlOf: (sceneId, id) => instancesOf(sceneId).find((i) => i.id === id)?.ctrl ?? null,
    world: (sceneId) => worldOf(sceneId),
    days: () => root.days,
    flags: () => root.flags,
    /** 这一场演到哪一档（细演 / 普通 / 一笔带过）；没传档位时永远是「普通」 */
    tierOf: (sceneId) => sceneTier(sceneId),
    /** 已经定下来的档位表与花掉的算力（随存档走） */
    tierPlan: () => ({ ...(root.tierPlan || {}) }),
    tierSpend: () => root.tierSpend || 0,
    root: () => root,
  };
}
