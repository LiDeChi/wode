// 主程式：把世界、人物、玩家、心思、介面接起來，跑這一場。
//
// 這一場的骨架來自導演設計（config.js 的 DESIGN / EPISODE）：
// 每一幕給的 grants 決定你現在能按什麼。level 0 就是完全不讓你動——
// 那不是壞掉，那是導演要你先看清楚。

import * as THREE from 'three';
import { DESIGN, DESIGN_SOURCE, DESIGN_LU, EPISODE, SCENES, STAGING, SPAWN, PLAYER, CAMERA } from './config.js';
import { createRender } from './render.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createActor, personDef } from './actors.js';
import { createMinds, APPEALS } from './mind.js';
import { createHud } from './hud.js';

const SAVE_KEY = 'qiefu.presentation.v1';

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* 存不了就別存，不影響玩 */
  }
}

async function boot() {
  const canvas = document.getElementById('stage');
  const render = createRender(canvas);
  const world = createWorld(render.scene);
  const input = createInput();
  const player = createPlayer(canvas);
  const minds = createMinds();
  const hud = createHud();

  render.scene.add(player.group);

  // ── 遊戲狀態 ────────────────────────────────────────────────
  const state = {
    beatIndex: 0,
    phase: 'title',      // title | opening | play | device | result | coda
    grain: 0.62,
    dawn: 0,
    lines: [],
    lineIndex: 0,
    current: null,       // 目前這一幕的定義
    actors: [],
    nearActor: null,
    lastResult: null,
    usedVerbs: new Set(),
    gave: false,
    moveTarget: null,
    elapsed: 0,
  };

  let raf = 0;
  let last = performance.now();

  // ── 一幕的載入 ──────────────────────────────────────────────
  function beatAt(i) {
    return EPISODE[Math.min(i, EPISODE.length - 1)];
  }

  function loadBeat(i) {
    const beat = beatAt(i);
    state.beatIndex = i;
    state.current = beat;
    state.usedVerbs = new Set();
    state.gave = false;
    state.moveTarget = null;
    state.nearActor = null;

    const def = SCENES[beat.scene];
    world.show(beat.scene);
    render.setSceneEnvironment(def);
    state.grain = beat.grain ?? def.grain.start;
    state.dawn = beat.dawn ?? def.dawn.start;

    // 清掉上一幕的人
    for (const a of state.actors) render.scene.remove(a.group);
    state.actors = [];

    const staging = STAGING[beat.id] || [];
    for (const s of staging) {
      const actor = createActor(s.person, { x: s.x, z: s.z, facing: s.facing });
      render.scene.add(actor.group);
      state.actors.push(actor);
    }

    const spawn = SPAWN[beat.id] || { x: 0, z: 0, facing: 0 };
    player.place(spawn.x, spawn.z, spawn.facing);

    hud.setTag(beat.title || def.name, beat.grants, `${DESIGN_SOURCE.director} · ${DESIGN_SOURCE.file}`);
    hud.setObjective(beat.objective);
    hud.setMeters(state.grain, state.dawn);
    hud.setPrompt(null);
    hud.hideLine();
    hud.closeDevice();

    state.lines = beat.opening || [];
    state.lineIndex = 0;

    if (state.lines.length > 0) {
      state.phase = 'opening';
      showCurrentLine();
    } else if (beat.grants.length === 0) {
      // 沒有開場台詞、又不給動 → 直接收場
      enterCoda();
    } else {
      state.phase = 'play';
    }
  }

  function showCurrentLine() {
    const l = state.lines[state.lineIndex];
    if (!l) return;
    const speaker = l.speaker ? (personDef(l.speaker)?.name || '') : '';
    const src = l.speaker ? `${l.speaker}` : '';
    hud.showLine(speaker, l.text, src);
  }

  function advanceLine() {
    state.lineIndex += 1;
    if (state.lineIndex >= state.lines.length) {
      hud.hideLine();
      if (state.current.grants.length === 0) {
        enterCoda();
      } else {
        state.phase = 'play';
      }
      return;
    }
    showCurrentLine();
  }

  // ── 互動 ────────────────────────────────────────────────────
  function nearestActor() {
    let best = null;
    let bestD = PLAYER.interactRadius;
    for (const a of state.actors) {
      const d = Math.hypot(a.x - player.x, a.z - player.z);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  function openDeviceFor(actor) {
    const beat = state.current;
    const grants = beat.grants;
    const options = [];

    if (grants.includes('say')) {
      const res = minds.resourcesFor(state.grain);
      for (const a of APPEALS) {
        options.push({
          kind: 'say',
          label: a.verb,
          hint: `${a.hint}　${a.sentence(actor.def.name)}`,
          strength: res[a.key],
          onPick: () => doSay(actor, a),
        });
      }
    }
    if (grants.includes('watch')) {
      options.push({
        kind: 'watch',
        label: '看他',
        hint: `讀${actor.def.name}的心思：他在乎什麼、什麼話會激怒他`,
        onPick: () => doWatch(actor),
      });
    }
    if (grants.includes('give')) {
      options.push({
        kind: 'give',
        label: '給他糧食',
        hint: state.gave ? '你今天已經給過一次了' : `把手上的一份糧給${actor.def.name}（城中餘糧會少）`,
        disabled: state.gave || state.grain < 0.05,
        onPick: () => doGive(actor),
      });
    }
    if (grants.includes('go') && canLeave()) {
      options.push({
        kind: 'go',
        label: leaveLabel(),
        hint: '這一幕要交代的事已經交代了',
        onPick: () => leave(),
      });
    }

    hud.openDevice({
      title: `對${actor.def.name}，你要怎麼做？`,
      why: `這一幕導演給你的：${grants.join('、') || '什麼都沒有'}`,
      options,
      resources: minds.resourcesFor(state.grain),
    });
    state.phase = 'device';
  }

  // 什麼時候可以走：這一幕給的每一種動作都用過一次。
  function canLeave() {
    const grants = state.current.grants.filter((g) => g !== 'go');
    if (grants.length === 0) return true;
    return grants.every((g) => state.usedVerbs.has(g));
  }

  function leaveLabel() {
    const beat = state.current;
    if (beat.scene === 'daliang') return '去夷門找侯嬴';
    if (beat.scene === 'yimen') return '等天亮';
    return '離開';
  }

  function doSay(actor, appeal) {
    const strength = minds.resourcesFor(state.grain)[appeal.key];
    const appealObj = { [appeal.key]: strength };
    const r = minds.speak(actor.def.id, appealObj);
    state.usedVerbs.add('say');

    const line = APPEALS.find((a) => a.key === appeal.key);
    const spoken = line.sentence(actor.def.name);
    state.lastResult = { ...r, threshold: actor.def.threshold ?? 0.35, spoken, appealLabel: line.label };

    // 先讓他說一句，再說結果。順序不能反。
    hud.showLine(actor.def.name, spoken, `你說的是「${line.label}」`);
    state.phase = 'result';

    window.setTimeout(() => {
      hud.showResult(state.lastResult);
      hud.setDeviceTitle('他的反應', `這是引擎算出來的：${r.reason}`);
      render.kick(0.06);
      persist();
    }, 620);
  }

  function doWatch(actor) {
    const reading = minds.read(actor.def.id);
    state.usedVerbs.add('watch');
    hud.showMind(reading);
    persist();
  }

  function doGive(actor) {
    state.usedVerbs.add('give');
    state.gave = true;
    state.grain = Math.max(0, state.grain - 0.12);
    hud.setMeters(state.grain, state.dawn);

    // 給糧食在引擎裡就是「恩」的訴求，強度來自你拿出來的份量。
    const r = minds.speak(actor.def.id, { 恩: 0.55 });
    state.lastResult = { ...r, threshold: actor.def.threshold ?? 0.35, spoken: '這一份，你收下。', appealLabel: '恩' };
    hud.showLine(actor.def.name, '……', '你把糧食放在他面前');
    state.phase = 'result';
    window.setTimeout(() => {
      hud.showResult(state.lastResult);
      hud.setDeviceTitle('他的反應', `這是引擎算出來的：${r.reason}`);
      persist();
    }, 620);
  }

  function leave() {
    hud.closeDevice();
    const next = state.beatIndex + 1;
    if (next >= EPISODE.length - 1) {
      enterCoda();
      return;
    }
    loadBeat(next);
  }

  function enterCoda() {
    state.phase = 'coda';
    hud.closeDevice();
    hud.hideLine();
    hud.setPrompt(null);
    const trust = state.actors.length
      ? state.actors.map((a) => `${a.def.name} ${minds.trustOf(a.def.id).toFixed(2)}`).join('　')
      : '';
    const text = [
      '這一場是垂直切片：走路、走近人、開口、看他怎麼反應。',
      trust ? `你留下的印象：${trust}` : '',
      '重來一次會回到同樣的起點——導演設計是固定的，變的是你怎麼用它。',
    ].filter(Boolean).join('\n');
    hud.showCoda('這一場到此', text);
  }

  function persist() {
    writeSave({
      v: 1,
      beatIndex: state.beatIndex,
      grain: state.grain,
      dawn: state.dawn,
      minds: minds.save(),
    });
  }

  // ── 主迴圈 ──────────────────────────────────────────────────
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    const blocked = state.phase === 'opening' || state.phase === 'result' || state.phase === 'coda' || hud.isMindOpen();
    const axis = input.axis(blocked);

    // 點地面移動
    if (input.justPressed('KeyR')) {
      restart();
      input.endFrame();
      return;
    }

    if (state.phase === 'play') {
      state.elapsed += dt;
      const def = SCENES[state.current.scene];
      state.grain = Math.max(0, state.grain - def.grain.drainPerSec * dt);
      state.dawn = Math.min(1, state.dawn + def.dawn.perSec * dt);
      hud.setMeters(state.grain, state.dawn);

      // 靠近誰
      const near = nearestActor();
      if (near !== state.nearActor) {
        state.nearActor = near;
        hud.setPrompt(near ? `E　${near.def.name}` : null);
      }

      if (input.justPressed('KeyE') && near) {
        openDeviceFor(near);
      }
      if (input.justPressed('Tab') && near) {
        hud.showMind(minds.read(near.def.id));
      }
      // 天亮就收場
      if (state.dawn >= 1) {
        enterCoda();
      }
    }

    if (state.phase === 'opening') {
      if (input.justPressed('Space') || input.justPressed('Enter') || input.justPressed('KeyE')) {
        advanceLine();
      }
    }

    player.update(dt, axis, blocked, SCENES[state.current?.scene || 'daliang'].bounds, state.moveTarget);
    if (state.moveTarget && Math.hypot(state.moveTarget.x - player.x, state.moveTarget.z - player.z) < 0.3) {
      state.moveTarget = null;
    }

    for (const a of state.actors) {
      a.update(t, dt, { x: player.x, z: player.z });
    }

    world.update(t, dt);
    render.updateCamera(player.position, dt, player.facing);
    render.render();
    input.endFrame();
  }

  function restart() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* 忽略 */ }
    // 重建一份乾淨的心思：信任回到起點，記憶清空。
    const initial = {};
    for (const id of Object.keys(minds.save())) {
      const def = personDef(id);
      if (def) initial[id] = { trust: { ...(def.trust || {}) }, stress: 0, memory: {}, others: {}, installed: [], activation: 0, consolidation: 0 };
    }
    minds.load(initial);
    state.grain = 0.62;
    state.dawn = 0;
    hud.hideCoda();
    hud.hideMind();
    loadBeat(0);
  }

  // 滑鼠：點地面走過去
  canvas.addEventListener('pointerdown', (e) => {
    if (state.phase !== 'play') return;
    const p = player.pickGround(e.clientX, e.clientY, render.camera);
    if (p) {
      state.moveTarget = {
        x: Math.max(SCENES[state.current.scene].bounds.minX, Math.min(SCENES[state.current.scene].bounds.maxX, p.x)),
        z: Math.max(SCENES[state.current.scene].bounds.minZ, Math.min(SCENES[state.current.scene].bounds.maxZ, p.z)),
      };
    }
  });

  hud.onCodaAgain(() => {
    hud.hideCoda();
    restart();
  });

  hud.onMindClose(() => {
    if (state.phase === 'device') hud.setDeviceTitle(`對${state.nearActor?.def.name || '他'}，你要怎麼做？`, '');
  });

  // ── 開場：先把導演設計讀出來，再讓玩家按入場 ────────────────
  const grantsSummary = DESIGN.beats
    .filter((b) => b.grants.length > 0)
    .map((b) => b.scene)
    .join('、');
  hud.setTitleStatus(
    `導演：${DESIGN.director}（情緒：${DESIGN.emotion}）　設計來源：${DESIGN_SOURCE.file} · slot ${DESIGN_SOURCE.slot} · seq ${DESIGN_SOURCE.seq}\n`
    + `這一輪放開的場景：${grantsSummary}\n`
    + `（另一份設計 ${DESIGN_LU.director} 幾乎不給權力，呈現層照 ${DESIGN.director} 這一輪走）`,
    true,
  );

  // 先把第一幕載好，但停在標題畫面
  loadBeat(0);
  state.phase = 'title';
  hud.hideLine();
  hud.closeDevice();
  hud.setPrompt(null);

  hud.onTitleStart(() => {
    hud.hideTitle();
    state.phase = 'opening';
    if (state.lines.length > 0) {
      state.lineIndex = 0;
      showCurrentLine();
    } else if (state.current.grants.length === 0) {
      enterCoda();
    } else {
      state.phase = 'play';
    }
  });

  raf = requestAnimationFrame(frame);

  // 給驗收腳本一個可讀的介面，不必去猜畫面。
  window.__qiefu = {
    state,
    render,
    world,
    player,
    minds,
    hud,
    design: DESIGN,
    source: DESIGN_SOURCE,
    // 直接跳到你想要的一幕，方便自動化驗收
    goToBeat(i) {
      hud.hideTitle();
      hud.hideCoda();
      loadBeat(i);
    },
    // 對最近的人說一句，回傳引擎的原始結果
    say(key) {
      const near = nearestActor();
      if (!near) return null;
      const appeal = APPEALS.find((a) => a.key === key);
      if (!appeal) return null;
      const strength = minds.resourcesFor(state.grain)[key];
      const r = minds.speak(near.def.id, { [key]: strength });
      return { personId: near.def.id, ...r };
    },
    read(personId) {
      return minds.read(personId);
    },
    nearest() {
      return nearestActor()?.def.id ?? null;
    },
    actors: () => state.actors.map((a) => a.def.id),
  };

  window.addEventListener('beforeunload', () => cancelAnimationFrame(raf));
}

boot().catch((err) => {
  console.error('[竊符] 啟動失敗', err);
  const s = document.getElementById('title-status');
  if (s) {
    s.textContent = `啟動失敗：${err.message}`;
    s.style.color = '#e08a6a';
  }
});
