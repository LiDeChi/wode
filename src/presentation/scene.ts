import * as THREE from 'three';
import type { GranaryView, NightView, SceneCharacter, SceneKind, TheatreDiagnostics, TheatreOptions } from './contracts';
import { AssetKit, buildCharacter, buildEnvironment, makeSeal, makeVisionSector, PALETTE, seeded } from './models';
import type { CharacterModel, Environment } from './models';
import { COMPANION_START, EXIT, NIGHT_BOUNDS, PEBBLES, SEAL, SIGHT_RANGE, SIGHT_RANGE_LOW } from '../game/night';

interface Actor { character: SceneCharacter; model: CharacterModel; moving: boolean }
interface Guard { id: string; cone: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> }
interface Press { id: number; x: number; y: number; character: string | null; longFired: boolean; moved: boolean }

const sceneNames: Record<SceneKind, string> = {
  city: '邯郸 · 围城', court: '大梁 · 漆木厅堂', gate: '夷门 · 城门与桥',
  night: '取符之夜 · 宫廷庭院', camp: '邺 · 军营', granary: '围城 · 粮仓', studio: '片场 · 分镜桌',
};
// The placeholder the night scene shows before the first simulation tick; it mirrors
// NightGame.patrolAt(0, i) so the guards do not visibly jump on frame one.
const defaultGuards = [
  { x: .4, z: 0, angle: 0, alert: 0, state: 'patrol' as const },
  { x: 4.9, z: -1.2, angle: 0, alert: 0, state: 'patrol' as const },
];
const GUARD_CALM = new THREE.Color('#d8bd7b');
const GUARD_ALERTED = new THREE.Color('#e0a35c');
const GUARD_CAUGHT = new THREE.Color('#dc8c68');

export class Theatre {
  private readonly kit = new AssetKit();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-10, 10, 7, -7, .1, 100);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly projected = new THREE.Vector3();
  private readonly target = new THREE.Vector3(0, .8, -.3);
  private readonly desiredTarget = new THREE.Vector3(0, .8, -.3);
  private readonly key = new THREE.DirectionalLight('#ffddaf', 3);
  private readonly fill = new THREE.DirectionalLight('#b3d1cd', .9);
  private readonly hemisphere = new THREE.HemisphereLight('#d1e0df', '#5d493a', 1.8);
  private readonly actors = new Map<string, Actor>();
  private readonly dust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly originalPosition: string;
  private renderer: THREE.WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement;
  private fallback: HTMLDivElement | null = null;
  private observer: ResizeObserver | null = null;
  private environment: Environment | null = null;
  private seal: THREE.Group | null = null;
  private guards: Guard[] = [];
  private pulses: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private kind: SceneKind = 'city';
  private playerId = 'player';
  private paused = false;
  private disposed = false;
  private contextLost = false;
  private expanded = false;
  private focusedId: string | null = null;
  private night: NightView | null = null;
  private press: Press | null = null;
  private longTimer: ReturnType<typeof setTimeout> | null = null;
  private frameId = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private lastTime = 0;
  private time = 0;
  private frameCount = 0;
  private fpsElapsed = 0;
  private fps = 0;
  private zoom = 1;

  constructor(private readonly container: HTMLElement, private readonly options: TheatreOptions) {
    this.originalPosition = container.style.position;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'theatre-canvas';
    this.canvas.dataset.theatreOwned = 'true';
    this.canvas.setAttribute('aria-label', '可点选人物的战国立体戏台');
    this.canvas.setAttribute('role', 'img');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;';
    let context: WebGL2RenderingContext | null = null;
    try { context = this.canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' }); }
    catch (error) {
      if (!(error instanceof DOMException)) throw error;
    }
    if (context) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context, antialias: true, alpha: false });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      container.appendChild(this.canvas);
    } else {
      this.showFallback();
    }
    this.key.position.set(-6, 14, 9);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.left = this.key.shadow.camera.bottom = -10;
    this.key.shadow.camera.right = this.key.shadow.camera.top = 10;
    this.key.shadow.camera.near = .5; this.key.shadow.camera.far = 45;
    this.key.shadow.bias = -.0006; this.key.shadow.normalBias = .04;
    this.fill.position.set(5, 8, -6);
    this.scene.add(this.hemisphere, this.key, this.key.target, this.fill);
    this.scene.background = new THREE.Color(PALETTE.ink);
    this.scene.fog = new THREE.Fog(PALETTE.ink, 27, 56);
    const random = seeded(258), positions: number[] = [];
    for (let i = 0; i < 48; i++) positions.push((random() - .5) * 13, .3 + random() * 4.1, (random() - .5) * 9);
    const geometry = this.kit.geometry('theatre-dust', () => {
      const result = new THREE.BufferGeometry();
      result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      return result;
    });
    this.dust = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#d8bd7b', size: .035, transparent: true, opacity: .34, depthWrite: false }));
    this.dust.name = 'deterministic-atmosphere'; this.scene.add(this.dust);
    container.addEventListener('pointerdown', this.onPointerDown);
    container.addEventListener('pointermove', this.onPointerMove);
    container.addEventListener('pointerup', this.onPointerUp);
    container.addEventListener('pointercancel', this.onPointerCancel);
    container.addEventListener('lostpointercapture', this.onPointerCancel);
    container.addEventListener('keydown', this.onFallbackKey);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    if (typeof ResizeObserver !== 'undefined') { this.observer = new ResizeObserver(this.resize); this.observer.observe(container); }
    this.setScene('city', []);
    this.resize();
    this.frameId = requestAnimationFrame(this.frame);
  }

  setScene(kind: SceneKind, characters: SceneCharacter[], granary?: GranaryView): void {
    if (this.disposed) return;
    this.cancelPress();
    for (const actor of this.actors.values()) actor.model.dispose();
    this.actors.clear();
    for (const guard of this.guards) { this.scene.remove(guard.cone); guard.cone.material.dispose(); }
    this.guards = [];
    for (const pulse of this.pulses) { this.scene.remove(pulse); pulse.material.dispose(); }
    this.pulses = [];
    if (this.environment) { this.scene.remove(this.environment.root); this.environment.dispose(); }
    if (this.seal) this.scene.remove(this.seal);
    for (const child of [...this.scene.children]) if (child.userData.characterId) this.scene.remove(child);
    this.kind = kind; this.night = null; this.focusedId = null; this.expanded = false; this.zoom = 1;
    this.environment = buildEnvironment(kind, this.kit, granary); this.scene.add(this.environment.root);
    for (const character of characters) this.addActor(character);
    if (kind === 'night') {
      const player = characters.find(character => character.id === 'player')
        ?? characters.find(character => /player|ruji|如姬|玩家|门客/i.test(`${character.id} ${character.name} ${character.silhouette}`));
      this.playerId = player?.id ?? 'player';
      // The player is the retainer who escorts her, not 如姬 - she is a separate actor and takes
      // the tally herself, so the fallback must not be dressed as the woman it is escorting.
      if (!this.actors.has(this.playerId)) this.addActor({ id: this.playerId, name: '门客', color: PALETTE.jade, silhouette: 'scholar', x: -5, z: 3.8 });
      this.seal = makeSeal(this.kit); this.seal.position.set(SEAL.x, 0, SEAL.z); this.scene.add(this.seal);
      this.updateNight({
        x: -5, z: 3.8, guards: defaultGuards, exposure: 0, obtained: false, detected: false, hiding: false, finished: false,
        noise: 0, pebbles: PEBBLES, grab: 0, inReach: false, grabbing: false, crouching: false, sprinting: false, spotted: false, pulses: [],
        companionExposure: 0, handoff: 0, companionOut: false,
        companion: { x: COMPANION_START.x, z: COMPANION_START.z, carrying: false, taking: false }
      });
    } else this.seal = null;
    const moon = kind === 'night';
    this.key.color.set(moon ? '#b6d2ed' : '#ffdcac'); this.key.intensity = moon ? 2.25 : 3.0;
    this.fill.color.set(moon ? '#e0b47b' : '#adcac1'); this.fill.intensity = moon ? .74 : .85;
    this.hemisphere.color.set(moon ? '#92b2c9' : '#d1e0df'); this.hemisphere.intensity = moon ? 1.3 : 1.8;
    this.scene.background = new THREE.Color(moon ? '#112530' : PALETTE.ink);
    this.scene.fog = new THREE.Fog(moon ? '#112530' : PALETTE.ink, 27, 56);
    this.dust.material.color.set(moon ? '#aacacb' : PALETTE.gold);
    this.target.set(0, .8, -.3); this.desiredTarget.copy(this.target);
    this.configureCamera(true); this.populateFallback();
  }

  updateNight(view: NightView): void {
    if (this.kind !== 'night' || this.disposed) return;
    this.night = view;
    const player = this.actors.get(this.playerId);
    if (player) {
      const dx = view.x - player.model.root.position.x, dz = view.z - player.model.root.position.z;
      player.moving = Math.hypot(dx, dz) > .0001;
      if (player.moving) player.model.root.rotation.y = Math.atan2(dx, dz);
      player.model.root.position.set(view.x, .06, view.z);
      player.model.setOpacity(view.hiding ? .5 : 1);
      player.character.x = view.x; player.character.z = view.z;
      // Follow the player along x, clamped so neither end of the palace leaves the frame. z stays
      // put: the rooms are only 9m deep and the span already covers them, so tracking z would only
      // add drift to a camera that has nothing to gain from it.
      this.desiredTarget.set(Math.max(NIGHT_BOUNDS.xMin + 8, Math.min(NIGHT_BOUNDS.xMax - 8, view.x)), .8, -.3);
    }
    while (this.guards.length > view.guards.length) {
      const guard = this.guards.pop()!;
      this.scene.remove(guard.cone); guard.cone.material.dispose();
      const actor = this.actors.get(guard.id);
      if (actor) { this.scene.remove(actor.model.root); actor.model.dispose(); this.actors.delete(guard.id); }
    }
    while (this.guards.length < view.guards.length) {
      const index = this.guards.length, id = `guard-${index}`;
      if (!this.actors.has(id)) this.addActor({ id, name: '宫廷守卫', color: '#596777', silhouette: 'guard warrior', x: 0, z: 0 });
      const material = new THREE.MeshBasicMaterial({ color: '#e4bd72', transparent: true, opacity: .14, side: THREE.DoubleSide, depthWrite: false });
      const cone = new THREE.Mesh(makeVisionSector(this.kit), material); cone.name = `vision-${id}`; cone.renderOrder = 1;
      this.scene.add(cone); this.guards.push({ id, cone });
    }
    view.guards.forEach((position, index) => {
      const guard = this.guards[index], actor = this.actors.get(guard.id)!;
      actor.moving = Math.hypot(position.x - actor.model.root.position.x, position.z - actor.model.root.position.z) > .0001;
      actor.model.root.position.set(position.x, .06, position.z); actor.model.root.rotation.y = position.angle;
      actor.character.x = position.x; actor.character.z = position.z;
      guard.cone.position.set(position.x, 0, position.z); guard.cone.rotation.y = position.angle;
      // The cone is drawn at walking sight range, so crouching shrinks it by exactly the
      // ratio the simulation uses. What you see is what the guard can actually see.
      guard.cone.scale.setScalar(view.crouching ? SIGHT_RANGE_LOW / SIGHT_RANGE : 1);
      guard.cone.material.color.copy(GUARD_CALM)
        .lerp(GUARD_ALERTED, Math.min(1, position.alert * 1.4))
        .lerp(GUARD_CAUGHT, Math.max(0, position.alert - .6) / .4);
      guard.cone.material.opacity = (.105 + position.alert * .17) * (position.state === 'patrol' ? .8 : 1);
    });
    // A thrown pebble is only useful if you can see where it landed and when it goes
    // quiet, so each pulse keeps a ring on the floor that fades over its own lifetime.
    while (this.pulses.length > view.pulses.length) { const pulse = this.pulses.pop()!; this.scene.remove(pulse); pulse.material.dispose(); }
    while (this.pulses.length < view.pulses.length) {
      const material = new THREE.MeshBasicMaterial({ color: '#e8d8a6', transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(this.kit.geometry('noise-pulse', () => new THREE.RingGeometry(.34, .48, 30)), material);
      ring.rotation.x = -Math.PI / 2; ring.position.y = .03; ring.renderOrder = 2;
      this.scene.add(ring); this.pulses.push(ring);
    }
    view.pulses.forEach((pulse, index) => {
      const ring = this.pulses[index];
      ring.position.set(pulse.x, .03, pulse.z);
      ring.scale.setScalar(1 + (1 - pulse.life) * 1.6);
      ring.material.opacity = .52 * pulse.life;
    });
    // 如姬 moves on the simulation's word, like everyone else on this floor. She is the one who
    // walks up to the pedestal, and the seal rides with her afterwards, so the scene says who is
    // carrying the tally rather than leaving it to the HUD to explain.
    const ruji = this.actors.get('ruji');
    if (ruji) {
      const dx = view.companion.x - ruji.model.root.position.x, dz = view.companion.z - ruji.model.root.position.z;
      ruji.moving = Math.hypot(dx, dz) > .0001;
      if (ruji.moving) ruji.model.root.rotation.y = Math.atan2(dx, dz);
      ruji.model.root.position.set(view.companion.x, .06, view.companion.z);
      ruji.character.x = view.companion.x; ruji.character.z = view.companion.z;
    }
    if (this.seal) {
      // The halo swells as the hand closes on it, so "I can take this now" is visible in
      // the scene and not only in the button row.
      this.seal.scale.setScalar(1 + view.grab * .22);
      // On its pedestal until it is taken, then carried at her hip to the gate.
      if (view.obtained) this.seal.position.set(view.companion.x, .9, view.companion.z);
      else this.seal.position.set(SEAL.x, 0, SEAL.z);
    }
    if (this.fallback) this.positionFallback();
  }

  setPaused(paused: boolean): void { this.paused = paused; this.lastTime = 0; }

  focusCharacter(id: string): void {
    if (this.disposed) return;
    this.focusedId = this.actors.has(id) ? id : null;
    for (const [actorId, actor] of this.actors) actor.model.setFocused(actorId === this.focusedId);
    this.configureCamera(false);
  }

  pullBack(enabled: boolean): void { this.expanded = enabled; this.configureCamera(false); }

  getScreenPosition(id: string): { x: number; y: number } | null {
    const actor = this.actors.get(id);
    if (actor) {
      this.projected.copy(actor.model.root.position); this.projected.y += actor.model.headHeight;
    } else if (this.kind === 'night' && (id === 'seal' || id === 'exit')) {
      // Read from the simulation's own constants. This projection feeds the no-WebGL fallback's
      // DOM label, and it kept a copy of the tally's old courtyard address after the mesh itself
      // was moved - so in the fallback the 兵符 marker floated over a table the tally no longer
      // stands on, 22.6m west of the plinth.
      this.projected.set(id === 'seal' ? SEAL.x : EXIT.x, id === 'seal' ? 1.0 : .05, id === 'seal' ? SEAL.z : EXIT.z);
    } else return null;
    this.camera.updateMatrixWorld(); this.projected.project(this.camera);
    return { x: (this.projected.x + 1) / 2 * this.width, y: (1 - this.projected.y) / 2 * this.height };
  }

  getDiagnostics(): TheatreDiagnostics {
    const camera = { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
    const aim = { x: this.desiredTarget.x, y: this.desiredTarget.y, z: this.desiredTarget.z };
    if (!this.renderer || this.contextLost) return { calls: 0, triangles: 0, geometries: 0, textures: 0, fps: 0, dpr: this.dpr, camera, aim };
    const { render, memory } = this.renderer.info;
    return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, fps: this.fps, dpr: this.dpr, camera, aim };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frameId); this.cancelPress();
    this.observer?.disconnect();
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerup', this.onPointerUp);
    this.container.removeEventListener('pointercancel', this.onPointerCancel);
    this.container.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.container.removeEventListener('keydown', this.onFallbackKey);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    for (const actor of this.actors.values()) actor.model.dispose();
    for (const guard of this.guards) guard.cone.material.dispose();
    this.environment?.dispose(); this.dust.material.dispose(); this.key.shadow.dispose(); this.kit.dispose();
    this.scene.clear(); this.actors.clear();
    this.renderer?.setAnimationLoop(null); this.renderer?.dispose(); this.renderer?.forceContextLoss();
    this.canvas.remove(); this.fallback?.remove();
    this.container.style.position = this.originalPosition;
  }

  private addActor(character: SceneCharacter): void {
    const stored = { ...character }, model = buildCharacter(stored, this.kit);
    model.root.rotation.y = .28;
    const previous = this.actors.get(stored.id);
    if (previous) { this.scene.remove(previous.model.root); previous.model.dispose(); }
    this.scene.add(model.root); this.actors.set(stored.id, { character: stored, model, moving: false });
  }

  private resize = (): void => {
    if (this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.width < 720 ? 1.5 : 2);
    this.renderer?.setPixelRatio(this.dpr); this.renderer?.setSize(this.width, this.height, false);
    this.configureCamera(true); this.positionFallback();
  };

  private configureCamera(immediate: boolean): void {
    const aspect = this.width / this.height, portrait = window.innerWidth <= 700 || aspect < .95;
    const focus = !this.expanded && this.kind !== 'night' && this.focusedId ? this.actors.get(this.focusedId) : null;
    // Every other scene re-derives its target here, once per frame, from scratch. The night act is
    // the exception, and getting that wrong is what made the picture shake. Its target is written by
    // updateNight, which runs from onChange at the end of NightGame.step() - up to 30 times a
    // second, and NOT on any frame where the 1/30s accumulator has not yet filled. configureCamera
    // runs on every frame. So a default written here is still there when the next frame's lerp reads
    // it: on every non-stepping frame the camera is pulled back toward the court (x=0) instead of
    // toward the player. Followed out to x=22 that is a 1.4m swing of the whole frame, thirty times
    // a second, and the same root makes the camera drift home whenever the simulation is paused or
    // finished and updateNight stops being called at all. Leave the night target alone - the
    // ownership the old comment claimed is what this branch makes true.
    if (this.kind !== 'night') {
      this.desiredTarget.set(0, .8, -.3);
      if (focus) this.desiredTarget.set(focus.model.root.position.x * .62, 1.0, focus.model.root.position.z * .45);
    }
    if (immediate) this.target.copy(this.desiredTarget);
    const spanWidth = this.kind === 'night' ? 16.1 : portrait ? 12.2 : 17.2;
    const spanHeight = Math.max(this.kind === 'night' ? 12.0 : 11.6, spanWidth / aspect);
    this.camera.left = -spanHeight * aspect / 2; this.camera.right = spanHeight * aspect / 2;
    this.camera.top = spanHeight / 2; this.camera.bottom = -spanHeight / 2;
    if (immediate) this.zoom = this.expanded ? .78 : focus ? 1.16 : 1;
    this.camera.zoom = this.zoom;
    this.camera.position.copy(this.target).add(new THREE.Vector3(portrait ? 3.6 : 11.2, this.expanded ? 20 : 13.2, portrait ? 22 : 18));
    this.camera.lookAt(this.target); this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(this.frame);
    const elapsed = this.lastTime ? Math.max(0, (now - this.lastTime) / 1000) : 0;
    const delta = Math.min(elapsed, .05); this.lastTime = now;
    if (!this.paused) {
      this.time += delta;
      this.options.onTick?.(Math.min(elapsed, .5));
      if (this.disposed) return;
      for (const actor of this.actors.values()) actor.model.animate(this.reducedMotion ? 0 : this.time, delta, !this.reducedMotion && actor.moving, actor.character.mood);
      if (!this.reducedMotion) {
        this.dust.position.y = Math.sin(this.time * .17) * .10;
        for (const practical of this.environment?.practicals ?? []) {
          const shimmer = 1 + Math.sin(this.time * 3.4 + practical.phase) * .045;
          practical.sprite.scale.setScalar(practical.baseScale * shimmer);
        }
        if (this.seal) {
          this.seal.rotation.y = Math.sin(this.time * .7) * .11;
          const token = this.seal.getObjectByName('seal-body'); if (token) token.position.y = .81 + Math.sin(this.time * 1.7) * .055;
        }
      }
    }
    this.target.lerp(this.desiredTarget, this.reducedMotion ? 1 : 1 - Math.exp(-delta * 4));
    const focus = !this.expanded && this.kind !== 'night' && this.focusedId !== null;
    this.zoom = THREE.MathUtils.lerp(this.zoom, this.expanded ? .78 : focus ? 1.16 : 1, this.reducedMotion ? 1 : 1 - Math.exp(-delta * 4));
    this.configureCamera(false);
    if (this.renderer && !this.contextLost) this.renderer.render(this.scene, this.camera);
    else this.positionFallback();
    this.frameCount++; this.fpsElapsed += elapsed;
    if (this.fpsElapsed >= .5) { this.fps = Math.round(this.frameCount / this.fpsElapsed); this.frameCount = 0; this.fpsElapsed = 0; }
  };

  private ownedTarget(event: Event): HTMLElement | null {
    return event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-theatre-owned]') : null;
  }

  private pointRay(x: number, y: number): void {
    const rect = this.container.getBoundingClientRect();
    this.pointer.set((x - rect.left) / this.width * 2 - 1, -(y - rect.top) / this.height * 2 + 1);
    this.camera.updateMatrixWorld(); this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pickCharacter(event: PointerEvent): string | null {
    if (event.target instanceof HTMLElement) {
      const fallbackActor = event.target.closest<HTMLElement>('[data-character-id]');
      if (fallbackActor && this.fallback?.contains(fallbackActor)) return fallbackActor.dataset.characterId ?? null;
    }
    this.pointRay(event.clientX, event.clientY);
    const hits = this.raycaster.intersectObjects([...this.actors.values()].map(actor => actor.model.root), true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (typeof object.userData.characterId === 'string') return object.userData.characterId;
        object = object.parent;
      }
    }
    const rect = this.container.getBoundingClientRect();
    let nearest: string | null = null, distance = event.pointerType === 'touch' ? 33 : 21;
    for (const [id, actor] of this.actors) {
      const head = this.getScreenPosition(id); if (!head) continue;
      this.projected.copy(actor.model.root.position).project(this.camera);
      const feetY = (1 - this.projected.y) / 2 * this.height;
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      if (y < head.y - 8 || y > feetY + 8) continue;
      const diff = Math.abs(head.x - x);
      if (diff < distance) { nearest = id; distance = diff; }
    }
    return nearest;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.ownedTarget(event) || this.press || event.button !== 0) return;
    event.preventDefault();
    const character = this.pickCharacter(event);
    this.press = { id: event.pointerId, x: event.clientX, y: event.clientY, character, longFired: false, moved: false };
    const target = this.contextLost || !this.renderer ? this.fallback : this.canvas;
    target?.setPointerCapture(event.pointerId);
    if (character) this.longTimer = setTimeout(() => {
      if (!this.press || this.press.moved) return;
      this.press.longFired = true; this.focusCharacter(character); this.options.onCharacterClick(character);
    }, 500);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.press && this.press.id === event.pointerId) {
      if (Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > 9) {
        this.press.moved = true; if (this.longTimer) clearTimeout(this.longTimer); this.longTimer = null;
      }
    } else if (this.ownedTarget(event) && event.pointerType === 'mouse') this.canvas.style.cursor = this.pickCharacter(event) ? 'pointer' : this.kind === 'night' ? 'crosshair' : 'default';
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.press || this.press.id !== event.pointerId) return;
    const press = this.press; this.cancelPress();
    if (press.longFired || press.moved) return;
    if (press.character) { this.options.onCharacterClick(press.character); return; }
    this.pointRay(event.clientX, event.clientY);
    const point = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
    // Gated on the simulation's bounds, not on a copy of them. This test used to be the old
    // single-room court, |x| <= 7, which silently discarded every ground tap east of x=7 - the
    // whole of the King's hall, where the tally and three of the five guards now are. The HUD
    // advertises 也可以点地面, and go() clamps to these same bounds anyway, so the renderer's
    // stricter copy was not protecting anything; it was just refusing the click.
    if (point && point.x >= NIGHT_BOUNDS.xMin && point.x <= NIGHT_BOUNDS.xMax && Math.abs(point.z) <= NIGHT_BOUNDS.zMax) this.options.onGroundClick(point.x, point.z);
  };

  private onPointerCancel = (): void => { this.cancelPress(); };
  private cancelPress(): void { if (this.longTimer) clearTimeout(this.longTimer); this.longTimer = null; this.press = null; }
  private onVisibilityChange = (): void => { this.lastTime = 0; };
  private onFallbackKey = (event: KeyboardEvent): void => {
    if (!this.fallback || (event.key !== 'Enter' && event.key !== ' ')) return;
    const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-character-id]') : null;
    if (element && this.fallback.contains(element) && element.dataset.characterId) { event.preventDefault(); this.options.onCharacterClick(element.dataset.characterId); }
  };

  private onContextLost = (event: Event): void => { event.preventDefault(); this.contextLost = true; this.canvas.style.display = 'none'; this.showFallback(); this.populateFallback(); };
  private onContextRestored = (): void => { if (this.disposed) return; this.contextLost = false; this.canvas.style.display = 'block'; this.fallback?.remove(); this.fallback = null; this.resize(); };

  private showFallback(): void {
    if (this.fallback) return;
    const fallback = document.createElement('div'); fallback.className = 'theatre-fallback'; fallback.dataset.theatreOwned = 'true';
    fallback.style.cssText = 'position:absolute;inset:0;overflow:hidden;touch-action:none;background:radial-gradient(ellipse at 50% 28%,#536764 0%,#233c43 55%,#142b35 100%);color:#f1eada;font-family:serif;';
    const wall = document.createElement('div');
    wall.style.cssText = 'position:absolute;left:8%;right:8%;top:22%;height:23%;background:repeating-linear-gradient(0deg,transparent 0 22px,#88776188 23px 24px),#ac987b;border-top:12px solid #443934;clip-path:polygon(0 0,100% 0,100% 90%,0 100%);';
    const floor = document.createElement('div');
    floor.style.cssText = 'position:absolute;left:-20%;right:-20%;top:43%;height:70%;background:repeating-linear-gradient(0deg,transparent 0 39px,#749f9122 40px 41px),repeating-linear-gradient(90deg,transparent 0 79px,#749f9122 80px 81px),#736553;transform:perspective(400px) rotateX(34deg);';
    const notice = document.createElement('p'); notice.dataset.fallbackNotice = 'true';
    notice.style.cssText = 'position:absolute;left:22px;right:22px;bottom:12px;margin:0;font:12px/1.7 sans-serif;color:#e6dcc5;';
    notice.textContent = '三维画面暂不可用 · 人物与剧情入口仍可点击';
    fallback.append(wall, floor, notice); this.container.appendChild(fallback); this.fallback = fallback;
  }

  private populateFallback(): void {
    if (!this.fallback) return;
    for (const element of this.fallback.querySelectorAll('[data-character-id], [data-fallback-title], [data-fallback-object]')) element.remove();
    const title = document.createElement('p'); title.dataset.fallbackTitle = 'true'; title.textContent = sceneNames[this.kind];
    title.style.cssText = 'position:absolute;left:22px;top:18px;margin:0;letter-spacing:.2em;font-size:17px;color:#d8bd7b;'; this.fallback.appendChild(title);
    for (const [id, actor] of this.actors) {
      const button = document.createElement('button'); button.dataset.characterId = id;
      button.setAttribute('aria-label', `查看${actor.character.name}的心思`);
      button.style.cssText = 'position:absolute;transform:translate(-50%,-10%);width:54px;height:91px;padding:0;border:0;background:transparent;color:#f1eada;cursor:pointer;';
      const head = document.createElement('span'); head.style.cssText = 'position:absolute;left:19px;top:0;width:17px;height:21px;border-radius:40% 40% 45% 45%;background:#d5b495;border-top:6px solid #142b35;';
      const robe = document.createElement('span'); robe.style.cssText = `position:absolute;left:8px;top:23px;width:38px;height:43px;background:${/^#[\da-f]{3,8}$/i.test(actor.character.color) ? actor.character.color : PALETTE.jade};clip-path:polygon(25% 0,75% 0,100% 100%,0 100%);border-bottom:3px solid #d8bd7b;`;
      const name = document.createElement('span'); name.textContent = actor.character.name; name.style.cssText = 'position:absolute;top:71px;left:-18px;right:-18px;font:12px/1.4 serif;text-align:center;text-shadow:0 1px 4px #142b35;';
      button.append(head, robe, name); this.fallback.appendChild(button);
    }
    if (this.kind === 'night') for (const [id, label] of [['seal', '兵符'], ['exit', '出口']]) {
      const element = document.createElement('span'); element.dataset.fallbackObject = id; element.textContent = label;
      element.style.cssText = 'position:absolute;transform:translate(-50%,-50%);padding:5px 8px;border:1px solid #d8bd7b;background:#142b35cc;font:12px/1.4 serif;color:#d8bd7b;';
      this.fallback.appendChild(element);
    }
    this.positionFallback();
  }

  private positionFallback(): void {
    if (!this.fallback) return;
    for (const button of this.fallback.querySelectorAll<HTMLElement>('[data-character-id]')) {
      const position = this.getScreenPosition(button.dataset.characterId!);
      if (!position) continue;
      button.style.left = `${position.x}px`; button.style.top = `${position.y}px`;
      button.style.opacity = button.dataset.characterId === this.playerId && this.night?.hiding ? '.5' : '1';
    }
    for (const object of this.fallback.querySelectorAll<HTMLElement>('[data-fallback-object]')) {
      const id = object.dataset.fallbackObject!, position = this.getScreenPosition(id);
      if (position) { object.style.left = `${position.x}px`; object.style.top = `${position.y}px`; }
      object.style.display = id === 'seal' && this.night?.obtained ? 'none' : 'block';
    }
  }
}
