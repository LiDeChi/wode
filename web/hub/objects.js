// 戏台上的实物。每件东西都能拿起来——它就是排片表的一行。
// 形状按米做，材质从 mats.js 来；字用 text.js 画在板上。
import * as THREE from 'three';
import { MAT, box, cyl, sph, cone, beam, touchRing } from './mats.js';
import { woodTag, textPlate } from './text.js';

/** 一排矮几：台子的「层」。越靠后越高，一眼分出三段。 */
export function riser(row, y, halfW = 9.4, z = 0) {
  const g = new THREE.Group();
  const top = box(halfW * 2, 0.14, 2.3, MAT.wood, 0, y - 0.14, z);
  const edge = box(halfW * 2 + 0.3, 0.07, 2.6, MAT.woodDark, 0, y - 0.21, z);
  g.add(top, edge);
  for (const sx of [-1, 1]) for (const sz of [-0.85, 0.85]) {
    g.add(box(0.16, y - 0.21, 0.16, MAT.woodDark, sx * (halfW - 0.4), 0, z + sz));
  }
  g.userData.row = row;
  return g;
}

/** 虎符：两半铜虎，合在案上。这是《窃符》那局。 */
export function tigerTally({ y = 0 } = {}) {
  const g = new THREE.Group();
  const half = (dir) => {
    const h = new THREE.Group();
    const body = box(0.2, 0.09, 0.5, MAT.bronzeLit, 0, 0.09, 0);
    const head = box(0.17, 0.15, 0.16, MAT.bronzeLit, 0, 0.11, 0.3);
    const ear = cone(0.035, 0.06, MAT.bronze, -0.05, 0.2, 0.3, 6);
    const ear2 = cone(0.035, 0.06, MAT.bronze, 0.05, 0.2, 0.3, 6);
    const tail = cyl(0.02, 0.03, 0.2, MAT.bronze, 0, 0.12, -0.3, 8);
    tail.rotation.x = -0.9;
    const spine = box(0.03, 0.05, 0.42, MAT.bronze, 0, 0.14, 0);
    for (const [lx, lz] of [[-0.07, 0.16], [0.07, 0.16], [-0.07, -0.16], [0.07, -0.16]]) {
      h.add(box(0.05, 0.09, 0.12, MAT.bronze, lx, 0, lz));
    }
    h.add(body, head, ear, ear2, tail, spine);
    h.position.set(dir * 0.16, 0, 0);
    h.rotation.z = dir * 0.04;
    return h;
  };
  const left = half(-1);
  const right = half(1);
  right.position.x += 0.14;
  g.add(left, right);
  const ring = touchRing(0.52, '#d8b061');
  ring.position.y = y + 0.02;
  g.add(ring);
  g.userData.ring = ring;
  g.userData.halves = [left, right];
  return { group: g, radius: 0.55 };
}

/** 一卷片：木轴 + 卷起的简，挂一片写片名的木签。 */
export function filmScroll({ y = 0, tint = '#7a5a34', tag = '', tagColor = '#241a10' } = {}) {
  const g = new THREE.Group();
  const tube = cyl(0.13, 0.13, 0.86, new THREE.MeshStandardMaterial({ color: new THREE.Color(tint), roughness: 0.94 }), 0, y, 0, 16);
  tube.rotation.z = Math.PI / 2;
  const sheet = box(0.5, 0.26, 0.04, MAT.paperDim, 0, y - 0.13, 0.15);
  sheet.rotation.x = 0.32;
  const axleA = cyl(0.04, 0.04, 0.12, MAT.woodDark, -0.5, y, 0, 8);
  axleA.rotation.z = Math.PI / 2;
  const axleB = cyl(0.04, 0.04, 0.12, MAT.woodDark, 0.5, y, 0, 8);
  axleB.rotation.z = Math.PI / 2;
  g.add(tube, sheet, axleA, axleB);
  const ring = touchRing(0.46, '#c8892f');
  ring.position.y = y + 0.02;
  g.add(ring);
  let sign = null;
  if (tag) {
    sign = new THREE.Group();
    sign.add(beam(0.03, 0.03, MAT.woodDark, 0, 0, 0));
    const board = woodTag(tag, { h: 0.92, ink: tagColor });
    board.position.set(0, -0.58, 0);
    board.rotation.x = -0.3;            // 板面往上仰一点，正对镜头
    sign.add(cyl(0.01, 0.01, 0.22, MAT.rope, 0, -0.06, 0, 6));
    sign.add(board);
    sign.position.set(0.6, y + 0.72, 0.05);
    sign.rotation.y = -0.5;
    g.add(sign);
  }
  g.userData.ring = ring;
  g.userData.sign = sign;
  g.userData.tube = tube;
  return { group: g, radius: 0.5 };
}

/** 刚封好的那一卷：封泥还亮着。 */
export function sealedScroll({ y = 0, tag = '刚才的你' } = {}) {
  const g = new THREE.Group();
  const built = filmScroll({ y, tint: '#8a6a3c', tag, tagColor: '#2a1c10' });
  g.add(built.group);
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.016, 6, 18), MAT.rope);
  cord.rotation.y = Math.PI / 2;
  cord.position.set(0, y, 0);
  cord.scale.set(1, 1, 3.2);
  g.add(cord);
  const wax = sph(0.075, MAT.wax, 0, y + 0.16, 0.02, 12);
  wax.scale.z = 0.55;
  const press = box(0.05, 0.02, 0.05, MAT.gold, 0, y + 0.2, 0.02);
  const glow = new THREE.PointLight(new THREE.Color('#ff6a3c'), 4.5, 3.4, 2);
  glow.position.set(0, y + 0.24, 0.1);
  g.add(wax, press, glow);
  g.userData.wax = wax;
  g.userData.glow = glow;
  g.userData.ring = built.group.userData.ring;
  g.userData.sign = built.group.userData.sign;
  return { group: g, radius: 0.6 };
}

/** 推演机的小模型：木框、几盘齿轮、一根摇柄。科研台。 */
export function inferenceRig({ y = 0 } = {}) {
  const g = new THREE.Group();
  const base = box(0.9, 0.1, 0.5, MAT.woodLight, 0, y, 0);
  g.add(base);
  for (const sx of [-0.38, 0.38]) {
    g.add(box(0.07, 0.42, 0.07, MAT.woodDark, sx, y + 0.1, -0.2));
    g.add(box(0.07, 0.42, 0.07, MAT.woodDark, sx, y + 0.1, 0.2));
  }
  g.add(beam(0.9, 0.06, MAT.woodDark, 0, y + 0.52, 0));
  const wheels = [];
  [[-0.28, 0], [0, 0.06], [0.28, 0]].forEach(([x, off], i) => {
    const r = 0.19 - i * 0.02;
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 22),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(MAT.bronze.color), metalness: 0.7, roughness: 0.4 }));
    m.position.set(x, y + 0.3 + off, 0);
    m.rotation.y = Math.PI / 2;
    const spokes = new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 1.7, 0.03), MAT.iron);
    spokes.position.copy(m.position);
    spokes.rotation.z = i * 0.7;
    const hub = cyl(0.03, 0.03, 0.1, MAT.bronzeLit, x - 0.05, y + 0.3 + off, 0, 8);
    hub.rotation.z = Math.PI / 2;
    g.add(m, spokes, hub);
    wheels.push(m);
  });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.014, 6, 26), MAT.rope);
  band.position.set(0, y + 0.3, 0);
  band.rotation.y = Math.PI / 2;
  band.scale.set(1, 1.15, 1);
  const crank = cyl(0.02, 0.02, 0.24, MAT.iron, 0.5, y + 0.26, 0, 6);
  const handle = cyl(0.02, 0.02, 0.14, MAT.iron, 0.62, y + 0.26, 0.1, 6);
  handle.rotation.x = Math.PI / 2;
  g.add(band, crank, handle);
  const ring = touchRing(0.5, '#c8892f');
  ring.position.y = y + 0.02;
  g.add(ring);
  g.userData.ring = ring;
  g.userData.wheels = wheels;
  g.userData.spokes = [band];
  return { group: g, radius: 0.55 };
}

/** 一盘绳结星图：四根桩，绳连成星，结上挂铜珠。世界关系图。 */
export function knotChart({ y = 0, r = 0.62 } = {}) {
  const g = new THREE.Group();
  g.add(cyl(r * 1.5, r * 1.7, 0.09, MAT.stoneDark, 0, y - 0.09, 0, 20));
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y + 0.02 + (i % 2) * 0.055, Math.sin(a) * r));
  }
  const beads = [];
  pts.forEach((p, i) => {
    g.add(cyl(0.02, 0.03, 0.3, MAT.woodDark, p.x, y - 0.28, p.z, 6));
    const bead = sph(0.055 + (i % 3) * 0.01, i % 2 ? MAT.bronzeLit : MAT.bronze, p.x, p.y + 0.04, p.z, 10);
    beads.push(bead);
    g.add(bead);
  });
  const pairs = [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [3, 4], [2, 4], [0, 4]];
  for (const [a, b] of pairs) {
    const A = pts[a], B = pts[b];
    const dir = new THREE.Vector3().subVectors(B, A);
    const len = dir.length();
    const cord = cyl(0.011, 0.011, len, MAT.rope, 0, 0, 0, 6);
    cord.position.copy(A).addScaledVector(dir, 0.5);
    cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    cord.castShadow = false;
    g.add(cord);
  }
  const ring = touchRing(r + 0.3, '#c8892f');
  ring.position.y = y + 0.02;
  g.add(ring);
  g.userData.ring = ring;
  g.userData.beads = beads;
  return { group: g, radius: r + 0.3 };
}

/** 蒙着布的物件：布下透出轮廓。还没排上的作品。 */
export function covered({ y = 0, h = 1.5, w = 0.8, label = '备着' } = {}) {
  const g = new THREE.Group();
  const body = cyl(w * 0.5, w * 0.62, h, MAT.clothDark, 0, y, 0, 16);
  const head = sph(w * 0.42, MAT.cloth, 0, y + h, 0, 14);
  head.scale.y = 0.62;
  const foldA = cone(w * 0.56, 0.5, MAT.cloth, 0.16, y + 0.05, 0.1, 4);
  foldA.rotation.y = 0.6;
  const foldB = cone(w * 0.5, 0.42, MAT.clothDark, -0.2, y + 0.02, -0.06, 4);
  foldB.rotation.y = 1.2;
  g.add(body, head, foldA, foldB);
  const plate = textPlate(label, { size: 62, color: '#c9bda4', worldHeight: 0.26, vertical: true, font: '"Songti SC",serif', letterSpacing: 6 });
  plate.position.set(0, y + h * 0.55, w * 0.64);
  g.add(plate);
  const ring = touchRing(0.44, '#8a7a5c');
  ring.position.y = y + 0.02;
  g.add(ring);
  g.userData.ring = ring;
  g.userData.cloth = body;
  g.userData.plate = plate;
  return { group: g, radius: 0.5 };
}

/** 导师：坐在台边的人，旁边一盏灯。灯下浮出他的那句话。 */
export function mentorFigure({ y = 0, x = 0, z = 0 } = {}) {
  const g = new THREE.Group();
  // 坐姿的剪影：一顶斗笠、一件袍子、两只搭在膝上的手。
  const robe = cone(0.52, 0.78, MAT.woodDark, 0, y + 0.06, 0, 14);
  const shoulder = sph(0.3, MAT.woodDark, 0, y + 0.82, 0, 14);
  shoulder.scale.set(1.1, 0.7, 0.9);
  const head = sph(0.17, MAT.woodDark, 0, y + 1.08, 0, 14);
  const hat = cone(0.42, 0.2, MAT.wood, 0, y + 1.16, 0, 16);
  const brim = cyl(0.42, 0.44, 0.035, MAT.woodLight, 0, y + 1.14, 0, 18);
  const knee = box(0.7, 0.16, 0.3, MAT.woodDark, 0, y + 0.3, 0.34);
  g.add(robe, shoulder, head, hat, brim, knee);
  g.position.set(x, 0, z);
  g.rotation.y = -0.35;
  return { group: g, radius: 0.7, pickable: true };
}
