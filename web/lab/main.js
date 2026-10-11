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
const beads = createBeads(rig.beanRoot, { speed: 1 });
const figures = createFigures(bench, { onPick: node => showPerson(node.id) });
const tiles = createProbeTiles(bench, { onPick: appeal => runProbe(appeal) });
const slip = createSlip(bench, { onSeal: sealLink });
const scroll = createScroll(bench, { onFilm: () => toFilm() });
const incense = createIncense(bench, { onPick: () => readColumn(baseline ? 'before' : 'after') });
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
const sayMentor = text => { $('mentor').hidden = !text; $('mentor').textContent = text || ''; };
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

/* ---------------- 每帧：豆子走路、刻字跟着物件跑 ---------------- */
let lastHover = undefined;
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
  const hv = bench.hovered?.name ?? null;
  if (hv !== lastHover) { lastHover = hv; paintTip(hv); }
});

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

function paintTip(name) {
  const tip = $('tip');
  let text = '';
  if (name?.startsWith('pot:')) {
    const [, column, slot] = name.split(':');
    const r = column === 'before' ? baseline : changed;
    if (r) {
      const ending = SLOT_ENDING[Number(slot)];
      const runs = r.runs.filter(x => (x.stuck ? 'stuck' : x.ending) === ending);
      const who = Object.keys(PERSONAS).map(k => `${PERSONAS[k].label} ${runs.filter(x => x.persona === k).length}`).join(' · ');
      text = `${ENDINGS[ending].label}｜${column === 'before' ? '青釉' : '酱釉'} ${runs.length} 局（${pct(runs.length / r.runs.length)}）— 点开看一局 · ${who}`;
    } else text = '这罐还没装豆子';
  } else if (name?.startsWith('knob:')) {
    const v = VARIABLES.find(x => x.id === name.slice(5));
    text = v ? `${v.label}：${v.why}` : '';
  } else if (name?.startsWith('figure:')) {
    text = `${personName(name.slice(7))} · 点一下看他说动没有`;
  } else if (name?.startsWith('appeal:')) {
    text = `点一下：向五个人各讲一遍「${name.slice(7)}」`;
  } else if (name === 'lever') text = '拉闸：按现在的设定重跑一遍';
  else if (name === 'bowl') text = '点一下换局数（8 / 16 / 32）';
  else if (name === 'token') text = '点一下换一位导演';
  else if (name === 'reset') text = '点一下：所有铜钮拧回改前设定';
  else if (name === 'seal') text = '点一下抄走一份链接';
  else if (name === 'scroll') text = '这一局逐幕怎么走的 · 点右下角封泥拍成电影';
  else if (name === 'scroll:seal') text = '点一下：把这局拍成电影';
  else if (name === 'incense') text = '两炷香：烧掉的长度就是那一列的平均戏内时长 · 点一下看整账';
  else if (name === 'lamp:before') text = '改前这一列 · 点一下念一遍账';
  else if (name === 'lamp:after') text = '改后这一列 · 点一下念一遍账';
  tip.hidden = !text;
  tip.textContent = text;
  if (text) {
    const p = bench.screenOf(name);
    // 陶罐的锚点在罐身上，字要浮在它上方；别的实物都浮在它下沿。
    const up = name.startsWith('pot:');
    if (p) tip.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y + (up ? -14 : 26))}px) translate(-50%,${up ? '-100%' : '0'})`;
  }
}

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
};
rig.handlers.onRun = () => run();
rig.handlers.onPot = (column, slot) => openPot(column, slot);
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
  bench.focus(new THREE.Vector3(at.x - dir * .5, 2.3, 2.75),
    { dist: bench.tall ? 7.6 : 4.6, ty: 2.3, tz: 2.75 });
  const c = distribution(r);
  setTop(`${column === 'before' ? '改前' : '改后'}的整账写在竹简上：${r.runs.length} 局里，晋鄙活下来 ${c['jinbi-lives']} 局、兵符没出宫 ${c.broken} 局。`);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') releaseFocus(); });

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
function paint() {
  for (const column of ['before', 'after']) {
    const r = column === 'before' ? baseline : changed;
    rig.setLamp(column, !!r);
    if (!r) {
      for (let slot = 0; slot < 4; slot++) rig.setPotLabel(column, slot, [ENDINGS[SLOT_ENDING[slot]].label, '— 局']);
      continue;
    }
    const counts = distribution(r);
    for (let slot = 0; slot < 4; slot++) {
      const key = SLOT_ENDING[slot], n = counts[key];
      rig.setPotLabel(column, slot, [ENDINGS[key].label, `${n} 局 · ${pct(n / r.runs.length)}`]);
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
  bench.release();
  slip.hide();
  scroll.hide();
  rig.showTopPlates(true);
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
sayMentor(`先看看原世界：什么都不改，${PERSONA_KEYS.length} 种玩家各走 ${rig.samples} 局。`);
run();
if (dev) window.__lab = {
  bench, rig, beads, figures, tiles, slip, scroll, incense,
  state: () => ({ settings, director, n: rig.samples, baseline, changed }),
  counts: () => ({
    before: baseline ? distribution(baseline) : null,
    after: changed ? distribution(changed) : null,
  }),
  run: config => measure(config),
};
