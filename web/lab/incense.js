// 两炷香：改前一炷、改后一炷。烧掉的长度就是那一列的平均戏内时长——
// 一炷香整根十五分钟。香脚前立一块小木牌，刻着折算好的分钟数。
import * as THREE from 'three';
import { makePlate } from './labels.js';

const FULL = 900;                 // 一炷香 = 15 分钟戏内
const STICK = 1.0;                // 整根香有多高
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createIncense(bench, { at = [-1.35, 0, 4.68], onPick } = {}) {
  const group = new THREE.Group();
  group.position.set(...at);
  bench.scene.add(group);

  const brass = new THREE.MeshStandardMaterial({ color: '#b6904f', roughness: .34, metalness: .86 });
  const dark = new THREE.MeshStandardMaterial({ color: '#7a6134', roughness: .45, metalness: .8 });
  const ashMat = new THREE.MeshStandardMaterial({ color: '#6b6154', roughness: 1 });

  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.3, .21, .13, 22), brass);
  bowl.position.y = .065; bowl.castShadow = true; bowl.receiveShadow = true; group.add(bowl);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(.3, .022, 8, 24), dark);
  lip.rotation.x = Math.PI / 2; lip.position.y = .13; group.add(lip);
  const ash = new THREE.Mesh(new THREE.CylinderGeometry(.265, .265, .02, 20), ashMat);
  ash.position.y = .128; group.add(ash);
  // 香脚：两根插在灰里的细签
  const sticks = {};
  const spec = { before: { x: -.12, tip: '#9fc4e2' }, after: { x: .12, tip: '#ffc07a' } };
  for (const [column, s] of Object.entries(spec)) {
    const g = new THREE.Group();
    g.position.set(s.x, .13, 0);
    group.add(g);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(.021, .024, STICK, 8),
      new THREE.MeshStandardMaterial({ color: '#5d4a33', roughness: .95 }));
    stick.position.y = STICK / 2; g.add(stick);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(.028, 10, 8),
      new THREE.MeshStandardMaterial({ color: '#fff0d8', emissive: s.tip, emissiveIntensity: 1.6, roughness: .4 }));
    g.add(ember);
    const glow = new THREE.PointLight(s.tip, 0, 2.2, 2);
    g.add(glow);
    sticks[column] = { g, stick, ember, glow, shown: 1, target: 1 };
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .02, 10), dark);
    seat.position.set(s.x, .135, 0); group.add(seat);
  }

  const tag = makePlate({
    width: 1.15, height: .34, px: 1024, py: 300, maxFont: 108, at: [0, .3, .44],
    lines: ['一炷香＝十五分钟', '改前 — · 改后 —'],
  });
  group.add(tag.mesh);

  const state = { before: null, after: null };
  function set(next = {}) {
    for (const column of ['before', 'after']) {
      if (column in next) state[column] = next[column];
    }
    const read = column => {
      const sec = state[column];
      sticks[column].target = sec == null ? 1 : clamp(1 - sec / FULL, .06, 1);
      return sec == null ? '—' : `${(sec / 60).toFixed(1)} 分`;
    };
    tag.setText(['一炷香＝十五分钟', `改前 ${read('before')} · 改后 ${read('after')}`]);
  }
  set();

  bench.register(group, 'incense', {
    pad: [.86, .55, .5],
    onClick: () => onPick?.(),
  });

  bench.addUpdater((dt, clock) => {
    for (const column of ['before', 'after']) {
      const s = sticks[column];
      s.shown += (s.target - s.shown) * (1 - Math.exp(-dt * 6));
      s.stick.scale.y = s.shown;
      s.stick.position.y = STICK * s.shown / 2;
      const lit = s.shown < .999;
      s.ember.position.y = STICK * s.shown + .01;
      s.ember.visible = lit;
      s.ember.material.emissiveIntensity = 1.3 + (lit ? Math.sin(clock * 4 + (column === 'after' ? 1 : 0)) * .35 : 0);
      s.glow.position.y = STICK * s.shown + .04;
      s.glow.intensity = lit ? .5 : 0;
    }
  });

  return {
    group, tag,
    set,
    get readings() { return { before: state.before, after: state.after }; },
    /** 这一刻两根香还剩多长——自查脚本对着它核对读数。 */
    get shown() { return { before: sticks.before.shown, after: sticks.after.shown }; },
  };
}
