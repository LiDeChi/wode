// 排片表的戏台：夜里一座台子，三段矮几，每件实物就是一行排片。
// 这里负责把东西摆上去、让它们活着；点下去之后去哪，由 hub.js 决定。
import * as THREE from 'three';
import { MAT, box, beam, lantern, brazier, ground, mat as groundMat, lampOnStand } from './mats.js';
import { textPlate } from './text.js';
import * as O from './objects.js';

// 三段：越靠后越高，一眼分出「现在 / 稍后 / 之后」。
const ROW_Y = { 1: 0.5, 2: 0.78, 3: 1.06 };
const ROW_Z = { 1: 2.9, 2: 0.6, 3: -1.7 };
const ROW_LABEL = { 1: '现在就能体验', 2: '稍后', 3: '之后' };
const ROW_HALF = 8.2;

export function createHubStage(render, items = []) {
  const { scene, camera } = render;
  const root = new THREE.Group();
  scene.add(root);

  // ── 台子：三层矮几，反面开口；不挡东西 ──────────────────
  root.add(ground(160, '#221f1a'));
  root.add(groundMat(0, -0.5, 40, 30, '#2a2620'));
  for (const row of [1, 2, 3]) root.add(ledge(row, ROW_Y[row], ROW_Z[row]));

  // ── 背景：木屏、抱柱、横梁。留白比东西重要 ─────────────────
  const wallZ = -5.6;
  root.add(box(24, 0.5, 1.2, MAT.woodDark, 0, 0, wallZ));          // 屏风底座
  root.add(box(22, 4.4, 0.32, MAT.wood, 0, 0.5, wallZ));           // 屏风
  for (const sx of [-11, 11]) {                                     // 抱柱
    root.add(box(0.5, 6.2, 0.5, MAT.woodDark, sx, 0, wallZ));
    root.add(box(0.34, 0.34, 0.34, MAT.bronze, sx, 6.2, wallZ));
  }
  root.add(box(22.9, 0.42, 0.62, MAT.woodDark, 0, 5.5, wallZ));     // 横梁
  // 屏上的三扇小窗：透出一点夜里的光，屏风才不是一块黑板。
  const windowGlow = [];
  for (const x of [-5.6, 0, 5.6]) {
    const frame = box(2.6, 2.1, 0.16, MAT.woodLight, x, 1.5, wallZ + 0.18);
    const lit = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.65),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#2e4152'), transparent: true, opacity: 0.9 }));
    lit.position.set(x, 2.55, wallZ + 0.28);
    root.add(frame, lit);
    windowGlow.push(lit);
  }

  // 两片布挂在台侧的杆上。风一过，它们先动。
  const banners = [];
  for (const [x, color] of [[-10.4, '#7a3a2c'], [10.4, '#2f3d56']]) {
    const z = ROW_Z[3] + 1.5;
    root.add(box(0.16, 5.0, 0.16, MAT.woodDark, x, 0, z));
    root.add(beam(1.1, 0.14, MAT.woodDark, x + 0.46, 5.1, z));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 3.0),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.95, side: THREE.DoubleSide }));
    cloth.position.set(x + 0.46, 3.6, z);
    cloth.castShadow = true;
    root.add(cloth);
    banners.push(cloth);
  }

  // 每层一排暖光：东西要被照到，才看得出是实物。
  for (const row of [1, 2, 3]) {
    const wash = new THREE.PointLight(new THREE.Color('#ffc98c'), 22, 13, 2);
    wash.position.set(0, ROW_Y[row] + 3.1, ROW_Z[row] + 1.1);
    root.add(wash);
  }
  const lamps = [lantern(-11.6, 1.8, 3.7), lantern(11.6, 1.8, 3.7)];
  const fires = [brazier(-3.4, 6.4, 1.1), brazier(3.4, 6.4, 1.1)];
  lamps.forEach(l => root.add(l));
  fires.forEach(f => root.add(f));

  // 台口的匾：这里是什么地方。挂在横梁下。
  const board = textPlate('排片表', { size: 96, color: '#e8d8b2', worldHeight: 0.5, vertical: true, letterSpacing: 7 });
  const boardBack = box(board.scale.x * 1.4, board.scale.y * 1.55, 0.1, MAT.woodLight, 0, 4.4, wallZ + 0.5);
  board.position.set(0, 4.72, wallZ + 0.62);
  root.add(boardBack, board);

  // 三段的木牌：立在台侧，写明这一层是什么时候的事。板大一点，字才认得出。
  const rowMarks = {};
  for (const row of [1, 2, 3]) {
    const stand = new THREE.Group();
    stand.position.set(-10.3, ROW_Y[row] - 0.06, ROW_Z[row] + 0.4);
    stand.rotation.y = 0.42;
    const foot = box(0.5, 0.09, 0.3, MAT.woodDark, 0, 0, 0);
    const face = textPlate(ROW_LABEL[row], { size: 88, weight: 500, color: '#efe2c2', worldHeight: 0.32, letterSpacing: 5 });
    const back = box(face.scale.x * 1.3, 0.56, 0.06, MAT.woodLight, 0, 0.09, 0.045);
    face.position.set(0, 0.37, 0.085);
    stand.add(foot, back, face);
    root.add(stand);
    rowMarks[row] = face;
  }
  // 台前的一道栏杆：把「台上」和「台阶下」分开。
  for (const sx of [-1, 1]) root.add(box(0.18, 0.9, 0.18, MAT.woodDark, sx * 12.6, 0, 5.6));
  root.add(beam(25.4, 0.16, MAT.wood, 0, 0.86, 5.6));

  // ── 摆物件：每一行排片都是一件实物 ─────────────────────────
  const nodes = new Map();
  const rings = [];
  const tags = [];

  function place(spec, built) {
    const top = ROW_Y[spec.row];
    built.group.position.set(spec.x, top, ROW_Z[spec.row] + (spec.dz ?? 0));
    root.add(built.group);
    const node = render.add({
      ...spec,
      id: spec.id,
      group: built.group,
      explicit: new THREE.Vector3(spec.x, top + 0.4, ROW_Z[spec.row] + (spec.dz ?? 0)),
      radius: built.radius ?? 0.6,
    });
    node.ring = built.group.userData.ring;
    node.sign = built.group.userData.sign;
    node.light = built.group.userData.glow;
    node.wax = built.group.userData.wax;
    node.extra = built.group.userData;
    node.baseY = built.group.position.y;
    if (node.sign) {
      node.sign.userData.restYaw = node.sign.rotation.y;
      node.sign.userData.baseZ = node.sign.position.z;
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
    else if (spec.kind === 'covered') {
      place(spec, O.covered({ y: 0, h: spec.h ?? 1.5, w: spec.w ?? 0.8, label: '备着' }));
      const mark = textPlate(spec.name, { size: 52, color: '#b3a686', worldHeight: 0.19, vertical: true });
      mark.position.set(0.52, ROW_Y[spec.row] + 0.5, ROW_Z[spec.row] + (spec.dz ?? 0));
      mark.rotation.y = 0.32;
      root.add(mark);
    }
  }

  // 导师：台边坐着的一个人，旁边一盏灯；灯下浮出他排片的那句话。
  const mentor = new THREE.Group();
  mentor.add(O.mentorFigure({ x: -9.6, z: 4.4 }).group);
  mentor.add(lampOnStand(-8.6, 4.1, 2.0));
  const holder = new THREE.Group();
  holder.position.set(-8.2, 2.78, 4.3);
  mentor.add(holder);
  let line = null;
  function setLine(text) {
    const next = textPlate(text, { size: 58, color: '#e9dcc0', worldHeight: 0.235, letterSpacing: 2, maxWidth: 900 });
    if (line) { holder.remove(line); disposeTree(line); }
    line = next;
    holder.add(next);
  }
  setLine('　');
  root.add(mentor);
  const mentorNode = render.add({
    id: 'mentor', kind: 'mentor', name: '导师', row: 1, act: 'mentor',
    group: mentor, explicit: new THREE.Vector3(-9.1, 1.6, 4.4), radius: 1.1,
  });

  // ── 让台子活着 ──────────────────────────────────────────
  function update(dt, t, hovered) {
    for (const ring of rings) {
      const on = hovered && hovered.ring === ring;
      ring.material.opacity = on ? 0.88 : 0.32 + Math.sin(t * 1.9) * 0.08;
    }
    for (const node of nodes.values()) {
      const want = node === hovered ? 1 : 0;
      node.hover += (want - node.hover) * Math.min(1, dt * 9);
      node.group.position.y = node.baseY + node.hover * 0.17;
      if (node.kind !== 'covered') node.group.rotation.y = node.hover * 0.13;
      if (node.sign) {
        const target = node.hover > 0.03 ? faceYaw(node.sign, camera) : node.sign.userData.restYaw;
        node.sign.rotation.y += (target - node.sign.rotation.y) * Math.min(1, dt * 7);
        node.sign.rotation.z = Math.sin(t * 1.3 + node.center.x) * 0.02;
      }
      if (node.light) node.light.intensity = node.hover > 0.03 ? 7.5 : 3.6 + Math.sin(t * 2.4) * 0.5;
      if (node.wax) node.wax.material.emissiveIntensity = 0.7 + Math.sin(t * 1.6) * 0.3;
    }
    for (const lamp of lamps) lamp.userData.light.intensity = 9.5 + Math.sin(t * 1.7) * 1.1;
    for (const fire of fires) {
      fire.userData.light.intensity = 6.6 + Math.sin(t * 6.1) * 1.0;
      fire.userData.fire.scale.setScalar(0.9 + Math.sin(t * 5.2) * 0.09);
    }
    for (const [i, cloth] of banners.entries()) cloth.rotation.y = Math.sin(t * 1.05 + i * 1.7) * 0.15;
    for (const [i, lit] of windowGlow.entries()) lit.material.opacity = 0.8 + Math.sin(t * 0.7 + i * 2) * 0.09;
    mentorNode.group.rotation.y = -0.35 + Math.sin(t * 0.6) * 0.05;
  }

  function disposeTree(obj) {
    obj.traverse(o => {
      o.geometry?.dispose?.();
      if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); }
    });
  }

  return { root, nodes, rowMarks, banners, lamps, fires, mentorNode, setLine, update, disposeTree, ROW_Y, ROW_Z, ROW_HALF };
}

/** 一层矮几：一块台面 + 前沿的厚边 + 四只脚。 */
function ledge(row, y, z) {
  const g = new THREE.Group();
  g.add(box(ROW_HALF * 2, 0.13, 1.55, MAT.wood, 0, y - 0.13, z));
  g.add(box(ROW_HALF * 2 + 0.24, 0.1, 1.72, MAT.woodDark, 0, y - 0.23, z));
  for (const sx of [-1, 1]) for (const sz of [-0.6, 0.6]) {
    g.add(box(0.15, y - 0.23, 0.15, MAT.woodDark, sx * (ROW_HALF - 0.35), 0, z + sz));
  }
  g.userData.row = row;
  return g;
}

/** 让一块板正对镜头，只转水平方向——木签翻正的那个动作。 */
function faceYaw(object, camera) {
  const p = new THREE.Vector3();
  object.getWorldPosition(p);
  return Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
}
