import './style.css';
import { WorldApi } from './ui/api';
import { icon, escapeHtml as h } from './ui/icons';
import { Theatre } from './presentation/scene';
import { TheatreAudio } from './presentation/audio';
import type { GranaryView, SceneCharacter, SceneKind } from './presentation/contracts';
import { GRAIN_CAPACITY } from './data/rules';
import { ACTS, PROLOGUE, WORKS } from './game/story';
import { NightGame } from './game/night';
import { getMind, getActorView, checkConsistency, getOverturnCost, replayEvents } from './core/world';
import { createWorld } from './core/seed';
import { runSwapBenchmark, buildModificationRequest } from './core/mechanisms';
import type { WorldState, WorkId, Intent, MindTrace, Claim, Preferences } from './core/types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const api = new WorldApi();
const audio = new TheatreAudio();
let theatre: Theatre | null = null;
let page = 'home';
let work: WorkId = 'qiefu';
let currentScene = 'court';
let prologueFrame = 0;
let filmElapsed = 0;
let filmPaused = false;
let night: NightGame | null = null;
let nightStandalone = false;
let nightFinished = false;
let busy = false;
let pendingOperation: Promise<unknown> = Promise.resolve();
let keeper = 'keeper-suspicious';
let perspective = 'player';
let lastMessage = '';
let wikiActor = 'xinling';
let replayIndex = 0;
let overlayReturnFocus: HTMLElement | null = null;
let openMindActor: string | null = null;
let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const state = () => api.state;
const svgSymbol = (type: string) => {
  const inner: Record<string, string> = {
    seal: '<path d="M34 56q7-29 33-22l10 8 23-3 25 13-4 20-23 4-10 16H56l-4-14-18-5z"/><path d="M65 35l3 34m-12 2h43M50 53h12M108 52l-3 14"/>',
    grain: '<path d="M55 35q25 10 50 0l-8 17q26 30 8 62H55q-18-32 8-62z"/><path d="M60 47h40M67 63q15 9 29 0M76 29l4 10 5-11"/>',
    moon: '<path d="M100 27a43 43 0 1 0 31 58 37 37 0 0 1-31-58z"/><path d="M31 117h112M42 105h17V88h52v17h18M65 85V64h37v21M58 65l25-21 26 21"/>',
    city: '<path d="M30 108h102M35 107V78h24v29M61 107V63h43v44M106 107V78h23v29M27 77l20-15 19 15M55 62l28-25 28 25M101 77l18-15 20 15M76 105V80h13v25"/>'
  };
  return `<svg viewBox="0 0 160 145" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${inner[type] || inner.seal}</svg>`;
};
function characters(ids: string[], source = state()): SceneCharacter[] {
  const positions = [{ x: -2, z: 0.2 }, { x: 2.4, z: -0.5 }, { x: 0, z: 3 }, { x: -4, z: 1.2 }];
  return ids.map((id, i) => {
    const e = source.entities[id];
    return { id, name: e?.name || id, color: e?.appearance?.color || ['#d8bd7b', '#749f91', '#a79689'][i % 3], silhouette: e?.appearance?.silhouette || 'scholar', ...positions[i % positions.length], mood: getMind(source, id).emotion };
  });
}
function header(active = page) {
  return `<header class="site-header"><button class="brand" data-action="home" aria-label="回到作品墙"><span class="brand-seal">世</span><span>数字世界<small>每一个人，都有后来</small></span></button><nav aria-label="剧场导航"><button class="${active === 'home' ? 'active' : ''}" data-action="home">作品墙</button><button class="${active === 'wiki' ? 'active' : ''}" data-action="wiki">人物志</button><button class="${active === 'studio' ? 'active' : ''}" data-action="studio">片场</button><button class="${active === 'notes' ? 'active' : ''}" data-action="notes">导师的笔记</button></nav><button class="icon-button audio-toggle" data-action="audio" aria-label="${audio.enabled ? '关闭声音' : '开启声音'}">${icon(audio.enabled ? 'sound' : 'mute')}</button></header>`;
}
function disposeScene() { theatre?.dispose(); theatre = null; night?.clearInput(); night = null; closeOverlay(); }
function mountScene(kind: SceneKind, cast: string[], elementId = 'theatre', source = state()) {
  const element = document.getElementById(elementId)!;
  theatre = new Theatre(element, { onCharacterClick: showMind, onGroundClick: (x, z) => { if (night) night.go(x, z); }, onTick: tick });
  // The stage reads the granary from the same record the rules do, so what you see on
  // the table is what the world actually stored — and it survives a reload, because
  // the recorded event is the source rather than a variable held in the page.
  const lastHandover = [...source.events].reverse().find(e => e.intent.sceneId === 'granary' && e.claimIds.some(id => source.claims.find(c => c.id === id)?.predicate.startsWith('handoff.')));
  const item = lastHandover?.intent.itemId;
  const granary: GranaryView | undefined = kind === 'granary' ? {
    stock: source.resources.granary.grain,
    capacity: GRAIN_CAPACITY,
    credential: lastHandover ? lastHandover.intent.choice ?? (['seal', 'letter', 'pledge'].includes(item ?? '') ? item! : lastHandover.intent.verb === 'vouch' ? 'pledge' : 'letter') : '',
    keeper: lastHandover?.intent.targetId ?? keeper,
    mechanism: source.mechanisms.some(m => m.installed)
  } : undefined;
  theatre.setScene(kind, characters(cast, source), granary);
  if (page === 'play') addCharacterHotspots(cast);
}
function addCharacterHotspots(cast: string[]) {
  const stage = document.querySelector('.stage-wrap');
  if (!stage) return;
  const list = document.createElement('div'); list.className = 'character-hotspots';
  for (const id of cast.filter(id => id !== 'player')) {
    const button = document.createElement('button'); button.className = 'character-hotspot'; button.dataset.actor = id;
    button.setAttribute('aria-label', `看${state().entities[id]?.name || id}的心思`);
    button.innerHTML = `${icon('mind')}<span>${h(state().entities[id]?.name || id)}</span>`;
    button.addEventListener('click', () => showMind(id)); list.append(button);
  }
  stage.append(list);
}
function toast(message: string) {
  if (!message) return;
  document.querySelector('.toast')?.remove();
  const element = document.createElement('div'); element.className = 'toast'; element.setAttribute('role', 'status'); element.textContent = message;
  document.body.append(element); clearTimeout(toastTimer); toastTimer = setTimeout(() => element.remove(), 5500);
}
function operation(path: string, data: Record<string, unknown> = {}) {
  const next = pendingOperation.then(async () => {
    busy = true; document.body.classList.add('busy'); app.setAttribute('aria-busy', 'true');
    try { return await api.post(path, data); }
    catch (error) { toast(error instanceof Error ? error.message : '这一场还没有接通。'); return null; }
    finally { busy = false; document.body.classList.remove('busy'); app.setAttribute('aria-busy', 'false'); }
  });
  pendingOperation = next;
  return next;
}
function home() {
  disposeScene(); page = 'home'; filmPaused = false;
  const s = state();
  app.innerHTML = `${header()}<main class="home-page"><section class="featured-work"><div class="feature-copy"><div class="edition-note"><span class="tiny-seal">魏</span><span>战国首作</span><span>邯郸之战与窃符救赵</span></div><h1>窃符</h1><p class="feature-line">有人守住王命，<br>有人想守住人。</p><p class="feature-description">一座被围的城。一块迟迟未至的兵符。<br>你是信陵君门下，一个新来的士。</p><div class="feature-actions"><button class="primary" data-action="start-qiefu">${icon('play')}<span>${s.story.started && !s.story.completed ? '接着演' : '进入这段历史'}</span></button><button class="text-button" data-action="start-prologue">先看《长平之后》</button></div><div class="feature-meta"><span>沈砚 导演</span><span>约 10 分钟</span><span>你的选择，会被记住</span></div></div><div id="hero-theatre" class="hero-theatre" aria-label="邯郸城立体场景"></div><div class="hero-callout"><span class="live-dot"></span>${s.events.length ? '这座城已经有你的痕迹' : '秦军围城，救兵止步于邺'}<small>约公元前 258 至前 257 年</small></div></section><section class="works-section"><div class="section-heading"><h2>同一座城，别的目光</h2><p>电影、游戏，都是你的世界的一面。</p></div><div class="work-shelf">${WORKS.filter(w => w.id !== 'qiefu').map(w => `<button class="work-book work-${w.style}" data-action="start-${w.id}"><div class="book-art">${svgSymbol(w.style)}<span class="book-title">${w.title}</span><span class="book-stamp">${w.director === '陆微' ? '陆' : '沈'}</span></div><div class="book-caption"><h3>${w.title}</h3><span>${w.type} / ${w.duration}</span><p>${w.note}</p><small>${w.director} 导演</small></div></button>`).join('')}${narrativeEvents().length ? `<button class="work-book work-replay" data-action="start-replay"><div class="book-art">${svgSymbol('seal')}<span class="book-title">你的后来</span><span class="book-stamp">录</span></div><div class="book-caption"><h3>你刚才做的事</h3><span>世界录制 / ${narrativeEvents().length} 段经历</span><p>换成别人的目光，再看你经过的那一夜。</p><small>从真实记录剪成</small></div></button>` : ''}</div></section><section class="home-footer"><button data-action="studio">${icon('film')}<span>走进片场<small>看看下一场为什么这样安排</small></span>${icon('arrow')}</button><button data-action="notes">${icon('book')}<span>导师写了几句话<small>${s.acknowledgments.includes('onboarded') ? '关于你的耐心、偏爱与选择' : '先认识你，再安排你的世界'}</small></span>${icon('arrow')}</button></section><footer class="credits-line"><span>史料与本作的历史，各有出处。</span><button data-action="sources">原史料与制作说明</button><button data-action="help">如何体验</button></footer></main><div id="overlay-root"></div>`;
  mountScene('city', [], 'hero-theatre');
}
async function startWork(id: WorkId) {
  work = id;
  if (id === 'studio') { studio(); return; }
  if (id === 'replay') { replayIndex = 0; replay(); return; }
  if (id === 'qiefu' && !state().story.started && !state().seenWorks.includes('prologue')) { work = 'qiefu'; prologueFrame = 0; filmElapsed = 0; await operation('presentation', { workId: 'prologue', sceneId: 'court' }); film(); return; }
  if (id === 'qiefu' && !state().acknowledgments.includes('onboarded')) { showOnboarding(); return; }
  if (id === 'qiefu') { await operation('presentation', { workId: 'qiefu', sceneId: ACTS[Math.min(Math.max(state().story.act - 1, 0), 3)].id }); if (state().nightRun?.workId === 'qiefu' && !state().nightRun?.finished) { nightStandalone = false; nightScene(); } else playAct(); }
  else if (id === 'prologue') { prologueFrame = 0; filmElapsed = 0; await operation('presentation', { workId: id, sceneId: 'court' }); film(); }
  else if (id === 'siege') {
    const cast = [...state().decisions].reverse().find(d => d.role === 'director' && d.sceneId === 'granary' && d.options.includes('keeper-suspicious'))?.selected;
    if (cast) keeper = cast;
    await operation('presentation', { workId: id, sceneId: state().events.some(e => e.intent.sceneId === 'siege-square') ? 'granary' : 'siege-square' });
    if (state().events.some(e => e.intent.sceneId === 'siege-square')) siege(); else siegeSquare();
  }
  else if (id === 'night') { await operation('presentation', { workId: id, sceneId: 'night' }); nightStandalone = true; nightScene(); }
}
function film() {
  disposeScene(); page = 'film'; filmPaused = false;
  const frame = PROLOGUE[prologueFrame];
  app.innerHTML = `<main class="film-page"><div id="theatre" class="film-stage"></div><div class="film-vignette"></div><div class="film-top"><button class="icon-button" data-action="home" aria-label="回到作品墙">${icon('close')}</button><span>沈砚 作品</span><button class="icon-button audio-toggle" data-action="audio" aria-label="开启或关闭声音">${icon(audio.enabled ? 'sound' : 'mute')}</button></div><div class="film-copy"><span>${frame.caption}</span><h1>${frame.title}</h1><p>${frame.line}</p></div><div class="film-controls"><button class="icon-button" data-action="film-pause" aria-label="暂停电影">${icon('pause')}</button><div class="film-track">${PROLOGUE.map((_, i) => `<span class="${i <= prologueFrame ? 'watched' : ''}"></span>`).join('')}</div><button class="text-button" data-action="film-next">${prologueFrame < PROLOGUE.length - 1 ? '下一幕' : '接过这场戏'} ${icon('arrow')}</button><button class="text-button film-skip" data-action="film-skip">跳过开场</button></div></main><div id="overlay-root"></div>`;
  mountScene(prologueFrame < 2 ? 'city' : 'court', prologueFrame >= 3 ? ['xinling', 'player'] : []);
}
async function afterFilm() {
  filmPaused = true;
  if (!state().acknowledgments.includes('onboarded')) { home(); showOnboarding(); }
  else { work = 'qiefu'; await operation('presentation', { workId: 'qiefu', sceneId: 'court' }); playAct(); }
}
function tick(delta: number) {
  if (page === 'film' && !filmPaused) {
    filmElapsed += delta;
    if (filmElapsed >= 12) { filmElapsed = 0; if (prologueFrame < 4) { prologueFrame++; film(); } else { filmPaused = true; void afterFilm(); } }
  }
  if (page === 'play' && night) night.tick(delta);
}
function playShell(name: string, place: string, cast: string[], scene: SceneKind, bottom: string) {
  disposeScene(); page = 'play'; filmPaused = false;
  app.innerHTML = `<main class="play-page"><div class="play-top"><button class="text-button" data-action="home">${icon('back')}作品墙</button><div><span class="scene-place">${place}</span><h1>${name}</h1></div><div class="play-tools"><button class="icon-button" data-action="play-pause" aria-label="暂停">${icon('pause')}</button><button class="icon-button audio-toggle" data-action="audio" aria-label="开启或关闭声音">${icon(audio.enabled ? 'sound' : 'mute')}</button><button class="icon-button" data-action="help" aria-label="操作说明">${icon('book')}</button></div></div><div class="stage-wrap"><div id="theatre" class="play-stage" tabindex="0" aria-label="${place}，可点人物看心思"></div><div class="stage-caption">${icon('mind')}<span>点一个人，看他此刻的心思</span></div></div><section class="play-bottom">${bottom}</section></main><div id="overlay-root"></div>`;
  mountScene(scene, cast);
}
function playAct() {
  if (state().story.completed || state().story.act >= 5) { ending(); return; }
  const act = ACTS[Math.min(Math.max(state().story.act - 1, 0), 3)];
  currentScene = act.id;
  if (act.id === 'night') { nightStandalone = false; nightScene(); return; }
  playShell(act.name, act.place, act.cast, act.scene, `<div class="dialogue"><span>${act.speaker}</span><p>${lastMessage || act.line}</p></div><div class="choice-table">${act.choices.map(c => `<button class="object-choice" data-action="story-choice" data-choice="${c.id}" title="${c.hint}"><span class="object-illustration">${icon(c.item)}</span><strong>${c.label}</strong><small>${c.hint}</small></button>`).join('')}</div><div class="play-footnote"><span>${state().budget.tier === 'brief' ? '这一场一笔带过' : '你决定意图，人物决定怎样回应'}</span><button class="text-button" data-action="tier">换这一场的深度</button></div>`);
  lastMessage = '';
}
async function storyChoice(choice: string) {
  const act = ACTS[Math.min(Math.max(state().story.act - 1, 0), 3)];
  const c = act.choices.find(x => x.id === choice); if (!c) return;
  const result = await operation('intent', { intent: { verb: c.verb, actorId: 'player', targetId: c.target, choice: c.id, itemId: c.item === 'moon' ? undefined : c.item === 'wine' ? 'wine' : c.item === 'letter' ? 'bamboo' : c.item, workId: 'qiefu', sceneId: act.id } });
  if (!result) return;
  audio.cue('choice'); lastMessage = '';
  toast(result.message || '这句话已经留在他心里。');
  playAct();
}
function nightScene() {
  currentScene = 'night'; nightFinished = false;
  playShell('取符之夜', '大梁 · 魏宫', ['ruji', 'player'], 'night', `<div class="night-objective"><div><span class="objective-seal">${icon('seal')}</span><strong id="night-goal">取走寝殿的兵符，再回到左侧门外</strong><small id="night-status">避开灯光，屏风与石台能遮住你。</small></div><div class="exposure"><span id="exposure-label">无人看见</span><div><span id="exposure-fill"></span></div></div></div><div class="night-controls"><div class="touch-pad" aria-label="移动方向"><button data-key="arrowup" aria-label="向前">↑</button><button data-key="arrowleft" aria-label="向左">←</button><button data-key="arrowdown" aria-label="向后">↓</button><button data-key="arrowright" aria-label="向右">→</button></div><button class="crouch-button" data-action="crouch" aria-pressed="false">${icon('moon')}放轻脚步</button><span class="keyboard-help">方向键 / WASD 移动<br>Shift 放轻脚步 · 也可点地面</span><button class="text-button" data-action="night-wait">留在门外</button></div>`);
  night = new NightGame(view => { void finishNight(view.detected, view.obtained); }, view => {
    theatre?.updateNight(view);
    const fill = document.getElementById('exposure-fill'); if (fill) fill.style.width = `${view.exposure * 100}%`;
    const label = document.getElementById('exposure-label'); if (label) label.textContent = view.exposure > 0.02 ? '有人望向这里' : view.hiding ? '藏在屏风后' : '无人看见';
    const goal = document.getElementById('night-goal'); if (goal && view.obtained) goal.textContent = '兵符在手。沿来路回到左侧门外。';
  });
  const saved = state().nightRun;
  if (saved && saved.workId === (nightStandalone ? 'night' : 'qiefu') && !saved.finished) night.restore(saved.frames);
  theatre?.updateNight(night.view);
  document.querySelectorAll<HTMLElement>('[data-key]').forEach(button => {
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); night?.key(button.dataset.key!, true); });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(eventName, () => night?.key(button.dataset.key!, false));
  });
}
async function finishNight(detected: boolean, obtained: boolean) {
  if (nightFinished) return;
  nightFinished = true; if (night) night.paused = true;
  const result = await operation('night-run', { frames: night?.frames() || [], workId: nightStandalone ? 'night' : 'qiefu', finish: true, abandoned: !night?.view.finished });
  if (!result) { nightFinished = false; if (night) night.paused = false; return; }
  audio.cue(detected ? 'alarm' : 'seal');
  showOverlay(`<div class="moment-result"><span class="large-seal">${detected ? '痕' : obtained ? '符' : '等'}</span><h2>${detected ? '有人看见了这一夜' : obtained ? '半块兵符，终于到了你手里' : '这一夜，你留在门外'}</h2><p>${h(result.message || (detected ? '这不是终止。你的迟疑，会成为别人的记忆。' : '如姬的名字，留在了这段经历里。'))}</p><p class="muted">${detected || !obtained ? '成因链已经改变。接下来的，是本作的历史。' : '兵符会去往邺，那里仍有一个人在等证据。'}</p><button class="primary" data-action="${nightStandalone ? 'night-result-home' : 'next-act'}">${nightStandalone ? '回作品墙看后果' : '去邺城'}${icon('arrow')}</button><button class="text-button" data-action="night-retry">从门外再来一次</button></div>`, false);
}
function siegeSquare() {
  currentScene = 'siege-square'; work = 'siege';
  playShell('围城', '邯郸 · 家库门前', ['lichong', 'pingyuan', 'citizen', 'player'], 'city', `<div class="dialogue"><span>李同</span><p>城里的人已经炊骨易子。君上的财物若留下，人还能等到援军吗？</p></div><div class="choice-table relief-choices"><button class="object-choice" data-action="relief" data-choice="distribute"><span class="object-illustration">${icon('pledge')}</span><strong>请他打开家库</strong><small>让家财先到城民手里</small></button><button class="object-choice" data-action="relief" data-choice="hold"><span class="object-illustration">${icon('letter')}</span><strong>劝他暂留家财</strong><small>看李同如何回应</small></button></div><div class="play-footnote"><span>据《史记·平原君虞卿列传》；门客的介入属于本作。</span><button class="text-button" data-action="sources">看原史料</button></div>`);
}
function siege() {
  currentScene = 'granary'; work = 'siege';
  const actor = state().entities[keeper];
  const remembered = state().events.filter(e => e.intent.sceneId === 'granary' && e.intent.choice).length;
  const consequential = state().story.nightDetected ? '有人说魏宫出了声响，救兵恐怕又迟了。' : state().story.sealObtained ? '城外传来一句话：兵符已经离宫。守仓人把明日的借条留了下来。' : '门外又有人借粮。账上的数，与仓里的数，差了两袋。';
  playShell('围城', '邯郸 · 暮色粮仓', [keeper, 'borrower', 'player'], 'granary', `<div class="perspective-switch" role="group" aria-label="观察视角"><button class="${perspective === 'player' ? 'selected' : ''}" data-action="perspective" data-value="player">你的目光</button><button class="${perspective === keeper ? 'selected' : ''}" data-action="perspective" data-value="${keeper}">${h(actor.name)}的目光</button><button data-action="swap">${icon('reset')}同一件事，换个人</button></div><div class="dialogue"><span>${perspective === 'player' ? '借粮者' : h(actor.name)}</span><p>${lastMessage || (perspective === 'player' ? consequential : getMind(state(), keeper).reason)}</p></div><div class="choice-table"><button class="object-choice" data-action="grain-choice" data-choice="seal"><span class="object-illustration">${icon('seal')}</span><strong>递出印信</strong><small>让他核验身份</small></button><button class="object-choice" data-action="grain-choice" data-choice="letter"><span class="object-illustration">${icon('letter')}</span><strong>递出借条</strong><small>把明日写下来</small></button><button class="object-choice" data-action="grain-choice" data-choice="pledge"><span class="object-illustration">${icon('pledge')}</span><strong>递出担保物</strong><small>用自己的人情换粮</small></button></div><div class="play-footnote"><span>${remembered ? `已留下 ${remembered} 次交接。下次，他还记得。` : '第一次交接，他还不认识你。'} 仓中余 ${state().resources.granary.grain} 袋；每个粮堆代表两袋。</span><button class="text-button" data-action="speech">靠近，说一句话</button><button class="text-button" data-action="siege-history">看看留下了什么</button></div>`);
  if (perspective !== 'player') theatre?.focusCharacter(keeper);
  bindDragObjects();
  lastMessage = '';
}
function bindDragObjects() {
  for (const button of document.querySelectorAll<HTMLElement>('[data-action="grain-choice"]')) {
    let start: { x: number; y: number } | null = null;
    button.addEventListener('pointerdown', event => { start = { x: event.clientX, y: event.clientY }; button.setPointerCapture(event.pointerId); });
    button.addEventListener('pointerup', event => {
      if (start && Math.hypot(start.x - event.clientX, start.y - event.clientY) > 50) {
        event.preventDefault(); event.stopPropagation(); button.dataset.dragged = 'yes'; void grainChoice(button.dataset.choice!);
      }
      start = null;
    });
    button.addEventListener('pointercancel', () => { start = null; });
  }
}
async function grainChoice(choice: string) {
  const result = await operation('intent', { intent: { verb: 'give', actorId: 'player', targetId: keeper, itemId: choice, amount: 2, choice, sceneId: 'granary', workId: 'siege' } });
  if (!result) return;
  lastMessage = result.message || '他接过东西，在账册前停了一下。'; audio.cue(); siege();
}
function traceHtml(trace: MindTrace) {
  return `<div class="mind-thought"><span>${h(trace.emotion)}</span><p>${h(trace.reason)}</p></div><div class="mind-channel" aria-label="心智三层通道">${[...trace.layers].reverse().map(layer => `<button class="mind-layer" data-action="layer" data-layer="${layer.layer}" style="--accepted:${Math.min(100, Math.max(0, layer.accepted / Math.max(0.001, layer.accepted + layer.remaining) * 100))}%;--brightness:${0.35 + Math.min(1, layer.accepted / Math.max(0.001, layer.accepted + layer.remaining)) * 0.65}"><span class="layer-glyph">${layer.layer === 'mind' ? '心' : layer.layer === 'module' ? '合' : '感'}</span><div><strong>${h(layer.label)}</strong><small>${h(layer.strategy)}</small><div class="channel-bar" title="接住 ${layer.accepted.toFixed(2)}，剩余 ${layer.remaining.toFixed(2)}"><span></span></div></div><span class="layer-arrow">${icon('eye')}</span></button>`).join('')}</div><div class="mind-action">${icon('arrow')}<span>他接下来想<strong>${h(trace.action)}</strong></span></div><details class="mind-details"><summary>为什么停在这里</summary><div>${trace.layers.map(l => `<p><strong>${h(l.label)}</strong> 读到「${h(trace.input)}」，预期「${h(l.prediction)}」。${h(l.parameterUpdate)}</p>`).join('')}<div class="comparison-table"><table><thead><tr><th>层</th><th>输入误差</th><th>接住</th><th>剩余</th><th>精度</th></tr></thead><tbody>${trace.layers.map(l => `<tr><td>${h(l.label)}</td><td>${l.error.toFixed(3)}</td><td>${l.accepted.toFixed(3)}</td><td>${l.remaining.toFixed(3)}</td><td>${l.precision.toFixed(3)}</td></tr>`).join('')}</tbody></table></div><p>${trace.otherModel ? `他以为 ${h(state().entities[trace.otherModel.actorId]?.name)} 会 ${h(trace.otherModel.expectation)}` : '这一刻，他还没有揣测别人。'}</p></div></details>`;
}
function showMind(id: string) {
  if (!state().entities[id]) return;
  openMindActor = id; theatre?.focusCharacter(id);
  const actor = state().entities[id], trace = getMind(state(), id);
  if (state().budget.tier === 'brief') { showOverlay(`<h2>${h(actor.name)}</h2><p>${h(trace.action)}</p><p class="muted">这一场一笔带过：省去深层揣测与现场对白。行为与凭证仍会写下。</p>`); return; }
  showOverlay(`<div class="mind-entry"><span class="mini-label">这一刻，他心里</span><h2>${h(actor.name)}</h2><p class="muted">${h(actor.description)}</p>${traceHtml(trace)}<details class="mind-details"><summary>他知道什么，从哪里知道</summary>${getActorView(state(), id).slice(-8).map(c => `<p>${h(c.text)}<small>${channelName(c)}${c.evidence[0] ? ` · ${h(c.evidence[0].location)}` : ''}</small></p>`).join('') || '<p>他尚未亲历新的事。</p>'}</details><button class="text-button" data-action="wiki-person" data-actor="${id}">翻开他的人物志 ${icon('book')}</button></div>`);
}
function channelName(c: Claim) { return ({ witnessed: '亲眼见到', told: '听人说的', public: '公开的记述', setting: '史料与设定' })[c.channel]; }
function showOverlay(content: string, closable = true) {
  const root = document.getElementById('overlay-root') || (() => { const e = document.createElement('div'); e.id = 'overlay-root'; document.body.append(e); return e; })();
  overlayReturnFocus = document.activeElement as HTMLElement;
  root.innerHTML = `<div class="overlay-backdrop"><section class="overlay-sheet" role="dialog" aria-modal="true" aria-label="剧场中的书页">${closable ? `<button class="icon-button overlay-close" data-action="close-overlay" aria-label="合上书页">${icon('close')}</button>` : ''}${content}</section></div>`;
  root.querySelector<HTMLElement>('button,input')?.focus();
  if (night) { night.paused = true; night.clearInput(); }
}
function closeOverlay() {
  const root = document.getElementById('overlay-root'); if (root) root.innerHTML = '';
  openMindActor = null; if (night && !nightFinished) night.paused = false;
  overlayReturnFocus?.focus(); overlayReturnFocus = null;
}
function showOnboarding() {
  showOverlay(`<div class="notes-intro"><span class="mini-label">第一次见面</span><h2>先认识你，<br>再安排这一场。</h2><p>三个很粗的问题。以后可以在笔记里改。</p><form id="onboarding-form"><fieldset><legend>这段故事，你愿意等吗？</legend><label><input type="radio" name="patience" value="now" checked>现在就想进场</label><label><input type="radio" name="patience" value="later">愿意等细细打磨</label></fieldset><fieldset><legend>你更想要什么？</legend><label><input type="radio" name="freedom" value="open" checked>让人能出乎意料</label><label><input type="radio" name="freedom" value="crafted">一段精心安排的故事</label></fieldset><fieldset><legend>想看多深的心思？</legend><label><input type="radio" name="detail" value="detailed">细演，看见犹豫</label><label><input type="radio" name="detail" value="normal" checked>普通，留出余地</label><label><input type="radio" name="detail" value="brief">一笔带过，先看后来</label></fieldset><button class="primary" type="submit">写进笔记，开始 ${icon('arrow')}</button></form></div>`, false);
  document.getElementById('onboarding-form')!.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.target as HTMLFormElement);
    const result = await operation('preferences', { preferences: { patience: data.get('patience'), freedom: data.get('freedom'), detail: data.get('detail'), surprises: data.get('freedom') === 'open' } });
    if (!result) return; closeOverlay(); work = 'qiefu'; await operation('presentation', { workId: 'qiefu', sceneId: 'court' }); playAct();
  });
}
function ending() {
  currentScene = 'ending'; work = 'qiefu';
  const s = state();
  const historical = s.story.ending === 'historical';
  const rescued = s.claims.some(c => c.predicate === 'work.siege' && c.value === 'relieved' && c.status === 'active');
  const title = historical ? '邯郸，解围了。' : s.story.jinbiFate === 'alive' && rescued ? '城得救了，有人活了下来。' : '这一夜，改变了后来。';
  playShell('史 · 与你亲历的那一版', '邯郸 · 天光渐起', ['xinling', 'houying', 'player'], 'city', `<div class="ending-copy"><span class="mini-label">${historical ? '沿史书所载的结构' : '本作的历史'}</span><h2>${title}</h2><p>${historical ? '朱亥击杀晋鄙，信陵君夺军救赵。侯嬴北向自刎，以自己的方式送了公子最后一程。' : rescued ? '你给晋鄙多留了一次核验。他承担了放行的责任，铁椎没有落下。这段经过，属于你在场的这一版。' : '兵符或献计的环节断了。人们不得不寻找另一条路，邯郸在本作中没有等到同样的救援。'}</p><div class="history-fold"><details><summary>史书所载</summary><p>《史记·魏公子列传》记载：晋鄙合符而疑，朱亥以铁椎击杀，公子勒兵，选兵八万人，进兵击秦，救邯郸，存赵。侯嬴在约定之日北乡自刭。</p></details><details><summary>你亲历的</summary>${s.events.filter(e => e.intent.workId === 'qiefu').map(e => `<p>${h(e.summary)}</p>`).join('')}</details></div><div class="ending-actions"><button class="primary" data-action="start-replay">${icon('film')}把你做过的事，看成电影</button><button class="text-button" data-action="studio">坐进导演椅</button><button class="text-button" data-action="start-siege">看看城里的人</button></div></div>`);
  theatre?.pullBack(true);
}
function narrativeEvents() { return state().events.filter(e => e.intent.sceneId !== '@kernel'); }
function replay() {
  disposeScene(); page = 'replay'; work = 'replay';
  const events = narrativeEvents();
  if (!events.length) { home(); toast('先在一部作品里留下选择，电影就有了自己的来处。'); return; }
  replayIndex = Math.min(replayIndex, events.length - 1);
  const event = events[replayIndex];
  const actorId = event.traces[0]?.actorId || event.intent.targetId || 'xinling';
  const actor = state().entities[actorId];
  const scene = ({ granary: 'granary', night: 'night', court: 'court', gate: 'gate', camp: 'camp' } as Record<string, SceneKind>)[event.intent.sceneId] || 'city';
  app.innerHTML = `<main class="film-page replay-page"><div id="theatre" class="film-stage"></div><div class="film-vignette"></div><div class="film-top"><button class="icon-button" data-action="home" aria-label="回到作品墙">${icon('close')}</button><span>你的世界 · 真实经历录制</span><button class="icon-button" data-action="audio" aria-label="开启或关闭声音">${icon(audio.enabled ? 'sound' : 'mute')}</button></div><div class="film-copy"><span>${h(actor?.name || '在场的人')}的目光</span><h1>${h(event.intent.sceneId === 'night' ? '那一夜' : event.intent.sceneId === 'granary' ? '那两袋粮' : '那一句话')}</h1><p>${h(event.traces[0]?.reason || event.summary)}</p><small>你当时：${h(event.summary)}</small></div><div class="film-controls"><button class="text-button" data-action="replay-prev" ${replayIndex === 0 ? 'disabled' : ''}>${icon('back')}前一段</button><span>${replayIndex + 1} / ${events.length}</span><button class="text-button" data-action="replay-next">${replayIndex < events.length - 1 ? '下一段' : '回作品墙'}${icon('arrow')}</button><button class="text-button" data-action="replay-source">这段电影的出处</button></div></main><div id="overlay-root"></div>`;
  try {
    const recorded = replayEvents(createWorld(state().seed), state().events.slice(0, state().events.findIndex(e => e.id === event.id) + 1));
    mountScene(scene, [actorId, 'player'].filter(x => recorded.entities[x]), 'theatre', recorded);
  } catch {
    // Keep the recorded words available if an older import cannot be reconstructed;
    // displaying today's scene as yesterday's would invent evidence.
    document.getElementById('theatre')!.textContent = '这段旧记录无法重建当时的画面；文字出处仍保留。';
  }
}
function wiki() {
  disposeScene(); page = 'wiki';
  const people = Object.values(state().entities).filter(e => e.kind === 'person' && e.role !== 'director' && e.role !== 'mentor');
  const actor = state().entities[wikiActor] || people[0]; wikiActor = actor.id;
  const claims = getActorView(state(), actor.id);
  const experiences = state().experiences.filter(e => e.actorId === actor.id);
  app.innerHTML = `${header()}<main class="folio-page"><div class="folio-heading"><span class="mini-label">每个人相信的世界</span><h1>人物志</h1><p>听过的话、亲历的事，未必是同一种历史。</p></div><div class="wiki-layout"><aside class="person-roster" aria-label="人物名册">${people.map(e => `<button class="${e.id === actor.id ? 'selected' : ''}" data-action="wiki-select" data-actor="${e.id}"><span class="person-mark" style="--robe:${e.appearance?.color || '#749f91'}">${h(e.name.slice(-1))}</span><span>${h(e.name)}</span></button>`).join('')}</aside><article class="person-folio"><div class="person-heading"><span class="person-avatar" style="--robe:${actor.appearance?.color || '#749f91'}">${h(actor.name.slice(-1))}</span><div><h2>${h(actor.name)}</h2><p>${h(actor.description)}</p></div><button class="icon-button" data-action="mind" data-actor="${actor.id}" aria-label="看心思">${icon('mind')}</button></div><div class="person-skills"><span>随身的性情与手艺</span><p>${h(actor.skills?.join('、') || '观察、记忆与回应')}</p><small>这些可以携带。具体经历由世界主人逐条决定。</small></div><section class="beliefs"><h3>他相信什么</h3>${claims.length ? claims.map(c => claimHtml(c)).join('') : '<p class="muted">新的经历尚未发生。</p>'}</section><section class="memories"><h3>他亲历过的</h3>${experiences.map(e => `<p><span>第 ${e.day + 1} 日</span>${h(e.summary)}</p>`).join('') || '<p class="muted">等你与他相遇，经历会留在这里。</p>'}</section><section class="former-beliefs"><h3>曾经的共识</h3>${state().claims.filter(c => c.status === 'former-consensus' && (c.holders.includes(actor.id) || c.channel === 'public')).map(claimHtml).join('') || '<p class="muted">还没有被证据推翻的旧共识。</p>'}</section><section class="relationships"><h3>他与别人</h3>${Object.entries(state().relationships).filter(([key]) => key.includes(actor.id)).slice(0, 6).map(([key, value]) => `<p>${h(key.split(':').filter(id => id !== actor.id).map(id => state().entities[id]?.name || id).join(' 与 '))}<span>${value > 0.65 ? '愿意信任' : value > 0.35 ? '仍在试探' : '还有疑虑'}</span></p>`).join('') || '<p>相遇之后，认可才会慢慢长出来。</p>'}</section></article></div></main><div id="overlay-root"></div>`;
}
function claimHtml(c: Claim) {
  return `<details class="claim-entry ${c.status === 'former-consensus' ? 'former' : ''}"><summary><span>${h(c.text)}</span><small>${c.status === 'former-consensus' ? '曾经的共识' : c.status === 'disputed' ? '仍有争议' : channelName(c)}</small></summary><div><p>持有者：${c.holders.map(id => h(state().entities[id]?.name || id)).join('、')}</p>${c.evidence.map(e => `<p class="source-quote">「${h(e.quote)}」<small>${h(e.location)} / ${h(e.sourceId)}</small></p>`).join('')}<p class="muted">被 ${c.citations.length} 部呈现引用；推翻需处理 ${c.dependencies.length} 个依赖。${c.supersedes ? `修订自 ${h(c.supersedes)}` : ''}</p></div></details>`;
}
function notes() {
  disposeScene(); page = 'notes'; const s = state();
  app.innerHTML = `${header()}<main class="folio-page notes-page"><div class="folio-heading"><span class="mini-label">他当时的说法</span><h1>导师的笔记</h1><p>这些是他对你的了解。你可以随时更正。</p></div><div class="notebook"><div class="notebook-main"><p class="handwritten">${s.preferences.freedom === 'open' ? '你似乎愿意给人一点自由，看看意料之外会发生什么。' : '你想要的，是一段有人认真打磨过的故事。'}<br>${s.preferences.patience === 'now' ? '你想现在就进场。我先把能演的交给你。' : '你愿意等。我会把有分量的那几刻留得更细。'}</p><form id="preferences-form"><fieldset><legend>愿意等多久</legend><label><input type="radio" name="patience" value="now" ${s.preferences.patience === 'now' ? 'checked' : ''}>现在进场</label><label><input type="radio" name="patience" value="later" ${s.preferences.patience === 'later' ? 'checked' : ''}>等细细打磨</label></fieldset><fieldset><legend>偏爱怎样的故事</legend><label><input type="radio" name="freedom" value="open" ${s.preferences.freedom === 'open' ? 'checked' : ''}>让人物出乎意料</label><label><input type="radio" name="freedom" value="crafted" ${s.preferences.freedom === 'crafted' ? 'checked' : ''}>精心安排节拍</label></fieldset><fieldset><legend>下一场的深度</legend>${(['detailed', 'normal', 'brief'] as const).map(t => `<label><input type="radio" name="detail" value="${t}" ${s.preferences.detail === t ? 'checked' : ''}>${tierName(t)}</label>`).join('')}</fieldset><button class="primary" type="submit">更正这几句话 ${icon('check')}</button></form></div><aside class="notebook-margin"><h3>写下来的决定</h3>${s.decisions.filter(d => d.role === 'mentor').slice(-5).reverse().map(d => `<article><small>第 ${d.day + 1} 日 / ${h(d.sceneId)}</small><p>所选：${h(tierName(d.selected))}</p><details><summary>他当时的说法</summary><p>${h(d.reason)}</p><small>当时输入：${h(JSON.stringify(d.input))}</small></details></article>`).join('') || '<p>等你进场，他会当场写下第一条决定。</p>'}<details class="resource-note"><summary>真实算力与录制方式</summary><p>对话上限每小时 30 次，设想 6 次，改造 1 次。用完后心智退到规则层，戏会继续。</p><p>已发生现场调用 ${s.budget.ledger.filter(l => l.source === 'live').length} 次，录制复用 ${s.budget.ledger.filter(l => l.cached).length} 次。${s.budget.degraded ? '本场已简化。' : ''}</p><p>本小时尝试：对白 ${s.budget.dialogue}/${s.budget.limits.dialogue}，设想 ${s.budget.imagination}/${s.budget.limits.imagination}，改造 ${s.budget.modification}/${s.budget.limits.modification}。</p><p>接入网关时记录模型、实际 token 和延迟；价格未配置时不把 0 当作免费。</p><div class="comparison-table"><table><thead><tr><th>模型与用途</th><th>输入 / 输出</th><th>毫秒</th><th>费用</th></tr></thead><tbody>${s.budget.ledger.filter(l => l.model !== 'finite-state-v1').slice(-12).map(l => `<tr><td>${h(l.model)}<small>${l.kind} · ${l.accepted === false ? '未采用' : l.source === 'live' ? '现场' : l.cached ? '录制复用' : '规则'}</small></td><td>${l.usageKnown === false ? '待对账' : `${l.inputTokens} / ${l.outputTokens}`}</td><td>${l.latencyMs}</td><td>${l.usageKnown === false ? '待对账' : l.priceKnown ? l.cost.toFixed(6) : '未配置单价'}</td></tr>`).join('')}</tbody></table></div></details></aside></div><div class="notes-actions"><button class="text-button" data-action="export">${icon('download')}带走这份世界记录</button><label class="text-button import-button">${icon('book')}接续一份记录<input id="world-import" type="file" accept="application/json,.json" hidden></label><button class="text-button" data-action="clock">让一季过去</button><button class="text-button danger-text" data-action="reset-confirm">从新的演出开始</button></div></main><div id="overlay-root"></div>`;
  document.getElementById('preferences-form')!.addEventListener('submit', async event => { event.preventDefault(); const d = new FormData(event.target as HTMLFormElement); const result = await operation('preferences', { preferences: { patience: d.get('patience'), freedom: d.get('freedom'), detail: d.get('detail'), surprises: d.get('freedom') === 'open' } }); if (result) { notes(); toast(result.message!); } });
  document.getElementById('world-import')!.addEventListener('change', async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { const bundle = JSON.parse(await file.text()); const result = await operation('import', { bundle }); if (result) { notes(); toast(result.message!); } } catch { toast('记录未能读取。请选择从剧场导出的 JSON 文件。'); } });
}
function tierName(t: string) { return ({ detailed: '细演', normal: '普通', brief: '一笔带过' } as Record<string, string>)[t] || t; }
function studio() {
  disposeScene(); page = 'studio'; work = 'studio';
  const s = state(), checks = checkConsistency(s);
  const mechanism = s.mechanisms.find(m => m.installed);
  const pending = s.reversals.filter(r => r.status === 'pending');
  const logged = s.decisions.filter(d => d.role === 'director');
  app.innerHTML = `${header()}<main class="folio-page studio-page"><div class="folio-heading"><span class="mini-label">沈砚的片场</span><h1>故事怎样发生</h1><p>分镜桌上的每一个决定，都在当时写下。</p></div><div class="studio-layout"><div class="studio-diorama"><div id="theatre"></div><div class="director-note"><span class="tiny-seal">沈</span><p>「人先活过，<br>镜头才有分量。」</p></div></div><section class="studio-desk"><h2>下一场，排给谁</h2><p>${s.story.directorUnlocked ? '你做过的事被人记住了。导演愿意让你试着排一场。' : '先留下一次有分量的选择，导演才会把这张椅子留给你。'}</p><div class="cast-choices"><button data-action="cast" data-actor="keeper-suspicious" ${!s.story.directorUnlocked ? 'disabled' : ''}>${icon('mind')}多疑的守仓人<small>先核凭据，再想人心</small></button><button data-action="cast" data-actor="keeper-impatient" ${!s.story.directorUnlocked ? 'disabled' : ''}>${icon('arrow')}急躁的守仓人<small>先找那个人，当面追问</small></button></div><h3>他学会了哪一种办法</h3><p>${mechanism ? '守仓人先把印信摆在桌上，再接借条。上次的误差，让他改了核验的顺序。' : '重复的两袋缺额还在。可以把核验的办法试作一次，看看它是否真的省掉协调。'}</p><button class="text-button" data-action="mechanism">${mechanism ? '看看这办法的来由' : '试作核验办法'}${icon('eye')}</button><button class="text-button" data-action="benchmark">同一缺额，换人对照</button></section></div><section class="storyboards"><div class="section-heading"><h2>当时的分镜</h2><span>输入与所选为记录；理由是他当时的说法。</span></div>${logged.length ? logged.slice(-8).reverse().map(d => `<article class="storyboard"><div><span class="tiny-seal">${h(d.sceneId.slice(0, 1))}</span><small>第 ${d.day + 1} 日</small></div><div><strong>${h(s.entities[d.actorId || 'director']?.name || '导演')} · ${h(d.sceneId)} / ${h(d.selected)}</strong><p>${h(d.reason)}</p><details><summary>展开真实决定记录</summary><pre>${h(JSON.stringify({ input: d.input, options: d.options, selected: d.selected }, null, 2))}</pre></details></div></article>`).join('') : '<p class="muted">进过一场戏，分镜桌上才会有记录。</p>'}</section><section class="reversal-desk"><h2>有证据，旧说法才会翻页</h2><p>把原账册和现场录制放在一起。认可越多，引用越多，需要解释和重算的也越多。</p><button class="text-button" data-action="propose-reversal">把交接的原记录摆上桌</button>${pending.map(r => `<article class="reversal-card"><h3>等待导演认可</h3><p>${h(r.explanation)}</p><p class="muted">需要重算 ${r.dependentIds.length} 条依赖，旧共识将保留。</p><button class="primary" data-action="approve-reversal" data-id="${r.id}">认可证据，安排反转 ${icon('check')}</button></article>`).join('')}${s.reversals.filter(r => r.status === 'approved').map(r => `<p class="approved-reversal">${icon('check')}已经翻页：${h(r.explanation)}</p>`).join('')}</section><details class="integrity-book"><summary>${icon(checks.ok ? 'check' : 'eye')}世界一致性检验</summary>${checks.checks.map(c => `<p>${c.passed ? '✓' : '×'} ${h(c.name)}<small>${h(c.detail)}</small></p>`).join('')}<p>这些结论是在这个世界里成立的假设，不能直接作为历史真相。</p></details></main><div id="overlay-root"></div>`;
  mountScene('studio', ['director', 'director-lu']);
}
function benchmark() {
  const b = runSwapBenchmark(state());
  showOverlay(`<div class="benchmark-page"><span class="mini-label">在这个世界里成立的假设</span><h2>同一件事，换个人</h2><p>同样缺两袋粮，信息在两个人身上停在不同的地方。</p><div class="swap-columns">${[['多疑的守仓人', b.cases[0]?.suspicious], ['急躁的守仓人', b.cases[0]?.impatient]].map(([title, trace]) => `<article><h3>${title}</h3>${trace ? traceHtml(trace as MindTrace) : ''}</article>`).join('')}</div><details><summary>五次可重做的交接对照</summary><div class="comparison-table"><table><thead><tr><th>同样的输入</th><th>多疑的人</th><th>急躁的人</th></tr></thead><tbody>${b.cases.map(c => `<tr><td>${h(c.input)}</td><td>${h(c.suspicious.action)}</td><td>${h(c.impatient.action)}</td></tr>`).join('')}</tbody></table></div><p>${b.different} / ${b.total} 次出现行为差异。基线：${h(b.baseline)}</p></details><p class="muted">${h(b.hypothesis)}</p><button class="primary" data-action="swap-return">让另一位守仓人出场 ${icon('arrow')}</button></div>`);
}
function mechanismSheet() {
  const m = state().mechanisms.find(x => x.installed) || state().mechanisms.at(-1);
  if (!m) {
    const count = state().events.filter(e => e.intent.sceneId === 'granary' && e.intent.choice).length;
    showOverlay(`<span class="mini-label">从经历里长出来的办法</span><h2>先核印信，再接借条</h2><p>把至少五次交接放在一起，以同样的轨迹对照旧办法。只读声明过的字段，不带玩家原话。</p><p>你已留下 ${count} 次粮仓交接。</p><p class="muted">重复协调至少减少五分之一，而且没有越界或失败，才安装。</p><button class="primary" data-action="install-mechanism">试作、对照并安装 ${icon('check')}</button>`);
    return;
  }
  showOverlay(`<span class="mini-label">${m.installed ? '守仓人正在用的办法' : '已经换回旧办法'}</span><h2>${h(m.name)}</h2><p>版本 ${m.version}。出自 ${h(m.source)}。</p><p>旧协调 ${m.coordinationBefore} 步，新协调 ${m.coordinationAfter} 步，减少 ${Math.round((1 - m.coordinationAfter / m.coordinationBefore) * 100)}%。</p><ol class="mechanism-audit">${m.audit.map(a => `<li><strong>${a.passed ? '✓' : '×'} ${h(a.step)}</strong><p>${h(a.detail)}</p></li>`).join('')}</ol><details><summary>已安装的有限声明</summary><pre>${h(JSON.stringify({ fields: m.fields, rules: m.rules }, null, 2))}</pre></details><details><summary>送给改造者的真实请求</summary><pre>${h(JSON.stringify(buildModificationRequest(state()), null, 2))}</pre></details><div class="ending-actions"><button class="primary" data-action="start-siege">回粮仓，再遇一次缺额</button>${m.installed ? `<button class="text-button" data-action="rollback-mechanism" data-id="${m.id}">换回旧办法</button>` : ''}</div>`);
}
function speechSheet() {
  showOverlay(`<span class="mini-label">以门客的身份说话</span><h2>靠近${h(state().entities[keeper].name)}</h2><p>话是证言。他信不信，由自己的心思决定。</p><form id="speech-form"><label for="speech-text">你想对他说什么</label><textarea id="speech-text" maxlength="500" placeholder="这两袋粮，是留给城里的人。" required></textarea><button type="submit" class="primary">递出这句话 ${icon('arrow')}</button></form><div id="speech-response" aria-live="polite"></div>`);
  document.getElementById('speech-form')!.addEventListener('submit', async event => {
    event.preventDefault(); const text = (document.getElementById('speech-text') as HTMLTextAreaElement).value;
    const result = await operation('speech', { actorId: keeper, text, sceneId: 'granary', workId: 'siege' });
    if (result) { document.getElementById('speech-response')!.innerHTML = `<div class="dialogue"><span>${h(state().entities[keeper].name)}</span><p>${h(result.message)}</p></div><small>${(result.response as { source?: string })?.source === 'live' ? '根据他此刻的心思，现场说出' : '根据已录制的心思接续'}</small>`; audio.cue(); }
  });
}
function help() {
  showOverlay(`<span class="mini-label">只需要决定大方向</span><h2>怎么进这场戏</h2><div class="help-row">${icon('seal')}<p>递一件东西，就是一个意图。粮仓里的印信也可以拖向场景。</p></div><div class="help-row">${icon('mind')}<p>点人物或长按场景里的人，看他真实的心思。再点一层，可以看预期与误差。</p></div><div class="help-row">${icon('moon')}<p>取符之夜用方向键、WASD、屏幕方向键或点地面移动。Shift 或「放轻脚步」让动作更慢。</p></div><div class="help-row">${icon('film')}<p>做过的事会留下记录。作品墙上的「你的后来」从这些记录拍成电影。</p></div><p class="muted">可以随时暂停和离开。本机剧场会保存进度。第一版不开放角色游历、多世界或完整科研。</p>`);
}
function sources() {
  showOverlay(`<span class="mini-label">史料、设计与出处</span><h2>这段历史，从哪里来</h2><p>魏公子无忌、侯嬴、如姬、晋鄙与朱亥取自原史料；玩家门客与对话细节属于本作设计。</p><div class="sources-list"><a href="https://zh.wikisource.org/wiki/史記/卷077" target="_blank" rel="noopener">《史记·魏公子列传》${icon('arrow')}</a><blockquote>「乃使人止晋鄙，留军壁邺」<br>「如姬果盗晋鄙兵符与公子」<br>「选兵八万人，进兵击秦军」</blockquote><a href="https://zh.wikisource.org/wiki/史記/卷076" target="_blank" rel="noopener">《史记·平原君虞卿列传》${icon('arrow')}</a><blockquote>「今邯郸之民，炊骨易子而食」</blockquote><a href="https://zh.wikisource.org/wiki/史記/卷073" target="_blank" rel="noopener">《史记·白起王翦列传》${icon('arrow')}</a><a href="https://zh.wikisource.org/wiki/戰國策_(士禮居叢書本)/趙/三" target="_blank" rel="noopener">《战国策·赵策三》驻军地点异文${icon('arrow')}</a><blockquote>「畏秦，止于荡阴，不进。」</blockquote></div><p>程序化人物、场景、器物和五声音阶音乐均为本项目原创，有统一资产编号与版本。服饰与建筑采用风格化表达，尚需考据者审定。</p><p class="muted">《史记》作「邺」，《战国策·赵策三》作「荡阴」，本作沿《史记》主线。围城「十七个月」和绝对年份尚待校历，不作精确史料断言。反事实结局始终标为「本作的历史」。</p>`);
}
async function exportWorld() {
  const response = await fetch('/api/export');
  if (!response.ok) { toast('记录暂时无法导出。'); return; }
  const blob = new Blob([JSON.stringify(await response.json(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = '我的数字世界.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('世界记录已交给浏览器保存。');
}
async function saveNight() {
  if (!night || nightFinished || busy) return;
  night.paused = true; night.clearInput();
  await operation('night-run', { frames: night.frames(), workId: nightStandalone ? 'night' : 'qiefu' });
}
async function handleAction(action: string, element: HTMLElement) {
  if (['home', 'wiki', 'notes', 'studio', 'play-pause'].includes(action) || action.startsWith('start-')) await saveNight();
  if (action.startsWith('start-')) { await startWork(action.slice(6) as WorkId); return; }
  if (action === 'home' || action === 'night-result-home') home();
  else if (action === 'wiki') wiki();
  else if (action === 'notes') notes();
  else if (action === 'studio') studio();
  else if (action === 'audio') { const enabled = await audio.toggle(); document.querySelectorAll('.audio-toggle').forEach(e => { e.innerHTML = icon(enabled ? 'sound' : 'mute'); e.setAttribute('aria-label', enabled ? '关闭声音' : '开启声音'); }); }
  else if (action === 'close-overlay') closeOverlay();
  else if (action === 'help') help();
  else if (action === 'sources') sources();
  else if (action === 'film-pause') { filmPaused = !filmPaused; element.innerHTML = icon(filmPaused ? 'play' : 'pause'); element.setAttribute('aria-label', filmPaused ? '继续电影' : '暂停电影'); }
  else if (action === 'film-next') { filmElapsed = 0; if (prologueFrame < 4) { prologueFrame++; film(); } else await afterFilm(); }
  else if (action === 'film-skip') await afterFilm();
  else if (action === 'story-choice') await storyChoice(element.dataset.choice!);
  else if (action === 'next-act') { closeOverlay(); playAct(); }
  else if (action === 'night-retry') { const result = await operation('night-run', { frames: [], workId: nightStandalone ? 'night' : 'qiefu' }); if (result) { closeOverlay(); nightScene(); } }
  else if (action === 'crouch') { if (night) { night.crouching = !night.crouching; element.setAttribute('aria-pressed', String(night.crouching)); } }
  else if (action === 'night-wait') await finishNight(false, false);
  else if (action === 'play-pause') { if (night) { night.paused = true; night.clearInput(); } theatre?.setPaused(true); audio.pause(true); showOverlay(`<span class="mini-label">人还在，戏可以等</span><h2>这一场，先停在这里。</h2><p>进度已经记下。你可以继续，也可以回到作品墙。</p><button class="primary" data-action="resume">继续这场戏 ${icon('play')}</button><button class="text-button" data-action="home">回到作品墙</button>`, false); }
  else if (action === 'resume') { closeOverlay(); theatre?.setPaused(false); audio.pause(false); }
  else if (action === 'relief') {
    const choice = element.dataset.choice;
    const result = await operation('intent', { intent: { verb: choice === 'distribute' ? 'give' : 'persuade', actorId: 'player', targetId: 'pingyuan', itemId: choice === 'distribute' ? 'pledge' : undefined, choice, workId: 'siege', sceneId: 'siege-square' } });
    if (result) { lastMessage = result.message!; audio.cue(); await operation('presentation', { workId: 'siege', sceneId: 'granary' }); siege(); }
  }
  else if (action === 'grain-choice') { if (element.dataset.dragged === 'yes') { delete element.dataset.dragged; return; } await grainChoice(element.dataset.choice!); }
  else if (action === 'perspective') { perspective = element.dataset.value!; siege(); }
  else if (action === 'swap' || action === 'benchmark') benchmark();
  else if (action === 'swap-return') { keeper = keeper === 'keeper-suspicious' ? 'keeper-impatient' : 'keeper-suspicious'; perspective = keeper; closeOverlay(); siege(); }
  else if (action === 'speech') speechSheet();
  else if (action === 'siege-history') showOverlay(`<h2>粮仓留下的痕迹</h2>${state().claims.filter(c => c.createdBy === 'siege').map(claimHtml).join('') || '<p>先递一件东西，城里的人才会多一段经历。</p>'}<button class="primary" data-action="start-replay">换成他的目光再看</button>`);
  else if (action === 'wiki-select') { wikiActor = element.dataset.actor!; wiki(); }
  else if (action === 'wiki-person') { wikiActor = element.dataset.actor!; closeOverlay(); wiki(); }
  else if (action === 'mind') showMind(element.dataset.actor!);
  else if (action === 'layer') {
    const trace = getMind(state(), openMindActor || keeper), l = trace.layers.find(l => l.layer === element.dataset.layer); if (!l) return;
    document.querySelector('.layer-explanation')?.remove(); const e = document.createElement('div'); e.className = 'layer-explanation';
    e.innerHTML = `<p><strong>读什么</strong>${h(trace.input)}</p><p><strong>预测什么</strong>${h(l.prediction)}</p><p><strong>能改什么</strong>${h(l.strategy)}</p><p><strong>调什么</strong>${h(l.parameterUpdate)}</p>`; element.after(e);
  }
  else if (action === 'cast') { const result = await operation('cast', { actorId: element.dataset.actor }); if (result) { keeper = element.dataset.actor!; toast(result.message!); studio(); } }
  else if (action === 'mechanism') mechanismSheet();
  else if (action === 'install-mechanism' || action === 'recorded-mechanism') {
    element.setAttribute('disabled', ''); element.textContent = '正在对照五次交接…';
    const result = await operation('mechanism', action === 'recorded-mechanism' ? { operation: 'recorded' } : {});
    if (result) {
      closeOverlay(); studio();
      if (result.rejectedCandidate) showOverlay(`<h2>这个提案尚未通过</h2><p>${h(result.message)}</p><p>旧办法继续有效。可用已经录制的有限提案，再跑同样的五次对照。</p><button class="primary" data-action="recorded-mechanism">用录制办法重新对照并安装</button>`);
      else { mechanismSheet(); toast(result.message!); }
    } else { element.removeAttribute('disabled'); element.textContent = '再试作一次'; }
  }
  else if (action === 'rollback-mechanism') { const result = await operation('mechanism', { operation: 'rollback', id: element.dataset.id }); if (result) { closeOverlay(); studio(); toast(result.message!); } }
  else if (action === 'propose-reversal') {
    const c = state().events.some(e => e.intent.sceneId === 'granary' && e.intent.choice) ? state().claims.find(c => c.id === 'grain-debt' && c.status === 'active') : undefined;
    if (!c) { toast('先在粮仓完成交接，再把原账册摆到分镜桌上。'); return; }
    showOverlay(`<span class="mini-label">不能悄悄改掉共识</span><h2>原记录说：${h(c.text)}</h2><p>现有认可与引用，使推翻的代价为 ${Math.round(getOverturnCost(state(), c))}。核验会附上现场记录，解释错记，并逐条重算依赖。</p><button class="primary" data-action="submit-reversal" data-id="${c.id}">核验原账册并提出修订 ${icon('book')}</button>`);
  }
  else if (action === 'submit-reversal') { const result = await operation('reversal', { claimId: element.dataset.id }); if (result) { closeOverlay(); studio(); toast(result.message!); } }
  else if (action === 'approve-reversal') { const result = await operation('reversal', { operation: 'approve', id: element.dataset.id }); if (result) { studio(); toast(result.message!); } }
  else if (action === 'export') await exportWorld();
  else if (action === 'clock') { const result = await operation('clock', { days: 90 }); if (result) { notes(); toast(result.message!); } }
  else if (action === 'reset-confirm') showOverlay(`<h2>开始一份新的世界记录？</h2><p>当前经历会被这一份新的演出替换。先导出，就能以后再接续。</p><button class="text-button" data-action="export">先带走当前记录</button><button class="primary" data-action="reset">开始新的演出</button>`);
  else if (action === 'reset') { const result = await operation('reset'); if (result) { lastMessage = ''; home(); toast(result.message!); } }
  else if (action === 'tier') showOverlay(`<h2>这一场，演多细？</h2><p>细演留下犹豫；一笔带过仍然留下后果。</p><div class="tier-choices">${['detailed', 'normal', 'brief'].map(t => `<button data-action="set-tier" data-tier="${t}">${tierName(t)}</button>`).join('')}</div>`);
  else if (action === 'set-tier') { const result = await operation('presentation', { workId: work, sceneId: currentScene, tier: element.dataset.tier }); if (result) { closeOverlay(); if (currentScene === 'granary') siege(); else if (work === 'qiefu') playAct(); toast(result.message || '这一场的深度已经写下。'); } }
  else if (action === 'replay-prev') { replayIndex--; replay(); }
  else if (action === 'replay-next') { if (replayIndex < narrativeEvents().length - 1) { replayIndex++; replay(); } else home(); }
  else if (action === 'replay-source') { const event = narrativeEvents()[replayIndex]; showOverlay(`<h2>这段电影来自当时的记录</h2><p>${h(event.summary)}</p><p>第 ${event.day + 1} 日。世界版本 ${event.beforeVersion} 到 ${event.afterVersion}。</p>${state().claims.filter(c => event.claimIds.includes(c.id)).map(claimHtml).join('')}<p class="muted">零交互回放不调用模型，不重新编写当时的结果。</p>`); }
}
document.addEventListener('click', event => {
  const element = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (element && !element.hasAttribute('disabled')) void handleAction(element.dataset.action!, element);
});
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === 'Escape') { if (document.querySelector('.overlay-close')) closeOverlay(); return; }
  if (night && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'Shift'].includes(event.key)) { event.preventDefault(); night.key(event.key, true); }
  if (event.key === 'Tab' && document.querySelector('.overlay-sheet')) {
    const focusable = [...document.querySelectorAll<HTMLElement>('.overlay-sheet button:not([disabled]), .overlay-sheet input, .overlay-sheet textarea, .overlay-sheet a, .overlay-sheet summary')];
    const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
window.addEventListener('keyup', event => night?.key(event.key, false));
window.addEventListener('pagehide', () => {
  if (!night || nightFinished) return;
  navigator.sendBeacon('/api/night-run', new Blob([JSON.stringify({ baseVersion: state().version, frames: night.frames(), workId: nightStandalone ? 'night' : 'qiefu' })], { type: 'application/json' }));
});
window.addEventListener('blur', () => { night?.clearInput(); if (night) night.paused = true; });
// Hiding the page silences the same track, so coming back must restore it whether or
// not a book page happens to be open. Only the scene unpause stays gated on that.
window.addEventListener('focus', () => { if (!document.hidden) { audio.pause(false); if (!document.querySelector('.overlay-sheet') && night && !nightFinished) night.paused = false; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { night?.clearInput(); if (night) { night.paused = true; void saveNight(); } audio.pause(true); } else { audio.pause(false); if (!document.querySelector('.overlay-sheet') && night) night.paused = false; } });

async function boot() {
  app.innerHTML = `<main class="loading-screen"><span class="brand-seal">世</span><h1>灯亮了，戏就开场。</h1><p>正在接续你的世界。</p></main>`;
  try { await api.load(); home(); }
  catch { app.innerHTML = `<main class="loading-screen"><h1>剧场还没有接通。</h1><p>请确认本机服务已启动，再重新打开。</p><button class="primary" id="retry-boot">再试一次</button></main>`; document.getElementById('retry-boot')!.onclick = () => void boot(); }
}
void boot();

if (import.meta.env.DEV || new URLSearchParams(location.search).has('qa')) {
  Object.assign(window, {
    __DIGITAL_WORLD__: { getState: state, getNight: () => night?.view, getPage: () => page, getDiagnostics: () => theatre?.getDiagnostics() },
    __THREE_GAME_TEST_HOOKS__: {
      async seed(value: number) { await api.load(); if (state().seed !== value) throw new Error('此验收世界只支持种子 42'); },
      async setState(name: string) {
        await api.load();
        if (name === 'home') home();
        else if (name === 'granary') { work = 'siege'; siege(); }
        else if (name === 'active-play') { work = 'night'; nightStandalone = true; nightScene(); }
        else if (name === 'pause') { work = 'night'; nightStandalone = true; nightScene(); await handleAction('play-pause', document.createElement('button')); }
        else if (name === 'fail-or-retry') {
          work = 'night'; nightStandalone = true; nightScene();
          for (let n = 0; n < 5401 && !night!.view.finished; n++) night!.tick(1 / 30);
          await new Promise<void>((resolve, reject) => { const timer = setInterval(() => { if (document.querySelector('.moment-result')) { clearInterval(timer); resolve(); } else if (!busy && !nightFinished) { clearInterval(timer); reject(new Error('失败场景未成立')); } }, 50); });
        } else throw new Error(`没有这个验收状态：${name}`);
        return { state: name };
      },
      setPausedForScreenshot(paused: boolean) { filmPaused = paused; if (night) night.paused = paused; theatre?.setPaused(paused); },
      setReducedMotion(value: boolean) { reducedMotion = value; },
      hideDebugUi(hidden: boolean) { document.documentElement.dataset.qaHidden = String(hidden); }
    },
    __THREE_GAME_DIAGNOSTICS__: { get renderer() { const d = theatre?.getDiagnostics(); return d ? { calls: d.calls, triangles: d.triangles, geometries: d.geometries, textures: d.textures, fps: d.fps, dpr: d.dpr, render: { calls: d.calls, triangles: d.triangles }, memory: { geometries: d.geometries, textures: d.textures } } : {}; }, get state() { return { page, work, scene: currentScene }; } }
  });
}
