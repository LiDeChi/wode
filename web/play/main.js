// 主控：一局从选导演走到结局。所有输入都发生在场景里（点人、点实物、点小机关）。
import * as THREE from 'three';
import { createRender } from '/game/render.js';
import { createSession } from '/shared/engine/session.js';
import { createPlay } from '/shared/engine/play.js';
import { createStage } from './stage.js';
import { createCamera } from './camera.js';
import { createUI } from './ui.js';
import { createLivingUI } from './living.js';
import { loadWorld, saveWorld, createRecording } from '/film/world.js';

const params = new URLSearchParams(location.search);
const DEV = params.get('dev') === '1';

const ANSWERS = { lu: { wait: 0.8, polish: 0.8, depth: 0.85 }, shan: { wait: 0.2, polish: 0.2, depth: 0.25 } };
const NEED = '我想看一个人在乱世里怎么做选择';
const DIRECTOR = { lu: '陆导', shan: '单导' };
const HOLDER = '门客（你）';
// 收束页拿不到 scenes 里的幕名时兜底（正常都走 view 里的 title）
const ACT_TITLE = { daliang: '大梁', yimen: '夷门', night: '取符之夜', ye: '邺城', granary: '暮色粮仓' };
// 结局的来路（引擎里的 ending id）：刻在最后一片竹简的封泥旁边
const ENDING_LABEL = { history: '本作的历史', broken: '本作的历史', 'jinbi-lives': '另一种可能' };

const ITEM_PROP = {
  '赵使的竹简': 'prop:letter',
  '宫中令牌': 'prop:token',
  '印信': 'prop:seal',
  '借条': 'prop:note',
  '担保物': 'prop:pledge',
  '兵符': 'prop:tally',
};

const OPT_LABEL = {
  yi: '说「义」', li: '说「利」', king: '请见魏王', back: '说「义」', fear: '说「惧」', hou: '问侯嬴为什么',
  en: '说「恩」', ju: '说「惧」', step: '往前挪一格', rush: '一口气冲两格',
  token_a: '把令牌递给守卫甲', token_b: '把令牌递给守卫乙',
  seal: '把印信推过去', note: '把借条推过去', pledge: '把担保物推过去',
  report: '拿着仓簿去报', witness: '拉上李同一起去报', hide: '先瞒下来',
};

const canvas = document.getElementById('stage');
const render = createRender(canvas);
const cam = createCamera(render);
const ui = createUI({ dev: DEV });
const stage = createStage(render.scene, render);

let session = null;
let play = null;
let view = null;
let busy = false;
let ended = false;
const opened = new Set();   // 哪个人的诉求签已经摊开了
let lastAct = null;
let picked = null;          // 这一局选了哪位导演（录电影要用他的口味）
let lastCoda = null;        // 结局那一屏的文字，收束页还要用
let lastActs = null;
const rec = [];             // 这一局的动作记录：电影就是把它重放一遍
let livingEnabled = params.get('living') !== '0';
let paused = false;
let lifeSeconds = 0;
let inputId = 0;
let lifeRead = null;
let initialSave = null;
let recording = null;
const LIFE_SEED = 'play-living-v1';
const livingUI = createLivingUI({
  dev: DEV, ui,
  onPause: () => setPaused(!paused),
  onToggle: () => {
    if (play) { ui.hint('生活入口在开场选择；重新开一个世界时可换。'); return; }
    livingEnabled = !livingEnabled; livingUI.enabled(livingEnabled);
  },
  onResume: () => resumeWorld(),
});
livingUI.enabled(livingEnabled);

function setPaused(on) {
  paused = on;
  lifeSeconds = 0;
  syncPause();
  livingUI.paused(on, !!play?.life && !ended);
  persistWorld();
}
function syncPause() {
  lifeSeconds = 0;
  if (!play?.life) return;
  const on = paused || document.hidden;
  if (play.life.state().paused !== on) {
    if (on) play.life.pause(); else play.life.resume();
    recording?.pause(on, play.life.tick());
  }
  persistWorld();
}
function persistWorld() {
  if (!play?.life) return;
  try { saveWorld({ v: 1, picked, paused, saved: session.save(), recording: recording?.save() ?? null }); }
  catch (e) { if (DEV) console.warn('续档未保存', e); ui.hint('这台设备没能留住存档；当前这一场仍可继续。'); }
}
function readLiving() {
  if (!play?.life) return;
  lifeRead = play.lifeRead(view?.act);
  stage.setLife(lifeRead, session.ledger.entries, session.state.episode?.from ?? 0);
  livingUI.read(lifeRead, view, session);
  livingUI.paused(paused, !ended);
  persistWorld();
}
function resumeWorld() {
  try {
    const saved = loadWorld();
    if (!saved?.saved?.play?.life) throw new Error('这个世界还没有生活存档。');
    session = createSession({ saved: saved.saved }); picked = saved.picked ?? 'shan';
    initialSave = saved.recording?.initial ?? session.save();
    recording = createRecording({ session, initial: initialSave, director: picked, seed: saved.saved.play.life.seed, record: saved.recording?.v === 2 ? saved.recording : null });
    inputId = Object.keys(saved.saved.play.life.processed ?? {}).length;
    play = createPlay(session, { living: 'director', seed: saved.saved.play.life.seed });
    livingEnabled = true; livingUI.enabled(true);
    paused = Boolean(saved.paused ?? saved.saved.play.life.paused); syncPause(); livingUI.paused(paused, true);
    ui.el.title.hidden = true;
    view = play.view();
    if (view.stage === 'film') { view = act('next'); }
    if (view.stage === 'intro') { act('begin'); view = act('next'); }
    settle();
  } catch (e) { ui.hint(humanError(e)); }
}
document.addEventListener('visibilitychange', syncPause);
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'p' && play?.life) { e.preventDefault(); setPaused(!paused); }
  if (e.key === 'Escape') livingUI.close();
});
window.addEventListener('pagehide', persistWorld);

/** 所有对引擎的调用都从这儿过——顺手录一份，电影才放得出来 */
function act(op, ...args) {
  rec.push({ op, args });
  if (play.life && paused && op === 'watch') {
    const result = play.watch(...args); recording?.step(op, args, { tick: play.life.tick() }); return result;
  }
  if (play.life && ['choose', 'watch', 'ask', 'chooseKeeper'].includes(op)) {
    const tick = play.life.tick() + 1;
    const inp = { id: `${session.state.episode?.id ?? 'ep1'}:ui:${++inputId}`, tick, op, args };
    const r = play.advance({ toTick: tick, inputs: [inp] });
    recording?.advance({ toTick: tick, inputs: [inp] });
    lifeSeconds = 0;
    return r.processed.find(x => x.id === inp.id)?.outcome;
  }
  const r = play[op](...args);
  if (play.life) recording?.step(op, args, { tick: play.life.tick() });
  return r;
}

/* ── 小工具 ──────────────────────────────────────────────── */

const v3 = new THREE.Vector3();

function nameOf(id) {
  const p = (view?.people ?? []).find((x) => x.id === id);
  if (p) return p.name;
  const g = view?.granary?.keepers?.find((x) => x.id === id);
  return g?.name ?? id;
}

function anchorPos(key) {
  const a = stage.anchors.get(key);
  return a ? a.getPos() : null;
}

function humanError(e) {
  const msg = String(e?.message ?? e ?? '');
  if (msg.includes('没有授予')) return '这位导演没给你这种时机——这件事你此刻做不了。';
  if (msg.includes('已经做完')) return '这一场已经做完了，往下走吧。';
  if (msg.includes('还没做出选择')) return '这一场你还没动手。先在这一幕里做一个选择。';
  return msg || '有一处说不清的地方。';
}

function fail(e) {
  if (DEV) console.error(e);
  ui.clearTags();
  ui.fatal('这一场出了点岔子。', humanError(e));
}

/** 舞台上能点的东西先收走，说话的时候不许乱点 */
function freeze(on) {
  ui.el.tags.style.pointerEvents = on ? 'none' : '';
}

async function speak(name, text) {
  freeze(true);
  ui.clearTags();
  await ui.say(name, text);
  await ui.advance();
  freeze(false);
}

async function peek(text) {
  if (busy) return;
  busy = true;
  try { await speak('', text); } catch (e) { fail(e); } finally { busy = false; }
}

/* ── 把一幕摆到画面上 ─────────────────────────────────────── */

function peopleFor(v) {
  const people = [...(v.people ?? [])];
  if (v.stage === 'granary' && v.granary?.keepers) {
    const others = v.granary.keepers.filter((k) => k.id !== v.granary.keeper);
    for (const k of others) if (!people.some((p) => p.id === k.id)) people.push({ id: k.id, name: k.name, title: '另一个守仓人' });
  }
  return people;
}

function focusKeyFor(v) {
  if (v.stage === 'granary') return `person:${v.granary?.keeper}`;
  const leads = { daliang: 'xinling', yimen: 'houying', night: 'prop:token', ye: 'jinbi' };
  const key = leads[v.act];
  if (key && stage.anchors.has(key)) return key;
  const first = (v.people ?? [])[0];
  return first ? `person:${first.id}` : 'device';
}

function labelFor(opt, v) {
  if (OPT_LABEL[opt.id]) return OPT_LABEL[opt.id];
  if (opt.verb === 'wait') {
    return { daliang: '不出声，看公子', yimen: '跟着车走，不出声', night: '贴着墙根，等灯过去', ye: '看铁椎落下' }[v.act] ?? '不出声';
  }
  if (opt.verb === 'give' && opt.item) return `递上${opt.item}`;
  const line = String(opt.line ?? '');
  return line.length > 10 ? `${line.slice(0, 10)}…` : (line || opt.id);
}

/** 这个选项的签挂在哪：挂人身上（要先把人点开），还是挂在实物/装置上（一直在） */
function anchorFor(opt, v) {
  if (v.stage === 'granary') {
    if (opt.item && ITEM_PROP[opt.item]) return { key: ITEM_PROP[opt.item] };
    return { key: `person:${v.granary.keeper}`, personId: v.granary.keeper, kind: 'intent' };
  }
  if (v.act === 'night') {
    // 「摸令牌」这类动作挂在场景里那件令牌实物上：守卫常站在镜头外，签挂到人身上会点不到
    if (opt.item && ITEM_PROP[opt.item]) return { key: 'prop:token' };
    return { key: 'path' };
  }
  if (opt.to && stage.anchors.has(`person:${opt.to}`)) {
    return { key: `person:${opt.to}`, personId: opt.to, kind: 'intent' };
  }
  if (opt.item && ITEM_PROP[opt.item]) return { key: ITEM_PROP[opt.item] };
  if (v.act === 'ye') {
    // 案上有没有符，是取符之夜那一局的结果：没带出来，签就挂到那卷军令上
    if (stage.anchors.has('prop:tally')) return { key: 'prop:tally' };
    if (stage.anchors.has('prop:order')) return { key: 'prop:order' };
  }
  return { key: 'device' };
}

// 人物的「样子」在数据里是 {color, glyph}：签的提示行要说人话，不能把对象直接拼进字符串
function lookText(look, name) {
  if (!look) return '';
  if (typeof look === 'string') return look;
  const glyph = look.glyph ? `衣冠作「${look.glyph}」` : '';
  const color = look.color ? `色 ${look.color}` : '';
  const parts = [glyph, color].filter(Boolean).join('，');
  return parts ? `${name}的样子：${parts}` : '';
}

function paint(v) {
  ui.setScene(v);
  ui.setDays(v.days);
  ui.objective(v.goal ?? '');
  ui.showClepsydra(v.act === 'night' ? v.night : null);
  stage.setNight(v.act === 'night' ? v.night : null);

  const entries = [];
  const anchors = stage.anchors;

  for (const p of peopleFor(v)) {
    const key = `person:${p.id}`;
    if (!anchors.has(key)) continue;
    const isKeeper = !!v.granary?.keepers?.some((k) => k.id === p.id);
    const other = isKeeper && p.id !== v.granary.keeper;
    entries.push({
      key, kind: 'person', label: other ? `${p.name}（换他）` : p.name,
      hint: [p.title, lookText(p.look, p.name)].filter(Boolean).join(' · '),
      onClick: () => {
        if (other) { doKeeper(p.id); return; }
        if (opened.has(p.id)) opened.delete(p.id); else opened.add(p.id);
        paint(view);
      },
    });
  }

  for (const opt of v.options ?? []) {
    const a = anchorFor(opt, v);
    if (a.personId && !opened.has(a.personId)) continue;
    if (!anchors.has(a.key)) continue;
    entries.push({
      key: a.key, intent: opt.id, kind: a.kind ?? 'intent', disabled: !opt.allowed,
      label: labelFor(opt, v), hint: opt.line ?? '', onClick: () => doChoose(opt.id),
    });
  }

  for (const f of stage.flavor ?? []) {
    if (!anchors.has(f.key)) continue;
    if (entries.some((e) => e.key === f.key && e.kind === 'flavor')) continue;
    entries.push({ key: f.key, kind: 'flavor', label: f.label, onClick: () => peek(f.line) });
  }

  ui.setTags(entries);

  const verbs = v.grants?.verbs ?? [];
  const gizmos = [];
  for (const p of peopleFor(v)) {
    const key = `person:${p.id}`;
    if (!anchors.has(key)) continue;
    const actions = [];
    if (verbs.includes('watch')) actions.push({ label: '看', role: 'watch', title: '看他的心思', onClick: () => doWatch(p.id) });
    actions.push({ label: '问', role: 'ask', title: '追问他一句', onClick: () => doAsk(p.id) });
    gizmos.push({ key, actions });
  }
  ui.setGizmos(gizmos);
  readLiving();
  ui.dev({ 阶段: v.stage, 场: v.act ?? v.stage, 天数: v.days, 可选项: (v.options ?? []).map((o) => `${o.id}${o.allowed ? '' : '(不许)'}`), 生活: lifeRead });
}

function showAct(v) {
  const first = stage.actId !== v.act;
  if (first) {
    stage.build(v.act, { ...v, people: peopleFor(v) });
    cam.setShot(stage.actShot(v.act), true);
    opened.clear();
  } else {
    stage.refresh(v);
  }
  paint(v);
  const key = focusKeyFor(v);
  const go = () => {
    const p = anchorPos(key);
    if (!p) return;
    if (v.act === 'night') cam.focus(p, { dist: 10.5, elev: 0.40, az: cam.camera.position.x >= 0 ? 0.32 : -0.32 });
    else cam.focus(p, { dist: key.startsWith('person:') ? 6.8 : 8.6, elev: key.startsWith('person:') ? 0.24 : 0.30 });
  };
  if (first) setTimeout(go, 1000); else go();
  lastAct = v.act;
}

/* ── 一局怎么走 ──────────────────────────────────────────── */

async function settle() {
  while ((view.stage === 'act' || view.stage === 'granary') && view.done) view = act('next');
  if (view.stage === 'coda') return showCoda(view);
  if (view.stage === 'done') return showFinal(view);
  return showAct(view);
}

async function doChoose(id) {
  if (busy || !view) return;
  if (paused) { ui.hint('生活暂停着。点「继续生活」或按 P 再动手。'); return; }
  const opt = (view.options ?? []).find((o) => o.id === id);
  if (!opt) return;
  const keepOpened = view.act === 'night';
  busy = true;
  try {
    if (!opt.allowed) {
      await speak('', `${labelFor(opt, view)}——这会儿做不成。${opt.item ? '那件事、那件东西，此刻都不在你手里。' : ''}`);
      return;
    }
    freeze(true);
    ui.clearTags();
    const r = act('choose', id);
    const speaker = r.r?.person ?? null;
    if (speaker) { const p = anchorPos(`person:${speaker}`); if (p) cam.focus(p, { dist: 6.2, elev: 0.22 }); }
    if (r.r?.tell) ui.tell(r.r.tell);
    freeze(false);
    await speak(speaker ? nameOf(speaker) : HOLDER, r.text ?? '……');
    view = play.life ? play.view() : r.view;
    if (!keepOpened) opened.clear();
    await settle();
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
  }
}

async function doWatch(id) {
  if (busy || !view) return;
  busy = true;
  try {
    const r = act('watch', id);
    const p = anchorPos(`person:${id}`);
    if (p) cam.focus(p, { dist: 5.6, elev: 0.22 });
    if (play.life) {
      view = play.view(); readLiving();
      const actor = lifeRead?.actors.find(a => a.id === id);
      const real = actor?.last?.seq ? play.lifeTrace(actor.last.seq) : null;
      livingUI.mind(r, lifeRead, real, session);
    } else ui.showMind(r);
  } catch (e) {
    ui.hideMind();
    await speak('', humanError(e));
  } finally {
    busy = false;
  }
}

async function doAsk(id) {
  if (busy || !view || paused) return;
  busy = true;
  try {
    const r = act('ask', id);
    const p = anchorPos(`person:${id}`);
    if (p) cam.focus(p, { dist: 5.8, elev: 0.22 });
    await speak(nameOf(id), r.answer ?? '……');
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
  }
}

async function doKeeper(id) {
  if (busy || paused || !view || view.stage !== 'granary') return;
  busy = true;
  try {
    view = act('chooseKeeper', id);
    opened.clear();
    await speak('', `你换了个说话的人：${nameOf(id)}。`);
    await showAct(view);
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
  }
}

function showCoda(v) {
  ended = true;
  lastCoda = v.coda ?? lastCoda;
  lastActs = v.acts ?? lastActs;
  ui.clearTags();
  ui.clearGizmos();
  ui.hideClepsydra();
  cam.setShot({ target: [0, 1.3, -1.0], dist: 54, az: 0.6, elev: 0.44 });
  ui.showCoda(v.coda, {
    onGranary: () => {
      ui.hideEnding();
      ui.clearTags();
      view = act('next');
      ended = false;
      showAct(view);
    },
    onClose: () => showFinal(view),
  });
  if (play.life) { livingUI.chain(session, lifeRead); livingUI.paused(paused, false); persistWorld(); }
}

function showFinal(v) {
  ui.clearTags();
  ui.clearGizmos();
  ui.hideLine();
  cam.setShot({ target: [0, 1.3, -1.0], dist: 62, az: 0.6, elev: 0.46 });
  const raw = v?.acts ?? lastActs ?? (play.state().acts
    ? Object.entries(play.state().acts).map(([id, a]) => ({ id, title: id, text: a.outcome?.text ?? '' }))
    : []);
  const acts = (raw ?? []).map((a) => ({
    id: a.id,
    title: a.title || ACT_TITLE[a.id] || a.id,
    outcome: a.outcome ?? a.text ?? '',
  }));
  const coda = v?.coda ?? lastCoda ?? {};
  ended = true;
  ui.showFinal(acts, {
    onRestart: () => location.reload(),
    onFilm: () => saveFilm(),
    // 最后一片竹简上刻的结局名（例如「援军未至」），以及它的来路（本作的历史 / 史记）
    ending: { title: coda.end || '', kind: ENDING_LABEL[coda.ending] ?? '' },
  });
  if (play.life) {
    livingUI.chain(session, lifeRead); livingUI.paused(paused, false); persistWorld();
    const next = document.createElement('button'); next.type = 'button'; next.className = 'enter'; next.textContent = '同世界再见一回';
    next.addEventListener('click', () => {
      session.beginEpisode({ work: 'qiefu' }); session.state.play = null;
      initialSave = session.save();
      recording = createRecording({ session, initial: initialSave, director: picked, seed: LIFE_SEED });
      play = createPlay(session, { living: 'director', seed: LIFE_SEED });
      ended = false; paused = false; lifeSeconds = 0; inputId = 0; rec.length = 0;
      act('begin'); view = act('next'); ui.hideEnding(); ui.hideLine(); showAct(view);
    });
    ui.el.endingActions.append(next);
  }
}

/** 把这一局的动作录成一份电影（web/film/format.js 的 v1 录制），交给 /film.html 放 */
async function saveFilm() {
  try {
    const mod = await import('/film/format.js');
    const record = play.life ? recording.save() : {
      v: 1,
      director: { answers: ANSWERS[picked] ?? ANSWERS.shan, need: NEED },
      steps: rec,
    };
    if (play.life) persistWorld();
    mod.decode(record);
    localStorage.setItem(mod.STORAGE_KEY, JSON.stringify(record));
    location.href = '/film.html?last=1';
  } catch (e) {
    fail(e);
  }
}

/* ── 开场 ────────────────────────────────────────────────── */

function startDirector(dir) {
  try {
    session = createSession();
    session.meet(ANSWERS[dir], NEED);
    initialSave = session.save();
    picked = dir;
    recording = livingEnabled ? createRecording({ session, initial: initialSave, seed: LIFE_SEED, director: picked }) : null;
    play = createPlay(session, livingEnabled ? { living: 'director', seed: LIFE_SEED } : {});
    const film = act('begin');
    ui.el.title.hidden = true;
    ui.el.film.hidden = false;
    ui.el.filmText.textContent = film.film ?? '';
    ui.el.filmDirector.textContent = `导演：${DIRECTOR[dir]}`;
    ui.el.enterFilm.addEventListener('click', () => {
      try {
        ui.el.film.hidden = true;
        view = act('next');
        showAct(view);
      } catch (e) { fail(e); }
    });
  } catch (e) {
    fail(e);
  }
}

document.getElementById('pick-lu').addEventListener('click', () => startDirector('lu'));
document.getElementById('pick-shan').addEventListener('click', () => startDirector('shan'));
document.getElementById('restart').addEventListener('click', () => location.reload());
ui.bindMindClose(() => livingUI.close());

window.addEventListener('error', (e) => fail(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => fail(e.reason));
window.addEventListener('resize', () => render.resize());
ui.bindRestart(() => location.reload());

/* ── 每帧 ────────────────────────────────────────────────── */

function screenOf(key) {
  const a = stage.anchors.get(key);
  if (!a) return { visible: false };
  v3.copy(a.getPos());
  v3.project(render.camera);
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const behind = v3.z > 1;
  return {
    x: (v3.x * 0.5 + 0.5) * w,
    y: (-v3.y * 0.5 + 0.5) * h,
    visible: !behind && v3.x > -1.25 && v3.x < 1.25 && v3.y > -1.25 && v3.y < 1.25,
    depth: v3.z,
  };
}

let prev = performance.now();
function loop(now) {
  const elapsed = (now - prev) / 1000;
  const dt = Math.min(0.05, elapsed);
  prev = now;
  try {
    cam.update(dt);
    if (play?.life && !paused && !document.hidden && !busy && !ended && ['act', 'granary'].includes(view?.stage) && elapsed < 1) {
      lifeSeconds += elapsed;
      if (lifeSeconds >= 1) {
        lifeSeconds -= 1;
        const tick = play.life.tick() + 1;
        const r = play.advance({ toTick: tick }); recording?.advance({ toTick: tick, inputs: [] });
        view = play.view();
        if (view.done) { busy = true; Promise.resolve(settle()).finally(() => { busy = false; }); }
        else { stage.refresh(view); paint(view); }
        const words = r.outcomes.map(o => o.text).filter(Boolean);
        if (words.length) ui.tell(words.at(-1));
      }
    }
    stage.update(paused || document.hidden ? 0 : dt);
    render.render();
    ui.syncTags(screenOf);
  } catch (e) {
    fail(e);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
render.resize();

if (DEV) {
  window.__play = {
    get view() { return view; },
    get stage() { return { act: stage.actId, anchors: [...stage.anchors.keys()] }; },
    // 谁的诉求签已经摊开了（冒烟脚本据此判断该不该再点一次，不然会点成收起来）
    get opened() { return [...opened]; },
    choose: (id) => doChoose(id),
    watch: (id) => doWatch(id),
    ask: (id) => doAsk(id),
    keeper: (id) => doKeeper(id),
    state: () => play?.state?.() ?? null,
    lifeRead: () => lifeRead,
    ledger: () => session?.ledger.entries,
    pause: (on) => setPaused(on),
    saved: () => session?.save(),
  };
}
