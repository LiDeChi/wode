// 手机的两种观察距离。
// 竖屏只有一条窄缝，一台镜头不可能既让整台机器全进画面、又让铜钮和四张诉求牌的手感区都够大。
// 所以分成：wide = 整台机器的全景（距离是算出来的，不是猜的）；knobs / pots / ask = 从场景里
// 点一件实物凑近看。近看时相机能沿一个世界方向横拖，眼前挂一块「回全景」的木牌。
// 桌面（bench.tall 为假）不走这套：那里屏幕够宽，一切照旧。
import * as THREE from 'three';
import { makePlate } from './labels.js';

export function createStages(bench, rig, { figures, onStage, life } = {}) {
  const tags = new THREE.Group();
  tags.name = '眼前的木牌';
  bench.scene.add(tags);

  let stage = 'plain';           // plain = 桌面那套（改动前就是这样）；tall 下是 wide / knobs / pots / ask
  let guided = false, guideUntil = 0;

  function makeTag(name, { width, height, lines, sx, sy, toward, onClick }) {
    const g = new THREE.Group();
    g.name = name;
    g.visible = false;
    tags.add(g);
    const wood = new THREE.MeshStandardMaterial({ color: '#33261a', roughness: .85 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + .16, height + .16, .07), wood);
    g.add(frame);
    const plate = makePlate({
      width, height, px: 768, py: Math.round(768 * height / width), maxFont: 78,
      at: [0, 0, .05], lines,
    });
    g.add(plate.mesh);
    bench.register(g, name, {
      // 手感区比牌面本身高一点：手机竖屏上牌面只有 42px 高，手指够不到。
      pad: [width + .3, height + .5, .55, 0],
      onHoverStart: () => { g.userData.lift = 1; },
      onHoverEnd: () => { g.userData.lift = 0; },
      onClick,
    });
    return { group: g, plate, sx, sy, toward, name };
  }

  const backTag = makeTag('stage:back', {
    width: 1.15, height: .44, sx: -.5, sy: -.44, toward: .7,
    lines: ['回全景'],
    onClick: () => back(),
  });
  const guideTag = makeTag('stage:guide', {
    width: 1.9, height: .4, sx: 0, sy: -.82, toward: .82,
    lines: ['左右拖动 · 看全这一排'],
    onClick: () => { guideTag.group.visible = false; },
  });
  /* 生活台在别处（机器左边那张矮案）。桌面上镜头本来照不到它，所以给一块挂牌：
     全景里写着「手摇生活台」，进去以后写着「回推演机」。 */
  const lifeTag = life ? makeTag('stage:life', {
    width: 1.6, height: .44, sx: .56, sy: -.34, toward: .74,
    lines: [life.label || '手摇生活台'],
    onClick: () => { show(stage === 'life' ? (bench.tall ? 'wide' : 'plain') : 'life'); },
  }) : null;

  /** 全景那台机位：把整台机器装进画面（二分求最近距离），斜角小一点，四层岔路才看得见。
   *  留的余量比「刚好」多一点：罐口木签、木牌这些还在慢慢翻面，量的时候和站定之后差几个点。 */
  function widePose() {
    const pose = { yaw: -.34, pitch: .29, ty: 2.35, tz: 1.5, tx: 0 };
    const fit = bench.fitCover(rig.machine, pose, { maxW: .94, margin: .03 });
    return { ...pose, dist: fit.dist };
  }

  /** 三个近看机位：看向哪件、多远、能不能横拖。 */
  const POSES = {
    knobs: () => ({
      target: rig.knobRowPoint(), dist: 10.5, yaw: -.2, pitch: .27, ty: .6, tz: 3.2,
      // 一排五只钮跨 6.8 个单位，镜头推近以后一屏只装得下三只：横拖的跨度要够把两头带进来
      // （往右拖看左边那只，往左拖看右边那只——拖的是场景）。
      pan: { ax: 1, az: 0, span: 4.2 },
    }),
    pots: () => ({
      target: rig.potPoint('before', 1), dist: 8.6, yaw: -.08, pitch: .3, ty: .55, tz: 1.5,
      pan: { ax: 1, az: 0, span: 3.0 },
    }),
    ask: () => ({
      target: figures.askPoint(), dist: 10.8, yaw: -.02, pitch: .28, ty: 1.3, tz: 2.55,
      pan: { ax: 1, az: 0, span: 1.2 },
    }),
    // 生活台不是「手机才有的问题」，桌面也能推近：它是旁边那张矮案。
    life: () => ({
      // 竖屏那条窄缝装不下整张案：站远一点，剩下的靠左右拖（一排控制件跨 5 个单位）。
      // 案上那条链子从案面一直挂到史简顶，取景要把它整条装进来：镜头比案面高一点、退到 8.4。
      target: life.at, dist: bench.tall ? 13.4 : 8.4, yaw: -.05, pitch: .24,
      ty: life.at.y + .85, tz: life.at.z + .3,
      pan: { ax: 1, az: 0, span: 3.0 },
    }),
  };

  function applyPose(to) {
    if (to === 'wide' || to === 'plain') { bench.setRest(widePose()); bench.release(); return; }
    const p = POSES[to]?.();
    if (!p) { bench.release(); return; }
    bench.focus(p.target, { dist: p.dist, yaw: p.yaw, pitch: p.pitch, ty: p.ty, tz: p.tz, pan: p.pan });
  }

  /** 每一处「能点谁」。近看机位会把画面外的实物放大到盖住画面里那件
   *  （近看铜钮时，身后的陶罐手感区就有半个屏幕大），所以每一处只放开这一处的实物；
   *  回全景再由 `wide` 那一行把机器上的都放开。桌面（plain）不受这套管，全部放开。 */
  const KEEP = {
    wide: ['knob:', 'token', 'reset', 'lever', 'bowl', 'seal', 'lamp', 'figure:', 'incense', 'scroll:seal', 'ask:open', 'pots:open'],
    knobs: ['knob:'],
    pots: ['pot:'],
    ask: ['appeal:', 'ask:open'],
    life: ['life:'],
  };

  /** 换一种看法。stage 只在竖屏下离开 plain；生活台是个例外——桌面上也去得了。 */
  function show(to) {
    // 生活台与「问一句」在桌面上也值得推近看（桌面上那四块牌挤在一起点不中）。
    if (!bench.tall && to !== 'life' && to !== 'ask') to = 'plain';
    stage = to;
    const close = to !== 'wide' && to !== 'plain';
    // 四张诉求牌：全景里收起来立一块入口牌，近看时摆成一排。
    figures?.setStage(to === 'ask' ? 'ask' : (bench.tall ? 'wide' : 'plain'));
    rig.setStage?.(to);
    bench.only?.(to === 'plain' || to === 'life' ? KEEP[to] ?? null : KEEP[to]);
    applyPose(to);
    backTag.group.visible = close && (bench.tall || to === 'ask');
    backTag.plate.setText([bench.tall ? '回全景' : '回机器']);
    // 桌面上那排诉求牌正落在屏幕中间：回程牌要是也挂中间，就压住「利」「惧」两块。
    backTag.sx = bench.tall ? -.3 : -.66;
    backTag.sy = bench.tall ? -.44 : -.7;
    if (lifeTag) {
      // 生活台里手机上已经有「回全景」那块牌；桌面上没有，就留这块当出口。
      lifeTag.group.visible = to === 'life' ? !bench.tall : !close;
      lifeTag.plate.setText([to === 'life' ? '回推演机' : (life.label || '手摇生活台')]);
    }
    if (close && !guided) { guideTag.group.visible = true; guideUntil = performance.now() + 6000; }
    if (!close) guideTag.group.visible = false;
    onStage?.(stage);
    return stage;
  }

  /** 从全景点进一处近看：进了就返回真（调用方据此决定要不要顺手做原来的事）。 */
  function entry(to) {
    if (stage !== 'wide' && stage !== 'plain') return false;
    show(to);
    return true;
  }

  /** 回到全景（眼前木牌、入口牌都跟着换）。 */
  function back() {
    if (!bench.tall && stage !== 'life') return show('plain');
    return show(bench.tall ? 'wide' : 'plain');
  }

  bench.onTallChange(() => {
    // 宽高比一变，全景的距离要重算；正在近看的话，把近看机位重新摆一遍。
    if (!bench.tall) { stage = 'plain'; show('plain'); return; }
    if (stage === 'plain') show('wide'); else applyPose(stage);
  });
  // 第一次拖动以后，那条「左右拖动」的提示就撤了。
  // 注意：摆近看机位时也会调一次 onPan（偏移归零），那不是「用户拖过」，得看偏移量。
  bench.onPan(off => {
    if (Math.abs(off) < .05) return;
    if (guideTag.group.visible) { guideTag.group.visible = false; guided = true; }
    else guided = true;
  });

  bench.addUpdater((dt, now) => {
    if (!bench.tall) { if (stage !== 'ask') backTag.group.visible = false; guideTag.group.visible = false; }
    else if (guideTag.group.visible && performance.now() > guideUntil) { guideTag.group.visible = false; guided = true; }
    // 挂在镜头前的东西每一帧都要重摆——桌面上也有（「问一句」那排牌的回程牌）。
    for (const t of [backTag, guideTag]) {
      if (!t.group.visible) continue;
      t.group.position.copy(bench.anchor(t.sx, t.sy, t.toward));
      t.group.lookAt(bench.camera.position);
      const lift = t.group.userData.lift ? .06 : 0;
      t.group.position.y += lift;
    }
    if (lifeTag?.group.visible) {
      lifeTag.group.position.copy(bench.anchor(lifeTag.sx, lifeTag.sy, lifeTag.toward));
      lifeTag.group.lookAt(bench.camera.position);
      lifeTag.group.position.y += lifeTag.group.userData.lift ? .06 : 0;
    }
  });

  show(bench.tall ? 'wide' : 'plain');

  return {
    show, back, entry, pose: applyPose,
    get stage() { return stage; },
    get close() { return stage !== 'wide' && stage !== 'plain'; },
    get tags() { return [backTag, guideTag, lifeTag].filter(Boolean); },
    /** 竹简/推近取消以后：回到「当前这一处」而不是一路退回全景。 */
    release() { applyPose(stage === 'plain' && bench.tall ? 'wide' : stage); },
  };
}
