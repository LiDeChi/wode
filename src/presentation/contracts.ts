export type SceneKind = 'city' | 'court' | 'gate' | 'night' | 'camp' | 'granary' | 'studio';
export interface SceneCharacter { id: string; name: string; color: string; silhouette: string; x: number; z: number; mood?: string }
export type GuardState = 'patrol' | 'investigate' | 'return';
export interface NightGuard { x: number; z: number; angle: number; alert: number; state: GuardState }
export interface NightPulse { x: number; z: number; level: number; life: number }
export interface NightView {
  x: number; z: number; guards: NightGuard[];
  exposure: number; obtained: boolean; detected: boolean; hiding: boolean; finished: boolean;
  noise: number; pebbles: number; grab: number; inReach: boolean; grabbing: boolean; crouching: boolean; sprinting: boolean;
  spotted: boolean; pulses: NightPulse[];
  // 如姬, who takes the tally while you cover her and lead her out. `obtained` means she has it,
  // not you; `companionOut` is whether she reached the gate, which the act requires.
  companionExposure: number; handoff: number; companionOut: boolean;
  companion: { x: number; z: number; carrying: boolean; taking: boolean };
}
export interface GranaryView { stock: number; capacity: number; credential: string; keeper: string; mechanism: boolean }
export interface TheatreOptions { onCharacterClick: (id: string) => void; onGroundClick: (x: number, z: number) => void; onTick?: (delta: number) => void }
// The night act's follow camera is told where to aim by the simulation - at most 30 times a second,
// and on no frame where the 1/30s accumulator has not yet filled - while the render loop reads that
// answer once per frame. A mismatch between the two rates costs nothing the counters above can see
// and shows up only as a picture that shakes, so both halves are published here: `aim` is where the
// camera has been told to point, `camera` is where it actually ended up. `camera` is the one a test
// can hold to zero. `aim` is published to be read rather than asserted on: the clobber happens in
// configureCamera, which runs after the easing every frame, so from outside the frame loop `aim`
// always reads the last writer's value and cannot by itself tell the two builds apart.
export interface TheatreDiagnostics { calls: number; triangles: number; geometries: number; textures: number; fps: number; dpr: number; camera: { x: number; y: number; z: number }; aim: { x: number; y: number; z: number } }
