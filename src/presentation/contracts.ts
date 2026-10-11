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
export interface TheatreDiagnostics { calls: number; triangles: number; geometries: number; textures: number; fps: number; dpr: number }
