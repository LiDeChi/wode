// 玩家：走動、加速、面向、被場景邊界擋住。
// 移動是這一場唯一的主要動詞——「走過去，看清楚」本身就是遊戲。

import * as THREE from 'three';
import { PLAYER } from './config.js';

export function createPlayer(canvas) {
  const group = new THREE.Group();

  // 新來的門客：樸素的深色直裾，低冠。刻意不像任何一位主角。
  const robe = '#3f4a52';
  const mk = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: r, flatShading: true });

  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.46, 0.88, 8), mk('#323b42'));
  skirt.position.y = 0.44;
  skirt.castShadow = true;
  skirt.receiveShadow = true;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.74, 0.4), mk(robe));
  torso.position.y = 1.24;
  torso.castShadow = true;
  torso.receiveShadow = true;

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.44), mk('#5a4a34'));
  belt.position.y = 0.9;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.58, 0.15), mk(robe));
  armL.position.set(-0.38, 1.18, 0.02);
  armL.castShadow = true;
  const armR = armL.clone();
  armR.position.x = 0.38;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), mk('#c9a37e'));
  head.position.y = 1.76;
  head.castShadow = true;

  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.36), mk('#2b2f33'));
  cap.position.y = 1.96;
  cap.castShadow = true;

  // 腰間的一點佩飾，讓玩家在畫面裡找得到自己
  const knot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.1), mk('#8a3b2f'));
  knot.position.set(0.2, 0.86, 0.2);

  group.add(skirt, torso, belt, armL, armR, head, cap, knot);

  const state = {
    x: 0, z: 0,
    vx: 0, vz: 0,
    facing: 0,
    targetFacing: 0,
    moving: false,
  };

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointer = new THREE.Vector2();
  const hit = new THREE.Vector3();

  // 點地面就走過去——滑鼠也能玩，不必只用鍵盤。
  function pickGround(clientX, clientY, camera) {
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const p = raycaster.ray.intersectPlane(groundPlane, hit);
    return p ? { x: p.x, z: p.z } : null;
  }

  function place(x, z, facingDeg) {
    state.x = x;
    state.z = z;
    state.vx = 0;
    state.vz = 0;
    state.facing = (facingDeg * Math.PI) / 180;
    state.targetFacing = state.facing;
    group.position.set(x, 0, z);
    group.rotation.y = state.facing;
  }

  // axis：輸入方向（已正規化）。blocked：對話中不給動。
  // moveTarget：點擊地面後的目標點，走到就停。
  function update(dt, axis, blocked, bounds, moveTarget) {
    let ax = axis.x;
    let az = axis.z;

    if (moveTarget && !blocked && ax === 0 && az === 0) {
      const dx = moveTarget.x - state.x;
      const dz = moveTarget.z - state.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.25) {
        ax = dx / d;
        az = dz / d;
      }
    }

    const wantX = ax * PLAYER.speed;
    const wantZ = az * PLAYER.speed;
    const k = 1 - Math.exp(-PLAYER.accel * dt);
    state.vx += (wantX - state.vx) * k;
    state.vz += (wantZ - state.vz) * k;

    const speed = Math.hypot(state.vx, state.vz);
    state.moving = speed > 0.15;

    if (state.moving) {
      state.targetFacing = Math.atan2(state.vx, state.vz);
    }

    let nx = state.x + state.vx * dt;
    let nz = state.z + state.vz * dt;

    if (bounds) {
      const r = PLAYER.radius;
      if (nx < bounds.minX + r) { nx = bounds.minX + r; state.vx = 0; }
      if (nx > bounds.maxX - r) { nx = bounds.maxX - r; state.vx = 0; }
      if (nz < bounds.minZ + r) { nz = bounds.minZ + r; state.vz = 0; }
      if (nz > bounds.maxZ - r) { nz = bounds.maxZ - r; state.vz = 0; }
    }

    state.x = nx;
    state.z = nz;

    let diff = state.targetFacing - state.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    state.facing += diff * (1 - Math.exp(-9 * dt));

    // 走路的上下彈跳與手臂擺動
    const t = performance.now() / 1000;
    const bob = state.moving ? Math.abs(Math.sin(t * 8.5)) * 0.045 : Math.sin(t * 1.7) * 0.012;
    group.position.set(state.x, bob, state.z);
    group.rotation.y = state.facing;
    const swing = state.moving ? Math.sin(t * 8.5) * 0.5 : 0;
    armL.rotation.x = swing;
    armR.rotation.x = -swing;
  }

  return {
    group,
    state,
    update,
    place,
    pickGround,
    get x() { return state.x; },
    get z() { return state.z; },
    get facing() { return state.facing; },
    get position() { return group.position; },
  };
}
