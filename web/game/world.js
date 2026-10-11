// 場景：用程序化生成的幾何體搭出大梁府邸與夷門。
// 不做貼圖、不載入模型——只有平面色、低多邊形、斜陽的長影子。
// 材質全部照 id 快取，讓同一種石頭／木頭／瓦共用一個材質。

import * as THREE from 'three';
import { SCENES } from './config.js';

const MATERIALS = new Map();

function mat(color, roughness = 0.92, metalness = 0) {
  const key = `${color}|${roughness}|${metalness}`;
  let m = MATERIALS.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness, flatShading: true });
    MATERIALS.set(key, m);
  }
  return m;
}

function box(parent, color, w, h, d, x, y, z, ry = 0, castShadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.position.set(x, y + h / 2, z);
  mesh.rotation.y = ry;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// 斜屋頂：兩片斜板對靠，用 rotation.z 做出屋脊。
function roof(parent, color, w, d, x, y, z, pitch = 0.42, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  const slabW = w / 2 / Math.cos(pitch);
  const rise = (w / 2) * Math.tan(pitch);
  const thick = 0.22;
  for (const dir of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(slabW, thick, d), mat(color));
    slab.position.set((dir * slabW) / 2 * Math.cos(pitch), rise / 2, 0);
    slab.rotation.z = -dir * pitch;
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
  }
  // 屋脊
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, d + 0.3), mat('#2b2723'));
  ridge.position.y = rise + 0.06;
  ridge.castShadow = true;
  g.add(ridge);
  parent.add(g);
  return g;
}

// 把長方體的頂點稍微推歪，做出手工感。隨機源是固定的，所以每次長得一樣。
function roughen(geometry, amount = 0.045, seed = 1) {
  const pos = geometry.attributes.position;
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (rnd() - 0.5) * amount,
      pos.getY(i) + (rnd() - 0.5) * amount,
      pos.getZ(i) + (rnd() - 0.5) * amount,
    );
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function roughBox(parent, color, w, h, d, x, y, z, ry = 0, amount = 0.05, seed = 1) {
  const geo = roughen(new THREE.BoxGeometry(w, h, d, 2, 2, 2), amount, seed);
  const mesh = new THREE.Mesh(geo, mat(color));
  mesh.position.set(x, y + h / 2, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// 陶罐：圍城裡最要緊的東西。用球體壓扁 + 細頸。
function jar(parent, x, z, scale = 1, color = '#7a5a3c') {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34 * scale, 8, 6), mat(color));
  body.scale.y = 0.86;
  body.position.y = 0.32 * scale;
  body.castShadow = true;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * scale, 0.19 * scale, 0.18 * scale, 8), mat(color));
  neck.position.y = 0.62 * scale;
  neck.castShadow = true;
  g.add(body, neck);
  parent.add(g);
  return g;
}

// 燈籠：一根桿子掛一顆暖色的燈。晚上靠它給暖點。
function lantern(parent, x, z, h = 2.4) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, h, 6), mat('#3b2f24'));
  pole.position.y = h / 2;
  pole.castShadow = true;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.07), mat('#3b2f24'));
  arm.position.set(0.25, h - 0.1, 0);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xff9d3c, emissiveIntensity: 1.5, roughness: 0.6 }),
  );
  bulb.position.set(0.5, h - 0.28, 0);
  g.add(pole, arm, bulb);
  parent.add(g);
  return g;
}

// 旗：布面在風裡有極輕的擺動（由 update 驅動）。
function banner(parent, x, z, color = '#7d2f2f') {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 6), mat('#3b2f24'));
  pole.position.y = 1.8;
  pole.castShadow = true;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.9), new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: 0.95, side: THREE.DoubleSide,
  }));
  cloth.position.set(0.45, 2.5, 0);
  cloth.castShadow = true;
  g.add(pole, cloth);
  parent.add(g);
  g.userData.cloth = cloth;
  return g;
}

// 樹：低多邊形的傘狀樹冠。
function tree(parent, x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * scale, 0.2 * scale, 1.5 * scale, 6), mat('#3d3128'));
  trunk.position.y = 0.75 * scale;
  trunk.castShadow = true;
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15 * scale, 0), mat('#3f4a33'));
  crown.position.y = 2.0 * scale;
  crown.scale.set(1, 0.72, 1);
  crown.castShadow = true;
  crown.receiveShadow = true;
  g.add(trunk, crown);
  parent.add(g);
  return g;
}

// 車：信陵君「約車騎百餘乘」的那種車。
function chariot(parent, x, z, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, 1.15), mat('#5b452e'));
  bed.position.y = 0.86;
  bed.castShadow = true;
  bed.receiveShadow = true;
  g.add(bed);
  for (const dx of [-0.72, 0.72]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.075, 6, 14), mat('#463322'));
    wheel.position.set(dx, 0.52, 0);
    wheel.rotation.y = Math.PI / 2;
    wheel.castShadow = true;
    g.add(wheel);
  }
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.1), mat('#5b452e'));
  shaft.position.set(0, 0.78, 1.0);
  g.add(shaft);
  parent.add(g);
  return g;
}

// 水井
function well(parent, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.78, 0.6, 10), mat('#6b6259'));
  rim.position.y = 0.3;
  rim.castShadow = true;
  rim.receiveShadow = true;
  const dark = new THREE.Mesh(new THREE.CircleGeometry(0.6, 10), mat('#14110e'));
  dark.rotation.x = -Math.PI / 2;
  dark.position.y = 0.61;
  g.add(rim, dark);
  parent.add(g);
  return g;
}

// ── 大梁：信陵君府 ───────────────────────────────────────────────
function buildDaliang(def) {
  const root = new THREE.Group();
  const { minX, maxX, minZ, maxZ } = def.bounds;
  const W = maxX - minX;
  const D = maxZ - minZ;

  // 地
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 30, D + 30), mat(def.ground, 0.98));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // 夯土台基
  box(root, '#6f6152', W * 0.62, 0.35, D * 0.52, 0, 0, -1.5, 0, false);

  // 主殿
  const hallW = 11;
  const hallD = 7.4;
  const hallX = 0;
  const hallZ = -6.2;
  box(root, '#8a7a63', hallW + 2.2, 0.55, hallD + 2.0, hallX, 0.35, hallZ, 0, false);
  // 牆
  box(root, '#9c8b70', hallW, 3.1, hallD, hallX, 0.9, hallZ);
  // 柱
  for (const dx of [-hallW / 2 + 0.35, -hallW / 6, hallW / 6, hallW / 2 - 0.35]) {
    box(root, '#5a3f2a', 0.42, 3.3, 0.42, hallX + dx, 0.9, hallZ + hallD / 2 + 0.35);
  }
  // 門洞（用深色薄板暗示）
  box(root, '#191410', 3.4, 2.3, 0.14, hallX, 0.95, hallZ + hallD / 2 + 0.06, 0, false);
  roof(root, '#33302c', hallW + 2.6, hallD + 2.4, hallX, 3.9, hallZ, 0.44);

  // 東西廂房
  for (const side of [-1, 1]) {
    const wx = side * 8.6;
    box(root, '#8f7f66', 5.0, 2.7, 6.0, wx, 0.5, -3.0);
    roof(root, '#33302c', 5.6, 6.6, wx, 3.2, -3.0, 0.42);
  }

  // 院牆
  const wallH = 2.5;
  box(root, '#7d7364', W, wallH, 0.6, 0, 0, minZ, 0, true);
  box(root, '#7d7364', 0.6, wallH, D, minX, 0, 0, 0, true);
  box(root, '#7d7364', 0.6, wallH, D, maxX, 0, 0, 0, true);
  // 南牆留門
  const gateW = 4.2;
  const segW = (W - gateW) / 2;
  box(root, '#7d7364', segW, wallH, 0.6, -(gateW / 2 + segW / 2), 0, maxZ, 0, true);
  box(root, '#7d7364', segW, wallH, 0.6, gateW / 2 + segW / 2, 0, maxZ, 0, true);
  // 門樓
  box(root, '#6b6153', gateW + 1.6, 3.4, 1.5, 0, 0, maxZ, 0, true);
  roof(root, '#2e2b27', gateW + 2.2, 2.1, 0, 3.4, maxZ, 0.4);

  // 甬道：從門到殿前
  const path = new THREE.Mesh(new THREE.PlaneGeometry(3.2, D * 0.62), mat('#83755f', 1));
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.02, 2.0);
  path.receiveShadow = true;
  root.add(path);

  // 台階
  for (let i = 0; i < 3; i++) {
    box(root, '#786b58', 5.2 - i * 0.5, 0.16, 0.5, 0, i * 0.16, hallZ + hallD / 2 + 1.3 - i * 0.45, 0, false);
  }

  // 散置道具
  const banners = [];
  banners.push(banner(root, 4.6, 2.2, '#7d2f2f'));
  banners.push(banner(root, -4.6, 2.2, '#7d2f2f'));
  banners.push(banner(root, 5.2, -2.0, '#3f5a6b'));

  tree(root, -11.0, 5.4, 1.25);
  tree(root, 11.2, 6.0, 1.1);
  tree(root, -12.4, -6.0, 0.95);
  tree(root, 12.6, -5.2, 1.05);

  well(root, 6.4, 5.6);

  const jars = [];
  for (let i = 0; i < 7; i++) {
    jars.push(jar(root, -7.6 + (i % 4) * 0.62, 7.2 + Math.floor(i / 4) * 0.66, 0.9 + (i % 3) * 0.08));
  }

  const lanterns = [
    lantern(root, 3.1, -1.2, 2.6),
    lantern(root, -3.1, -1.2, 2.6),
    lantern(root, 2.4, 6.4, 2.4),
    lantern(root, -2.4, 6.4, 2.4),
  ];

  const carts = [
    chariot(root, -9.2, -8.4, 0.35),
    chariot(root, 9.6, -8.8, -0.3),
    chariot(root, -8.4, -11.2, 0.1),
  ];

  root.userData.animated = { banners, lanterns };
  root.userData.jars = jars;
  return root;
}

// ── 夷門：城東門 ────────────────────────────────────────────────
function buildYimen(def) {
  const root = new THREE.Group();
  const { minX, maxX, minZ, maxZ } = def.bounds;
  const W = maxX - minX;
  const D = maxZ - minZ;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 34, D + 34), mat(def.ground, 0.98));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // 城牆：一道橫向的高牆，中間開城門
  const wallH = 8.4;
  const wallZ = -2.0;
  const gateW = 4.6;
  const segW = (W - gateW) / 2;
  box(root, '#6d6455', segW, wallH, 2.4, -(gateW / 2 + segW / 2), 0, wallZ);
  box(root, '#6d6455', segW, wallH, 2.4, gateW / 2 + segW / 2, 0, wallZ);
  // 門洞上方的過梁
  box(root, '#6d6455', gateW, 2.6, 2.4, 0, 5.8, wallZ);
  // 門框
  box(root, '#4a3a28', 0.5, 5.8, 0.5, -gateW / 2 - 0.25, 0, wallZ + 1.1);
  box(root, '#4a3a28', 0.5, 5.8, 0.5, gateW / 2 + 0.25, 0, wallZ + 1.1);
  // 城樓
  box(root, '#5f5748', 9.0, 3.0, 3.2, 0, wallH, wallZ);
  roof(root, '#2b2824', 10.2, 4.2, 0, wallH + 3.0, wallZ, 0.42);
  // 垛口
  for (let i = -4; i <= 4; i++) {
    if (Math.abs(i) < 1.6) continue;
    box(root, '#7a7161', 1.0, 0.9, 0.5, i * 2.1, wallH, wallZ + 1.45, 0, false);
  }

  // 門前的土路
  const road = new THREE.Mesh(new THREE.PlaneGeometry(4.0, D * 0.9), mat('#756a55', 1));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, 5.0);
  road.receiveShadow = true;
  root.add(road);

  // 門吏的值所（低矮小屋）
  box(root, '#877a63', 4.2, 2.3, 3.4, -6.6, 0, 3.4);
  roof(root, '#2f2c28', 4.8, 4.0, -6.6, 2.3, 3.4, 0.4);

  // 長槍架
  for (let i = 0; i < 5; i++) {
    const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 3.2, 5), mat('#4a3a28'));
    spear.position.set(5.6 + i * 0.26, 1.6, 4.4);
    spear.rotation.z = 0.12;
    spear.castShadow = true;
    root.add(spear);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), mat('#8a8a86'));
    tip.position.set(5.6 + i * 0.26 + 0.19, 3.2, 4.4);
    tip.castShadow = true;
    root.add(tip);
  }

  const banners = [
    banner(root, -9.0, -0.6, '#5a4a2f'),
    banner(root, 9.0, -0.6, '#5a4a2f'),
    banner(root, -3.4, 7.6, '#7d2f2f'),
  ];

  tree(root, -11.6, 8.2, 1.0);
  tree(root, 11.4, 7.6, 1.15);

  const lanterns = [
    lantern(root, -3.2, 0.6, 2.8),
    lantern(root, 3.2, 0.6, 2.8),
    lantern(root, -6.0, 5.6, 2.3),
  ];

  const jars = [jar(root, -4.4, 4.6, 0.85), jar(root, -4.4, 5.4, 0.8)];

  root.userData.animated = { banners, lanterns };
  root.userData.jars = jars;
  return root;
}

export function createWorld(scene) {
  const built = new Map();
  let current = null;

  function disposeGroup(group) {
    group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
      }
    });
  }

  function build(sceneId) {
    if (built.has(sceneId)) return built.get(sceneId);
    const def = SCENES[sceneId];
    const g = sceneId === 'yimen' ? buildYimen(def) : buildDaliang(def);
    g.userData.def = def;
    built.set(sceneId, g);
    return g;
  }

  function show(sceneId) {
    if (current) current.visible = false;
    const g = build(sceneId);
    g.visible = true;
    if (!g.parent) scene.add(g);
    current = g;
    return g;
  }

  function hideJars(group, visible) {
    for (const j of group.userData.jars || []) j.visible = visible;
  }

  // 布面與燈籠的極輕微動態——讓靜止的畫面還活著。
  function update(t, dt) {
    if (!current) return;
    const anim = current.userData.animated;
    if (!anim) return;
    for (let i = 0; i < anim.banners.length; i++) {
      const cloth = anim.banners[i].userData.cloth;
      if (cloth) cloth.rotation.y = Math.sin(t * 1.15 + i * 1.7) * 0.16;
    }
    for (let i = 0; i < anim.lanterns.length; i++) {
      const l = anim.lanterns[i];
      l.children.forEach((c) => {
        if (c.material?.emissiveIntensity !== undefined) {
          c.material.emissiveIntensity = 1.35 + Math.sin(t * 2.1 + i) * 0.22;
        }
      });
    }
  }

  return { show, build, update, hideJars, disposeGroup, get current() { return current; } };
}
