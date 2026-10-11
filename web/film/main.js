import { decode, encode, DEMOS, STORAGE_KEY } from './format.js';
import { makeReplay, PERSPECTIVES } from './replay.js';
import { createFilmStage } from './stage.js';
import { personDef } from '../game/actors.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const dev = params.get('dev') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const speed = dev ? Math.max(1, Math.min(100, Number(params.get('speed')) || 1)) : 1;
let film, stage, index = 0, start = performance.now(), perspective = params.get('perspective') || 'xinling';
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
  try { const last = localStorage.getItem(STORAGE_KEY); if (last) return decode(last); } catch { /* demo remains available */ }
  return DEMOS.history;
}
function showFrame() {
  const frame = film.frames[index];
  stage.show(frame, perspective);
  $('scene-place').textContent = frame.view.place || (frame.ending ? '世界继续往前' : '魏国');
  $('scene-title').textContent = frame.view.title || (frame.ending ? '落幕' : '长平之后');
  $('choice').textContent = frame.choice ? `你在这里选了：${frame.choice}` : '';
  $('speaker').textContent = frame.focus ? personDef(frame.focus)?.name || frame.focus : '这一刻';
  const thought = frame.thoughts[perspective];
  $('thought').textContent = thought ? `${personDef(perspective)?.name || PERSPECTIVES[perspective]}的心思：${thought}` :
    perspective !== 'xinling' && frame.view.act ? `${PERSPECTIVES[perspective]}此刻不在场，镜头留在这件事上。` : '';
  $('dialogue').textContent = reducedMotion ? frame.text : '';
  lastText = '';
  frameDuration = Math.max(3600, Math.min(9500, frame.text.length * 42 + 2000)) + (frame.choice ? 1400 : 0);
  start = performance.now();
  $('progress-label').textContent = `自动放映 · ${index + 1} / ${film.frames.length} 段`;
  if (dev) window.__film.frame = index;
}
function finish() {
  document.body.dataset.filmStatus = 'ended';
  document.body.dataset.ending = film.state.ending || 'partial';
  $('progress').value = 1;
  $('progress-label').textContent = '放映结束，换眼睛可以再看一遍';
  $('ending-title').textContent = ({ history: '援军往邯郸去', broken: '兵符留在了宫里', 'jinbi-lives': '晋鄙随军而行' })[film.state.ending] || '这一卷录制，到这里';
  $('ending-line').textContent = film.state.coda?.lived || film.frames.at(-1).text;
  $('ending').hidden = false;
  if (dev) window.__film.ended = true;
}
function tick(now, run) {
  if (run !== playbackId || document.body.dataset.filmStatus !== 'playing') return;
  const frame = film.frames[index];
  const elapsed = (now - start) * speed;
  const typingTime = Math.max(0, elapsed - (frame.choice ? 1000 : 300));
  const text = reducedMotion ? frame.text : frame.text.slice(0, Math.floor(typingTime / 30));
  if (lastText !== text) { $('dialogue').textContent = text; lastText = text; }
  $('progress').value = (index + Math.min(1, elapsed / frameDuration)) / film.frames.length;
  if (elapsed >= frameDuration) {
    if (index >= film.frames.length - 1) { finish(); return; }
    index++; showFrame();
  }
  requestAnimationFrame(now => tick(now, run));
}
function restart() {
  const run = ++playbackId;
  index = 0; $('ending').hidden = true;
  document.body.dataset.filmStatus = 'playing';
  document.querySelectorAll('[data-perspective]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.perspective === perspective)));
  if (dev) window.__film.ended = false;
  showFrame(); requestAnimationFrame(now => tick(now, run));
}
// Pause the cinematic clock while hidden, so a return does not silently skip the film.
let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = performance.now();
  else if (hiddenAt !== null) { start += performance.now() - hiddenAt; hiddenAt = null; }
});

try {
  film = makeReplay(readFilm());
  stage = createFilmStage($('stage'));
  $('film-origin').textContent = params.has('demo') || !params.has('last') && !params.has('film') ? '从同一个世界，录下两种走法' : '你走过的这一局';
  if (film.record.lab) $('film-origin').textContent = '科研动作回放；实验变量只在科研台生效';
  if (dev) {
    $('debug').hidden = false;
    $('debug').querySelector('pre').textContent = JSON.stringify({ director: film.director, ending: film.state.ending, steps: film.record.steps }, null, 2);
    window.__film = { ...film, frame: 0, ended: false, speed };
  }
  $('replay').addEventListener('click', restart);
  document.querySelectorAll('[data-perspective]').forEach(button => button.addEventListener('click', () => {
    perspective = button.dataset.perspective;
    const url = new URL(location.href); url.searchParams.set('perspective', perspective); history.replaceState(null, '', url);
    restart();
  }));
  $('share').addEventListener('click', async () => {
    try {
      const url = new URL('/film.html', location.origin);
      url.searchParams.set('film', encode(film.record)); url.searchParams.set('perspective', perspective);
      $('share-link').value = url.href; $('share-box').hidden = false;
      $('share-message').textContent = '复制链接即可分享，同一局会按相同的选择重放。';
      try { await navigator.clipboard.writeText(url.href); $('share-message').textContent = '已复制链接。打开它，不用做选择就能看完这一局。'; }
      catch { $('share-link').focus(); $('share-link').select(); }
    } catch (error) { $('share-box').hidden = false; $('share-message').textContent = error.message; }
  });
  $('close-share').addEventListener('click', () => { $('share-box').hidden = true; $('share').focus(); });
  restart();
} catch (error) {
  document.body.dataset.filmStatus = 'error';
  $('error').hidden = false; $('error-line').textContent = error.message;
  $('share').disabled = true;
  document.querySelectorAll('[data-perspective]').forEach(b => { b.disabled = true; });
}
