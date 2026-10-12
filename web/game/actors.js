// 人物：從 shared/data/seed.js 讀真實的角色定義（名字、顏色、字號、性情、語音），
// 再用程序化幾何做出有辨識度的剪影。每個人的站姿、頭冠、配件都不同——
// 你要能從輪廓就認出是誰，而不是靠頭上的名字。

import * as THREE from 'three';
import { PEOPLE } from '../../../shared/data/seed.js';

const BY_ID = new Map(PEOPLE.map((p) => [p.id, p]));

export function personDef(id) {
  return BY_ID.get(id) || null;
}

const SKIN = '#c9a37e';

function limb(parent, color, w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: 0.9, flatShading: true,
  }));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function makeMat(color, rough = 0.9) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, flatShading: true });
}

// 一個人的身體。buildFigure 只做幾何，行為交給 actor 包裝。
function buildFigure(def, style) {
  const g = new THREE.Group();
  const robe = def.look?.color || '#6b6b6b';
  const robeDark = new THREE.Color(robe).multiplyScalar(0.72).getHexString();

  const s = style.scale ?? 1;
  const hunch = style.hunch ?? 0;

  // 腿／下襬
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.34 * s, 0.52 * s, 0.95 * s, 8), makeMat(`#${robeDark}`));
  skirt.position.y = 0.48 * s;
  skirt.castShadow = true;
  skirt.receiveShadow = true;
  g.add(skirt);

  // 軀幹
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.66 * s, 0.78 * s, 0.44 * s), makeMat(robe));
  torso.position.set(0, 1.34 * s, 0);
  torso.rotation.x = hunch;
  torso.castShadow = true;
  torso.receiveShadow = true;
  g.add(torso);

  // 腰帶
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 0.12 * s, 0.48 * s), makeMat(style.belt || '#2f2a24'));
  belt.position.set(0, 0.98 * s, 0);
  g.add(belt);

  // 手臂
  const armL = limb(g, robe, 0.17 * s, 0.62 * s, 0.17 * s, -0.42 * s, 1.28 * s, 0.02 * s);
  const armR = limb(g, robe, 0.17 * s, 0.62 * s, 0.17 * s, 0.42 * s, 1.28 * s, 0.02 * s);
  armL.rotation.x = -hunch * 0.6;
  armR.rotation.x = -hunch * 0.6;

  // 手
  limb(g, SKIN, 0.15 * s, 0.16 * s, 0.15 * s, -0.42 * s, 0.95 * s, 0.06 * s);
  limb(g, SKIN, 0.15 * s, 0.16 * s, 0.15 * s, 0.42 * s, 0.95 * s, 0.06 * s);

  // 頭
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36 * s, 0.38 * s, 0.34 * s), makeMat(SKIN));
  head.position.set(0, 1.88 * s, 0.02 * s + hunch * 0.25);
  head.castShadow = true;
  g.add(head);

  // 冠／帽：這是辨識度最高的地方
  if (style.hat === 'tall') {
    // 高冠：信陵君
    const hat = new THREE.Mesh(new THREE.BoxGeometry(0.42 * s, 0.42 * s, 0.38 * s), makeMat(style.hatColor || '#1f1c18'));
    hat.position.set(0, 2.22 * s, 0.02 * s);
    hat.castShadow = true;
    g.add(hat);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.62 * s, 0.07 * s, 0.54 * s), makeMat(style.hatColor || '#1f1c18'));
    brim.position.set(0, 2.03 * s, 0.02 * s);
    g.add(brim);
  } else if (style.hat === 'flat') {
    // 平頂小冠：侯嬴
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * s, 0.28 * s, 0.16 * s, 8), makeMat(style.hatColor || '#3a332a'));
    hat.position.set(0, 2.1 * s, 0.02 * s);
    hat.castShadow = true;
    g.add(hat);
  } else if (style.hat === 'band') {
    // 額帶：朱亥
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.4 * s, 0.11 * s, 0.38 * s), makeMat(style.hatColor || '#7a2f2f'));
    band.position.set(0, 2.0 * s, 0.02 * s);
    g.add(band);
  } else if (style.hat === 'hood') {
    // 兜帽：使者／旅人
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.3 * s, 0.42 * s, 8), makeMat(style.hatColor || '#4a4438'));
    hood.position.set(0, 2.16 * s, 0.02 * s);
    hood.castShadow = true;
    g.add(hood);
  }

  // 配件
  if (style.staff) {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * s, 0.055 * s, 2.0 * s, 6), makeMat('#4a3a28'));
    staff.position.set(0.52 * s, 1.0 * s, 0.16 * s);
    staff.castShadow = true;
    g.add(staff);
  }
  if (style.broad) {
    // 朱亥：厚肩
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(1.0 * s, 0.28 * s, 0.56 * s), makeMat(robe));
    shoulders.position.set(0, 1.68 * s, 0);
    shoulders.castShadow = true;
    g.add(shoulders);
  }
  if (style.sash) {
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 1.0 * s, 0.5 * s), makeMat(style.sash));
    sash.position.set(-0.2 * s, 1.2 * s, 0.02 * s);
    g.add(sash);
  }

  g.userData.parts = { torso, head, armL, armR, skirt };
  return g;
}

// 每個人的外型設定。這裡是「辨識度」的來源。
const STYLE = {
  xinling: { scale: 1.04, hat: 'tall', hatColor: '#1f1c18', sash: '#8a6b3a', belt: '#2a2520' },
  houying: { scale: 0.96, hat: 'flat', hatColor: '#3a332a', staff: true, hunch: 0.16, belt: '#4a4438' },
  zhuhai: { scale: 1.16, hat: 'band', hatColor: '#7a2f2f', broad: true, belt: '#33241c' },
  zhaoshi: { scale: 0.98, hat: 'hood', hatColor: '#4a4438', hunch: 0.1, belt: '#4a4438' },
  weiwang: { scale: 1.06, hat: 'tall', hatColor: '#2a2118', sash: '#8a6b3a', belt: '#2a2520' },
  ruji: { scale: 0.98, hat: 'flat', hatColor: '#5c3a4a', sash: '#8a3b5c', belt: '#4a2a38' },
  jinbi: { scale: 1.08, hat: 'flat', hatColor: '#3a3a2a', broad: true, belt: '#2f2a24' },
  pingyuan: { scale: 1.0, hat: 'tall', hatColor: '#2a2a30', belt: '#2a2a30' },
  litong: { scale: 0.94, hat: 'band', hatColor: '#5a4a2f', belt: '#4a4438' },
  guard_a: { scale: 1.0, hat: 'flat', hatColor: '#3a3a2a', belt: '#2f2a24' },
  guard_b: { scale: 0.98, hat: 'flat', hatColor: '#3a3a2a', belt: '#2f2a24' },
};

// 一個活著的人：有身體、會呼吸、會轉頭看向你在乎的方向。
export function createActor(personId, opts = {}) {
  const def = personDef(personId);
  if (!def) throw new Error(`unknown person: ${personId}`);
  const style = { ...(STYLE[personId] || { scale: 1, hat: 'flat' }), ...(opts.style || {}) };
  const group = buildFigure(def, style);

  // 頭上的字號牌：不用文字貼圖，用一顆小色塊 + 顏色，靠顏色對應 look.color。
  const tag = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: 0xff9d3c, emissiveIntensity: 0.6, roughness: 0.7 }),
  );
  tag.position.set(0, style.scale * 2.62, 0);
  group.add(tag);

  const state = {
    def,
    group,
    style,
    x: opts.x ?? 0,
    z: opts.z ?? 0,
    facing: ((opts.facing ?? 180) * Math.PI) / 180,
    targetFacing: ((opts.facing ?? 180) * Math.PI) / 180,
    // 他現在往哪裡走（給「走過去見你」用）
    walkTarget: null,
    walkSpeed: 1.6,
    bobPhase: Math.random() * Math.PI * 2,
    alerted: false,
  };

  group.position.set(state.x, 0, state.z);
  group.rotation.y = state.facing;

  function walkTo(x, z) {
    state.walkTarget = { x, z };
  }

  function update(t, dt, playerPos) {
    // 呼吸：軀幹極輕微的起伏，讓人不像是靜止的模型
    const parts = group.userData.parts;
    const breathe = Math.sin(t * 1.6 + state.bobPhase) * 0.012;
    if (parts.torso) parts.torso.scale.y = 1 + breathe;
    if (parts.head) parts.head.position.y = (style.scale ?? 1) * 1.88 + breathe * 0.5;

    // 走過去
    if (state.walkTarget) {
      const dx = state.walkTarget.x - state.x;
      const dz = state.walkTarget.z - state.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.08) {
        state.walkTarget = null;
      } else {
        const step = Math.min(state.walkSpeed * dt, dist);
        state.x += (dx / dist) * step;
        state.z += (dz / dist) * step;
        state.targetFacing = Math.atan2(dx, dz);
        // 走路的上下彈跳
        group.position.y = Math.abs(Math.sin(t * 9)) * 0.05;
      }
    } else {
      group.position.y *= 0.85;
    }

    // 面向玩家：只在他附近時才轉頭，遠處的人維持原本的朝向
    if (playerPos) {
      const dx = playerPos.x - state.x;
      const dz = playerPos.z - state.z;
      const d = Math.hypot(dx, dz);
      state.alerted = d < 6.5;
      if (state.alerted && !state.walkTarget) {
        state.targetFacing = Math.atan2(dx, dz);
      }
    }

    // 角度平滑：走最短路徑，避免轉頭時繞遠路
    let diff = state.targetFacing - state.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    state.facing += diff * (1 - Math.exp(-6 * dt));

    group.position.x = state.x;
    group.position.z = state.z;
    group.rotation.y = state.facing;
  }

  return { state, group, update, walkTo, get def() { return def; }, get x() { return state.x; }, get z() { return state.z; } };
}

export { buildFigure, STYLE };
