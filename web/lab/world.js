import { createSession } from '/shared/engine/session.js';
import { createMind } from '/shared/core/mind.js';
import { SCENES } from '/shared/engine/play.js';

export const VARIABLES = [
  { id:'rujiTrust', label:'如姬取符前的信任', base:.3, min:0, max:1, step:.05, why:'夷门后的信任低档；得到侯嬴引荐时仍多 0.10 / 0.15。' },
  { id:'xinlingTrust', label:'公子对门客的信任', base:.5, min:0, max:1, step:.05, why:'从开场起改变信陵君对你说的话的分量。' },
  { id:'houThreshold', label:'侯嬴点头的门槛', base:.35, min:.05, max:.9, step:.05, why:'同一句试探，要多有分量才算听进去。' },
  { id:'guardPass', label:'守卫乙愿意放行的容量', base:.54, min:0, max:1, step:.02, why:'令牌递到手里时，越低越容易守着门不让你过去。' },
  { id:'jinbiYi', label:'晋鄙把大义看多重', base:.8, min:0, max:1, step:.05, why:'大义这句话的分量；调低时，他可能合了符也不交兵权。' },
];
export const BASE = Object.fromEntries(VARIABLES.map(v=>[v.id,v.base]));
export function makeWorld(settings = BASE) {
  const session = createSession();
  for (const [id,mind] of Object.entries(session.minds)) {
    const def = structuredClone(mind.def);
    if (id==='xinling') def.trust = {...def.trust, 'actor:player':settings.xinlingTrust};
    if (id==='houying') def.threshold = settings.houThreshold;
    if (id==='guard_b') def.units.find(u=>u.id==='look_away').capacity = settings.guardPass;
    if (id==='jinbi') def.values = {...def.values, 义:settings.jinbiYi};
    session.minds[id] = createMind(def);
  }
  const scenes = structuredClone(SCENES);
  for (const rule of scenes.yimen.rules) for (const effect of rule.then || []) {
    if ((effect[0]==='trust' && effect[1]==='ruji') || (effect[0]==='flag' && effect[1]==='rujiTrust'))
      effect[2] = Math.min(1, Math.max(0, +(settings.rujiTrust + effect[2] - .3).toFixed(3)));
  }
  return {session,scenes};
}
