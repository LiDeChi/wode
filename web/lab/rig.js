// 推演机：一张案，一台木架机器，五个铜钮，一杆闸，八个陶罐。
// 所有能摸的东西都在这里搭出来；谁被拨了、被拉了，由 main.js 决定做什么。
import * as THREE from 'three';
import { makePlate } from './labels.js';
import { TRACK, GLAZE, SLOT_ENDING, ENDINGS } from './beans.js';

const TABLE = { w: 9.6, d: 7.0, cz: 1.9 };
const FRONT_Z = 4.5;
const KNOB_Z = 3.2;

const m = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: .9, ...opts });
const WOOD = () => m('#2b2118', { roughness: .94 });
const WOOD2 = () => m('#43301f', { roughness: .9 });
const BRASS = () => m('#b6904f', { roughness: .32, metalness: .88 });
const BRASS_DARK = () => m('#7a6134', { roughness: .45, metalness: .82 });
const IRON = () => m('#3d3d46', { roughness: .5, metalness: .78 });

let audio = null;
function clack(heavy = false) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = heavy ? 'triangle' : 'square';
    o.frequency.setValueAtTime(heavy ? 160 : 720, t);
    o.frequency.exponentialRampToValueAtTime(heavy ? 60 : 380, t + (heavy ? .16 : .04));
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(heavy ? .16 : .05, t + .006);
    g.gain.exponentialRampToValueAtTime(.0001, t + (heavy ? .22 : .05));
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + .25);
  } catch { /* 没有声音也不影响使用 */ }
}

export function buildRig(bench, { variables = [] } = {}) {
  const root = new THREE.Group();
  bench.scene.add(root);
  const handlers = {};
  const cleanups = [];
  const box = (parent, material, size, pos, rotation) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...pos);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  /* ---------------- 案与地 ---------------- */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), m('#120f18', { roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.62; floor.receiveShadow = true;
  root.add(floor);
  const table = box(root, WOOD(), [TABLE.w, .36, TABLE.d], [0, -.18, TABLE.cz]);
  table.receiveShadow = true;
  box(root, m('#1c1510'), [TABLE.w, .5, .2], [0, -.6, TABLE.cz + TABLE.d / 2 - .1]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(root, m('#241b13'), [.42, 1.3, .42], [sx * (TABLE.w / 2 - .6), -1, TABLE.cz + sz * (TABLE.d / 2 - .6)]);
  }

  /* ---------------- 机架：背板、四层轨道、漏斗 ---------------- */
  const sx2 = TRACK.half + .25;
  box(root, WOOD2(), [TRACK.half * 2 + .5, 3.6, .16], [0, 2.0, -.92]);
  for (const s of [-1, 1]) box(root, WOOD2(), [.16, 3.7, 1.9], [s * sx2, 2.0, 0]);
  for (const s of [-1, 1]) box(root, WOOD(), [.26, 6.15, .26], [s * 3.3, 3.07, -1.32]);
  box(root, WOOD(), [7.1, .34, .46], [0, 6.15, -1.32]);

  const rowMats = [], rowGroups = [];
  for (let k = 0; k < TRACK.rows; k++) {
    const g = new THREE.Group();
    g.position.y = TRACK.rowY[k];
    root.add(g);
    const mat = m('#54402a', { roughness: .88, emissive: '#000000' });
    rowMats.push(mat);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(TRACK.half * 2, .09, TRACK.rowDepth), mat);
    slab.receiveShadow = true; slab.castShadow = true;
    g.add(slab);
    for (let i = 0; i <= 5; i++) box(g, m('#3a2c1c'), [.07, .15, TRACK.rowDepth], [TRACK.laneX(0) - .52 + i * 1.04, .1, 0]);
    if (k === TRACK.rows - 1) box(g, m('#3a2c1c'), [TRACK.half * 2, .13, .16], [0, .07, TRACK.rowDepth / 2 - .04]);
    rowGroups.push(g);
  }
  // 顶上那只漏斗：豆子从这里下去。
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(3.35, .42, 1.15, 4, 1, true), m('#4c4238', { roughness: .6, metalness: .35, side: THREE.DoubleSide }));
  funnel.rotation.y = Math.PI / 4;
  funnel.position.set(0, 4.08, 0);
  funnel.castShadow = true;
  root.add(funnel);
  box(root, m('#5b5044', { metalness: .4, roughness: .5 }), [4.7, .12, 4.7], [0, 3.52, 0]);

  /* ---------------- 八只陶罐：四种结局 × 青釉／酱釉 ---------------- */
  const potGroup = new THREE.Group();
  root.add(potGroup);
  const potMats = new Map();
  function potMesh(glaze) {
    const key = glaze;
    if (!potMats.has(key)) {
      const r = TRACK.potR, h = .62;
      const profile = [[0, 0], [r * .55, 0], [r * .88, h * .16], [r, h * .44], [r, h * .74], [r * .95, h],
        [r * .8, h], [r * .8, h * .7], [r * .73, h * .38], [r * .52, h * .13], [0, h * .13]]
        .map(([x, y]) => new THREE.Vector2(Math.max(x, .002), y));
      potMats.set(key, new THREE.MeshStandardMaterial({
        color: glaze, roughness: .52, metalness: .08, side: THREE.DoubleSide, emissive: '#000000',
      }));
    }
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(
      [[0, 0], [TRACK.potR * .55, 0], [TRACK.potR * .88, .1], [TRACK.potR, .27], [TRACK.potR, .46], [TRACK.potR * .95, .62],
        [TRACK.potR * .8, .62], [TRACK.potR * .8, .43], [TRACK.potR * .73, .24], [TRACK.potR * .52, .08], [0, .08]]
        .map(([x, y]) => new THREE.Vector2(Math.max(x, .002), y)), 24), potMats.get(key));
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  const pots = [];
  for (const column of ['before', 'after']) {
    for (let slot = 0; slot < 4; slot++) {
      const x = TRACK.potX(slot, column);
      const g = new THREE.Group();
      g.position.set(x, 0, TRACK.potZ);
      g.add(potMesh(GLAZE[column].color));
      box(g, m('#2a2018'), [.62, .05, .62], [0, .025, 0]);
      potGroup.add(g);
      const rec = { column, slot, x, group: g, material: g.children[0].material };
      pots.push(rec);
      bench.register(g, `pot:${column}:${slot}`, {
        pad: [.72, .6, .72],
        onHoverStart: () => { g.userData.lift = 1; },
        onHoverEnd: () => { g.userData.lift = 0; },
        onClick: () => { clack(true); handlers.onPot?.(column, slot); },
      });
    }
    }
  // 每只罐前面一小块刻字：这一罐装的是什么结局、多少局。
  const potLabelMap = new Map();
  for (const column of ['before', 'after']) {
    for (let slot = 0; slot < 4; slot++) {
      const plate = makePlate({
        width: .78, height: .44, px: 512, py: 292, maxFont: 52,
        at: [TRACK.potX(slot, column), .05, TRACK.potZ + .84], rotation: [-Math.PI / 2 + .6, 0, 0],
        lines: [ENDINGS[SLOT_ENDING[slot]].label, '— 局'],
      });
      root.add(plate.mesh);
      potLabelMap.set(`${column}:${slot}`, plate);
    }
  }
  const setPotLabel = (column, slot, lines) => potLabelMap.get(`${column}:${slot}`)?.setText(lines);

  /* ---------------- 五个铜钮 ---------------- */
  const knobNodes = new Map();
  const knobX = i => -3.4 + i * 1.7;
  variables.forEach((v, i) => {
    const x = knobX(i);
    const g = new THREE.Group();
    g.position.set(x, 0, KNOB_Z);
    root.add(g);
    box(g, BRASS_DARK(), [1.06, .05, 1.06], [0, .025, 0]);
    for (let t = 0; t <= 12; t++) {
      const a = (t / 12) * Math.PI * 2;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(.04, .03, t % 3 ? .09 : .15), t % 3 ? IRON() : BRASS());
      tick.position.set(Math.sin(a) * .62, .055, Math.cos(a) * .62);
      tick.rotation.y = a;
      g.add(tick);
    }
    const dial = new THREE.Group();
    dial.position.y = .07;
    g.add(dial);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.5, .56, .26, 26), BRASS());
    body.position.y = .13; body.castShadow = true; dial.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.2, .34, .11, 22), BRASS_DARK());
    cap.position.y = .3; cap.castShadow = true; dial.add(cap);
    const pointer = new THREE.Mesh(new THREE.BoxGeometry(.075, .05, .46), m('#f0d79a', { metalness: .5, roughness: .3 }));
    pointer.position.set(0, .305, .2); pointer.castShadow = true; dial.add(pointer);
    const plaque = makePlate({
      width: 1.6, height: .46, px: 1024, py: 292,
      at: [x, .07, KNOB_Z + .78], rotation: [-Math.PI / 2 + .5, 0, 0],
      lines: [v.label, ''],
    });
    root.add(plaque.mesh);

    const node = { id: v.id, def: v, group: g, dial, plaque, value: v.base, lift: 0 };
    knobNodes.set(v.id, node);
    let acc = 0, start = v.base, firing = false;

    const apply = value => {
      const clamped = Math.max(v.min, Math.min(v.max, value));
      const snapped = Math.round(clamped / v.step) * v.step;
      const next = Math.max(v.min, Math.min(v.max, +snapped.toFixed(6)));
      if (next === node.value) return false;
      node.value = next;
      setKnob(v.id, next);
      clack();
      handlers.onKnob?.(v.id, next);
      return true;
    };
    bench.register(g, `knob:${v.id}`, {
      // 手感区只比铜钮本身大一圈：再高就会盖住身后那一排陶罐的罐底。
      pad: [1.16, .62, 1.16],
      onHoverStart: () => { node.hover = true; },
      onHoverEnd: () => { node.hover = false; },
      onDragStart: () => { acc = 0; start = node.value; firing = true; node.dragging = true; },
      onDrag: (dx, dy) => {
        acc += Math.abs(dx) >= Math.abs(dy) ? dx : -dy;
        apply(start + (acc / 260) * (v.max - v.min));
      },
      onDragEnd: () => { firing = false; node.dragging = false; },
      onClick: () => {
        if (firing) return;
        node.selected = !node.selected;
        bench.setEmptyDrag(node.selected ? { onDrag: (dx, dy) => { acc += Math.abs(dx) >= Math.abs(dy) ? dx : -dy; apply(node.value + (dy || dx) / 60 * v.step); } } : null);
        handlers.onSelect?.(node.selected ? v.id : null);
        clack();
      },
    });
  });

  function setKnob(id, value) {
    const node = knobNodes.get(id);
    if (!node) return;
    const v = node.def;
    node.value = value;
    const f = (value - v.min) / (v.max - v.min);
    node.dial.rotation.y = THREE.MathUtils.degToRad(-126 + 252 * f);
    node.plaque.setText([v.label, `${value.toFixed(2)}${value === v.base ? '　原设定' : ''}`]);
  }

  /* ---------------- 导演令牌：翻一面 ---------------- */
  const token = { director: 'lu', flip: 0 };
  {
    // 立在两只铜钮中间：站在整列铜钮正前方的话，它的手感区会吃掉最左边那只铜钮。
    const x = -2.4;
    const g = new THREE.Group();
    g.position.set(x, 0, FRONT_Z);
    root.add(g);
    box(g, WOOD2(), [.5, .1, .5], [0, .05, 0]);
    box(g, BRASS_DARK(), [.09, .78, .09], [0, .48, 0]);
    const tile = new THREE.Group();
    tile.position.y = .9;
    g.add(tile);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, .8, .07), WOOD2());
    body.castShadow = true; tile.add(body);
    const faceA = makePlate({ width: 1.0, height: .7, px: 640, py: 448, maxFont: 92, at: [0, 0, .041], lines: ['陆导', '爱雕琢'] });
    const faceB = makePlate({ width: 1.0, height: .7, px: 640, py: 448, maxFont: 92, at: [0, 0, -.041], rotation: [0, Math.PI, 0], lines: ['单导', '爱放开'] });
    tile.add(faceA.mesh, faceB.mesh);
    // 底座一块小木牌，说明这一件管什么。
    const tag = makePlate({ width: 1.25, height: .3, px: 640, py: 154, maxFont: 56, at: [x, .3, FRONT_Z + .42], text: '换一位导演' });
    root.add(tag.mesh);
    token.node = tile; token.plateA = faceA; token.plateB = faceB;
    bench.register(g, 'token', {
      pad: [1.14, 1.0, .5],
      onHoverStart: () => { token.hover = true; },
      onHoverEnd: () => { token.hover = false; },
      onClick: () => {
        token.director = token.director === 'lu' ? 'shan' : 'lu';
        token.target = token.director === 'lu' ? 0 : Math.PI;
        clack(true);
        handlers.onToken?.(token.director);
      },
    });
  }

  /* ---------------- 豆斗：每种玩家走几局 ---------------- */
  const bowl = { n: 8, shown: 2 };
  {
    const x = -3.7;
    const g = new THREE.Group();
    g.position.set(x, 0, FRONT_Z);
    root.add(g);
    const shape = [[0, 0], [.34, 0], [.46, .1], [.52, .24], [.54, .3], [.48, .3], [.44, .24], [.36, .12], [.28, .06], [0, .06]]
      .map(([px, py]) => new THREE.Vector2(Math.max(px, .002), py));
    const cup = new THREE.Mesh(new THREE.LatheGeometry(shape, 22), m('#6b4a2c', { roughness: .8, side: THREE.DoubleSide }));
    cup.castShadow = true; cup.receiveShadow = true;
    g.add(cup);
    const seeds = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(.062, 10, 8), m(i % 2 ? '#6fa9c4' : '#c2603f', { roughness: .5 }));
      const ring = Math.floor(i / 4);
      s.position.set(Math.cos(i * 1.9 + ring) * (ring ? .16 : .24), .13 + ring * .1, Math.sin(i * 1.9 + ring) * (ring ? .16 : .24) * .9);
      s.castShadow = true;
      g.add(s);
      seeds.push(s);
    }
    const tag = makePlate({ width: 1.5, height: .3, px: 640, py: 154, maxFont: 56, at: [x, .34, FRONT_Z + .45], lines: ['每种玩家 8 局'] });
    root.add(tag.mesh);
    bowl.node = g; bowl.seeds = seeds; bowl.tag = tag;
    bench.register(g, 'bowl', {
      pad: [1.0, .62, 1.0],
      onHoverStart: () => { bowl.hover = true; },
      onHoverEnd: () => { bowl.hover = false; },
      onClick: () => {
        bowl.n = bowl.n === 8 ? 16 : bowl.n === 16 ? 32 : 8;
        setBowl(bowl.n);
        clack(true);
        handlers.onBowl?.(bowl.n);
      },
    });
  }
  function setBowl(n) {
    bowl.n = n; bowl.shown = n / 4;
    bowl.seeds.forEach((s, i) => { s.visible = i < bowl.shown; });
    bowl.tag.setText([`每种玩家 ${n} 局`]);
  }

  /* ---------------- 归位铜钉 ---------------- */
  const resetPin = { press: 0 };
  {
    const x = .6;
    const g = new THREE.Group();
    g.position.set(x, 0, FRONT_Z);
    root.add(g);
    box(g, BRASS_DARK(), [.5, .06, .5], [0, .03, 0]);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.11, .16, .42, 16), BRASS());
    stem.position.y = .27; stem.castShadow = true; g.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.17, 18, 12), BRASS());
    cap.position.y = .5; cap.castShadow = true; g.add(cap);
    const tag = makePlate({ width: 1.35, height: .3, px: 640, py: 154, maxFont: 56, at: [x, .34, FRONT_Z + .42], lines: ['旋钮归位'] });
    root.add(tag.mesh);
    resetPin.node = cap;
    bench.register(g, 'reset', {
      pad: [.86, .86, .86],
      onHoverStart: () => { resetPin.hover = true; },
      onHoverEnd: () => { resetPin.hover = false; },
      onClick: () => { resetPin.press = 1; clack(true); handlers.onReset?.(); },
    });
  }

  /* ---------------- 闸杆 ---------------- */
  const lever = { angle: -.3, target: -.3, pull: 0, armed: true };
  {
    const x = 3.9, z = 4.95;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    root.add(g);
    box(g, IRON(), [.62, .22, .52], [0, .11, 0]);
    const pivot = new THREE.Group();
    pivot.position.y = .2;
    g.add(pivot);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.06, .085, 1.9, 14), BRASS());
    rod.position.y = .95; rod.castShadow = true; pivot.add(rod);
    const grip = new THREE.Mesh(new THREE.SphereGeometry(.2, 20, 14), IRON());
    grip.position.y = 1.92; grip.castShadow = true; pivot.add(grip);
    const plate = makePlate({ width: 1.6, height: .34, px: 640, py: 140, maxFont: 56, at: [x, .5, z + .42], lines: ['拉闸 · 重跑'] });
    root.add(plate.mesh);
    lever.node = g; lever.pivot = pivot; lever.plate = plate; lever.grip = grip;
    let pull = 0, dragging = false;
    const fire = () => {
      if (!lever.armed) return;
      lever.armed = false;
      lever.target = 1.15;
      clack(true);
      handlers.onRun?.();
      setTimeout(() => { lever.armed = true; lever.target = -.3; }, 1400);
    };
    bench.register(g, 'lever', {
      pad: [.55, .7, .5, 1.6],
      cursor: 'grab',
      onHoverStart: () => { lever.hover = true; },
      onHoverEnd: () => { lever.hover = false; },
      onDragStart: () => { dragging = true; pull = 0; },
      onDrag: (dx, dy) => {
        pull += dy;
        lever.target = Math.max(-.3, Math.min(1.15, -.3 + pull / 90));
        if (pull > 36) { dragging = false; fire(); }
      },
      onDragEnd: () => { if (dragging) { dragging = false; lever.target = -.3; } },
      onClick: () => fire(),
    });
  }

  /* ---------------- 案头两盏灯：改前一盏冷的，改后一盏暖的 ---------------- */
  const lamps = {};
  {
    const spec = { before: { x: -4.5, glow: '#7fb6e6' }, after: { x: 4.5, glow: '#ffb573' } };
    for (const [column, s] of Object.entries(spec)) {
      const g = new THREE.Group();
      g.position.set(s.x, 0, 4.3);
      root.add(g);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(.34, .4, .06, 20), BRASS_DARK());
      base.position.y = .03; base.castShadow = true; base.receiveShadow = true; g.add(base);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(.045, .06, .92, 12), BRASS());
      stem.position.y = .5; stem.castShadow = true; g.add(stem);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(.17, .27, .28, 18, 1, true),
        m('#4b3a25', { roughness: .7, side: THREE.DoubleSide }));
      shade.position.y = 1.12; shade.castShadow = true; g.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.105, 16, 12),
        new THREE.MeshStandardMaterial({ color: '#ffe6c0', emissive: s.glow, emissiveIntensity: 0, roughness: .4 }));
      bulb.position.y = 1.03; g.add(bulb);
      const light = new THREE.PointLight(s.glow, 0, 7, 2);
      light.position.set(0, 1.06, 0);
      g.add(light);
      lamps[column] = { group: g, bulb, light, glow: s.glow, on: 0, x: s.x };
      bench.register(g, `lamp:${column}`, {
        pad: [1.3, 1.7, 1.2],
        onHoverStart: () => { lamps[column].hot = true; },
        onHoverEnd: () => { lamps[column].hot = false; },
        onClick: () => handlers.onLamp?.(column),
      });
    }
  }
  /** 一盏灯亮不亮，代表这一列跑没跑出来。 */
  function setLamp(column, on) {
    const l = lamps[column];
    if (l) l.on = on ? 1 : 0;
  }

  /* ---------------- 顶上的两块刻字 ---------------- */
  // 匾额是钉死的机器说明，不跟着这一次实验变：会变的那句话挂在网页的刻字上。
  const title = makePlate({
    width: 3.6, height: .44, px: 900, py: 112, maxFont: 56, ink: '#f2dcae',
    at: [0, 5.65, -1.24], rotation: [-.05, 0, 0], text: '推演机 · 同一个世界，换一个条件',
  });
  const plaque = makePlate({
    width: 6.6, height: .8, px: 1400, py: 170, maxFont: 62, ink: '#f6e3bb',
    at: [0, 5.03, -1.16], rotation: [-.05, 0, 0], lines: ['一粒豆子走一局 · 落进哪只陶罐就是结局'],
  });
  root.add(title.mesh, plaque.mesh);

  /* ---------------- 案前缘的铭牌：那句诚实话刻在机器上，不占网页 ----------------
     跟真机器上的铭牌一样，凑近才读得清；全文也另存在 ?dev=1 的记录里。 */
  const NOTE_LINES = [
    '这是机制实验，不是真人体验调查。',
    '固定策略会反复走同样的路，局数增加不等于独立玩家增多。',
    '感动、归因与重玩意愿仍需要真人试玩；改动只在本次浏览器实验生效。',
  ];
  const notePlate = makePlate({
    width: 6.4, height: .56, px: 2560, py: 224, maxFont: 54,
    ink: '#a2957a', bg: 'rgba(10,8,6,.46)', border: 'rgba(198,162,98,.2)',
    at: [0, -.58, TABLE.cz + TABLE.d / 2 + .03], lines: NOTE_LINES,
  });
  root.add(notePlate.mesh);

  /* ---------------- 每帧的小动作 ---------------- */
  bench.addUpdater((dt, clock) => {
    for (const [id, node] of knobNodes) {
      const want = (node.hover || node.selected || node.dragging) ? .1 : 0;
      node.lift += (want - node.lift) * (1 - Math.exp(-dt * 10));
      node.group.position.y = node.lift;
      node.dial.rotation.x = 0;
    }
    if (token.target !== undefined) {
      token.flip += (token.target - token.flip) * (1 - Math.exp(-dt * 7));
      token.node.rotation.y = token.flip;
      const dy = token.hover ? .06 : 0;
      token.node.position.y = .9 + dy;
    }
    bowl.node.children.forEach(c => { if (c.geometry?.type === 'SphereGeometry') c.position.y += 0; });
    bowl.node.scale.setScalar(1 + (bowl.hover ? .03 : 0));
    resetPin.press = Math.max(0, resetPin.press - dt * 3);
    resetPin.node.position.y = .5 - resetPin.press * .12;
    resetPin.node.scale.setScalar(1 + (resetPin.hover ? .06 : 0));
    lever.angle += (lever.target - lever.angle) * (1 - Math.exp(-dt * 9));
    lever.pivot.rotation.x = lever.angle;
    lever.grip.scale.setScalar(1 + (lever.hover ? .12 : 0));
    // 陶罐被指到时抬一点，被点到时亮一下。
    for (const pot of pots) {
      const lift = pot.group.userData.lift ? .04 : 0;
      pot.group.position.y += (lift - pot.group.position.y) * (1 - Math.exp(-dt * 9));
      pot.material.emissiveIntensity = Math.max(0, (pot.material.emissiveIntensity || 0) - dt * 1.6);
    }
    // 轨道被豆子踩过时亮一道，随后暗回去。
    rowMats.forEach(mat => { mat.emissiveIntensity = Math.max(0, (mat.emissiveIntensity || 0) - dt * 2.2); });
    // 案头两盏灯：跑出来了就亮起来。
    for (const l of Object.values(lamps)) {
      const want = l.on * .9 + (l.hot ? .45 : 0) + Math.sin(clock * 1.4) * .03;
      l.bulb.material.emissiveIntensity += (want * 1.8 - l.bulb.material.emissiveIntensity) * (1 - Math.exp(-dt * 6));
      l.light.intensity += (want * 17 - l.light.intensity) * (1 - Math.exp(-dt * 6));
    }
  });

  return {
    root, handlers, pots, knobNodes, token, bowl, lever,
    beanRoot: potGroup.parent === root ? root : root,
    setKnob, setBowl, setToken: director => {
      token.director = director;
      token.target = director === 'shan' ? 0 : Math.PI;
    },
    get director() { return token.director; },
    get samples() { return bowl.n; },
    setTitle: lines => title.setText(Array.isArray(lines) ? lines : [lines]),
    setPlaque: lines => plaque.setText(Array.isArray(lines) ? lines : [lines]),
    /** 凑近读竹简的时候，顶上两块刻字先让开：不然字压字，两边都读不清。 */
    showTopPlates: on => { title.mesh.visible = on; plaque.mesh.visible = on; },
    /** 案前缘那块铭牌：那句诚实话。 */
    note: notePlate, noteLines: NOTE_LINES,
    /** 一层岔路被踩过：亮一下，豆子的路就看出来了。 */
    flashRow(k, color = '#c98b4a', power = 1.6) {
      const mat = rowMats[k];
      if (!mat) return;
      mat.emissive.set(color);
      mat.emissiveIntensity = power;
    },
    flashPot(column, slot, color = '#c98b4a') {
      const pot = pots.find(p => p.column === column && p.slot === slot);
      if (!pot) return;
      pot.material.emissive.set(color);
      pot.material.emissiveIntensity = 1.4;
    },
    potPoint(column, slot) {
      const x = TRACK.potX(slot, column);
      return new THREE.Vector3(x, TRACK.potTop + .3, TRACK.potZ);
    },
    lampPoint(column) {
      return new THREE.Vector3(lamps[column]?.x ?? 0, 1.5, 4.3);
    },
    setPotLabel,
    setLamp,
    potLabelPoint(column, slot) {
      return new THREE.Vector3(TRACK.potX(slot, column), .14, TRACK.potZ + .84);
    },
    knobX,
  };
}
