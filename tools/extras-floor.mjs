// 复验两个新组合（大梁·被偷听 / 围城·押粮）的地板：node tools/extras-floor.mjs
// 加 --runs 看每一局（四种玩家 × 两位导演 × 五个种子 + 每个结局的见证重放）的
// {ending, seconds, path, stuck}。只读，不写任何文件。
//
// 看三件事：
//   1) 四种玩家走两个新组合都不卡（stuck = 0）
//   2) 每个结局至少一条路走到（枚举给出见证路径，再原样重放一遍确认结局对得上）
//   3) 任何局面都留着一个能推进时间的选项（stalls = 0）：不会出现「只会被拒、又永远不耗时间」的死循环
//      —— 押粮里粮袋出手之后再点借粮者就是被拒且不耗时间（refused 那一列数出这种局面有多少个）
import { createSession } from '../shared/engine/session.js';
import { floorChecks, simulateExtra, ANSWERS, PERSONAS } from '../shared/engine/simulate.js';
import { EXTRA_IDS } from '../shared/engine/play.js';

const showRuns = process.argv.includes('--runs');
const f = floorChecks(createSession);
const personaIds = Object.keys(PERSONAS);

const pad = (s, n) => String(s).padEnd(n, ' ');

console.log('两个新组合的地板（进场走 createPlay(session).enterExtra(id)）');
console.log('');

let allOk = true;
for (const id of EXTRA_IDS) {
  const x = f.extras[id];
  const ended = Object.entries(x.endings).map(([e, n]) => `${e} ${n}`).join(' · ');
  allOk = allOk && x.ok;
  console.log(`${pad(id, 20)} ok=${pad(x.ok, 6)} 局数 ${pad(x.runs, 3)}（4 玩家 × 2 导演 × 5 种子 + ${x.runs - 40} 条见证重放）`);
  console.log(`${' '.repeat(20)} 走到的结局：${ended}`);
  console.log(`${' '.repeat(20)} 枚举可达到：${x.reachable.join(' , ')}   缺的：${x.missing.length ? x.missing.join(',') : '（无）'}`);
  console.log(`${' '.repeat(20)} 被拒局面 ${x.refused}（粮袋出手后再点借粮者那种局面）· 无进展局面 ${x.stalls.length} · 秒数 ${x.seconds.min}–${x.seconds.max}`);
}

console.log('');
for (const dir of ['A', 'B']) {
  for (const id of EXTRA_IDS) {
    const line = personaIds.map((p) => {
      const r = simulateExtra(createSession, id, { answers: ANSWERS[dir], persona: p, seed: 1 });
      return `${p}→${r.ending || (r.stuck ? 'stuck' : '—')}`;
    }).join(' · ');
    console.log(`导演 ${dir} · ${pad(id, 20)} 种子 1：${line}`);
  }
}

if (showRuns) {
  console.log('\n每一局：');
  for (const dir of ['A', 'B']) {
    for (const id of EXTRA_IDS) {
      for (const persona of personaIds) {
        for (const seed of [1, 2, 3, 7, 11]) {
          const r = simulateExtra(createSession, id, { answers: ANSWERS[dir], persona, seed });
          console.log(`  ${dir}/${id}/${persona}/种子${seed} → ${r.ending} ${r.seconds}s stuck=${r.stuck} ${r.path.join('>')}`);
        }
      }
    }
  }
}

console.log('');
console.log(`整局分幕：deadEnds ${f.deadEnds.length} · endings ${JSON.stringify(f.endings)} · seconds ${f.seconds.min}–${f.seconds.max} · sameAppealWinsAll ${f.sameAppealWinsAll}`);
console.log(`新组合死路 ${f.deadEnds.filter((d) => d.scene).length} · 无进展局面 ${f.stalls.length}`);
console.log(`地板：${allOk && f.ok ? 'PASS' : 'FAIL'}`);
process.exit(allOk && f.ok ? 0 : 1);
