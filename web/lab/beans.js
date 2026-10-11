// 豆子：每一局是一颗豆子。它从顶上的漏斗落下，沿四层岔路滚到结局陶罐里。
// 走的是这一局真实走过的路——第 k 层走哪条岔，就是第 k 幕用了哪种诉求。
import * as THREE from 'three';

/** 轨道的尺寸只在这里定义一次；机架的木头也照这个尺寸搭。 */
export const TRACK = {
  half: 2.6,
  rows: 4,
  rowY: [2.9, 2.15, 1.4, .65],
  entryY: 3.78,
  rowZ: 0,
  rowDepth: 1.7,
  laneX: i => -2.08 + i * 1.04,
  /** 四个结局槽位；每个槽位放两只罐：改前是青釉，改后是酱釉。 */
  potBaseX: [-2.5, -1.1, .3, 1.7],
  potX: (slot, column) => TRACK.potBaseX[slot] + (column === 'after' ? .8 : 0),
  potZ: 1.5,
  potTop: .3,
  potR: .36,
};

export const LAYER_NAMES = ['大梁', '夷门', '取符之夜', '邺城'];
// 岔路五条：四种诉求各一条，中间一条留给「看心思／问缘由／换守仓人」。
export const LANE_APPEALS = ['义', '利', '惧', '恩', '旁观'];
export const ENDING_SLOT = { history: 0, 'jinbi-lives': 1, broken: 2, stuck: 3 };
export const SLOT_ENDING = ['history', 'jinbi-lives', 'broken', 'stuck'];
export const ENDINGS = {
  history: { label: '史书的走法', color: '#5f8399' },
  'jinbi-lives': { label: '晋鄙活下来', color: '#4f9a86' },
  broken: { label: '兵符没出宫', color: '#b4805c' },
  stuck: { label: '半路走不下去', color: '#8c6f9b' },
};
export const GLAZE = { before: { color: '#4d6b78', name: '青釉' }, after: { color: '#8c6046', name: '酱釉' } };
export const PERSONA_COLORS = {
  curious: '#6fa9c4', hasty: '#c2603f', loyal: '#d8c07a', contrarian: '#a077b3',
  // 模拟玩家每加一位，这里补一色；没补的颜色由 spawn 兜底成灰豆子。
  patient: '#7fa07a',
};

export const ACT_ROW = { daliang: 0, yimen: 1, night: 2, ye: 3, granary: 3 };
const APPEAL_LANE = { 义: 0, 利: 1, 惧: 2, 恩: 3 };

/** 这一局在四层岔路上各走哪一条。没试过诉求的那一层走中间那条。 */
export function lanesOf(run) {
  const lanes = [4, 4, 4, 4];
  for (const step of run.trail || []) {
    const row = ACT_ROW[step.act];
    if (row === undefined || lanes[row] !== 4) continue;
    if (APPEAL_LANE[step.appeal] !== undefined) lanes[row] = APPEAL_LANE[step.appeal];
  }
  return lanes;
}

export const slotOf = run => ENDING_SLOT[run.stuck ? 'stuck' : run.ending] ?? ENDING_SLOT.stuck;

export function pathOf(lanes, slot, column) {
  const lx = i => TRACK.laneX(i);
  const pts = [
    new THREE.Vector3(lx(lanes[0]), TRACK.entryY, TRACK.rowZ),
    new THREE.Vector3(lx(lanes[0]), TRACK.rowY[0], TRACK.rowZ),
  ];
  for (let k = 1; k < TRACK.rows; k++) {
    pts.push(new THREE.Vector3(lx(lanes[k]), TRACK.rowY[k - 1] - .03, TRACK.rowZ));
    pts.push(new THREE.Vector3(lx(lanes[k]), TRACK.rowY[k], TRACK.rowZ));
  }
  pts.push(new THREE.Vector3(TRACK.potX(slot, column), TRACK.potTop + .52, TRACK.potZ));
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', .28);
}

/** 陶罐里豆子码放的位置：一圈四颗，往上摞。堆得越高，这一种结局越多。 */
export function settleAt(slot, column, index) {
  const x = TRACK.potX(slot, column);
  const layer = Math.floor(index / 4), seat = index % 4;
  return new THREE.Vector3(
    x + Math.cos(seat * 1.9 + layer) * (layer ? .09 : .15),
    TRACK.potTop + .07 + layer * .155,
    TRACK.potZ + Math.sin(seat * 1.9 + layer) * (layer ? .09 : .15),
  );
}

const GEO = new THREE.SphereGeometry(.098, 12, 9);
GEO.scale(1, .82, 1);

export function createBeads(parent, { speed = 1 } = {}) {
  const materials = new Map();
  const beans = [];
  const matFor = color => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .48, metalness: .05 }));
    return materials.get(color);
  };

  function spawn({ run, column, persona, index = 0 }) {
    const mesh = new THREE.Mesh(GEO, matFor(run.color || PERSONA_COLORS[persona] || '#bbb'));
    mesh.castShadow = true;
    mesh.visible = false;
    parent.add(mesh);
    const slot = slotOf(run);
    const bean = {
      run, column, persona, mesh, slot,
      curve: pathOf(lanesOf(run), slot, column),
      home: settleAt(slot, column, beans.filter(b => b.column === column && b.slot === slot).length),
      delay: .12 + index * (speed > 2 ? .012 : .055),
      phase: 'waiting', t: 0, spin: Math.random() * 6, landed: 0, fast: false,
    };
    beans.push(bean);
    return bean;
  }

  function update(dt, clock) {
    for (const bean of beans) {
      if (bean.phase === 'waiting') {
        bean.delay -= dt;
        if (bean.delay <= 0) { bean.phase = 'falling'; bean.mesh.visible = true; }
        continue;
      }
      if (bean.phase === 'falling') {
        bean.t = Math.min(1, bean.t + dt / (bean.fast ? 1.05 : 1.85));
        bean.mesh.position.copy(bean.curve.getPointAt(bean.t));
        bean.mesh.rotation.set(bean.spin + clock * 7, clock * 3, bean.spin);
        if (bean.t >= 1) { bean.phase = 'settling'; bean.landed = 0; }
        continue;
      }
      if (bean.phase === 'settling') {
        bean.landed += dt * 4.5;
        bean.mesh.position.lerp(bean.home, 1 - Math.exp(-dt * 14));
        if (bean.landed >= 1) {
          bean.mesh.position.copy(bean.home);
          bean.mesh.rotation.set(0, bean.spin, 0);
          bean.phase = 'rest';
        }
      }
    }
  }

  return {
    beans, spawn, update,
    /** 一颗豆子重走一遍自己的路——点开陶罐时用。 */
    rewind(bean) { bean.phase = 'falling'; bean.t = 0; bean.fast = true; bean.mesh.visible = true; },
    inSlot(column, slot) { return beans.filter(b => b.column === column && b.slot === slot); },
    anyBusy() { return beans.some(b => b.phase !== 'rest'); },
    clear(column) {
      for (let i = beans.length - 1; i >= 0; i--) {
        if (column && beans[i].column !== column) continue;
        parent.remove(beans[i].mesh);
        beans.splice(i, 1);
      }
    },
  };
}
