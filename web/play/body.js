// 只读身段翻译。倾向来自感知；「已经做」必须另外有 actor.act。
export function bodyOf(actor, entries, from = 0) {
  const last = actor?.last;
  const actions = entries.filter(e => e.kind === 'actor.act' && e.from === `actor:${actor.id}` && e.seq >= from);
  // 账本可能同时留下 actor.act 与它派生的一条同名记录；按 seq 去重，只认最早落账的那条。
  const seen = new Set();
  const done = [...actions].reverse().find(e => !seen.has(e.payload?.action) && seen.add(e.payload?.action)) ?? null;
  const current = done && done.cause.includes(last?.seq);
  const action = String(last?.action ?? '');
  const verb = current ? done.payload.verb : null;
  let pose = 'still';
  if (/低问|风险|怕|不安|risk/.test(action)) pose = 'hesitate';
  else if (/递|交|debt/.test(action)) pose = 'offer';
  else if (/令牌|拦|block/.test(action)) pose = 'guard';
  else if (/背|装作|回避/.test(action)) pose = 'away';
  if (current && verb === 'give') pose = 'given';
  if (current && verb === 'block') pose = 'guard';
  const thinking = last ? `${actor.name}心里：${action || '这股动静还没选出动作'}` : `${actor.name}此刻在意：${actor.goal ?? '还没有留下目标'}`;
  const happened = current ? `${actor.name}已做：${done.payload.action ?? action}` : last ? `手还没动：${last.stoppedAt === 'unit' ? '这一拍未获行动时机' : '心思还没到动手的小槽'}` : '尚无这次的真实感知';
  return { pose, thinking, happened, actor, done: current ? done : null, source: { perception: last, action: current ? done : null, trust: actor.trust, stress: actor.stress, goal: actor.goal, path: `minds.${actor.id}.state`, from } };
}
