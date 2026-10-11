// lens：只读的两个入口——看心思 / 追问。
// 它拥有的状态：无（不改世界、不写账本、不动信任）。
// intents() 只负责把「看」和「问」列成选项，渲染层照着画；真正的读取由内核的
// kernel.watch(sceneId, person) / kernel.ask(sceneId, person) 完成，所以这里不带 apply：
// dispatch 遇到 verb 是等/看/问 而没人认领时，会走内核自己那三条路。
export default function lens(cfg = {}) {
  return {
    id: 'lens',
    init(ctx) {
      return { people: cfg.people || ctx.scene.people || [], watched: 0, asked: 0 };
    },
    intents(ctx) {
      const people = cfg.people || ctx.scene.people || [];
      if (cfg.options === false) return [];
      return people.map((p, i) => ({
        id: `look-${p}`,
        verb: 'watch',
        to: p,
        label: `看${ctx.name(p)}的心思`,
        order: (cfg.order ?? 900) + i,
      }));
    },
    view(ctx) {
      const people = cfg.people || ctx.scene.people || [];
      const world = ctx.world;
      return {
        kind: 'lens',
        people: people.map((p) => ({
          person: p,
          name: ctx.name(p),
          trust: ctx.trustOf(p),
          watched: world.watched.includes(p),
          asked: world.asked.includes(p),
          // 看过/问过之后，页面上那一条就有内容可回看
          last: world.last && world.last.person === p ? world.last : null,
        })),
      };
    },
  };
}
