// space：格子、位置、阻挡——谁现在站在哪里。
// 它拥有的状态：{ at, index, positions: {player|person: 格子}, visited: [], blocked: {} }。
// 规则里可判 ctrl.space.at === '卧内门口'；效果 ['move', 'player'|人, 格子] 与
// 内核的 ctx.move(person, to) 都落到 move()。位置不改心智，只改「他在哪儿」。
//
// cfg = {
//   tiles: ['宫门外', '回廊', '中庭', '卧内门口', '后门'],
//   start: '宫门外',
//   free: true,                       // 默认可以走到任意一格；false = 只能往前后一格
//   blocked: [{ tile, reason, flag? }],   // 挡住的格子；flag 立起来之后才挡
//   options: [{ id, to, verb:'go', label, text, needs? }],  // 给定就按它列走法（夜场那种）
// }
export default function space(cfg = {}) {
  const tiles = cfg.tiles || [];
  const start = cfg.start ?? tiles[0];

  function blockers(ctx) {
    const out = {};
    for (const b of cfg.blocked || []) {
      if (!b.flag || ctx.world.flags[b.flag]) out[b.tile] = b.reason || '过不去。';
    }
    return out;
  }

  function doMove(world, person, to) {
    const st = world.ctrl.space;
    const from = st.positions[person] ?? null;
    st.positions[person] = to;
    if (person === 'player') {
      st.at = to;
      st.index = tiles.indexOf(to);
      if (!st.visited.includes(to)) st.visited.push(to);
    }
    return { from, to };
  }

  return {
    id: 'space',
    init(ctx) {
      const at = typeof start === 'number' ? tiles[start] : start;
      return { at, index: tiles.indexOf(at), positions: { player: at }, visited: [at], blocked: {} };
    },
    move(person = 'player', to, world) { return doMove(world, person, to); },
    intents(ctx) {
      if (cfg.options) return cfg.options.map((o, i) => ({ verb: 'go', ...o, order: (cfg.order ?? 400) + i }));
      if (cfg.options === false) return [];
      const st = ctx.ctrl('space');
      const blocked = blockers(ctx);
      return tiles.filter((t) => t !== st.at && canReach(cfg, tiles, st.at, t)).map((t, i) => ({
        id: `go-${i + 1}`,
        verb: 'go',
        to: t,
        label: `走向${t}`,
        order: (cfg.order ?? 400) + i,
        usable: !blocked[t],
        refusedText: blocked[t] || '走不过去。',
      }));
    },
    apply(intent, ctx) {
      const ste = ctx.ctrl('space');
      const to = intent.to;
      if (ste) doMove(ctx.world, 'player', to);
      return { text: intent.text ?? `你到了${to}。` };
    },
    view(ctx) {
      const st = ctx.ctrl('space') || { at: start, positions: {}, visited: [] };
      return { kind: 'space', at: st.at, index: st.index, tiles, visited: st.visited, positions: { ...st.positions }, blocked: blockers(ctx) };
    },
  };
}

function canReach(cfg, tiles, from, to) {
  if (cfg.free !== false) return true;
  const a = tiles.indexOf(from), b = tiles.indexOf(to);
  return Math.abs(a - b) === 1;
}
