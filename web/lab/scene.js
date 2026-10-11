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
  let emptyDrag = null, tall = false;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
      if (tall) want.tx = clamp(want.tx - dx * .014, -6.4, 6.4);
      else want.yaw = clamp(want.yaw - dx * .0045, -.75, .75);
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

  /** 竖屏把镜头拉远、抬高，并且允许左右推移——否则一台机器塞不进一块竖屏。 */
  function restFrame() {
    const aspect = resize().aspect;
    tall = aspect < .95;
    if (focused) return;
    want.dist = tall ? 30 : 15.6;
    want.ty = tall ? 2.6 : 2.1;
    want.tx = tall ? clamp(want.tx, -6.4, 6.4) : 0;
    want.tz = tall ? 1.8 : 1.3;
    want.yaw = -.08;
    want.pitch = tall ? .3 : .33;
  }

  const updaters = [];
  let last = performance.now();
  function animate(now) {
    const dt = Math.min((now - last) / 1000, .05); last = now;
    for (const fn of updaters) fn(dt, now / 1000);
    idle += dt;
    if (idle > 7 && !dragging && !orbiting) want.yaw = -.08 + Math.sin(now / 2600) * .06;
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

  return {
    scene, camera, renderer, register, unregister,
    addUpdater: fn => updaters.push(fn),
    resize, restFrame,
    get tall() { return tall; },
    get hovered() { return hovered; },
    /** 空手拖：交给控件去用（比如「点中铜钮后上下拖」）。传 null 收回。 */
    setEmptyDrag(handlers) { emptyDrag = handlers; },
    /** 推近看一件东西：给世界坐标与距离、看向的高度。 */
    focus(point, { dist = null, ty = null, yaw = null, pitch = null, tz = null } = {}) {
      focused = { zoom: 1 };
      want.tx = point.x; want.tz = tz ?? point.z;
      want.ty = ty ?? Math.max(1, point.y);
      want.dist = dist ?? (tall ? 13 : 7);
      want.yaw = yaw ?? (tall ? -.08 : want.yaw);
      want.pitch = pitch ?? .3;
      idle = -1e6;
    },
    release() { focused = null; restFrame(); idle = 0; },
    get focused() { return !!focused; },
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
  };
}

export { HALF_PI };
