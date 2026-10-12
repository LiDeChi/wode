// 手机的两种观察距离。
// 竖屏只有一条窄缝，一台镜头不可能既让整台机器全进画面、又让铜钮和四张诉求牌的手感区都够大。
// 所以分成：wide = 整台机器的全景（距离是算出来的，不是猜的）；knobs / pots / ask = 从场景里
// 点一件实物凑近看。近看时相机能沿一个世界方向横拖，眼前挂一块「回全景」的木牌。
// 桌面（bench.tall 为假）不走这套：那里屏幕够宽，一切照旧。
import * as THREE from 'three';
import { makePlate } from './labels.js';

export function createStages(bench, rig, { figures, onStage } = {}) {
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
      pad: [width + .3, height + .34, .55, 0],
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
  };

  /** 换一种看法。stage 只在竖屏下离开 plain。 */
  function show(to) {
    if (!bench.tall) to = 'plain';
    stage = to;
    const close = to !== 'wide' && to !== 'plain';
    // 四张诉求牌：全景里收起来立一块入口牌，近看时摆成一排。
    figures?.setStage(to === 'ask' ? 'ask' : (bench.tall ? 'wide' : 'plain'));
    rig.setStage?.(to);
    bench.only?.(to === 'plain' ? null : KEEP[to]);
    applyPose(to);
    backTag.group.visible = close;
    if (close && !guided) { guideTag.group.visible = true; guideUntil = performance.now() + 6000; }
    if (!close) guideTag.group.visible = false;
    onStage?.(stage);
    return stage;
  }

  /** 从全景点进一处近看：进了就返回真（调用方据此决定要不要顺手做原来的事）。 */
  function entry(to) {
    if (!bench.tall || (stage !== 'wide' && stage !== 'plain')) return false;
    show(to);
    return true;
  }

  /** 回到全景（眼前木牌、入口牌都跟着换）。 */
  function back() {
    if (!bench.tall) return 'plain';
    return show('wide');
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
    if (!bench.tall) { backTag.group.visible = guideTag.group.visible = false; return; }
    if (guideTag.group.visible && performance.now() > guideUntil) { guideTag.group.visible = false; guided = true; }
    for (const t of [backTag, guideTag]) {
      if (!t.group.visible) continue;
      t.group.position.copy(bench.anchor(t.sx, t.sy, t.toward));
      t.group.lookAt(bench.camera.position);
      const lift = t.group.userData.lift ? .06 : 0;
      t.group.position.y += lift;
    }
  });

  show(bench.tall ? 'wide' : 'plain');

  return {
    show, back, entry, pose: applyPose,
    get stage() { return stage; },
    get close() { return stage !== 'wide' && stage !== 'plain'; },
    get tags() { return [backTag, guideTag]; },
    /** 竹简/推近取消以后：回到「当前这一处」而不是一路退回全景。 */
    release() { applyPose(stage === 'plain' && bench.tall ? 'wide' : stage); },
  };
}
