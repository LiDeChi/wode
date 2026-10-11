// standing：信任，以及「你替谁说话」——替谁说话会改你这句话的分量（bar）。
// 它拥有的状态：{ board: {person: 信任值}, speakingFor, lastStanding }。
// 信任本身活在心智里（mind.state.trust），standing 只读；写信任走 trust 效果（actor.trust）。
//
// 邺城那一幕的顺序是「先写 actor.trust，再写 user.act」，所以这里的 apply 先 setTrust 再 react——
// 谁的分量、门在哪，都写死在 cfg 里：
// cfg = {
//   speaker: 'xinling',                       // 你替谁说话
//   threshold: 0.45,                          // 他信不信你，看这条线
//   weight: { high: 0.5, low: 0.15 },         // 分量：信 → 高，不信 → 低
//   why: { high: '…', low: '…' },
//   bar: { base: 0.5, add: 0.05, flag: 'kingSuspicious' },
//   targets: [{ id, to, line, appeal, channels, needs? }]
// }
export default function standing(cfg = {}) {
  const targets = cfg.targets || [];
  const speaker = cfg.speaker;
  const find = (id) => targets.find((t) => t.id === id);

  function standingOf(ctx) {
    const v = ctx.trustOf(speaker);
    return v >= (cfg.threshold ?? 0.45) ? 'high' : 'low';
  }
  function barOf(ctx) {
    const b = cfg.bar || {};
    return round3((b.base ?? 0.5) + (b.flag && ctx.world.flags[b.flag] ? (b.add ?? 0) : 0));
  }

  return {
    id: 'standing',
    init(ctx) {
      return { board: {}, speakingFor: speaker || null, lastStanding: null };
    },
    intents(ctx) {
      return targets.map((t, i) => ({
        id: t.id, verb: t.verb || 'say', to: t.to, line: t.line, appeal: t.appeal, channels: t.channels, needs: t.needs,
        order: (cfg.order ?? 300) + i,
      }));
    },
    /** 替人说话：先落在账本上的那笔信任，决定了对方愿不愿意听完 */
    apply(intent, ctx) {
      const t = find(intent.id) || targets[0] || { to: intent.to };
      const st = ctx.ctrl('standing');
      const which = standingOf(ctx);
      const value = (cfg.weight || {})[which] ?? 0.15;
      if (speaker && cfg.write !== false) {
        ctx.setTrust(t.to, value, (cfg.why || {})[which] || '', [ctx.openSeq].filter(Boolean));
      }
      if (st) { st.lastStanding = which; st.speakingFor = speaker || null; }
      const r = ctx.react(t.to, { channels: t.channels, appeal: t.appeal, bar: t.bar ?? barOf(ctx) });
      return { r, text: t.text ?? null };
    },
    view(ctx) {
      const st = ctx.ctrl('standing') || {};
      const people = cfg.people || [];
      const board = {};
      for (const p of people) board[p] = { name: ctx.name(p), trust: ctx.trustOf(p) };
      return { kind: 'standing', board, speakingFor: st.speakingFor ?? speaker ?? null, standing: st.lastStanding ?? null, bar: barOf(ctx) };
    },
  };
}

function round3(v) { return Math.round(v * 1000) / 1000; }
