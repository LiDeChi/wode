// 生活台：推演机左边一张矮案，手摇一拍，看「铜槽 → 脉搏 → 眼睛 → 身段 → 手 → 史简」这一条链。
// 只画东西、只报「谁被摸了」；算什么、锁什么，都在 liferun.js 里。
import * as THREE from 'three';
import { makePlate } from './labels.js';

const m = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: .9, ...opts });
const WOOD = () => m('#2b2118', { roughness: .94 });
const WOOD2 = () => m('#43301f', { roughness: .9 });
const BRASS = () => m('#b6904f', { roughness: .32, metalness: .88 });
const IRON = () => m('#3d3d46', { roughness: .5, metalness: .78 });
const LAMP_OFF = '#3a3128';
const LAMP_ON = '#e8b45c';

const CHAIN = ['铜槽', '脉搏', '眼睛', '身段', '手', '史简'];
/** 牌子上的字按 8 个字一行折，太长就缩。 */
function wrap(text, max = 8) {
  const s = String(text ?? '').trim();
  if (s.length <= max) return [s];
  const out = [];
  for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
  return out;
}

export function buildLifeBench(bench, { at = [0, -1.62, 0], onCrank, onSlot, onLock, onEnd } = {}) {
  const root = new THREE.Group();
  root.position.set(...at);
  bench.scene.add(root);
  const box = (parent, material, size, pos, rotation) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...pos);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const plates = [];
  const plate = (parent, opts) => { const p = makePlate(opts); parent.add(p.mesh); plates.push(p); return p; };

  /* ---------------- 矮案与地脚 ---------------- */
  box(root, WOOD(), [5.2, .2, 2.4], [0, 1.1, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(root, m('#241b13'), [.2, 1.0, .2], [sx * 2.3, .5, sz * 1.0]);
  box(root, WOOD2(), [5.2, .55, .16], [0, 1.45, -1.12]);      // 后梁：六盏链灯挂在这儿
  box(root, m('#1c1510'), [5.2, .5, .14], [0, .55, 1.18]);    // 前脸：痕迹牌

  /* ---------------- 铜槽：往这儿放这一拍的输入 ---------------- */
  box(root, m('#1a1712'), [1.5, .12, .52], [-1.9, 1.22, .62]);
  const token = box(root, BRASS(), [.52, .16, .34], [-1.9, 1.34, .62]);
  const slotPlate = plate(root, { width: 1.5, height: .4, px: 640, py: 190, maxFont: 78, at: [-1.9, 1.62, .78], lines: ['生活脚本 · 空等'] });
  bench.register(token, 'life:slot', { pad: [1.7, 1.1, .9, 1.3], onHoverStart: () => { token.scale.setScalar(1.12); }, onHoverEnd: () => { token.scale.setScalar(1); }, onClick: () => onSlot?.() });

  /* ---------------- 摇柄：摇一拍 ---------------- */
  const crankG = new THREE.Group();
  crankG.position.set(2.0, 1.42, .34);
  root.add(crankG);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(.2, .22, .5, 12), BRASS());
  drum.rotation.z = Math.PI / 2; drum.position.set(-.22, .12, 0); crankG.add(drum);
  const arm = box(crankG, IRON(), [.1, .6, .1], [0, .2, 0], [0, 0, .45]);
  arm.castShadow = true;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.17, 14, 10), WOOD2());
  knob.position.set(.26, .45, 0); crankG.add(knob);
  const crankPlate = plate(root, { width: 1.5, height: .4, px: 640, py: 190, maxFont: 78, at: [2.0, 1.62, .78], lines: ['手摇 · 一拍'] });
  bench.register(knob, 'life:crank', { pad: [1.7, 1.5, 1.1, 1.9], onHoverStart: () => { crankG.rotation.x = -.35; }, onHoverEnd: () => { crankG.rotation.x = 0; }, onClick: () => onCrank?.() });

  /* ---------------- 四把锁：导演 / 种子 / 初始经验 / 如姬托付 ----------------
     后排两把站得高，前排两把站在案沿——「初始经验」和「如姬托付」要是也站后排，
     手指还没够到它们，就先撞上身后/身前那块「摇到天亮」的牌子（射线先撞近的东西）。 */
  const lockPlates = {};
  const LOCK_SEATS = [
    ['director', '导演', -2.3, .05, 2.0],
    ['seed', '种子', -1.35, .05, 2.0],
    ['carry', '初始经验', 1.2, .85, 1.55],
    ['trust', '如姬托付', 2.35, .85, 1.55],
  ];
  for (const [id, label, x, z, y] of LOCK_SEATS) {
    box(root, WOOD2(), [.09, y - 1.2 + .24, .09], [x, 1.2 + (y - 1.2) / 2 - .08, z]);
    lockPlates[id] = plate(root, { width: 1.15, height: .44, px: 600, py: 220, maxFont: 70, at: [x, y - .3, z + .1], lines: [`${label} · 一`] });
    const hit = box(root, new THREE.MeshBasicMaterial({ visible: false }), [1.15, .8, .4], [x, y, z]);
    bench.register(hit, `life:lock:${id}`, { pad: [1.15, .8, .4, y], onClick: () => onLock?.(id) });
  }

  /* ---------------- 摇到天亮的小杆 ---------------- */
  const endLever = box(root, IRON(), [.09, .8, .09], [.1, 1.5, .7], [-.35, 0, 0]);
  box(root, BRASS(), [.3, .1, .1], [.1, 1.9, .7]);
  plate(root, { width: 1.4, height: .38, px: 600, py: 180, maxFont: 72, at: [.1, 1.18, .88], lines: ['摇到天亮'] });
  bench.register(endLever, 'life:end', { pad: [1.3, 1.3, .7, 1.6], onClick: () => onEnd?.() });

  /* ---------------- 六盏链灯：这一拍哪一环真的动了 ---------------- */
  const lamps = [];
  for (let i = 0; i < CHAIN.length; i++) {
    const x = -1.95 + i * .78;
    box(root, BRASS_DARK_(), [.06, .3, .06], [x, 1.7, -1.05]);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(.16, .16, .16), m(LAMP_OFF, { emissive: LAMP_OFF, emissiveIntensity: .2, roughness: .4 }));
    bulb.position.set(x, 1.9, -1.05);
    root.add(bulb);
    lamps.push(bulb);
    plate(root, { width: .72, height: .2, px: 320, py: 110, maxFont: 86, at: [x, 1.56, -0.97], lines: [CHAIN[i]], bg: 'rgba(14,10,6,.5)', border: null });
  }
  function BRASS_DARK_() { return m('#7a6134', { roughness: .45, metalness: .82 }); }

  /* ---------------- 三块身段牌：谁停在哪一层 ---------------- */
  const postPlates = {};
  const WHO = [['ruji', -1.55], ['guard_a', 0], ['guard_b', 1.55]];
  for (const [id, x] of WHO) {
    box(root, WOOD2(), [.08, .34, .08], [x, 1.28, -.5]);
    postPlates[id] = plate(root, { width: 1.5, height: .6, px: 620, py: 250, maxFont: 66, at: [x, 1.62, -.36], lines: ['如姬', '还没有动静'] });
  }

  /* ---------------- 判决牌与小字：这一回机会抓住没抓住 ---------------- */
  const post = box(root, WOOD2(), [.12, 2.9, .12], [-2.9, 1.45, -1.0]);
  const verdictPlate = plate(root, { width: 2.4, height: .95, px: 760, py: 300, maxFont: 72, at: [-2.9, 2.5, -.86], lines: ['机会还没开始走', '先摇一拍'] });
  const changePlate = plate(root, { width: 2.5, height: .44, px: 780, py: 170, maxFont: 70, at: [2.0, 2.28, .1], rotation: [0, 0, 0], lines: ['只改了一样：导演'] });

  /* ---------------- 史简：真实发生过的每一句都刻在这儿 ---------------- */
  const slipG = new THREE.Group();
  slipG.position.set(2.05, 2.05, -1.0);
  root.add(slipG);
  box(slipG, WOOD2(), [1.75, 2.7, .1], [0, 0, 0]);
  for (const sx of [-1, 1]) box(slipG, WOOD(), [.1, 2.7, .16], [sx * .88, 0, 0]);
  const slipPlate = plate(slipG, { width: 1.62, height: 2.5, px: 700, py: 1080, maxFont: 78, at: [0, 0, .09], lines: ['这一段还没开始'], bg: 'rgba(26,18,10,.92)' });

  /* ---------------- 痕迹：记忆装置里现在挂着什么 ---------------- */
  const markPlate = plate(root, { width: 2.6, height: .95, px: 880, py: 320, maxFont: 62, at: [0, .55, 1.27], lines: ['记忆装置', '空手进场：什么都没有'] });

  const state = {};
  function lit(i, on) {
    const b = lamps[i]?.material;
    if (!b) return;
    b.color.set(on ? LAMP_ON : LAMP_OFF);
    b.emissive.set(on ? LAMP_ON : LAMP_OFF);
    b.emissiveIntensity = on ? 1.4 : .2;
  }
  /** 把 liferun 的读数画上去。除了 dev 面板，这里一个数字都不刻。 */
  function refresh(read) {
    state.read = read;
    slotPlate.setText([`生活脚本 · ${read.locks.script}`]);
    lockPlates.director.setText([`导演 · ${read.locks.director}`]);
    lockPlates.seed.setText([`种子 · ${read.locks.seed}`]);
    lockPlates.carry.setText([`初始经验 · ${read.locks.carry}`]);
    lockPlates.trust.setText(['如姬托付', `· ${read.locks.trustName || '低'}`]);
    changePlate.setText([read.changedText?.length ? `只改了一样：${read.changedText.join('、')}` : '第一回上弦']);
    const v = read.verdict || {};
    verdictPlate.setText([v.text || '还没上弦', ...wrap(v.why || '', 12).slice(0, 2)]);
    slipPlate.setText(read.slip?.length ? read.slip.map((s) => `${s.at}拍 ${s.who}：${wrap(s.text, 9)[0]}`).slice(-6) : ['这一段还没刻上东西']);
    for (const [id, p] of Object.entries(postPlates)) {
      const a = (read.actors || []).find((x) => x.id === id);
      const who = { ruji: '如姬', guard_a: '守卫甲', guard_b: '守卫乙' }[id] || id;
      p.setText(a ? [who, ...wrap(a.plate, 9).slice(0, 2)] : [who, '还没有动静']);
    }
    const marks = read.marks || [];
    markPlate.setText(marks.length
      ? ['记忆装置', ...marks.slice(0, 2).map((k) => wrap(k.text, 14)[0])]
      : ['记忆装置', read.locks.carry === '带着上一段' ? '装着上一段，还没亮' : '空手进场：什么都没有']);
    const c = read.chain;
    lit(0, !!c?.slot?.length || !!c?.ledger);
    lit(1, !!c?.pulse);
    lit(2, !!(c?.eyes?.length));
    lit(3, !!(c?.eyes?.length));
    lit(4, !!c?.hand);
    lit(5, !!(read.slip?.length));
    if (read.done) lit(4, marks.length > 0 && (read.counts?.acts ?? 0) > 0);
  }
  /** 认领：点上去的那一下有反馈（摇柄转一格、牌子晃一下） */
  function kick() {
    crankG.rotation.x = -.5;
    setTimeout(() => { crankG.rotation.x = 0; }, 180);
  }
  return { root, refresh, kick, state, plates: { slotPlate, lockPlates, changePlate, verdictPlate, slipPlate, markPlate, postPlates }, lamps, get read() { return state.read; } };
}
