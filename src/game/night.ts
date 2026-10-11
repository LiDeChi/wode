import type { NightGuard, NightView, GuardState } from '../presentation/contracts';
import type { NightAction, NightStep } from '../core/types';

export const SEAL = { x: 5.2, z: -3.5 };
export const EXIT = { x: -5.5, z: 4 };
const BOUND_X = 6.6, BOUND_Z = 4.6, PAD = 0.19;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

// Tall screens: they stop movement AND sight. This is the list the vision check consults.
const SCREENS = [
  { x: -1.3, z: -0.5, w: 1.5, d: 4.6 },
  { x: 3, z: 1.8, w: 2.6, d: 1.2 },
  { x: -4, z: -2, w: 2, d: 1.2 },
  { x: 2, z: -3.5, w: 2, d: 1.1 }
];
// The pedestal is a low stone platform, so it stops your feet and not your eyes. It has to be
// solid, or the objective is a painted spot you walk straight through: overshoot the step up by
// half a second and you are past the seal with your hands empty. It deliberately does NOT block
// sight, because guards follow a noise straight to its source without pathing, so a guard who
// walked inside a sight-blocker would be blinded by it exactly when he was about to find you -
// which made standing over the seal as safe as crouching over it, and killed the stance trade.
export const PEDESTAL = { x: SEAL.x, z: SEAL.z, w: 0.7, d: 0.7 };
export const COVER = [...SCREENS, PEDESTAL];

// You have to be at the pedestal to take it: the hold has to put you somewhere you were not
// already safe, or the climax is a formality. The distance is measured from the pedestal's own
// edge rather than from its centre, because a centre-based range cannot be both tight enough to
// mean anything and loose enough to always work. A player legally pressed against the pedestal
// sits 0.54 from its centre on a face but hypot(0.54, 0.54) = 0.76 from it on a padded corner,
// so a range under 0.76 leaves that corner position unable to take the seal - at 0.62 the hold
// never engaged and the run simply timed out - while a range over it starts letting you reach
// from the lane. Distance from the edge is 0 wherever you are touching it, so every legal
// standing position qualifies however you came at it.
const GRAB_REACH = 0.3;
const pedestalGap = (x: number, z: number) => Math.hypot(
  Math.max(0, Math.abs(x - PEDESTAL.x) - (PEDESTAL.w / 2 + PAD)),
  Math.max(0, Math.abs(z - PEDESTAL.z) - (PEDESTAL.d / 2 + PAD))
);

// Walking is a trade of time against attention. Every way of moving has a speed and a
// loudness, and loudness is what carries across the hall, so the player is always
// choosing between being slow and being heard.
const GAIT = {
  crouch: { speed: 1.35, noise: 0.3 },
  walk: { speed: 2.4, noise: 0.9 },
  sprint: { speed: 3.6, noise: 1.8 }
} as const;
// The hold used to be the player's own reach, and its length was measured to fit inside guard B's
// northbound window (1.7s against a 2.7s window, where 2.6s had left only frame-perfect entries).
// The hold is now 如姬's work and runs on her hands rather than the player's stance - see
// TAKING_SECONDS. The stance still decides something, and it is still measured: it decides how
// loud the cover is, and how much of a glimpse you can survive (a crouching body is seen at 2.45
// against 3.2 standing, and draws attention at +0.4/s against +1.0/s).
// Working the seal upright rattles the pedestal loudly enough to carry right across the hall,
// and a guard who hears a noise walks to the spot it came from; crouching over it is nearly
// silent. The stance therefore buys the same cover at the risk of being heard doing it - a gamble
// that only pays while you know where B is.
const GRAB_NOISE = { crouch: 0.05, stand: 1.2 };
const GRAB_RELEASE_DECAY = 0.7;
export const PEBBLES = 2;
const THROW_RANGE = 2.6;
const PULSE_SECONDS = 0.9;
const PULSE_LEVEL = 1.8;

// Hearing reaches further than the eye and goes around corners at reduced strength.
const HEAR_BASE = 1.3, HEAR_PER_NOISE = 1.9, HEAR_THROUGH_COVER = 0.6;
// Exported so the vision cone drawn in the theatre matches the range the simulation
// actually uses — a cone that lies about its own reach would make the game unreadable.
export const SIGHT_RANGE = 3.2, SIGHT_RANGE_LOW = 2.45, SIGHT_HALF_ANGLE = 0.55;
// Seconds of continuous sight before a guard is sure of you: 2.5 crouched, 1.0 upright,
// 0.8 running. A guard who has you in view turns to keep you there, so these are the
// windows in which you have to be behind something again.
const ALERT_GAIN = { crouch: 0.4, stand: 1.0, sprint: 1.3 };
// Being heard does not catch you — it sets a floor under a guard's attention, which
// shortens how long you may be seen before he is sure. Noise alone can never reach the
// detection threshold, so "I was hidden and still lost" always has a sight answer.
const ALERT_DECAY = 0.3, HEARD_ALERT = 0.35;
// A guard whose attention reaches this is not glancing at you, he has recognised you.
// This is what separates a clean escape from an escape that was seen.
const SPOTTED_AT = 0.5;
// How a guard's attention should read to the player. This lives beside the thresholds it
// names so the HUD cannot quietly disagree with the simulation about what "suspicious" means.
export function guardTone(alert: number): 'calm' | 'wary' | 'spotted' {
  if (alert >= SPOTTED_AT) return 'spotted';
  if (alert >= HEARD_ALERT) return 'wary';
  return 'calm';
}
const INVESTIGATE_SPEED = 1.7, INVESTIGATE_WAIT = 2.5, RETURN_TOLERANCE = 0.35;
// A guard drawn off his own beat is following a rumour. Each guard keeps the centre of his beat
// as a post and may not be led more than LEASH metres from it: past that line, and while he is
// still not sure enough to name you, he abandons the hunt and walks back. Because the post is a
// constant and the beat is centred on it, a patrolling guard is always inside his leash, so the
// rule can only ever bind on a chase - a motionless figure in the open, in front of a guard on
// his beat, is caught exactly as before. What it buys is that a glimpse costs ground and time
// instead of the run: you survive by leading him away from where he needs to be.
const POSTS = [{ x: 0.4, z: 0 }, { x: 4.9, z: -1.2 }];
const LEASH = [4.2, 2.7];
const GIVE_UP_AT = SPOTTED_AT;

// 如姬 comes into this with you. She is the one who takes the tally - the document has her steal
// it and the retainer escort her - so the proof is her work and the risk is yours. Two rules
// carry the whole escort:
//
// She follows your footsteps, a fixed step behind, and only moves when you move. Giving her a
// route of her own was tried first and does not work: an independent route is shorter than the
// detours you take, so she arrives at the pedestal while you are still half a room away and stands
// there in the open until someone sees her - measured at the very first guard phase, caught at
// 12 seconds with the player only at x=2.5 and her already at x=4.98. Walking your own path is the
// only arrangement in which she can never get ahead of you into a place you have not cleared.
//
// She cannot crouch. She is in court dress and carrying the tally, so a guard makes her out at
// walking range while you are still beneath notice, and every glimpse of her costs twice what a
// glimpse of you costs. Walking your own path does not make her free: every metre you crawled
// through she walks upright, on the same line, about a second later. This is the part that makes
// 望风 mean something - the window that is wide enough for you alone is not wide enough for the
// two of you, so clearing the corridor for her as well is the job.
const TAKING_SECONDS = 2.4, COVER_REACH = 1.1;
// How far behind you she walks, and how finely your path is recorded for her to follow.
const COMPANION_LAG = 0.9, TRAIL_SAMPLE = 0.25;
// She comes in with you, so this is where the two of you start the night.
export const COMPANION_START = { x: -5, z: 3.8 };
type Companion = { x: number; z: number; alert: number; taking: number; carrying: boolean };

// TypeScript only lets an interface extend a plain name, not an indexed access such as
// NightView['guards'][number]; an intersection alias says the same thing.
type Guard = NightGuard & { target: { x: number; z: number } | null; wait: number; post: { x: number; z: number }; leash: number };
type Rect = { x: number; z: number; w: number; d: number };
const inside = (x: number, z: number, r: Rect, pad: number) =>
  Math.abs(x - r.x) < r.w / 2 + pad && Math.abs(z - r.z) < r.d / 2 + pad;
// The point `arc` metres along a polyline, clamped to the ends. Used to stand 如姬 on the path the
// player walked. Doing it by arc length rather than by lerping between two points is what keeps
// her pace honest through corners, where the straight line between samples is shorter than the
// path actually walked - and a follower who cuts corners is a follower who ends up somewhere the
// player never cleared.
function pointAlong(trail: Array<{ x: number; z: number }>, arc: number) {
  let remaining = arc;
  for (let index = 1; index < trail.length; index++) {
    const a = trail[index - 1], b = trail[index];
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= span) {
      const t = span < 1e-9 ? 0 : remaining / span;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= span;
  }
  return { ...trail[trail.length - 1] };
}

export class NightGame {
  view: NightView = {
    x: -5, z: 3.8, guards: [], exposure: 0, obtained: false, detected: false, hiding: false, finished: false,
    noise: 0, pebbles: PEBBLES, grab: 0, inReach: false, grabbing: false, crouching: false, sprinting: false,
    spotted: false, pulses: [],
    companionExposure: 0, handoff: 0, companionOut: false,
    companion: { x: COMPANION_START.x, z: COMPANION_START.z, carrying: false, taking: false }
  };
  // She and her trail are stepped only from inside step(), so replaying a recording rebuilds both
  // byte for byte the same way it rebuilds the guards - no separate state to serialise or restore.
  private friend: Companion = { x: COMPANION_START.x, z: COMPANION_START.z, alert: 0, taking: 0, carrying: false };
  private trail: Array<{ x: number; z: number }> = [{ x: COMPANION_START.x, z: COMPANION_START.z }];
  private friendProgress = 0;
  elapsed = 0;
  paused = false;
  crouching = false;
  sprinting = false;
  private guards: Guard[] = [];
  private keys = new Set<string>();
  private target: { x: number; z: number } | null = null;
  private accumulator = 0;
  private recording: NightStep[] = [];
  private grabHeld = false;
  private pendingThrow = false;
  private grabSeconds = 0;
  private lastDir = { x: 0, z: -1 };
  private pulses: Array<{ x: number; z: number; level: number; expires: number }> = [];
  constructor(private onFinish: (view: NightView) => void, private onChange: (view: NightView) => void) {
    this.guards = [0, 1].map(index => { const base = this.patrolAt(0, index); return { ...base, alert: 0, state: 'patrol' as GuardState, target: null, wait: 0, post: POSTS[index], leash: LEASH[index] }; });
    this.view.guards = this.guards.map(({ x, z, angle, alert, state }) => ({ x, z, angle, alert, state }));
    this.onChange(this.view);
  }
  key(key: string, down: boolean) { const normalized = key.toLowerCase(); if (down) this.keys.add(normalized); else this.keys.delete(normalized); }
  clearInput() { this.keys.clear(); this.target = null; this.grabHeld = false; this.pendingThrow = false; }
  go(x: number, z: number) { this.target = { x: clamp(x, -BOUND_X, BOUND_X), z: clamp(z, -BOUND_Z, BOUND_Z) }; }
  // Both actions are input only; the simulation decides what they can do. The server
  // replays these exact flags, so a claimed grab or throw cannot be invented later.
  grab(held: boolean) { this.grabHeld = held; }
  throwPebble() { if (this.view.pebbles > 0) this.pendingThrow = true; }
  private blocked(x: number, z: number) { return COVER.some(r => inside(x, z, r, PAD)); }
  // Sight is a line, not a body, so it is stopped by the tall screens alone and by their true
  // edge rather than their padded one.
  private occluded(x: number, z: number, gx: number, gz: number) {
    const distance = Math.hypot(x - gx, z - gz);
    if (distance < 0.001) return false;
    for (let t = 0.1; t < distance; t += 0.15) {
      const px = gx + (x - gx) * t / distance, pz = gz + (z - gz) * t / distance;
      if (SCREENS.some(r => inside(px, pz, r, 0))) return true;
    }
    return false;
  }
  // Patrol is a pure function of elapsed, so a guard that never notices anything walks the
  // identical beat on every replay. Each guard looks the way he is walking: that is what
  // makes passing behind one possible, and it is the whole basis of reading their timing.
  private patrolAt(elapsed: number, index: number) {
    // A walks the open middle, so the crossing is made on his schedule rather than yours.
    // His beat has to stop short of the south lane, where the route crosses him twice. At
    // amplitude 4.2 he turned at z=-4.2, only 0.14 from the lane: a player who overshot by a
    // step ended up pinned on the wall 0.4 from him with nowhere to go, and the lane was safe
    // only while his gaze happened to drift off it, which is a coin flip rather than a read.
    // 3.6 leaves the lane a metre of clearance so being late is survivable, while still putting
    // his cone across the crossing often enough that ignoring him entirely is still fatal.
    if (index === 0) return this.sweep(elapsed, 0.4, 0, 3.6, 0.22);
    // B paces the short beat in front of the seal. Whether the seal is safe to reach for
    // is exactly the question of where B is on this beat. His northbound window is
    // (pi/2 - 0.4429)/rate seconds wide: 2.7s at rate 0.42, and 3.5s at 0.32. The excursion
    // needs 3.7s, so the faster beat left no room for a human to act on what they had read.
    // Slowing him costs nothing in threat — he still walks the pedestal's floor and still
    // turns back into it — it only makes the beat legible enough to plan against.
    return this.sweep(elapsed, 4.9, -1.2, 1.4, 0.32);
  }
  private sweep(elapsed: number, x: number, centre: number, amplitude: number, rate: number) {
    // He does not stare rigidly down his own path: at a walking pace his gaze drifts across
    // it. Without that drift a cone pointing along the patrol axis can only ever threaten a
    // player standing almost exactly on that line, which makes the whole floor safe.
    const phase = elapsed * rate;
    const travel = Math.cos(phase) >= 0 ? 0 : Math.PI;
    return { x, z: centre + Math.sin(phase) * amplitude, angle: travel + Math.sin(elapsed * rate * 1.7) * 0.78 };
  }
  private gait() { return this.view.crouching ? GAIT.crouch : this.view.sprinting ? GAIT.sprint : GAIT.walk; }
  // The loudest thing a guard could be hearing right now, and where it is.
  private noiseSources(): Array<{ x: number; z: number; level: number }> {
    const sources: Array<{ x: number; z: number; level: number }> = [];
    if (this.view.noise > 0) sources.push({ x: this.view.x, z: this.view.z, level: this.view.noise });
    for (const pulse of this.pulses) if (pulse.expires > this.elapsed) sources.push({ x: pulse.x, z: pulse.z, level: pulse.level });
    return sources;
  }
  frames(): NightStep[] { return structuredClone(this.recording); }
  // A throw lands once, on the first tick of its run; grab is held, so it lasts for the
  // whole run. This is what makes a one-shot action replay exactly as often as it fired.
  restore(frames: NightStep[]) {
    for (const frame of frames) for (let t = 0; t < frame.ticks; t++) this.step(frame.action === 'throw' && t > 0 ? { ...frame, action: 'none' } : frame);
  }
  tick(delta: number) {
    if (this.paused || this.view.finished) return;
    this.accumulator += Math.max(0, Math.min(delta, 0.5));
    while (this.accumulator >= 1 / 30 && !this.view.finished) { this.accumulator -= 1 / 30; this.step(); }
  }
  private step(recorded?: NightStep) {
    if (this.view.finished) return;
    const dt = 1 / 30;
    this.elapsed += dt;
    // She is led by distance covered, so the tick has to know where the player started it.
    const px0 = this.view.x, pz0 = this.view.z;
    this.view.crouching = recorded ? recorded.crouching : this.crouching || this.keys.has('shift');
    this.view.sprinting = recorded ? recorded.sprint : !this.view.crouching && (this.sprinting || this.keys.has(' '));
    const action: NightAction = recorded ? recorded.action : this.pendingThrow && this.view.pebbles > 0 ? 'throw' : this.grabHeld ? 'grab' : 'none';
    if (!recorded) this.pendingThrow = false;

    let dx = Number(this.keys.has('arrowright') || this.keys.has('d')) - Number(this.keys.has('arrowleft') || this.keys.has('a'));
    let dz = Number(this.keys.has('arrowdown') || this.keys.has('s')) - Number(this.keys.has('arrowup') || this.keys.has('w'));
    if (dx || dz) this.target = null;
    else if (this.target) {
      dx = this.target.x - this.view.x; dz = this.target.z - this.view.z;
      if (Math.hypot(dx, dz) < 0.15) { this.target = null; dx = 0; dz = 0; }
    }
    let length = Math.hypot(dx, dz);
    if (recorded) { dx = recorded.dx; dz = recorded.dz; length = Math.hypot(dx, dz); }
    else { dx = length ? Math.round(dx / length * 10000) / 10000 : 0; dz = length ? Math.round(dz / length * 10000) / 10000 : 0; length = Math.hypot(dx, dz); }

    const last = this.recording.at(-1);
    if (last && last.dx === dx && last.dz === dz && last.crouching === this.view.crouching && last.sprint === this.view.sprinting && last.action === action) last.ticks++;
    else this.recording.push({ dx, dz, crouching: this.view.crouching, sprint: this.view.sprinting, action, ticks: 1 });

    // Reaching for the seal costs time during which you cannot run. That holding still
    // is the whole gamble of the scene. It is still your gamble, but it is no longer your
    // theft: the hold is what covers 如姬 while she works, so the same key, the same
    // commitment and the same frozen seconds buy her the tally instead of you.
    this.view.inReach = !this.view.obtained && pedestalGap(this.view.x, this.view.z) < GRAB_REACH;
    this.view.grabbing = action === 'grab' && this.view.inReach;
    if (this.view.grabbing) this.grabSeconds += dt;
    else if (!this.friend.carrying) this.grabSeconds = Math.max(0, this.grabSeconds - dt * GRAB_RELEASE_DECAY);
    this.view.grab = this.friend.carrying ? 1 : clamp(this.grabSeconds / TAKING_SECONDS, 0, 1);

    if (length > 0 && !this.view.grabbing) {
      const step = dt * this.gait().speed;
      this.lastDir = { x: dx / length, z: dz / length };
      const x = clamp(this.view.x + dx / length * step, -BOUND_X, BOUND_X);
      const z = clamp(this.view.z + dz / length * step, -BOUND_Z, BOUND_Z);
      if (!this.blocked(x, this.view.z)) this.view.x = x;
      if (!this.blocked(this.view.x, z)) this.view.z = z;
    }

    // A thrown pebble is noise placed somewhere else on purpose: the only way to move a
    // guard without moving yourself. Aim comes from the direction you last walked.
    if (action === 'throw' && this.view.pebbles > 0) {
      this.view.pebbles -= 1;
      let distance = THROW_RANGE;
      let landing = { x: this.view.x + this.lastDir.x * distance, z: this.view.z + this.lastDir.z * distance };
      while (distance > 1 && this.blocked(landing.x, landing.z)) {
        distance -= 0.35;
        landing = { x: this.view.x + this.lastDir.x * distance, z: this.view.z + this.lastDir.z * distance };
      }
      landing.x = clamp(landing.x, -BOUND_X, BOUND_X); landing.z = clamp(landing.z, -BOUND_Z, BOUND_Z);
      this.pulses.push({ x: landing.x, z: landing.z, level: PULSE_LEVEL, expires: this.elapsed + PULSE_SECONDS });
    }
    this.pulses = this.pulses.filter(pulse => pulse.expires > this.elapsed);
    this.view.pulses = this.pulses.map(({ x, z, level, expires }) => ({ x, z, level, life: clamp((expires - this.elapsed) / PULSE_SECONDS, 0, 1) }));

    const moving = length > 0 && !this.view.grabbing;
    const grabNoise = this.view.grabbing ? (this.view.crouching ? GRAB_NOISE.crouch : GRAB_NOISE.stand) : 0;
    this.view.noise = Math.max(moving ? this.gait().noise : 0, grabNoise);

    const sources = this.noiseSources();
    let seenAny = false;
    for (let index = 0; index < this.guards.length; index++) {
      const guard = this.guards[index];
      const toX = this.view.x - guard.x, toZ = this.view.z - guard.z;
      const distance = Math.hypot(toX, toZ);
      const bearing = Math.atan2(toX, toZ);
      const facing = Math.atan2(Math.sin(bearing - guard.angle), Math.cos(bearing - guard.angle));
      const sees = distance < (this.view.crouching ? SIGHT_RANGE_LOW : SIGHT_RANGE) && Math.abs(facing) < SIGHT_HALF_ANGLE && !this.occluded(this.view.x, this.view.z, guard.x, guard.z);
      if (sees) seenAny = true;

      let heard: { x: number; z: number } | null = null;
      if (!sees) for (const source of sources) {
        const reach = (HEAR_BASE + source.level * HEAR_PER_NOISE) * (this.occluded(source.x, source.z, guard.x, guard.z) ? HEAR_THROUGH_COVER : 1);
        if (Math.hypot(source.x - guard.x, source.z - guard.z) < reach) { heard = { x: source.x, z: source.z }; break; }
      }

      // Leashed: he has been led too far from his beat and is not yet certain of you, so the
      // rumour loses. He drops the chase and his gaze turns home, which breaks the sight line.
      const offPost = Math.hypot(guard.x - guard.post.x, guard.z - guard.post.z);
      const leashed = guard.state !== 'patrol' && offPost >= guard.leash && guard.alert < GIVE_UP_AT;
      if (leashed) { guard.state = 'return'; guard.target = null; guard.wait = 0; }

      if (sees) {
        guard.alert = clamp(guard.alert + dt * (this.view.crouching ? ALERT_GAIN.crouch : this.view.sprinting ? ALERT_GAIN.sprint : ALERT_GAIN.stand), 0, 1);
        if (guard.alert >= SPOTTED_AT) this.view.spotted = true;
        if (!leashed) { guard.state = 'investigate'; guard.target = { x: this.view.x, z: this.view.z }; }
      } else {
        guard.alert = clamp(guard.alert - dt * ALERT_DECAY, 0, 1);
        if (heard) { guard.alert = Math.max(guard.alert, HEARD_ALERT); if (guard.state !== 'investigate') { guard.state = 'investigate'; guard.target = heard; guard.wait = 0; } }
      }

      const beat = this.patrolAt(this.elapsed, index);
      if (guard.state === 'patrol') {
        guard.x = beat.x; guard.z = beat.z; guard.angle = beat.angle;
      } else {
        const goal = guard.state === 'return' ? beat : guard.target ?? beat;
        const travelX = goal.x - guard.x, travelZ = goal.z - guard.z, travel = Math.hypot(travelX, travelZ);
        if (travel > (guard.state === 'return' ? RETURN_TOLERANCE : 0.4)) {
          const advance = Math.min(travel, dt * INVESTIGATE_SPEED);
          guard.x += travelX / travel * advance; guard.z += travelZ / travel * advance;
        }
        if (sees && !leashed) guard.angle = bearing;
        else if ((guard.state !== 'return' || leashed) && travel > 0.2) guard.angle = Math.atan2(travelX, travelZ);
        // Only an unobserved guard stops to look around; a guard that still has eyes on
        // you keeps closing instead of politely pausing.
        if (!sees && guard.state === 'investigate' && travel <= 0.4) {
          guard.wait += dt; guard.angle += dt * 1.6;
          if (guard.wait >= INVESTIGATE_WAIT) { guard.state = 'return'; guard.wait = 0; guard.target = null; }
        } else if (guard.state === 'return' && travel <= RETURN_TOLERANCE) { guard.state = 'patrol'; guard.wait = 0; }
      }
      this.view.guards[index] = { x: guard.x, z: guard.z, angle: guard.angle, alert: guard.alert, state: guard.state };
    }

    // ---- 如姬 ----------------------------------------------------------------
    const friend = this.friend;
    // Record the path you walked, then stand her on it a fixed step behind. She cannot get ahead
    // of you, because the path is only as long as you have made it.
    const travelled = Math.hypot(this.view.x - px0, this.view.z - pz0);
    if (travelled > 1e-4 && !this.view.finished) {
      const last = this.trail[this.trail.length - 1];
      if (Math.hypot(this.view.x - last.x, this.view.z - last.z) >= TRAIL_SAMPLE) this.trail.push({ x: this.view.x, z: this.view.z });
      this.friendProgress += travelled;
    }
    const followed = pointAlong(this.trail, Math.max(0, this.friendProgress - COMPANION_LAG));
    friend.x = followed.x; friend.z = followed.z;
    // The theft is hers; the cover is yours. She cannot finish while you let go.
    const atSeal = Math.hypot(friend.x - SEAL.x, friend.z - SEAL.z) < 1.2;
    if (!friend.carrying && atSeal && pedestalGap(this.view.x, this.view.z) < COVER_REACH && action === 'grab') {
      friend.taking += dt;
      if (friend.taking >= TAKING_SECONDS) {
        this.view.obtained = true; friend.carrying = true; friend.taking = 0; this.grabSeconds = 0;
      }
    } else if (!friend.carrying && friend.taking > 0) friend.taking = Math.max(0, friend.taking - dt * GRAB_RELEASE_DECAY);
    this.view.handoff = friend.carrying ? 1 : clamp(friend.taking / TAKING_SECONDS, 0, 1);
    // She is seen by exactly the eyes that see you, and made out sooner: she cannot crouch, so a
    // guard reads her at walking range and every glimpse of her costs what a standing player's
    // glimpse costs. A single frame of contact is not being seen - the same threshold that
    // governs the player governs her, or a clean run is reported as blown by one jittery tick.
    let herWorst = 0;
    for (const guard of this.guards) {
      const toX = friend.x - guard.x, toZ = friend.z - guard.z;
      const distance = Math.hypot(toX, toZ);
      const bearing = Math.atan2(toX, toZ);
      const facing = Math.atan2(Math.sin(bearing - guard.angle), Math.cos(bearing - guard.angle));
      const seesHer = distance < SIGHT_RANGE && Math.abs(facing) < SIGHT_HALF_ANGLE
        && !this.occluded(friend.x, friend.z, guard.x, guard.z);
      friend.alert = clamp(friend.alert + dt * (seesHer ? ALERT_GAIN.stand : -ALERT_DECAY), 0, 1);
      if (friend.alert >= SPOTTED_AT) this.view.spotted = true;
      herWorst = Math.max(herWorst, friend.alert);
    }
    this.view.companionExposure = herWorst;
    // She is out when she is out: close enough to the gate that the two of you leave together.
    this.view.companionOut = friend.carrying && Math.hypot(friend.x - EXIT.x, friend.z - EXIT.z) < 1.6;
    this.view.companion = { x: friend.x, z: friend.z, carrying: friend.carrying, taking: friend.taking > 0 };

    if (seenAny) this.view.spotted = true;
    this.view.exposure = this.guards.reduce((worst, guard) => Math.max(worst, guard.alert), 0);
    this.view.hiding = !seenAny && COVER.some(r => Math.hypot(this.view.x - r.x, this.view.z - r.z) < Math.max(r.w, r.d) / 2 + 0.9);

    if (this.guards.some(guard => guard.alert >= 1) || friend.alert >= 1) { this.view.detected = true; this.finish(); }
    // She has to get out too. Leaving her behind is a way to lose the act, not a cosmetic
    // omission - otherwise the escort is scenery and the whole second body is free.
    else if (this.view.obtained && this.view.companionOut && Math.hypot(this.view.x - EXIT.x, this.view.z - EXIT.z) < 0.75) this.finish();
    else if (this.elapsed >= 180) { this.view.detected = true; this.finish(); }
    this.onChange(this.view);
  }
  private finish() { this.view.finished = true; this.clearInput(); this.onFinish({ ...this.view }); }
}
