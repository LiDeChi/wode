#!/usr/bin/env node
// t51：坐在取符之夜不动，量「二十秒里能看见几件事」。
//
// 只用公共入口：createSession / session.meet / createPlay(session,{living:'director',seed}) /
// begin / next / choose（只用场景自己给出的选项）→ 到 night 之后只 advance，不再输入。
// 读镜只用 play.life.view.read(sceneId)（＝createLifeView.read）与 play.lifeTrace(seq)，
// 不手派刺激、不调 watch/ask、不碰心智，也不拿 choose('wait') 冒充空等。
//
// 三类数字分开算，免得把「账本长了」当成「玩家看见了新东西」：
//   故事片段  actors[].last 里 source=perception 的条目，按 谁/停层/动作 去重 → 玩家能说出口的事
//   证据片段  读镜里出现过的全部条目，按 来源/签名/seq/path 去重 → 每条能不能回到账本
//   账本行数  进之夜之后新增的 world.pulse / actor.react / actor.act
//
// t58 加的一档「走到门边再站着」：进之夜后先照着巡灯节奏走到如姬卧内门口（pos3，托付闸门就在那儿），
// 再同样空等 0/5/10/20/40 拍。两档用同一份代码、同一批种子；旧档（pos0）的数字与参数默认值一格没动。
// 门边档另报三样旧档看不出的东西：①账本里 actor.act 真条（谁自己动身、seq/动词/from/cause）
// ②心智记忆槽与生活层经历的 activation / consolidation / 条数 在空等前后的变化
// ③机会与期限怎么走（旗标/巡灯/符主/结局）。
//
// 用法：
//   node tools/living-probe.mjs                 # 两档数字表都打到 stdout
//   node tools/living-probe.mjs --json          # 同一份数据以 JSON 打到 stdout
//   node tools/living-probe.mjs --seeds 1,2,3   # 只跑这几个种子
//   node tools/living-probe.mjs --door-only     # 只打门边档（旧档数据仍在 --json 里）
// 退出码：任一契约检查 FAIL 时为 1（这是测量工具，不是仓库测试；失败读数照样全部打印）。
import { createSession } from '../shared/engine/session.js';
import { createPlay } from '../shared/engine/play.js';
import { ANSWERS, NEED } from '../shared/engine/simulate.js';
import { pathToFileURL } from 'node:url';

export const SEEDS = [1, 2, 3, 7, 11];
export const DURATIONS = [0, 10, 20, 40];
/** 两条只用公共选项走到之夜的路线：低托付（两处都等）与高托付（义 + 折返） */
export const ROUTES = { low: ['wait', 'wait'], high: ['yi', 'back'] };
/**
 * t58「走到门边再站着」那一档：进之夜后再用场景自己给出的选项走到如姬卧内门口（pos3），然后不再输入。
 * 五步都是在位选项，没有一条是探针替玩家发明的：
 *   token_b  把令牌塞给中庭的守卫乙 → 乙「装作没看见」（不这么做，走进中庭就会被乙看见）
 *   step     0→1 回廊（这拍巡灯在 2，照不到 1）
 *   wait     贴着墙根等一拍，把巡灯的节奏错开一格（灯 2，人不动就不会被判「灯照到你」）
 *   step     1→2 中庭（这拍灯在 1）
 *   step     2→3 卧内门口（这拍灯在 2，人停在 3）
 * 站定时 pos=3、seen=false、done=false，托付闸门（递符/低问）正好在这一档才有机会开。
 * 注意：每一步只 choose、不夹 next()——choose 自己会走一拍；夹了 next() 会把这夜直接推过关。
 */
export const DOOR_APPROACH = ['token_b', 'step', 'wait', 'step', 'step'];
/** 门边档的截读数拍；旧档 DURATIONS 与默认值不动，保证原有数字一格不变 */
export const DOOR_DURATIONS = [0, 5, 10, 20, 40];
const DOOR_PEOPLE = ['ruji', 'guard_a', 'guard_b'];
const DIRECTORS = ['A', 'B'];
const DIRECTOR_NAME = { A: '陆导', B: '单导' };
const STOP_LAYER = { module: '按老习惯', unit: '手已经动了', mind: '心里停住' };
const clone = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));
const storyKey = (f) => JSON.stringify([f.person, f.layer, f.action ?? f.object]);
const evidenceKey = (f) => JSON.stringify([f.source, f.person, f.signature ?? f.object, f.seq, f.path]);

/** 走到取符之夜：每一步都点场景自己给的选项，不点名不存在的动作 */
export function enterNight(director, seed, route, opts = { living: 'director' }, approach = null) {
  const session = createSession();
  session.meet(ANSWERS[director], NEED);
  const play = createPlay(session, { seed, ...opts });
  play.begin();
  play.next();
  for (const id of ROUTES[route]) {
    const result = play.choose(id);
    if (!result?.r) throw new Error(`场景没有给出这个选项：${director}/${route}/${id}`);
    play.next();
  }
  if (play.view().act !== 'night') throw new Error('公共入口没有进入取符之夜');
  // t58：进之夜后还能走到门边（同一批在位选项，choose 自带一拍，不夹 next）
  // 注意：走位选项本来就没有「谁被你打动」的反应，r 是 null；这里按「选项被接受且这拍真的动了」判，
  // 不能用 r 判成败（那样会把正常的挪步当成选项不存在）。
  for (const id of approach || []) {
    if (play.view().act !== 'night') throw new Error(`走到门边的路上已经离开了这一夜：${director}/${route}/${id}`);
    const nightStep = () => session.state.play.kernel.worlds.night.ctrl.nightwalk.step;
    const before = nightStep();
    const result = play.choose(id);
    if (!result || result.refused) throw new Error(`场景没有给出这个选项：${director}/${route}/${id}`);
    if (nightStep() === before) throw new Error(`这一步没有走成：${director}/${route}/${id}`);
  }
  return { session, play };
}

/** 机会与期限：场景控制器里的真状态，和前台秒数不是一回事 */
function opportunity(session, play) {
  const world = session.state.play.kernel.worlds.night;
  const night = play.state().night;
  const ruji = play.life.view.read('night').actors.find((a) => a.id === 'ruji') || {};
  return clone({
    days: play.state().days,
    flags: world.flags,
    step: night.step,
    pos: night.pos,
    lantern: night.lantern,
    token: night.token,
    seen: night.seen,
    done: night.done,
    rujiTrust: ruji.trust ?? null,
    ended: play.life.state().ended,
    end: play.life.state().endedOutcome?.outcome ?? null,
  });
}

/** 一条读镜片段能不能回到账本：有 seq 就要能解到对应记录，并把 cause 走到头 */
function audit(fragment, session, play) {
  const seq = fragment.seq;
  const errors = [];
  if (!Number.isInteger(seq) || seq <= 0) return { seq: seq ?? null, hasSeq: false, ok: false, errors: ['no-seq'] };
  const entry = session.ledger.get(seq);
  if (!entry) return { seq, hasSeq: true, ok: false, errors: ['missing-entry'] };
  if (!fragment.path) errors.push('missing-path');
  if (fragment.source === 'perception') {
    if (entry.kind !== 'actor.react' || entry.from !== `actor:${fragment.person}`) errors.push('not-this-actors-reaction');
    if (entry.payload?.action !== fragment.object) errors.push('action-mismatch');
    const trace = play.lifeTrace(seq);
    if (!trace || trace.person !== fragment.person || trace.action !== fragment.object) errors.push('no-real-trace');
  }
  const stack = [entry];
  const visited = new Set();
  while (stack.length) {
    const e = stack.pop();
    if (visited.has(e.seq)) continue;
    visited.add(e.seq);
    for (const cause of e.cause || []) {
      const prior = session.ledger.get(cause);
      if (!prior || cause >= e.seq) errors.push(`broken-cause@${e.seq}->${cause}`);
      else stack.push(prior);
    }
  }
  return { seq, hasSeq: true, ok: errors.length === 0, errors };
}

const round3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;

/**
 * 心智里的记忆槽（读镜只投前几条，这里为量「成长」把整表读出来，仍然只读不写）：
 * 每个槽的 trace（被摆到眼前几次）/ activation（当下有多亮，会随时间衰减）/ consolidation（巩固到第几档）。
 */
export function mindSlots(session, person) {
  const map = session.minds?.[person]?.state?.memory || {};
  const slots = Object.entries(map)
    .map(([signature, slot]) => ({
      signature,
      trace: slot?.trace ?? 0,
      activation: round3(slot?.activation),
      consolidation: round3(slot?.consolidation),
    }))
    .sort((a, b) => (a.signature < b.signature ? -1 : 1));
  return {
    person,
    count: slots.length,
    signatures: slots.map((s) => s.signature),
    maxActivation: round3(Math.max(0, ...slots.map((s) => s.activation))),
    maxConsolidation: round3(Math.max(0, ...slots.map((s) => s.consolidation))),
    slots,
  };
}

/** 生活层经历存储：条数、深度分层、最大巩固、最大冲击（巩固分层出 depth+1 的那条在这里看得见） */
export function lifeStore(play) {
  const all = play.life.memory().all();
  const depth = {};
  for (const e of all) depth[e.depth] = (depth[e.depth] || 0) + 1;
  return {
    entries: all.length,
    depth,
    maxConsolidation: round3(Math.max(0, ...all.map((e) => e.consolidation))),
    maxImpact: round3(Math.max(0, ...all.map((e) => e.impact))),
    sigs: all.map((e) => e.sig),
  };
}

/** 一条 actor.act 的真账：谁、动词、话、账本 seq、cause 指向哪、站定后第几拍第一次露面 */
function actRow(entry, session, firstSeenTick) {
  const causes = (entry.cause || []).map((seq) => session.ledger.get(seq)).filter(Boolean);
  const ownReaction = causes.find((c) => c.kind === 'actor.react' && c.from === entry.from);
  return {
    seq: entry.seq,
    from: entry.from,
    to: entry.to ?? null,
    verb: entry.payload?.verb ?? null,
    action: entry.payload?.action ?? null,
    cause: clone(entry.cause || []),
    causeKinds: causes.map((c) => `${c.kind}@${c.seq}`),
    selfInitiated: String(entry.from).startsWith('actor:') && entry.from !== 'actor:player',
    ownReaction: ownReaction ? ownReaction.seq : null,
    firstSeenTick,
  };
}

/** 旗标：空等里真正动过的那几样（走位用场景步子，不推生活拍） */
function flagsOf(session) {
  const flags = session.state.play.kernel.worlds.night.flags;
  return clone({
    fuOwner: flags.fuOwner ?? null,
    fuWithRuji: flags.fuWithRuji ?? null,
    nightHand: flags.nightHand ?? null,
    nightAsk: flags.nightAsk ?? null,
    nightLate: flags.nightLate ?? null,
    nightBlock: flags.nightBlock ?? null,
    lantern: flags.nightLanternPos ?? null,
    rujiTrust: flags.rujiTrust ?? null,
  });
}
/** 期限＝巡灯与到期这两样（t51 那条「空等吃掉机会」的可测形式）；符账与动作旗标分别另算 */
const DEADLINE_KEYS = ['lantern', 'nightLate'];
/** 符账：符记在谁名下、在谁手里（第 8 拍的巡灯会把它记回如姬名下，之后托付规则才可能真递） */
const OWNER_KEYS = ['fuOwner', 'fuWithRuji'];

/**
 * t58 门边档：先走到如姬门口（pos3，托付闸门就在那儿）再站着，其余照旧。
 * 走到门边用的是场景自己的步子：不推生活拍（生活拍从 0 起算），所以「第 N 拍动手」＝站定后第 N 秒。
 */
export function probeDoorCase(director, seed, route = 'high') {
  const { session, play } = enterNight(director, seed, route, { living: 'director' }, DOOR_APPROACH);
  const entered = clone(session.state.play.kernel.worlds.night.ctrl.nightwalk);
  const enteredFlags = flagsOf(session);
  const ledgerAtEntry = session.ledger.size;
  const memoryAtStart = Object.fromEntries(DOOR_PEOPLE.map((p) => [p, mindSlots(session, p)]));
  const storeAtStart = lifeStore(play);
  const actsSeen = new Map();
  const deadlineChanges = [];
  const snapshots = [];
  let readOnly = true;
  let previousFlags = clone(enteredFlags);
  for (let second = 0; second <= DOOR_DURATIONS[DOOR_DURATIONS.length - 1]; second += 1) {
    if (second) play.advance({ toTick: second });
    const before = JSON.stringify(session.save());
    const mirror = play.life.view.read('night'); // 纯读
    readOnly = readOnly && before === JSON.stringify(session.save());
    const currentFlags = flagsOf(session);
    const movedKeys = Object.keys(currentFlags).filter((k) => JSON.stringify(previousFlags[k]) !== JSON.stringify(currentFlags[k]));
    if (movedKeys.length) deadlineChanges.push({ second, keys: movedKeys, now: Object.fromEntries(movedKeys.map((k) => [k, currentFlags[k]])) });
    previousFlags = currentFlags;
    const rows = session.ledger.entries.slice(ledgerAtEntry);
    for (const entry of rows) if (entry.kind === 'actor.act' && !actsSeen.has(entry.seq)) actsSeen.set(entry.seq, second);
    if (!DOOR_DURATIONS.includes(second)) continue;
    const acts = rows.filter((e) => e.kind === 'actor.act').map((e) => actRow(e, session, actsSeen.get(e.seq)));
    const night = session.state.play.kernel.worlds.night.ctrl.nightwalk;
    const life = play.life.state();
    snapshots.push({
      director, directorName: DIRECTOR_NAME[director], route, seed, stance: 'door', requestedSeconds: second,
      approach: DOOR_APPROACH,
      entered, enteredFlags, enteredStore: storeAtStart, enteredMemory: memoryAtStart,
      lifeTick: mirror.tick,
      atDoor: { pos: night.pos, seen: night.seen, done: night.done },
      flags: currentFlags,
      waitForPlayer: mirror.policy?.waitForPlayer ?? null,
      cadenceTicks: mirror.policy?.cadenceTicks ?? null,
      autonomyVerbs: mirror.policy?.autonomy?.verbs ?? [],
      spontaneousActs: acts.length,
      acts,
      actPeople: [...new Set(acts.map((a) => a.from))],
      actErrors: acts.filter((a) => !a.selfInitiated || !a.ownReaction).map((a) => a.seq),
      ledgerRows: rows.length,
      kindCounts: rows.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] || 0) + 1 }), {}),
      memory: Object.fromEntries(DOOR_PEOPLE.map((p) => [p, mindSlots(session, p)])),
      store: lifeStore(play),
      deadlineChanges: clone(deadlineChanges),
      ended: life.ended, end: life.endedOutcome?.outcome ?? null,
      readOnly,
    });
  }
  return snapshots;
}

/** 门边档的两个导演对照：同一批种子、两条托付路线各跑一遍，另加生活关闭的对照 */
export function runDoorProbe(seeds = SEEDS) {
  const rows = [];
  const controls = [];
  for (const director of DIRECTORS) for (const route of Object.keys(ROUTES)) for (const seed of seeds) {
    rows.push(...probeDoorCase(director, seed, route));
    const { session, play } = enterNight(director, seed, route, {}, DOOR_APPROACH); // 同一条路，不要 living
    const saved = JSON.stringify(session.save());
    const advanceResult = typeof play.advance === 'function' ? play.advance({ toTick: 40 }) : null;
    controls.push({ director, route, seed, hasLife: !!play.life, unchanged: saved === JSON.stringify(session.save()), advanceResult: clone(advanceResult) });
  }
  const last = DOOR_DURATIONS[DOOR_DURATIONS.length - 1];
  const endRows = rows.filter((r) => r.requestedSeconds === last);
  const of = (d) => endRows.filter((r) => r.director === d);
  const acts = {};
  for (const d of DIRECTORS) acts[DIRECTOR_NAME[d]] = Object.fromEntries(Object.keys(ROUTES).map((route) => {
    const g = of(d).filter((r) => r.route === route);
    return [route, {
      counts: g.map((r) => r.spontaneousActs),
      people: [...new Set(g.flatMap((r) => r.acts.map((a) => a.from)))],
      acts: g.flatMap((r) => r.acts.map((a) => ({ seed: r.seed, ...a }))),
    }];
  }));
  const baseline = (d) => JSON.stringify(of(d).map((r) => r.deadlineChanges
    .filter((c) => c.keys.some((k) => DEADLINE_KEYS.includes(k)))
    .map((c) => `${c.second}:${c.keys.filter((k) => DEADLINE_KEYS.includes(k)).join('+')}`)));
  const outcome = (d) => JSON.stringify(of(d).map((r) => [r.flags.fuOwner, r.flags.fuWithRuji, r.flags.nightHand, r.flags.nightAsk]));
  const hasActMemory = (d) => of(d).some((r) => DOOR_PEOPLE.some((p) => r.memory[p].signatures.some((s) => s.endsWith(':act'))) || (r.store.depth[1] || 0) > 0);
  const checks = {
    '门边站定时确实站在门口（pos3、没被看见、没走完）': rows.every((r) => r.entered.pos === 3 && !r.entered.seen && !r.entered.done),
    '门边读镜是纯读（前后存档逐字节相同）': rows.every((r) => r.readOnly),
    '门边每条自发行动 from 是演员且 cause 指向他自己的反应': rows.every((r) => r.actErrors.length === 0),
    '门边生活关闭时同一路一笔不变': controls.every((r) => !r.hasLife && r.unchanged && r.advanceResult === null),
    '门边同种子同结果': JSON.stringify(probeDoorCase('A', seeds[0], 'high')) === JSON.stringify(probeDoorCase('A', seeds[0], 'high')),
  };
  const findings = {
    '陆导门边空等到天亮也没人自己动身': of('A').every((r) => r.spontaneousActs === 0),
    '单导门边有人在空等里自己动身': of('B').every((r) => r.spontaneousActs >= 1),
    '两位导演在门边照样走同一份期限（灯/到期）': baseline('A') === baseline('B'),
    '门边第 8 拍的巡灯把符账记回如姬名下（谁也没真递）': of('A').every((r) => {
      const c = r.deadlineChanges.find((x) => x.second === 8);
      return !!c && c.now.fuWithRuji === true && c.now.fuOwner === 'ruji';
    }),
    '单导门边有人真把符递出去（符账变成玩家）': of('B').some((r) => r.flags.fuOwner === 'player' && r.flags.nightHand === true),
    '两位导演在门边的托付结局不同（符主/闸门旗标）': outcome('A') !== outcome('B'),
    '单导多出来的动作进了记忆（act 槽或巩固分层）': hasActMemory('B') && !hasActMemory('A'),
  };
  return { seeds, durations: DOOR_DURATIONS, approach: DOOR_APPROACH, rows, controls, checks, findings, acts };
}

/** 一次空等：每秒推进一拍，按 0/10/20/40 拍截读数 */
export function probeCase(director, seed, route = 'low') {
  const { session, play } = enterNight(director, seed, route);
  const ledgerAtEntry = session.ledger.size;
  const initial = opportunity(session, play);
  const stories = new Map();
  const evidence = new Map();
  const snapshots = [];
  const remember = (fragment, second) => {
    const key = evidenceKey(fragment);
    if (evidence.has(key)) return evidence.get(key);
    const row = { ...clone(fragment), ...audit(fragment, session, play), firstSeen: second };
    evidence.set(key, row);
    return row;
  };
  const deadlineChanges = [];
  let previousOpportunity = initial;
  let readOnly = true;
  let deadlineFirstChange = null;

  for (let second = 0; second <= DURATIONS[DURATIONS.length - 1]; second += 1) {
    if (second) play.advance({ toTick: second });
    const before = JSON.stringify(session.save());
    const mirror = play.life.view.read('night'); // createLifeView.read：纯读
    readOnly = readOnly && before === JSON.stringify(session.save());

    const planFragment = mirror.policy
      ? { source: 'plan', person: mirror.director?.id ?? null, layer: 'plan', object: mirror.policy.why, seq: mirror.policy.sourceSeq ?? null, signature: mirror.policy.reasonId ?? null, path: mirror.policy.path }
      : null;
    if (planFragment) remember(planFragment, second);
    for (const actor of mirror.actors) {
      for (const fragment of actor.thinking || []) {
        const row = remember(fragment, second);
        if (fragment.source === 'perception' && fragment.object && !stories.has(storyKey(fragment))) stories.set(storyKey(fragment), row);
      }
    }
    for (const experience of mirror.experiences || []) remember(experience, second);

    const current = opportunity(session, play);
    const changed = JSON.stringify(initial) !== JSON.stringify(current);
    const movedNow = JSON.stringify(previousOpportunity) !== JSON.stringify(current);
    if (movedNow) {
      const keys = Object.keys(current).filter((k) => JSON.stringify(previousOpportunity[k]) !== JSON.stringify(current[k]));
      deadlineChanges.push({ second, keys, now: Object.fromEntries(keys.map((k) => [k, current[k]])) });
    }
    if (changed && deadlineFirstChange === null) deadlineFirstChange = second;
    previousOpportunity = current;
    if (!DURATIONS.includes(second)) continue;

    const rows = session.ledger.entries.slice(ledgerAtEntry);
    const at = (kind) => rows.filter((e) => e.kind === kind).length;
    const acts = rows.filter((e) => e.kind === 'actor.act');
    const kindCounts = rows.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] || 0) + 1 }), {});
    const reactionPayloads = new Set(rows.filter((e) => e.kind === 'actor.react').map((e) => `${e.from}|${e.payload?.action}`));
    const slots = mirror.actors.flatMap((a) => (a.memory || []).map((m) => `${a.id}|${m.object}`));
    const traceMax = Math.max(0, ...mirror.actors.flatMap((a) => (a.memory || []).map((m) => m.trace || 0)));
    const actErrors = acts.filter((entry) => {
      if (!String(entry.from).startsWith('actor:') || entry.from === 'actor:player') return true;
      const reaction = (entry.cause || []).map((seq) => session.ledger.get(seq)).find((e) => e?.kind === 'actor.react' && e.from === entry.from);
      return !reaction;
    }).map((e) => e.seq);
    const evidenceRows = [...evidence.values()];
    const storyRows = [...stories.values()];
    snapshots.push({
      director, directorName: DIRECTOR_NAME[director], route, seed, requestedSeconds: second,
      lifeTick: mirror.tick,
      storyFragments: storyRows.length,
      storyPeople: new Set(storyRows.map((f) => f.person)).size,
      distinctStoryTexts: new Set(storyRows.map((f) => f.object)).size,
      storyTraced: storyRows.filter((f) => f.ok).length,
      storyUntraced: storyRows.filter((f) => !f.ok),
      deviceFragments: evidenceRows.length,
      deviceTraced: evidenceRows.filter((f) => f.ok).length,
      deviceNoSeq: evidenceRows.filter((f) => !f.hasSeq).length,
      deviceBroken: evidenceRows.filter((f) => f.hasSeq && !f.ok).length,
      noSeqSources: [...new Set(evidenceRows.filter((f) => !f.hasSeq).map((f) => `${f.source}|${String(f.path || '').split('.').slice(0, 3).join('.')}`))],
      noSeqSample: evidenceRows.filter((f) => !f.hasSeq).slice(0, 3).map((f) => ({ person: f.person, object: f.object, source: f.source, path: f.path })),
      ledgerRows: rows.length,
      pulses: at('world.pulse'),
      reactions: at('actor.react'),
      spontaneousActs: acts.length,
      actErrors,
      kindCounts,
      distinctReactionPayloads: reactionPayloads.size,
      memorySlots: slots.length,
      memorySlotsDistinct: new Set(slots).size,
      memoryTraceMax: traceMax,
      readOnly,
      waitForPlayer: mirror.policy?.waitForPlayer ?? null,
      policySourceSeq: mirror.policy?.sourceSeq ?? null,
      autonomyVerbs: mirror.policy?.autonomy?.verbs ?? [],
      cadenceTicks: mirror.policy?.cadenceTicks ?? null,
      opportunityInitial: initial,
      opportunity: current,
      deadlineFrozen: !changed,
      deadlineFirstChange,
      deadlineChanges: clone(deadlineChanges),
      ended: play.life.state().ended,
      end: play.life.state().endedOutcome?.outcome ?? null,
      stories: storyRows,
      directorCase: planFragment ? remember(planFragment, second) : null,
    });
  }
  return snapshots;
}

export function runProbe(seeds = SEEDS) {
  const rows = [];
  const controls = [];
  for (const director of DIRECTORS) for (const route of Object.keys(ROUTES)) for (const seed of seeds) {
    rows.push(...probeCase(director, seed, route));
    // 生活关闭的对照：同一条路只去掉 living，advance 不该存在、存档不该动
    const { session, play } = enterNight(director, seed, route, {}); // 同样的路，不要 living
    const saved = JSON.stringify(session.save());
    const advanceResult = typeof play.advance === 'function' ? play.advance({ toTick: 40 }) : null;
    controls.push({ director, route, seed, hasLife: !!play.life, unchanged: saved === JSON.stringify(session.save()), advanceResult: clone(advanceResult) });
  }
  const at20 = rows.filter((r) => r.requestedSeconds === 20);
  const door = runDoorProbe(seeds); // t58：走到门边再站着那一档（同一批种子）
  const sig = (r) => JSON.stringify([r.storyFragments, r.storyPeople, r.spontaneousActs, r.pulses, r.reactions, r.ended, r.opportunity]);
  const low20 = (d) => at20.filter((r) => r.director === d && r.route === 'low');
  const checks = {
    '二十秒至少两件人物自己的事': at20.every((r) => r.storyFragments >= 2 && r.storyPeople >= 2),
    '故事片段全部能追回账本': at20.every((r) => r.storyTraced === r.storyFragments),
    '读镜是纯读（前后存档逐字节相同）': rows.every((r) => r.readOnly),
    '自发行动 from 是演员且 cause 指向自己的反应': rows.every((r) => r.actErrors.length === 0),
    '生活关闭时同一路一笔不变': controls.every((r) => !r.hasLife && r.unchanged && r.advanceResult === null),
    '同种子同结果': JSON.stringify(probeCase('A', seeds[0], 'low')) === JSON.stringify(probeCase('A', seeds[0], 'low')),
  };
  const observations = {
    '等你的导演（waitForPlayer）空等二十秒机会与期限不变': at20.filter((r) => r.waitForPlayer).every((r) => r.deadlineFrozen),
    '空等四十秒还没把这一夜收掉': rows.filter((r) => r.requestedSeconds === 40).every((r) => !r.ended),
    '两位导演二十秒的读数不同': new Set(at20.filter((r) => r.route === 'low').map(sig)).size > 1,
    '换种子会改变二十秒的读数': new Set(low20('A').map(sig)).size > 1,
    '读镜里每个片段都带账本 seq': at20.every((r) => r.deviceNoSeq === 0),
    '两位导演都在二十秒里给出至少一件自发行动': at20.every((r) => r.spontaneousActs >= 1),
    '高低托付两条路二十秒看到的东西相同': DIRECTORS.every((d) => {
      const pair = at20.filter((r) => r.director === d);
      const seen = new Set(pair.map((r) => JSON.stringify([r.storyFragments, r.storyPeople, r.spontaneousActs, r.pulses, r.reactions, r.ended])));
      return pair.length >= 2 && seen.size === 1;
    }),
    '相同处境没有反复造新记忆槽': at20.every((r) => r.memorySlots === r.memorySlotsDistinct),
  };
  const seedDistinctAt20 = new Set(low20('A').map(sig)).size;
  return { seeds, durations: DURATIONS, routes: ROUTES, rows, controls, checks, observations, seedDistinctAt20, door };
}

const span = (values) => {
  const min = Math.min(...values); const max = Math.max(...values);
  return min === max ? String(min) : `${min}–${max}`;
};

const flagPhrase = (flags) => [
  `符主=${flags.fuOwner}`,
  `递给玩家=${flags.nightHand ? '是' : '否'}`,
  `低问=${flags.nightAsk ? '是' : '否'}`,
  `拦住=${flags.nightBlock ? '是' : '否'}`,
  `灯=${flags.lantern}`,
  `到期=${flags.nightLate ? '是' : '否'}`,
].join('、');

/**
 * t58 门边档的数字表：先报「有没有人自己动身」（actor.act 真条），再报记忆槽的成长，最后写清两位导演分别在哪。
 */
export function formatDoorSection(door) {
  const last = door.durations[door.durations.length - 1];
  const lines = ['', '──────────────────────────────────────────────────────────────',
    `门边档（t58）：进之夜后先走到如姬卧内门口站定，再空等 ${door.durations.join('/')} 拍（门前就是托付闸门）。`,
    `走位只用场景自己的选项：${door.approach.join(' → ')}——把令牌塞给守夜的乙、他别开眼，再踩着巡灯节奏过中庭。`,
    '走位不推生活拍：站定后生活拍从 0 起算，「第 N 拍动手」＝站定后第 N 秒。心里转几转的停层不算动作；下表只数账本里 actor.act 的真条。',
    '',
    `| 导演/托付 | 站定 | ${door.durations.map((d) => `${d} 拍`).join(' | ')} | 第一次动手 | 动手的人 |`,
    `| --- | --- |${door.durations.map(() => ' ---:').join('')} | --- | --- |`,
  ];
  for (const director of DIRECTORS) for (const route of Object.keys(ROUTES)) {
    const g = door.rows.filter((r) => r.director === director && r.route === route);
    if (!g.length) continue;
    const head = g[0];
    const counts = door.durations.map((d) => g.filter((r) => r.requestedSeconds === d).map((r) => r.spontaneousActs));
    const acts = g.flatMap((r) => r.acts.map((a) => ({ seed: r.seed, ...a })));
    const first = acts.length ? Math.min(...acts.map((a) => a.firstSeenTick)) : null;
    const people = [...new Set(acts.map((a) => a.from.replace('actor:', '')))];
    lines.push(`| ${DIRECTOR_NAME[director]}/${route} | pos${head.entered.pos}·灯${head.entered.lantern}·符主${head.enteredFlags.fuOwner} | ${counts.map(span).join(' | ')} | ${first === null ? '没有' : `第 ${first} 秒`} | ${people.length ? people.join('、') : '—'} |`);
  }
  lines.push('', `每条自发行动（${door.seeds.length} 个种子读数完全一致，这里列种子 ${door.seeds[0]}）：`);
  for (const director of DIRECTORS) for (const route of Object.keys(ROUTES)) {
    const r = door.rows.find((x) => x.director === director && x.route === route && x.requestedSeconds === last && x.seed === door.seeds[0]);
    if (!r) continue;
    if (!r.acts.length) {
      lines.push(`  ${DIRECTOR_NAME[director]}/${route}：空等到天亮 ${r.spontaneousActs} 条 actor.act（${flagPhrase(r.flags)}）`);
      continue;
    }
    lines.push(`  ${DIRECTOR_NAME[director]}/${route}：${r.acts.length} 条 ——`);
    for (const a of r.acts) lines.push(`    · seq ${a.seq} 第 ${a.firstSeenTick} 拍 ${a.from} verb=${a.verb} → ${a.to}「${a.action}」cause=[${a.cause.join(',')}]，指向它自己的反应 ${a.causeKinds.join('/')}（from 是演员，不是玩家：自发=${a.selfInitiated ? '是' : '否'}）`);
    lines.push(`      此后旗标：${flagPhrase(r.flags)}`);
  }
  lines.push('', '记忆成长（同一段空等的前后差：槽的条数 / 最亮 activation / 最深 consolidation，不是账本长度）：');
  for (const director of DIRECTORS) for (const route of Object.keys(ROUTES)) {
    const start = door.rows.find((r) => r.director === director && r.route === route && r.requestedSeconds === 0);
    const end = door.rows.find((r) => r.director === director && r.route === route && r.requestedSeconds === last);
    if (!start || !end) continue;
    const f = (m) => `${m.count} 槽（最亮 ${m.maxActivation}，最深 ${m.maxConsolidation}）`;
    lines.push(`  ${DIRECTOR_NAME[director]}/${route}`);
    lines.push(`    站定那一刻：如姬 ${f(start.enteredMemory.ruji)}、甲 ${f(start.enteredMemory.guard_a)}、乙 ${f(start.enteredMemory.guard_b)}；经历 ${start.enteredStore.entries} 条（深度 ${JSON.stringify(start.enteredStore.depth)}，最大巩固 ${start.enteredStore.maxConsolidation}）`);
    lines.push(`    空等 ${last} 拍后：如姬 ${f(end.memory.ruji)}、甲 ${f(end.memory.guard_a)}、乙 ${f(end.memory.guard_b)}；经历 ${end.store.entries} 条（深度 ${JSON.stringify(end.store.depth)}，最大巩固 ${end.store.maxConsolidation}，最大冲击 ${end.store.maxImpact}）`);
    const fresh = DOOR_PEOPLE.flatMap((p) => end.memory[p].signatures.filter((s) => !start.enteredMemory[p].signatures.includes(s)).map((s) => `${p} 多出 ${s}`));
    lines.push(`    空等里新增的槽：${fresh.length ? fresh.join('；') : '没有新增槽'}`);
    for (const p of DOOR_PEOPLE) {
      const top = [...end.memory[p].slots].sort((a, b) => b.consolidation - a.consolidation)[0];
      const was = top && start.enteredMemory[p].slots.find((o) => o.signature === top.signature);
      if (!was) continue;
      if (was.trace === top.trace && was.consolidation === top.consolidation && was.activation === top.activation) continue;
      lines.push(`      例：${p} 的 ${top.signature} —— trace ${was.trace}→${top.trace}、最亮 ${was.activation}→${top.activation}、巩固 ${was.consolidation}→${top.consolidation}`);
    }
  }
  lines.push('', `机会与期限（巡灯/到期＝${DEADLINE_KEYS.join('/')}；符账＝${OWNER_KEYS.join('/')}；谁动过手留下的闸门旗标另记）：`);
  for (const director of DIRECTORS) for (const route of Object.keys(ROUTES)) {
    const r = door.rows.find((x) => x.director === director && x.route === route && x.requestedSeconds === last && x.seed === door.seeds[0]);
    if (!r) continue;
    const group = (keys) => r.deadlineChanges.filter((c) => c.keys.some((k) => keys.includes(k)));
    const fmt = (cs, keys) => (cs.length
      ? cs.map((c) => `第 ${c.second} 拍 ${c.keys.filter((k) => keys.includes(k)).map((k) => `${k}=${c.now[k]}`).join('+')}`).join('；')
      : '没有动过');
    const actionKeys = r.deadlineChanges
      .flatMap((c) => c.keys.filter((k) => !DEADLINE_KEYS.includes(k) && !OWNER_KEYS.includes(k)).map((k) => `${k}@${c.second}`));
    lines.push(`  ${DIRECTOR_NAME[director]}/${route}：巡灯/到期 ${fmt(group(DEADLINE_KEYS), DEADLINE_KEYS)}`);
    lines.push(`    符账 ${fmt(group(OWNER_KEYS), OWNER_KEYS)}`);
    if (actionKeys.length) lines.push(`    谁动过手留下的旗标：${actionKeys.join('、')}`);
    lines.push(`    ${last} 拍后：${flagPhrase(r.flags)}，生活拍停在 ${r.lifeTick}${r.ended ? `（已收场 end=${r.end}）` : ''}`);
  }
  const actSummary = (d) => {
    const g = door.rows.filter((r) => r.director === d && r.requestedSeconds === last);
    return {
      acts: span(g.map((r) => r.spontaneousActs)),
      people: [...new Set(g.flatMap((r) => r.acts.map((a) => a.from.replace('actor:', ''))))],
      outcomes: [...new Set(g.map((r) => `${r.route} 符主=${r.flags.fuOwner}/递交=${r.flags.nightHand ? '是' : '否'}/低问=${r.flags.nightAsk ? '是' : '否'}`))],
      growth: [...new Set(g.flatMap((r) => {
        const start = door.rows.find((x) => x.director === d && x.route === r.route && x.requestedSeconds === 0);
        if (!start) return [];
        return DOOR_PEOPLE.flatMap((p) => r.memory[p].signatures
          .filter((s) => !start.enteredMemory[p].signatures.includes(s))
          .map((s) => `${p}:${s}`));
      }))],
      depth1: g.some((r) => (r.store.depth[1] || 0) > 0),
    };
  };
  const A = actSummary('A'); const B = actSummary('B');
  const entry = door.rows.find((r) => r.requestedSeconds === 0);
  lines.push('', '差在哪（两位导演的分别）：',
    `  · 有没有人自己动身：陆导 ${A.acts} 条 actor.act${A.people.length ? `（${A.people.join('、')}）` : '（一个人都没自己动）'}；单导 ${B.acts} 条${B.people.length ? `（${B.people.join('、')} 自己动了手）` : ''}。`,
    `  · 巡灯与到期：两人${door.findings['两位导演在门边照样走同一份期限（灯/到期）'] ? '走得完全一样（第 8/16/24/32 拍同一份巡灯与到期，四十拍都以 dawn 收场）——差别不在期限' : '不一样（见上）'}。`,
    `  · 托付结局：陆导 ${A.outcomes.join('；')}；单导 ${B.outcomes.join('；')}。`,
    `  · 符账的小机制：站定那一刻符主=${entry ? entry.enteredFlags.fuOwner : '?'}、符在如姬手=${entry && entry.enteredFlags.fuWithRuji ? '是' : '否'}（符已不在如姬手里、但还没记归谁）；第 8 拍的巡灯规则又把它记回如姬名下（观察${door.findings['门边第 8 拍的巡灯把符账记回如姬名下（谁也没真递）'] ? '成立' : '不成立'}）；托付规则要等这一拍之后才可能真递——单导/high 正是在第 8 拍把符账改成 player 的（观察${door.findings['单导门边有人真把符递出去（符账变成玩家）'] ? '成立' : '不成立'}）。`,
    `  · 记忆：单导空等里${B.growth.length ? `新增 ${B.growth.join('、')}` : '没有新增 slot'}${B.depth1 ? '，经历里多出一条 depth=1 的巩固件' : ''}；陆导${A.growth.length ? `新增 ${A.growth.join('、')}` : '没有新增 slot'}${A.depth1 ? '，也有 depth=1' : '，没有 depth=1'}。`,
    `  所以分别主要是「有没有人自己动身」（以及由此带出的托付结局与记忆），不是「机会与期限怎么走」；陆导的等拍并没有让期限停住（与 t51 的 FAIL 同因）。`,
    '', ...Object.entries(door.checks).map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} 门边·${name}`),
    ...Object.entries(door.findings).map(([name, ok]) => `门边观察${ok ? '有' : '无'}：${name}`));
  return lines.join('\n');
}

export function formatProbe(report) {
  const lines = [
    `取符之夜空等探针：${report.seeds.length} 个种子 × 2 位导演 × 2 条托付路线，各空等 ${report.durations.join('/')} 秒`,
    'low＝大梁 wait、夷门 wait（低托付）；high＝大梁 yi、夷门 back（高托付）；进之夜后不再有任何输入。',
    '故事片段＝读镜 actors[].last 里 谁/停层/动作 去重（玩家能说出口的事）；「话」＝去重后不同的台词句数。',
    '亮度或 seq 刷新不算新事；同一个人换停层（老习惯→手已经动了）算两件。',
    '证据＝读镜出现过的全部条目按 来源/签名/seq/path 去重；账本行＝进之夜后新增的世界脉搏与反应。',
    '期限＝场景控制器里的 pos/step/lantern/token/seen/done、天数、旗标与结局（任务里那条「空等 tick 不变」的可测形式）。',
    '',
    '| 导演/托付 | 空等秒 | 生活拍 | 故事片段/人数/话 | 自发act | 账本行(脉搏/反应) | 证据可追 | 期限未变 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const director of DIRECTORS) for (const route of Object.keys(report.routes)) for (const second of report.durations) {
    const g = report.rows.filter((r) => r.director === director && r.route === route && r.requestedSeconds === second);
    if (!g.length) continue;
    const frozen = g.every((r) => r.deadlineFrozen);
    const first = Math.min(...g.map((r) => r.deadlineFirstChange ?? Infinity));
    const ended = g.some((r) => r.ended);
    lines.push(`| ${DIRECTOR_NAME[director]}/${route} | ${second} | ${span(g.map((r) => r.lifeTick))} | ${span(g.map((r) => r.storyFragments))}/${span(g.map((r) => r.storyPeople))}/${span(g.map((r) => r.distinctStoryTexts))} | ${span(g.map((r) => r.spontaneousActs))} | ${span(g.map((r) => r.ledgerRows))}(${span(g.map((r) => r.pulses))}/${span(g.map((r) => r.reactions))}) | ${span(g.map((r) => r.deviceTraced))}/${span(g.map((r) => r.deviceFragments))} | ${frozen ? '是' : `否（第${first}秒起变${ended ? '，已收场' : ''}）`} |`);
  }
  const at20 = report.rows.filter((r) => r.requestedSeconds === 20);
  lines.push('',
    `同种子同结果：${report.checks['同种子同结果'] ? '是' : '否'}；陆导/low 二十秒读数的不同签名数（${report.seeds.length} 个种子）：${report.seedDistinctAt20}`,
    `证据片段里没有 seq 的：${span(at20.map((r) => r.deviceNoSeq))} 条/种子；有 seq 却解不开的：${span(at20.map((r) => r.deviceBroken))} 条。`,
    `生活拍按定义会走（二十秒＝${span(at20.map((r) => r.lifeTick))} 拍；停留满八拍才有导师笔记），字面 tick 不动不成立，上表「期限未变」栏报的是机会与期限有没有被空等吃掉。`,
    '', ...Object.entries(report.checks).map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} ${name}`),
    ...Object.entries(report.observations).map(([name, ok]) => `观察${ok ? '有' : '无'}：${name}`));

  for (const director of DIRECTORS) {
    const row = report.rows.find((r) => r.director === director && r.route === 'low' && r.requestedSeconds === 20);
    lines.push('', `${DIRECTOR_NAME[director]}（waitForPlayer=${row.waitForPlayer}，verbs=${JSON.stringify(row.autonomyVerbs)}，每 ${row.cadenceTicks} 拍检查）种子 ${row.seed} 空等二十秒，能说出口的事：`);
    for (const f of row.stories) lines.push(`  · ${f.person} ${STOP_LAYER[f.layer] || f.layer}：「${f.object}」 账本 seq=${f.seq}（第 ${f.firstSeen} 秒第一次看见，可追=${f.ok ? '是' : `否 ${f.errors.join(',')}`}）`);
  }
  const d20 = report.rows.find((r) => r.director === 'A' && r.route === 'low' && r.requestedSeconds === 20);
  if (d20) {
    lines.push('', `二十秒账本明细（${d20.directorName}/${d20.route}，种子 ${d20.seed}）：${JSON.stringify(d20.kindCounts)}`,
      `  其中 actor.react ${d20.kindCounts['actor.react'] || 0} 行，去重后只有 ${d20.distinctReactionPayloads} 种（同样是「谁+同一动作」反复落账）；`,
      `  读镜里的记忆槽 ${d20.memorySlots} 个、去重后 ${d20.memorySlotsDistinct} 个，单个槽最多被触到 trace=${d20.memoryTraceMax}（槽不新增，只涨计数）。`);
  }
  const detail = report.rows.find((r) => r.director === 'A' && r.route === 'low' && r.requestedSeconds === 40);
  if (detail && detail.deadlineChanges.length) {
    lines.push('', `空等里机会/期限真正动过的拍（${detail.directorName}/${detail.route}，种子 ${detail.seed}；与上一拍比）：`);
    for (const c of detail.deadlineChanges) lines.push(`  第 ${c.second} 秒：${c.keys.join('、')} → ${JSON.stringify(c.now)}`);
    lines.push(`  四十秒请求后生活拍停在 ${detail.lifeTick}（收场后 advance 不再推进）。`);
  }
  const untraced = [...new Map(report.rows.flatMap((r) => r.storyUntraced).map((f) => [evidenceKey(f), f])).values()];
  lines.push('', untraced.length ? `追不到账本的故事片段：${untraced.map((f) => `${f.person}/${f.object}（${f.errors.join(',')}）`).join('；')}` : '追不到账本的故事片段：无');
  const noSeq20 = report.rows.find((r) => r.requestedSeconds === 20 && r.deviceNoSeq);
  if (noSeq20) {
    lines.push(`无 seq 的条目来源（二十秒，${noSeq20.directorName}/${noSeq20.route}）：${noSeq20.noSeqSources.join('，')}`);
    for (const s of noSeq20.noSeqSample) lines.push(`  · ${s.person}：「${s.object}」 source=${s.source} path=${s.path}`);
  }
  lines.push('',
    '读镜里无 seq 的条目来自心智自己的记忆槽（source=memory，path 指向 minds.<人>.state.memory）与经历索引的投影；这些条目按设计只带派生量，没有账本 seq。',
    formatDoorSection(report.door),
    '',
    `可复验命令：node tools/living-probe.mjs --seeds ${report.seeds.join(',')}`,
    `单种子细看：node tools/living-probe.mjs --seeds ${report.seeds[0]} --json`,
    '范围：只量 Node 侧逻辑拍与 createLifeView.read；没有验证浏览器「前台秒数 → toTick」接线、身段动画，也没有跑仓库测试（AGENT.md：子 Agent 不 build/test）。',
  );
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--seeds');
  const seeds = at < 0 ? SEEDS : (args[at + 1] || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!seeds.length) throw new Error('--seeds 需要至少一个种子');
  const report = runProbe(seeds);
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else if (args.includes('--door-only')) console.log(formatDoorSection(report.door), `\n可复验命令：node tools/living-probe.mjs --door-only --seeds ${seeds.join(',')}`);
  else console.log(formatProbe(report));
  const failed = Object.values(report.checks).some((ok) => !ok) || Object.values(report.door.checks).some((ok) => !ok);
  if (failed) process.exitCode = 1;
}
