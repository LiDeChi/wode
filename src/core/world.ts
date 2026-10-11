import type { ActionResult, Claim, ConsistencyResult, DecisionRecord, Evidence, Intent, MindTrace, Preferences, SceneGrant, WorldEvent, WorldState } from './types';
import { evaluateMind } from './mind';
import { sourceEvidence, directorFor } from '../data/catalog';
import { claimIsVisible, REVERSAL_THRESHOLD, SCENES, VERBS, YEAR_DAYS } from '../data/rules';
import { assertClaimReferences, clampUnit, copyWorld, dependentClaims, evidenceErrors, failAction, finishOperation, nextEventId, overturnCost, owns, systemIntent, transferResource, unsafeContent, writeClaim } from '../data/audit';
import { installMechanism, rollbackMechanism, validateMechanism } from './mechanisms';
import { preparePresentation, recordCall, renewBudget } from './presentation';
import { resetWorld, anchorImport } from './lifecycle';
import { deriveNightOutcome, recordNightRun, replayNight } from './night-run';
import { distributeRelief } from './siege';

const works = ['prologue', 'qiefu', 'siege', 'night', 'studio', 'replay'];
const allowedIntentKeys = new Set(['verb', 'actorId', 'targetId', 'itemId', 'text', 'choice', 'amount', 'workId', 'sceneId']);
const modernKnowledge = /互联网|网络服务器|手机|电脑|人工智能|大模型|核武|电报|电力|火药|秦始皇|统一六国|system\s*prompt|\b(?:http|https|javascript|python|LLM|GPT|API|internet)\b/i;
const storyActions: Record<string, Record<string, Intent['verb'][]>> = {
  court: { petition: ['say', 'persuade'], gift: ['give', 'say'], wait: ['wait'] },
  gate: { return: ['say', 'persuade', 'escort'], rush: ['say', 'persuade', 'escort'], listen: ['say', 'persuade', 'wait'] },
  night: { escape: ['escort', 'steal'], spotted: ['escort', 'steal'], detected: ['escort', 'steal'] },
  camp: { verify: ['verify', 'say', 'persuade'], force: ['command', 'say'], appeal: ['say', 'persuade'] },
};

export function getGrant(sceneId: string): SceneGrant {
  return owns(SCENES, sceneId) ? structuredClone(SCENES[sceneId].grant) : { sceneId, verbs: [], language: 'hidden', actorIds: [], preconditions: ['该场景不存在，尚未获得动作授予。'] };
}

export function getActorView(state: WorldState, actorId: string): Claim[] {
  return state.claims.filter(claim => claimIsVisible(state, claim, actorId)).map(claim => structuredClone(claim));
}

export function getMind(state: WorldState, actorId: string): MindTrace {
  const trace = [...state.events].reverse().flatMap(event => event.traces).find(item => item.actorId === actorId);
  if (trace) return structuredClone(trace);
  const actor = state.entities[actorId];
  const topic = actorId.startsWith('keeper-') || actorId === 'borrower' ? '粮仓交接' : actor?.role === 'mentor' ? '偏好分配' : actor?.role === 'director' ? '选角' : actorId === 'houying' ? '侯嬴托付' : actorId === 'jinbi' ? '晋鄙合符' : actorId === 'ruji' ? '取符护送' : '求援';
  return evaluateMind(state, actorId, { topic, discrepancy: topic === '粮仓交接' ? 2 : 1, counterpartId: 'player' });
}

export function getOverturnCost(state: WorldState, claim: Claim): number { return overturnCost(state, claim); }

function validateIntent(state: WorldState, intent: Intent): string | undefined {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent) || Object.keys(intent).some(key => !allowedIntentKeys.has(key))) return '动作中含有未授予的字段。';
  if (!owns(VERBS, intent.verb) || !owns(SCENES, intent.sceneId) || !works.includes(intent.workId)) return '动词、作品或场景不存在。';
  const scene = SCENES[intent.sceneId];
  if (!scene.works.includes(intent.workId)) return '作品没有获得这个场景的动作授予。';
  if (intent.actorId !== 'player' || !owns(state.entities, intent.actorId) || state.entities[intent.actorId].kind !== 'person' || !scene.grant.actorIds.includes(intent.actorId)) return '只能决定自己的门客意图，不能替其他角色或导师发号施令。';
  if (!scene.grant.verbs.includes(intent.verb)) return '导演没有在这一场授予这个动词。';
  if (state.day < 0 || state.day > YEAR_DAYS || !Number.isSafeInteger(state.day)) return '世界时钟不在这一年的范围内。';
  if (intent.workId === 'qiefu' && (state.story.completed || (scene.act !== state.story.act && !(intent.sceneId === 'night' && state.story.act === 4)))) return '此动作不在当前一幕的时间窗口内。';
  if (intent.sceneId === 'night' && intent.choice) {
    if (!state.nightRun?.finished || state.nightRun.workId !== intent.workId) return '请由潜行入口提交实际移动记录，不能直接宣告取符成功。';
    try {
      const view = replayNight(state.nightRun.frames).view;
      const { choice: actualChoice, amount: actualAmount } = deriveNightOutcome(view);
      if ((!view.finished && !state.nightRun.abandoned) || intent.choice !== actualChoice || intent.amount !== actualAmount) return '取符声明与实际移动结果不符。';
    } catch { return '潜行录制未通过。'; }
  }
  if (intent.targetId !== undefined) {
    if (typeof intent.targetId !== 'string' || !owns(state.entities, intent.targetId)) return '动作所指的人或地点不存在。';
    if (!scene.grant.actorIds.includes(intent.targetId) && !scene.items.includes(intent.targetId) && !scene.destinations.includes(intent.targetId)) return '这个对象不在本场可得视野内。';
    if (intent.targetId === intent.actorId && intent.verb !== 'observe') return '这个动作不能把自己当作交接对方。';
  }
  if (intent.itemId !== undefined && (typeof intent.itemId !== 'string' || !owns(state.entities, intent.itemId) || state.entities[intent.itemId].kind !== 'item' || !scene.items.includes(intent.itemId))) return '该物件不存在或不在这一场。';
  if (intent.amount !== undefined && intent.sceneId !== 'granary' && intent.sceneId !== 'night' && intent.verb !== 'give') return '这个动作未授予数量调度。';
  if (intent.verb === 'steal' && !intent.choice) return '取物必须由动作层提交实际取得或被发现的结果。';
  if (!intent.choice && ['say', 'persuade', 'give', 'escort', 'borrow', 'vouch', 'command'].includes(intent.verb) && intent.targetId && state.entities[intent.targetId].kind !== 'person') return '该动词须作用于本场的一位人物。';
  const rule = VERBS[intent.verb];
  if (rule.item === 'required' && !intent.itemId && !intent.choice) return '这个动作需要本场的一件物品。';
  if (rule.item === 'none' && intent.itemId !== undefined) return '这个动词没有获得携带物品的授予。';
  if (intent.amount !== undefined && (!Number.isSafeInteger(intent.amount) || intent.amount < 0 || intent.amount > 100000)) return '数量必须是范围内的非负整数。';
  if (intent.sceneId === 'night' && intent.amount !== undefined && intent.amount !== 0 && intent.amount !== 1) return '取符结果只接受零或一件兵符。';
  if (intent.sceneId === 'granary' && intent.amount !== undefined && (intent.amount < 1 || intent.amount > 6)) return '一次交接需一至六袋，不能用负数、零或无限数量复制粮。';
  if (intent.choice !== undefined && (typeof intent.choice !== 'string' || !scene.choices.includes(intent.choice))) return '该选择不是本场授予的选择。';
  if (intent.text !== undefined) {
    if (typeof intent.text !== 'string' || intent.text.length > 800) return '这一句话过长。';
    if (unsafeContent(intent.text)) return '角色听到的是世界里的话；伪指令不能成为动作或权限。';
    if (intent.text.trim() && scene.grant.language === 'hidden') return '这一场没有语言授予。';
    if (modernKnowledge.test(intent.text) && intent.sceneId !== 'studio') return '这个时代的人无法依据这些知识行动；请用眼前的人、凭证与事说话。';
    for (const ref of intent.text.matchAll(/(?:@|#|\[entity:)([a-z][a-z0-9_-]*)\]?/gi)) if (!scene.grant.actorIds.includes(ref[1]) && !scene.items.includes(ref[1]) && !scene.destinations.includes(ref[1])) return '话中引用的实体不在本场视野内。';
  }
  const storyChoice = intent.choice && storyActions[intent.sceneId]?.[intent.choice];
  if (storyChoice && !storyChoice.includes(intent.verb)) return '这个选择须用本场对应的说、给、护送或调度动作提交。';
  if (intent.sceneId === 'siege-square' && intent.choice && ((intent.choice === 'distribute' && intent.verb !== 'give') || (intent.choice === 'hold' && intent.verb !== 'persuade'))) return '散财与劝留须使用本场对应的动作。';
  if (intent.choice && intent.sceneId === 'granary' && !['give', 'say', 'persuade', 'borrow', 'vouch', 'verify'].includes(intent.verb)) return '粮仓交接须通过给、借、担保、说或核验。';
  if (intent.choice && intent.sceneId === 'court' && intent.targetId && !['weiking', 'xinling'].includes(intent.targetId)) return '这一句劝王的话须递给魏王或信陵君。';
  if (intent.choice && intent.sceneId === 'gate' && intent.targetId && !['houying', 'xinling'].includes(intent.targetId)) return '这一句折返或催行的话须递给侯嬴或信陵君。';
  if (intent.choice && intent.sceneId === 'night' && intent.targetId && intent.targetId !== 'ruji') return '护送结果只属于如姬取符这一条行动链。';
  if (intent.choice && intent.sceneId === 'camp' && intent.targetId && !['jinbi', 'xinling', 'zhuhai'].includes(intent.targetId)) return '夺军选择只能作用于眼前的晋鄙、公子与朱亥。';
  if (intent.choice && intent.sceneId === 'granary' && intent.targetId && !['keeper-suspicious', 'keeper-impatient'].includes(intent.targetId)) return '放粮交接须由本场的守仓人核对。';
  if (intent.sceneId === 'night' && intent.choice && intent.itemId && intent.itemId !== 'seal') return '取符结果须指向兵符。';
  if (intent.sceneId === 'camp' && intent.choice === 'verify' && intent.itemId && intent.itemId !== 'seal') return '合符核验需要印信。';
  if (intent.sceneId === 'court' && intent.choice === 'gift' && intent.itemId && intent.itemId !== 'wine') return '这一份礼物是本场的酒。';
  if (intent.sceneId === 'granary' && intent.choice && intent.itemId && intent.itemId !== intent.choice && intent.itemId !== 'grain') return '凭证与交接选择不一致。';
  return undefined;
}

function consolidate(draft: WorldState, days: number): void {
  for (const experience of draft.experiences) experience.consolidation = Math.round(clampUnit(experience.consolidation + days * 0.035) * 1000) / 1000;
}

function stepDay(draft: WorldState): void {
  if (draft.day < YEAR_DAYS) { draft.day += 1; consolidate(draft, 1); }
}

function addDecision(draft: WorldState, role: DecisionRecord['role'], sceneId: string, input: DecisionRecord['input'], options: string[], selected: string, reason: string): void {
  draft.decisions.push({ id: `decision-${draft.seed}-${draft.version + 1}-${draft.decisions.length + 1}`, role, actorId: role === 'director' ? (sceneId === 'granary' ? 'director-lu' : 'director') : role, day: draft.day, sceneId, input: structuredClone(input), options: [...options], selected, reason, reasonIsClaim: true });
}

function currentCast(state: WorldState): string {
  const record = [...state.decisions].reverse().find(item => item.role === 'director' && item.sceneId === 'granary' && item.options.includes('keeper-suspicious'));
  return record?.selected ?? 'keeper-suspicious';
}

function unlock(draft: WorldState): void {
  const handoffs = draft.events.filter(event => event.intent.sceneId === 'granary' && event.claimIds.some(id => draft.claims.find(claim => claim.id === id)?.predicate.startsWith('handoff.'))).length;
  const delivered = draft.claims.filter(claim => claim.createdBy !== 'seed' && claim.citations.length > 0).length;
  const recognition = Math.min(1, handoffs * 0.2 + delivered * 0.08 + (draft.story.completed ? 0.4 : 0));
  draft.relationships['player:director'] = Math.round(recognition * 1000) / 1000;
  if (recognition >= 0.6 && !draft.story.directorUnlocked) {
    draft.story.directorUnlocked = true;
    if (!draft.acknowledgments.includes('导演认可你留下的交接与亲历，下一场选角已授予。')) draft.acknowledgments.push('导演认可你留下的交接与亲历，下一场选角已授予。');
  }
}

export function applyIntent(state: WorldState, intent: Intent): ActionResult {
  const error = validateIntent(state, intent);
  if (error) return failAction(state, error);
  if (intent.sceneId === 'siege-square' && intent.choice) return distributeRelief(state, intent.choice as 'distribute' | 'hold');
  const scene = SCENES[intent.sceneId];
  const draft = copyWorld(state);
  const eventId = nextEventId(state);
  const targetId = intent.targetId ?? (intent.sceneId === 'granary' ? currentCast(state) : scene.defaultTarget ?? 'player');
  const target = draft.entities[targetId];
  const claimIds: string[] = [];
  const traces: MindTrace[] = [];
  let summary = '';
  const emit = (subject: string, predicate: string, value: Claim['value'], text: string, holders = ['player', targetId], dependencies: string[] = [], channel: Claim['channel'] = 'witnessed', endorsements?: Record<string, number>) => {
    const evidence: Evidence[] = [{ sourceId: `runtime:${eventId}`, quote: text, location: `${intent.sceneId}，第${draft.day}日`, confidence: 1 }];
    const claim = writeClaim(draft, { subject, predicate, value, text, holders: [...new Set(holders)], channel, evidence, endorsements: endorsements ?? Object.fromEntries([...new Set(holders)].map(id => [id, 0.7])), dependencies, citations: [], status: 'active', createdBy: intent.workId, day: draft.day }, eventId);
    claimIds.push(claim.id);
    return claim;
  };
  const setLink = (id: string, intact: boolean) => { const link = draft.causeChain.find(item => item.id === id); if (link && !link.fixed) link.intact = intact; };
  const think = (actorId: string, topic: string, discrepancy = 1, counterpartId = 'player', itemId?: string) => {
    const trace = evaluateMind(draft, actorId, { topic, discrepancy, counterpartId, itemId, pressure: draft.preferences.patience === 'now' ? 0.7 : 0.4 });
    traces.push(trace);
    return trace;
  };
  try {
    draft.entities.player.location = scene.location;
    if (!draft.seenWorks.includes(intent.workId)) draft.seenWorks.push(intent.workId);
    if (intent.workId === 'qiefu') draft.story.started = true;
    const choice = intent.choice;
    if (choice && intent.sceneId === 'court') {
      think('weiking', '魏王求援');
      const xinling = think('xinling', '求援');
      if (choice === 'gift') transferResource(draft, 'player', 'weiking', 'money', 1);
      draft.story.houTrust = choice === 'petition' ? 0.52 : choice === 'gift' ? 0.48 : 0.32;
      draft.relationships['player:xinling'] = clampUnit((draft.relationships['player:xinling'] ?? 0.5) + (choice === 'petition' ? 0.12 : choice === 'gift' ? 0.05 : -0.05));
      draft.story.choices.push(`court:${choice}`);
      summary = choice === 'petition' ? '你递出竹简，公子再请救赵；魏王仍畏秦而拒。正路已经试过，下一程去夷门。' : choice === 'gift' ? '你递出酒，魏王收下礼却不改止军之命。公子记住了你的斡旋，转往夷门。' : '你等到了暮色，止军之命没有变。公子决定赴难，经过夷门时还会遇见侯嬴。';
      emit('xinling', `petition.${eventId}`, choice, summary, ['player', 'xinling', 'weiking'], ['wei-order'], 'witnessed');
      emit('xinling', `reason.${eventId}`, xinling.action, xinling.reason, ['xinling'], [], 'told');
      stepDay(draft);
      draft.story.act = 2;
      draft.entities.player.location = 'yimen';
      draft.entities.xinling.location = 'yimen';
    } else if (choice && intent.sceneId === 'gate') {
      const hou = think('houying', '侯嬴托付');
      const delta = choice === 'return' ? 0.38 : choice === 'listen' ? 0.26 : -0.32;
      draft.story.houTrust = Math.round(clampUnit(draft.story.houTrust + delta) * 1000) / 1000;
      draft.relationships['player:houying'] = draft.story.houTrust;
      const entrusted = draft.story.houTrust >= 0.65;
      setLink('hou-plan', entrusted);
      draft.story.choices.push(`gate:${choice}`);
      summary = entrusted ? '你肯折返听完，侯嬴才把如姬与兵符的计策托出，并让朱亥同行。下一夜有路，也有代价。' : '你催公子离开，侯嬴没有托出完整计策。取符的一程仍能尝试，但通向夺军的这一环已经断了。';
      const plan = emit('houying', `entrust.${eventId}`, entrusted, summary, ['player', 'houying', 'xinling'], ['xinling-rescue'], 'told');
      emit('houying', `reason.${eventId}`, hou.action, hou.reason, ['houying'], [plan.id], 'told');
      if (entrusted) emit('ruji', `route.${eventId}`, 'palace-seal', '侯嬴告诉你：如姬愿报公子之恩，半符在魏宫。', ['player', 'houying', 'xinling', 'ruji'], ['ruji-debt', plan.id], 'told');
      stepDay(draft);
      draft.story.act = 3;
      draft.entities.player.location = 'palace';
      draft.entities.zhuhai.location = 'ye';
    } else if (choice && intent.sceneId === 'night') {
      const ruji = think('ruji', '取符护送');
      const guard = think('palace-guard', '观察');
      // Three ways out, not two. Being seen and still getting away keeps the seal but
      // loses the secret, so the cause link breaks even though nothing was caught.
      const spotted = choice === 'spotted';
      const obtained = (choice === 'escape' || spotted) && intent.amount === 1;
      const detected = choice === 'detected';
      const affectsStory = !draft.story.completed;
      if (affectsStory) {
        draft.story.sealObtained = obtained;
        draft.story.nightDetected = detected || spotted;
        draft.entities.seal.location = obtained ? 'player' : 'palace';
        setLink('ruji-seal', obtained && !detected && !spotted);
        draft.story.choices.push(`night:${choice}:${obtained ? 1 : 0}`);
      }
      summary = detected ? '守卫发现了这一程，如姬未能带出兵符。取符之环断了，这次失败会成为本作的历史。'
        : spotted ? '兵符出了宫，但有人看清了那一程。器物到手，秘密没有守住，这一环留下缺口。'
        : obtained ? '如姬带着半符出了宫门，你的护送留下了亲历凭证。兵符能合上，却未必能让晋鄙放下责任。'
        : '你走到了出口，但如姬手中没有兵符。脱身已被记下，取符这一环仍未完成。';
      const result = emit('ruji', `night.${eventId}`, spotted ? 'seal-escaped-spotted' : obtained ? 'seal-escaped' : detected ? 'detected' : 'escaped-without-seal', summary, ['player', 'ruji', ...(detected || spotted ? ['palace-guard'] : [])], [], 'witnessed');
      emit('ruji', `reason.${eventId}`, ruji.action, ruji.reason, ['ruji'], [result.id], 'told');
      if (detected) emit('palace-guard', `reason.${eventId}`, guard.action, guard.reason, ['palace-guard'], [result.id], 'told');
      if (affectsStory && draft.story.act === 3) { stepDay(draft); draft.story.act = 4; draft.entities.player.location = 'ye'; draft.entities.xinling.location = 'ye'; }
    } else if (choice && intent.sceneId === 'camp') {
      const beforeMind = evaluateMind(state, 'jinbi', { topic: '晋鄙合符', discrepancy: 1, counterpartId: 'player' });
      think('xinling', '晋鄙合符');
      if (choice === 'force') think('zhuhai', '晋鄙合符');
      const chainReady = draft.story.sealObtained && !draft.story.nightDetected && draft.story.houTrust >= 0.65 && ['hou-plan', 'ruji-seal'].every(id => draft.causeChain.some(link => link.id === id && link.intact && !link.replaceable && link.confidence >= 0.8));
      const negotiationLink = draft.causeChain.find(link => link.id === 'jinbi-army');
      const verificationRequested = choice === 'verify' || (choice === 'appeal' && draft.story.houTrust >= .85);
      if (chainReady && verificationRequested) {
        const receipt = draft.claims.find(c => c.subject === 'ruji' && c.predicate.startsWith('night.') && c.value === 'seal-escaped');
        emit('jinbi', `verified-authority.${eventId}`, true, '晋鄙亲自合符；公子、朱亥与士卒共同见证交軍责任，不把器物当成自动命令。', ['jinbi', 'xinling', 'zhuhai', 'soldier', 'player'], receipt ? [receipt.id] : [], 'witnessed');
        draft.relationships['jinbi:xinling'] = .8;
      }
      const jinbi = think('jinbi', '晋鄙合符');
      const mindChanged = jinbi.action !== beforeMind.action && jinbi.action.startsWith('承担');
      const negotiated = !!negotiationLink && !negotiationLink.replaceable && negotiationLink.confidence >= .8 && verificationRequested && mindChanged;
      const relief = chainReady && (choice === 'force' || negotiated);
      draft.story.jinbiFate = relief && choice === 'force' ? 'dead' : 'alive';
      draft.story.ending = relief && choice === 'force' ? 'historical' : 'counterfactual';
      draft.story.completed = true;
      draft.story.act = 5;
      draft.story.choices.push(`camp:${choice}`);
      setLink('jinbi-army', relief);
      if (relief) {
        const selected = Math.min(80000, draft.resources.jinbi.soldiers);
        const returned = draft.resources.jinbi.soldiers - selected;
        transferResource(draft, 'jinbi', 'wei', 'soldiers', returned);
        transferResource(draft, 'jinbi', 'xinling', 'soldiers', selected);
        emit('xinling', `army-selection.${eventId}`, selected, `公子按亲属情况令部分士卒返家，原十万中选出 ${selected} 人；${returned} 人归魏。`, ['player', 'xinling', 'soldier', 'wei'], [], 'witnessed');
      }
      summary = !chainReady ? '缺了可信的献计或取符，晋鄙没有交军。邯郸仍在等援；这是断链产生的本作历史，史书层保留原来的解围。' : !relief ? '你诉诸情义，晋鄙仍要求能负责十万人的核验。救援耽搁，晋鄙活着；这是本作历史。' : choice === 'force' ? '朱亥出手，晋鄙死于铁椎；魏军改由公子率领，诸侯救赵。你走到了史书所载的一条路，也见到了它的代价。' : '共同核验让晋鄙承担放行的责任，公子得军救赵，晋鄙活着。此结局标为本作历史，不回写史料。';
      const fate = emit('jinbi', 'work.fate', draft.story.jinbiFate, summary, ['player', 'jinbi', 'xinling', 'zhuhai', 'soldier'], [], 'public');
      emit('handan', 'work.siege', relief ? 'relieved' : 'still-besieged', relief ? '本作历史：诸侯援军到达，邯郸得救。' : '本作历史：夺军的关键环节未成，邯郸尚未解围。', ['player', 'xinling', 'pingyuan', 'borrower', 'citizen'], [fate.id], 'public');
      emit('jinbi', `reason.${eventId}`, jinbi.action, jinbi.reason, ['jinbi'], [fate.id], 'told');
      addDecision(draft, 'player', 'camp', { beforeAction: beforeMind.action, afterAction: jinbi.action, mindChanged, confidence: negotiationLink?.confidence || 0, replaceable: negotiationLink?.replaceable || false }, ['historical-structure', 'changed-by-verification'], negotiated ? 'changed-by-verification' : 'historical-structure', negotiated ? '核验凭据改变晋鄙的可得信念与行动；环节不可替代且置信度足够，因此本作允许保留其生还。' : '尚未同时满足心智改变、不可替代与置信度条件，不能把一句愿望直接写成生还救赵。');
      stepDay(draft);
      draft.entities.player.location = 'handan';
      if (draft.story.houTrust >= 0.65) emit('houying', 'work.farewell', 'farewell-sacrifice', '公子抵达晋鄙军时，后来传来的消息确认：侯嬴按约北向自刭。送别发生在至军之日，不等待邯郸解围的消息。', ['player', 'xinling', 'houying'], [], 'told');
    } else if (intent.sceneId === 'granary' && (choice || ['borrow', 'vouch'].includes(intent.verb) || (intent.verb === 'give' && intent.itemId !== 'grain'))) {
      const keeperId = targetId;
      if (!['keeper-suspicious', 'keeper-impatient'].includes(keeperId)) throw new Error('交接对象不是守仓人。');
      const credential = choice ?? (['seal', 'letter', 'pledge'].includes(intent.itemId ?? '') ? intent.itemId! : intent.verb === 'vouch' ? 'pledge' : 'letter');
      const amount = intent.amount ?? 2;
      if (draft.resources.granary.grain < amount) throw new Error('仓中余粮不够这一笔交接；不能从借条或印信复制粮袋。');
      if (credential === 'pledge') transferResource(draft, 'player', keeperId, 'favor', 1);
      const previousHandoffs = draft.events.filter(event => event.intent.sceneId === 'granary' && event.claimIds.some(id => draft.claims.find(claim => claim.id === id)?.predicate.startsWith('handoff.'))).length;
      const discrepancy = Number(draft.claims.find(claim => claim.id === 'grain-debt' && claim.status !== 'former-consensus')?.value ?? 2);
      const keeper = think(keeperId, '粮仓交接', Math.max(0.25, discrepancy), 'borrower', credential);
      const borrower = think('borrower', '粮仓交接', Math.max(0.25, discrepancy), keeperId, credential);
      transferResource(draft, 'granary', 'borrower', 'grain', amount);
      draft.relationships[`borrower:${keeperId}`] = Math.round(clampUnit((draft.relationships[`borrower:${keeperId}`] ?? 0.35) + (credential === 'pledge' ? 0.14 : credential === 'seal' ? 0.08 : 0.04)) * 1000) / 1000;
      summary = `${draft.entities[keeperId].name}${keeper.action.startsWith('追问') ? '先去找借粮者' : '先把凭证摆开'}，凭${draft.entities[credential].name}交出 ${amount} 袋。仓中余 ${draft.resources.granary.grain} 袋；这是第 ${previousHandoffs + 1} 次留下双方凭证的交接。`;
      const receipt = emit('borrower', `handoff.${eventId}`, amount, summary, ['player', keeperId, 'borrower'], ['granary-authority'], 'witnessed', { player: 1, [keeperId]: 1, borrower: 1 });
      const shared = keeper.coordination?.length === 3 && keeper.coordination.includes('share-receipt');
      if (shared) emit('borrower', `shared-receipt.${eventId}`, amount, `核印、对账后，守仓人与借粮者共同持有副页：本次交出 ${amount} 袋，旧首页另待复核。`, [keeperId, 'borrower', 'player'], [receipt.id], 'witnessed', { [keeperId]: 1, borrower: 1, player: 1 });
      else {
        emit('borrower', `understanding.${eventId}`, 'loan', `${draft.entities[keeperId].name}认为：这次粮已经放行，但旧的两袋欠额仍须查清。`, [keeperId, 'player'], [receipt.id], 'told', { [keeperId]: 1 });
        emit('borrower', `understanding.${eventId}`, 'relief', '借粮者认为：这批粮是守城的救急，旧账未扣掉先前已经交出的粮。', ['borrower'], [receipt.id], 'told', { borrower: 1 });
      }
      emit(keeperId, `reason.${eventId}`, keeper.action, keeper.reason, [keeperId], [receipt.id], 'told');
      emit('borrower', `reason.${eventId}`, borrower.action, borrower.reason, ['borrower'], [receipt.id], 'told');
      draft.acknowledgments.push(`交接 ${previousHandoffs + 1}：${keeperId}见证${amount}袋，${credential}，${eventId}`);
      stepDay(draft);
    } else if (intent.verb === 'visit') {
      const destination = intent.targetId ?? scene.location;
      if (!scene.destinations.includes(destination) || draft.entities[destination]?.kind !== 'place') throw new Error('这个目的地不在场景允许的路线上。');
      draft.entities.player.location = destination;
      summary = `你来到${draft.entities[destination].name}，只能看见这一场获授予的人与物。`;
      emit('player', `visit.${eventId}`, destination, summary, ['player'], [], 'witnessed');
    } else if (intent.verb === 'wait') {
      if (draft.day >= YEAR_DAYS) throw new Error('这一年的时钟已经走完，不能再向未来写入动作。');
      stepDay(draft);
      const trace = think(targetId === 'player' ? 'xinling' : targetId, '等待', 1);
      summary = `你等了一日。${draft.entities[trace.actorId].name}仍记着：${trace.action}。`;
      emit('player', `wait.${eventId}`, draft.day, summary, ['player', trace.actorId], [], 'witnessed');
    } else if (intent.verb === 'observe' || intent.verb === 'verify') {
      const actorId = target?.kind === 'person' ? targetId : intent.sceneId === 'granary' ? currentCast(draft) : scene.defaultTarget ?? 'xinling';
      const trace = think(actorId, intent.sceneId === 'granary' ? '粮仓交接' : intent.sceneId === 'camp' ? '晋鄙合符' : '观察', intent.sceneId === 'granary' ? 2 : 1);
      summary = intent.verb === 'verify' && intent.sceneId === 'granary' ? '你把仓簿首页与副页并排：副页的两袋交接没有从首页扣除。证据已拿到，但旧共识还须正式反转。' : `${draft.entities[actorId].name}此刻的动作：${trace.action}。`;
      const observation = emit(targetId, `observation.${eventId}`, intent.verb === 'verify' ? 'verified-visible-object' : 'observed', summary, ['player', actorId], [], 'witnessed');
      if (intent.verb === 'verify' && intent.sceneId === 'granary') {
        const proof = writeClaim(draft, { subject: 'granary', predicate: `ledger-proof.${eventId}`, value: 'double-counted-delivery', text: '仓簿副页表明同两袋已送出；旧首页未扣交接数。', holders: ['player', actorId, 'borrower'], channel: 'witnessed', evidence: [sourceEvidence('granary-ledger')], endorsements: { player: 1, [actorId]: 1 }, dependencies: [observation.id], citations: [], status: 'active', createdBy: 'siege', day: draft.day }, eventId);
        claimIds.push(proof.id);
      }
    } else if (intent.verb === 'say' || intent.verb === 'persuade') {
      if (!target || target.kind !== 'person') throw new Error('这句话没有递给一个眼前的人。');
      const trace = think(targetId, intent.sceneId === 'granary' ? '粮仓交接' : intent.sceneId === 'camp' ? '晋鄙合符' : intent.sceneId === 'gate' ? '侯嬴托付' : intent.sceneId === 'studio' ? '选角偏好' : '求援', 1);
      const relevant = /粮|印|账|救|赵|魏|公子|侯|符|等|为何|为什么|信|交接|偏好|选角/.test(intent.text ?? '');
      summary = relevant ? `${target.name}答：“${trace.reason}”` : `${target.name}答：“这句话我还未听明白。请指给我眼前的人、凭证或你亲历的事，我才能判断。”`;
      const testimony = emit('player', `testimony.${eventId}`, (intent.text || '').slice(0, 500), `门客当面说：“${intent.text || '眼前的话'}”`, ['player', targetId], [], 'told', { player: .5 });
      emit(targetId, `response.${eventId}`, relevant ? trace.action : 'uncertain', summary, ['player', targetId], [testimony.id], 'told');
    } else if (intent.verb === 'give') {
      if (!target || target.kind !== 'person' || !intent.itemId) throw new Error('交物须明确一个人和一件物。');
      if (intent.itemId === 'grain') {
        const amount = intent.amount ?? 2;
        transferResource(draft, 'player', targetId, 'grain', amount);
        summary = `你把自己持有的 ${amount} 袋粮交给${target.name}。`;
      } else {
        const item = draft.entities[intent.itemId];
        if (item.location !== 'player' && item.location !== scene.location) throw new Error('你并未持有或看见这件物品。');
        if (intent.itemId === 'wine') transferResource(draft, 'player', targetId, 'money', 1);
        item.location = targetId;
        summary = `你把${item.name}递给${target.name}，记录保留这一笔实际交接。`;
      }
      think(targetId, intent.sceneId === 'granary' ? '粮仓交接' : '观察');
      emit(intent.itemId, `transfer.${eventId}`, targetId, summary, ['player', targetId], [], 'witnessed');
    } else if (intent.verb === 'escort') {
      if (intent.sceneId === 'night') throw new Error('护送之夜须提交逃出或被发现的实际动作结果。');
      summary = `你护送${target?.name ?? '同行者'}走过这一场，没有提前宣告兵符或军队已到手。`;
      think(targetId, '护送');
      emit(targetId, `escort.${eventId}`, scene.location, summary, ['player', targetId], [], 'witnessed');
    } else {
      throw new Error('这个动词需要本场对应的物件或实际结果，尚不能凭空写成事件。');
    }
    for (const trace of traces) {
      if (trace.otherModel && draft.budget.tier === 'brief') delete trace.otherModel;
    }
    const playerTrace = evaluateMind(draft, 'player', { topic: intent.sceneId === 'granary' ? '粮仓交接' : intent.sceneId === 'camp' ? '晋鄙合符' : intent.sceneId === 'gate' ? '侯嬴托付' : intent.sceneId === 'night' ? '取符护送' : '求援', discrepancy: intent.sceneId === 'granary' ? intent.amount ?? 2 : 1, counterpartId: target?.kind === 'person' ? targetId : undefined });
    traces.push(playerTrace);
    const playerReason = choice ? `门客当时的选择：${choice}。${playerTrace.reason}` : `门客当时的意图：${VERBS[intent.verb].label}。${playerTrace.reason}`;
    addDecision(draft, 'player', intent.sceneId, { verb: intent.verb, target: targetId, amount: intent.amount ?? 0, currentAct: state.story.act }, choice ? scene.choices : [intent.verb], choice ?? intent.verb, playerReason);
    const mentorTrace = evaluateMind(draft, 'mentor', { topic: '偏好分配', discrepancy: draft.budget.degraded ? 1 : 0.25 });
    addDecision(draft, 'mentor', intent.sceneId, { requestedTier: draft.preferences.detail, actualTier: draft.budget.degraded ? 'brief' : draft.budget.tier, remainingDialogue: Math.max(0, draft.budget.limits.dialogue - draft.budget.dialogue) }, ['detailed', 'normal', 'brief'], draft.budget.degraded ? 'brief' : draft.budget.tier, mentorTrace.reason);
    traces.push(mentorTrace);
    const directorTrace = evaluateMind(draft, directorFor(intent.workId), { topic: '选角', discrepancy: 0.5 });
    addDecision(draft, 'director', intent.sceneId, { work: intent.workId, language: scene.grant.language, conditionsMet: draft.story.sealObtained || intent.sceneId !== 'camp' }, ['prepared-if-valid', 'live-rules'], intent.sceneId === 'camp' && !draft.story.sealObtained ? 'live-rules' : 'prepared-if-valid', directorTrace.reason);
    draft.decisions.at(-1)!.actorId = directorFor(intent.workId);
    traces.push(directorTrace);
    const result = finishOperation(state, draft, intent, summary, claimIds, traces);
    unlock(result.state);
    return result;
  } catch (failure) { return failAction(state, failure); }
}

export function citeClaims(state: WorldState, workId: string, claimIds: string[]): WorldState {
  if (!works.includes(workId) || !Array.isArray(claimIds) || claimIds.length > 100 || claimIds.some(id => !state.claims.some(claim => claim.id === id))) return state;
  const ids = [...new Set(claimIds)].sort();
  if (!ids.some(id => !state.claims.find(claim => claim.id === id)!.citations.includes(workId))) return state;
  const draft = copyWorld(state);
  for (const claim of draft.claims) if (ids.includes(claim.id) && !claim.citations.includes(workId)) {
    claim.citations.push(workId);
    claim.endorsements.director = Math.min(3, (claim.endorsements.director ?? 0) + 0.25);
    claim.version = state.version + 1;
  }
  if (!draft.seenWorks.includes(workId as Intent['workId'])) draft.seenWorks.push(workId as Intent['workId']);
  const result = finishOperation(state, draft, systemIntent('cite', { workId, claimIds: ids }, workId as Intent['workId']), `《${workId}》引用了 ${ids.length} 条已有主张；引用留下记录，并增加其推翻成本。`, ids);
  unlock(result.state);
  return result.state;
}

export function proposeReversal(state: WorldState, oldClaimId: string, evidence: Evidence[], explanation: string, proposed: Omit<Claim, 'id' | 'version'>): ActionResult {
  const old = state.claims.find(claim => claim.id === oldClaimId);
  if (!old || old.status === 'former-consensus') return failAction(state, '旧主张不存在，或已经成为曾经的共识。');
  if (!proposed || proposed.subject !== old.subject || proposed.predicate !== old.predicate || proposed.value === old.value || typeof explanation !== 'string' || explanation.trim().length < 12 || explanation.length > 1200 || unsafeContent(explanation)) return failAction(state, '反转须针对同一件事给出不同的主张，并解释旧共识为什么会错。');
  const proofErrors = evidenceErrors(state, evidence);
  if (proofErrors.length || !evidence.some(item => item.confidence >= 0.6)) return failAction(state, proofErrors.join(' ') || '至少一条新证据应有足够置信度。');
  const draft = copyWorld(state);
  const normalized: Omit<Claim, 'id' | 'version'> = { ...structuredClone(proposed), evidence: structuredClone(evidence), day: state.day, status: 'active', supersedes: old.id };
  try {
    assertClaimReferences(state.entities, state.claims, { ...normalized, id: `proposal-${state.version + 1}`, version: state.version + 1 }, state.events);
    if (normalized.dependencies.some(id => id === old.id || dependentClaims(state, old.id).some(claim => claim.id === id))) throw new Error('新主张不能依赖它准备推翻的旧共识或其下游。');
    const cost = overturnCost(state, old);
    if (cost < REVERSAL_THRESHOLD) {
      delete normalized.supersedes;
      const newClaim = writeClaim(draft, normalized);
      const summary = '认可度尚低，两种说法作为误会并存；旧主张与新主张各有持有者，没有抹掉任何一方。';
      return finishOperation(state, draft, systemIntent('propose-reversal', { oldClaimId, evidence, explanation, proposed }), summary, [old.id, newClaim.id]);
    }
    if (state.reversals.some(item => item.oldClaimId === old.id && item.status === 'pending')) throw new Error('这条旧共识已有待批准的反转，请先处理原申请。');
    const reversal = { id: `reversal-${state.seed}-${state.version + 1}-${state.reversals.length + 1}`, oldClaimId, proposed: normalized, cost, evidence: structuredClone(evidence), explanation: explanation.trim(), dependentIds: dependentClaims(state, old.id).map(claim => claim.id), status: 'pending' as const };
    draft.reversals.push(reversal);
    addDecision(draft, 'player', 'studio', { oldClaimId, cost, downstream: reversal.dependentIds.length }, ['keep-consensus', 'request-reversal'], 'request-reversal', `门客当时的解释：${explanation.trim()}`);
    const result = finishOperation(state, draft, systemIntent('propose-reversal', { oldClaimId, evidence, explanation, proposed }), `反转已登记，推翻成本 ${cost}，${reversal.dependentIds.length} 条下游待重算；旧共识仍保留。`);
    return { ...result, pendingReversal: structuredClone(reversal) };
  } catch (failure) { return failAction(state, failure); }
}

export function approveReversal(state: WorldState, reversalId: string, authority: 'director' | 'mentor'): ActionResult {
  if (!['director', 'mentor'].includes(authority) || state.entities[authority]?.role !== authority) return failAction(state, '批准者不是世界中获授予的导演或导师。');
  const reversal = state.reversals.find(item => item.id === reversalId && item.status === 'pending');
  const old = state.claims.find(claim => claim.id === reversal?.oldClaimId);
  if (!reversal || !old || old.status === 'former-consensus') return failAction(state, '没有可批准的待定反转。');
  const proofErrors = evidenceErrors(state, reversal.evidence);
  if (proofErrors.length || reversal.explanation.trim().length < 12) return failAction(state, proofErrors.join(' ') || '反转尚缺新证据或旧共识错误的解释。');
  const draft = copyWorld(state);
  try {
    const next = writeClaim(draft, { ...structuredClone(reversal.proposed), supersedes: old.id, day: state.day, status: 'active', evidence: structuredClone(reversal.evidence) }, undefined, old.id);
    const previous = draft.claims.find(claim => claim.id === old.id)!;
    previous.status = 'former-consensus';
    previous.version = state.version + 1;
    const downstream = dependentClaims(state, old.id);
    for (const dependent of draft.claims) if (downstream.some(item => item.id === dependent.id) && dependent.status !== 'former-consensus') {
      dependent.status = 'disputed';
      dependent.version = state.version + 1;
    }
    const recomputedIds: string[] = [];
    for (const dependent of downstream) if (dependent.predicate === 'allocation-review') {
      const revised = writeClaim(draft, { subject: dependent.subject, predicate: `allocation-recomputed.${state.version + 1}`, value: Number(next.value) === 0 ? 'release-with-receipt' : 'review-deficit', text: Number(next.value) === 0 ? '根据新副页重算：旧两袋已交付，撤除由旧欠额引出的扣留要求；下一笔仍须核验当前库存。' : '根据新凭据重算后仍有欠额，下一笔继续核验。', holders: [...dependent.holders], channel: 'public', evidence: structuredClone(reversal.evidence), endorsements: { [authority]: 1 }, dependencies: [next.id], citations: [], status: 'active', createdBy: 'studio', day: state.day });
      recomputedIds.push(revised.id);
    }
    const recorded = draft.reversals.find(item => item.id === reversalId)!;
    recorded.status = 'approved';
    recorded.cost = overturnCost(state, old);
    recorded.approval = authority;
    recorded.newClaimId = next.id;
    recorded.dependentIds = downstream.map(item => item.id);
    addDecision(draft, authority, 'studio', { reversalId, cost: reversal.cost, evidenceCount: reversal.evidence.length, recomputed: downstream.length }, ['retain', 'approve-with-review'], 'approve-with-review', `${draft.entities[authority].name}当时的说法：${reversal.explanation}；旧共识保留，下游因旧前提失效标为待复核。`);
    const trace = evaluateMind(draft, authority, { topic: '粮账核验', discrepancy: downstream.length || 1 });
    const summary = `旧主张已标为“曾经的共识”。新证据说明：${reversal.explanation}。${downstream.length} 条旧依赖标为待复核，${recomputedIds.length} 条分配已按新凭据重算；原依赖保留。`;
    return finishOperation(state, draft, systemIntent('approve-reversal', { reversalId, authority }), summary, [old.id, next.id, ...downstream.map(item => item.id), ...recomputedIds], [trace]);
  } catch (failure) { return failAction(state, failure); }
}

export function advanceClock(state: WorldState, days: number): WorldState {
  if (!Number.isSafeInteger(days) || days <= 0 || state.day >= YEAR_DAYS) return state;
  const elapsed = Math.min(days, YEAR_DAYS - state.day);
  const draft = copyWorld(state);
  draft.day += elapsed;
  consolidate(draft, elapsed);
  const supplied = Math.min(draft.resources.granary?.grain ?? 0, elapsed);
  if (supplied > 0) transferResource(draft, 'granary', 'citizen', 'grain', supplied);
  const eventId = nextEventId(state);
  const summary = `回访补算 ${elapsed} 日：仓房向守城者交出 ${supplied} 袋，余 ${draft.resources.granary.grain} 袋；旧经历随时间巩固。${elapsed > supplied ? '未获供粮的日子仍留作缺额，不凭空补粮。' : ''}`;
  const claim = writeClaim(draft, { subject: 'granary', predicate: `clock.${eventId}`, value: elapsed, text: summary, holders: ['player', 'keeper-suspicious', 'keeper-impatient', 'borrower', 'citizen'], channel: 'public', evidence: [{ sourceId: `runtime:${eventId}`, quote: summary, location: `回访，第${draft.day}日`, confidence: 1 }], endorsements: { player: 1 }, dependencies: [], citations: [], status: 'active', createdBy: 'siege', day: draft.day }, eventId);
  const traces = [evaluateMind(draft, 'keeper-suspicious', { topic: '粮仓交接', discrepancy: Math.max(0.25, elapsed - supplied), counterpartId: 'borrower' })];
  return finishOperation(state, draft, systemIntent('advance-clock', { days }), summary, [claim.id], traces).state;
}

export function changePreferences(state: WorldState, patch: Partial<Preferences>): WorldState {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['patience', 'freedom', 'detail', 'surprises'].includes(key))) return state;
  if ((patch.patience !== undefined && !['now', 'later'].includes(patch.patience)) || (patch.freedom !== undefined && !['crafted', 'open'].includes(patch.freedom)) || (patch.detail !== undefined && !['detailed', 'normal', 'brief'].includes(patch.detail)) || (patch.surprises !== undefined && typeof patch.surprises !== 'boolean')) return state;
  const canonical: Partial<Preferences> = {};
  for (const key of ['patience', 'freedom', 'detail', 'surprises'] as const) if (patch[key] !== undefined) Object.assign(canonical, { [key]: patch[key] });
  if (!Object.keys(canonical).length) return state;
  const draft = copyWorld(state);
  draft.preferences = { ...draft.preferences, ...canonical };
  if (!draft.acknowledgments.includes('onboarded')) draft.acknowledgments.push('onboarded');
  draft.budget.tier = draft.preferences.detail;
  const trace = evaluateMind(draft, 'mentor', { topic: '偏好分配', discrepancy: Object.keys(canonical).length });
  addDecision(draft, 'mentor', 'studio', { patience: draft.preferences.patience, freedom: draft.preferences.freedom, detail: draft.preferences.detail, surprises: draft.preferences.surprises }, ['detailed', 'normal', 'brief'], draft.preferences.detail, trace.reason);
  return finishOperation(state, draft, systemIntent('change-preferences', { patch: canonical }), '导师把你的更正当场记下；下一场按新的细节档与等待意愿分配。', [], [trace]).state;
}

export function chooseDirectorCast(state: WorldState, actorId: string): ActionResult {
  if (!state.story.directorUnlocked) return failAction(state, '导演尚未认可足够多的亲历与引用；导演椅还未授予选角。');
  if (!['keeper-suspicious', 'keeper-impatient'].includes(actorId) || !owns(state.entities, actorId)) return failAction(state, '第一版只授予下一场两位守仓人的选角。');
  const draft = copyWorld(state);
  const trace = evaluateMind(draft, 'director-lu', { topic: '选角', discrepancy: 1, counterpartId: actorId });
  addDecision(draft, 'director', 'granary', { actorId, recognizedBy: 'director', previous: currentCast(state) }, ['keeper-suspicious', 'keeper-impatient'], actorId, `${trace.reason}；下一场把同一欠额交给${draft.entities[actorId].name}。`);
  return finishOperation(state, draft, systemIntent('choose-cast', { actorId }), `下一场由${draft.entities[actorId].name}守仓；未指定交接对象时，使用这次当场记下的选角。`, [], [trace]);
}

function parseReplayPayload(event: WorldEvent): Record<string, unknown> {
  if (!event.intent.text || event.intent.text.length > 800000) throw new Error('重放的结构化载荷缺失或过长。');
  const payload: unknown = JSON.parse(event.intent.text);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('重放载荷必须是结构化对象。');
  return payload as Record<string, unknown>;
}

export function replayEvents(initial: WorldState, events: WorldEvent[]): WorldState {
  let state = copyWorld(initial);
  for (const expected of events) {
    if (expected.beforeVersion !== state.version) throw new Error(`重放版本不连续：${expected.id}`);
    let next: WorldState;
    if (expected.intent.sceneId === '@kernel') {
      const payload = parseReplayPayload(expected);
      switch (expected.intent.choice) {
        case 'cite': next = citeClaims(state, payload.workId as string, payload.claimIds as string[]); break;
        case 'presentation': { const result = preparePresentation(state, payload.workId as import('./types').WorkId, payload.sceneId as string, payload.tier as import('./types').Tier); if (!result.ok) throw new Error(result.message); next = result.state; break; }
        case 'model-call': next = recordCall(state, payload.outcome as import('./presentation').CallOutcome); break;
        case 'renew-budget': next = renewBudget(state, payload.hourStarted as number); break;
        case 'reset-world': next = resetWorld(state); break;
        case 'night-run': { const result = recordNightRun(state, payload.workId as 'qiefu' | 'night', payload.frames, payload.finished as boolean, payload.abandoned as boolean); if (!result.ok) throw new Error(result.message); next = result.state; break; }
        case 'import-anchor': next = anchorImport(state, payload.newVersion as number).state; break;
        case 'advance-clock': next = advanceClock(state, payload.days as number); break;
        case 'change-preferences': next = changePreferences(state, payload.patch as Partial<Preferences>); break;
        case 'choose-cast': { const result = chooseDirectorCast(state, payload.actorId as string); if (!result.ok) throw new Error(result.message); next = result.state; break; }
        case 'propose-reversal': { const result = proposeReversal(state, payload.oldClaimId as string, payload.evidence as Evidence[], payload.explanation as string, payload.proposed as Omit<Claim, 'id' | 'version'>); if (!result.ok) throw new Error(result.message); next = result.state; break; }
        case 'approve-reversal': { const result = approveReversal(state, payload.reversalId as string, payload.authority as 'director' | 'mentor'); if (!result.ok) throw new Error(result.message); next = result.state; break; }
        case 'install-mechanism': { const result = installMechanism(state, payload.mechanism as import('./types').Mechanism); if (!result.ok) throw new Error(result.message); next = result.state; break; }
        case 'rollback-mechanism': next = rollbackMechanism(state, payload.id as string); break;
        default: throw new Error('重放中出现未知内核操作。');
      }
    } else {
      const result = applyIntent(state, expected.intent);
      if (!result.ok) throw new Error(`重放动作不再成立：${result.message}`);
      next = result.state;
    }
    const actual = next.events[next.events.length - 1];
    if (!actual || actual.id !== expected.id || actual.beforeVersion !== expected.beforeVersion || actual.afterVersion !== expected.afterVersion || actual.day !== expected.day || actual.summary !== expected.summary || JSON.stringify(actual.claimIds) !== JSON.stringify(expected.claimIds) || JSON.stringify(actual.traces) !== JSON.stringify(expected.traces)) throw new Error(`重放证据与录制事件不同：${expected.id}`);
    state = next;
  }
  return state;
}

export function checkConsistency(state: WorldState): ConsistencyResult {
  const checks: ConsistencyResult['checks'] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const claim of state.claims) {
    if (ids.has(claim.id)) errors.push(`重复主张 ${claim.id}`);
    ids.add(claim.id);
    try { assertClaimReferences(state.entities, state.claims, claim, state.events); } catch (error) { errors.push(`${claim.id}：${error instanceof Error ? error.message : error}`); }
    if (claim.day > state.day || claim.version > state.version) errors.push(`${claim.id} 来自未来`);
  }
  add('主张接地与证据来源', errors.length === 0, errors.join('；') || `${state.claims.length} 条主张的实体、持有者、来源与时间均可追溯；未核验原典明确标为待核验。`);
  const resourceErrors = Object.entries(state.resources).flatMap(([id, values]) => !owns(state.entities, id) || Object.values(values).some(value => !Number.isSafeInteger(value) || value < 0) || ['grain', 'money', 'soldiers', 'favor'].some(key => !owns(values, key)) ? [id] : []);
  add('有限资源', resourceErrors.length === 0, resourceErrors.length ? `资源异常：${resourceErrors.join('、')}` : '四类资源均为非负整数；每笔转移扣减实际来源。');
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const cyclic = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const claim = state.claims.find(item => item.id === id);
    if (claim?.dependencies.some(cyclic)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  const cycles = state.claims.some(claim => cyclic(claim.id));
  add('依赖图', !cycles, cycles ? '主张依赖存在循环。' : '依赖无循环，反转的下游可完整枚举。');
  const contradictions: string[] = [];
  for (let i = 0; i < state.claims.length; i += 1) for (let j = i + 1; j < state.claims.length; j += 1) {
    const a = state.claims[i], b = state.claims[j];
    if (a.status === 'active' && b.status === 'active' && a.subject === b.subject && a.predicate === b.predicate && a.value !== b.value) contradictions.push(`${a.id}/${b.id}`);
  }
  add('冲突分档', contradictions.length === 0, contradictions.length ? `未经争议或反转的冲突：${contradictions.join('、')}` : '不同说法已标争议；高认可共识的替换必须经过批准。');
  const reversalErrors: string[] = [];
  for (const reversal of state.reversals.filter(item => item.status === 'approved')) {
    const old = state.claims.find(claim => claim.id === reversal.oldClaimId);
    const next = state.claims.find(claim => claim.id === reversal.newClaimId);
    if (!old || old.status !== 'former-consensus' || !next || next.supersedes !== old.id || !reversal.approval || reversal.explanation.trim().length < 12 || evidenceErrors(state, reversal.evidence).length || reversal.dependentIds.some(id => { const dependent = state.claims.find(claim => claim.id === id); return !dependent || dependent.status === 'active'; })) reversalErrors.push(reversal.id);
  }
  for (const claim of state.claims.filter(item => item.status === 'former-consensus')) if (!state.reversals.some(reversal => reversal.status === 'approved' && reversal.oldClaimId === claim.id)) reversalErrors.push(`缺批准：${claim.id}`);
  add('反转与下游审计', reversalErrors.length === 0, reversalErrors.join('；') || '旧共识未删除，每次批准均保留证据、解释、权限与下游复核状态。');
  const privacyErrors = Object.values(state.entities).filter(entity => entity.role === 'actor').flatMap(actor => getActorView(state, actor.id).filter(claim => !claim.holders.includes(actor.id) && claim.channel !== 'public').map(claim => `${actor.id}:${claim.id}`));
  add('角色可得视图', privacyErrors.length === 0, privacyErrors.join('；') || '私有亲历和听闻只对持有者可见；演员不会读到史料层未来结局或导师偏好。');
  const eventIds = new Set<string>();
  const eventErrors: string[] = [];
  let priorVersion = state.events.length ? state.events[0].beforeVersion : state.version;
  let priorDay = 0;
  for (const event of state.events) {
    const importedAnchor = event.intent.sceneId === '@kernel' && event.intent.choice === 'import-anchor';
    let validVersion = event.afterVersion === event.beforeVersion + 1;
    if (importedAnchor) {
      try { validVersion = Number.isSafeInteger(event.afterVersion) && event.afterVersion > event.beforeVersion && parseReplayPayload(event).newVersion === event.afterVersion; } catch { validVersion = false; }
    }
    if (eventIds.has(event.id) || event.beforeVersion !== priorVersion || !validVersion || event.day < priorDay || event.day > YEAR_DAYS || event.claimIds.some(id => !ids.has(id))) eventErrors.push(event.id);
    eventIds.add(event.id); priorVersion = event.afterVersion; priorDay = event.day;
  }
  if (state.events.length && priorVersion !== state.version) eventErrors.push('尾版本不符');
  add('确定性事件序列', eventErrors.length === 0, eventErrors.join('；') || '事件版本连续，日数有界，重放入口逐条比对当时轨迹。');
  add('一年时钟与记忆', Number.isSafeInteger(state.day) && state.day >= 0 && state.day <= YEAR_DAYS && state.experiences.every(memory => owns(state.entities, memory.actorId) && eventIds.has(memory.eventId) && memory.day <= state.day && memory.consolidation >= 0 && memory.consolidation <= 1 && memory.claimIds.every(id => ids.has(id))), '时间最多推进 365 日；性情与手艺留在实体，具体经历独立存储与巩固。');
  let nightValid = true;
  if (state.nightRun) { try { const game = replayNight(state.nightRun.frames); nightValid = ['qiefu', 'night'].includes(state.nightRun.workId) && (!state.nightRun.finished || game.view.finished || state.nightRun.abandoned === true); } catch { nightValid = false; } }
  add('潜行物理录制', nightValid, nightValid ? '方向、步数、视线、遮挡、取符与出口由同一固定步长重算。' : '潜行结果与录制不相符。');
  const mechanismErrors = state.mechanisms.filter(item => !validateMechanism(item).ok || (item.installed && !item.audit.every(a => a.passed))).map(item => item.id);
  add('已装机制', mechanismErrors.length === 0, mechanismErrors.length ? mechanismErrors.join('、') : '机制只读取声明字段，审计与版本保留，安装和回滚都有事件。');
  const historicalErrors = state.claims.filter(claim => claim.createdBy !== 'seed' && claim.predicate.startsWith('history.')).filter(claim => !state.reversals.some(reversal => reversal.status === 'approved' && reversal.newClaimId === claim.id)).map(claim => claim.id);
  add('史料与本作历史', historicalErrors.length === 0, historicalErrors.join('；') || '演员行动写入 work.* 与亲历；史书层保持独立，本作结局不会伪装成史实。');
  return { ok: checks.every(check => check.passed), checks };
}
