// 台边的五个人偶，一盏导师灯，一支令箭。
// 人偶是谁被试探过；灯亮起来就是导师在说话；令箭飞过去就是问到了谁。
import * as THREE from 'three';
import { makePlate } from './labels.js';

export const FIGURES = [
  { id: 'xinling', name: '信陵君', side: -1, z: -1.15, tint: '#6f86c8' },
  { id: 'houying', name: '侯嬴', side: -1, z: .2, tint: '#9d9068' },
  { id: 'ruji', name: '如姬', side: -1, z: 1.55, tint: '#c07a92' },
  { id: 'weiwang', name: '魏王', side: 1, z: -.85, tint: '#8f6f3f' },
  { id: 'jinbi', name: '晋鄙', side: 1, z: .45, tint: '#7c8189' },
];
export const FIGURE_BY_ID = Object.fromEntries(FIGURES.map(f => [f.id, f]));
const X = 4.05, SHELF_Y = .86;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,220,160,.95)');
  gr.addColorStop(.42, 'rgba(255,190,120,.32)');
  gr.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createFigures(bench, { onPick, onLamp } = {}) {
  const group = new THREE.Group();
  bench.scene.add(group);
  const glow = glowTexture();
  const cast = new Set();

  /* 左右两条窄案，人偶站在上面；右边这条往前多留一段给诉求木牌。 */
  const SHELVES = [
    { s: -1, len: 3.5, cz: .2, posts: [-1.45, 1.85] },
    { s: 1, len: 5.0, cz: .9, posts: [-1.5, 3.3] },
  ];
  for (const sh of SHELVES) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.0, .1, sh.len),
      new THREE.MeshStandardMaterial({ color: '#33261a', roughness: .93 }));
    shelf.position.set(sh.s * X, SHELF_Y, sh.cz);
    shelf.receiveShadow = true; shelf.castShadow = true;
    group.add(shelf);
    for (const z of sh.posts) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(.16, .82, .16),
        new THREE.MeshStandardMaterial({ color: '#241b13', roughness: .95 }));
      post.position.set(sh.s * X, SHELF_Y / 2, z);
      post.castShadow = true;
      group.add(post);
    }
  }

  const nodes = new Map();
  for (const f of FIGURES) {
    const g = new THREE.Group();
    g.position.set(f.side * X, SHELF_Y + .05, f.z);
    group.add(g);
    const wood = new THREE.MeshStandardMaterial({ color: '#3c2c1d', roughness: .9 });
    const cloth = new THREE.MeshStandardMaterial({ color: f.tint, roughness: .72, emissive: '#000000' });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.17, .21, .07, 16), wood);
    base.position.y = .035; base.castShadow = true; g.add(base);
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(.055, .16, .46, 16), cloth);
    robe.position.y = .3; robe.castShadow = true; g.add(robe);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.045, .24, .06), cloth);
      arm.position.set(sx * .1, .38, 0);
      arm.rotation.z = sx * .22;
      arm.castShadow = true; g.add(arm);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(.077, 16, 12), new THREE.MeshStandardMaterial({ color: '#c9a781', roughness: .8 }));
    head.position.y = .6; head.castShadow = true; g.add(head);
    if (f.side === 1) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(.17, .1, .06), wood);
      cap.position.y = .69; cap.castShadow = true; g.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(.02, .1, .17), wood);
      brim.position.set(-.09, .66, 0); g.add(brim);
    } else {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(.05, 12, 10), wood);
      bun.position.y = .68; g.add(bun);
    }
    const spot = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ map: glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(f.side * X, SHELF_Y + .07, f.z);
    group.add(spot);
    const name = makePlate({
      width: .86, height: .26, px: 512, py: 158, maxFont: 72, bg: null, border: null, ink: '#e8d6b2',
      at: [f.side * X, SHELF_Y + .03, f.z + .42], rotation: [-Math.PI / 2 + .1, 0, 0], text: f.name,
    });    group.add(name.mesh);

    const node = { ...f, label: f.name, group: g, cloth, spot, name, hover: 0, lit: 0, pulse: 0, react: null };
    nodes.set(f.id, node);
    bench.register(g, `figure:${f.id}`, {
      pad: bench.tall ? [.84, .82, .4, .62] : [.42, .55, .28, .58],
      onHoverStart: () => { node.hot = true; },
      onHoverEnd: () => { node.hot = false; },
      onClick: () => { if (onPick) onPick(node); },
    });
  }

  /* 导师的灯：一根细杆挑在左边人偶上方，灯下挂一块窄牌写他说的话。
     点灯＝让他换一句——牌上写的是他从账本里真说过的话（main.js 读账本给他）。 */
  const lamp = { pulse: 0, hot: false };
  {
    const lampG = new THREE.Group();
    group.add(lampG);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.05, .065, 3.4, 12),
      new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: .9 }));
    pole.position.set(-4.6, 1.7, .15);
    pole.castShadow = true; lampG.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.62, .07, .07),
      new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: .9 }));
    arm.position.set(-4.32, 3.38, .15); lampG.add(arm);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(.17, .3, .26, 18, 1, true),
      new THREE.MeshStandardMaterial({ color: '#8c6046', roughness: .7, side: THREE.DoubleSide }));
    shade.position.set(X * -1, 3.2, .15); shade.castShadow = true; lampG.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.105, 16, 12),
      new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ffb060', emissiveIntensity: 1.6, roughness: .4 }));
    bulb.position.set(X * -1, 3.1, .15); lampG.add(bulb);
    const light = new THREE.PointLight('#ffb060', 14, 9, 2);
    light.position.set(X * -1, 3.0, .15);
    lampG.add(light);
    const slip = makePlate({
      width: 1.05, height: 1.7, px: 480, py: 780, maxFont: 62, ink: '#f0dcb4',
      at: [X * -1, 2.16, .18], lines: ['导师还在想…'],
    });
    lampG.add(slip.mesh);
    // 手感区只罩灯罩与灯牌那一块（y 2.0 以上），别把人偶的地盘吃了。
    bench.register(lampG, 'lamp', {
      pad: [1.25, 1.75, .5, 2.72],
      onHoverStart: () => { lamp.hot = true; },
      onHoverEnd: () => { lamp.hot = false; },
      onClick: () => { if (onLamp) onLamp(); },
    });
    lamp.bulb = bulb; lamp.light = light; lamp.slip = slip; lamp.base = 14;
  }

  /* 令箭：从机器顶上飞向被问到的那个人偶。 */
  const arrow = { t: -1, curve: null, target: null, accepted: true };
  {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.022, .026, 1.3, 8),
      new THREE.MeshStandardMaterial({ color: '#d8c07a', roughness: .5, metalness: .2 }));
    shaft.rotation.x = Math.PI / 2;
    g.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(.06, .16, 10),
      new THREE.MeshStandardMaterial({ color: '#b6904f', metalness: .7, roughness: .35 }));
    head.rotation.x = Math.PI / 2;
    head.position.z = .72; g.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(.03, .12, .22),
      new THREE.MeshStandardMaterial({ color: '#c2603f', roughness: .8 }));
    tail.position.z = -.62; g.add(tail);
    g.visible = false;
    group.add(g);
    arrow.node = g;
  }

  bench.addUpdater((dt, clock) => {
    for (const node of nodes.values()) {
      const want = node.hot ? .08 : 0;
      node.hover += (want - node.hover) * (1 - Math.exp(-dt * 10));
      node.group.position.y = SHELF_Y + .05 + node.hover;
      node.pulse = Math.max(0, node.pulse - dt * 1.4);
      const lit = Math.max(node.lit ? (node.hot ? .55 : .4) : 0, node.pulse * .9);
      node.spot.material.opacity += (lit - node.spot.material.opacity) * (1 - Math.exp(-dt * 8));
      node.cloth.emissive.set(node.tint);
      node.cloth.emissiveIntensity = node.spot.material.opacity * .5;
      // 豆子从他面前过：点头（往前俯两下）或摇头（左右摆两下），底座的小灯跟着亮。
      if (node.react) {
        node.react.t += dt;
        const fade = Math.max(0, 1 - node.react.t / 1.15);
        if (node.react.accepted) {
          node.group.rotation.x = Math.sin(node.react.t * 13) * .13 * fade;
          node.group.rotation.z = 0;
        } else {
          node.group.rotation.z = Math.sin(node.react.t * 16) * .15 * fade;
          node.group.rotation.x = 0;
        }
        if (fade <= 0) { node.react = null; node.group.rotation.set(0, 0, 0); }
      }
    }
    lamp.pulse = Math.max(0, lamp.pulse - dt * .55);
    const glowAmt = .55 + Math.sin(clock * 1.7) * .07 + lamp.pulse * 1.6 + (lamp.hot ? .75 : 0);
    lamp.bulb.material.emissiveIntensity = glowAmt;
    lamp.light.intensity = lamp.base * (.85 + lamp.pulse * 1.4 + (lamp.hot ? .5 : 0)) + Math.sin(clock * 2.3) * .5;
    lamp.slip.mesh.scale.setScalar(lamp.hot ? 1.06 : 1);
    if (arrow.t >= 0) {
      arrow.t += dt / .62;
      if (arrow.t >= 1) {
        arrow.t = -1;
        arrow.node.visible = false;
        if (arrow.target) arrow.target.pulse = arrow.accepted ? 1.6 : .7;
      } else {
        const p = arrow.curve.getPointAt(Math.min(1, arrow.t));
        arrow.node.position.copy(p);
        const ahead = arrow.curve.getPointAt(Math.min(1, arrow.t + .02));
        arrow.node.lookAt(ahead);
        arrow.node.rotateZ(arrow.accepted ? .35 : Math.sin(arrow.t * 22) * .8);
      }
    }
  });

  return {
    group, nodes,
    /** 令箭飞向某人。accepted=false 时飞得歪一点。 */
    play(id, accepted = true) {
      const node = nodes.get(id);
      if (!node) return;
      arrow.target = node;
      arrow.accepted = accepted;
      arrow.t = 0;
      arrow.node.visible = true;
      arrow.curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-2.3, 4.3, .9),
        new THREE.Vector3(id === 'ruji' || id === 'xinling' || id === 'houying' ? -4.4 : 4.4, 3.1 + Math.random() * .4, -.2),
        new THREE.Vector3(node.side * X, SHELF_Y + 1.15, node.z + .1),
      ]);
    },
    /** 把某个人偶点亮成「这一轮他上过场」。 */
    mark(id, on = true) { const n = nodes.get(id); if (n) n.lit = on; },
    unmarkAll() { for (const n of nodes.values()) n.lit = false; },
    /** 豆子路过他时用了一种话：accepted=true 点头，false 摇头。 */
    react(id, accepted) {
      const n = nodes.get(id);
      if (!n) return;
      n.react = { t: 0, accepted: !!accepted };
      n.pulse = accepted ? 1.3 : .6;
    },
    /** 底座刻字：问过几次、点头几次（counts[id] = {asked, yes}）。 */
    setCounts(counts = {}) {
      for (const [id, n] of nodes) {
        const c = counts[id];
        n.countText = c && c.asked ? `问 ${c.asked} · 点头 ${c.yes}` : '';
        n.name.setText(c && c.asked ? [n.label, n.countText] : [n.label]);
      }
    },
    /** 导师说话：灯亮一段，牌子换成那句话。 */
    say(lines) { lamp.pulse = 1; lamp.slip.setText(lines); },
    markAsked(id) { cast.add(id); const n = nodes.get(id); if (n) n.pulse = 1.2; },
    get slip() { return lamp.slip; },
  };
}

/** 四块诉求木牌：点一块，就等于向五个人各讲一次同一种话。 */
export const APPEAL_TILES = [
  { appeal: '义', z: 1.4 },
  { appeal: '利', z: 2.1 },
  { appeal: '惧', z: 2.8 },
  { appeal: '恩', z: 3.35 },
];

export function createProbeTiles(bench, { onPick, onAsk } = {}) {
  const group = new THREE.Group();
  bench.scene.add(group);
  const nodes = new Map();
  const ORDER = FIGURES.map(f => f.id);
  // 架子上的原位（桌面一直是这样：四块沿视线方向错开一点，免得后一块压在前一块身上）。
  const restAt = i => new THREE.Vector3(X - i * (bench.tall ? .34 : .17), SHELF_Y + .05, APPEAL_TILES[i].z);
  // 手机近看的位置：一字排开、正对镜头——四块牌各自看得清，手感区也才排得开。
  const askAt = i => new THREE.Vector3(-1.28 + i * .86, SHELF_Y + .12, 2.55);

  for (const [i, def] of APPEAL_TILES.entries()) {
    const g = new THREE.Group();
    g.position.copy(restAt(i));
    group.add(g);
    const wood = new THREE.MeshStandardMaterial({ color: '#3c2c1d', roughness: .9 });
    const foot = new THREE.Mesh(new THREE.BoxGeometry(.44, .07, .38), wood);
    foot.position.y = .035; foot.castShadow = true; foot.receiveShadow = true; g.add(foot);
    const lean = new THREE.Group();
    lean.position.y = .07;
    g.add(lean);
    const body = new THREE.Mesh(new THREE.BoxGeometry(.42, .56, .06), wood);
    body.position.y = .28; body.castShadow = true; lean.add(body);
    const face = makePlate({
      width: .36, height: .48, px: 320, py: 426, maxFont: 150, bg: null, border: null, ink: '#f0dcb4',
      at: [0, .28, .035], text: def.appeal,
    });
    lean.add(face.mesh);
    const dots = [];
    for (let i = 0; i < ORDER.length; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(.032, 10, 8),
        new THREE.MeshStandardMaterial({ color: '#4a4038', emissive: '#000000', roughness: .6 }));
      d.position.set((i - 2) * .085, .1, .2);
      g.add(d);
      dots.push(d);
    }
    const node = { ...def, i, group: g, lean, dots, lit: 0, hover: 0, hot: false, at: restAt(i).clone() };
    nodes.set(def.appeal, node);
    bench.register(g, `appeal:${def.appeal}`, {
      pad: bench.tall ? [.62, .5, .32, .24] : [.46, .4, .24, .22],
      onHoverStart: () => { node.hot = true; },
      onHoverEnd: () => { node.hot = false; },
      onClick: () => { if (onPick) onPick(def.appeal); },
    });
  }

  // 手机全景里四块牌先让开，原处立一块「问四张牌」的木牌：手指够大，点一下才把四块摆开来。
  const entryG = new THREE.Group();
  entryG.position.set(X - .35, SHELF_Y + .05, 2.5);
  entryG.visible = false;
  group.add(entryG);
  {
    const wood = new THREE.MeshStandardMaterial({ color: '#3c2c1d', roughness: .9 });
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.2, .09, .5), wood);
    foot.position.y = .045; foot.castShadow = true; foot.receiveShadow = true; entryG.add(foot);
    const lean = new THREE.Group();
    lean.position.y = .09; lean.rotation.x = -.12;
    entryG.add(lean);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.16, .7, .07), wood);
    body.position.y = .35; body.castShadow = true; lean.add(body);
    const face = makePlate({
      width: 1.1, height: .62, px: 768, py: 434, maxFont: 76, bg: null, border: null, ink: '#f0dcb4',
      at: [0, .35, .04], lines: ['问四张牌', '凑近看谁点了头'],
    });
    lean.add(face.mesh);
    bench.register(entryG, 'ask:open', {
      pad: [1.5, 1.0, .62, .5],
      onHoverStart: () => { entryG.userData.lift = 1; },
      onHoverEnd: () => { entryG.userData.lift = 0; },
      onClick: () => onAsk?.(),
    });
  }

  bench.addUpdater((dt, clock) => {
    const k = 1 - Math.exp(-dt * 9);
    for (const node of nodes.values()) {
      node.hover += ((node.hot ? .05 : 0) - node.hover) * (1 - Math.exp(-dt * 10));
      node.lean.rotation.x = -.1 - node.hover * 1.1;
      node.group.position.x += (node.at.x - node.group.position.x) * k;
      node.group.position.z += (node.at.z - node.group.position.z) * k;
      node.group.position.y = node.at.y + node.hover * .06;
      const glow = node.hover * .5 + (node.hot ? Math.sin(clock * 5) * .08 : 0);
      node.dots.forEach((d, i) => {
        const on = node.lit > i;
        d.material.emissive.set(on ? '#ffc978' : '#000000');
        d.material.emissiveIntensity = on ? 1.2 + glow : 0;
        d.material.color.set(on ? '#e8c384' : '#4a4038');
      });
    }
  });

  const api = {
    group, nodes,
    entry: entryG,
    /** rows: [{id, accepted}]，按人偶的固定顺序点灯。 */
    set(appeal, rows) {
      const node = nodes.get(appeal);
      if (!node) return;
      node.accepted = ORDER.filter(id => rows.find(r => r.id === id)?.accepted);
      node.lit = node.accepted.length;
    },
    acceptedOf(appeal) { return nodes.get(appeal)?.accepted || []; },
    clear() { for (const n of nodes.values()) { n.lit = 0; n.accepted = []; } },
    /** 三种看法：plain（桌面/原样）、wide（手机全景：四块收起，立一块入口牌）、ask（手机近看：四块摆成一排）。 */
    setStage(stage = 'plain') {
      const ask = stage === 'ask';
      const folded = bench.tall && !ask;
      for (const node of nodes.values()) {
        node.group.visible = !folded;
        node.at.copy(bench.tall && ask ? askAt(node.i) : restAt(node.i));
        // 摆开来以后手感区换成排得开又不重叠的大小；其余情况交回登记时那个。
        bench.setPad(`appeal:${node.appeal}`, ask ? [.78, .62, .3, .22] : (bench.tall ? [.62, .5, .32, .24] : null));
      }
      entryG.visible = folded;
      api.stage = stage;
      return stage;
    },
    stage: 'plain',
    /** 近看四张牌时镜头对着哪儿（那一排的中间）。 */
    askPoint: () => new THREE.Vector3(0, SHELF_Y + .42, 2.55),
    /** 手机全景里那四块牌**不可见**、只有入口牌；自查要认这一点。 */
    get folded() { return bench.tall && api.stage !== 'ask'; },
  };
  return api;
}

