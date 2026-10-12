#!/usr/bin/env node
// t51：坐在取符之夜不动，量「二十秒里能看见几件事」。
//
// 只用公共入口：createSession / session.meet / createPlay(session,{living:'director',seed}) /
// begin / next / choose（只用场景自己给出的选项）→ 到 night 之后只 advance，不再输入。
// 读镜只用 play.life.view.read(sceneId)（＝createLifeView.read）与 play.lifeTrace(seq)，
// 不手派刺激、不调 watch/ask、不碰心智，也不拿 choose('wait') 冒充空等。
//
// 三类数字分开算，免得把「账本长了」当成「玩家看见了新东西」：
//   故事片段  actors[].last 里 source=perception 的条目，按 谁/停层/动作 去重 → 玩家能说出口的事
//   证据片段  读镜里出现过的全部条目，按 来源/签名/seq/path 去重 → 每条能不能回到账本
//   账本行数  进之夜之后新增的 world.pulse / actor.react / actor.act
//
// 用法：
//   node tools/living-probe.mjs                 # 数字表打到 stdout
//   node tools/living-probe.mjs --json          # 同一份数据以 JSON 打到 stdout
//   node tools/living-probe.mjs --seeds 1,2,3   # 只跑这几个种子
// 退出码：任一契约检查 FAIL 时为 1（这是测量工具，不是仓库测试；失败读数照样全部打印）。
import { createSession } from '../shared/engine/session.js';
import { createPlay } from '../shared/engine/play.js';
import { ANSWERS, NEED } from '../shared/engine/simulate.js';
import { pathToFileURL } from 'node:url';

export const SEEDS = [1, 2, 3, 7, 11];
export const DURATIONS = [0, 10, 20, 40];
/** 两条只用公共选项走到之夜的路线：低托付（两处都等）与高托付（义 + 折返） */
export const ROUTES = { low: ['wait', 'wait'], high: ['yi', 'back'] };
const DIRECTORS = ['A', 'B'];
const DIRECTOR_NAME = { A: '陆导', B: '单导' };
const STOP_LAYER = { module: '按老习惯', unit: '手已经动了', mind: '心里停住' };
const clone = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));
const storyKey = (f) => JSON.stringify([f.person, f.layer, f.action ?? f.object]);
const evidenceKey = (f) => JSON.stringify([f.source, f.person, f.signature ?? f.object, f.seq, f.path]);

/** 走到取符之夜：每一步都点场景自己给的选项，不点名不存在的动作 */
export function enterNight(director, seed, route, opts = { living: 'director' }) {
  const session = createSession();
  session.meet(ANSWERS[director], NEED);
  const play = createPlay(session, { seed, ...opts });
  play.begin();
  play.next();
  for (const id of ROUTES[route]) {
    const result = play.choose(id);
    if (!result?.r) throw new Error(`场景没有给出这个选项：${director}/${route}/${id}`);
    play.next();
  }
  if (play.view().act !== 'night') throw new Error('公共入口没有进入取符之夜');
  return { session, play };
}

/** 机会与期限：场景控制器里的真状态，和前台秒数不是一回事 */
function opportunity(session, play) {
  const world = session.state.play.kernel.worlds.night;
  const night = play.state().night;
  const ruji = play.life.view.read('night').actors.find((a) => a.id === 'ruji') || {};
  return clone({
    days: play.state().days,
    flags: world.flags,
    step: night.step,
    pos: night.pos,
    lantern: night.lantern,
    token: night.token,
    seen: night.seen,
    done: night.done,
    rujiTrust: ruji.trust ?? null,
    ended: play.life.state().ended,
    end: play.life.state().endedOutcome?.outcome ?? null,
  });
}

/** 一条读镜片段能不能回到账本：有 seq 就要能解到对应记录，并把 cause 走到头 */
function audit(fragment, session, play) {
  const seq = fragment.seq;
  const errors = [];
  if (!Number.isInteger(seq) || seq <= 0) return { seq: seq ?? null, hasSeq: false, ok: false, errors: ['no-seq'] };
  const entry = session.ledger.get(seq);
  if (!entry) return { seq, hasSeq: true, ok: false, errors: ['missing-entry'] };
  if (!fragment.path) errors.push('missing-path');
  if (fragment.source === 'perception') {
    if (entry.kind !== 'actor.react' || entry.from !== `actor:${fragment.person}`) errors.push('not-this-actors-reaction');
    if (entry.payload?.action !== fragment.object) errors.push('action-mismatch');
    const trace = play.lifeTrace(seq);
    if (!trace || trace.person !== fragment.person || trace.action !== fragment.object) errors.push('no-real-trace');
  }
  const stack = [entry];
  const visited = new Set();
  while (stack.length) {
    const e = stack.pop();
    if (visited.has(e.seq)) continue;
    visited.add(e.seq);
    for (const cause of e.cause || []) {
      const prior = session.ledger.get(cause);
      if (!prior || cause >= e.seq) errors.push(`broken-cause@${e.seq}->${cause}`);
      else stack.push(prior);
    }
  }
  return { seq, hasSeq: true, ok: errors.length === 0, errors };
}

/** 一次空等：每秒推进一拍，按 0/10/20/40 拍截读数 */
export function probeCase(director, seed, route = 'low') {
  const { session, play } = enterNight(director, seed, route);
  const ledgerAtEntry = session.ledger.size;
  const initial = opportunity(session, play);
  const stories = new Map();
  const evidence = new Map();
  const snapshots = [];
  const remember = (fragment, second) => {
    const key = evidenceKey(fragment);
    if (evidence.has(key)) return evidence.get(key);
    const row = { ...clone(fragment), ...audit(fragment, session, play), firstSeen: second };
    evidence.set(key, row);
    return row;
  };
  const deadlineChanges = [];
  let previousOpportunity = initial;
  let readOnly = true;
  let deadlineFirstChange = null;

  for (let second = 0; second <= DURATIONS[DURATIONS.length - 1]; second += 1) {
    if (second) play.advance({ toTick: second });
    const before = JSON.stringify(session.save());
    const mirror = play.life.view.read('night'); // createLifeView.read：纯读
    readOnly = readOnly && before === JSON.stringify(session.save());

    const planFragment = mirror.policy
      ? { source: 'plan', person: mirror.director?.id ?? null, layer: 'plan', object: mirror.policy.why, seq: mirror.policy.sourceSeq ?? null, signature: mirror.policy.reasonId ?? null, path: mirror.policy.path }
      : null;
    if (planFragment) remember(planFragment, second);
    for (const actor of mirror.actors) {
      for (const fragment of actor.thinking || []) {
        const row = remember(fragment, second);
        if (fragment.source === 'perception' && fragment.object && !stories.has(storyKey(fragment))) stories.set(storyKey(fragment), row);
      }
    }
    for (const experience of mirror.experiences || []) remember(experience, second);

    const current = opportunity(session, play);
    const changed = JSON.stringify(initial) !== JSON.stringify(current);
    const movedNow = JSON.stringify(previousOpportunity) !== JSON.stringify(current);
    if (movedNow) {
      const keys = Object.keys(current).filter((k) => JSON.stringify(previousOpportunity[k]) !== JSON.stringify(current[k]));
      deadlineChanges.push({ second, keys, now: Object.fromEntries(keys.map((k) => [k, current[k]])) });
    }
    if (changed && deadlineFirstChange === null) deadlineFirstChange = second;
    previousOpportunity = current;
    if (!DURATIONS.includes(second)) continue;

    const rows = session.ledger.entries.slice(ledgerAtEntry);
    const at = (kind) => rows.filter((e) => e.kind === kind).length;
    const acts = rows.filter((e) => e.kind === 'actor.act');
    const kindCounts = rows.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] || 0) + 1 }), {});
    const reactionPayloads = new Set(rows.filter((e) => e.kind === 'actor.react').map((e) => `${e.from}|${e.payload?.action}`));
    const slots = mirror.actors.flatMap((a) => (a.memory || []).map((m) => `${a.id}|${m.object}`));
    const traceMax = Math.max(0, ...mirror.actors.flatMap((a) => (a.memory || []).map((m) => m.trace || 0)));
    const actErrors = acts.filter((entry) => {
      if (!String(entry.from).startsWith('actor:') || entry.from === 'actor:player') return true;
      const reaction = (entry.cause || []).map((seq) => session.ledger.get(seq)).find((e) => e?.kind === 'actor.react' && e.from === entry.from);
      return !reaction;
    }).map((e) => e.seq);
    const evidenceRows = [...evidence.values()];
    const storyRows = [...stories.values()];
    snapshots.push({
      director, directorName: DIRECTOR_NAME[director], route, seed, requestedSeconds: second,
      lifeTick: mirror.tick,
      storyFragments: storyRows.length,
      storyPeople: new Set(storyRows.map((f) => f.person)).size,
      distinctStoryTexts: new Set(storyRows.map((f) => f.object)).size,
      storyTraced: storyRows.filter((f) => f.ok).length,
      storyUntraced: storyRows.filter((f) => !f.ok),
      deviceFragments: evidenceRows.length,
      deviceTraced: evidenceRows.filter((f) => f.ok).length,
      deviceNoSeq: evidenceRows.filter((f) => !f.hasSeq).length,
      deviceBroken: evidenceRows.filter((f) => f.hasSeq && !f.ok).length,
      noSeqSources: [...new Set(evidenceRows.filter((f) => !f.hasSeq).map((f) => `${f.source}|${String(f.path || '').split('.').slice(0, 3).join('.')}`))],
      noSeqSample: evidenceRows.filter((f) => !f.hasSeq).slice(0, 3).map((f) => ({ person: f.person, object: f.object, source: f.source, path: f.path })),
      ledgerRows: rows.length,
      pulses: at('world.pulse'),
      reactions: at('actor.react'),
      spontaneousActs: acts.length,
      actErrors,
      kindCounts,
      distinctReactionPayloads: reactionPayloads.size,
      memorySlots: slots.length,
      memorySlotsDistinct: new Set(slots).size,
      memoryTraceMax: traceMax,
      readOnly,
      waitForPlayer: mirror.policy?.waitForPlayer ?? null,
      policySourceSeq: mirror.policy?.sourceSeq ?? null,
      autonomyVerbs: mirror.policy?.autonomy?.verbs ?? [],
      cadenceTicks: mirror.policy?.cadenceTicks ?? null,
      opportunityInitial: initial,
      opportunity: current,
      deadlineFrozen: !changed,
      deadlineFirstChange,
      deadlineChanges: clone(deadlineChanges),
      ended: play.life.state().ended,
      end: play.life.state().endedOutcome?.outcome ?? null,
      stories: storyRows,
      directorCase: planFragment ? remember(planFragment, second) : null,
    });
  }
  return snapshots;
}

export function runProbe(seeds = SEEDS) {
  const rows = [];
  const controls = [];
  for (const director of DIRECTORS) for (const route of Object.keys(ROUTES)) for (const seed of seeds) {
    rows.push(...probeCase(director, seed, route));
    // 生活关闭的对照：同一条路只去掉 living，advance 不该存在、存档不该动
    const { session, play } = enterNight(director, seed, route, {}); // 同样的路，不要 living
    const saved = JSON.stringify(session.save());
    const advanceResult = typeof play.advance === 'function' ? play.advance({ toTick: 40 }) : null;
    controls.push({ director, route, seed, hasLife: !!play.life, unchanged: saved === JSON.stringify(session.save()), advanceResult: clone(advanceResult) });
  }
  const at20 = rows.filter((r) => r.requestedSeconds === 20);
  const sig = (r) => JSON.stringify([r.storyFragments, r.storyPeople, r.spontaneousActs, r.pulses, r.reactions, r.ended, r.opportunity]);
  const low20 = (d) => at20.filter((r) => r.director === d && r.route === 'low');
  const checks = {
    '二十秒至少两件人物自己的事': at20.every((r) => r.storyFragments >= 2 && r.storyPeople >= 2),
    '故事片段全部能追回账本': at20.every((r) => r.storyTraced === r.storyFragments),
    '读镜是纯读（前后存档逐字节相同）': rows.every((r) => r.readOnly),
    '自发行动 from 是演员且 cause 指向自己的反应': rows.every((r) => r.actErrors.length === 0),
    '生活关闭时同一路一笔不变': controls.every((r) => !r.hasLife && r.unchanged && r.advanceResult === null),
    '同种子同结果': JSON.stringify(probeCase('A', seeds[0], 'low')) === JSON.stringify(probeCase('A', seeds[0], 'low')),
  };
  const observations = {
    '等你的导演（waitForPlayer）空等二十秒机会与期限不变': at20.filter((r) => r.waitForPlayer).every((r) => r.deadlineFrozen),
    '空等四十秒还没把这一夜收掉': rows.filter((r) => r.requestedSeconds === 40).every((r) => !r.ended),
    '两位导演二十秒的读数不同': new Set(at20.filter((r) => r.route === 'low').map(sig)).size > 1,
    '换种子会改变二十秒的读数': new Set(low20('A').map(sig)).size > 1,
    '读镜里每个片段都带账本 seq': at20.every((r) => r.deviceNoSeq === 0),
    '两位导演都在二十秒里给出至少一件自发行动': at20.every((r) => r.spontaneousActs >= 1),
    '高低托付两条路二十秒看到的东西相同': DIRECTORS.every((d) => {
      const pair = at20.filter((r) => r.director === d);
      const seen = new Set(pair.map((r) => JSON.stringify([r.storyFragments, r.storyPeople, r.spontaneousActs, r.pulses, r.reactions, r.ended])));
      return pair.length >= 2 && seen.size === 1;
    }),
    '相同处境没有反复造新记忆槽': at20.every((r) => r.memorySlots === r.memorySlotsDistinct),
  };
  const seedDistinctAt20 = new Set(low20('A').map(sig)).size;
  return { seeds, durations: DURATIONS, routes: ROUTES, rows, controls, checks, observations, seedDistinctAt20 };
}

const span = (values) => {
  const min = Math.min(...values); const max = Math.max(...values);
  return min === max ? String(min) : `${min}–${max}`;
};

export function formatProbe(report) {
  const lines = [
    `取符之夜空等探针：${report.seeds.length} 个种子 × 2 位导演 × 2 条托付路线，各空等 ${report.durations.join('/')} 秒`,
    'low＝大梁 wait、夷门 wait（低托付）；high＝大梁 yi、夷门 back（高托付）；进之夜后不再有任何输入。',
    '故事片段＝读镜 actors[].last 里 谁/停层/动作 去重（玩家能说出口的事）；「话」＝去重后不同的台词句数。',
    '亮度或 seq 刷新不算新事；同一个人换停层（老习惯→手已经动了）算两件。',
    '证据＝读镜出现过的全部条目按 来源/签名/seq/path 去重；账本行＝进之夜后新增的世界脉搏与反应。',
    '期限＝场景控制器里的 pos/step/lantern/token/seen/done、天数、旗标与结局（任务里那条「空等 tick 不变」的可测形式）。',
    '',
    '| 导演/托付 | 空等秒 | 生活拍 | 故事片段/人数/话 | 自发act | 账本行(脉搏/反应) | 证据可追 | 期限未变 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const director of DIRECTORS) for (const route of Object.keys(report.routes)) for (const second of report.durations) {
    const g = report.rows.filter((r) => r.director === director && r.route === route && r.requestedSeconds === second);
    if (!g.length) continue;
    const frozen = g.every((r) => r.deadlineFrozen);
    const first = Math.min(...g.map((r) => r.deadlineFirstChange ?? Infinity));
    const ended = g.some((r) => r.ended);
    lines.push(`| ${DIRECTOR_NAME[director]}/${route} | ${second} | ${span(g.map((r) => r.lifeTick))} | ${span(g.map((r) => r.storyFragments))}/${span(g.map((r) => r.storyPeople))}/${span(g.map((r) => r.distinctStoryTexts))} | ${span(g.map((r) => r.spontaneousActs))} | ${span(g.map((r) => r.ledgerRows))}(${span(g.map((r) => r.pulses))}/${span(g.map((r) => r.reactions))}) | ${span(g.map((r) => r.deviceTraced))}/${span(g.map((r) => r.deviceFragments))} | ${frozen ? '是' : `否（第${first}秒起变${ended ? '，已收场' : ''}）`} |`);
  }
  const at20 = report.rows.filter((r) => r.requestedSeconds === 20);
  lines.push('',
    `同种子同结果：${report.checks['同种子同结果'] ? '是' : '否'}；陆导/low 二十秒读数的不同签名数（${report.seeds.length} 个种子）：${report.seedDistinctAt20}`,
    `证据片段里没有 seq 的：${span(at20.map((r) => r.deviceNoSeq))} 条/种子；有 seq 却解不开的：${span(at20.map((r) => r.deviceBroken))} 条。`,
    `生活拍按定义会走（二十秒＝${span(at20.map((r) => r.lifeTick))} 拍；停留满八拍才有导师笔记），字面 tick 不动不成立，上表「期限未变」栏报的是机会与期限有没有被空等吃掉。`,
    '', ...Object.entries(report.checks).map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} ${name}`),
    ...Object.entries(report.observations).map(([name, ok]) => `观察${ok ? '有' : '无'}：${name}`));

  for (const director of DIRECTORS) {
    const row = report.rows.find((r) => r.director === director && r.route === 'low' && r.requestedSeconds === 20);
    lines.push('', `${DIRECTOR_NAME[director]}（waitForPlayer=${row.waitForPlayer}，verbs=${JSON.stringify(row.autonomyVerbs)}，每 ${row.cadenceTicks} 拍检查）种子 ${row.seed} 空等二十秒，能说出口的事：`);
    for (const f of row.stories) lines.push(`  · ${f.person} ${STOP_LAYER[f.layer] || f.layer}：「${f.object}」 账本 seq=${f.seq}（第 ${f.firstSeen} 秒第一次看见，可追=${f.ok ? '是' : `否 ${f.errors.join(',')}`}）`);
  }
  const d20 = report.rows.find((r) => r.director === 'A' && r.route === 'low' && r.requestedSeconds === 20);
  if (d20) {
    lines.push('', `二十秒账本明细（${d20.directorName}/${d20.route}，种子 ${d20.seed}）：${JSON.stringify(d20.kindCounts)}`,
      `  其中 actor.react ${d20.kindCounts['actor.react'] || 0} 行，去重后只有 ${d20.distinctReactionPayloads} 种（同样是「谁+同一动作」反复落账）；`,
      `  读镜里的记忆槽 ${d20.memorySlots} 个、去重后 ${d20.memorySlotsDistinct} 个，单个槽最多被触到 trace=${d20.memoryTraceMax}（槽不新增，只涨计数）。`);
  }
  const detail = report.rows.find((r) => r.director === 'A' && r.route === 'low' && r.requestedSeconds === 40);
  if (detail && detail.deadlineChanges.length) {
    lines.push('', `空等里机会/期限真正动过的拍（${detail.directorName}/${detail.route}，种子 ${detail.seed}；与上一拍比）：`);
    for (const c of detail.deadlineChanges) lines.push(`  第 ${c.second} 秒：${c.keys.join('、')} → ${JSON.stringify(c.now)}`);
    lines.push(`  四十秒请求后生活拍停在 ${detail.lifeTick}（收场后 advance 不再推进）。`);
  }
  const untraced = [...new Map(report.rows.flatMap((r) => r.storyUntraced).map((f) => [evidenceKey(f), f])).values()];
  lines.push('', untraced.length ? `追不到账本的故事片段：${untraced.map((f) => `${f.person}/${f.object}（${f.errors.join(',')}）`).join('；')}` : '追不到账本的故事片段：无');
  const noSeq20 = report.rows.find((r) => r.requestedSeconds === 20 && r.deviceNoSeq);
  if (noSeq20) {
    lines.push(`无 seq 的条目来源（二十秒，${noSeq20.directorName}/${noSeq20.route}）：${noSeq20.noSeqSources.join('，')}`);
    for (const s of noSeq20.noSeqSample) lines.push(`  · ${s.person}：「${s.object}」 source=${s.source} path=${s.path}`);
  }
  lines.push('',
    '读镜里无 seq 的条目来自心智自己的记忆槽（source=memory，path 指向 minds.<人>.state.memory）与经历索引的投影；这些条目按设计只带派生量，没有账本 seq。',
    '',
    `可复验命令：node tools/living-probe.mjs --seeds ${report.seeds.join(',')}`,
    `单种子细看：node tools/living-probe.mjs --seeds ${report.seeds[0]} --json`,
    '范围：只量 Node 侧逻辑拍与 createLifeView.read；没有验证浏览器「前台秒数 → toTick」接线、身段动画，也没有跑仓库测试（AGENT.md：子 Agent 不 build/test）。',
  );
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--seeds');
  const seeds = at < 0 ? SEEDS : (args[at + 1] || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!seeds.length) throw new Error('--seeds 需要至少一个种子');
  const report = runProbe(seeds);
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatProbe(report));
  if (Object.values(report.checks).some((ok) => !ok)) process.exitCode = 1;
}
