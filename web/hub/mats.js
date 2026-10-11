// 排片表与放映厅共用的材质与构件。
// 规矩：不做网页的「面」，只做东西——木、铜、石、绳、布。形状够认，尺寸按米。
import * as THREE from 'three';

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.88,
    metalness: opts.metalness ?? 0.06,
    emissive: new THREE.Color(opts.emissive ?? 0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 0.6,
    flatShading: opts.flat ?? false,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.opacity !== undefined,
    opacity: opts.opacity ?? 1,
  });
}

export const MAT = {
  stone: std('#3c3931'),
  stoneDark: std('#2a2823'),
  wood: std('#4b3826'),
  woodDark: std('#2e2117'),
  woodLight: std('#6d5437'),
  bamboo: std('#86803f', { roughness: 0.95 }),
  bronze: std('#8d6526', { metalness: 0.72, roughness: 0.36 }),
  bronzeLit: std('#bb8a30', { metalness: 0.6, roughness: 0.28, emissive: '#3a2408' }),
  iron: std('#2c2e33', { metalness: 0.78, roughness: 0.48 }),
  paper: std('#d8c9a2', { roughness: 0.96 }),
  paperDim: std('#b3a684', { roughness: 0.98 }),
  cloth: std('#7a3a2c'),
  clothBlue: std('#2f3d56'),
  clothDark: std('#402b22'),
  rope: std('#7d6a45', { roughness: 1 }),
  wax: std('#a8302a', { roughness: 0.45, emissive: '#4a0f0c', emissiveIntensity: 0.9 }),
  gold: std('#c99a3e', { metalness: 0.5, roughness: 0.4, emissive: '#4a3208' }),
  flame: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb14d') }),
  emberTip: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a2a') }),
  smoke: new THREE.MeshBasicMaterial({ color: new THREE.Color('#cdd6dd'), transparent: true, opacity: 0.18, depthWrite: false }),
};

/** 能点的地方都有一圈铜环：微微呼吸，告诉你这里可以动手。 */
export function touchRing(radius = 0.5, color = '#c8892f') {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.022, 8, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.42, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.userData.baseOpacity = 0.42;
  return ring;
}

export function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function sph(r, mat, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function cone(r, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  return m;
}

/** 木架的一条横梁或立柱。 */
export function beam(len, thickness, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, thickness, thickness), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 地上的一层石板：整个装置站在上面。 */
export function ground(size = 120, color = '#2b2823') {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), std(color, { roughness: 0.99 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.01;
  m.receiveShadow = true;
  return m;
}

/** 一盏灯笼：挂在杆子上，光会晃。 */
export function lantern(x, z, h = 2.6, color = '#ffab5e') {
  const g = new THREE.Group();
  g.add(cyl(0.025, 0.025, h, MAT.woodDark, x, 0, z, 6));
  g.add(beam(0.5, 0.05, MAT.woodDark, x + 0.24, h, z));
  const body = sph(0.17, std('#b8452f', { emissive: '#7a2418', emissiveIntensity: 1.2 }), x + 0.44, h - 0.24, z, 12);
  const light = new THREE.PointLight(new THREE.Color(color), 9, 11, 2);
  light.position.set(x + 0.44, h - 0.26, z);
  g.add(body, light);
  g.userData.light = light;
  g.userData.body = body;
  return g;
}

/** 火盆：台口的一点活光，也是「戏还没散」的记号。 */
export function brazier(x, z, scale = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.34 * scale, 0.24 * scale, 0.46 * scale, MAT.iron, x, 0, z, 14));
  const fire = cone(0.2 * scale, 0.42 * scale, MAT.flame, x, 0.46 * scale, z, 10);
  const light = new THREE.PointLight(new THREE.Color('#ff9d3c'), 7, 9, 2);
  light.position.set(x, 0.86 * scale, z);
  g.add(fire, light);
  g.userData.fire = fire;
  g.userData.light = light;
  return g;
}

/** 铺地的席子：分出「台前」和「台后」。 */
export function mat(x, z, w, d, color = '#3a2f26') {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(color, { roughness: 1 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.004, z);
  m.receiveShadow = true;
  return m;
}

/** 一尊小小的青铜灯：导师那盏。灯下有话。 */
export function lampOnStand(x, z, h = 1.25) {
  const g = new THREE.Group();
  g.add(cyl(0.16, 0.22, 0.12, MAT.bronze, x, 0, z, 14));
  g.add(cyl(0.035, 0.035, h, MAT.bronze, x, 0.12, z, 8));
  const dish = cyl(0.16, 0.08, 0.07, MAT.bronzeLit, x, 0.12 + h, z, 14);
  const flame = cone(0.05, 0.12, MAT.flame, x, 0.19 + h, z, 8);
  const light = new THREE.PointLight(new THREE.Color('#ffb877'), 13, 14, 2);
  light.position.set(x, 0.3 + h, z);
  g.add(dish, flame, light);
  g.userData.flame = flame;
  g.userData.light = light;
  return g;
}
