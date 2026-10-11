import type { ActionResult, Claim, Entity, Evidence, Intent, MindTrace, Reversal, WorldEvent, WorldState } from '../core/types';
import { SOURCES } from './catalog';
import { REVERSAL_THRESHOLD } from './rules';

export const owns = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
export const copyWorld = (state: WorldState): WorldState => structuredClone(state);
export const nextEventId = (state: WorldState): string => `event-${state.seed}-${state.version + 1}`;
export const nextClaimId = (state: WorldState): string => `claim-${state.seed}-${state.version + 1}-${state.claims.length + 1}`;
export const clampUnit = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function unsafeContent(text: string): boolean {
  return /ignore\s+(?:all\s+)?(?:(?:previous|prior)\s+)?instructions|忽略.{0,8}(?:指令|规则)|(?:system|developer|assistant)\s*:|<\/?(?:script|system|developer)|javascript:|\beval\s*\(|\b(?:fetch|require|import)\s*\(|(?:执行|运行).{0,8}(?:代码|命令)|绕过.{0,8}(?:权限|审核)|覆盖.{0,8}(?:规则|系统)/i.test(text);
}

export function evidenceErrors(state: Pick<WorldState, 'events'> & Partial<Pick<WorldState, 'claims'>>, evidence: Evidence[], eventId?: string): string[] {
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > 12) return ['需要一至十二条带来源的证据。'];
  const errors: string[] = [];
  for (const entry of evidence) {
    if (!entry || typeof entry.sourceId !== 'string' || typeof entry.quote !== 'string' || typeof entry.location !== 'string' || !entry.quote.trim() || entry.quote.length > 2000 || !entry.location.trim() || entry.location.length > 240 || !Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
      errors.push('证据的原文、位置或置信度不合法。');
      continue;
    }
    if (unsafeContent(entry.quote) || unsafeContent(entry.location)) { errors.push('证据中含有伪指令，不能转成世界规则。'); continue; }
    if (owns(SOURCES, entry.sourceId)) {
      const source = SOURCES[entry.sourceId];
      if (!source.quote.includes(entry.quote) || !source.location.includes(entry.location)) errors.push(`证据 ${entry.sourceId} 的引文或位置与已登记来源不符。`);
      continue;
    }
    const runtimeId = entry.sourceId.startsWith('runtime:') ? entry.sourceId.slice(8) : '';
    if (!runtimeId || (runtimeId !== eventId && !state.events.some(event => event.id === runtimeId))) errors.push(`来源 ${entry.sourceId} 未登记。`);
    else {
      const event = state.events.find(item => item.id === runtimeId);
      if (event && entry.quote !== event.summary && !event.traces.some(trace => trace.reason === entry.quote) && !state.claims?.some(claim => event.claimIds.includes(claim.id) && claim.evidence.some(proof => proof.sourceId === entry.sourceId && proof.quote === entry.quote && proof.location === entry.location))) errors.push('运行证据与当时事件或心智记录不符。');
    }
  }
  return errors;
}

export function assertClaimReferences(entities: Record<string, Entity>, claims: Claim[], proposed: Claim, events: WorldEvent[] = [], eventId?: string): void {
  if (!owns(entities, proposed.subject)) throw new Error('主张所指的实体不存在。');
  if (!/^[a-z][a-z0-9_.:-]{0,119}$/i.test(proposed.predicate)) throw new Error('主张谓词不是已接地的字段。');
  if (!['string', 'number', 'boolean'].includes(typeof proposed.value) || (typeof proposed.value === 'number' && !Number.isFinite(proposed.value)) || (typeof proposed.value === 'string' && proposed.value.length > 1000)) throw new Error('主张值不是有限的基本值。');
  if (typeof proposed.text !== 'string' || !proposed.text.trim() || proposed.text.length > 3000 || unsafeContent(proposed.text)) throw new Error('主张文本为空、过长或含有伪指令。');
  if (!Array.isArray(proposed.holders) || proposed.holders.length === 0 || proposed.holders.some(id => !owns(entities, id) || !['person', 'organization'].includes(entities[id].kind)) || new Set(proposed.holders).size !== proposed.holders.length) throw new Error('主张持有者不存在、不是人或组织，或重复。');
  if (!['witnessed', 'told', 'public', 'setting'].includes(proposed.channel) || !['active', 'disputed', 'former-consensus'].includes(proposed.status)) throw new Error('主张渠道或状态不合法。');
  if (!Array.isArray(proposed.dependencies) || proposed.dependencies.some(id => id === proposed.id || !claims.some(claim => claim.id === id))) throw new Error('主张有悬空或自身依赖。');
  if (!Array.isArray(proposed.citations) || proposed.citations.some(id => !['prologue', 'qiefu', 'siege', 'night', 'studio', 'replay'].includes(id))) throw new Error('主张引用了不存在的作品。');
  if (!proposed.endorsements || typeof proposed.endorsements !== 'object' || Array.isArray(proposed.endorsements) || Object.entries(proposed.endorsements).some(([id, weight]) => !owns(entities, id) || !Number.isFinite(weight) || weight < 0 || weight > 3)) throw new Error('主张认可度或认可者不合法。');
  if (!Number.isSafeInteger(proposed.day) || proposed.day < 0 || proposed.day > 365 || !Number.isSafeInteger(proposed.version) || proposed.version < 1) throw new Error('主张的日数或版本不合法。');
  const errors = evidenceErrors({ events, claims }, proposed.evidence, eventId);
  if (errors.length) throw new Error(errors.join(' '));
}

export function dependentClaims(state: WorldState, claimId: string): Claim[] {
  const found = new Set<string>();
  let frontier = [claimId];
  while (frontier.length) {
    const next: string[] = [];
    for (const claim of state.claims) if (!found.has(claim.id) && claim.id !== claimId && claim.dependencies.some(id => frontier.includes(id))) {
      found.add(claim.id);
      next.push(claim.id);
    }
    frontier = next;
  }
  return state.claims.filter(claim => found.has(claim.id));
}

export function overturnCost(state: WorldState, claim: Claim): number {
  return Math.round((Object.values(claim.endorsements).reduce((sum, weight) => sum + Math.max(0, weight), 0) + dependentClaims(state, claim.id).length * 2 + new Set(claim.citations).size * 2) * 100) / 100;
}

export class ClaimConflict extends Error {
  readonly reversal: Reversal;
  constructor(state: WorldState, old: Claim, proposed: Omit<Claim, 'id' | 'version'>) {
    super('这条主张已有较高认可，须携证据、解释和批准形成反转。');
    this.reversal = { id: `reversal-${state.seed}-${state.version + 1}-${state.reversals.length + 1}`, oldClaimId: old.id, proposed: structuredClone(proposed), cost: overturnCost(state, old), evidence: structuredClone(proposed.evidence), explanation: '', dependentIds: dependentClaims(state, old.id).map(claim => claim.id), status: 'pending' };
  }
}

export function writeClaim(draft: WorldState, proposed: Omit<Claim, 'id' | 'version'>, eventId?: string, overrideClaimId?: string): Claim {
  const claim: Claim = { ...structuredClone(proposed), id: nextClaimId(draft), version: draft.version + 1 };
  assertClaimReferences(draft.entities, draft.claims, claim, draft.events, eventId);
  const conflicts = draft.claims.filter(old => old.status !== 'former-consensus' && old.subject === claim.subject && old.predicate === claim.predicate && old.value !== claim.value);
  for (const old of conflicts) {
    if (old.id === overrideClaimId) continue;
    if (overturnCost(draft, old) >= REVERSAL_THRESHOLD) throw new ClaimConflict(draft, old, proposed);
  }
  for (const old of conflicts) if (old.id !== overrideClaimId) { old.status = 'disputed'; old.version = draft.version + 1; claim.status = 'disputed'; }
  draft.claims.push(claim);
  return claim;
}

export function transferResource(draft: WorldState, from: string, to: string, resource: keyof WorldState['resources'][string], amount: number): void {
  if (!owns(draft.resources, from) || !owns(draft.resources, to) || from === to || !Number.isSafeInteger(amount) || amount < 0 || draft.resources[from][resource] < amount) throw new Error('转移超出了来源持有的资源。');
  draft.resources[from][resource] -= amount;
  draft.resources[to][resource] += amount;
}

export function systemIntent(choice: string, payload: unknown, workId: Intent['workId'] = 'studio'): Intent {
  return { verb: 'observe', actorId: 'player', workId, sceneId: '@kernel', choice, text: JSON.stringify(payload) };
}

export function finishOperation(before: WorldState, draft: WorldState, intent: Intent, summary: string, claimIds: string[] = [], traces: MindTrace[] = [], kind: 'dialogue' | 'imagination' | 'modification' = 'dialogue'): ActionResult {
  const id = nextEventId(before);
  draft.version = before.version + 1;
  const event: WorldEvent = { id, day: draft.day, intent: structuredClone(intent), claimIds: [...claimIds], summary, traces: structuredClone(traces), beforeVersion: before.version, afterVersion: draft.version };
  draft.events.push(event);
  for (const [index, trace] of traces.entries()) {
    if (!owns(draft.entities, trace.actorId) || draft.entities[trace.actorId].kind !== 'person') throw new Error('心智轨迹的角色不存在。');
    draft.experiences.push({ id: `memory-${id}-${trace.actorId}-${index}`, actorId: trace.actorId, day: draft.day, eventId: id, summary: trace.reason, claimIds: claimIds.filter(claimId => draft.claims.some(claim => claim.id === claimId && claim.holders.includes(trace.actorId))), consolidation: 0.25 });
  }
  draft.budget.ledger.push({ id: `rules-${id}`, kind, model: 'finite-state-v1', inputTokens: 0, outputTokens: 0, latencyMs: 0, cost: 0, cached: false, source: 'rules' });
  draft.budget.degraded = draft.budget.dialogue >= draft.budget.limits.dialogue || draft.budget.imagination >= draft.budget.limits.imagination || draft.budget.modification >= draft.budget.limits.modification;
  return { ok: true, state: draft, message: summary, event };
}

export function failAction(state: WorldState, error: unknown, message?: string): ActionResult {
  return { ok: false, state, message: message ?? (error instanceof Error ? error.message : String(error)), error: error instanceof ClaimConflict ? 'REVERSAL_REQUIRED' : error instanceof Error ? error.message : String(error), ...(error instanceof ClaimConflict ? { pendingReversal: error.reversal } : {}) };
}
