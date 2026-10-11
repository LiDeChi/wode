import type { MindTrace, Temperament, WorldState } from './types';
import { claimIsVisible } from '../data/rules';
import { executeVerification } from './mechanisms';

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const fallback: Temperament = { suspicion: 0.5, patience: 0.5, compassion: 0.5, duty: 0.5, courage: 0.5 };
const topics = ['粮', '交接', '印', '账', '托付', '侯', '取符', '护送', '合符', '晋鄙', '求援', '魏王', '等待', '选角', '偏好', '分配', '观察', '说话', '当前'] as const;

function safeTopic(topic: string): string {
  const known = topics.find(word => String(topic).includes(word));
  return known ?? '当前处境';
}

export function evaluateMind(state: WorldState, actorId: string, input: { topic: string; discrepancy: number; counterpartId?: string; pressure?: number; itemId?: string }): MindTrace {
  const actor = state.entities[actorId];
  if (!actor || actor.kind !== 'person') {
    return { actorId, input: '未知角色', attention: '没有可得视图', layers: [], action: '不行动', reason: '世界中没有这个人的身份，无法替其编造心思。', emotion: '未知', memoryActivation: [] };
  }
  const temperament = actor.temperament ?? fallback;
  const suspicion = clamp(temperament.suspicion);
  const patience = clamp(temperament.patience);
  const pressure = clamp(input.pressure ?? 0.5);
  const discrepancy = rounded(clamp(Math.abs(input.discrepancy), 0, 1000));
  const topic = safeTopic(input.topic);
  const grainTopic = /粮|交接|印|账/.test(topic);
  const view = state.claims.filter(claim => claim.status !== 'former-consensus' && claimIsVisible(state, claim, actorId));
  const relevantClaims = view.filter(claim => grainTopic
    ? /grain|allocation|receipt|handoff|debt|authority/.test(claim.predicate)
    : claim.subject === actorId || claim.subject === input.counterpartId || claim.text.includes(topic));
  const memories = state.experiences.filter(memory => memory.actorId === actorId && memory.claimIds.some(id => relevantClaims.some(claim => claim.id === id))).slice(-5);
  const familiarity = clamp(memories.reduce((sum, memory) => sum + memory.consolidation, 0) / 12);
  const precision = clamp(0.35 + temperament.duty * 0.35 + familiarity * 0.15 + (state.budget.tier === 'detailed' ? 0.1 : 0));
  const primitiveShare = clamp(0.04 + (1 - patience) * 0.64 + (1 - suspicion) * 0.23 + pressure * (1 - patience) * 0.06, 0.03, 0.94);
  const unitAccepted = rounded(discrepancy * primitiveShare);
  const unitRemaining = rounded(discrepancy - unitAccepted);
  const moduleShare = clamp(0.2 + patience * 0.22 + (1 - suspicion) * 0.15 + familiarity * 0.15, 0.15, 0.65);
  const moduleAccepted = rounded(unitRemaining * moduleShare);
  const moduleRemaining = rounded(unitRemaining - moduleAccepted);
  const mindShare = clamp(0.54 + precision * 0.28 + familiarity * 0.12, 0.5, 0.98);
  const mindAccepted = rounded(moduleRemaining * mindShare);
  const mindRemaining = rounded(moduleRemaining - mindAccepted);
  const pursuit = grainTopic && unitAccepted >= discrepancy * 0.5 && patience < 0.4;
  const inspection = grainTopic && (suspicion >= 0.6 || moduleRemaining > discrepancy * 0.33);
  const verifiedSource = relevantClaims.some(claim => claim.evidence.some(evidence => evidence.confidence >= 0.8 && (evidence.sourceId === 'granary-ledger' || (evidence.sourceId.startsWith('runtime:') && state.events.some(event => event.id === evidence.sourceId.slice(8) && event.claimIds.includes(claim.id))))));
  const mechanism = grainTopic ? state.mechanisms.find(candidate => candidate.installed && ['verify-seal', 'compare-ledger', 'share-receipt'].every(action => executeVerification(candidate, { discrepancy, itemId: input.itemId || 'seal', suspicion, patience, sourceVerified: verifiedSource, coordinationSteps: 5 }).includes(action))) : undefined;
  let action: string;
  let reason: string;
  let attention: string;
  if (grainTopic) {
    action = mechanism ? `核验印信并共享副页（${mechanism.name} v${mechanism.version}）` : pursuit ? '追问借粮者' : inspection ? '核验印信' : '并读仓簿与借条';
    attention = pursuit ? '借粮者还在不在眼前' : inspection ? '印纹、仓簿和谁认可这笔交接' : '交接记录与城中缺粮';
    reason = mechanism
      ? `此前的交接已留下可读的凭证；用已装机制把核印、对账、共享收据合成一轮，省去反复传话。`
      : pursuit
        ? `我把 ${unitAccepted.toFixed(2)} 袋的疑问交给马上找人这一动作；耐性只有 ${patience.toFixed(2)}，先把人找回来再听解释。`
        : inspection
          ? `欠额 ${discrepancy} 袋还不能靠眼前一句话解释；我的疑心 ${suspicion.toFixed(2)}，有 ${moduleRemaining.toFixed(2)} 袋的疑问进入整体判断，所以先核印。`
          : `我愿意先把双方能看到的仓簿与借条并读；余下 ${mindRemaining.toFixed(2)} 袋的不确定先保留。`;
  } else if (actor.role === 'mentor') {
    action = state.budget.degraded || state.budget.tier === 'brief' ? '以规则接续这一场' : state.preferences.detail === 'detailed' ? '把细演留给场中关键人物' : '按偏好分配下一场';
    attention = '玩家已更正的偏好与真实调用余量';
    reason = `我只采用已记下的偏好 ${state.preferences.detail}；${state.budget.degraded ? '实际额度已到上限，继续用规则演完' : '优先让这一场可完整体验'}。`;
  } else if (actor.role === 'director') {
    action = state.preferences.freedom === 'open' ? '给下一场留下可变的入口' : '选一个有成立条件的镜头';
    attention = '已经发生的事与下一场谁能看见它';
    reason = `我按你的 ${state.preferences.freedom === 'open' ? '自由' : '精致'} 偏好选呈现；条件不成立就换段，不提前宣告尚未发生的结局。`;
  } else if (/侯|托付/.test(topic)) {
    action = suspicion > 0.65 && patience > 0.6 ? '停下来观察来人是否愿意折返' : '追问是否真愿承担救赵的代价';
    attention = '来人是否愿意听完整句话';
    reason = `性情让我先读诚意与承担；我只能依据眼前行动和已经持有的消息，不知道尚未发生的去向。`;
  } else if (/合符|晋鄙/.test(topic)) {
    const verifiedAuthority = view.some(c => c.subject === 'jinbi' && c.predicate.startsWith('verified-authority.') && c.value === true && c.status === 'active');
    action = actorId === 'jinbi' && verifiedAuthority && temperament.duty > .85 && patience > .6 ? '承担共同核验，交军并保留王命异议' : temperament.duty > 0.85 ? '核对半符并追问王命' : temperament.courage > 0.85 && patience < 0.4 ? '护住公子，准备强行夺军' : '争取一次共同核验';
    attention = '印符的真伪和谁替十万人负责';
    reason = verifiedAuthority ? `我亲自合符，并让公子与士卒见证军令责任。责任权重 ${temperament.duty.toFixed(2)}、耐性 ${patience.toFixed(2)} 让我愿意承担放行；原止军命令的异议仍保留。这是本作的核验改变。` : `我对责任的权重 ${temperament.duty.toFixed(2)}；合符解释器物，尚未解释全部军令，所以保留 ${mindRemaining.toFixed(2)} 的疑问。`;
  } else if (/取符|护送/.test(topic)) {
    action = temperament.courage > 0.7 ? '借遮挡护送取符' : '停在安全处望风';
    attention = '守卫的视线与同行之人的退路';
    reason = `我愿承担风险，但只对看到的宫门和手中的物件行动；不把传闻当成已经取得兵符。`;
  } else if (/求援|魏王/.test(topic)) {
    action = temperament.courage < 0.3 ? '守住止军的王命' : temperament.compassion > 0.7 ? '继续求援并听取门客' : '等待可信的下一道命令';
    attention = temperament.courage < 0.3 ? '秦先攻魏的威胁' : '被围者还能等多久';
    reason = `我只知道 ${relevantClaims.length} 条与眼前有关的主张；胆量 ${temperament.courage.toFixed(2)} 和怜悯 ${temperament.compassion.toFixed(2)} 共同决定是否继续求援。`;
  } else {
    action = patience > 0.65 ? '听完再核对' : '靠近眼前的人问一句';
    attention = '眼前可见的人、物与持有的记忆';
    reason = `我有 ${relevantClaims.length} 条相关主张、${memories.length} 段被激活的经历，尚不能替没有看见的事断言。`;
  }
  const layers: MindTrace['layers'] = [
    { layer: 'unit', label: pursuit ? '移动与追问单元' : '感知与预期单元', accepted: unitAccepted, remaining: unitRemaining, prediction: grainTopic ? '账上缺额可在眼前核实' : '眼前行动可解释部分疑问', error: discrepancy, precision: rounded(precision * (pursuit ? 0.9 : 0.7)), strategy: pursuit ? '立即寻找对方' : '保留未解释读数', parameterUpdate: `动作接收率=${primitiveShare.toFixed(3)}；疑心=${suspicion.toFixed(2)}；耐性=${patience.toFixed(2)}` },
    { layer: 'module', label: grainTopic ? '凭证与关系模块' : '责任与信任模块', accepted: moduleAccepted, remaining: moduleRemaining, prediction: grainTopic ? '有印、有副页且双方见证才足以交接' : '可信的动机须与已有记忆相容', error: unitRemaining, precision: rounded(precision), strategy: inspection ? '协调凭证，未解释部分上交' : '结合记忆解释局部', parameterUpdate: `记忆熟悉度=${familiarity.toFixed(3)}；接收率=${moduleShare.toFixed(3)}` },
    { layer: 'mind', label: '整体取舍', accepted: mindAccepted, remaining: mindRemaining, prediction: '行动后仍保留未获证实的部分', error: moduleRemaining, precision: rounded(precision), strategy: mechanism ? '复用已核验的声明式机制' : action, parameterUpdate: `整体接收率=${mindShare.toFixed(3)}；未解释余量=${mindRemaining.toFixed(3)}` },
  ];
  const counterpart = input.counterpartId ? state.entities[input.counterpartId] : undefined;
  const otherModel = counterpart?.kind === 'person' ? {
    actorId: counterpart.id,
    expectation: `我以自己的${suspicion >= 0.6 ? '谨慎' : patience < 0.4 ? '急切' : '责任'}去猜：${counterpart.name}可能${grainTopic ? '要求尽快拿到粮；这只是我的猜测' : '希望我相信眼前的话；尚需其行动印证'}`,
    depth: 1,
  } : undefined;
  return {
    actorId, input: `${topic}；缺额=${discrepancy}；压力=${rounded(pressure)}`, attention, layers, action, reason,
    emotion: discrepancy === 0 ? '暂时安定' : suspicion >= 0.7 ? '警惕，尚有疑问' : patience < 0.4 ? '焦躁，想马上行动' : '牵挂，保留不确定',
    ...(grainTopic ? { coordination: mechanism ? executeVerification(mechanism, { discrepancy, itemId: input.itemId || 'seal', suspicion, patience, sourceVerified: verifiedSource, coordinationSteps: 5 }) : ['read-discrepancy', ...(pursuit ? ['find-counterpart'] : []), 'request-credential', 'verify-seal', 'compare-ledger', 'share-receipt'] } : {}),
    ...(otherModel && state.budget.tier !== 'brief' ? { otherModel } : {}), memoryActivation: [...relevantClaims.slice(-5).map(claim => claim.id), ...memories.map(memory => memory.id)],
  };
}
