// 一台自己的镜头：给谁说话就推到谁跟前，讲完了就退开。慢慢追，但不拖。
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function createCamera(render) {
  const cam = render.camera;
  const target = V(0, 1.4, 0);
  const goalTarget = target.clone();

  const cur = { dist: 15, az: 0.55, elev: 0.55 };
  const goal = { ...cur };

  let shake = 0;
  let time = 0;
  let drift = 1;
  let still = 0;

  function place(instant = false) {
    const ce = Math.cos(cur.elev);
    const d = cur.dist;
    const off = V(
      Math.sin(cur.az) * ce * d,
      Math.sin(cur.elev) * d,
      Math.cos(cur.az) * ce * d,
    );
    cam.position.copy(target).add(off);
    if (shake > 0.0001) {
      cam.position.x += (Math.random() - 0.5) * shake;
      cam.position.y += (Math.random() - 0.5) * shake * 0.6;
      cam.position.z += (Math.random() - 0.5) * shake;
    }
    cam.lookAt(target.x, target.y, target.z);
    if (instant) cam.updateMatrixWorld();
  }

  return {
    camera: cam,
    target,
    get position() { return cam.position; },

    /** 一个景别：目标点、机位距离、方位角、俯角。instant 表示不再缓动。 */
    setShot(shot = {}, instant = false) {
      if (shot.target) goalTarget.set(...shot.target);
      if (shot.dist !== undefined) goal.dist = shot.dist;
      if (shot.az !== undefined) goal.az = shot.az;
      if (shot.elev !== undefined) goal.elev = shot.elev;
      if (shot.targetY !== undefined) goalTarget.y = shot.targetY;
      if (instant) {
        target.copy(goalTarget);
        Object.assign(cur, goal);
        place(true);
      }
    },

    /** 推近某个人/某个物件。dist 越小越近。 */
    focus(point, opts = {}) {
      goalTarget.copy(point);
      // 相机站在人物侧前方，避免挡住脸
      const az = opts.az !== undefined ? opts.az : cur.az + 0.10;
      goal.az = az;
      goal.dist = opts.dist !== undefined ? opts.dist : 6.4;
      goal.elev = opts.elev !== undefined ? opts.elev : 0.24;
    },

    punch(amount = 0.12) { shake = Math.max(shake, amount); },
    hold() { still = 1.6; },

    update(dt) {
      time += dt;
      const k = 1 - Math.exp(-3.4 * dt);
      target.lerp(goalTarget, k);
      cur.dist += (goal.dist - cur.dist) * (1 - Math.exp(-2.6 * dt));
      cur.elev += (goal.elev - cur.elev) * (1 - Math.exp(-2.6 * dt));
      // 方位角走近路
      let da = goal.az - cur.az;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      cur.az += da * (1 - Math.exp(-2.6 * dt));

      shake *= Math.exp(-6.5 * dt);
      still = Math.max(0, still - dt);
      const breathe = drift * (0.6 + 0.4 * Math.sin(time * 0.5));
      const wobble = breathe;
      cam.position.y += Math.sin(time * (still > 0 ? 0.35 : 0.8)) * 0.02 * wobble;
      place(false);
    },

    setDrift(amount) { drift = amount; },
  };
}
