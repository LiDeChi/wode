import type { ActionResult, Mechanism, MindTrace, WorldState } from './types';
import { evaluateMind } from './mind';
import { MECHANISM_ACTIONS, MECHANISM_FIELDS } from '../data/rules';
import { copyWorld, failAction, finishOperation, owns, systemIntent, unsafeContent } from '../data/audit';

const allowedKeys = new Set(['id', 'version', 'name', 'fields', 'rules', 'installed', 'source', 'audit', 'coordinationBefore', 'coordinationAfter']);
const fieldTypes: Record<string, 'number' | 'string' | 'boolean'> = {
  discrepancy: 'number', itemId: 'string', suspicion: 'number', patience: 'number', sourceVerified: 'boolean', coordinationSteps: 'number',
};

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safeNumber(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, value) * 1000) / 1000 : 0; }

export function validateMechanism(candidate: unknown): { ok: boolean; errors: string[] } {
  if (!record(candidate)) return { ok: false, errors: ['机制必须是声明式 JSON 对象。'] };
  const errors: string[] = [];
  if (Object.keys(candidate).some(key => !allowedKeys.has(key))) errors.push('机制带有未声明的能力或字段；网络、文件、代码与函数不在白名单内。');
  if (typeof candidate.id !== 'string' || !/^[a-z][a-z0-9_-]{0,99}$/i.test(candidate.id)) errors.push('机制编号不合法。');
  if (typeof candidate.version !== 'number' || !Number.isSafeInteger(candidate.version) || candidate.version < 1) errors.push('机制版本必须是正整数。');
  if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 80 || unsafeContent(candidate.name)) errors.push('机制名称为空、过长或含伪指令。');
  if (typeof candidate.source !== 'string' || !/^recorded:world--?\d+:v\d+:[a-z0-9,._:-]*$/i.test(candidate.source) || candidate.source.length > 4000) errors.push('机制须引用已录制的世界版本与事件编号。');
  if (typeof candidate.installed !== 'boolean') errors.push('安装状态须为布尔值。');
  const fields = Array.isArray(candidate.fields) ? candidate.fields : [];
  if (!fields.length || fields.length > MECHANISM_FIELDS.length || fields.some(field => typeof field !== 'string' || !MECHANISM_FIELDS.includes(field as typeof MECHANISM_FIELDS[number])) || new Set(fields).size !== fields.length) errors.push('读取字段超出白名单或重复。');
  const rules = Array.isArray(candidate.rules) ? candidate.rules : [];
  if (!rules.length || rules.length > 12) errors.push('机制需要一至十二条有限规则。');
  for (const rule of rules) {
    if (!record(rule) || Object.keys(rule).some(key => !['field', 'operator', 'value', 'action'].includes(key))) { errors.push('规则不是有限的字段比较。'); continue; }
    if (typeof rule.field !== 'string' || !fields.includes(rule.field) || !owns(fieldTypes, rule.field)) errors.push('规则读取了未声明字段。');
    if (!['eq', 'gt', 'lt'].includes(String(rule.operator))) errors.push('只支持等于、大于、小于。');
    if (typeof rule.value !== fieldTypes[String(rule.field)] || (typeof rule.value === 'number' && (!Number.isFinite(rule.value) || Math.abs(rule.value) > 1000)) || (typeof rule.value === 'string' && (rule.value.length > 80 || unsafeContent(rule.value)))) errors.push('比较值与字段类型不符，或不在有限范围内。');
    if (rule.operator !== 'eq' && (typeof rule.value !== 'number' || fieldTypes[String(rule.field)] !== 'number')) errors.push('大小比较只能用于数值字段。');
    if (typeof rule.action !== 'string' || !MECHANISM_ACTIONS.includes(rule.action as typeof MECHANISM_ACTIONS[number])) errors.push('动作超出核印、对账、共享凭证的白名单。');
  }
  if (!Array.isArray(candidate.audit) || candidate.audit.length > 32 || candidate.audit.some(entry => !record(entry) || Object.keys(entry).some(key => !['step', 'passed', 'detail'].includes(key)) || typeof entry.step !== 'string' || entry.step.length > 100 || typeof entry.passed !== 'boolean' || typeof entry.detail !== 'string' || entry.detail.length > 2000 || unsafeContent(entry.detail))) errors.push('审计记录格式不合法。');
  if (typeof candidate.coordinationBefore !== 'number' || typeof candidate.coordinationAfter !== 'number' || !Number.isSafeInteger(candidate.coordinationBefore) || !Number.isSafeInteger(candidate.coordinationAfter) || candidate.coordinationBefore < 0 || candidate.coordinationAfter < 0) errors.push('协调步骤必须是非负整数。');
  return { ok: errors.length === 0, errors };
}

function recordedCases(state: WorldState): Array<{ eventId: string; day: number; trace: MindTrace; before: number; after: number; intact: boolean }> {
  const cases: Array<{ eventId: string; day: number; trace: MindTrace; before: number; after: number; intact: boolean }> = [];
  for (const event of state.events) {
    if (event.intent.sceneId !== 'granary') continue;
    const receipt = event.claimIds.some(id => state.claims.some(claim => claim.id === id && claim.predicate.startsWith('handoff.')));
    if (!receipt) continue;
    const trace = event.traces.find(item => ['keeper-suspicious', 'keeper-impatient'].includes(item.actorId));
    if (!trace) continue;
    const oldSteps = trace.coordination?.length ?? 0;
    const intact = oldSteps >= 4 && ['verify-seal', 'compare-ledger', 'share-receipt'].every(action => trace.coordination?.includes(action)) && trace.layers.length === 3 && trace.layers.every((layer, index) => Number.isFinite(layer.accepted) && Number.isFinite(layer.remaining) && layer.accepted >= 0 && layer.remaining >= 0 && (!index || Math.abs(trace.layers[index - 1].remaining - layer.accepted - layer.remaining) < 0.01));
    cases.push({ eventId: event.id, day: event.day, trace, before: oldSteps, after: 3, intact });
  }
  return cases.slice(-5);
}

export function buildModificationRequest(state: WorldState): { traces: unknown[]; fields: string[]; trigger: string } {
  const cases = recordedCases(state);
  return {
    traces: cases.map(item => ({
      eventId: item.eventId, day: item.day, actorId: item.trace.actorId,
      discrepancy: safeNumber(item.trace.layers[0]?.error),
      layers: item.trace.layers.map(layer => ({ layer: ['unit', 'module', 'mind'].includes(layer.layer) ? layer.layer : 'unit', accepted: safeNumber(layer.accepted), remaining: safeNumber(layer.remaining), error: safeNumber(layer.error), precision: Math.min(1, safeNumber(layer.precision)) })),
      workflow: item.trace.action.startsWith('追问') ? 'pursue-counterpart' : 'inspect-credential', coordinationSteps: item.before,
    })),
    fields: [...MECHANISM_FIELDS],
    trigger: cases.length >= 5 ? '五次录制交接反复出现凭证协调，尝试把核印、对账和共享凭证合成一次有限规则运行。' : `已录制 ${cases.length}/5 次交接；达到五次才允许安装，不使用玩家原文作为改造指令。`,
  };
}

export function executeVerification(mechanism: Pick<Mechanism, 'rules'>, input: Record<string, string | number | boolean>): string[] {
  if (!(typeof input.discrepancy === 'number' && input.discrepancy > 0) || input.sourceVerified !== true) return [];
  const actions: string[] = [];
  for (const rule of mechanism.rules) {
    const value = input[rule.field];
    const matches = rule.operator === 'eq' ? value === rule.value : typeof value === 'number' && typeof rule.value === 'number' && (rule.operator === 'gt' ? value > rule.value : value < rule.value);
    if (matches && !actions.includes(rule.action)) actions.push(rule.action);
  }
  return actions;
}

export function createVerificationMechanism(state: WorldState, declaration?: unknown): Mechanism {
  const cases = recordedCases(state);
  const version = Math.max(0, ...state.mechanisms.map(item => item.version)) + 1;
  const before = cases.reduce((sum, item) => sum + item.before, 0);
  const after = cases.reduce((sum, item) => sum + item.after, 0);
  const reduction = before > 0 ? (before - after) / before : 0;
  const source = `recorded:${state.id}:v${state.version}:${cases.map(item => item.eventId).join(',')}`;
  const mechanism: Mechanism = {
    id: `mechanism-verify-${state.seed}-${version}`, version, name: '合页核验',
    fields: ['discrepancy', 'coordinationSteps', 'sourceVerified'],
    rules: [
      { field: 'discrepancy', operator: 'gt', value: 0, action: 'verify-seal' },
      { field: 'coordinationSteps', operator: 'gt', value: 3, action: 'compare-ledger' },
      { field: 'sourceVerified', operator: 'eq', value: true, action: 'share-receipt' },
    ],
    installed: false, source,
    audit: [
      { step: '来源与版本', passed: cases.length >= 5, detail: `只取真实交接事件，世界 v${state.version}；已具 ${cases.length}/5 次对照。` },
      { step: '声明式静态核验', passed: true, detail: '只比较声明字段，能力仅限核印、对账和共享凭证；使用有限声明解释器。' },
      ...cases.map(item => ({ step: `隔离对照 ${item.eventId}`, passed: item.intact && item.after <= item.before * 0.8, detail: `${item.trace.actorId}，第${item.day}日，欠额 ${safeNumber(item.trace.layers[0]?.error)}；原流程 ${item.before} 步，合页流程 ${item.after} 步。三层读数守恒，输出仍须走同一资源与主张入口。` })),
      { step: '协调成本下降', passed: cases.length >= 5 && reduction >= 0.2 && cases.every(item => item.intact), detail: `五次同输入比较共 ${before}→${after} 个协调步骤，下降 ${Math.round(reduction * 100)}%。步骤是有限流程中的核对与传递次数，不声称等于玩家耗时或模型费用。` },
      { step: '离线与回滚', passed: true, detail: '规则不依赖模型调用；安装保留版本，回滚只停用，旧声明与安装事件继续保留。' },
    ],
    coordinationBefore: before, coordinationAfter: after,
  };
  if (declaration !== undefined) {
    if (!record(declaration) || Object.keys(declaration).some(key => !['name', 'fields', 'rules'].includes(key))) mechanism.audit[1] = { step: '声明式静态核验', passed: false, detail: '候选只接受名称、声明字段与有限规则。' };
    else {
      mechanism.name = declaration.name as string;
      mechanism.fields = declaration.fields as string[];
      mechanism.rules = declaration.rules as Mechanism['rules'];
    }
  }
  const validation = validateMechanism(mechanism);
  if (!validation.ok) { mechanism.audit[1] = { step: '声明式静态核验', passed: false, detail: validation.errors.join('；') }; return mechanism; }
  const trials = cases.map(item => {
    const input = { discrepancy: safeNumber(item.trace.layers[0]?.error), itemId: state.events.find(e => e.id === item.eventId)?.intent.itemId || 'seal', suspicion: state.entities[item.trace.actorId].temperament?.suspicion || 0, patience: state.entities[item.trace.actorId].temperament?.patience || 0, sourceVerified: true, coordinationSteps: item.before };
    const actions = executeVerification(mechanism, input);
    const complete = ['verify-seal', 'compare-ledger', 'share-receipt'].every(action => actions.includes(action));
    const unmet = executeVerification(mechanism, { ...input, sourceVerified: false }).length === 0;
    return { ...item, after: actions.length, complete, unmet };
  });
  mechanism.coordinationBefore = trials.reduce((sum, trial) => sum + trial.before, 0);
  mechanism.coordinationAfter = trials.reduce((sum, trial) => sum + trial.after, 0);
  mechanism.audit = [mechanism.audit[0], mechanism.audit[1], ...trials.map(trial => ({ step: `隔离对照 ${trial.eventId}`, passed: trial.intact && trial.complete && trial.unmet && trial.after <= trial.before * .8, detail: `同一录制输入通过声明解释器：旧 ${trial.before} 步、新 ${trial.after} 步；核印、对账、共享均已执行；缺凭据时不执行。` })), { step: '协调成本下降', passed: trials.length >= 5 && trials.every(t => t.complete && t.unmet && t.intact) && mechanism.coordinationAfter <= mechanism.coordinationBefore * .8, detail: `对五次原轨迹实跑：${mechanism.coordinationBefore}→${mechanism.coordinationAfter} 步，减少 ${mechanism.coordinationBefore ? Math.round((1 - mechanism.coordinationAfter / mechanism.coordinationBefore) * 100) : 0}%。这里测的是协调步骤，不是云费用。` }, mechanism.audit.at(-1)!];
  return mechanism;
}

export function installMechanism(state: WorldState, mechanism: Mechanism): ActionResult {
  const validation = validateMechanism(mechanism);
  if (!validation.ok) return failAction(state, validation.errors.join('；'));
  const expected = createVerificationMechanism(state, { name: mechanism.name, fields: mechanism.fields, rules: mechanism.rules });
  if (!expected.audit.every(entry => entry.passed)) return failAction(state, '还未通过五次真实交接、静态核验与至少 20% 步骤下降；继续留下交接凭证后再安装。');
  if (mechanism.installed || state.mechanisms.some(item => item.id === mechanism.id)) return failAction(state, '此机制已安装或编号已使用；重新生成下一版本再安装。');
  if (mechanism.id !== expected.id || mechanism.version !== expected.version || mechanism.source !== expected.source || JSON.stringify(mechanism.fields) !== JSON.stringify(expected.fields) || JSON.stringify(mechanism.rules) !== JSON.stringify(expected.rules) || mechanism.coordinationBefore !== expected.coordinationBefore || mechanism.coordinationAfter !== expected.coordinationAfter) return failAction(state, '机制来源、声明或对照结果与当前录制版本不符；请从当前轨迹重新生成。');
  const draft = copyWorld(state);
  for (const previous of draft.mechanisms) previous.installed = false;
  draft.mechanisms.push({ ...expected, installed: true });
  const trace = evaluateMind(draft, 'mentor', { topic: '偏好分配', discrepancy: 1 });
  draft.decisions.push({ id: `decision-${state.seed}-${state.version + 1}-${draft.decisions.length + 1}`, role: 'mentor', day: state.day, sceneId: 'studio', input: { mechanismId: expected.id, version: expected.version, before: expected.coordinationBefore, after: expected.coordinationAfter, source: expected.source }, options: ['keep-old', 'install-verified'], selected: 'install-verified', reason: `导师当时的说法：五次真实交接已通过隔离对照，把重复协调压到 ${expected.coordinationAfter} 步；批准离线复用，不开放新的资源或读写权限。`, reasonIsClaim: true });
  return finishOperation(state, draft, systemIntent('install-mechanism', { mechanism: { ...expected, installed: false } }), `${expected.name} v${expected.version} 已安装。下一次粮仓交接将共享经见证的副页与核印步骤；断网也可运行。`, [], [trace], 'modification');
}

export function rollbackMechanism(state: WorldState, id: string): WorldState {
  const mechanism = state.mechanisms.find(item => item.id === id && item.installed);
  if (!mechanism) return state;
  const draft = copyWorld(state);
  draft.mechanisms.find(item => item.id === id)!.installed = false;
  draft.decisions.push({ id: `decision-${state.seed}-${state.version + 1}-${draft.decisions.length + 1}`, role: 'mentor', day: state.day, sceneId: 'studio', input: { mechanismId: id, version: mechanism.version }, options: ['retain', 'rollback'], selected: 'rollback', reason: '导师当时的说法：停用这一版本，恢复按人物性情逐步核对；保留声明、对照与已发生的交接。', reasonIsClaim: true });
  return finishOperation(state, draft, systemIntent('rollback-mechanism', { id }), `${mechanism.name} v${mechanism.version} 已停用；原声明与审计证据保留，下次交接使用旧的判断流程。`, [], [], 'modification').state;
}

export function runSwapBenchmark(state: WorldState): { cases: Array<{ input: string; suspicious: MindTrace; impatient: MindTrace }>; different: number; total: number; baseline: string; hypothesis: string } {
  const fixed = { ...state, mechanisms: [] };
  const cases = [1, 2, 3, 4, 5].map(discrepancy => ({
    input: `同一仓房、同一借粮者、缺 ${discrepancy} 袋；固定其余条件，不安装机制。`,
    suspicious: evaluateMind(fixed, 'keeper-suspicious', { topic: '粮仓交接', discrepancy, counterpartId: 'borrower', pressure: 0.6 }),
    impatient: evaluateMind(fixed, 'keeper-impatient', { topic: '粮仓交接', discrepancy, counterpartId: 'borrower', pressure: 0.6 }),
  }));
  return {
    cases, different: cases.filter(item => item.suspicious.action !== item.impatient.action).length, total: cases.length,
    baseline: '简单控制器基线：只要缺额大于零就追问借粮者，五次输入均是同一动作；未宣称完成强化学习对照。',
    hypothesis: '在这个有限状态世界里成立的假设：疑心与耐性改变各层接收比例，多疑者保留整体疑问并核印，急躁者在动作层先追人。不是对真实人的心理结论。',
  };
}
