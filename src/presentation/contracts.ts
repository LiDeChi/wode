export type SceneKind = 'city' | 'court' | 'gate' | 'night' | 'camp' | 'granary' | 'studio';
export interface SceneCharacter { id: string; name: string; color: string; silhouette: string; x: number; z: number; mood?: string }
export interface NightView { x: number; z: number; guards: Array<{ x: number; z: number; angle: number }>; exposure: number; obtained: boolean; detected: boolean; hiding: boolean; finished: boolean }
export interface GranaryView { stock: number; capacity: number; credential: string; keeper: string; mechanism: boolean }
export interface TheatreOptions { onCharacterClick: (id: string) => void; onGroundClick: (x: number, z: number) => void; onTick?: (delta: number) => void }
export interface TheatreDiagnostics { calls: number; triangles: number; geometries: number; textures: number; fps: number; dpr: number }
