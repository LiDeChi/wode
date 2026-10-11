export type EntityKind = 'person' | 'place' | 'item' | 'organization';
export type Tier = 'detailed' | 'normal' | 'brief';
export type Channel = 'witnessed' | 'told' | 'public' | 'setting';
export type ClaimStatus = 'active' | 'disputed' | 'former-consensus';
export type WorkId = 'prologue' | 'qiefu' | 'siege' | 'night' | 'studio' | 'replay';
export type Verb = 'visit' | 'give' | 'say' | 'persuade' | 'observe' | 'borrow' | 'vouch' | 'verify' | 'steal' | 'escort' | 'command' | 'wait';
export type Resource = 'grain' | 'money' | 'soldiers' | 'favor';

export interface Temperament { suspicion: number; patience: number; compassion: number; duty: number; courage: number }
export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  description: string;
  location: string;
  role?: 'actor' | 'director' | 'mentor';
  temperament?: Temperament;
  skills?: string[];
  goals?: string[];
  appearance?: { color: string; silhouette: string; assetId: string; voice: string };
}
export interface Experience { id: string; actorId: string; day: number; eventId: string; summary: string; claimIds: string[]; consolidation: number }
export interface Evidence { sourceId: string; quote: string; location: string; confidence: number }
export interface Claim {
  id: string;
  subject: string;
  predicate: string;
  value: string | number | boolean;
  text: string;
  holders: string[];
  channel: Channel;
  evidence: Evidence[];
  endorsements: Record<string, number>;
  dependencies: string[];
  citations: string[];
  status: ClaimStatus;
  createdBy: WorkId | 'seed';
  day: number;
  version: number;
  supersedes?: string;
}
export interface MindTrace {
  actorId: string;
  input: string;
  attention: string;
  layers: Array<{ layer: 'unit' | 'module' | 'mind'; label: string; accepted: number; remaining: number; prediction: string; error: number; precision: number; strategy: string; parameterUpdate: string }>;
  action: string;
  reason: string;
  emotion: string;
  otherModel?: { actorId: string; expectation: string; depth: number };
  memoryActivation: string[];
  coordination?: string[];
}
export interface DecisionRecord {
  id: string;
  role: 'mentor' | 'director' | 'player';
  actorId?: string;
  day: number;
  sceneId: string;
  input: Record<string, string | number | boolean>;
  options: string[];
  selected: string;
  reason: string;
  reasonIsClaim: true;
}
export interface Intent {
  verb: Verb;
  actorId: string;
  targetId?: string;
  itemId?: string;
  text?: string;
  choice?: string;
  amount?: number;
  workId: WorkId;
  sceneId: string;
}
export interface WorldEvent {
  id: string;
  day: number;
  intent: Intent;
  claimIds: string[];
  summary: string;
  traces: MindTrace[];
  beforeVersion: number;
  afterVersion: number;
}
export interface Reversal {
  id: string;
  oldClaimId: string;
  newClaimId?: string;
  proposed: Omit<Claim, 'id' | 'version'>;
  cost: number;
  evidence: Evidence[];
  explanation: string;
  dependentIds: string[];
  approval?: 'director' | 'mentor';
  status: 'pending' | 'approved' | 'rejected';
}
export interface Preferences { patience: 'now' | 'later'; freedom: 'crafted' | 'open'; detail: Tier; surprises: boolean }
export interface Budget {
  hourStarted: number;
  dialogue: number;
  imagination: number;
  modification: number;
  limits: { dialogue: number; imagination: number; modification: number };
  tier: Tier;
  degraded: boolean;
  ledger: Array<{ id: string; kind: 'dialogue' | 'imagination' | 'modification'; model: string; inputTokens: number; outputTokens: number; latencyMs: number; cost: number; cached: boolean; source: 'live' | 'recorded' | 'rules'; attempted?: boolean; accepted?: boolean; usageKnown?: boolean; priceKnown?: boolean; note?: string }>;
}
export interface Mechanism {
  id: string;
  version: number;
  name: string;
  fields: string[];
  rules: Array<{ field: string; operator: 'eq' | 'gt' | 'lt'; value: string | number | boolean; action: string }>;
  installed: boolean;
  source: string;
  audit: Array<{ step: string; passed: boolean; detail: string }>;
  coordinationBefore: number;
  coordinationAfter: number;
}
export interface CauseLink { id: string; actorId: string; label: string; belief: string; resource: string; confidence: number; replaceable: boolean; fixed: boolean; intact: boolean; evidence: Evidence[] }
export type NightAction = 'none' | 'grab' | 'throw';
export interface NightStep { dx: number; dz: number; crouching: boolean; sprint: boolean; action: NightAction; ticks: number }
export interface WorldState {
  schemaVersion: 1;
  id: string;
  version: number;
  seed: number;
  day: number;
  lastSeen: number;
  entities: Record<string, Entity>;
  claims: Claim[];
  experiences: Experience[];
  resources: Record<string, Record<Resource, number>>;
  relationships: Record<string, number>;
  events: WorldEvent[];
  decisions: DecisionRecord[];
  reversals: Reversal[];
  preferences: Preferences;
  budget: Budget;
  mechanisms: Mechanism[];
  causeChain: CauseLink[];
  story: {
    act: number;
    started: boolean;
    completed: boolean;
    sealObtained: boolean;
    nightDetected: boolean;
    houTrust: number;
    jinbiFate: 'unknown' | 'alive' | 'dead';
    ending: 'unknown' | 'historical' | 'counterfactual';
    directorUnlocked: boolean;
    choices: string[];
  };
  seenWorks: WorkId[];
  acknowledgments: string[];
  nightRun?: { workId: 'qiefu' | 'night'; frames: NightStep[]; finished: boolean; abandoned?: boolean };
}
export interface SceneGrant { sceneId: string; verbs: Verb[]; language: 'hidden' | 'selected' | 'free'; actorIds: string[]; preconditions: string[] }
export interface ActionResult { ok: boolean; state: WorldState; message: string; event?: WorldEvent; pendingReversal?: Reversal; error?: string }
export interface ConsistencyResult { ok: boolean; checks: Array<{ name: string; passed: boolean; detail: string }> }
