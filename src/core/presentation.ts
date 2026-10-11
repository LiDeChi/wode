import type { ActionResult, Tier, WorkId, WorldState } from './types';
import { copyWorld, failAction, finishOperation, systemIntent } from '../data/audit';
import { getGrant } from './world';
import { evaluateMind } from './mind';
import { directorFor } from '../data/catalog';

export interface CallOutcome {
  kind: 'dialogue' | 'imagination' | 'modification';
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  cost: number;
  cached: boolean;
  source: 'live' | 'recorded' | 'rules';
  attempted?: boolean;
  accepted?: boolean;
  usageKnown?: boolean;
  priceKnown?: boolean;
  note?: string;
}
export function preparePresentation(state: WorldState, workId: WorkId, sceneId: string, tier: Tier): ActionResult {
  if (!['prologue', 'qiefu', 'siege', 'night', 'studio', 'replay'].includes(workId) || !['detailed', 'normal', 'brief'].includes(tier)) return failAction(state, '没有这个呈现或档位。');
  const grant = getGrant(sceneId);
  if (!grant.verbs.length) return failAction(state, '这个场景尚未备好。');
  const draft = copyWorld(state);
  const readClaims = state.claims.filter(c => c.status === 'active' && (c.channel === 'public' || (c.channel === 'setting' && c.predicate.startsWith('history.')))).slice(0, 100);
  for (const old of readClaims) {
    const c = draft.claims.find(c => c.id === old.id)!;
    if (!c.citations.includes(workId)) { c.citations.push(workId); c.endorsements.director = Math.min(3, (c.endorsements.director || 0) + .25); c.version = state.version + 1; }
  }
  if (!draft.seenWorks.includes(workId)) draft.seenWorks.push(workId);
  draft.budget.tier = state.budget.degraded ? 'brief' : tier;
  const conditions = sceneId !== 'camp' || (state.story.sealObtained && !state.story.nightDetected && state.story.houTrust >= .65);
  const cast = [...draft.decisions].reverse().find(d => d.role === 'director' && d.sceneId === 'granary' && d.options.includes('keeper-suspicious'))?.selected || 'keeper-suspicious';
  for (const role of ['mentor', 'director'] as const) draft.decisions.push({
    id: `decision-${state.seed}-${state.version + 1}-${draft.decisions.length}`, role, actorId: role === 'mentor' ? 'mentor' : directorFor(workId), day: draft.day, sceneId,
    input: { work: workId, requestedTier: tier, actualTier: draft.budget.tier, conditionsMet: conditions, cast, freedom: state.preferences.freedom, interaction: workId === 'prologue' || workId === 'replay' ? 0 : workId === 'siege' ? 3 : 2, prepared: state.preferences.freedom === 'crafted' ? 'high' : 'medium' },
    options: role === 'mentor' ? ['detailed', 'normal', 'brief'] : ['prepared-if-valid', 'live-rules'],
    selected: role === 'mentor' ? draft.budget.tier : conditions ? 'prepared-if-valid' : 'live-rules',
    reason: role === 'mentor' ? (draft.budget.degraded ? '额度已到上限，这里省去深演，人物仍按规则回应。' : '按你当场选择的深度分配，重要的人保留较深的心思。') : conditions ? '所需的凭据与人物条件仍成立，采用备好的节拍。' : '取符或托付条件已变，弃用原成功镜头，按已发生的后果接续。', reasonIsClaim: true
  });
  const traces = ['mentor', directorFor(workId)].map(actorId => evaluateMind(draft, actorId, { topic: actorId === 'mentor' ? '分配' : '选角', discrepancy: .25 }));
  return finishOperation(state, draft, systemIntent('presentation', { workId, sceneId, tier }), `${draft.budget.tier === 'brief' ? '这一场一笔带过，这里省略了深层对白。' : '这一场已经安排。'}${conditions ? '' : '原来的成功段落不再成立。'}`, readClaims.map(c => c.id), traces);
}
export function recordCall(state: WorldState, outcome: CallOutcome): WorldState {
  const draft = copyWorld(state);
  draft.budget.ledger.push({ id: `call-${state.seed}-${state.version + 1}`, ...outcome });
  if (outcome.attempted ?? outcome.source === 'live') draft.budget[outcome.kind] += 1;
  draft.budget.degraded = draft.budget.dialogue >= draft.budget.limits.dialogue || draft.budget.imagination >= draft.budget.limits.imagination || draft.budget.modification >= draft.budget.limits.modification;
  return finishOperation(state, draft, systemIntent('model-call', { outcome }), `已记录${outcome.source === 'live' ? '现场调用' : outcome.source === 'recorded' ? '录制复用' : '规则接续'}，用量与来源留在资源账。`).state;
}
export function renewBudget(state: WorldState, hourStarted: number): WorldState {
  if (!Number.isFinite(hourStarted) || hourStarted < 0) return state;
  const draft = copyWorld(state);
  draft.budget.hourStarted = hourStarted;
  draft.budget.tier = draft.preferences.detail;
  draft.budget.dialogue = 0; draft.budget.imagination = 0; draft.budget.modification = 0; draft.budget.degraded = false;
  return finishOperation(state, draft, systemIntent('renew-budget', { hourStarted }), '新一小时的实际调用额度已接续，旧账仍保留。').state;
}
