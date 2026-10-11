// 竹简：点开一只陶罐时，从画面一侧滑进来的一板竹牍，写这一局逐幕是怎么走的。
// 底下压着一枚封泥：点它，就把这一局送去放电影。
// 这一板是场景里的实物，不是网页上的面板——它跟着镜头一起推近、可以被摸到。
import * as THREE from 'three';
import { makePlate } from './labels.js';

const CW = 900, CH = 1084;

/** 竹简的底色：七片竹片，带竹节的横纹与包边。 */
function bambooTexture() {
  const c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  const g = c.getContext('2d');
  g.fillStyle = '#2b1d10';
  g.fillRect(0, 0, CW, CH);
  const strips = 7, pad = 16, w = (CW - pad * 2) / strips;
  for (let i = 0; i < strips; i++) {
    const x = pad + i * w;
    const grd = g.createLinearGradient(x, 0, x + w, 0);
    const tone = i % 2 ? '#c19c5e' : '#ccaa70';
    grd.addColorStop(0, '#8a6f3d');
    grd.addColorStop(.2, tone);
    grd.addColorStop(.8, tone);
    grd.addColorStop(1, '#8a6f3d');
    g.fillStyle = grd;
    g.fillRect(x + 2, pad, w - 4, CH - pad * 2);
    g.fillStyle = 'rgba(88,66,32,.32)';
    for (let y = pad + 30; y < CH - pad; y += 158) g.fillRect(x + 3, y, w - 6, 3);
  }
  g.strokeStyle = '#6b4a26';
  g.lineWidth = 9;
  g.strokeRect(pad - 7, pad - 7, CW - (pad - 7) * 2, CH - (pad - 7) * 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createScroll(bench, { onFilm } = {}) {
  const group = new THREE.Group();
  group.visible = false;
  bench.scene.add(group);

  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.96, 2.3),
    new THREE.MeshStandardMaterial({ map: bambooTexture(), roughness: .8, metalness: .04 }));
  board.castShadow = true;
  group.add(board);

  const back = new THREE.Mesh(new THREE.BoxGeometry(1.99, 2.33, .04),
    new THREE.MeshStandardMaterial({ color: '#33241a', roughness: .95 }));
  back.position.z = -.031;
  group.add(back);

  const text = makePlate({
    width: 1.66, height: 2.0, px: 880, py: 1060, maxFont: 52,
    at: [0, 0, .03], lines: [], ink: '#2c1d0c', bg: null, border: null,
  });
  // 竹简是墨写在竹片上：字自己不发光，靠场景里的灯照出来。
  text.mesh.material.emissiveIntensity = 0;
  group.add(text.mesh);

  /* 两头的木轴，让它看起来是卷开挂着的。 */
  const wood = new THREE.MeshStandardMaterial({ color: '#4a3520', roughness: .9 });
  for (const sx of [-1, 1]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, 2.46, 12), wood);
    rod.position.set(sx * 1.03, 0, 0);
    rod.castShadow = true;
    group.add(rod);
  }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 2.1, 12), wood);
  top.rotation.z = Math.PI / 2;
  top.position.set(0, 1.22, 0);
  group.add(top);

  /* 封泥：点它就把这一局送去放电影。 */
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(.17, .2, .08, 18),
    new THREE.MeshStandardMaterial({ color: '#a8442f', roughness: .62, emissive: '#5a1c12', emissiveIntensity: .35 }));
  seal.rotation.x = Math.PI / 2;
  seal.position.set(.62, -.92, .07);
  group.add(seal);
  const sealMark = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .11, 12),
    new THREE.MeshStandardMaterial({ color: '#d8b48a', roughness: .7, emissive: '#7a4a24', emissiveIntensity: .2 }));
  sealMark.rotation.x = Math.PI / 2;
  sealMark.position.set(.62, -.92, .085);
  group.add(sealMark);

  bench.register(group, 'scroll', {
    pad: [2.0, 2.33, .3, 0],
    cursor: 'pointer',
    onClick: () => onFilm?.(),
  });
  bench.register(seal, 'scroll:seal', {
    pad: [.52, .52, .3, 0],
    cursor: 'pointer',
    onClick: () => onFilm?.(),
  });

  const home = new THREE.Vector3(0, 2.35, 2.75);
  const state = { t: 1, dir: 1, up: false, lines: [], scale: 1 };
  bench.addUpdater(dt => {
    if (!state.up) return;
    state.t = Math.min(1, state.t + dt / .42);
    const e = 1 - Math.pow(1 - state.t, 3);
    group.position.copy(home);
    group.position.x -= (1 - e) * .85 * state.dir;
    group.position.y += (1 - e) * -.22;
    group.rotation.y = state.dir * (.5 - .3 * e);
    group.rotation.x = -.1;
    group.scale.setScalar((.94 + .06 * e) * state.scale);
  });

  return {
    group,
    get shown() { return group.visible; },
    /** 现在这一板写的是什么——自查脚本对着它核对逐幕账。 */
    get lines() { return state.lines; },
    /**
     * 展开一板竹简：lines 是逐行写好的字。at 给世界坐标中心，dir=±1 决定从哪一侧滑进来。
     * scale 只在手机竖屏里放大一点——屏窄，不放大读不清。
     */
    show({ at, dir = 1, lines = [], scale = 1 } = {}) {
      home.set(at?.x ?? 2.0, at?.y ?? 2.35, at?.z ?? 2.75);
      state.dir = dir;
      state.t = 0;
      state.up = true;
      state.scale = scale;
      state.lines = [...lines];
      text.setText(lines);
      group.visible = true;
      group.position.copy(home);
      return home.clone();
    },
    hide() {
      state.up = false;
      state.t = 1;
      group.visible = false;
    },
  };
}
