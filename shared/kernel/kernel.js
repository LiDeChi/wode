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
import { firstRule, matchRule, fillText, readPath, readValue } from './rules.js';
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
export function createKernel(session, { scenes = {}, controllers = {}, store, days = DEFAULT_DAYS, tiers, tierOf, budget, perceptions } = {}) {
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
  /** 只看一眼，不创建：读镜（shared/life/view.js）用它保证「纯读」 */
  const peekWorld = (sceneId) => root.worlds[sceneId] || null;

  // ---- 生活循环（docs/KERNEL.md §9）：真实感知当时留档、事件、世界脉搏 ----
  // 只在调用方显式传 perceptions（state.play.life.perceptions）时才记；旧路径一个字段都不多。
  function recordPerception(seq, rec) { if (perceptions && seq) {
    const episode = holder.life;
    const m = minds[rec.person]?.state.memory[rec.signature];
    perceptions[seq] = { ...rec, scene: ledger.entries[seq - 1]?.payload?.act ?? root.current, tick: episode?.tick ?? 0, first: m?.trace === 1, goalHit: (minds[rec.person]?.def.goals || []).includes(rec.action) };
  } }

  /** 稳定签名：用来判断「世界是不是真的变了」，决定要不要落一次 world.pulse */
  function sig(v) {
    if (v == null || typeof v !== 'object') return String(v);
    if (Array.isArray(v)) return `[${v.map(sig).join(',')}]`;
    return `{${Object.keys(v).sort().map((k) => `${k}:${sig(v[k])}`).join(',')}}`;
  }
  function pulseSignature(world, event) {
    return [
      `d${root.days}`,
      `f${sig(root.flags)}`,
      `c${sig(world.ctrl)}`,
      `n${Object.keys(world.noticed || {}).sort().join(',')}`,
      `p${sig(world.places || {})}`,
      // 只算「看得见的动作」（玩家做了事、演员真的动了）；内部反应序号不算——
      // 否则演员自己想过一次，下一次检查就把同一处境当成新脉搏，全体再感知一遍。
      `a${world.lastAct?.seq ?? 0}`,
      // 日程刻度（巡灯挪到哪、更鼓几巡）也是外部条件，八拍一巡各是一次真变化
      ...(event?.mark != null ? [`s${event.mark}`] : []),
    ].join('|');
  }

  /**
   * 导演给演员的独立授予（LIVING §3）：和玩家的 beat.grants 是两码事，内核分别检查。
   * 不在名单里的人、不在名单里的动词，都不能自己动。
   */
  function allowedAutonomy(policy, person, verb) {
    const a = policy?.autonomy;
    if (!a) return false;
    if (!(a.people || []).includes(person)) return false;
    return (a.verbs || []).includes(verb);
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
      // 生活循环的事件上下文（旧路径上这些永远是 null，规则里读不到也匹配不上）
      tick: () => ctx._tick ?? null,
      event: () => ctx._event ?? null,
      policy: () => ctx._policy ?? null,
      rng: () => ctx._rng ?? null,
      autonomy: (person, verb) => allowedAutonomy(ctx._policy, person, verb),
      _end: null, _verdict: null, _work: null, _intent: null, _lastSeq: null, _cause: null, bar: null,
      _event: null, _policy: null, _tick: null, _rng: null,
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
    // 感知那一刻的真实片段（只有开了生活的会话才留）：读镜以后用它，不用现在的记忆倒算
    recordPerception(reactSeq, {
      source: 'perception', person: personId, signature: `${sceneId}:${intent.id}`, object: intent.id,
      stoppedAt: perception.stoppedAt, layer: perception.stoppedAt, actionLayer: perception.action.layer, actionFrom: perception.action.from, verb: perception.action.verb, action: perception.action.act,
      reasonId: userSeq, cause: [userSeq], seq: reactSeq, trace: perception.trace,
      moved: heard?.moved ?? null, accepted, error: perception.error ?? null,
      reason: heard?.reason || explainPerception(perception, n),
    });
    remember(world, {
      person: personId, reactSeq, stoppedAt: perception.stoppedAt, action: perception.action.act,
      reason: heard?.reason || null, explain: explainPerception(perception, n),
      accepted, moved: heard?.moved ?? null, bar: heard ? round(bar ?? mind.def.threshold) : null,
    });
    // 把刚写的那条 user.act 记下来，规则里的效果要用它当 cause；
    // 同时也是「看得见的动作」：世界签名变了，演员下一拍才可能真看见（内部反应不算）。
    lastSeq = userSeq;
    if (perceptions) world.lastAct = { seq: userSeq, kind: 'user.act', person: 'player', action: intent.line ?? intent.id };
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
    recordPerception(reactSeq, {
      source: 'perception', person: personId, signature: event.signature, object: event.signature ?? event.kind ?? 'look',
      stoppedAt: perception.stoppedAt, layer: perception.stoppedAt, actionLayer: perception.action.layer, actionFrom: perception.action.from, verb: perception.action.verb, action: perception.action.act,
      reasonId: (event.cause || []).slice(-1)[0] ?? null, cause: (event.cause || []).slice(), seq: reactSeq,
      trace: perception.trace, reason, kind: event.kind || 'look',
      moved: null, error: perception.error ?? null,
    });
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
    if (perceptions) ctx.world.lastAct = { seq, kind: 'user.act', person: 'player', action: intent.id };
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
      // 生活循环的事件事实：只有事件路径上才有；旧路径这几个键根本不出现
      ...(ctx?._event ? {
        event: ctx._event, pulse: world.pulseSeq ?? null, tick: ctx._tick ?? null, policy: ctx._policy ?? null,
        // 实际落成的动作序号（没有成功动作就是 null）与被拒的原因：规则据此判断闸门要不要立
        actSeq: ctx._actSeq ?? null, acted: ctx._actSeq != null, refused: ctx._refused ?? null,
        verb: r?.perception?.action?.verb ?? null, unit: r?.perception?.action?.from ?? null, actionLayer: r?.perception?.action?.layer ?? null,
      } : {}),
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

  // ---- 生活循环的事件路径（docs/KERNEL.md §9）----
  /**
   * 一次外部事件：环境落一次脉搏（只在世界真的变了的时候），演员只有看见新脉搏才形成真感知，
   * 心智判到「手已经动了」且导演给了这个动词，才落 actor.act（from 是演员）。
   * 这条路上不写 user.act——不伪造玩家信号。事件照样过一遍这一场的规则表。
   */
  const isChannels = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'number');

  /**
   * 一个演员这一拍面对什么刺激。优先按人取，再退回事件通道、退回全场 ambient。
   * scene.life.stimulus[person] 允许三种写法（数据而已，内核只做挑选）：
   *   1) { when:{…规则匹配…}, channels:{…}, else:{…} }   按条件分两支
   *   2) { 恩:0.6, 惧:0.4 }                              直接就是通道
   *   3) { 高托付:{…}, 低托付:{…} } + scene.life.conditions:[{name,when}]   按声明挑一支
   */
  function stimulusFor(sceneId, world, ctx, policy, person) {
    const scene = sceneOf(sceneId);
    const raw = policy?.stimulus?.[person] ?? scene?.life?.stimulus?.[person] ?? null;
    if (!raw || typeof raw !== 'object') return null;
    if (raw.when !== undefined || raw.channels || raw.else) {
      const facts = buildFacts(sceneId, world, null, null, ctx);
      const hit = raw.when === undefined ? true : matchRule(raw.when, facts);
      const pick = hit ? (raw.channels ?? raw.then ?? null) : (raw.else ?? null);
      return isChannels(pick) ? pick : null;
    }
    if (isChannels(raw)) return raw;
    const facts = buildFacts(sceneId, world, null, null, ctx);
    for (const c of scene?.life?.conditions || []) {
      const branch = raw[c.name];
      if (branch == null) continue;
      if (matchRule(c.when ?? {}, facts)) return isChannels(branch) ? branch : (branch.channels ?? null);
    }
    return null;   // 认不出的分支名：退回事件通道 / 全场 ambient（不猜）
  }

  /**
   * 动作前的世界条件闸门：场景声明的 life.gate[person]（或 gate.default）是一个 when 匹配式，
   * 用与规则表同样的匹配器读同一份事实（位置、旗标、托付、谁看见了、动作次数…）。
   * 没声明就是不额外拦（与旧行为一致），授权与「每拍每人一次」由内核自己管。
   */
  const policyGate = (policy, scene) => policy?.gate ?? scene?.life?.gate;
  function gateOpen(sceneId, world, ctx, person, verb, r) {
    const scene = sceneOf(sceneId);
    const byPerson = policyGate(ctx._policy, scene)?.[person] ?? policyGate(ctx._policy, scene)?.default;
    if (Array.isArray(byPerson?.verbs) && !byPerson.verbs.includes(verb)) return false;
    const g = byPerson?.[verb] ?? byPerson;
    if (!g) return true;
    if (Array.isArray(g.verbs) && !g.verbs.includes(verb)) return false;
    const facts = buildFacts(sceneId, world, null, r, ctx);
    return Array.isArray(g.any) ? g.any.some((x) => matchRule(x.when ?? x, facts)) : matchRule(g.when ?? {}, facts);
  }

  function dispatchEvent(sceneId, event = {}) {
    const world = enter(sceneId);
    const ctx = ctxOf(sceneId, world);
    const policy = event.policy || null;
    const tick = event.tick ?? null;
    ctx._intent = null; ctx._end = null; lastSeq = null; ctx._verdict = null; ctx._work = null; ctx._cause = null; ctx.bar = null;
    ctx._event = { id: event.id ?? null, tick: event.sceneTick ?? tick, origin: event.origin ?? null, from: event.from ?? null, kind: event.kind ?? null, channels: event.channels ?? null };
    ctx._policy = policy; ctx._tick = event.sceneTick ?? tick; ctx._rng = event.rng || null;
    const base = { scene: sceneId, tick: event.sceneTick ?? tick, origin: event.origin ?? null, from: event.from ?? null, event: ctx._event };

    if (event.origin === 'environment') {
      const signature = pulseSignature(world, event);
      const changed = signature !== world.pulseSig;
      // 日程到期（event.force）也要跑规则：巡灯 / 期限这类外部条件不能因为「世界没变」被挡住
      if (!changed && !event.force) return { ...base, silent: true };   // 世界没变：不落脉搏，也不留经历
      let seq = null;
      if (changed) {
        world.pulseSig = signature;
        const cause = (event.cause || []).length ? event.cause : [openSeqOf(workOf(sceneId))].filter(Boolean);
        seq = ledger.append({
          kind: 'world.pulse', from: 'world', to: `presentation:${workOf(sceneId)}`, cause,
          payload: { scene: sceneId, kind: event.kind || 'idle', tick, signature },
        }).seq;
        world.pulseSeq = seq;
        ctx._lastSeq = seq;
      }
      ctx._lastSeq = seq ?? world.pulseSeq;
      ctx._cause = [ctx._lastSeq].filter(Boolean);
      const result = { ...base, seq, pulseSeq: seq ?? world.pulseSeq, forced: !changed && !!event.force, ...eventRules(sceneId, world, ctx, null) };
      world.pulseSig = pulseSignature(world, event);
      return result;
    }

    // 演员：一条脉搏只感知一次（没新刺激就不伪造经历）
    if (!minds[event.from]) return { ...base, silent: true };
    const seen = world.seenPulse || (world.seenPulse = {});
    const fromAct = event.actSeq != null;
    if (fromAct) {
      const seenActs = world.seenActs || (world.seenActs = {});
      const key = `${event.from}:${event.actSeq}`;
      if (seenActs[key]) return { ...base, silent: true };
      seenActs[key] = true;
    }
    const cause = fromAct ? [event.actSeq] : [world.pulseSeq ?? null].filter(Boolean);
    if (!fromAct) {
      const pulseSeq = world.pulseSeq ?? null;
      if (!pulseSeq || seen[event.from] === pulseSeq) return { ...base, silent: true };
      seen[event.from] = pulseSeq;
    }
    const r = perceive(sceneId, world, ctx, event.from, {
      kind: event.kind || 'think',
      signature: event.signature || `life:${sceneId}:${event.from}:${event.kind || 'think'}`,
      // 刺激按人取：每个人的通道不同（如姬看恩/惧，守卫看人），不是全场共用一份 ambient
      channels: stimulusFor(sceneId, world, ctx, policy, event.from) ?? event.channels,
      cause,
    });
    const verb = r.perception?.action?.verb ?? 'think';
    let actSeq = null;
    let refused = null;
    if (r.perception?.stoppedAt === 'unit') {
      // 动作前校验：独立授权 → 世界条件（场景声明的闸门）→ 这一拍这个人还没动过
      if (!allowedAutonomy(policy, event.from, verb)) refused = 'autonomy';
      else if (world.actedTick?.[event.from] === tick) refused = 'already';
      else if (!gateOpen(sceneId, world, ctx, event.from, verb, r)) refused = 'gate';
      else {
        // 他自己动了：from 是演员，cause 指向他自己的那次反应
        const spec = { person: event.from, verb, action: r.perception.action.act, tick, pulseSeq: world.pulseSeq ?? null, policySeq: policy?.sourceSeq ?? null };
        actSeq = ledger.append({ kind: 'actor.act', from: `actor:${event.from}`, to: 'world', cause: [r.reactSeq], payload: spec }).seq;
        world.lastAct = { seq: actSeq, ...spec };
        (world.actedTick || (world.actedTick = {}))[event.from] = tick;
        ctx._lastSeq = actSeq;
      }
    }
    // 规则能看见「动作到底有没有真的落成」：有 act 才有 actSeq，被拒记 refused
    ctx._actSeq = actSeq;
    ctx._refused = refused;
    const fragment = (perceptions && perceptions[r.reactSeq]) || null;
    // 后果挂真实执行的动作（不是他自己的反应序号）
    ctx._cause = actSeq != null ? [actSeq] : cause;
    const here = { ...base, person: event.from, reactionSeqs: [r.reactSeq], actSeq, actRefused: refused, verb, stoppedAt: r.perception?.stoppedAt ?? null, fragment, fragments: [{ person: event.from, seq: r.reactSeq, fragment }], ...eventRules(sceneId, world, ctx, r) };

    // 下一拍只把已获可见性授权的动作送给接收者；来源 seq 不丢，也不再送回自己。
    if (actSeq != null) here.receivers = receiversOf(sceneId, world, event, event.from, r, ctx);
    return here;
  }

  /**
   * 一件事能被谁看见 / 听见：点名叫他的、渠道点名叫他的、跟他同处一地的。
   * 位置未知不广播；接收者可由场景显式名单或结构条件声明。
   */
  function receiversOf(sceneId, world, event, from, r, ctx) {
    const scene = sceneOf(sceneId);
    const people = Array.isArray(scene?.people) ? scene.people : Object.keys(minds);
    const ch = event.channels || {};
    const placeOf = (id) => world.places?.[id] ?? world.ctrl?.space?.positions?.[id] ?? scene.life?.positions?.[id] ?? null;
    const at = event.at ?? placeOf(from) ?? scene?.place ?? null;
    const explicit = scene.life?.receivers?.[from];
    const facts = buildFacts(sceneId, world, null, r, ctx);
    return people.filter((id) => {
      if (id === from || !minds[id]) return false;
      if (event.to && (event.to === id || event.to === `actor:${id}`)) return true;
      if (Number(ch[id]) > 0 || Number(ch[name(id)]) > 0) return true;
      if (Array.isArray(explicit)) return explicit.some((x) => typeof x === 'string' ? x === id : x.person === id && matchRule(x.when ?? {}, facts));
      const place = placeOf(id);
      return place != null && at != null && place === at;
    });
  }

  /** 事件路径上的规则：同一套规则表与效果，facts 里多了 event/pulse/tick/policy */
  function eventRules(sceneId, world, ctx, r) {
    const factsBefore = buildFacts(sceneId, world, null, r, ctx);
    const rule = firstRule(sceneOf(sceneId).rules || [], factsBefore);
    if (r && ctx._refused && rule && !Object.hasOwn(rule.when || {}, 'refused')) return {};
    if (!rule) return {};
    const auto = (ctx._cause?.length ? ctx._cause : [r?.reactSeq ?? ctx._lastSeq]).filter(Boolean);
    const out = { claims: [] };
    for (const item of rule.then || []) {
      const { effect, cause } = specOf(item);
      const patch = applyEffect(ctx, effect, cause ?? auto);
      if (patch.claimId) out.claims.push(patch.claimId);
      if (patch.end !== undefined) out.end = patch.end;
      if (patch.work) { out.work = patch.work; ctx._work = patch.work; }
      if (patch.verdict) ctx._verdict = patch.verdict;
    }
    const facts = buildFacts(sceneId, world, null, r, ctx);
    if (rule.choice !== undefined) out.choice = rule.choice;
    const txt = pickText(rule.text, { id: null }, ctx);
    if (txt != null) out.text = fillText(txt, facts);
    if (rule.cost !== undefined) out.cost = fillText(String(rule.cost), facts);
    return out;
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
    /** 生活循环：一次外部事件（环境脉搏 / 演员自己看一眼） */
    dispatchEvent,
    /** 这一场的样子（读镜要按声明顺序念人名） */
    sceneOf,
    /** 只看一眼世界，不创建（读镜的纯读保证） */
    peekWorld,
    openSeqOf,
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
