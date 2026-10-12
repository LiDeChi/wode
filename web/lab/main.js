// 科研台：把 runner.js 跑出来的每一局，变成案上一颗滚进陶罐的豆子。
// 这里只做装配与账目；机器在 rig.js，豆子在 beans.js，人在 figures.js。
import * as THREE from 'three';
import { BASE, VARIABLES } from './world.js';
import { PERSONAS } from '/shared/engine/simulate.js';
import { createBench } from './scene.js';
import { setPlateAnisotropy } from './labels.js';
import { buildRig } from './rig.js';
import { createBeads, TRACK, ENDINGS, SLOT_ENDING, ACT_ROW, lanesOf, slotOf } from './beans.js';
import { createFigures, createProbeTiles, FIGURE_BY_ID } from './figures.js';
import { createSlip } from './slip.js';
import { createScroll } from './scroll.js';
import { createIncense } from './incense.js';
import { createStages } from './stages.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dev = new URLSearchParams(location.search).get('dev') === '1';
const pct = v => `${Math.round(v * 100)}%`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ACTS = { daliang: '信陵君府', yimen: '夷门', night: '取符之夜', ye: '邺城', granary: '暮色粮仓' };
const personName = id => FIGURE_BY_ID[id]?.name || id;
// 玩家有多少种，由 simulate.js 说了算——那边加一位，这里就多一位。
const PERSONA_KEYS = Object.keys(PERSONAS);
const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

/* ---------------- 舞台：一台机器 ---------------- */
const bench = createBench($('bench'));
setPlateAnisotropy(bench.renderer.capabilities.getMaxAnisotropy());
const rig = buildRig(bench, { variables: VARIABLES });
// 手机窄屏上，案沿那几件会盖住身后的铜钮：换了宽度就换一套摆位。
bench.onTallChange(on => rig.setTallLayout(on));
const beads = createBeads(rig.beanRoot, { speed: 1 });
const figures = createFigures(bench, { onPick: node => showPerson(node.id), onLamp: () => nextMentor() });
const tiles = createProbeTiles(bench, { onPick: appeal => runProbe(appeal), onAsk: () => stages?.entry('ask') });
const slip = createSlip(bench, { onSeal: sealLink });
const scroll = createScroll(bench, { onFilm: () => toFilm() });
const incense = createIncense(bench, { onPick: () => readColumn(baseline ? 'before' : 'after') });
// 竖屏上有两种看法：wide 全景（整台机器装得下）/ knobs·pots·ask 凑近看一件实物（见 stages.js）。
// 桌面不走这套，屏幕上还是原来那台镜头。
const stages = createStages(bench, rig, {
  figures: tiles,
  onStage: name => {
    if (name === 'knobs') setTop('凑近看这一排铜钮：拨一枚，再拉闸。');
    else if (name === 'pots') setTop('凑近看这几只陶罐：点一只，看一粒豆子怎么走的。');
    else if (name === 'ask') setTop('四张牌摆开了：点一张，等于向五个人各讲一次同一种话。');
  },
});
VARIABLES.forEach(v => rig.setKnob(v.id, v.base));
$('debug').hidden = !dev;

/* ---------------- 账目：worker 里跑 runner.js ---------------- */
let settings = { ...BASE }, baseline = null, changed = null, active = null, busy = false, director = 'lu';
const worker = new Worker('/lab/runner.js', { type: 'module' });
let request = 0;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  data.error ? p.reject(new Error(data.error)) : p.resolve(data);
};
worker.onerror = e => { for (const p of pending.values()) p.reject(new Error(e.message)); pending.clear(); };
const measure = config => new Promise((resolve, reject) => {
  const id = ++request;
  pending.set(id, { resolve, reject });
  worker.postMessage({ id, ...config });
});

/* ---------------- 屏幕上的刻字 ---------------- */
/* 屏幕上常驻的字只留一行：这一行说现在该看什么。
   数字都长在实物上——罐里的豆子、罐前的木签、两炷香、人偶点头；
   一份整账要么点开陶罐/点灯让它从竹简上滑出来，要么 ?dev=1。 */
const say = html => { const el = $('top'); if (el.innerHTML !== html) el.innerHTML = html; };
/* 这一行由两半拼成：主句说现在该看什么，后面跟一句更小的话说刚才发生了什么。
   两处各改各的半句，屏幕上始终只有这一行。 */
let mainLine = '', hintLine = '';
const paintLine = () => say(mainLine + (hintLine ? `<br><small>${hintLine}</small>` : ''));
const setTop = html => { mainLine = html; paintLine(); };
const setHint = text => { hintLine = esc(text); paintLine(); };
/* 凑近读竹简时，屏幕上这一行也让开（竹简自己写着这场仗怎么打的）。
   CSS 里 #top.away 把它淡掉，竹简收起来再淡回来。 */
const lineAway = on => $('top').classList.toggle('away', on);
/* 导师的话不是网页上的浮动字，是他灯下那块牌：内容从账本里真读。
   读法照 film3 在 hub 里的：建一个会话，让他照这位导演的口味走一遍「见面」，
   再把账本里 from=mentor 且带 said 的原话挑出来——一句都不是这里编的。 */
let mentorLines = [], mentorAt = 0;
async function readMentor() {
  try {
    const [sessionMod, formatMod] = await Promise.all([
      import('/shared/engine/session.js'),
      import('/film/format.js'),
    ]);
    const inp = formatMod.directorInput(director);
    const session = sessionMod.createSession();
    session.meet(inp.answers, inp.need);
    mentorLines = session.ledger.entries.filter(e => e.from === 'mentor' && e.said).map(e => e.said);
  } catch (e) {
    mentorLines = [];
    if (dev) console.warn('导师的话没从账本里读到', e);
  }
  mentorAt = 0;
  paintMentor();
}
function paintMentor() {
  figures.say(wrapLine(mentorLines[mentorAt] || '导师还在想…', 7).slice(0, 7));
}
function nextMentor() {
  if (!mentorLines.length) return;
  mentorAt = (mentorAt + 1) % mentorLines.length;
  paintMentor();
}
/* 逐幕账不落在网页上：它写在场景里的竹简上（scroll.js）。 */

function distribution(result) {
  const counts = Object.fromEntries(Object.keys(ENDINGS).map(k => [k, 0]));
  for (const r of result.runs) counts[r.stuck ? 'stuck' : r.ending]++;
  return counts;
}
/* 竹简一行写不了太多字：长句按「· / ：」断开，凑成不超过 max 个字一行，
   字才排得大，凑近看得清。 */
function wrapLine(text, max = 16) {
  const parts = String(text).split(/(?<=[·：，])/);
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + p).length > max) { out.push(cur); cur = ''; }
    cur += p;
  }
  if (cur) out.push(cur);
  // 行尾不留下孤零零的顿号
  return out.map(s => s.replace(/[·，]$/, '').trim()).filter(Boolean);
}
const wrapLines = (lines, max) => lines.flatMap(l => wrapLine(l, max));

function columnLines(result, column) {
  const counts = distribution(result), total = result.runs.length;
  const avg = result.runs.reduce((a, r) => a + r.seconds, 0) / total;
  const coverage = Math.max(...result.probe.map(p => p.coverage));
  const personas = Object.entries(PERSONAS).map(([k, p]) => {
    const rs = result.runs.filter(r => r.persona === k);
    return `${p.label} ${pct(rs.filter(r => r.ending === 'jinbi-lives' && !r.stuck).length / rs.length)}`;
  });
  const panel = VARIABLES.filter(v => result.settings[v.id] !== BASE[v.id])
    .map(v => `${v.label} ${result.settings[v.id].toFixed(2)}`).join(' · ') || '原世界的设定';
  return wrapLines([
    `${column === 'before' ? '改前' : '改后'} · ${result.director === 'lu' ? '陆导' : '单导'} · 每种玩家 ${result.n} 局 · 共 ${total} 局`,
    panel,
    `平均戏内 ${(avg / 60).toFixed(1)} 分 · 同手段最高覆盖 ${pct(coverage)}`,
    `晋鄙生还：${personas.join(' · ')}`,
    Object.entries(counts).map(([k, n]) => `${ENDINGS[k].label} ${n}`).join(' · '),
  ]);
}

/* ---------------- 每帧：豆子走路、槽底留下走痕 ---------------- */
let wearClock = 0;
bench.addUpdater((dt, clock) => {
  beads.update(dt, clock);
  for (const bean of beads.beans) {
    if (bean.phase !== 'falling') continue;
    if (bean.row === undefined) bean.row = 0;
    while (bean.row < TRACK.rows && bean.mesh.position.y < TRACK.rowY[bean.row]) {
      rig.flashRow(bean.row, '#c98b4a', .55);
      // 这一层用了哪种话、对面点没点头——人偶替他答一次。
      const step = stepAtRow(bean.run, bean.row);
      if (step) figures.react(step.personId, step.accepted === true);
      bean.row++;
    }
  }
  // 走痕：豆子走过哪条岔路，那条槽底就染上哪只罐的釉色。落定了才算数，
  // 所以痕迹是一点点长出来的，不是一批刷上去的。
  wearClock += dt;
  if (wearClock > .25) { wearClock = 0; paintWear(); }
});

/* 把已经落定的豆子按「在每一幕拐了哪个弯」数一遍，交给机架去染槽底。
   半空中的豆子不算；豆子被倒回斗里时它还没落定，痕迹自然还没长。 */
function paintWear() {
  const counts = {}, totals = { before: 0, after: 0 };
  for (const bean of beads.beans) {
    if (bean.phase !== 'rest') continue;
    const lanes = lanesOf(bean.run);
    totals[bean.column]++;
    for (let row = 0; row < TRACK.rows; row++) {
      const byLane = counts[row] || (counts[row] = {});
      const cell = byLane[lanes[row]] || (byLane[lanes[row]] = { before: 0, after: 0 });
      cell[bean.column]++;
    }
  }
  rig.setWear(counts, totals);
  return counts;
}

// 一局在某一层用了什么话、对面是谁、点没点头。豆子滚过一层时问一次。
const rowCache = new WeakMap();
function stepAtRow(run, row) {
  let arr = rowCache.get(run);
  if (!arr) {
    arr = new Array(TRACK.rows).fill(null);
    for (const t of run.trail) {
      const r = ACT_ROW[t.act];
      if (r === undefined || !t.appeal || !t.personId || arr[r]) continue;
      if (t.accepted === null || t.accepted === undefined) continue;
      arr[r] = t;
    }
    rowCache.set(run, arr);
  }
  return arr[row];
}

/* 说明不再是浮在画面上的框：铜钮前面的木牌翻过来就写着它管什么，
   罐口的木签翻过来写着谁走到这儿，灯与香自己也刻着字（rig.js）。 */

/* ---------------- 一件件东西被摸了之后 ---------------- */
rig.handlers.onKnob = (id, value) => {
  settings = { ...(baseline?.settings || BASE), [id]: value };
  changed = null;
  rig.setLamp('after', false);
  const v = VARIABLES.find(x => x.id === id);
  setTop(`只改变「${v.label}」，其他旋钮回到改前设定。<br>拉闸验证。`);
  setHint('改后那一列已经清空，等拉闸重跑。');
};
rig.handlers.onReset = () => {
  settings = { ...(baseline?.settings || BASE) };
  changed = null;
  VARIABLES.forEach(v => rig.setKnob(v.id, settings[v.id]));
  rig.setLamp('after', false);
  setTop('所有铜钮回到改前设定。');
  setHint('铜钮归位了，改后那一列的豆子已经清掉。');
};
rig.handlers.onBowl = n => {
  baseline = null; changed = null; settings = { ...BASE };
  VARIABLES.forEach(v => rig.setKnob(v.id, v.base));
  beads.clear();
  rig.setLamp('before', false); rig.setLamp('after', false);
  figures.setCounts({});
  setTop(`每种玩家 ${n} 局。换局数要重新建立对照组，拉闸开始。`);
  setHint(`${n} 局 × ${PERSONA_KEYS.length} 种玩家 = ${n * PERSONA_KEYS.length} 局。`);
};
rig.handlers.onToken = d => {
  baseline = null; changed = null; settings = { ...BASE };
  VARIABLES.forEach(v => rig.setKnob(v.id, v.base));
  beads.clear();
  rig.setLamp('before', false); rig.setLamp('after', false);
  figures.setCounts({});
  setTop(`换成了${d === 'lu' ? '陆导（爱雕琢）' : '单导（爱放开）'}。导演换了，对照要重做，拉闸开始。`);
  readMentor();
};
rig.handlers.onRun = () => run();
// 手机全景里点一只陶罐：先凑近看这一排罐子；已经在近看，才是真去开罐。
rig.handlers.onPot = (column, slot) => { if (stages.entry('pots')) return; openPot(column, slot); };
// 手机全景里那排罐子交给了「看陶罐」那块木牌（罐与钮挨太近，直接点罐会点到钮上）。
rig.handlers.onPotOpen = () => { stages.entry('pots'); };
// 手机全景里点一枚铜钮：先凑近看这一排钮。桌面照旧（选中、上下拖）。
rig.handlers.onKnobFocus = () => { stages.entry('knobs'); };
rig.handlers.onLamp = column => readColumn(column);

/* 整账不常驻屏幕：点灯（或者点香炉）让它从竹简上滑出来。 */
function readColumn(column) {
  const r = column === 'before' ? baseline : changed;
  if (!r) { setTop(column === 'before' ? '改前这一列还没跑。' : '改后这一列还没跑：拨一个铜钮，再拉闸。'); return; }
  const lines = columnLines(r, column);
  const dir = column === 'before' ? 1 : -1;
  const x = rig.lampPoint(column).x;
  const at = { x: x + dir * 1.9, y: 2.35, z: 2.75 };
  scroll.show({ at, dir, lines, scale: bench.tall ? 1.7 : 1 });
  rig.showTopPlates(false);
  lineAway(true);
  bench.focus(new THREE.Vector3(at.x - dir * .5, 2.3, 2.75),
    { dist: bench.tall ? 7.6 : 4.6, ty: 2.3, tz: 2.75 });
  const c = distribution(r);
  setTop(`${column === 'before' ? '改前' : '改后'}的整账写在竹简上：${r.runs.length} 局里，晋鄙活下来 ${c['jinbi-lives']} 局、兵符没出宫 ${c.broken} 局。`);
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (scroll.shown) releaseFocus();     // 竹简开着：先收竹简
  else stages.back();                   // 否则退回全景（桌面上这一步本来就是空的）
});

/* ---------------- 拉闸：跑一批 ---------------- */
async function run() {
  if (busy) return;
  busy = true;
  releaseFocus();          // 重新拉闸：竹简收起来，顶上两块刻字归位
  const n = rig.samples;
  setHint(`${PERSONA_KEYS.length} 种玩家正在各走一遍…`);
  try {
    if (!baseline || baseline.director !== director || baseline.n !== n) {
      settings = { ...BASE };
      VARIABLES.forEach(v => rig.setKnob(v.id, v.base));
      const r = await measure({ director, n, settings: { ...BASE } });
      baseline = { ...r, director, n, settings: { ...BASE } };
      changed = null;
      beads.clear();
      spawnColumn(baseline, 'before');
    } else {
      const r = await measure({ director, n, settings: { ...settings } });
      changed = { ...r, director, n, settings: { ...settings } };
      beads.clear('after');
      spawnColumn(changed, 'after');
    }
    paint();
    const latest = changed || baseline;
    setHint(`${latest.runs.length} 局走完，豆子都落进罐子了。点开一只陶罐，看一粒豆子怎么走的。`);
    if (dev) $('devjson').textContent = JSON.stringify({
      settings, director, n, elapsed: latest.elapsed,
      stuck: latest.runs.filter(r => r.stuck).length,
      counts: distribution(latest),
      incense: incense.readings,
      ledger: {
        before: baseline ? columnLines(baseline, 'before') : null,
        after: changed ? columnLines(changed, 'after') : null,
      },
      note: rig.noteLines.join(''),
    }, null, 2);
  } catch (e) {
    setHint(`这批实验没跑完：${e.message}。刷新页面后再试。`);
    console.error(e);
  } finally { busy = false; }
}

function spawnColumn(result, column) {
  const runs = [...result.runs].sort((a, b) => slotOf(a) - slotOf(b));
  runs.forEach((run, i) => beads.spawn({ run, column, persona: run.persona, index: i }));
}

/* ---------------- 结账：罐子上的刻字、两盏灯、上面那句话 ---------------- */
/* 木签翻过来要写得下：人的名字缩成两个字，一行一个人。 */
const SHORT_PERSONA = { curious: '心思', hasty: '动手', loyal: '讲义', contrarian: '违反', patient: '沉住' };
const shortPersona = k => SHORT_PERSONA[k] || String(PERSONAS[k]?.label || k).slice(0, 2);
function paint() {
  for (const column of ['before', 'after']) {
    const r = column === 'before' ? baseline : changed;
    rig.setLamp(column, !!r);
    if (!r) {
      for (let slot = 0; slot < 4; slot++) {
        rig.setPotLabel(column, slot, [ENDINGS[SLOT_ENDING[slot]].label, '— 局']);
        rig.setPotBack(column, slot, ['还没走到这儿', '']);
      }
      continue;
    }
    const counts = distribution(r);
    for (let slot = 0; slot < 4; slot++) {
      const key = SLOT_ENDING[slot], n = counts[key];
      rig.setPotLabel(column, slot, [ENDINGS[key].label, `${n} 局 · ${pct(n / r.runs.length)}`]);
      // 翻过来：这一罐里，五种玩家各走了几局。
      const runs = r.runs.filter(x => (x.stuck ? 'stuck' : x.ending) === key);
      const who = PERSONA_KEYS.map(k => `${shortPersona(k)} ${runs.filter(x => x.persona === k).length}`).join(' · ');
      rig.setPotBack(column, slot, ['谁走到这儿', ...wrapLine(who)]);
    }
  }
  // 两炷香的长度 = 两列的平均戏内时长。
  const mean = r => r.runs.reduce((a, x) => a + x.seconds, 0) / r.runs.length;
  incense.set({ before: baseline ? mean(baseline) : null, after: changed ? mean(changed) : null });
  figures.setCounts(figureCounts(changed || baseline));
  const diff = baseline ? VARIABLES.find(v => settings[v.id] !== baseline.settings[v.id]) : null;
  if (!changed) {
    setTop(diff
      ? `${diff.label}：${baseline.settings[diff.id].toFixed(2)} → ${settings[diff.id].toFixed(2)}。结果尚未重跑。`
      : '原设定已测好。<br>拨一个铜钮，或者拉闸再测一次。');
    return;
  }
  const a = distribution(baseline), b = distribution(changed);
  const keys = Object.keys(a).sort((x, y) => Math.abs(b[y] - a[y]) - Math.abs(b[x] - a[x]));
  const k = keys[0];
  const attempts = r => r.runs.flatMap(x => x.attempts).filter(x => x.accepted).length;
  const hesitates = r => r.runs.filter(x => x.hesitant).length;
  const intro = diff
    ? `${diff.label} ${baseline.settings[diff.id].toFixed(2)} → ${settings[diff.id].toFixed(2)}`
    : '同一设定再测一次';
  const detail = hesitates(baseline) !== hesitates(changed)
    ? `结局分布没变，如姬犹豫从 ${pct(hesitates(baseline) / baseline.runs.length)} 变为 ${pct(hesitates(changed) / changed.runs.length)}`
    : `结局分布没变，戏里点头次数 ${attempts(baseline)} → ${attempts(changed)}`;
  setTop(`${esc(intro)}：${a[k] !== b[k]
    ? `${ENDINGS[k].label}从 ${pct(a[k] / baseline.runs.length)} 变为 ${pct(b[k] / changed.runs.length)}`
    : detail}。`);
}

/* ---------------- 点开一只陶罐：看一局怎么走的 ---------------- */
function releaseFocus() {
  slip.hide();
  scroll.hide();
  rig.showTopPlates(true);
  lineAway(false);
  // 手机近看时，收掉推近要回到「当前这一处」，不是一路退回全景。
  stages.release();
}
let focusTimer = 0;
function openPot(column, slot) {
  const r = column === 'before' ? baseline : changed;
  if (!r) { setTop('这一列还没跑。'); return; }
  const ending = SLOT_ENDING[slot];
  const runs = r.runs.filter(x => (x.stuck ? 'stuck' : x.ending) === ending);
  if (!runs.length) { setTop(`这一罐是空的：这批走法里没有「${ENDINGS[ending].label}」。`); return; }
  const run = runs[0];
  active = run;
  const mine = beads.inSlot(column, slot);
  if (mine.length) beads.rewind(mine[mine.length - 1]);
  // 竹简从罐子靠里的那一侧展开：罐子在左就从右边来，免得滑出画面。
  const pot = rig.potPoint(column, slot);
  const dir = pot.x > 0 ? -1 : 1;
  const at = new THREE.Vector3(pot.x + dir * 1.85, 2.35, 2.75);
  scroll.show({ at, dir, lines: scrollLines(run, column), scale: bench.tall ? 1.7 : 1 });
  rig.showTopPlates(false);
  lineAway(true);
  // 镜头对着竹简：账要凑近才读得清，罐子留在画面边上。
  bench.focus(new THREE.Vector3(at.x - dir * .6, 2.3, 2.75), { dist: bench.tall ? 7.4 : 4.4, ty: 2.3, tz: 2.75 });
  slip.show([
    `${column === 'before' ? '改前' : '改后'}的一局`,
    ENDINGS[ending].label,
    `${PERSONAS[run.persona].label} · 种子 ${run.seed}`,
  ]);
  setTop(`这一罐里随便拈了一颗：${PERSONAS[run.persona].label}的第 ${run.seed} 局。旁边竹简上写着它逐幕是怎么走的。`);
  clearTimeout(focusTimer);
  focusTimer = setTimeout(releaseFocus, 26000);
}

/** 竹简上写什么：一局的逐幕账。字少、行短，离远了也读得出来。 */
function scrollLines(run, column) {
  const steps = run.trail.slice(0, bench.tall ? 4 : 6);
  const lines = [`${column === 'before' ? '改前' : '改后'} · ${PERSONAS[run.persona].label} · 种子 ${run.seed}`];
  for (const t of steps) {
    lines.push(`${ACTS[t.act] || t.act}·${cut(t.line, 9)}`);
    const said = t.reason ? `${t.person || ''}：${t.reason}` : t.text;
    if (said) lines.push(`　${cut(said, 13)}`);
  }
  const rest = run.trail.length - steps.length;
  if (rest > 0) lines.push(`…还有 ${rest} 步`);
  lines.push(`落进「${ENDINGS[run.stuck ? 'stuck' : run.ending].label}」`);
  return lines;
}
function toFilm() {
  if (!active) return;
  try { localStorage.setItem('dw.lastFilm', JSON.stringify(active.record)); } catch { /* 无痕模式 */ }
  location.href = `/film.html?film=${encodeURIComponent(JSON.stringify(active.record))}`;
}

/* ---------------- 人偶与诉求木牌 ---------------- */
/** 最新那一批里，每个人被问了几次、点了几次头——刻在人偶底座上。 */
function figureCounts(r) {
  const out = {};
  for (const id of Object.keys(FIGURE_BY_ID)) out[id] = { asked: 0, yes: 0 };
  if (r) for (const run of r.runs) for (const a of run.attempts) {
    const c = out[a.person];
    if (!c) continue;
    c.asked++; if (a.accepted) c.yes++;
  }
  return out;
}

function showPerson(id) {
  const r = changed || baseline;
  if (!r) { setTop(`${personName(id)}：先拉闸跑一批，才看得出他说动没有。`); return; }
  const attempts = r.runs.flatMap(x => x.attempts).filter(a => a.person === id);
  const parts = ['义', '利', '惧', '恩'].map(a => {
    const rs = attempts.filter(x => x.appeal === a);
    return `${a} ${rs.length ? pct(rs.filter(x => x.accepted).length / rs.length) : '—'}`;
  });
  const probe = r.probe.map(p => `${p.appeal} ${p.rows.find(x => x.id === id)?.accepted ? '点头' : '不点头'}`).join(' · ');
  setTop(`${personName(id)}：${parts.join('　')}<br><small>点头次数 / 对他用过这种话的次数；独立试探：${probe}</small>`);
}
function runProbe(appeal) {
  const r = changed || baseline;
  if (!r) { setTop('先拉闸跑一批，才有可问的五个人。'); return; }
  const entry = r.probe.find(p => p.appeal === appeal);
  if (!entry) return;
  figures.unmarkAll();
  tiles.set(appeal, entry.rows);
  entry.rows.forEach((row, i) => {
    setTimeout(() => { figures.play(row.id, row.accepted); if (row.accepted) figures.mark(row.id, true); }, 140 * i);
  });
  const names = entry.rows.filter(x => x.accepted).map(x => personName(x.id));
  setTop(`「${appeal}」对五个人各讲一遍（强度 0.8，不写入演出）：${names.length ? `${names.join('、')}点头` : '没有人点头'}。`);
  setHint(names.length === 5 ? '五个人全点头。' : '点别的木牌，换一种话再问一遍。');
}
function sealLink() {
  const url = active ? `${location.origin}/film.html?film=${encodeURIComponent(JSON.stringify(active.record))}` : location.href;
  const done = () => { slip.sealed(active ? '已封好 · 这局电影的链接' : '已封好 · 这台推演机的链接'); setHint('链接已经抄到剪贴板。'); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => { setTop(esc(url)); setHint('剪贴板被浏览器挡住了，链接写在上面的刻字里。'); });
  else { setTop(esc(url)); setHint('这台浏览器不给剪贴板，链接写在上面的刻字里。'); }
}

/* ---------------- 开场：先把原设定跑出来 ---------------- */
paint();
setHint('正在准备第一批实验…');
readMentor();
run();
if (dev) window.__lab = {
  bench, rig, beads, figures, tiles, slip, scroll, incense, stages,
  state: () => ({ settings, director, n: rig.samples, baseline, changed }),
  counts: () => ({
    before: baseline ? distribution(baseline) : null,
    after: changed ? distribution(changed) : null,
  }),
  run: config => measure(config),
  /* 打磨期的自查口：机器占屏多少、槽底走痕深浅、木签翻到几度、导师现在念哪句。 */
  coverage() { return bench.coverage(rig.machine); },
  wear: () => ({ at: (row, lane, column) => rig.wearOf(row, lane, column), counts: paintWear() }),
  pot: (column, slot) => ({ flip: rig.potFlip(column, slot), back: rig.potBackLines(column, slot) }),
  mentor: () => ({ at: mentorAt, lines: mentorLines.slice(), shown: mentorLines[mentorAt] || null }),
  /* 手机换观察距离那套：现在在哪一处、镜头会停在哪、横拖到哪儿了。 */
  stage: () => ({ name: stages.stage, close: stages.close, rest: bench.rest, panOff: bench.panOff, tall: bench.tall }),
  lanes: run => lanesOf(run),
};
