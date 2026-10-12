// handover：物品栏——一件东西只能出手一次，出手时走哪条感知通道由它决定。
// 它拥有的状态：{ used: [intentId], given: [itemId], items: {itemId: {…}} }。
// 出手一次 = 内核的 react()，payload 里的 item 字段由内核从 intent.item 带过去。
// cfg = {
//   items: [{ id, label, to, line, channels, text, verb:'give' }],
//   once: true（默认）
// }
export default function handover(cfg = {}) {
  const defs = cfg.items || [];
  const find = (id) => defs.find((it) => it.id === id);

  return {
    id: 'handover',
    init() {
      const items = {};
      for (const it of defs) items[it.id] = { id: it.id, label: it.label, to: it.to, held: true, used: false };
      return { items, used: [], given: [] };
    },
    intents(ctx) {
      const st = ctx.ctrl('handover');
      return defs.map((it, i) => ({
        id: it.verb ? `${it.verb}-${it.id}` : `give-${it.id}`,
        verb: it.verb || 'give',
        to: it.to,
        item: it.id,
        line: it.line,
        channels: it.channels,
        order: (cfg.order ?? 200) + i,
        usable: !!st?.items[it.id]?.held && !st?.items[it.id]?.used,
        refusedText: cfg.refusedText || '这件东西你只有一件，已经出手了。',
      }));
    },
    apply(intent, ctx) {
      const st = ctx.ctrl('handover');
      const id = intent.item;
      const it = find(id) || defs.find((d) => intent.id.endsWith(d.id));
      if (st && it) { st.items[it.id].held = false; st.items[it.id].used = true; st.used.push(intent.id); st.given.push(it.id); }
      const r = ctx.react((it || intent).to, { channels: (it || intent).channels, appeal: (it || intent).appeal || null, bar: (it || intent).bar ?? ctx.bar });
      return { r, text: (it || intent).text ?? null };
    },
    view(ctx) {
      const st = ctx.ctrl('handover') || { items: {}, used: [], given: [] };
      return { kind: 'handover', items: Object.values(st.items), used: st.used, given: st.given };
    },
  };
}
