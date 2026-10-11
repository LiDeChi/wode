// 放映厅主控：把一局录制放成电影。
// 画面里没有网页框架：换眼睛看是场景里的木牌，进度是燃着的香，分享是带封泥的信。
// 放映时钟、打字机与录制格式都不变——只换了呈现与动手的地方。
import { decode, encode, DEMOS, STORAGE_KEY } from './format.js';
import { makeReplay, PERSPECTIVES } from './replay.js';
import { createScene, attachPointer, night } from '../hub/scene.js';
import { createFilmStage } from './filmstage.js';
import { personDef } from '../game/actors.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEV = params.get('dev') === '1';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const speed = DEV ? Math.max(1, Math.min(100, Number(params.get('speed')) || 1)) : 1;
let film, render, stage, index = 0, start = performance.now();
let perspective = params.get('perspective') || 'xinling';
if (!PERSPECTIVES[perspective]) perspective = 'xinling';
let lastText = '', frameDuration = 0, playbackId = 0;

function readFilm() {
  if (params.has('film')) return decode(params.get('film'));
  if (params.get('last') === '1') {
    const last = localStorage.getItem(STORAGE_KEY);
    if (!last) throw new Error('这里还没有上一局。先去《窃符》游戏走一遍，或打开示范片。');
    return decode(last);
  }
  if (params.has('demo')) {
    if (!DEMOS[params.get('demo')]) throw new Error('没有这条示范片，请回排片表选一条。');
    return DEMOS[params.get('demo')];
  }
  try { const last = localStorage.getItem(STORAGE_KEY); if (last) return decode(last); } catch { /* 示范片还在 */ }
  return DEMOS.history;
}

/** 整卷的进度：已经放完的段 + 正在放的这一段的比例。 */
function progressAt(elapsedInFrame) {
  return (index + Math.min(1, elapsedInFrame / frameDuration)) / film.frames.length;
}

function showFrame() {
  const frame = film.frames[index];
  stage.setPerspective(perspective);
  stage.show(frame.view, perspective, frame.ending);
  stage.setChoice(frame.choice ? `你在这里选了：${frame.choice}` : '');
  const name = frame.focus ? personDef(frame.focus)?.name || frame.focus : '这一刻';
  $('speaker').textContent = frame.ending ? '落幕' : name;
  const thought = frame.thoughts[perspective];
  $('thought').textContent = thought
    ? `${personDef(perspective)?.name || PERSPECTIVES[perspective]}的心思：${thought}`
    : perspective !== 'xinling' && frame.view.act ? `${PERSPECTIVES[perspective]}此刻不在场，镜头留在这件事上。` : '';
  $('dialogue').textContent = reduce ? frame.text : '';
  lastText = '';
  frameDuration = Math.max(3600, Math.min(9500, frame.text.length * 42 + 2000)) + (frame.choice ? 1400 : 0);
  start = performance.now();
  if (DEV) window.__film.frame = index;
}

function finish() {
  document.body.dataset.filmStatus = 'ended';
  document.body.dataset.ending = film.state.ending || 'partial';
  stage.setProgress(1);
  stage.show(film.frames.at(-1).view, perspective, true);
  $('ending-title').textContent = ({ history: '援军往邯郸去', broken: '兵符留在了宫里', 'jinbi-lives': '晋鄙随军而行' })[film.state.ending] || '这一卷录制，到这里';
  $('ending-line').textContent = film.state.coda?.lived || film.frames.at(-1).text;
  $('ending').hidden = false;
  if (DEV) window.__film.ended = true;
}

function tick(now, run) {
  if (run !== playbackId || document.body.dataset.filmStatus !== 'playing') return;
  const frame = film.frames[index];
  const elapsed = (now - start) * speed;
  const typingTime = Math.max(0, elapsed - (frame.choice ? 1000 : 300));
  const text = reduce ? frame.text : frame.text.slice(0, Math.floor(typingTime / 30));
  if (lastText !== text) { $('dialogue').textContent = text; lastText = text; }
  stage.setProgress(progressAt(elapsed));
  if (elapsed >= frameDuration) {
    if (index >= film.frames.length - 1) { finish(); return; }
    index++; showFrame();
  }
  requestAnimationFrame(next => tick(next, run));
}

function restart() {
  const run = ++playbackId;
  index = 0;
  $('ending').hidden = true;
  document.body.dataset.filmStatus = 'playing';
  document.querySelectorAll('[data-perspective]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.perspective === perspective)));
  if (DEV) window.__film.ended = false;
  showFrame();
  requestAnimationFrame(next => tick(next, run));
}

function switchTo(next) {
  if (!PERSPECTIVES[next]) return;
  perspective = next;
  const url = new URL(location.href);
  url.searchParams.set('perspective', perspective);
  history.replaceState(null, '', url);
  restart();
}

// 藏起来的时候停表，回来不至于跳过一段。
let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = performance.now();
  else if (hiddenAt !== null) { start += performance.now() - hiddenAt; hiddenAt = null; }
});

async function share() {
  try {
    const url = new URL('/film.html', location.origin);
    url.searchParams.set('film', encode(film.record));
    url.searchParams.set('perspective', perspective);
    $('share-link').value = url.href;
    $('share-slip').hidden = false;
    $('share-message').textContent = '封泥按下了：这封信里装着这一局。复制链接即可分享。';
    stage.pulseShare();
    try {
      await navigator.clipboard.writeText(url.href);
      $('share-message').textContent = '封泥按下了，链接已经在你手里。打开它，不用做选择就能看完这一局。';
    } catch {
      $('share-link').focus();
      $('share-link').select();
      $('share-message').textContent = '封泥按下了。链接在下面，按住选中即可复制。';
    }
  } catch (error) {
    $('share-slip').hidden = false;
    $('share-message').textContent = error.message;
  }
}

/** 场景里的动手处：木牌换眼睛、封泥分享。 */
function wireStage() {
  return attachPointer($('stage'), render.camera, render.pickables, {
    onPick(node) {
      if (node.act === 'perspective') switchTo(node.perspective);
      else if (node.act === 'share') share();
    },
  });
}

try {
  film = makeReplay(readFilm());
  render = createScene($('stage'));
  night(render.scene, '#141118', 0.024);
  render.camera.fov = 44;
  render.camera.updateProjectionMatrix();
  render.shot({ x: 0, y: 1.4, z: 0 }, { dist: 13, elev: 15, az: 0.46, time: 0 });
  stage = createFilmStage(render);
  const picker = wireStage();

  let lastMs = 0;
  let elapsed = 0;
  function frame(ms) {
    // 第一帧没有上一帧：rAF 的时间戳与 performance.now() 不同源，直接相减会
    // 得到一个很大的负数（本轮踩过的坑：镜头每帧都被重置回起点）。
    if (!lastMs) lastMs = ms;
    const dt = Math.min((ms - lastMs) / 1000, 0.05);
    lastMs = ms;
    elapsed += dt;
    stage.update(dt, elapsed, picker.hovered);
    render.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  $('replay').addEventListener('click', (e) => { e.preventDefault(); restart(); });
  document.querySelectorAll('[data-perspective]').forEach(button => button.addEventListener('click', () => switchTo(button.dataset.perspective)));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' && !e.metaKey && !e.ctrlKey) restart();
  });

  if (DEV) {
    $('dev').hidden = false;
    $('dev').textContent = JSON.stringify({ director: film.director, ending: film.state.ending, steps: film.record.steps }, null, 2);
    window.__film = { ...film, frame: 0, ended: false, speed, render, stage, picker, switchTo };
  }
  restart();
} catch (error) {
  document.body.dataset.filmStatus = 'error';
  $('error').hidden = false;
  $('error-line').textContent = error.message;
  $('dialogue').textContent = '';
}
