import type { ActionResult, WorldState } from './types';
import { copyWorld, failAction, finishOperation, nextEventId, transferResource, writeClaim } from '../data/audit';
import { evaluateMind } from './mind';
import { sourceEvidence } from '../data/catalog';

export function distributeRelief(state: WorldState, choice: 'distribute' | 'hold'): ActionResult {
  if (!['distribute', 'hold'].includes(choice)) return failAction(state, '这句话尚未授予。');
  if (state.events.some(e => e.intent.sceneId === 'siege-square')) return failAction(state, '散财的这一刻已经留下记录。');
  const draft = copyWorld(state), eventId = nextEventId(state);
  const li = evaluateMind(state, 'lichong', { topic: '粮食求援', discrepancy: 2, counterpartId: 'pingyuan', pressure: .9 });
  const pingyuan = evaluateMind(state, 'pingyuan', { topic: '求援', discrepancy: 2, counterpartId: 'lichong', pressure: .9 });
  const willing = choice === 'distribute' && draft.entities.pingyuan.temperament!.compassion >= .7;
  const amount = willing ? Math.min(20, draft.resources.pingyuan.money) : 0;
  if (amount) transferResource(draft, 'pingyuan', 'citizen', 'money', amount);
  const summary = willing ? `李同的话让平原君打开家库，${amount} 份家财交给城中人。城中招集三千敢死之士，仍须等待魏楚援军；仓房的一笔交接接着发生。` : '你劝平原君先守住家库。李同坚持城民等不起，散财暂未发生；粮仓仍要从现有余粮中交接。这是本作的变化。';
  const claim = writeClaim(draft, { subject: 'pingyuan', predicate: 'work.relief-wealth', value: willing ? 'distributed' : 'withheld', text: summary, holders: ['player', 'pingyuan', 'lichong', 'citizen', 'borrower'], channel: 'public', evidence: [{ sourceId: `runtime:${eventId}`, quote: summary, location: '邯郸，散财之议', confidence: 1 }, sourceEvidence('shiji-pingyuan')], endorsements: { pingyuan: 1, lichong: 1, player: .5 }, dependencies: [], citations: [], status: 'active', createdBy: 'siege', day: state.day }, eventId);
  draft.decisions.push({ id: `decision-${state.seed}-${state.version + 1}-relief`, role: 'player', actorId: 'player', day: state.day, sceneId: 'siege-square', input: { availableMoney: state.resources.pingyuan.money, compassion: state.entities.pingyuan.temperament!.compassion }, options: ['distribute', 'hold'], selected: choice, reason: willing ? '平原君依据城民饥困与李同的劝说，愿把家财用于救急。' : '门客请求暂守家库，李同的不同意见保留。', reasonIsClaim: true });
  const result = finishOperation(state, draft, { verb: willing ? 'give' : 'persuade', actorId: 'player', targetId: 'pingyuan', choice, workId: 'siege', sceneId: 'siege-square' }, summary, [claim.id], [li, pingyuan]);
  return result;
}
