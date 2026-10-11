import type { CauseLink, Claim, DecisionRecord, Entity, Resource, WorldState } from './types';
import { CHARACTERS, ITEMS, ORGANIZATIONS, PLACES, sourceEvidence } from '../data/catalog';
import { GRAIN_CAPACITY } from '../data/rules';

export function createWorld(seed = 42): WorldState {
  const normalizedSeed = Number.isSafeInteger(seed) ? seed : 42;
  const entities: Record<string, Entity> = {};
  for (const entity of [...CHARACTERS, ...PLACES, ...ITEMS, ...ORGANIZATIONS]) entities[entity.id] = structuredClone(entity);
  const claims: Claim[] = [];
  const add = (claim: Omit<Claim, 'day' | 'version' | 'status' | 'createdBy'> & Partial<Pick<Claim, 'day' | 'version' | 'status' | 'createdBy'>>) => {
    if (!entities[claim.subject] || claim.holders.some(id => !entities[id])) throw new Error('Ungrounded seed claim');
    if (claim.dependencies.some(id => !claims.some(parent => parent.id === id))) throw new Error('Unresolved seed dependency');
    claims.push({ status: 'active', createdBy: 'seed', day: 0, version: 1, ...claim });
  };
  const historicalHolders = ['director', 'mentor'];
  add({ id: 'history-wei-halt', subject: 'weiking', predicate: 'history.order', value: 'halt-at-ye', text: '史书记载：魏王畏秦，命晋鄙止军于邺。《战国策》作荡阴，两说保留；具体地理复原待审定。', holders: historicalHolders, channel: 'setting', evidence: [sourceEvidence('shiji-wei-halt')], endorsements: { director: 2, mentor: 2, wei: 2 }, dependencies: [], citations: ['prologue', 'qiefu'] });
  add({ id: 'history-jinbi-fate', subject: 'jinbi', predicate: 'history.fate', value: 'dead', text: '史书记载：晋鄙合符而疑，朱亥以铁椎击杀。演员在事件发生前不知此结局。', holders: historicalHolders, channel: 'setting', evidence: [sourceEvidence('shiji-wei')], endorsements: { director: 2, mentor: 2, wei: 2 }, dependencies: ['history-wei-halt'], citations: ['qiefu'] });
  add({ id: 'history-hou-farewell', subject: 'houying', predicate: 'history.farewell', value: 'self-sacrifice', text: '史书记载：侯嬴约在公子至军之日北向自刭。此处是史料层，不是尚未发生的本作事件。', holders: historicalHolders, channel: 'setting', evidence: [sourceEvidence('shiji-wei-hou')], endorsements: { director: 2, mentor: 2 }, dependencies: [], citations: ['qiefu'] });
  add({ id: 'history-handan-relief', subject: 'handan', predicate: 'history.siege', value: 'relieved', text: '史书记载：诸侯救赵，邯郸解围。第一版的反事实不改写这一层。', holders: historicalHolders, channel: 'setting', evidence: [sourceEvidence('shiji-baiqi')], endorsements: { director: 2, mentor: 2, zhao: 2 }, dependencies: ['history-wei-halt'], citations: ['prologue', 'qiefu', 'siege'] });
  add({ id: 'wei-order', subject: 'jinbi', predicate: 'command', value: 'hold', text: '当前公开王命：晋鄙率军止步，等待魏王下一道命令。', holders: ['weiking', 'xinling', 'jinbi', 'player', 'soldier'], channel: 'public', evidence: [sourceEvidence('shiji-wei-halt')], endorsements: { weiking: 2, jinbi: 2, soldier: 1 }, dependencies: [], citations: ['prologue'] });
  add({ id: 'wei-fear', subject: 'weiking', predicate: 'fear', value: 'qin', text: '魏王忧虑：若救赵，秦会先攻魏。', holders: ['weiking'], channel: 'told', evidence: [sourceEvidence('shiji-wei-halt')], endorsements: { weiking: 1 }, dependencies: [], citations: [] });
  add({ id: 'xinling-rescue', subject: 'xinling', predicate: 'goal', value: 'rescue-zhao', text: '信陵君公开求救赵；若正路不通，愿与门客赴难。', holders: ['xinling', 'player', 'houying'], channel: 'public', evidence: [sourceEvidence('shiji-wei-halt')], endorsements: { xinling: 1.5, player: 0.5 }, dependencies: ['wei-order'], citations: [] });
  add({ id: 'hou-test', subject: 'houying', predicate: 'attention', value: 'sincerity', text: '侯嬴自己认为：来人肯折返听一个守门老人说话，才值得托付。', holders: ['houying'], channel: 'setting', evidence: [sourceEvidence('world-design')], endorsements: { houying: 1 }, dependencies: [], citations: [] });
  add({ id: 'ruji-debt', subject: 'ruji', predicate: 'gratitude', value: 'xinling', text: '如姬记着信陵君为父报仇，愿报答他。', holders: ['ruji', 'xinling', 'houying'], channel: 'told', evidence: [sourceEvidence('shiji-wei-ruji')], endorsements: { ruji: 1.5 }, dependencies: [], citations: [] });
  add({ id: 'jinbi-duty', subject: 'jinbi', predicate: 'belief', value: 'verify-authority', text: '晋鄙认为：合符可证器物，却仍须判断谁能负责十万人的去向。', holders: ['jinbi'], channel: 'setting', evidence: [sourceEvidence('world-design')], endorsements: { jinbi: 1.5 }, dependencies: ['wei-order'], citations: [] });
  add({ id: 'grain-debt', subject: 'borrower', predicate: 'grain-debt', value: 2, text: '仓簿首页的旧共识：借粮者还有两袋未归。', holders: ['keeper-suspicious', 'keeper-impatient', 'player'], channel: 'public', evidence: [sourceEvidence('granary-ledger', 0.65)], endorsements: { 'keeper-suspicious': 1.5, 'keeper-impatient': 1.5, pingyuan: 2, zhao: 1 }, dependencies: [], citations: ['siege'] });
  add({ id: 'grain-allocation', subject: 'granary', predicate: 'allocation-review', value: 'withhold-two', text: '守仓人据首页欠额，决定下一笔交接要复核。', holders: ['keeper-suspicious', 'keeper-impatient', 'player'], channel: 'public', evidence: [sourceEvidence('world-design')], endorsements: { 'keeper-suspicious': 1, 'keeper-impatient': 1 }, dependencies: ['grain-debt'], citations: ['siege'] });
  add({ id: 'borrower-account', subject: 'borrower', predicate: 'account-position', value: 'delivered-to-defenders', text: '借粮者自己说：那两袋已交给守城人，仓簿未记；他还拿不出被双方认可的副页。', holders: ['borrower'], channel: 'told', evidence: [sourceEvidence('granary-ledger', 0.5)], endorsements: { borrower: 0.7 }, dependencies: [], citations: [] });
  add({ id: 'granary-authority', subject: 'granary', predicate: 'authority', value: 'keepers', text: '平原君与守城者认可：守仓人凭记录放粮，仓中粮不能凭一句话复制。', holders: ['keeper-suspicious', 'keeper-impatient', 'borrower', 'player', 'pingyuan'], channel: 'public', evidence: [sourceEvidence('world-design')], endorsements: { pingyuan: 2, zhao: 2 }, dependencies: [], citations: [] });

  const resources: Record<string, Record<Resource, number>> = {};
  for (const entity of Object.values(entities)) resources[entity.id] = { grain: 0, money: 0, soldiers: 0, favor: 0 };
  resources.granary.grain = GRAIN_CAPACITY;
  resources.player = { grain: 0, money: 4, soldiers: 0, favor: 6 };
  resources.xinling = { grain: 2, money: 12, soldiers: 0, favor: 18 };
  resources.weiking = { grain: 10, money: 30, soldiers: 0, favor: 25 };
  resources.jinbi = { grain: 6, money: 2, soldiers: 100000, favor: 12 };
  resources.pingyuan = { grain: 3, money: 20, soldiers: 3000, favor: 14 };
  resources.wei = { grain: 30, money: 50, soldiers: 0, favor: 20 };
  resources.zhao = { grain: 2, money: 5, soldiers: 0, favor: 10 };
  resources.chu = { grain: 20, money: 30, soldiers: 80000, favor: 12 };
  resources.qin = { grain: 20, money: 30, soldiers: 150000, favor: 4 };
  resources['keeper-suspicious'].favor = 5;
  resources['keeper-impatient'].favor = 5;
  resources.borrower.favor = 3;

  const link = (id: string, actorId: string, label: string, belief: string, resource: string, confidence: number, fixed: boolean, sourceId: string): CauseLink => ({
    id, actorId, label, belief, resource, confidence, replaceable: fixed, fixed, intact: true, evidence: [sourceEvidence(sourceId, confidence)],
  });
  const causeChain = [
    link('wei-halt', 'weiking', '魏王止步', '畏秦，先保魏境', '王命与兵权', 0.95, true, 'shiji-wei'),
    link('xinling-petition', 'xinling', '穷尽正路', '救赵且不负亲人', '门客、游说与人情', 0.9, false, 'shiji-wei'),
    link('hou-plan', 'houying', '侯嬴献计', '来人值得托付', '识人、宫中消息', 0.92, false, 'shiji-wei-hou'),
    link('ruji-seal', 'ruji', '如姬取符', '报知遇与父仇之恩', '寝宫通路与半符', 0.94, false, 'shiji-wei-ruji'),
    link('jinbi-army', 'jinbi', '邺城夺军', '凭符调兵仍有疑虑', '十万魏军与铁椎', 0.93, false, 'shiji-wei'),
    link('handan-relief', 'pingyuan', '诸侯解围', '联军到达才足以解围', '魏楚赵援军', 0.9, true, 'shiji-baiqi'),
  ];
  const decisions: DecisionRecord[] = [
    { id: 'decision-seed-mentor', role: 'mentor', day: 0, sceneId: 'studio', input: { detail: 'normal', preferencesConfirmed: false }, options: ['detailed', 'normal', 'brief'], selected: 'normal', reason: '导师当时的说法：先给普通档，等你用三个粗问题更正偏好。', reasonIsClaim: true },
    { id: 'decision-seed-director', role: 'director', day: 0, sceneId: 'court', input: { firstWork: 'prologue', interaction: 0 }, options: ['prologue', 'qiefu', 'siege'], selected: 'prologue', reason: '导演当时的说法：先让你看见邯郸，再把递话的按钮交到你手上。', reasonIsClaim: true },
  ];
  return {
    schemaVersion: 1, id: `world-${normalizedSeed}`, version: 1, seed: normalizedSeed, day: 0, lastSeen: 0,
    entities, claims, experiences: [], resources, relationships: { 'player:houying': 0.4, 'player:xinling': 0.5, 'player:director': 0 }, events: [], decisions, reversals: [],
    preferences: { patience: 'now', freedom: 'crafted', detail: 'normal', surprises: true },
    budget: { hourStarted: 0, dialogue: 0, imagination: 0, modification: 0, limits: { dialogue: 30, imagination: 6, modification: 1 }, tier: 'normal', degraded: false, ledger: [] },
    mechanisms: [], causeChain,
    story: { act: 1, started: false, completed: false, sealObtained: false, nightDetected: false, houTrust: 0.4, jinbiFate: 'unknown', ending: 'unknown', directorUnlocked: false, choices: [] },
    seenWorks: [], acknowledgments: [],
  };
}
