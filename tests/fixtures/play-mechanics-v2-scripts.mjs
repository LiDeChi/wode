// 玩法打磨（M2）之后的对照组脚本。
//
// 两件事在这里合起来：
//   1. 原封不动搬来 t23 那 680 个脚本（id 一个不改）——它们仍然是最好的回归网，
//      但要对着新的 golden 用，因为 t13 是「被授权的内容改版」：结局、天数、旗标、账本都会变。
//      旧 golden（play-golden.json）留着当差异表的另一半，见 docs/design/mechanics-polish-evidence.md。
//   2. 加上按 docs/design/MECHANICS.md §5 写出来的路线脚本：三条结局各两条路、R 组合（低信任时
//      在门口多等一拍）、高低身份的对照、以及三条被打断的夜里死法。
//
// 用法和 play-scripts.mjs 一模一样：scripts() + runScript()。旧文件不要动。

import { ANSWERS, NEED, runScript as runScriptV1, scripts as legacyScripts } from './play-scripts.mjs';

export { ANSWERS, NEED };
export const runScript = runScriptV1;

const C = ['step', 'token_b', 'rush', 'step'];   // 干净取符：挪一步、把令牌给中庭守卫乙、冲到门口
const R = ['step', 'token_b', 'rush', 'wait', 'step']; // R 组合：到卧内门口先等一拍，等如姬定神
// R 去掉门口那一拍：后面九步都撞在不开的门上，第 12 拍天亮（夜里一共 12 步上限）
const R2 = ['step', 'token_b', 'rush', ...Array(9).fill('step')];
const DAWN = Array(12).fill('wait');              // 一直不动，等到换班

/**
 * MECHANICS.md §5 的路线表（外加 R 的反面对照）。
 * expect 是断言用的：ending 与夜里的旗标。
 */
export const ROUTES = [
  { id: 'A/lives-1', dir: 'A', daliang: 'yi', yimen: 'back', night: C, ye: 'en', why: '义打动侯嬴 → 后门取符 → 高身份替公子说话', expect: { ending: 'jinbi-lives', night: 'clean' } },
  { id: 'A/lives-2', dir: 'A', daliang: 'yi', yimen: 'hou', night: C, ye: 'li', why: '义打动侯嬴 → 说利（兵权）让晋鄙交兵', expect: { ending: 'jinbi-lives', night: 'clean' } },
  { id: 'A/lives-R', dir: 'A', daliang: 'yi', yimen: 'wait', night: R, ye: 'en', why: 'R：侯嬴没被说动（如姬犹豫），门口多等一拍照样取到符', expect: { ending: 'jinbi-lives', night: 'clean' } },
  { id: 'A/history-1', dir: 'A', daliang: 'yi', yimen: 'back', night: C, ye: 'yi', why: '讲军令压晋鄙：他反噬，史书', expect: { ending: 'history', night: 'clean' } },
  { id: 'A/history-2', dir: 'A', daliang: 'wait', yimen: 'hou', night: C, ye: 'en', why: '没在大梁攒下身份，恩也不够重（低站位）', expect: { ending: 'history', night: 'clean' } },
  { id: 'A/broken-1', dir: 'A', daliang: 'yi', yimen: 'fear', night: ['step', 'step'], ye: 'wait', why: '吓侯嬴：如姬犹豫，中庭被守卫乙看见', expect: { ending: 'broken', night: 'seen' } },
  { id: 'A/broken-2', dir: 'A', daliang: 'yi', yimen: 'wait', night: DAWN, ye: 'wait', why: '什么都不说也不动：等到天亮换班撞见', expect: { ending: 'broken', night: 'seen' } },
  { id: 'A/broken-3', dir: 'A', daliang: 'yi', yimen: 'back', night: ['token_a'], ye: 'wait', why: '令牌递给提灯的守卫甲：当场被拦住', expect: { ending: 'broken', night: 'seen' } },
  { id: 'A/broken-R2', dir: 'A', daliang: 'yi', yimen: 'wait', night: R2, ye: 'wait', why: 'R 去掉门口那一拍：低信任时同一串走法直接天亮（与 A/lives-R 成对）', expect: { ending: 'broken', night: 'seen' } },
  { id: 'A/high-standing', dir: 'A', daliang: 'yi', yimen: 'hou', night: C, ye: 'en', why: '高身份对照（与 A/history-2 只差大梁那一手）', expect: { ending: 'jinbi-lives', night: 'clean' } },
  { id: 'B/lives-2', dir: 'B', daliang: 'yi', yimen: 'hou', night: C, ye: 'li', why: '换导演（单导放开）同一条路仍然通', expect: { ending: 'jinbi-lives', night: 'clean' } },
  { id: 'B/history-2', dir: 'B', daliang: 'wait', yimen: 'hou', night: C, ye: 'en', why: '换导演：低身份仍然只是史书', expect: { ending: 'history', night: 'clean' } },
];

const stepsOf = (r) => [`c:${r.daliang}`, `c:${r.yimen}`, ...r.night.map((m) => `c:${m}`), `c:${r.ye}`, 'c:seal', 'c:report'];

/** 680 个旧脚本 + 路线脚本。id 全局唯一（旧脚本的 id 形如 A/yi/back/clean/yi）。 */
export function scripts() {
  const out = legacyScripts().map((s) => ({ ...s, group: 'legacy' }));
  for (const r of ROUTES) out.push({ id: r.id, dir: r.dir, steps: stepsOf(r), group: 'route', route: r.id, why: r.why });
  return out;
}

/** 只保留真的走得通的合法脚本（旧脚本里有 162 条是故意撞闸门的，不进这张表）。 */
export function legalScripts() {
  return scripts().filter((s) => s.group === 'route');
}
