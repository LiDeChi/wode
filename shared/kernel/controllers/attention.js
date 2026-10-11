// attention：每个心智现在看向哪里、开还是关——「有没有人正看着你」唯一的出处。
// 它拥有的状态：{ looking: {person: 'on' | 'off' | 目标}, calls: [谁被叫过] }。
// 规则里可以直接判 ctrl.attention.looking.guardA === '回廊'；
// 效果 ['attention', person, 'on'|'off'] 与内核的 ctx.attention(person, mode) 都落到 set()。
// 它不改世界、不写账本：看见了谁，由场景决定要不要记一笔（ctx.notice(by, reason)）。
//
// cfg = {
//   people: ['ruji', 'guardA', 'guardB'],
//   start: { ruji: 'on', guardA: 'off' },     // 开局各自看向哪里
// }
export default function attention(cfg = {}) {
  const people = cfg.people || [];

  return {
    id: 'attention',
    init() {
      const looking = {};
      for (const p of people) looking[p] = cfg.start?.[p] ?? 'off';
      return { looking, calls: [] };
    },
    /** 'on' | 'off' | 具体目标（一个格子的名字、一个人、一件事） */
    set(person, mode = 'on', world) {
      const st = world.ctrl.attention;
      st.looking[person] = mode;
      if (mode !== 'off' && !st.calls.includes(person)) st.calls.push(person);
      return mode;
    },
    /** 下面三个只读小工具收 state（= world.ctrl.attention），不是收 ctx */
    of(state, person) { return state?.looking?.[person] ?? 'off'; },
    sees(state, person) { const v = state?.looking?.[person]; return v !== 'off' && v != null; },
    watchers(state, target) {
      const looking = state?.looking || {};
      return Object.keys(looking).filter((p) => (target === 'on' ? looking[p] !== 'off' : looking[p] === target));
    },
    intents(ctx) {
      return (cfg.options || []).map((o, i) => ({ ...o, order: (cfg.order ?? 500) + i }));
    },
    view(ctx) {
      const st = ctx.ctrl('attention') || { looking: {}, calls: [] };
      return { kind: 'attention', looking: { ...st.looking }, calls: st.calls, on: Object.keys(st.looking).filter((p) => st.looking[p] !== 'off') };
    },
  };
}
