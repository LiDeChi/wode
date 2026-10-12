// 科研台的场景与器具：算图、灯光、镜头、以及「摸得到」的拾取与拖拽。
// 镜头不做自由飞行：它微微绕着案子转，推近看清楚一件东西，再退回来。
import * as THREE from 'three';

const HALF_PI = Math.PI / 2;

export function createBench(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0a0e');
  scene.fog = new THREE.FogExp2(0x0b0a0e, 0.021);

  const camera = new THREE.PerspectiveCamera(40, 1, .1, 200);

  // 天光：夜里的青。主光：案上一盏暖灯，影子从这里拉出去。
  scene.add(new THREE.HemisphereLight(0x5c6f8f, 0x241a12, .75));
  const key = new THREE.DirectionalLight(0xffd0a0, 2.5);
  key.position.set(9, 17, 11);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -.0006;
  key.shadow.normalBias = .02;
  const sc = 16;
  Object.assign(key.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc, near: 2, far: 60 });
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6f86c8, .85);
  rim.position.set(-11, 9, -13);
  scene.add(rim);
  const lamp = new THREE.PointLight('#ffb573', 26, 22, 2);
  lamp.position.set(0, 6.4, 3.6);
  scene.add(lamp);

  // 镜头状态：位置用与帧率无关的指数平滑逼近「想去的地方」。
  const view = { yaw: -.08, pitch: .33, dist: 15.6, ty: 2.1, tz: 1.3, tx: 0 };
  const want = { ...view };
  const target = new THREE.Vector3();
  const look = new THREE.Vector3();
  let idle = 0, focused = null;

  function place(dt = 1) {
    const k = 1 - Math.exp(-dt * 2.6);
    for (const f of ['yaw', 'pitch', 'dist', 'tx', 'ty', 'tz']) view[f] += (want[f] - view[f]) * k;
    const h = Math.cos(view.pitch) * view.dist;
    camera.position.set(view.tx + Math.sin(view.yaw) * h, view.ty + Math.sin(view.pitch) * view.dist, view.tz + Math.cos(view.yaw) * h);
    target.set(view.tx, view.ty, view.tz);
    look.copy(target);
    camera.lookAt(target);
  }

  const registry = [];
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null, dragging = null, orbiting = false, moved = 0, lastX = 0, lastY = 0, pointerId = null;
  // 竖屏的一条窄缝里，机器只能往右让出一点：取景中心固定在 REST_TX_TALL，
  // 手指拖出来的位移记在 panX 上（不能直接加减 want.tx，restFrame 每帧都会重算，会越加越多）。
  const REST_TX_TALL = .15;
  let panX = 0;
  let emptyDrag = null, tall = false, restYaw = -.08;
  const tallWatchers = [];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // 凑近看一件东西的时候，镜头还能沿一个世界方向横拖——方向由看的人定：
  // 看铜钮那一排是沿 x 拖，从侧面看四张诉求牌是沿 z 拖。
  let panSpec = null, panOff = 0;
  const panWatchers = [];

  function register(object, name, handlers = {}) {
    const entry = { object, name, ...handlers };
    // pad: [宽, 高, 深] 在本物件上垫一层看不见的手感区——铜钮、陶罐这些实物本身太小，
    // 手指和远处的鼠标都不容易点中。垫层比物件本身略低一点，免得正好点在它的下沿上。
    if (entry.pad) {
      const [w, h, d, y] = entry.pad;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({ visible: false }));
      mesh.position.y = y ?? (h / 2 - .08);
      mesh.userData.pad = true;
      object.add(mesh);
      entry.padNode = mesh;
      entry.padSpec = entry.pad;
    }
    registry.push(entry);
    object.userData.pick = entry;
    return entry;
  }
  function unregister(object) {
    const i = registry.findIndex(e => e.object === object);
    if (i >= 0) registry.splice(i, 1);
  }

  function toNdc(event) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
    return ndc;
  }
  function hit(event) {
    ray.setFromCamera(toNdc(event), camera);
    const solid = registry.filter(e => e.object.visible && e.enabled !== false);
    const hits = ray.intersectObjects(solid.map(e => e.object), true);
    for (const h of hits) {
      let node = h.object;
      while (node && !node.userData.pick) node = node.parent;
      if (node?.userData.pick) {
        const entry = node.userData.pick;
        if (entry.enabled !== false) return entry;
      }
    }
    return null;
  }

  function onDown(event) {
    pointerId = event.pointerId;
    lastX = event.clientX; lastY = event.clientY; moved = 0;
    const entry = hit(event);
    if (entry?.onDrag) {
      dragging = entry;
      entry.onDragStart?.(event);
    } else if (emptyDrag) {
      dragging = { onDrag: (dx, dy, e) => emptyDrag.onDrag?.(dx, dy, e), onDragEnd: e => emptyDrag.onDragEnd?.(e) };
      dragging.onDrag(0, 0, event);
    } else orbiting = true;
    canvas.setPointerCapture?.(event.pointerId);
    idle = 0;
  }
  function onMove(event) {
    const dx = event.clientX - lastX, dy = event.clientY - lastY;
    lastX = event.clientX; lastY = event.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (dragging) { dragging.onDrag?.(dx, dy, event); return; }
    if (orbiting) {
      // 凑近看的时候沿一个世界方向横拖（看钮那一排是 x，侧面看四张牌是 z）。
      if (panSpec) {
        panOff = clamp(panOff - dx * .011, -panSpec.span, panSpec.span);
        want.tx = panSpec.x0 + panOff * panSpec.ax;
        want.tz = panSpec.z0 + panOff * panSpec.az;
        for (const fn of panWatchers) fn(panOff);
      } else if (tall) {
        panX = clamp(panX - dx * .014, -6.4, 6.4);
        want.tx = clamp(panX + REST_TX_TALL, -6.4, 6.4);
      } else want.yaw = clamp(want.yaw - dx * .0045, -.75, .75);
      want.pitch = clamp(want.pitch + dy * .0035, .06, .72);
      idle = 0;
      return;
    }
    const entry = hit(event);
    if (entry !== hovered) {
      hovered?.onHoverEnd?.();
      hovered = entry;
      hovered?.onHoverStart?.();
      canvas.style.cursor = hovered ? (hovered.cursor || 'pointer') : 'grab';
    }
  }
  function onUp(event) {
    if (dragging) { dragging.onDragEnd?.(event); dragging = null; }
    // 手没怎么动就松开，算「点了一下」：铜钮、闸杆这些自己也要能拖的物件同样适用。
    if (moved < 7) hit(event)?.onClick?.(event);
    orbiting = false;
    canvas.releasePointerCapture?.(pointerId);
    pointerId = null;
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    return { w, h, aspect: w / h };
  }

  /** 竖屏全景那套机位由外面算好交进来（stages.js 用 fitCover 求「整台机器刚好装下」）；
   *  没交就用这套默认值。桌面的数在下面写死，一字没动。 */
  const restPose = {};
  /** 竖屏：把机器转成侧前方四分之三视角、镜头推近——竖屏只有一条窄缝，正对着看，机器就只剩一小块。 */
  function restFrame() {
    const aspect = resize().aspect;
    const wasTall = tall;
    tall = aspect < .95;
    // 宽高比换了就通知一次：竖屏上案沿那几件得换个摆位（见 rig.setTallLayout）。
    if (tall !== wasTall) for (const fn of tallWatchers) fn(tall);
    if (focused) return;
    want.dist = tall ? (restPose.dist ?? 20.2) : 15.6;
    want.ty = tall ? (restPose.ty ?? 2.5) : 2.1;
    want.tx = tall ? clamp(panX + (restPose.tx ?? REST_TX_TALL), -6.4, 6.4) : 0;
    want.tz = tall ? (restPose.tz ?? 1.9) : 1.3;
    want.yaw = restYaw = tall ? (restPose.yaw ?? -.5) : -.08;
    want.pitch = tall ? (restPose.pitch ?? .34) : .33;
  }

  const updaters = [];
  let last = performance.now();
  function animate(now) {
    const dt = Math.min((now - last) / 1000, .05); last = now;
    for (const fn of updaters) fn(dt, now / 1000);
    idle += dt;
    if (idle > 7 && !dragging && !orbiting) want.yaw = restYaw + Math.sin(now / 2600) * .06;
    place(dt);
    key.position.set(view.tx + 9, 17, view.tz + 11);
    lamp.position.set(view.tx, 6.4, view.tz + 2.6);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  window.addEventListener('resize', restFrame);
  resize();
  restFrame();
  for (const f of Object.keys(want)) view[f] = want[f];
  place(1);
  requestAnimationFrame(animate);

  // 量屏幕占比用的临时相机（不动真镜头）：找「刚好装下」的距离时要试很多个机位。
  const probe = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  function projectCoverage(objects, cam) {
    const list = Array.isArray(objects) ? objects : [objects];
    const v = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, any = false;
    const take = (n, i) => {
      const bb = n.geometry.boundingBox || (n.geometry.computeBoundingBox(), n.geometry.boundingBox);
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      v.applyMatrix4(n.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
      if (v.z > -.1) return;        // 相机后面或贴到镜头上的点，投影出来会翻号，丢掉。
      v.applyMatrix4(cam.projectionMatrix);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      any = true;
    };
    const walk = o => {
      // 逐件量各自的 bbox 角，而不是整组的 union 角：整组的盒子会把近处那几只角算得极大，
      // 竖屏上量出来「机器占 222% 屏宽」就是这么来的（真值约 123%）。
      if (o.isMesh && o.geometry) { for (let i = 0; i < 8; i++) take(o, i); return; }
      for (const c of o.children) walk(c);
    };
    for (const o of list) if (o) { o.updateWorldMatrix(true, true); walk(o); }
    if (!any) return null;
    return {
      w: (maxX - minX) / 2, h: (maxY - minY) / 2,
      // cy 是「从上往下的整屏比例」，和 top/bottom 一套口径（NDC 的 y 是朝上的，这里要翻过来）。
      cx: (minX + maxX) / 4 + .5, cy: .5 - (minY + maxY) / 4,
      left: minX * .5 + .5, right: maxX * .5 + .5, top: .5 - maxY * .5, bottom: .5 - minY * .5,
    };
  }
  /** 一台相机会停在哪：place() 里那套算式，只不过可以传一个想试的机位。 */
  const eyeOf = pose => {
    const h = Math.cos(pose.pitch) * pose.dist;
    return new THREE.Vector3(
      pose.tx + Math.sin(pose.yaw) * h,
      pose.ty + Math.sin(pose.pitch) * pose.dist,
      pose.tz + Math.cos(pose.yaw) * h,
    );
  };

  return {
    scene, camera, renderer, register, unregister,
    addUpdater: fn => updaters.push(fn),
    resize, restFrame,
    /** 宽高比跨过竖屏那条线时叫一次（登记时先立刻叫一次，省得开局摆错）。 */
    onTallChange(fn) { tallWatchers.push(fn); fn(tall); },
    get tall() { return tall; },
    get hovered() { return hovered; },
    /** 空手拖：交给控件去用（比如「点中铜钮后上下拖」）。传 null 收回。 */
    setEmptyDrag(handlers) { emptyDrag = handlers; },
    /** 推近看一件东西：给世界坐标与距离、看向的高度。
     *  pan = {ax, az, span}：凑近看还能沿这个世界方向横拖多远（看四张牌是从侧面看，就沿 z 拖）。 */
    focus(point, { dist = null, ty = null, yaw = null, pitch = null, tz = null, pan = null } = {}) {
      focused = { zoom: 1 };
      want.tx = point.x; want.tz = tz ?? point.z;
      want.ty = ty ?? Math.max(1, point.y);
      want.dist = dist ?? (tall ? 13 : 7);
      want.yaw = yaw ?? (tall ? -.08 : want.yaw);
      want.pitch = pitch ?? .3;
      panSpec = pan ? { x0: want.tx, z0: want.tz, ax: pan.ax ?? 0, az: pan.az ?? 0, span: pan.span ?? 0 } : null;
      panOff = 0;
      for (const fn of panWatchers) fn(0);
      idle = -1e6;
    },
    release() { focused = null; panSpec = null; panOff = 0; restFrame(); idle = 0; },
    /** 竖屏全景那套机位：由 stages.js 用 fitCover 算出来后交给这里。 */
    setRest(pose) { Object.assign(restPose, pose || {}); if (!focused) restFrame(); },
    /** 现在这台镜头会停在哪（返回机关要按它算世界坐标）。 */
    get rest() { return { ...want }; },
    get panOff() { return panOff; },
    get panSpec() { return panSpec; },
    get focused() { return !!focused; },
    /** 凑近看时同一件实物被摆到别处、变小或变大，手感区也得跟着换。
     *  传 null 就恢复登记时那个大小（桌面那条路径一点没动）。 */
    setPad(name, size) {
      const e = registry.find(x => x.name === name);
      if (!e || !e.padNode) return false;
      const [w, h, d, y] = size || e.padSpec;
      e.padNode.geometry.dispose();
      e.padNode.geometry = new THREE.BoxGeometry(w, h, d);
      e.padNode.position.y = y ?? (h / 2 - .08);
      return true;
    },
    /** 一件实物（含手感区）在屏幕上的方框，自查判「有没有互相盖住」用。 */
    boxOf(name) {
      const e = registry.find(x => x.name === name);
      if (!e) return null;
      return this.coverage(e.padNode ?? e.object);
    },
    /** 暂时让一件实物「摸不到」：手机全景里陶罐那一排与铜钮挨得太近，
     *  与其让手指点到别的物件上，不如把这一排交给一块入口牌（走近了再点）。 */
    enable(name, on) {
      const e = registry.find(x => x.name === name);
      if (!e) return false;
      e.enabled = on !== false;
      return true;
    },
    /** 只让这几件能点（按名字前缀算），其余一律摸不到。凑近看一处时用：
     *  近看机位会把画面外的实物放大到盖住画面里那件，手指点上去就点到别处——
     *  那种「碰运气的拾取」比点不动更糟。传 null 全部放开（桌面那套）；
     *  「眼前的木牌」（stage:*）永远能点，不然进去就出不来。 */
    only(keep) {
      for (const e of registry) {
        if (e.name.startsWith('stage:')) continue;
        e.enabled = !keep || keep.some(n => e.name === n || e.name.startsWith(n));
      }
    },
    /** 一件被登记的物件此刻在屏幕上的位置——测试与无障碍提示都用它。
     *  垫了手感区的，就报手感区的中心：那才是「手指该往哪儿落」的地方。 */
    screenOf(name) {
      const entry = registry.find(e => e.name === name);
      if (!entry) return null;
      const p = new THREE.Vector3();
      (entry.padNode ?? entry.object).getWorldPosition(p);
      p.project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + (p.x * .5 + .5) * r.width, y: r.top + (-p.y * .5 + .5) * r.height, onScreen: p.z < 1 };
    },
    /** 自查用：每件实物的手感区在屏幕上占多大一块（按整屏比例），
     *  手机竖屏要求每一块都不小于 44×44 个 CSS 像素，量出来才算数。 */
    pads() {
      const shown = o => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };
    return registry.map(e => ({ name: e.name, shown: shown(e.object), hit: e.padNode ? this.coverage(e.padNode) : null }));
    },
    /** 屏幕上一件东西（或一组东西）占多宽多高，按整屏比例算。自查用：
     *  竖屏要求机器至少占满屏宽 90%、屏高 60%，就得量出来，不能凭眼睛说「够了」。 */
    coverage(objects) { return projectCoverage(objects, camera); },
    /** 一台想试的机位下，这些东西占屏幕多少（不动真镜头）。摆位与自查都用它。 */
    measure(objects, pose) {
      const p = { dist: 20, yaw: -.08, pitch: .33, ty: 2.1, tz: 1.3, tx: 0, ...(pose || {}) };
      probe.aspect = camera.aspect;
      probe.updateProjectionMatrix();
      probe.position.copy(eyeOf(p));
      probe.lookAt(p.tx, p.ty, p.tz);
      probe.updateMatrixWorld();
      return projectCoverage(objects, probe);
    },
    /** 找「这件东西刚好整件装进屏幕」的最近距离——二分，不靠眼睛猜。
     *  竖屏全景要一次看完整台机器，就靠这个。 */
    fitCover(objects, pose = {}, { maxW = .96, maxH = 1, margin = .025, min = 4, max = 90 } = {}) {
      const fits = d => {
        const c = this.measure(objects, { ...pose, dist: d });
        return !!c && c.w <= maxW && c.h <= maxH
          && c.left >= margin && c.right <= 1 - margin && c.top >= margin && c.bottom <= 1 - margin;
      };
      if (!fits(max)) return { dist: max, cov: this.measure(objects, { ...pose, dist: max }) };
      if (fits(min)) return { dist: min, cov: this.measure(objects, { ...pose, dist: min }) };
      let lo = min, hi = max;
      for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      return { dist: hi, cov: this.measure(objects, { ...pose, dist: hi }) };
    },
    /** 挂在镜头前的一块地方（返回机关、拖动提示这种「贴在眼前」的木牌）。
     *  sx/sy 是屏幕上的比例位置（0 是正中，-.6 是偏左下），toward 是离镜头多近（越小越贴脸、越大越远）。 */
    anchor(sx = 0, sy = 0, toward = .78) {
      const d = want.dist * toward;
      const eye = eyeOf(want);
      const fwd = new THREE.Vector3(want.tx, want.ty, want.tz).sub(eye).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      const halfH = d * Math.tan((camera.fov * Math.PI / 180) / 2), halfW = halfH * camera.aspect;
      return eye.addScaledVector(fwd, d).addScaledVector(right, sx * halfW).addScaledVector(up, sy * halfH);
    },
    /** 凑近看时镜头横拖到哪儿了（提示木牌靠它淡出）。 */
    onPan(fn) { panWatchers.push(fn); },
  };
}

export { HALF_PI };
