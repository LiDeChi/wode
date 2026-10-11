// 推演机：一张案，一台木架机器，五个铜钮，一杆闸，八个陶罐。
// 所有能摸的东西都在这里搭出来；谁被拨了、被拉了，由 main.js 决定做什么。
import * as THREE from 'three';
import { makePlate } from './labels.js';
import { TRACK, GLAZE, SLOT_ENDING, ENDINGS, LANE_APPEALS, LAYER_NAMES } from './beans.js';

/* 槽底的木头色：走痕就是从它往釉色上染。 */
const WEAR_BASE = new THREE.Color('#2a2016');

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
  /* 机器本体（机架、四层轨道、铜钮、陶罐、顶上两块刻字）挂在这一个组的下面，
     案与地不挂进来：量取景的时候只量机器，别把八十米的底板算进去。 */
  const machine = new THREE.Group();
  root.add(machine);
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
  box(machine, WOOD2(), [TRACK.half * 2 + .5, 3.6, .16], [0, 2.0, -.92]);
  for (const s of [-1, 1]) box(machine, WOOD2(), [.16, 3.7, 1.9], [s * sx2, 2.0, 0]);
  for (const s of [-1, 1]) box(machine, WOOD(), [.26, 6.15, .26], [s * 3.3, 3.07, -1.32]);
  box(machine, WOOD(), [7.1, .34, .46], [0, 6.15, -1.32]);

  /* 四层轨道。每层刨出五条槽：槽底比两边的棱低，槽尾立着一块小挡板，挡板上刻这一幕能走的路
     （义／利／惧／恩／旁观），层口左端刻这一幕的名字（大梁／夷门／取符之夜／邺城）。
     豆子在哪条槽里走的局数多，槽底就往釉色上染得深——不看数字也读得出大多数人在哪里拐了弯。 */
  const rowMats = [], rowGroups = [];
  const wearStrips = [];      // wearStrips[row][lane][column] = 那块染色的槽底
  const wearMix = [];         // 目标深浅，一帧一帧追上去
  for (let k = 0; k < TRACK.rows; k++) {
    const g = new THREE.Group();
    g.position.y = TRACK.rowY[k];
    machine.add(g);
    const mat = m('#4a3823', { roughness: .88, emissive: '#000000' });
    rowMats.push(mat);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(TRACK.half * 2, .06, TRACK.rowDepth), mat);
    slab.position.y = -.05;                       // 板面就是槽底
    slab.receiveShadow = true; slab.castShadow = true;
    g.add(slab);
    const strips = [], mixes = [];
    for (let i = 0; i < 5; i++) {
      const cx = TRACK.laneX(i);
      const perColumn = {}, perMix = {};
      for (const column of ['before', 'after']) {
        // 一条槽里两道磨痕：靠里那道是改前走的，靠外那道是改后走的。
        const strip = box(g, m('#2a2016', { roughness: .92, emissive: GLAZE[column].color, emissiveIntensity: 0 }),
          [.32, .012, TRACK.rowDepth - .34],
          [cx + (column === 'before' ? -.19 : .19), -.038, 0]);
        strip.castShadow = false; strip.receiveShadow = false;
        strip.name = '走痕';
        perColumn[column] = strip;
        perMix[column] = 0;
      }
      strips.push(perColumn); mixes.push(perMix);
    }
    wearStrips.push(strips); wearMix.push(mixes);
    // 槽与槽之间的棱：比槽底高一点，槽才看得出来。
    for (let i = 0; i <= 5; i++) box(g, m('#3a2c1c'), [.12, .105, TRACK.rowDepth], [TRACK.laneX(0) - .52 + i * 1.04, -.0075, 0]).name = '槽棱';
    if (k === TRACK.rows - 1) box(g, m('#3a2c1c'), [TRACK.half * 2, .13, .16], [0, .045, TRACK.rowDepth / 2 - .04]);
    // 槽尾：一块斜的小挡板，上面刻这条道叫什么。
    for (let i = 0; i < 5; i++) {
      const cx = TRACK.laneX(i);
      box(g, m('#6b5230', { roughness: .8 }), [.42, .03, .26], [cx, .045, -TRACK.rowDepth / 2 + .3], [-.6, 0, 0]).name = '槽尾挡板';
      const tag = makePlate({
        width: .4, height: .24, px: 256, py: 168, maxFont: 92, ink: '#f6e6c2',
        at: [cx, .19, -TRACK.rowDepth / 2 + .22], rotation: [-.6, 0, 0], lines: [LANE_APPEALS[i]],
      });
      tag.mesh.name = '岔路牌';
      g.add(tag.mesh);
    }
    // 层名挂在机架左端外边（不在槽的正上方，免得挡住豆子）：这一幕叫什么。
    const act = makePlate({
      width: .95, height: .34, px: 512, py: 200, maxFont: 86, ink: '#f0dcb4',
      at: [-3.35, .12, .35], rotation: [-.35, 0, 0], lines: [LAYER_NAMES[k]],
    });
    act.mesh.name = '幕名牌';
    machine.add(act.mesh);
    rowGroups.push(g);
  }

  /* 槽底的走痕：counts[row][lane][column] 是走这条道的局数，totals[column] 是那一列一共多少局。
     染到釉色上、越走越深；豆子还在落的时候一层层加上去，落完了就留在那儿。 */
  function setWear(counts, totals = {}) {
    for (let row = 0; row < wearMix.length; row++) {
      for (let lane = 0; lane < wearMix[row].length; lane++) {
        for (const column of ['before', 'after']) {
          const n = counts?.[row]?.[lane]?.[column] || 0;
          const total = totals[column] || 0;
          const share = total ? n / total : 0;
          wearMix[row][lane][column] = share > 0 ? Math.min(1, .12 + share * 1.7) : 0;
        }
      }
    }
  }
  /** 自查用：这条槽现在染得多深（0 = 没走过）。 */
  const wearOf = (row, lane, column) => wearMix[row]?.[lane]?.[column] ?? 0;
  // 顶上那只漏斗：豆子从这里下去。
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(3.35, .42, 1.15, 4, 1, true), m('#4c4238', { roughness: .6, metalness: .35, side: THREE.DoubleSide }));
  funnel.rotation.y = Math.PI / 4;
  funnel.position.set(0, 4.08, 0);
  funnel.castShadow = true;
  machine.add(funnel);
  box(machine, m('#5b5044', { metalness: .4, roughness: .5 }), [4.7, .12, 4.7], [0, 3.52, 0]);

  /* ---------------- 八只陶罐：四种结局 × 青釉／酱釉 ---------------- */
  const potGroup = new THREE.Group();
  machine.add(potGroup);
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
        pad: bench.tall ? [.72, .9, 1.05] : [.72, .6, .72],
        onHoverStart: () => { g.userData.lift = 1; setPotFlipTarget(column, slot, Math.PI); },
        onHoverEnd: () => { g.userData.lift = 0; setPotFlipTarget(column, slot, 0); },
        onClick: () => { clack(true); handlers.onPot?.(column, slot); },
      });
    }
    }
  /* 每只罐口挂一块木签：正面刻这一罐是什么结局、多少局；指到罐子时木签翻个面，
     背面刻谁走到这儿（先看心思几局、直接动手几局…）。信息挂在实物上，不浮在网页上。 */
  const potLabelMap = new Map();
  for (const column of ['before', 'after']) {
    for (let slot = 0; slot < 4; slot++) {
      const pivot = new THREE.Group();
      pivot.position.set(TRACK.potX(slot, column), .05, TRACK.potZ + .84);
      pivot.rotation.set(-Math.PI / 2 + .6, 0, 0);
      const flap = new THREE.Group();
      pivot.add(flap);
      machine.add(pivot);
      const front = makePlate({
        width: .78, height: .44, px: 512, py: 292, maxFont: 52,
        at: [0, 0, .008], lines: [ENDINGS[SLOT_ENDING[slot]].label, '— 局'],
      });
      const back = makePlate({
        width: .78, height: .44, px: 512, py: 292, maxFont: 52, ink: '#e8d6b2',
        at: [0, 0, -.008], rotation: [0, Math.PI, 0], lines: ['还没走到这儿', ''],
      });
      flap.add(front.mesh); flap.add(back.mesh);
      const rec = { pivot, flap, front, back, flip: 0, target: 0 };
      potLabelMap.set(`${column}:${slot}`, rec);
    }
  }
  const setPotLabel = (column, slot, lines) => potLabelMap.get(`${column}:${slot}`)?.front.setText(lines);
  const setPotBack = (column, slot, lines) => potLabelMap.get(`${column}:${slot}`)?.back.setText(lines);
  const setPotFlipTarget = (column, slot, v) => { const r = potLabelMap.get(`${column}:${slot}`); if (r) r.target = v; };
  /** 自查用：这块木签翻到哪一面了（0 = 正面，1 = 背面）。 */
  const potFlip = (column, slot) => (potLabelMap.get(`${column}:${slot}`)?.flip ?? 0) / Math.PI;
  /** 自查用：木签背面此刻写着什么。 */
  const potBackLines = (column, slot) => potLabelMap.get(`${column}:${slot}`)?.back.lines?.slice() ?? null;

  /* ---------------- 五个铜钮 ---------------- */
  /* 刻在牌上的长句子按字断行：牌子小，宁可多一行也别缩成看不清。 */
  const wrapLines = (s, n = 12, max = 3) => {
    const t = String(s ?? '').trim();
    const out = [];
    let rest = t;
    while (rest && out.length < max) {
      if (rest.length <= n) { out.push(rest); rest = ''; break; }
      let cutAt = -1;
      for (const p of ['；', '，', '。', '、']) {
        const i = rest.lastIndexOf(p, n);
        if (i > 3) { cutAt = i + 1; break; }
      }
      if (cutAt < 0) cutAt = n;
      out.push(rest.slice(0, cutAt));
      rest = rest.slice(cutAt);
    }
    if (rest) out[out.length - 1] = out[out.length - 1].slice(0, -1) + '…';
    return out;
  };
  const knobNodes = new Map();
  const knobX = i => -3.4 + i * 1.7;
  variables.forEach((v, i) => {
    const x = knobX(i);
    const g = new THREE.Group();
    g.position.set(x, 0, KNOB_Z);
    machine.add(g);
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
    // 铜钮前一块牌：正面刻「这只钮是什么、现在多少」，指到它就翻个面，背面刻它动的是什么。
    const pivot = new THREE.Group();
    pivot.position.set(x, .07, KNOB_Z + .78);
    pivot.rotation.set(-Math.PI / 2 + .5, 0, 0);
    const flap = new THREE.Group();
    pivot.add(flap);
    machine.add(pivot);
    const plaque = makePlate({
      width: 1.6, height: .46, px: 1024, py: 292, maxFont: 60,
      at: [0, 0, .008], lines: [v.label, ''],
    });
    const whyBack = makePlate({
      width: 1.6, height: .46, px: 1024, py: 292, maxFont: 60, ink: '#e8d6b2',
      at: [0, 0, -.008], rotation: [0, Math.PI, 0], lines: wrapLines(v.why),
    });
    flap.add(plaque.mesh); flap.add(whyBack.mesh);
    const knobTag = { pivot, flap, front: plaque, back: whyBack, flip: 0, target: 0 };

    const node = { id: v.id, def: v, group: g, dial, plaque, knobTag, value: v.base, lift: 0 };
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
      // 竖屏只放大一圈：再宽下去，这一排五只钮在手机窄屏上就互相顶到屏外。
      pad: bench.tall ? [1.06, .8, 1.06] : [1.16, .62, 1.16],
      onHoverStart: () => { node.hover = true; knobTag.target = Math.PI; },
      onHoverEnd: () => { node.hover = false; knobTag.target = 0; },
      onDragStart: () => { acc = 0; start = node.value; firing = true; node.dragging = true; knobTag.target = 0; },
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

  /* ---------------- 案沿那几件：竖屏上压住铜钮的，端到案前地上 ----------------
     铜钮在案沿里面（z 3.2），令牌/归位钉/冷灯在案沿外面（z 4.3–4.5）。竖屏俯角小，
     一单位 z 只换二十来像素，前面那几件在屏幕上正好盖住身后的铜钮：点钮会点到它们。
     只端真正压住钮的那三件（放到案前地上，y −1.62），别的一动不动——搬多了它们互相挤。 */
  const deskParts = [];
  // 端下来之后，五件在案前地上各占一个位子：左边冷灯、中间令牌与归位钉、右边闸杆与暖灯。
  const TALL_DESK = {
    // 站位按「屏幕上一排五个槽」挑的：斜视角下越靠前越往右跑，所以 x 得一件件试出来。
    'lamp:before': { x: -3.1, y: -1.62, z: 6.0 },
    token: { x: -1.9, y: -1.62, z: 6.1 },
    reset: { x: -.7, y: -1.62, z: 6.2 },
    lever: { x: .3, y: -1.62, z: 6.4 },
    'lamp:after': { x: -4.3, y: -1.62, z: 6.0 },
  };
  /** 竖屏/桌面两套摆位；一件东西的木牌跟着它自己走（木牌是根节点的绝对坐标）。 */
  function setTallLayout(on) {
    for (const p of deskParts) {
      const t = on ? TALL_DESK[p.name] : null;
      const x = t?.x ?? p.x, y = t?.y ?? 0, z = t?.z ?? p.z;
      p.group.position.set(x, y, z);
      if (p.tag) p.tag.mesh.position.set(x, p.tagY + y, z + p.tagDz);
    }
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
    deskParts.push({ name: 'token', group: g, x, z: FRONT_Z, tag, tagY: .3, tagDz: .42 });
    token.node = tile; token.plateA = faceA; token.plateB = faceB;
    bench.register(g, 'token', {
      pad: bench.tall ? [1.14, 1.2, .7] : [1.14, 1.0, .5],
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
    const tag = makePlate({ width: 1.5, height: .44, px: 640, py: 220, maxFont: 56, at: [x, .34, FRONT_Z + .45], lines: ['每种玩家 8 局', '点一下换局数'] });
    root.add(tag.mesh);
    bowl.node = g; bowl.seeds = seeds; bowl.tag = tag;
    bench.register(g, 'bowl', {
      pad: bench.tall ? [1.0, .8, 1.1] : [1.0, .62, 1.0],
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
    bowl.tag.setText([`每种玩家 ${n} 局`, '点一下换局数']);
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
    deskParts.push({ name: 'reset', group: g, x, z: FRONT_Z, tag, tagY: .34, tagDz: .42 });
    resetPin.node = cap;
    bench.register(g, 'reset', {
      pad: bench.tall ? [1.0, 1.0, 1.0] : [.86, .86, .86],
      onHoverStart: () => { resetPin.hover = true; },
      onHoverEnd: () => { resetPin.hover = false; },
      onClick: () => { resetPin.press = 1; clack(true); handlers.onReset?.(); },
    });
  }

  /* ---------------- 闸杆 ---------------- */
  const lever = { angle: -.3, target: -.3, pull: 0, armed: true };
  {
    // 竖屏上闸杆是伸得最右的一件，窄屏里会被切掉：那套摆位在 TALL_DESK 里，见上。
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
    deskParts.push({ name: 'lever', group: g, x, z, tag: plate, tagY: .5, tagDz: .42 });
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
      pad: bench.tall ? [.7, .95, .6, 1.6] : [.55, .7, .5, 1.6],
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
      deskParts.push({ name: `lamp:${column}`, group: g, x: s.x, z: 4.3 });
      bench.register(g, `lamp:${column}`, {
        pad: bench.tall ? [1.05, 1.45, 1.15] : [1.3, 1.7, 1.2],
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
  title.mesh.name = '题字';
  plaque.mesh.name = '匾额';
  machine.add(title.mesh, plaque.mesh);

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
    // 槽底的走痕追着目标深浅过去：慢慢染，看着像是被豆子磨出来的。
    for (let row = 0; row < wearStrips.length; row++) {
      for (let lane = 0; lane < wearStrips[row].length; lane++) {
        for (const column of ['before', 'after']) {
          const mesh = wearStrips[row][lane][column];
          const want = wearMix[row][lane][column];
          const now = mesh.userData.mix ?? 0;
          if (Math.abs(want - now) < .002) continue;
          const mix = now + (want - now) * (1 - Math.exp(-dt * 2.6));
          mesh.userData.mix = mix;
          mesh.material.color.copy(WEAR_BASE).lerp(new THREE.Color(GLAZE[column].color), mix);
          mesh.material.emissiveIntensity = mix * .5;
        }
      }
    }
    // 罐口木签：指到罐子就翻个面，露出背面那笔账。
    for (const rec of potLabelMap.values()) {
      if (Math.abs(rec.target - rec.flip) > .002) {
        rec.flip += (rec.target - rec.flip) * (1 - Math.exp(-dt * 7));
        rec.flap.rotation.y = rec.flip;
        rec.pivot.position.y = .05 + Math.sin(rec.flip) * .06;   // 翻的时候稍微抬起来一点
      }
    }
    // 铜钮前的牌子同理：指到钮就翻到背面，看这只钮动的是什么。
    for (const node of knobNodes.values()) {
      const tag = node.knobTag;
      if (!tag || Math.abs(tag.target - tag.flip) < .002) continue;
      tag.flip += (tag.target - tag.flip) * (1 - Math.exp(-dt * 7));
      tag.flap.rotation.y = tag.flip;
      tag.pivot.position.y = .07 + Math.sin(tag.flip) * .07;
    }
    // 案头两盏灯：跑出来了就亮起来。
    for (const l of Object.values(lamps)) {
      const want = l.on * .9 + (l.hot ? .45 : 0) + Math.sin(clock * 1.4) * .03;
      l.bulb.material.emissiveIntensity += (want * 1.8 - l.bulb.material.emissiveIntensity) * (1 - Math.exp(-dt * 6));
      l.light.intensity += (want * 17 - l.light.intensity) * (1 - Math.exp(-dt * 6));
    }
  });

  return {
    root, machine, handlers, pots, knobNodes, token, bowl, lever,
    /** 竖屏那一套摆位（手机窄屏上，案沿三件端到地上，免得压住铜钮）。 */
    setTallLayout,
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
    setPotLabel, setPotBack, potFlip, potBackLines,
    setWear, wearOf,
    setLamp,
    potLabelPoint(column, slot) {
      return new THREE.Vector3(TRACK.potX(slot, column), .14, TRACK.potZ + .84);
    },
    knobX,
  };
}
