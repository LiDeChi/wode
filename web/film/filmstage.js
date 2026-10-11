// 放映厅：影院里的装置。换眼睛看是三枚人物木牌，进度是一根燃着的香，
// 分享是一封盖封泥的信，片名与幕名挂在匾上。播放逻辑仍在 main.js，这里只管画面与实物。
import * as THREE from 'three';
import { createWorld } from '../game/world.js';
import { createActor, personDef } from '../game/actors.js';
import { MAT, box, cyl, sph } from '../hub/mats.js';
import { textPlate, bambooSlip } from '../hub/text.js';

const LOOKS = {
  daliang: { sky: '#15121a', fog: 0.03 }, yimen: { sky: '#101a20', fog: 0.028 },
  night: { sky: '#080f22', fog: 0.032 }, ye: { sky: '#26222b', fog: 0.027 },
  granary: { sky: '#221e20', fog: 0.03 },
};
const EYES = ['xinling', 'ruji', 'houying'];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const nameOf = id => personDef(id)?.name || id;

export function createFilmStage(render) {
  const { scene, camera } = render;
  const world = createWorld(scene);
  const root = new THREE.Group();
  scene.add(root);
  const extras = new Map();
  let actors = [];
  let currentScene = '';
  let perspective = 'xinling';
  let progress = 0;
  let sharePulse = 0;
  let ended = false;

  root.add(floor());

  // ── 匾：片名与幕名 ──────────────────────────────────────
  const banner = new THREE.Group();
  const bannerBoard = box(1, 0.66, 0.08, MAT.woodLight, 0, 0, 0);
  banner.add(bannerBoard);
  root.add(banner);
  function setBanner(title, place) {
    while (banner.children.length > 1) disposeTree(banner.children.pop());
    const face = textPlate(title || '窃符', { size: 78, weight: 500, color: '#f2e5c1', worldHeight: 0.4, letterSpacing: 6, maxWidth: 900 });
    face.position.set(0, 0.03, 0.06);
    const sub = textPlate(place || '魏国', { size: 58, color: '#cbbb98', worldHeight: 0.17, letterSpacing: 7 });
    sub.position.set(0, -0.42, 0.06);
    bannerBoard.scale.x = Math.max(1.2, face.scale.x * 1.25);
    banner.add(face, sub);
  }

  // ── 三枚人物木牌 ────────────────────────────────────────
  const boards = new Map();
  const boardStand = new THREE.Group();
  root.add(boardStand);
  for (const id of EYES) {
    const g = new THREE.Group();
    g.add(cyl(0.035, 0.05, 1.42, MAT.woodDark, 0, 0, 0, 8));
    g.add(cyl(0.15, 0.19, 0.07, MAT.stoneDark, 0, 0, 0, 14));
    const door = new THREE.Group();
    door.position.set(0, 1.1, 0);
    const face = textPlate(nameOf(id), { size: 92, weight: 500, color: '#f4e7c4', worldHeight: 0.56, vertical: true, letterSpacing: 12 });
    // 整块门往前挪半个板宽：翻正的时候才是绕自己转，而不是绕着旗杆甩。
    const pivot = 0.24;
    const backboard = box(face.scale.x * 1.42, 0.84, 0.05, MAT.woodLight, 0, 0, 0.04 + pivot);
    face.position.set(0, 0, 0.075 + pivot);
    door.add(backboard, face, sph(0.036, MAT.bronze, 0, 0.46, pivot, 8));
    g.add(door);
    boardStand.add(g);
    const node = render.add({
      id: `eye:${id}`, kind: 'eye', name: `换到${nameOf(id)}的眼睛`, act: 'perspective',
      group: g, explicit: V(0, 1.2, 0), radius: 0.72,
    });
    node.perspective = id;
    node.door = door;
    node.face = face;
    boards.set(id, node);
  }

  // ── 一根燃着的香：进度 ──────────────────────────────────
  const incense = incenseStand();
  root.add(incense.group);

  // ── 一封盖封泥的信：分享 ────────────────────────────────
  const letter = sealedLetter();
  root.add(letter.group);
  const letterNode = render.add({
    id: 'share', kind: 'share', name: '分享这部电影', act: 'share',
    group: letter.group, explicit: V(0, 1, 0), radius: 0.7,
  });

  // ── 竹简：你在这里选了……从画面一侧滑入 ───────────────────
  const slipHolder = new THREE.Group();
  root.add(slipHolder);
  let slip = null;
  function setChoice(text) {
    if (slip) { slipHolder.remove(slip); disposeTree(slip); slip = null; }
    if (!text) return;
    slip = bambooSlip(text, { h: 1.6, size: 76, maxWidth: 620 });
    slip.userData.at = 3.2;
    slip.userData.target = 0;
    slipHolder.add(slip);
  }

  // ── 演员与布景 ──────────────────────────────────────────
  function extraScene(id) {
    if (extras.has(id)) return extras.get(id);
    const g = new THREE.Group();
    box(g, id === 'night' ? '#33384b' : '#5d5445', [48, .3, 44], [0, -.18, 0]);
    if (id === 'night') {
      for (const x of [-7, 7]) {
        box(g, '#3d4250', [2, 6, 28], [x, 3, -6]);
        for (const z of [-10, -4, 2, 8]) {
          box(g, '#5f4e4a', [.6, 5, .6], [x + (x < 0 ? 1.2 : -1.2), 2.5, z]);
          const lamp = new THREE.PointLight('#ffad66', 13, 13, 2);
          lamp.position.set(x + (x < 0 ? 1.8 : -1.8), 3.2, z); g.add(lamp);
          const ember = sph(0.26, MAT.flame, 0, 0, 0, 10);
          ember.position.copy(lamp.position); g.add(ember);
        }
      }
      box(g, '#262735', [14, 8, 1], [0, 4, -18]);
      box(g, '#8a6339', [1.6, .6, .8], [0, .7, -9]);
    } else if (id === 'ye') {
      for (const x of [-9, 9]) for (const z of [-8, 0, 8]) {
        const tent = new THREE.Mesh(new THREE.ConeGeometry(3.6, 5, 4), MAT.clothDark);
        tent.position.set(x, 2.5, z); tent.rotation.y = Math.PI / 4; tent.castShadow = true; g.add(tent);
        box(g, '#493a35', [.2, 7, .2], [x + 4, 3.5, z]);
        box(g, '#735056', [1.5, 2, .1], [x + 4.7, 5.6, z]);
      }
      box(g, '#554436', [3, 1, 1.5], [0, .5, -3]);
    } else {
      box(g, '#3f3c34', [24, 7, 1], [0, 3.5, -9]);
      box(g, '#6f5137', [4, 1.3, 2], [0, .65, -1]);
      for (const x of [-7, -5, 5, 7]) for (const z of [-5, -2, 1]) {
        const sack = sph(0.9, MAT.paperDim, x, 1, z, 12);
        sack.scale.y = 1.2;
        g.add(sack);
      }
    }
    scene.add(g); extras.set(id, g); return g;
  }

  // ── 镜头 ────────────────────────────────────────────────
  // 一镜一个目标机位，指数逼近。台词每几秒翻一页，镜头常常还没走完就被
  // 换掉；用缓动进度条的话会一直被打回起点（本轮踩过的坑），指数逼近则
  // 无论换多少次都会稳稳收到目标上。
  const look = V(0, 1.4, 0);
  const goalLook = look.clone();
  const eye = V(12, 6, 17);
  const goalEye = eye.clone();

  // show() 每帧都会被叫；只有这一镜的取景真的变了才换目标。
  const want = { x: 1e9, y: 0, z: 0, dist: 0, elev: 0, az: 1e9 };
  function shot(target, { dist = 12, elev = 16, az = 0.4 } = {}) {
    const same = Math.abs(want.x - target.x) < 0.8 && Math.abs(want.y - target.y) < 0.5
      && Math.abs(want.z - target.z) < 0.8 && Math.abs(want.dist - dist) < 0.4
      && Math.abs(want.elev - elev) < 0.4 && Math.abs(want.az - az) < 0.02;
    if (same) return;
    Object.assign(want, { x: target.x, y: target.y, z: target.z, dist, elev, az });
    goalLook.copy(target);
    const el = elev * Math.PI / 180, a = az * Math.PI / 180;
    goalEye.set(target.x + Math.sin(a) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(a) * Math.cos(el) * dist);
  }

  function show(view, nextPerspective, isEnding) {
    perspective = nextPerspective;
    ended = Boolean(isEnding);
    const id = view.scene || 'daliang';
    if (id !== currentScene) {
      if (world.current) world.current.visible = false;
      for (const g of extras.values()) g.visible = false;
      if (id === 'daliang' || id === 'yimen') world.show(id); else extraScene(id).visible = true;
      const look2 = LOOKS[id] || LOOKS.daliang;
      scene.background = new THREE.Color(look2.sky);
      scene.fog = new THREE.FogExp2(new THREE.Color(look2.sky).getHex(), look2.fog);
      render.key.intensity = id === 'night' ? .4 : 1.15;
      render.key.color.set(id === 'night' ? '#7b9dbb' : '#f4d7b4');
      currentScene = id;
    }
    setBanner(view.title, view.place);

    const people = view.people || [];
    const ids = people.length ? people.map(p => p.id) : ['xinling', 'zhaoshi', 'zhuhai'];
    if (ids.join() !== actors.map(a => a.def.id).join()) {
      for (const actor of actors) {
        scene.remove(actor.group);
        disposeTree(actor.group);
      }
      actors = ids.map((pid, i) => createActor(pid, { x: (i - (ids.length - 1) / 2) * 3.1, z: i % 2 ? -2.2 : 0, facing: 150 }));
      actors.forEach(a => scene.add(a.group));
    }

    const speaker = actors.find(a => a.def.id === view.focus) || actors[0];
    const follow = actors.find(a => a.def.id === perspective);
    const target = V(speaker?.x ?? 0, 1.45, speaker?.z ?? 0);
    if (ended) shot(V(0, 1.1, -1), { dist: 26, elev: 22, az: 0.5, time: 1.6 });
    else if (perspective === 'xinling') shot(target, { dist: 10, elev: 14, az: 0.46, time: 1.1 });
    else if (follow) shot(V(target.x * 0.6, 1.35, target.z * 0.6), { dist: 11, elev: 16, az: perspective === 'ruji' ? -0.5 : 0.62, time: 1.1 });
    else shot(V(0, 1.2, -1), { dist: 17, elev: 20, az: 0.4, time: 1.2 });
  }

  // ── 每帧：装置跟着镜头，但不跟着晃 ─────────────────────────
  // 直接借相机的坐标系摆位：把这个「镜头局部坐标」换算成世界坐标，装置就
  // 永远停在画面里的同一个角落。自己推 fwd/right/up 那套容易错（本轮踩过
  // 的坑：算出来的落点差了好几米，装置跑到画面外）。
  const anchor = V(0, 1.4, 0);
  const local = new THREE.Vector3();
  const dest = new THREE.Vector3();

  /** 在镜头坐标系里摆一件东西：+z 朝画面里，+x 朝右，+y 朝上。 */
  function placeAt(obj, depth, dx, dy, base = 1) {
    // dx/dy 是按 depth=base 标定的屏幕偏移；换深度要等比例缩放，
    // 否则同一件装置摆远一点就跑到画面外去了。
    const s = depth / base;
    camera.updateMatrixWorld();
    local.set(dx * s, dy * s, -depth);
    obj.position.copy(local.applyMatrix4(camera.matrixWorld));
    obj.lookAt(anchor);
  }

  // 木牌一旦落位就不再动，否则每帧再叠一次抬升会把它推走。
  let laidOut = false;
  function layOut(dt) {
    anchor.lerp(eye, 1 - Math.exp(-dt * 7));
    if (!laidOut) {
      // 三枚木牌在架上排成阶梯：主角在最左、侯嬴在最右，高度略微递降。
      const last = boardStand.children.length - 1;
      const spread = innerHeight > innerWidth ? 0.86 : 0.62;
      boardStand.children.forEach((g, i) => {
        g.position.set(i * spread, (last - i) * 0.34, 0);
      });
      laidOut = true;
    }
    // 整架木牌转过来对着镜头，牌面才是正面。
    boardStand.lookAt(anchor);
    boardStand.rotation.x = 0;
    boardStand.rotation.z = 0;
    // 竖屏的可视宽度只有 0.42×高度，横向偏移必须跟着收：wide 就是「半宽」
    // 的比例尺（横屏 1，竖屏 0.42）。纵向上竖屏更高，改用 (1-wide) 补偿。
    // 偏移量再除以深度：物件摆得越远，屏幕上偏得越少，位置才稳。
    const wide = Math.min(1, (innerWidth / Math.max(1, innerHeight)) / 1.7);
    const tall = 1 - wide;
    // 竖屏：三枚木牌排开一点，免得牌面互相压住；信拉近、放大、抬到字幕带以上，
    // 封泥才够得着（手指点下去要 ≥44px，也不能落在字幕底下）。
    const portrait = innerHeight > innerWidth;
    placeAt(banner, 15, 0, 3.6, 8);
    placeAt(boardStand, 8, -2.6 * wide, -0.5 + 0.3 * tall, 8);
    placeAt(incense.group, 7, -1.9 * wide, -0.15 + 0.6 * tall, 8);
    placeAt(letter.group, portrait ? 9.5 : 12, (portrait ? 3.0 : 4.1) * wide, portrait ? -0.35 : -1.0 - 0.35 * tall, 8);
    letter.group.scale.setScalar(portrait ? 1.35 : 1);
    // 信是平放的：立起来 75 度，封泥朝镜头，不然只能看见一条边。
    letter.group.rotation.x = 1.31;
    placeAt(slipHolder, 12, 4.1 * wide, 2.3 - 0.3 * tall, 8);
  }

  function update(dt, t, hovered) {
    const k = 1 - Math.exp(-dt * 2.4);
    eye.lerp(goalEye, k);
    look.lerp(goalLook, k);
    camera.position.copy(eye);
    camera.lookAt(look);
    layOut(dt);

    for (const node of boards.values()) {
      const on = node.perspective === perspective;
      const hot = hovered === node;
      // 翻正 = 牌面朝镜头（正着站）；没点到的牌翻过去，让出正面。
      const target = on ? 0 : (hot ? -0.85 : -2.6);
      node.door.rotation.y += (target - node.door.rotation.y) * Math.min(1, dt * 5);
      node.face.material.opacity = on ? 1 : 0.82;
    }
    incense.setProgress(progress);
    incense.update(dt, t);
    letter.pulse(dt, t, hovered === letterNode, sharePulse);
    if (sharePulse > 0) sharePulse = Math.max(0, sharePulse - dt * 1.6);
    if (slip) {
      slip.userData.at += ((slip.userData.target ?? 0) - slip.userData.at) * Math.min(1, dt * 3.2);
      slip.position.x = slip.userData.at;
      slip.position.y = Math.sin(t * 0.7) * 0.03;
      slip.rotation.z = Math.sin(t * 0.5) * 0.012;
    }
    for (const actor of actors) actor.update(t, dt, V(0, 0, 4));
    world.update(t, dt);
  }

  return {
    show, update, setChoice,
    setPerspective(p) { perspective = p; },
    setProgress(p) { progress = Math.max(0, Math.min(1, p)); },
    pulseShare() { sharePulse = 1; },
    boards, letterNode,
    /** ?dev=1 时用来核对每件装置在屏幕上的位置。 */
    spots(camera) {
      const out = {};
      const v = new THREE.Vector3();
      for (const [id, node] of boards) {
        node.group.getWorldPosition(v).project(camera);
        out['eye:' + id] = [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
      }
      letter.group.getWorldPosition(v).project(camera);
      out.share = [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
      if (slip) {
        slip.getWorldPosition(v).project(camera);
        out.slip = [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
      }
      incense.group.getWorldPosition(v).project(camera);
      out.incense = [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
      return out;
    },
    get sharePulse() { return sharePulse; },
    get view() { return { eye: eye.clone(), look: look.clone() }; },
  };
}

/* ── 小构件 ─────────────────────────────────────────────── */

function floor() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#1e1b18'), roughness: 0.99 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.02;
  m.receiveShadow = true;
  return m;
}

/** 香：铜座 + 一根香。烧到哪，余下的就短到哪。 */
function incenseStand() {
  const group = new THREE.Group();
  group.add(cyl(0.3, 0.38, 0.6, MAT.bronze, 0, 0, 0, 16));
  group.add(cyl(0.13, 0.09, 0.14, MAT.bronzeLit, 0, 0.6, 0, 12));
  const stick = cyl(0.014, 0.016, 0.9, MAT.paperDim, 0, 0.74, 0, 8);
  const ember = sph(0.032, MAT.emberTip, 0, 1.64, 0, 8);
  const smoke = smokeColumn(0, 1.66, 0);
  group.add(stick, ember, smoke.group);
  return {
    group,
    setProgress(p) {
      const left = 1 - Math.max(0, Math.min(1, p));
      const h = Math.max(0.05, 0.9 * left);
      stick.scale.y = Math.max(0.001, left);
      stick.position.y = 0.74 + h / 2;
      ember.position.y = 0.76 + h;
      smoke.group.position.y = 0.8 + h;
      return left;
    },
    update(dt, t) { smoke.update(dt, t); },
  };
}

function smokeColumn(x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const puffs = [];
  for (let i = 0; i < 7; i++) {
    const p = sph(0.05 + i * 0.012, MAT.smoke, 0, i * 0.14, 0, 8);
    p.castShadow = false;
    puffs.push(p);
    group.add(p);
  }
  return {
    group,
    update(dt, t) {
      puffs.forEach((p, i) => {
        const phase = (t * 0.32 + i / puffs.length) % 1;
        p.position.y = phase * 1.5;
        p.position.x = Math.sin(phase * 4 + i) * 0.14 * phase;
        p.material.opacity = 0.15 * (1 - phase);
        p.scale.setScalar(0.6 + phase * 1.7);
      });
    },
  };
}

/** 一封盖封泥的信。封泥是能按下去的那一个。 */
function sealedLetter() {
  const group = new THREE.Group();
  const paper = box(0.88, 0.06, 0.58, MAT.paper, 0, 0, 0);
  const fold = box(0.9, 0.02, 0.14, MAT.paperDim, 0, 0.06, 0);
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 16), MAT.rope);
  cord.rotation.x = Math.PI / 2;
  cord.position.set(0, 0.075, 0);
  const wax = sph(0.11, MAT.wax, 0, 0.1, 0, 14);
  wax.scale.y = 0.5;
  const press = box(0.07, 0.02, 0.07, MAT.gold, 0, 0.145, 0);
  const glow = new THREE.PointLight(new THREE.Color('#ff7a4a'), 3.4, 3.4, 2);
  glow.position.set(0, 0.28, 0.12);
  const label = textPlate('分享', { size: 58, color: '#241c12', worldHeight: 0.15, letterSpacing: 6 });
  label.position.set(0, 0.035, 0.34);
  label.rotation.x = -Math.PI / 2;
  group.add(paper, fold, cord, wax, press, glow, label);
  group.userData.rest = group.position.y;
  return {
    group,
    pulse(dt, t, hot, pressed) {
      wax.scale.set(1 + (hot ? 0.14 : 0) + pressed * 0.26, 0.5 * (1 + (hot ? 0.14 : 0) + pressed * 0.26), 1 + (hot ? 0.14 : 0) + pressed * 0.26);
      wax.material.emissiveIntensity = 0.7 + Math.sin(t * 1.8) * 0.25 + pressed * 1.6;
      glow.intensity = 3.2 + (hot ? 1.8 : 0) + pressed * 16;
      press.position.y = 0.145 + (hot ? 0.012 : 0);
      void dt;
    },
  };
}

function disposeTree(obj) {
  obj.traverse(o => {
    o.geometry?.dispose?.();
    if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); }
  });
}
