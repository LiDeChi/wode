// speech：台词与语言档位——玩家说出口的话怎么进到对方耳朵里。
// 它拥有的状态：{ said: {intentId: count} }（同一句话说了几次；有些场次说了第二遍就没用了）。
// 一次「说」= 内核的 react()：appeal 决定打动哪一层，channels 决定走哪条通道，
// register（档位）只改 appeal 的分量，不替心智做决定。
//
// cfg = {
//   register: { plain: { ask: 1 }, plea: { ask: 1.4, leniency: 1.2 }, hard: { order: 1.5 } },
//   options: [{ id, verb:'say', to, line, appeal:{…}, register?, channels?, bar?, needs? }],
//   once: true                 // 同一句只说一次（默认 false）
// }
export default function speech(cfg = {}) {
  const options = cfg.options || [];
  const find = (id) => options.find((o) => o.id === id);

  /** 档位只缩放分量：把 plea 的诉求说得更重，把硬话的诉求说得更冲 */
  function appealOf(o) {
    const reg = cfg.register?.[o.register];
    if (!reg) return o.appeal;
    const out = {};
    for (const [k, v] of Object.entries(o.appeal || {})) out[k] = (reg[k] ?? 1) * v;
    return out;
  }

  return {
    id: 'speech',
    init() { return { said: {}, register: cfg.register || null }; },
    intents(ctx) {
      return options.map((o, i) => ({
        id: o.id,
        verb: o.verb || 'say',
        to: o.to,
        line: o.line,
        appeal: appealOf(o),
        channels: o.channels,
        needs: o.needs,
        order: (cfg.order ?? 100) + i,
        usable: !(cfg.once && ctx.world.ctrl.speech?.said[o.id]),
        refusedText: cfg.onceText || '这句话你已经说过了。',
      }));
    },
    apply(intent, ctx) {
      const o = find(intent.id) || intent;
      const state = ctx.ctrl('speech');
      if (state) state.said[intent.id] = (state.said[intent.id] || 0) + 1;
      const r = ctx.react(o.to, {
        channels: o.channels,
        appeal: o.appeal ? appealOf(o) : null,
        bar: o.bar ?? ctx.bar,
      });
      return { r, text: o.text ?? null };
    },
    view(ctx) {
      const state = ctx.ctrl('speech') || {};
      return { kind: 'speech', register: state.register, said: state.said || {} };
    },
  };
}
