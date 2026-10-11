// 排片表：一座戏台，几件实物。点哪件，就去看哪件。
// 文字只有两处：台口的匾，和导师灯下的那句话（取自 shared/agents/mentor.js 的真实笔记）。
import { createSession } from '../../shared/engine/session.js';
import { decode, directorInput, STORAGE_KEY } from '../film/format.js';
import { createScene, attachPointer, night } from './scene.js';
import { createHubStage } from './hubstage.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEV = params.get('dev') === '1';

// ── 上一局：有 dw.lastFilm，台口就多一卷刚封好的新卷轴 ─────────────
let last = null;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) last = decode(raw);
} catch { /* 坏掉的本地录制不能拖垮整张排片表 */ }

// ── 导师的笔记：还是那一句真的 ────────────────────────────────
let mentorLines = ['先把能玩的、录好的排在眼前，其余作品备好再来。'];
let mentorSource = '临时排片说明；导师笔记尚未读取';
try {
  const session = createSession();
  const { answers, need } = directorInput(last?.director || 'B');
  session.meet(answers, need);
  const notes = session.mentor.notes();
  const said = (field) => notes.find(n => n.field === field)?.said;
  mentorLines = [said('wait'), said('polish'), said('depth')].filter(Boolean);
  if (!mentorLines.length) mentorLines = notes.map(n => n.said).filter(Boolean);
  mentorSource = last ? '按上一局开场的口味，重读导师笔记' : '先按不让你等的口味排片；玩过后跟着你调整';
  if (DEV) window.__hub = { notes, answers, need, director: session.state.directorId };
} catch {
  mentorLines = ['先把能玩的、录好的排在眼前，其余作品备好再来。'];
  mentorSource = '临时排片说明；导师笔记尚未读取';
}

// ── 台上摆什么：一件实物 = 一行排片 ───────────────────────────
// x 是它在那一层的位置，scale 是它比实物放大多少倍（台子收窄了，东西要大得认得出）。
const ROW1 = [
  { id: 'tally', kind: 'tally', name: '窃符', tagline: '亲自走一局', row: 1, x: -4.3, scale: 1.6, act: 'game', href: '/play.html',
    detail: '从大梁走到邺城。你说的话、递出的东西，会改变一个人的决定。' },
  { id: 'history', kind: 'scroll', name: '援军往邯郸去', tagline: '坐下，自动放映', row: 1, x: -2.15, scale: 1.35, tint: '#7a5a34',
    tag: '援军往邯郸去', act: 'film', href: '/film.html?demo=history',
    detail: '兵符出了宫，铁椎落在帐中。这一局，沿着史书往前。' },
  { id: 'broken', kind: 'scroll', name: '差了一步的夜', tagline: '看看另一种结局', row: 1, x: 0, scale: 1.35, tint: '#3d4a63', tagColor: '#1c2436',
    tag: '差了一步的夜', act: 'film', href: '/film.html?demo=broken',
    detail: '同一条回廊，多走一步。守卫看见了你，兵符留在卧内。' },
  { id: 'lab', kind: 'rig', name: '如果，换一个条件', tagline: '去科研台做一次对照', row: 1, x: 2.15, scale: 1.55, act: 'lab', href: '/lab.html',
    detail: '改一个变量，让同一群人再走一遍。看谁改变了，为什么。' },
  { id: 'world', kind: 'knots', name: '四部作品，共用一个世界', tagline: '看作品之间的关系', row: 1, x: 4.3, scale: 1.15, r: 0.62, act: 'world', href: '/world.html',
    detail: '旧说法被引用，也会被推翻。看看你的一局，接到了谁的故事里。' },
];
const ROW2 = [
  { id: 'soon-film', kind: 'covered', name: '取符之夜', row: 2, x: -1.8, h: 1.55, w: 0.78, scale: 1.2, act: 'covered',
    tagline: '备着', detail: '完整电影呈现。从如姬的眼睛，走过那条回廊。' },
  last
    ? { id: 'last', kind: 'sealed', name: '你的上一局电影', tagline: '看你的上一局', row: 2, x: 1.8, scale: 1.35,
        tag: '刚才的你', act: 'last', href: '/film.html?last=1',
        detail: '你刚做过的选择，已经能被放映。先看自己，再从如姬的眼睛重看。' }
    : { id: 'soon-ruji', kind: 'covered', name: '如姬的夜', row: 2, x: 1.8, h: 1.35, w: 0.72, scale: 1.2, act: 'covered',
        tagline: '备着', detail: '同一件事，她那一版。还没排上。' },
];
const ROW3 = [
  { id: 'soon-changping', kind: 'covered', name: '长平之后', row: 3, x: -1.3, h: 1.35, w: 0.72, scale: 1.15, act: 'covered',
    tagline: '备着', detail: '战败之后，活下来的人怎样看待下一场战争。' },
  { id: 'soon-city', kind: 'covered', name: '围城', row: 3, x: 1.3, h: 1.7, w: 0.86, scale: 1.15, act: 'covered',
    tagline: '备着', detail: '完整呈现。粮仓里的一次犹豫，接着城里每个人的命。' },
];
const ITEMS = [...ROW1, ...ROW2, ...ROW3];

// ── 搭台 ────────────────────────────────────────────────
const canvas = $('stage');
const render = createScene(canvas);
night(render.scene, '#0a0f17', 0.0125);
const stage = createHubStage(render, ITEMS);

// 镜头：桌面推得近（实物撑满大半个画面），竖屏退远（先看整座台）。
const portrait = () => innerWidth < innerHeight;
const focusByRow = { 1: 5.6, 2: 4.6, 3: 4.2 };
const focusDist = row => (focusByRow[row] ?? 5.2) * (portrait() ? 2.1 : 1);
const baseDist = () => (portrait() ? 19 : 10.2);
const baseShot = () => render.shot({ x: 0, y: portrait() ? 2 : 1.75, z: 1.1 }, { dist: baseDist(), elev: portrait() ? 23 : 22, az: 0, time: 0.7 });

// 开场：先看见整座台子。
baseShot();
stage.setLine(mentorLines[0]);

let focusNode = null;
let lineIndex = 0;
let picked = null;

const picker = attachPointer(canvas, render.camera, render.pickables, {
  onHover(node) {
    focusNode = node;
    if (node.kind === 'mentor') {
      stage.setLine(mentorLines[lineIndex % mentorLines.length]);
      return;
    }
    render.shot(node.center, { dist: focusDist(node.row), elev: 16, az: 0.14, time: 0.55 });
    setCaption(node);
  },
  onLeave() {
    focusNode = null;
    if (picked) return;                 // 拿起来的那件还没落定，镜头别跑
    baseShot();
    setCaption(null);
  },
  async onPick(node) {
    if (picked) { stage.liftSkip(); return; }   // 再点一下：这一趟快进
    if (node.kind === 'mentor') {
      lineIndex += 1;
      stage.setLine(mentorLines[lineIndex % mentorLines.length]);
      node.group.scale.setScalar(1.05);
      setTimeout(() => node.group.scale.setScalar(1), 220);
      return;
    }
    picked = node;
    // 拿起：镜头再进半步，物件自己飞到镜头前、转半圈、亮出木签。
    render.shot(node.center, { dist: Math.max(focusDist(node.row), baseDist() * 0.9), elev: 21, az: 0.05, time: 0.55 });
    setCaption(node, true);
    await stage.liftUp(node);
    if (node.act === 'covered') {
      setCaption(node, false, '这件还没排上。先看它摆在哪儿。');
      await sleep(950);
      stage.releaseLift();
      picked = null;
      return;
    }
    location.href = node.href;
  },
});

// 拿起来的那一趟，点画面任何地方都能快进。
canvas.addEventListener('pointerdown', () => { if (picked) stage.liftSkip(); }, true);

function setCaption(node, going = false, override = '') {
  const box = $('laser');
  if (!node) { box.hidden = true; return; }
  $('laser-name').textContent = node.name;
  $('laser-tag').textContent = override || (going ? '正在起身……' : node.tagline);
  $('laser-detail').textContent = override ? '' : node.detail;
  box.hidden = false;
  box.dataset.act = node.act;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 键盘也认这件实物 ────────────────────────────────────────
const order = ITEMS.map(i => i.id).concat('mentor');
function stepHover(delta) {
  const current = picker.hovered;
  const at = current ? order.indexOf(current.id) : -1;
  const nextId = order[(at + delta + order.length + (at < 0 ? 1 : 0)) % order.length];
  const node = stage.nodes.get(nextId) || (nextId === 'mentor' ? stage.mentorNode : null);
  if (node) {
    picker.clear();
    focusNode = node;
    render.shot(node.center, { dist: focusDist(node.row), elev: 16, az: 0.14, time: 0.5 });
    setCaption(node);
  }
}

// ── 每帧 ────────────────────────────────────────────────
// dt 由 rAF 的时间戳算，第一帧一定要兜住；上限放宽到 0.25 秒，
// 免得在很慢的机器上一帧只走 1/20 秒，镜头永远收不住。
let lastMs = 0;
let elapsed = 0;
function frame(ms) {
  if (!lastMs) lastMs = ms;
  const dt = Math.min((ms - lastMs) / 1000, 0.25);
  lastMs = ms;
  elapsed += dt;
  render.updateCamera(dt);
  stage.update(dt, elapsed, picker.hovered ?? focusNode);
  render.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('resize', () => { if (!picker.hovered) baseShot(); });

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { stepHover(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { stepHover(-1); e.preventDefault(); }
});

if (DEV) {
  window.__hub = Object.assign(window.__hub ?? {}, {
    render, stage, mentorSource, last: Boolean(last),
    items: ITEMS.map(({ id, row, act, x, scale }) => ({ id, row, act, x, scale })),
  });
  $('dev').hidden = false;
  $('dev').textContent = JSON.stringify({
    mentorSource, last: Boolean(last),
    items: ITEMS.map(({ id, row, act }) => ({ id, row, act })),
  }, null, 2);
}
