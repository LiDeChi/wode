import type { SceneGrant, Verb, WorkId } from '../core/types';

export interface VerbRule {
  id: Verb;
  label: string;
  target: 'person' | 'place' | 'person-or-item' | 'optional';
  item: 'required' | 'optional' | 'none';
  resource?: 'grain' | 'money' | 'soldiers' | 'favor';
  effect: 'movement' | 'transfer' | 'speech' | 'attention' | 'loan' | 'guarantee' | 'verification' | 'theft' | 'escort' | 'authority' | 'clock';
}

export const VERBS: Record<Verb, VerbRule> = {
  visit: { id: 'visit', label: '去', target: 'place', item: 'none', effect: 'movement' },
  give: { id: 'give', label: '给', target: 'person', item: 'required', effect: 'transfer' },
  say: { id: 'say', label: '说', target: 'person', item: 'optional', effect: 'speech' },
  persuade: { id: 'persuade', label: '劝', target: 'person', item: 'optional', effect: 'speech' },
  observe: { id: 'observe', label: '看', target: 'person-or-item', item: 'none', effect: 'attention' },
  borrow: { id: 'borrow', label: '借', target: 'person', item: 'required', resource: 'grain', effect: 'loan' },
  vouch: { id: 'vouch', label: '担保', target: 'person', item: 'required', resource: 'favor', effect: 'guarantee' },
  verify: { id: 'verify', label: '核验', target: 'person-or-item', item: 'optional', effect: 'verification' },
  steal: { id: 'steal', label: '取', target: 'optional', item: 'required', effect: 'theft' },
  escort: { id: 'escort', label: '护送', target: 'person', item: 'optional', effect: 'escort' },
  command: { id: 'command', label: '调度', target: 'person', item: 'optional', resource: 'soldiers', effect: 'authority' },
  wait: { id: 'wait', label: '等', target: 'optional', item: 'none', effect: 'clock' },
};

export interface SceneRule {
  grant: SceneGrant;
  location: string;
  works: WorkId[];
  act?: number;
  items: string[];
  destinations: string[];
  choices: string[];
  defaultTarget?: string;
}

export const SCENES: Record<string, SceneRule> = {
  court: {
    grant: { sceneId: 'court', verbs: ['visit', 'give', 'say', 'persuade', 'observe', 'wait'], language: 'selected', actorIds: ['player', 'xinling', 'weiking', 'zhao-envoy', 'qin-envoy'], preconditions: ['第一幕', '由门客递话；魏王的畏秦不能直接改写'] },
    location: 'daliang', works: ['qiefu'], act: 1, items: ['bamboo', 'wine'], destinations: ['daliang'], choices: ['petition', 'gift', 'wait'], defaultTarget: 'weiking',
  },
  gate: {
    grant: { sceneId: 'gate', verbs: ['visit', 'give', 'say', 'persuade', 'observe', 'escort', 'wait'], language: 'selected', actorIds: ['player', 'xinling', 'houying', 'zhuhai'], preconditions: ['第二幕', '侯嬴当下的认可决定是否托付计谋'] },
    location: 'yimen', works: ['qiefu'], act: 2, items: ['bamboo', 'wine', 'hammer'], destinations: ['yimen'], choices: ['return', 'rush', 'listen'], defaultTarget: 'houying',
  },
  night: {
    grant: { sceneId: 'night', verbs: ['visit', 'observe', 'steal', 'escort', 'wait'], language: 'hidden', actorIds: ['player', 'ruji', 'palace-guard'], preconditions: ['主线第三幕，或独立取符之夜', '动作层只提交已发生的护送结果'] },
    location: 'palace', works: ['qiefu', 'night'], act: 3, items: ['seal'], destinations: ['palace'], choices: ['escape', 'detected'], defaultTarget: 'ruji',
  },
  camp: {
    grant: { sceneId: 'camp', verbs: ['visit', 'give', 'say', 'persuade', 'observe', 'verify', 'command', 'wait'], language: 'selected', actorIds: ['player', 'xinling', 'jinbi', 'zhuhai', 'soldier'], preconditions: ['第四幕', '取符与侯嬴托付的结果共同决定是否能夺军'] },
    location: 'ye', works: ['qiefu'], act: 4, items: ['seal', 'hammer', 'bamboo'], destinations: ['ye'], choices: ['verify', 'force', 'appeal'], defaultTarget: 'jinbi',
  },
  'siege-square': {
    grant: { sceneId: 'siege-square', verbs: ['give', 'persuade', 'observe'], language: 'selected', actorIds: ['player', 'pingyuan', 'lichong', 'citizen'], preconditions: ['李同劝散家财', '家库有限，既有行为不能重复写入'] },
    location: 'handan', works: ['siege'], items: ['pledge'], destinations: ['handan'], choices: ['distribute', 'hold'], defaultTarget: 'pingyuan',
  },
  granary: {
    grant: { sceneId: 'granary', verbs: ['visit', 'give', 'say', 'persuade', 'observe', 'borrow', 'vouch', 'verify', 'wait'], language: 'free', actorIds: ['player', 'keeper-suspicious', 'keeper-impatient', 'borrower', 'pingyuan', 'lichong', 'citizen'], preconditions: ['围城的仓房', '交接只从仓中余粮扣除，话语不能充当权威命令'] },
    location: 'granary', works: ['siege'], items: ['seal', 'letter', 'pledge', 'grain'], destinations: ['granary', 'handan'], choices: ['seal', 'letter', 'pledge'], defaultTarget: 'keeper-suspicious',
  },
  studio: {
    grant: { sceneId: 'studio', verbs: ['visit', 'observe', 'say', 'wait'], language: 'selected', actorIds: ['player', 'director', 'director-lu', 'mentor'], preconditions: ['片场只读取实际决定', '导演椅由认可与引用解锁'] },
    location: 'studio', works: ['studio'], items: ['bamboo'], destinations: ['studio'], choices: [], defaultTarget: 'director',
  },
};

export const YEAR_DAYS = 365;
export const REVERSAL_THRESHOLD = 6;
export const GRAIN_CAPACITY = 24;
export const MECHANISM_FIELDS = ['discrepancy', 'itemId', 'suspicion', 'patience', 'sourceVerified', 'coordinationSteps'] as const;
export const MECHANISM_ACTIONS = ['verify-seal', 'compare-ledger', 'share-receipt'] as const;

export function claimIsVisible(state: import('../core/types').WorldState, claim: import('../core/types').Claim, actorId: string): boolean {
  const actor = state.entities[actorId];
  if (!actor || actor.kind !== 'person') return false;
  if (claim.day > state.day) return false;
  if (claim.holders.includes(actorId)) return true;
  if (actor.role === 'director' || actor.role === 'mentor') return true;
  if (claim.channel !== 'public') return false;
  const subject = state.entities[claim.subject];
  if (actor.role === 'actor' && (subject?.role === 'director' || subject?.role === 'mentor')) return false;
  return !claim.predicate.startsWith('history.') && !claim.predicate.startsWith('preference.') && !claim.predicate.startsWith('design.');
}
