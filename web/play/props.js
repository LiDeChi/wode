// 场景里的物件：都做小、做粗，够看形状就够了。底座上的铜环表示「这里可以动手」。
import * as THREE from 'three';

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.86,
    metalness: opts.metalness ?? 0.06,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 0.6,
    transparent: opts.opacity !== undefined,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
}

export const MAT = {
  wood: std('#4a3524'),
  woodDark: std('#33241a'),
  woodLight: std('#6b5236'),
  bamboo: std('#7d6a3c'),
  paper: std('#d3c39c', { roughness: 0.95 }),
  bronze: std('#946a26', { metalness: 0.72, roughness: 0.34 }),
  bronzeLit: std('#b5852f', { metalness: 0.6, roughness: 0.3, emissive: '#3a2408' }),
  iron: std('#2b2d31', { metalness: 0.8, roughness: 0.45 }),
  stone: std('#514c46'),
  stoneDark: std('#3b3733'),
  cloth: std('#7c3a2c'),
  clothDark: std('#4d2a24'),
  clothBlue: std('#2f3d56'),
  straw: std('#8a7638'),
  sand: std('#7b6b4d'),
  skin: std('#c4996d'),
  flame: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb14d') }),
  glow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd79a'), transparent: true, opacity: 0.5 }),
};

export function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 铜环底座：场景里的「装置」标记。微微呼吸，让人知道这里能动手。 */
export function devicePad(radius = 0.9, color = '#c8892f') {
  const g = new THREE.Group();
  const base = cyl(radius, radius * 1.06, 0.06, MAT.stoneDark, 0, 0, 0, 20);
  base.receiveShadow = true;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.86, 0.035, 8, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.55 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  g.add(base, ring);
  g.userData.ring = ring;
  return g;
}

export function lantern(x, z, y = 2.4, color = '#c8892f') {
  const g = new THREE.Group();
  g.add(cyl(0.02, 0.02, y, MAT.woodDark, x, 0, z, 6));
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), std('#b0392f', { emissive: '#7a2418', emissiveIntensity: 0.9 }));
  body.position.set(x, y - 0.3, z);
  const light = new THREE.PointLight(new THREE.Color(color), 1.4, 12, 2);
  light.position.set(x, y - 0.32, z);
  g.add(body, light);
  g.userData.light = light;
  g.userData.body = body;
  return g;
}

export function brazier(x, z) {
  const g = new THREE.Group();
  g.add(cyl(0.34, 0.24, 0.5, MAT.iron, x, 0, z, 12));
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 10), MAT.flame);
  fire.position.set(x, 0.72, z);
  const light = new THREE.PointLight(new THREE.Color('#ff9d3c'), 1.8, 10, 2);
  light.position.set(x, 0.9, z);
  g.add(fire, light);
  g.userData.fire = fire;
  g.userData.light = light;
  return g;
}

export function table(w = 1.7, d = 0.9, x = 0, z = 0, y = 0) {
  const g = new THREE.Group();
  g.add(box(w, 0.08, d, MAT.woodLight, x, y + 0.62, z));
  const lx = w / 2 - 0.14;
  const lz = d / 2 - 0.14;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(box(0.09, 0.62, 0.09, MAT.wood, x + sx * lx, y, z + sz * lz));
  }
  return g;
}

/** 竹简：摊开的一卷 */
export function scrolls(x, y, z, rot = 0) {
  const g = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.34), std('#8a7845', { roughness: 1 }));
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.set(x, y + 0.015, z);
  sheet.rotation.z = rot;
  const roll = cyl(0.045, 0.045, 0.36, MAT.bamboo, x + 0.5 * Math.cos(rot), y, z - 0.5 * Math.sin(rot), 8);
  roll.rotation.z = Math.PI / 2;
  roll.rotation.y = rot;
  g.add(sheet, roll);
  return g;
}

/** 兵符：两半铜虎符，合在一张小案上 */
export function tallyPair(x, y, z) {
  const g = new THREE.Group();
  const half = (sx) => {
    const h = new THREE.Group();
    const body = box(0.16, 0.07, 0.42, MAT.bronzeLit, 0);
    const tab = box(0.1, 0.05, 0.14, MAT.bronze, 0, 0.07, 0.1);
    h.add(body, tab);
    h.position.set(x + sx * 0.14, y, z);
    h.rotation.y = sx * 0.05;
    return h;
  };
  const a = half(-1);
  const b = half(1);
  b.position.x += 0.24;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.52, 0.02, 6, 28),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#c8892f'), transparent: true, opacity: 0.4 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, y + 0.03, z);
  g.add(a, b, ring);
  g.userData.halves = [a, b];
  return g;
}

export function sealBox(x, y, z) {
  const g = new THREE.Group();
  g.add(box(0.2, 0.16, 0.2, MAT.bronzeLit, x, y, z));
  g.add(cyl(0.03, 0.03, 0.1, MAT.bronze, x, y + 0.16, z + 0.06, 8));
  return g;
}

export function noteStrip(x, y, z) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), MAT.paper);
  s.rotation.x = -Math.PI / 2;
  s.rotation.z = 0.2;
  s.position.set(x, y + 0.012, z);
  g.add(s);
  return g;
}

export function pledgeBundle(x, y, z) {
  const g = new THREE.Group();
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), MAT.straw);
  bag.position.set(x, y + 0.2, z);
  bag.castShadow = true;
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 14), std('#5c4a2c'));
  cord.rotation.x = Math.PI / 2;
  cord.position.set(x, y + 0.4, z);
  g.add(bag, cord);
  return g;
}

export function tent(x, z, rot = 0, scale = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(1.5 * scale, 1.8 * scale, 4), MAT.clothDark);
  body.position.set(x, 0.9 * scale, z);
  body.rotation.y = Math.PI / 4 + rot;
  body.castShadow = true;
  const pole = cyl(0.03, 0.03, 2.4 * scale, MAT.woodDark, x, 0, z, 6);
  g.add(body, pole);
  return g;
}

export function bannerProp(x, z, rot = 0, color = '#7c3a2c') {
  const g = new THREE.Group();
  g.add(cyl(0.045, 0.045, 3.0, MAT.woodDark, x, 0, z, 6));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.7), std(color, { side: THREE.DoubleSide }));
  cloth.position.set(x + 0.35, 2.0, z);
  cloth.rotation.y = rot;
  g.add(cloth);
  g.userData.cloth = cloth;
  return g;
}

export function sack(x, z, scale = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.36 * scale, 10, 8), MAT.straw);
  m.position.set(x, 0.32 * scale, z);
  m.scale.y = 0.86;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function beam(x, y, z, len, rot = 0, thickness = 0.22) {
  const m = box(len, thickness, thickness, MAT.woodDark, 0, 0, 0);
  m.position.set(x, y, z);
  m.rotation.y = rot;
  return m;
}

export function wall(w, h, d, x, y, z, mat = MAT.stoneDark) {
  return box(w, h, d, mat, x, y, z);
}

/** 铁椎：朱亥袖里的那件东西 */
export function hammer(x, y, z, rot = 0) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 10), MAT.iron);
  head.rotation.z = Math.PI / 2;
  head.position.set(x, y + 0.3, z);
  const shaft = cyl(0.035, 0.035, 0.62, MAT.woodDark, x, y, z, 8);
  shaft.rotation.z = 0.5;
  shaft.rotation.y = rot;
  g.add(head, shaft);
  return g;
}

export function ledger(x, y, z) {
  const g = new THREE.Group();
  g.add(box(0.42, 0.06, 0.3, std('#6d5a34'), x, y, z));
  g.add(box(0.42, 0.02, 0.3, MAT.paper, x, y + 0.06, z));
  return g;
}

export function gateMark(x, z, w = 2.6, h = 3.2) {
  const g = new THREE.Group();
  g.add(wall(0.5, h, 0.8, x - w / 2, 0, z, MAT.stone));
  g.add(wall(0.5, h, 0.8, x + w / 2, 0, z, MAT.stone));
  g.add(wall(w + 0.5, 0.6, 0.9, x, h, z, MAT.stone));
  return g;
}

export function clepsydraProp(x, z) {
  const g = new THREE.Group();
  g.add(cyl(0.34, 0.4, 0.9, MAT.bronze, x, 0, z, 14));
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.2, 12), MAT.bronzeLit);
  bowl.position.set(x, 1.0, z);
  const drip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), MAT.glow);
  drip.position.set(x, 0.78, z);
  g.add(bowl, drip);
  g.userData.drip = drip;
  return g;
}

/** 火把（墙上插的那种） */
export function torchProp(x, y, z, color = '#ff9d3c', intensity = 1.5) {
  const g = new THREE.Group();
  g.add(cyl(0.035, 0.035, 0.6, MAT.woodDark, x, y - 0.6, z, 6));
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 8), MAT.flame);
  fire.position.set(x, y + 0.06, z);
  const light = new THREE.PointLight(new THREE.Color(color), intensity, 11, 2);
  light.position.set(x, y + 0.1, z);
  g.add(fire, light);
  g.userData.fire = fire;
  g.userData.light = light;
  return g;
}

export function groundPlane(color, size = 90, y = -0.01) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), std(color, { roughness: 0.98 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

export function dustRing(x, z, radius = 3.4, color = '#c8892f') {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.06, radius, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.14, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.012, z);
  return m;
}
