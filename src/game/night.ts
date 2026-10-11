import type { NightView } from '../presentation/contracts';
import type { NightStep } from '../core/types';

export const COVER = [
  { x: -1.3, z: -0.5, w: 1.5, d: 4.6 },
  { x: 3, z: 1.8, w: 2.6, d: 1.2 },
  { x: -4, z: -2, w: 2, d: 1.2 },
  { x: 2, z: -3.5, w: 2, d: 1.1 }
];
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export class NightGame {
  view: NightView = { x: -5, z: 3.8, guards: [], exposure: 0, obtained: false, detected: false, hiding: false, finished: false };
  elapsed = 0;
  paused = false;
  crouching = false;
  private keys = new Set<string>();
  private target: { x: number; z: number } | null = null;
  private accumulator = 0;
  private recording: NightStep[] = [];
  constructor(private onFinish: (view: NightView) => void, private onChange: (view: NightView) => void) { this.updateGuards(); }
  key(key: string, down: boolean) { const normalized = key.toLowerCase(); if (down) this.keys.add(normalized); else this.keys.delete(normalized); }
  clearInput() { this.keys.clear(); this.target = null; }
  go(x: number, z: number) { this.target = { x: clamp(x, -6.6, 6.6), z: clamp(z, -4.6, 4.6) }; }
  private blocked(x: number, z: number) { return COVER.some(r => Math.abs(x - r.x) < r.w / 2 + 0.19 && Math.abs(z - r.z) < r.d / 2 + 0.19); }
  private occluded(x: number, z: number, gx: number, gz: number) {
    const distance = Math.hypot(x - gx, z - gz);
    for (let t = 0.1; t < distance; t += 0.15) if (this.blocked(gx + (x - gx) * t / distance, gz + (z - gz) * t / distance)) return true;
    return false;
  }
  private updateGuards() {
    const t = this.elapsed;
    this.view.guards = [{ x: 0.4, z: 1.7 + Math.sin(t * 0.35) * 1.1, angle: Math.PI / 2 + Math.sin(t * 0.32) * 1.1 }, { x: 4.8 + Math.sin(t * 0.25) * 0.7, z: -0.9, angle: Math.PI + Math.sin(t * 0.32) * 1.2 }];
  }
  frames(): NightStep[] { return structuredClone(this.recording); }
  restore(frames: NightStep[]) { for (const frame of frames) for (let t = 0; t < frame.ticks; t++) this.step(frame); }
  tick(delta: number) {
    if (this.paused || this.view.finished) return;
    this.accumulator += Math.max(0, Math.min(delta, 0.5));
    while (this.accumulator >= 1 / 30 && !this.view.finished) { this.accumulator -= 1 / 30; this.step(); }
  }
  private step(recorded?: NightStep) {
    if (this.view.finished) return;
    const dt = 1 / 30;
    this.elapsed += dt;
    this.updateGuards();
    let dx = Number(this.keys.has('arrowright') || this.keys.has('d')) - Number(this.keys.has('arrowleft') || this.keys.has('a'));
    let dz = Number(this.keys.has('arrowdown') || this.keys.has('s')) - Number(this.keys.has('arrowup') || this.keys.has('w'));
    if (dx || dz) this.target = null;
    else if (this.target) {
      dx = this.target.x - this.view.x; dz = this.target.z - this.view.z;
      if (Math.hypot(dx, dz) < 0.15) { this.target = null; dx = 0; dz = 0; }
    }
    let length = Math.hypot(dx, dz);
    if (recorded) { dx = recorded.dx; dz = recorded.dz; length = Math.hypot(dx, dz); this.crouching = recorded.crouching; }
    else { dx = length ? Math.round(dx / length * 10000) / 10000 : 0; dz = length ? Math.round(dz / length * 10000) / 10000 : 0; length = Math.hypot(dx, dz); }
    const crouching = this.crouching || this.keys.has('shift');
    const last = this.recording.at(-1);
    if (last && last.dx === dx && last.dz === dz && last.crouching === crouching) last.ticks++;
    else this.recording.push({ dx, dz, crouching, ticks: 1 });
    if (length > 0) {
      const step = dt * (crouching ? 1.35 : 2.4);
      const x = clamp(this.view.x + dx / length * step, -6.6, 6.6);
      const z = clamp(this.view.z + dz / length * step, -4.6, 4.6);
      if (!this.blocked(x, this.view.z)) this.view.x = x;
      if (!this.blocked(this.view.x, z)) this.view.z = z;
    }
    let seen = false;
    for (const guard of this.view.guards) {
      const x = this.view.x - guard.x, z = this.view.z - guard.z;
      const distance = Math.hypot(x, z);
      const direction = Math.atan2(x, z);
      const angle = Math.atan2(Math.sin(direction - guard.angle), Math.cos(direction - guard.angle));
      if (distance < 3.2 && Math.abs(angle) < 0.55 && !this.occluded(this.view.x, this.view.z, guard.x, guard.z)) seen = true;
    }
    this.view.hiding = !seen && COVER.some(r => Math.hypot(this.view.x - r.x, this.view.z - r.z) < Math.max(r.w, r.d) / 2 + 0.9);
    this.view.exposure = clamp(this.view.exposure + dt * (seen ? (crouching ? 0.17 : 0.32) : -0.38), 0, 1);
    if (Math.hypot(this.view.x - 5.2, this.view.z + 3.5) < 0.65) this.view.obtained = true;
    if (this.view.exposure >= 1) { this.view.detected = true; this.finish(); }
    else if (this.view.obtained && Math.hypot(this.view.x + 5.5, this.view.z - 4) < 0.75) this.finish();
    else if (this.elapsed >= 180) { this.view.detected = true; this.finish(); }
    this.onChange(this.view);
  }
  private finish() { this.view.finished = true; this.clearInput(); this.onFinish({ ...this.view }); }
}
