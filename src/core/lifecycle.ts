import type { ActionResult, WorldState } from './types';
import { copyWorld, failAction, finishOperation, systemIntent } from '../data/audit';
import { createWorld } from './seed';
import { checkConsistency } from './world';

export function resetWorld(state: WorldState): WorldState {
  const fresh = createWorld(state.seed);
  fresh.id = state.id; fresh.version = state.version;
  return finishOperation(state, fresh, systemIntent('reset-world', { seed: state.seed }), '新的演出已经备好，旧经历仅保留在你导出的记录中。').state;
}
export function anchorImport(imported: WorldState, newVersion: number): ActionResult {
  if (!Number.isSafeInteger(newVersion) || newVersion <= imported.version) return failAction(imported, '保存锚点必须在导入记录之后。');
  const result = finishOperation(imported, copyWorld(imported), systemIntent('import-anchor', { newVersion }), '已接续导入的经历。旧事件编号、证据和版本完整保留，以显式锚点接入新的保存区间。');
  result.state.version = newVersion;
  result.event!.id = `event-${imported.seed}-${newVersion}`;
  result.event!.afterVersion = newVersion;
  result.state.budget.ledger.at(-1)!.id = `rules-${result.event!.id}`;
  return result;
}
export function continueImport(state: WorldState, imported: WorldState): ActionResult {
  if (!checkConsistency(imported).ok) return failAction(state, '导入记录的证据链未通过，原世界保留。');
  return anchorImport(imported, Math.max(state.version, imported.version) + 1);
}
