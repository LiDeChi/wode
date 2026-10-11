// 排片表的戏台：夜里一座台子，三段矮几，每件实物就是一行排片。
// 这里负责把东西摆上去、给每件一盏顶光、让它们活着；点下去之后去哪，由 hub.js 决定。
import * as THREE from 'three';
import { MAT, box, beam, lantern, brazier, ground, mat as groundMat, lampOnStand } from './mats.js';
import { textPlate } from './text.js';
import * as O from './objects.js';

// 三段：越靠后越高，一眼分出「现在 / 稍后 / 之后」。台子收窄，镜头才推得近。
const ROW_Y = { 1: 0.62, 2: 0.94, 3: 1.26 };
const ROW_Z = { 1: 2.5, 2: 0.5, 3: -1.5 };
const ROW_HALF = { 1: 5.9, 2: 3.3, 3: 2.3 };
const ROW_LABEL = { 1: '现在', 2: '稍后', 3: '之后' };
const WALL_Z = -5.6;

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function createHubStage(render, items = []) {
  const { scene, camera } = render;
  const root = new THREE.Group();
  scene.add(root);

  // ── 台子：三层矮几，每层一块台面 + 前挡板；不挡东西 ─────────
  root.add(ground(160, '#221f1a'));
  root.add(groundMat(0, -0.5, 34, 26, '#2a2620'));
  for (const row of [1, 2, 3]) root.add(ledge(row, ROW_Y[row], ROW_Z[row], ROW_HALF[row]));

  // ── 背景：木屏、抱柱、横梁。留白比东西重要 ─────────────────
  root.add(box(14.6, 0.5, 1.2, MAT.woodDark, 0, 0, WALL_Z));         // 屏风底座
  root.add(box(13.4, 4.4, 0.32, MAT.wood, 0, 0.5, WALL_Z));          // 屏风
  for (const sx of [-6.6, 6.6]) {                                    // 抱柱
    root.add(box(0.5, 6.2, 0.5, MAT.woodDark, sx, 0, WALL_Z));
    root.add(box(0.34, 0.34, 0.34, MAT.bronze, sx, 6.2, WALL_Z));
  }
  root.add(box(14.1, 0.42, 0.62, MAT.woodDark, 0, 5.5, WALL_Z));     // 横梁
  // 屏上的三扇小窗：透出一点夜里的光，屏风才不是一块黑板。
  const windowGlow = [];
  for (const x of [-3.5, 0, 3.5]) {
    const frame = box(1.9, 1.7, 0.16, MAT.woodLight, x, 1.6, WALL_Z + 0.18);
    const lit = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.3),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#2e4152'), transparent: true, opacity: 0.9 }));
    lit.position.set(x, 2.4, WALL_Z + 0.28);
    root.add(frame, lit);
    windowGlow.push(lit);
  }

  // 两片布挂在台侧的杆上。风一过，它们先动。
  const banners = [];
  for (const [x, color] of [[-6.2, '#7a3a2c'], [6.2, '#2f3d56']]) {
    const z = ROW_Z[3] + 1.7;
    root.add(box(0.16, 4.4, 0.16, MAT.woodDark, x, 0, z));
    root.add(beam(1.0, 0.14, MAT.woodDark, x + 0.42, 4.5, z));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 2.3),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.95, side: THREE.DoubleSide }));
    cloth.position.set(x + 0.42, 3.0, z);
    cloth.castShadow = true;
    root.add(cloth);
    banners.push(cloth);
  }

  // 台上的一层暖光：器物各自还有一盏顶光，这盏管台面与墙。
  const wash = new THREE.PointLight(new THREE.Color('#ffc98c'), 20, 15, 2);
  wash.position.set(0, 5.0, 2.4);
  root.add(wash);
  const lamps = [lantern(-6.0, 3.6, 2.7), lantern(6.0, 3.6, 2.7)];
  const fires = [brazier(-2.9, 6.3, 1), brazier(2.9, 6.3, 1)];
  lamps.forEach(l => root.add(l));
  fires.forEach(f => root.add(f));

  // 台口的匾：这里是什么地方。挂在横梁下。
  const board = textPlate('排片表', { size: 96, color: '#e8d8b2', worldHeight: 0.5, vertical: true, letterSpacing: 7 });
  const boardBack = box(board.scale.x * 1.4, board.scale.y * 1.55, 0.1, MAT.woodLight, 0, 4.4, WALL_Z + 0.5);
  board.position.set(0, 4.72, WALL_Z + 0.62);
  root.add(boardBack, board);

  // 三段的木牌：立在台侧，写明这一层是什么时候的事。
  const rowMarks = {};
  const markStand = {};
  const markBaseX = {};
  for (const row of [1, 2, 3]) {
    const stand = new THREE.Group();
    stand.position.set(-(ROW_HALF[row] - (row === 1 ? 1.0 : 0.42)), ROW_Y[row] - 0.02, ROW_Z[row] + 0.52);
    markStand[row] = stand;
    markBaseX[row] = stand.position.x;
    stand.rotation.y = 0.34;
    const foot = box(0.42, 0.08, 0.26, MAT.woodDark, 0, 0, 0);
    const face = textPlate(ROW_LABEL[row], { size: 88, weight: 500, color: '#efe2c2', worldHeight: 0.3, letterSpacing: 5 });
    const back = box(face.scale.x * 1.3, 0.52, 0.06, MAT.woodLight, 0, 0.08, 0.045);
    face.position.set(0, 0.34, 0.085);
    stand.add(foot, back, face);
    root.add(stand);
    rowMarks[row] = face;
  }
  // 台前的一道栏杆：把「台上」和「台阶下」分开。
  for (const sx of [-1, 1]) root.add(box(0.18, 0.9, 0.18, MAT.woodDark, sx * 9.0, 0, 5.9));
  root.add(beam(18.2, 0.16, MAT.wood, 0, 0.86, 5.9));

  // ── 摆物件：每一行排片都是一件实物，每件上头一盏顶光、旁边一片木签 ──
  const nodes = new Map();
  const rings = [];
  const tags = [];

  function place(spec, built) {
    const top = ROW_Y[spec.row];
    const group = built.group;
    if (spec.scale) group.scale.setScalar(spec.scale);
    group.position.set(spec.x, top, ROW_Z[spec.row] + (spec.dz ?? 0));

    // 木签：物件自带的（卷轴）就用它自己的；其余一律补一片名字。
    if (!group.userData.sign && spec.name) {
      const tag = O.nameTag(spec.name, { side: 1 });
      group.add(tag);
      group.userData.sign = tag;
    }

    // 顶光：跟着物件走，拿起来的时候也照得到。
    const top_light = new THREE.PointLight(new THREE.Color('#ffc27a'), 6.2, 4.8, 2);
    top_light.position.set(0, 1.28, 0.3);
    group.add(top_light);

    root.add(group);
    const node = render.add({
      ...spec,
      id: spec.id,
      group,
      explicit: new THREE.Vector3(spec.x, top + 0.45, ROW_Z[spec.row] + (spec.dz ?? 0)),
      radius: (built.radius ?? 0.6) * (spec.scale ?? 1),
    });
    node.ring = group.userData.ring;
    node.sign = group.userData.sign;
    node.light = group.userData.glow;
    node.wax = group.userData.wax;
    node.top = top_light;
    node.extra = group.userData;
    node.baseY = group.position.y;
    node.baseScale = spec.scale ?? 1;
    node.home = group.position.clone();
    if (node.sign) {
      node.sign.userData.restYaw = node.sign.rotation.y;
      tags.push(node.sign);
    }
    if (node.ring) rings.push(node.ring);
    nodes.set(spec.id, node);
    return node;
  }

  for (const spec of items) {
    if (spec.kind === 'tally') place(spec, O.tigerTally({ y: 0 }));
    else if (spec.kind === 'scroll') place(spec, O.filmScroll({ y: 0, tint: spec.tint, tag: spec.tag, tagColor: spec.tagColor }));
    else if (spec.kind === 'sealed') place(spec, O.sealedScroll({ y: 0, tag: spec.tag }));
    else if (spec.kind === 'rig') place(spec, O.inferenceRig({ y: 0 }));
    else if (spec.kind === 'knots') place(spec, O.knotChart({ y: 0, r: spec.r ?? 0.72 }));
    else if (spec.kind === 'covered') place(spec, O.covered({ y: 0, h: spec.h ?? 1.5, w: spec.w ?? 0.8, label: '备着' }));
  }

  // 导师：台边坐着的一个人，旁边一盏灯；灯下浮出他排片的那句话。
  const mentor = new THREE.Group();
  const mentorBody = O.mentorFigure({ x: -4.6, z: 4.6 }).group;
  mentor.add(mentorBody);
  mentor.add(lampOnStand(-3.8, 4.2, 1.7));
  const holder = new THREE.Group();
  holder.position.set(-3.2, 2.62, 5.15);
  mentor.add(holder);
  const mentorLamp = mentor.children.find(c => c.userData.light);
  let line = null;
  function setLine(text) {
    const next = textPlate(text, { size: 58, color: '#f6ebcd', worldHeight: 0.33, letterSpacing: 2, maxWidth: 900 });
    if (line) { holder.remove(line); disposeTree(line); }
    line = next;
    holder.add(next);
  }
  setLine('　');
  root.add(mentor);
  const mentorNode = render.add({
    id: 'mentor', kind: 'mentor', name: '导师', row: 1, act: 'mentor',
    group: mentor, explicit: new THREE.Vector3(-4.3, 1.5, 4.6), radius: 1.1,
  });

  // ── 拿起：物件飞到镜头前，转半圈，亮出木签 ──────────────────
  const camLocal = new THREE.Vector3();
  let lift = null;

  function liftUp(node) {
    return new Promise(resolve => {
      lift = {
        node, phase: 'out', t: 0,
        dur: reduceMotion() ? 0.2 : 1.05,
        from: node.group.position.clone(),
        fromYaw: node.group.rotation.y,
        resolve, done: false,
      };
    });
  }
  /** 再点一下：这一趟快进到底，不用等。 */
  function liftSkip() {
    if (lift && lift.phase === 'out') lift.dur = Math.min(lift.dur, lift.t + 0.06);
  }
  /** 放下：物件自己飞回原处。 */
  function releaseLift() {
    const node = lift?.node;
    if (!node) return;
    lift = { node, phase: 'back', t: 0, dur: 0.34, from: node.group.position.clone(), fromYaw: node.group.rotation.y, resolve: null };
  }

  function updateLift(dt) {
    if (!lift) return;
    const { node } = lift;
    lift.t += dt;
    camera.updateMatrixWorld();
    if (lift.phase === 'back') {
      const e = smooth(lift.t / lift.dur);
      node.group.position.lerpVectors(lift.from, node.home, e);
      node.group.rotation.y = lift.fromYaw * (1 - e);
      node.group.scale.setScalar(node.baseScale * (1 + 0.22 * (1 - e)));
      if (lift.t >= lift.dur) {
        node.group.position.copy(node.home);
        node.group.rotation.y = 0;
        node.group.scale.setScalar(node.baseScale);
        node.held = false;
        lift = null;
      }
      return;
    }
    const flight = smooth(Math.min(1, lift.t / (lift.dur * 0.6)));
    // 送到镜头前多远：按物件自身的体积定，跟镜头当时离它多远无关——
    // 否则镜头一推近，"镜头前 d 米"就正好落回它原来的位置，看不出被拿起。
    const d = Math.max(2.5, Math.min(5.0, node.radius * 2.6));
    camLocal.set(0.13 * d, -0.12 * d + Math.sin(flight * Math.PI) * 0.5, -d).applyMatrix4(camera.matrixWorld);
    node.group.position.lerpVectors(lift.from, camLocal, flight);
    node.group.rotation.y = lift.fromYaw + flight * Math.PI;
    node.group.scale.setScalar(node.baseScale * (1 + flight * 0.24));
    if (lift.t >= lift.dur && !lift.done) {
      lift.done = true;
      node.held = true;
      const done = lift.resolve;
      lift.resolve = null;
      done?.();
    }
  }

  // ── 让台子活着 ──────────────────────────────────────────
  function update(dt, t, hovered) {
    updateLift(dt);
    const held = lift?.node ?? null;

    for (const ring of rings) {
      const on = hovered && hovered.ring === ring;
      ring.material.opacity = on ? 0.9 : 0.34 + Math.sin(t * 1.9) * 0.08;
    }
    // 竖屏可视宽度只有一半：把各段的横向站位整体收窄，镜头才敢靠近，
    // 否则一排五件根本塞不进去。
    const sx = innerWidth < innerHeight ? 0.74 : 1;
    for (const node of nodes.values()) {
      if (node.baseHomeX === undefined) { node.baseHomeX = node.home.x; node.baseCenterX = node.center.x; }
      node.home.x = node.baseHomeX * sx;
      node.center.x = node.baseCenterX * sx;
      const want = node === hovered || node.held ? 1 : 0;
      node.hover += (want - node.hover) * Math.min(1, dt * 9);
      if (node !== held) {
        node.group.position.x = node.home.x;
        node.group.position.y = node.baseY + node.hover * 0.16;
        if (node.kind !== 'covered') node.group.rotation.y = node.hover * 0.13;
      }
      if (node.sign) {
        const rest = node.sign.userData.restYaw ?? 0;
        const target = node.hover > 0.03 ? faceYaw(node.sign, camera) : rest;
        node.sign.rotation.y += (target - node.sign.rotation.y) * Math.min(1, dt * 7);
        node.sign.rotation.z = Math.sin(t * 1.3 + node.center.x) * 0.02;
      }
      if (node.light) node.light.intensity = node.hover > 0.03 ? 8 : 4.6 + Math.sin(t * 2.4) * 0.6;
      if (node.top) node.top.intensity = (node.held ? 11 : node.hover > 0.03 ? 8.6 : 6.2) + Math.sin(t * 2.1 + node.center.x) * 0.35;
      if (node.wax) node.wax.material.emissiveIntensity = 0.7 + Math.sin(t * 1.6) * 0.3;
    }
    for (const lamp of lamps) lamp.userData.light.intensity = 9.5 + Math.sin(t * 1.7) * 1.1;
    for (const fire of fires) {
      fire.userData.light.intensity = 6.6 + Math.sin(t * 6.1) * 1.0;
      fire.userData.fire.scale.setScalar(0.9 + Math.sin(t * 5.2) * 0.09);
    }
    if (mentorLamp) mentorLamp.userData.light.intensity = 13 + Math.sin(t * 2.3) * 1.4;
    for (const [i, cloth] of banners.entries()) cloth.rotation.y = Math.sin(t * 1.05 + i * 1.7) * 0.15;
    for (const [i, lit] of windowGlow.entries()) lit.material.opacity = 0.8 + Math.sin(t * 0.7 + i * 2) * 0.09;
    mentorNode.group.rotation.y = -0.35 + Math.sin(t * 0.6) * 0.05;
    holder.rotation.y = faceYaw(holder, camera);   // 灯下那句话始终正对镜头
    // 竖屏的可视横向只剩一半：把左边台边的导师、灯、那句话、三段木牌往里收，
    // 并把那句话放大，否则它们全落在框外（或小到读不出）。
    const portrait = innerWidth < innerHeight;
    const shift = portrait ? 2.0 : 0;
    mentorBody.position.x = -4.6 + shift;
    if (mentorLamp) mentorLamp.position.x = -3.8 + shift;
    holder.position.x = -3.2 + shift;
    holder.scale.setScalar(portrait ? 1.9 : 1);
    mentorNode.center.set(-4.3 + shift, 1.5, 4.6);
    mentorNode.home.set(-4.3 + shift, 1.5, 4.6);
    for (const row of [1, 2, 3]) {
      if (markStand[row]) markStand[row].position.x = markBaseX[row] * sx + (portrait ? 1.8 : 0);
    }
  }

  function disposeTree(obj) {
    obj.traverse(o => {
      o.geometry?.dispose?.();
      if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); }
    });
  }

  return {
    root, nodes, rowMarks, banners, lamps, fires, mentorNode, wash,
    setLine, update, disposeTree, liftUp, liftSkip, releaseLift,
    get lifting() { return Boolean(lift && lift.phase === 'out' && !lift.done); },
    ROW_Y, ROW_Z, ROW_HALF,
  };
}

/** 一层矮几：一块台面 + 前沿的厚边 + 一块前挡板。 */
function ledge(row, y, z, half) {
  const g = new THREE.Group();
  g.add(box(half * 2, 0.14, 1.6, MAT.wood, 0, y - 0.14, z));
  g.add(box(half * 2 + 0.28, 0.1, 1.78, MAT.woodDark, 0, y - 0.24, z));
  g.add(box(half * 2, y - 0.24, 0.2, MAT.woodDark, 0, 0, z + 0.66));   // 前挡板，看不见台底
  for (const sx of [-1, 1]) g.add(box(0.16, y - 0.24, 1.5, MAT.woodDark, sx * (half - 0.2), 0, z));
  g.add(box(half * 2 + 0.28, 0.06, 0.34, MAT.woodLight, 0, y - 0.02, z + 0.62)); // 前沿的一道亮边
  g.userData.row = row;
  return g;
}

/** 让一块板正对镜头，只转水平方向——木签翻正的那个动作（父节点转了也算得对）。 */
function faceYaw(object, camera) {
  const p = new THREE.Vector3();
  object.getWorldPosition(p);
  const parent = object.parent;
  let parentYaw = 0;
  if (parent) {
    const q = new THREE.Quaternion();
    parent.getWorldQuaternion(q);
    parentYaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
  }
  return Math.atan2(camera.position.x - p.x, camera.position.z - p.z) - parentYaw;
}
