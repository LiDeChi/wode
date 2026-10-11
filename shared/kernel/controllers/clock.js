// clock：步数、剩几天、上限——场上唯一的计时器。
// 它拥有的状态：{ step, limit, spent, left }，另有 play 级的 days（挂在 root，由 clock 效果改）。
// 每次有人做一件事（wait 也算），内核在规则之前调一次 tick()，所以规则里能读到
// ctrl.clock.step 判「第几步」，也能读 days 判「还剩几天」。
//
// cfg = {
//   limit: 12,                 // 走满这么多步就收（不写则不限）
//   tick: 1,                   // 一步算几格
//   pause: ['wait'],           // 这些动词不推进时间
//   perAct: 0,                 // 每动一次扣几天
//   end: 'time-up',            // 到上限时交给场景的收尾名（走 end 效果）
//   endText: '天快亮了'
// }
export default function clock(cfg = {}) {
  const pause = new Set(cfg.pause || []);

  return {
    id: 'clock',
    init() {
      return { step: 0, limit: cfg.limit ?? null, tick: cfg.tick ?? 1, spent: 0 };
    },
    tick(intent, ctx) {
      if (pause.has(intent.verb)) return;
      const st = ctx.ctrl('clock');
      st.step += st.tick;
      st.spent += st.tick;
      if (cfg.perAct) ctx.effect(['clock', -cfg.perAct]);
      if (st.limit != null && st.step >= st.limit && ctx._end == null) {
        ctx._end = cfg.end ?? 'time-up';
        ctx._endText = cfg.endText ?? null;
      }
    },
    /** 规则里想直接问「还剩几步」时用得上 */
    left(ctx) {
      const st = ctx.ctrl('clock');
      return st.limit == null ? null : Math.max(0, st.limit - st.step);
    },
    view(ctx) {
      const st = ctx.ctrl('clock') || { step: 0, limit: null, spent: 0 };
      return { kind: 'clock', step: st.step, limit: st.limit, left: st.limit == null ? null : Math.max(0, st.limit - st.step), days: ctx.days, endText: ctx._endText ?? null };
    },
  };
}
