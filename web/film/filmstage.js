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
  // 记住 box() 的约定：它把「盒子底部」放在 y 上（position.y = y + h/2）。
  // 板子要绕着原点翻/摆，所以这里把底放到 -h/2，让圆心落在原点上。
  const bannerBoard = box(1, 0.66, 0.08, MAT.woodLight, 0, -0.33, 0);
  banner.add(bannerBoard);
  root.add(banner);
  function setBanner(title, place) {
    while (banner.children.length > 1) disposeTree(banner.children.pop());
    const face = textPlate(title || '窃符', { size: 78, weight: 500, color: '#f2e5c1', worldHeight: 0.4, letterSpacing: 6, maxWidth: 900 });
    face.position.set(0, 0.1, 0.06);
    const sub = textPlate(place || '魏国', { size: 58, color: '#cbbb98', worldHeight: 0.17, letterSpacing: 7 });
    sub.position.set(0, -0.19, 0.06);
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
    // textPlate 的 worldHeight 是「单位缩放」，竖排时字号会被画布长宽比（3 字≈2.15、
    // 2 字≈1.56）再乘一遍——牌面文字会高过门板、从板子下面漏出去。这里按画布比例
    // 重算：想要文字多少世界高，就直接把它设成那么高。
    const faceH = 0.62;
    const fa = face.userData.aspect;
    face.scale.set(faceH * fa, faceH * fa, 1);
    // 整块门往前挪半个板宽：翻正的时候才是绕自己转，而不是绕着旗杆甩。
    const pivot = 0.24;
    // 板面比字宽一圈：牌翻过去的时候只剩一条斜边，板子窄了手指就点不着
    // （竖屏/横屏都要留出上下左右各 22px 都能点到的地方）。
    const backboard = box(Math.max(0.34, face.scale.x * 1.5), 0.92, 0.05, MAT.woodLight, 0, 0, 0.04 + pivot);
    // 门板底下沿在 y=0、板心在 0.45；文字要落在板心上，不然会从板子下面漏出去。
    face.position.set(0, 0.46, 0.075 + pivot);
    // 牌子背面也写上名字：没点到的牌会翻过去让出正面，翻过去的那面若是空白，
    // 就没人知道该点哪一枚。
    const back = face.clone();
    back.position.set(0, 0.46, 0.04 + pivot - 0.03);
    back.rotation.y = Math.PI;
    door.add(backboard, face, back, sph(0.036, MAT.bronze, 0, 0.46, pivot, 8));
    // 起个名字：探针要拿射线问「这块牌子有没有被前面那块挡住」。
    door.name = `door:${id}`;
    face.name = `face:${id}`;
    g.add(door);
    boardStand.add(g);
    const node = render.add({
      id: `eye:${id}`, kind: 'eye', name: `换到${nameOf(id)}的眼睛`, act: 'perspective',
      group: g, explicit: V(0, 1.2, 0), radius: 0.72,
    });
    g.name = `board:${id}`;
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

  let lifeFrame = null;
  const directorPaper = new THREE.Group(); root.add(directorPaper); directorPaper.visible = false;
  // 案头木牌：写着这一拍是第几拍、这个世界等不等你。只读 frame.tick 与导演当场决定。
  const tickHolder = new THREE.Group(); root.add(tickHolder);
  let tickSlip = null;
  /** 案头木牌：字板按字的真实大小做。竹简那条老路把整列字压进固定身高，
   *  十一个字会缩成一条看不见的墨线——拍号是给眼睛看的，得自己量尺寸。 */
  function tickSign(words, portrait) {
    const g = new THREE.Group();
    // 牌面跟人物木牌一个做法：深木底 + 浅墨字。夜里主光只有 .4，
    // 浅底深字会糊成一块暗板，反过来才看得清（眼睛木牌就是这么写的）。
    const face = textPlate(words, { size: 96, weight: 500, color: '#f4e7c4', bg: 'rgba(0,0,0,0)', worldHeight: portrait ? .95 : 1.05, vertical: true, letterSpacing: 10 });
    // textPlate 的 worldHeight 只是「单位缩放」：板子的几何体是 1×(高/宽)，所以真高是
    // scale.y / aspect、真宽才是 scale.x。板子按 scale 直接做，字就会从上下两头冒出去
    //（竖排字块实测比 scale.y 高 1.7 倍）。
    const pw = face.scale.x;
    const ph = face.scale.y / (face.userData.aspect || 1);
    const board = new THREE.Mesh(new THREE.BoxGeometry(pw * 1.22, ph * 1.16, 0.035),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#6d5437'), roughness: 0.92 }));
    board.castShadow = true;
    g.add(board);
    for (const y of [ph * 0.55, -ph * 0.55]) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(pw * 1.4, 0.045, 0.05),
        new THREE.MeshStandardMaterial({ color: new THREE.Color('#4b3826'), roughness: 0.95 }));
      lip.castShadow = true; lip.position.set(0, y, -0.004); g.add(lip);
    }
    face.position.z = 0.021; g.add(face);
    return g;
  }
  function setTick(frame) {
    const tick = Number(frame?.tick);
    if (!Number.isFinite(tick)) return;
    const decision = frame.experience?.director?.decisions?.at(-1);
    const waits = decision ? Boolean(decision.payload?.policy?.waitForPlayer) : null;
    const portrait = innerHeight > innerWidth;
    const words = `第 ${tick} 拍\n${waits === null ? '世界先走' : waits ? '世界等你' : '世界继续'}`;
    const key = `${words}|${portrait}`;
    if (tickSlip?.userData.words === key) return;
    if (tickSlip) { tickHolder.remove(tickSlip); disposeTree(tickSlip); }
    tickSlip = tickSign(words, portrait);
    tickSlip.userData.words = key;
    tickHolder.add(tickSlip);
  }
  const clip = (value, n) => { const s = String(value ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
  const clause = (value, n) => { const s = String(value ?? '').trim(); const head = s.split(/[：:]/)[0]; return clip(head.length >= 2 ? head : s, n); };
  function setExperience(frame) {
    lifeFrame = frame?.life || null;
    for (const child of [...directorPaper.children]) { directorPaper.remove(child); disposeTree(child); }
    directorPaper.visible = Boolean(frame?.experience);
    if (!frame?.experience) return;
    const { director = { learns: [], decisions: [], predictions: {} }, pages = [], notes = [] } = frame?.experience ?? {};
    const learns = director.learns ?? [];
    const portrait = innerHeight > innerWidth;
    const decision = director.decisions?.at(-1);
    const prediction = Object.values(director.predictions ?? {}).flatMap(p => p.list || []).at(-1);
    const learn = learns.at(-1);
    const hit = /猜中了?(\d+\/\d+)/.exec(String(learn?.said ?? ''));
    const waits = decision ? Boolean(decision.payload?.policy?.waitForPlayer) : null;
    const guessed = prediction ? clip(prediction.expect, 4) : '还没放下';
    const chosen = decision ? (waits ? '等你回话' : clause(decision.said, 4)) : '还没定';
    const marks = learns.length ? `旧批注 ${learns.length} 条` : '旧批注 没落笔';
    // 一页账：预测过什么、当场怎么决定、旧批注压了几张、猜中过几次。
    // 竖屏放不下四行横字，就改成竖排三列（手稿本来就是竖着写的）；每列/每行
    // 都不超过八个字——字板高度锁死，多一个字画布就变宽，整页会撑得比纸还大。
    const rows = portrait
      ? [`预测${guessed.split(' ').at(-1)}`, `当场${chosen.split(' ').at(-1)}`, `旧批注${learns.length ? `${learns.length}条` : '没落笔'}`]
      : [`预测 ${guessed}`, `当场 ${chosen}`, marks, hit ? `猜中 ${hit[1]}` : '还没猜过'];
    // 旧批注有几条，纸上就压几张：厚度是看得见的历史，不是数字。
    const sheet = portrait ? [.78, .95] : [1.7, .95];
    for (let i = 0; i < Math.min(12, learns.length); i++) directorPaper.add(box(sheet[0], sheet[1], .012, MAT.paperDim, 0, -sheet[1] / 2, -i * .014));
    directorPaper.add(box(sheet[0] + .05, portrait ? 1.15 : 1.05, .03, MAT.paper, 0, portrait ? -.575 : -.525, .02));
    const ledger = textPlate(rows.join('\n'), { size: 64, color: '#352718', bg: 'rgba(0,0,0,0)', worldHeight: 1.0, maxWidth: 900, vertical: portrait });
    ledger.position.set(0, 0, .07); directorPaper.add(ledger);
    if (learns.length) directorPaper.add(box(portrait ? .62 : 1.79, .055, .05, MAT.bronze, 0, -.62, .06));
    // 落幕那几行（#ending）是 DOM，压在画面正中；这一帧得把手稿让开它。
    directorPaper.userData.ending = Boolean(frame?.ending);
    directorPaper.userData.source = { director, pages, notes, portrait };
  }
  function show(view, nextPerspective, isEnding, frame = null) {
    perspective = nextPerspective;
    ended = Boolean(isEnding);
    const id = view.act || view.scene || 'daliang';
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
    setExperience(frame ?? view);
    setTick(frame ?? view);

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
      // 竖屏比横屏窄一半，间距要收，不然最左那枚会被切在框外。
      const last = boardStand.children.length - 1;
      const spread = innerHeight > innerWidth ? 0.80 : 0.89;
      boardStand.children.forEach((g, i) => {
        g.position.set(i * spread, (last - i) * 0.34, 0);
      });
      laidOut = true;
    }
    // 竖屏的可视宽度只有 0.42×高度，横向偏移必须跟着收：wide 就是「半宽」
    // 的比例尺（横屏 1，竖屏 0.42）。纵向上竖屏更高，改用 (1-wide) 补偿。
    // 偏移量再除以深度：物件摆得越远，屏幕上偏得越少，位置才稳。
    const wide = Math.min(1, (innerWidth / Math.max(1, innerHeight)) / 1.7);
    const tall = 1 - wide;
    // 竖屏：三枚木牌排开一点，免得牌面互相压住；信拉近、放大、抬到字幕带以上，
    // 封泥才够得着（手指点下去要 ≥44px，也不能落在字幕底下）。
    const portrait = innerHeight > innerWidth;
    placeAt(banner, 15, 0, 3.78, 8);
    // 案头：第几拍的木牌挂在片名匾右下，导演的手稿摊在左下角——都贴着画面边，
    // 不压在人物或字幕带上（竖屏窄，偏移要按 wide 收）。
    // 手稿：横屏摊在人物左边的空台上，并且一律压在牌杆石座（y≈377）以下——
    // 杆子摆在 depth 7、纸摆在 9，杆子在纸前面，摊高了就会把「当场」两行挡掉。
    // 竖屏改竖排三列，放在侯嬴那块牌子底下、如姬左边的空处：那一格只有
    // 115×140px，按 0.6 缩下来正好（实测 rect≈[286,300,357,440]，四边都空着）。
    const endingNow = directorPaper.userData.ending === true;
    placeAt(directorPaper, portrait ? 8.8 : 9, portrait ? (endingNow ? 1.046 : 0.962) : -2.27 * wide,
      portrait ? (endingNow ? -2.37 : 0.394) : -0.35, 8);
    directorPaper.scale.setScalar(portrait ? 0.6 : 0.86);
    directorPaper.rotation.x = -0.5;
    if (portrait) {
      // 竖屏：牌架原来太高，最左那枚（信陵君）被切在画面外；香炉原来正挡在他身前，
      // 现在挪到左下角的台边、抬到字幕带以上。信封放到人物右边偏下——字幕带在 y≈600，
      // 什么东西压上去就看不见、也点不着。
      placeAt(boardStand, 7, -0.55, -0.28, 8);
      placeAt(incense.group, 9, -0.95, -1.5, 8);
      placeAt(letter.group, 9.5, 0.9, -0.6, 8);
      // 竖屏的拍号木牌：三枚人物牌占满上半屏（最右那块到 387px），木牌只剩
      // 左边一条 71px 宽的墙——缩到 0.95 挂在那儿，谁都不挡。
      // 落幕那两行链接铺满整幅宽（竖排 flex 会把 a 拉宽），左墙这一竖条正好被它压住，
      // 所以落幕这一帧把它缩到 0.55、挪到香炉右边那片空处；其余帧缩到 0.8 钉在左墙里。
      if (endingNow) { placeAt(tickHolder, 11, -0.075, -2.538, 8); tickHolder.scale.setScalar(0.55); }
      else { placeAt(tickHolder, 11, -1.199, 0.17, 8); tickHolder.scale.setScalar(0.8); }
      placeAt(slipHolder, 12, 3.4 * wide, 1.7, 8);
    } else {
      // 横屏：牌架原先正落在香炉后面，香炉也一并挪到画面最左边。
      placeAt(boardStand, 7, -2.4 * wide, -0.45, 8);
      placeAt(incense.group, 7, -4.2 * wide, 0.05, 8);
      placeAt(tickHolder, 11, 3.2 * wide, 1.7 - 0.35 * tall, 8);
      placeAt(letter.group, 12, 4.1 * wide, -1.15 - 0.3 * tall, 8);
      placeAt(slipHolder, 12, 4.1 * wide, 2.3 - 0.3 * tall, 8);
    }
    letter.group.scale.setScalar(portrait ? 1.35 : 1);
    // 信是平放的：立起来 75 度，封泥朝镜头，不然只能看见一条边。
    letter.group.rotation.x = 1.31;
    // 牌架朝着**镜头**摆，不朝场景里的锚点：锚点还在缓动的那一两秒里，
    // 整排牌子会跟着甩——一会儿挤成一团、一会儿甩到画面外。
    boardStand.lookAt(camera.position);
    boardStand.rotation.x = 0;
    boardStand.rotation.z = 0;
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
      // 转过去的那些牌只剩背面朝镜头（背面也刻着名字）。转到 -2.6 时背面偏 31°，
      // 名字还读得出来；再往 -2.0 转反而更侧、更薄，点到它的地方也更小。
      const target = on ? 0 : (hot ? -0.8 : -2.6);
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
      if (directorPaper.visible) {
        directorPaper.getWorldPosition(v).project(camera);
        out.paper = [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
      }
      if (tickSlip) {
        tickSlip.getWorldPosition(v).project(camera);
        out.tick = [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
      }
      return out;
    },
    /** 各件装置在屏幕上的矩形：只用来量「整块在不在画面里、够不够手指点」。 */
    rects(camera) {
      const out = { actors: actors.map(a => rectOf(a.group, camera)) };
      for (const [id, node] of boards) out['eye:' + id] = rectOf(node.door, camera);
      out.share = rectOf(letter.group, camera);
      out.incense = rectOf(incense.bowl, camera);
      if (directorPaper.visible) out.paper = rectOf(directorPaper, camera);
      if (tickSlip) out.tick = rectOf(tickSlip, camera);
      out.face = {};
      for (const [id, node] of boards) {
        out.face[id] = { text: rectOf(node.face, camera), plate: rectOf(node.door.children[0], camera) };
      }
      out.size = { boards: [...boards.keys()].map(id => boxInfo(boards.get(id).door, camera)), share: boxInfo(letter.group, camera), incense: boxInfo(incense.bowl, camera) };
      return out;
    },
    get sharePulse() { return sharePulse; },
    get view() { return { eye: eye.clone(), look: look.clone() }; },
  };
}

/* ── 小构件 ─────────────────────────────────────────────── */

/** 量出来的世界尺寸与离镜头的距离：屏幕上多大，先看这两个数。 */
function boxInfo(obj, camera) {
  const box = new THREE.Box3().setFromObject(obj);
  const s = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  return [+s.x.toFixed(2), +s.y.toFixed(2), +c.distanceTo(camera.position).toFixed(2)];
}

/** 一件装置在屏幕上的矩形（世界包围盒八个角投影后的外框）。 */
function rectOf(obj, camera) {
  const box = new THREE.Box3().setFromObject(obj);
  const v = new THREE.Vector3();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
    const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)];
}

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
  const bowl = cyl(0.3, 0.38, 0.6, MAT.bronze, 0, 0, 0, 16);
  group.add(bowl);
  group.add(cyl(0.13, 0.09, 0.14, MAT.bronzeLit, 0, 0.6, 0, 12));
  const stick = cyl(0.014, 0.016, 0.9, MAT.paperDim, 0, 0.74, 0, 8);
  const ember = sph(0.032, MAT.emberTip, 0, 1.64, 0, 8);
  const smoke = smokeColumn(0, 1.66, 0);
  group.add(stick, ember, smoke.group);
  return {
    group, bowl,
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
