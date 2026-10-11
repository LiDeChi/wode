// 装置页的共用地基：相机镜头、指点拾取、天光。
// 排片表和放映厅都站在这上面；这里只提供「怎么看」和「怎么动手」，不摆东西。
import * as THREE from 'three';
import { createRender } from '../game/render.js';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** 夜里的一层空气：天空色 + 一点雾，远的东西自己退到暗处。 */
export function night(scene, sky = '#0b1119', fog = 0.019) {
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.FogExp2(new THREE.Color(sky).getHex(), fog);
}

export function createScene(canvas) {
  const render = createRender(canvas);
  const scene = render.scene;
  const camera = render.camera;
  // createRender 的 resize() 是在相机还是 1:1 时跑的，这里补正一次长宽比。
  camera.aspect = Math.max(0.35, innerWidth / innerHeight);
  camera.fov = 44;
  camera.updateProjectionMatrix();
  addEventListener('resize', () => {
    camera.aspect = Math.max(0.35, innerWidth / innerHeight);
    camera.updateProjectionMatrix();
  });

  const nodes = [];
  const pickables = [];
  const raycaster = new THREE.Raycaster();

  // ── 镜头：一个目标点 + 一个机位。慢慢追过去，不甩。 ─────────
  const look = V3(0, 2.4, -1.2);
  const goalLook = look.clone();
  const eye = V3(0, 10, 22);
  const goalEye = eye.clone();
  const duration = { v: 0.9, t: 0.9 };
  let elapsed = duration.v;
  const fromEye = eye.clone();
  const fromLook = look.clone();
  const out = V3();

  function frameOn(target, shot) {
    const d = shot.dist;
    const elev = (shot.elev ?? 24) * Math.PI / 180;
    const az = (shot.az ?? 0) * Math.PI / 180;
    const flat = Math.cos(elev) * d;
    out.set(target.x + Math.sin(az) * flat, target.y + Math.sin(elev) * d, target.z + Math.cos(az) * flat);
    return out;
  }

  function shot(target, opts = {}) {
    goalLook.set(target.x, target.y, target.z);
    const computed = frameOn(goalLook, opts);
    goalEye.copy(computed);
    duration.t = opts.time ?? Math.max(0.55, goalEye.distanceTo(eye) * 0.075);
    fromEye.copy(eye);
    fromLook.copy(look);
    elapsed = 0;
  }

  const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function updateCamera(dt) {
    if (elapsed >= duration.t) {
      eye.copy(goalEye); look.copy(goalLook);
    } else if (!reduce()) {
      elapsed = Math.min(duration.t, elapsed + dt);
      const k = smooth(elapsed / duration.t);
      eye.copy(fromEye).lerp(goalEye, k);
      look.copy(fromLook).lerp(goalLook, k);
    } else {
      elapsed = duration.t; eye.copy(goalEye); look.copy(goalLook);
    }
    camera.position.copy(eye);
    camera.lookAt(look);
  }
  // 立刻摆好，不要开场从天上飞下来。
  shot(look.clone(), { dist: 24, elev: 25, time: 0 });

  return Object.assign(render, {
    scene, camera, nodes, pickables, raycaster,
    // 注意：render 自己也有 updateCamera(target, dt, facing)——先展开它，再用下面这个覆盖。
    shot,
    lookAt: look,
    updateCamera,
    get goalLook() { return goalLook; },

    /** 把一个物件挂进来。pos 是它在世界里的中心，用来推镜头。 */
    add(node) {
      nodes.push(node);
      node.group.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(node.group);
      const center = new THREE.Vector3();
      node.spin = node.spin ?? 0;
      node.home = node.home ?? node.group.position.clone();
      node.hover = 0;
      node.glow = node.glow ?? 0;
      node.center = node.explicit ?? (bbox.isEmpty() ? node.group.position.clone() : bbox.getCenter(center));
      node.radius = bbox.isEmpty() ? 0.5 : Math.max(0.35, bbox.getSize(new THREE.Vector3()).length() / 2);
      if (node.pickable !== false) {
        node.group.traverse(o => { if (o.isMesh) o.userData.node = node; });
        pickables.push(node);
      }
      return node;
    },
  });
}

/**
 * 指点：鼠标/手指落在哪件实物上，抬起哪件。
 * hover 只改状态，动画在装置的 update 里做；这里不碰画面。
 */
export function attachPointer(canvas, camera, pickables, handlers = {}) {
  const ray = new THREE.Raycaster();
  const pt = new THREE.Vector2();
  let current = null;
  let lastMove = 0;
  let currentAt = 0;

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pt.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pt.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(pt, camera);
    const hits = ray.intersectObjects(pickables.map(n => n.group), true);
    for (const hit of hits) {
      const node = hit.object.userData.node;
      if (node) return node;
    }
    return null;
  }

  function setHover(node) {
    if (current === node) return;
    if (current) handlers.onLeave?.(current);
    current = node;
    currentAt = performance.now();
    if (node) handlers.onHover?.(node);
    canvas.style.cursor = node ? 'pointer' : '';
  }

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    lastMove = performance.now();
    setHover(pick(e));
  });
  canvas.addEventListener('pointerleave', () => setHover(null));
  canvas.addEventListener('pointerdown', (e) => {
    // 镜头正往物件跟前推，指针下那一点可能刚好空了；刚悬停过的那件还算数。
    const hit = pick(e);
    const fresh = current && performance.now() - currentAt < 2500;
    const node = hit ?? (fresh ? current : null);
    if (window.__hub?.render) window.__hub.pickLog = { x: e.clientX, y: e.clientY, hit: hit?.id ?? null, used: node?.id ?? null };
    if (!node) { if (e.pointerType !== 'touch') setHover(null); return; }
    // 手指没有 hover：先让物件亮起来，再动手。
    if (e.pointerType === 'touch') setHover(node);
    handlers.onPick?.(node, e);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') handlers.onEscape?.();
  });

  return {
    get hovered() { return current; },
    clear() { setHover(null); },
    /** 最近移动过指针（移动端用来收掉提示）。 */
    get idle() { return performance.now() - lastMove; },
  };
}
