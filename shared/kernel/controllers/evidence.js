// evidence：证据的收集，以及「请求推翻一条主张」。
// 它拥有的状态：{ held: [claimId], asserted: [claimId], used: [intentId] }。
// 主张本身活主张图里（claims），evidence 只决定谁在什么时候把哪一条拿出来用。
//
// 顺序照搬夷门：先说（react，写 user.act 与 actor.react），再 cite（沿用那条主张）——
// 所以 cite 的 cause 拿的是这次反应的 reactSeq。
//
// cfg = {
//   items: [{ id, subject, predicate, object, channel, from, presentation? }],  // 场上的证据
//   requests: [{ id, claimId, to, line, appeal, channels, needs:['say'], overturn? }],
//   auto: ['it1']        // 入场就攥在手里的证据
// }
export default function evidence(cfg = {}) {
  const requests = cfg.requests || [];
  const items = cfg.items || [];
  const find = (id) => requests.find((r) => r.id === id);

  function collectClaim(ctx, itemId) {
    const it = items.find((x) => x.id === itemId);
    if (!it) throw new Error(`没有这件证据：${itemId}`);
    const patch = ctx.effect(['claim', { subject: it.subject, predicate: it.predicate, object: it.object, channel: it.channel ?? '亲历', note: it.note }, it.presentation]);
    const st = ctx.ctrl('evidence');
    if (patch.claimId && st && !st.held.includes(patch.claimId)) st.held.push(patch.claimId);
    return patch.claimId;
  }

  return {
    id: 'evidence',
    init() {
      return { held: [], asserted: [], used: [], auto: cfg.auto || [] };
    },
    /** 收下一件证据（写成一条主张），返回它的 claimId */
    collect(ctx, itemId) { return collectClaim(ctx, itemId); },
    intents(ctx) {
      const st = ctx.ctrl('evidence');
      return requests.map((r, i) => ({
        id: r.id, verb: r.verb || 'say', to: r.to, line: r.line, appeal: r.appeal, channels: r.channels,
        needs: r.needs ?? ['say'],
        order: (cfg.order ?? 600) + i,
        usable: !st?.used.includes(r.id),
        refusedText: cfg.refusedText || '这条话你已经说过了。',
      }));
    },
    apply(intent, ctx) {
      const r0 = find(intent.id) || requests[0] || { to: intent.to };
      const st = ctx.ctrl('evidence');
      const r = ctx.react(r0.to, { channels: r0.channels, appeal: r0.appeal, bar: r0.bar ?? ctx.bar });
      if (st) st.used.push(intent.id);
      const claimId = r0.claimId || (r0.item ? collectClaim(ctx, r0.item) : null);
      if (claimId) {
        ctx.effect(['cite', claimId], [r.reactSeq]);
        if (st && !st.asserted.includes(claimId)) st.asserted.push(claimId);
      }
      return { r, text: r0.text ?? null };
    },
    view(ctx) {
      const st = ctx.ctrl('evidence') || { held: [], asserted: [], used: [] };
      const rows = (id) => {
        const c = ctx.claims.get(id);
        return c ? { id, holder: c.holder, channel: c.channel, status: c.status, subject: c.subject, object: c.object, cost: ctx.claims.overturnCost(id) } : { id, missing: true };
      };
      return {
        kind: 'evidence',
        held: st.held.map(rows),
        asserted: st.asserted.map(rows),
        requests: requests.map((r) => ({ id: r.id, claimId: r.claimId ?? null, used: st.used.includes(r.id), cost: r.claimId ? ctx.claims.overturnCost(r.claimId) : null })),
      };
    },
  };
}
