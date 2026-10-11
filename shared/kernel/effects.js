// 效果的封闭清单（docs/KERNEL.md §4）。场景的 then 里只能写这些；要加新种类必须改契约。
//   ['trust', person, value, why]          设信任（写 actor.trust，照搬旧 setTrust）
//   ['relay', from, to, amount, why]       把信任转给别人
//   ['flag', k, v]                         世界旗标
//   ['claim', spec, presentation?]         加一条主张（照搬旧 claim()：默认 qiefu / 门客（你）/ 亲历）
//   ['clock', delta]                       剩余天数
//   ['move', person|'player', to]          挪位置（交给 space）
//   ['attention', person, 'on'|'off']      这个人心神/视线（交给 attention）
//   ['work', workId, choice, opts?]        调 playWork
//   ['end', outcome]                       收幕（outcome 交给 play.js 的舞台流转）
//   ['cite', claimId]                      沿用一条主张
//   ['act', person, spec]                  演员自己动一次（写 actor.act，from 必须是演员，不是玩家）
//                                          spec 里可以给 { verb, action, tick, pulseSeq, ... }；
//                                          走这条路必须先过导演给演员的独立授予（ctx.autonomy）。
//
// 每个效果的 cause 由内核自动填：触发它的那次反应的 reactSeq；没有反应时用那次 user.act 的 seq。
// 场景要显式指定 cause 时，写成 { effect: [...], cause: [...] }。
import { PLAYER, HOLDER, DEFAULT_PRESENTATION, DEFAULT_CHANNEL } from './roles.js';

const round = (v) => Math.round(v * 1000) / 1000;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const EFFECTS = ['trust', 'relay', 'flag', 'claim', 'clock', 'move', 'attention', 'work', 'end', 'cite', 'act'];

/** 设信任：payload 字段和顺序照搬旧 play.js 的 setTrust */
export function setTrust(ctx, person, value, why, cause) {
  if (!ctx.minds[person]) throw new Error(`没有这个人：${person}`);
  const before = ctx.trustOf(person);
  ctx.minds[person].state.trust[PLAYER] = round(clamp01(value));
  const after = ctx.trustOf(person);
  return ctx.ledger.append({
    kind: 'actor.trust', from: `actor:${person}`, to: PLAYER, cause,
    payload: { person, before, after, why },
  }).seq;
}

/** 跑一个效果，返回给内核合并进 Outcome 的补丁 */
export function applyEffect(ctx, spec, cause = []) {
  if (!Array.isArray(spec)) throw new Error('效果要写成数组');
  const [kind, ...args] = spec;
  if (!EFFECTS.includes(kind)) throw new Error(`未知效果：${kind}`);
  if (kind === 'trust') {
    const [person, value, why] = args;
    return { seq: setTrust(ctx, person, value, why, cause) };
  }
  if (kind === 'relay') {
    const [from, to, amount = 1, why = ''] = args;
    const value = round(clamp01(ctx.trustOf(from) * amount));
    const seq = setTrust(ctx, to, value, why || `${ctx.name(from)}转告：他信你`, cause);
    return { seq };
  }
  if (kind === 'flag') {
    ctx.world.flags[args[0]] = args[1] === '@end' ? ctx._end : args[1];
    return {};
  }
  if (kind === 'claim') {
    const [specIn, presentation] = args;
    const r = ctx.claims.add({
      presentation: presentation ?? DEFAULT_PRESENTATION,
      holder: HOLDER,
      channel: DEFAULT_CHANNEL,
      ...specIn,
      cause,
    });
    return { seq: r.seq, claimId: r.claim.id, claim: r.claim };
  }
  if (kind === 'clock') {
    ctx.world.days = round(ctx.world.days + args[0]);
    return {};
  }
  if (kind === 'move') {
    const [person = 'player', to] = args;
    ctx.move(person, to);
    return {};
  }
  if (kind === 'attention') {
    const [person, mode] = args;
    ctx.attention(person, mode);
    return {};
  }
  if (kind === 'work') {
    const [workId, choice, opts] = args;
    const pick = choice === '@intent' ? ctx._intent?.id : choice;
    const r = ctx.playWork(workId, pick, opts || {});
    // 导演批没批：紧接着的一条 director.approve / director.refuse
    const v = ctx.ledger.last((e) => e.kind === 'director.approve' || e.kind === 'director.refuse');
    const verdict = v ? { kind: v.kind.split('.')[1], rule: v.payload?.rule ?? null, seq: v.seq } : null;
    return { work: r, verdict };
  }
  if (kind === 'end') {
    ctx._end = args[0];
    return { end: args[0] };
  }
  if (kind === 'cite') {
    ctx.claims.cite(args[0], args[1] ?? DEFAULT_PRESENTATION, cause);
    return { cited: args[0] };
  }
  if (kind === 'act') {
    // 演员自己动一次。from 必须是演员：这条路上永远不写 user.act（不伪造玩家信号）。
    const [person, specIn = {}] = args;
    if (!ctx.minds[person]) throw new Error(`没有这个人：${person}`);
    const spec = typeof specIn === 'string' ? { action: specIn } : (specIn || {});
    const verb = spec.verb ?? 'think';
    if (ctx.autonomy && !ctx.autonomy(person, verb)) return { refusedAct: true };
    const seq = ctx.ledger.append({
      kind: 'actor.act', from: `actor:${person}`, to: 'world', cause,
      payload: { person, verb, action: spec.action ?? null, tick: spec.tick ?? ctx.tick?.() ?? null, pulseSeq: spec.pulseSeq ?? null, policySeq: spec.policySeq ?? null, ...(spec.extra || {}) },
    }).seq;
    return { seq, act: { person, seq } };
  }
  return {};
}

/** 场景的 then 允许写成 { effect:[...], cause:[...] } 覆盖自动 cause */
export function specOf(item) {
  return Array.isArray(item) ? { effect: item, cause: null } : { effect: item?.effect, cause: item?.cause ?? null };
}
