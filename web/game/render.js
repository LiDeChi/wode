// 算圖：renderer / scene / camera / 燈光，以及一個「跟著玩家」的相機。
// 相機是這一場的敘事工具：它不讓你自己轉，只把下一個決定放進畫面裡。

import * as THREE from 'three';
import { CAMERA } from './config.js';

export function createRender(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 220);
  camera.position.set(14.6, 11.2, 14.6);

  // 天光：上方冷、地面暖。不用 HDRI，維持零依賴。
  const hemi = new THREE.HemisphereLight(0x8fa6c4, 0x4a3c2a, 0.85);
  scene.add(hemi);

  // 主光：低角度的斜陽，長影子。這是這一場「圍城」的情緒來源。
  const key = new THREE.DirectionalLight(0xffd9a8, 1.35);
  key.position.set(18, 26, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 90;
  const s = 34;
  key.shadow.camera.left = -s;
  key.shadow.camera.right = s;
  key.shadow.camera.top = s;
  key.shadow.camera.bottom = -s;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.add(key.target);

  // 補光：冷色，從反方向壓一點，避免暗部死黑。
  const fill = new THREE.DirectionalLight(0x6f86a8, 0.35);
  fill.position.set(-14, 10, -16);
  scene.add(fill);

  const camOffset = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const shake = { amount: 0, decay: 6 };
  const tmp = new THREE.Vector3();

  function computeOffset() {
    const el = (CAMERA.elevationDeg * Math.PI) / 180;
    const az = (CAMERA.azimuthDeg * Math.PI) / 180;
    const d = CAMERA.distance;
    const horiz = Math.cos(el) * d;
    camOffset.set(Math.sin(az) * horiz, Math.sin(el) * d, Math.cos(az) * horiz);
  }
  computeOffset();

  function setSceneEnvironment(sceneDef) {
    scene.background = new THREE.Color(sceneDef.sky);
    scene.fog = new THREE.FogExp2(new THREE.Color(sceneDef.sky).getHex(), sceneDef.fog);
  }

  // 相機跟隨：位置用與幀率無關的指數平滑；看向玩家前方一點，讓「下一個決定」進畫面。
  function updateCamera(target, dt, facingRad = 0) {
    const k = 1 - Math.exp(-CAMERA.lambda * dt);
    tmp.copy(target).add(camOffset);
    camera.position.lerp(tmp, k);

    camLook.set(
      target.x + Math.sin(facingRad) * 1.6,
      target.y + CAMERA.lookAheadY,
      target.z + Math.cos(facingRad) * 1.6,
    );
    camera.lookAt(camLook);

    if (shake.amount > 0.0005) {
      const a = shake.amount;
      camera.position.x += (Math.sin(performance.now() * 0.041) + Math.sin(performance.now() * 0.017)) * a;
      camera.position.y += Math.sin(performance.now() * 0.029) * a * 0.7;
      shake.amount *= Math.exp(-shake.decay * dt);
    } else {
      shake.amount = 0;
    }

    // 影子相機跟著玩家走，否則離開中心就沒有影子。
    key.target.position.set(target.x, 0, target.z);
    key.position.set(target.x + 18, 26, target.z + 12);
  }

  function kick(amount) {
    shake.amount = Math.max(shake.amount, amount);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.render(scene, camera);
  }

  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, render, resize, updateCamera, setSceneEnvironment, kick, key };
}
