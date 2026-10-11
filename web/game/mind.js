// 心思：把引擎的心智核心接進遊戲。
//
// 這裡刻意不自己發明規則——「這句話有沒有效」是 shared/core/mind.js 算的，
// 遊戲只負責把玩家選的訴求送進去，再把回傳的數字誠實地畫出來。
// 所以畫面上的 accepted / moved / fit / backlash / trust 全都是引擎的真實輸出。

import { createMind } from '../../../shared/core/mind.js';
import { personDef } from './actors.js';

// 四種訴求。名字沿用引擎的鍵（义／利／惧／恩），顯示用中文。
export const APPEALS = [
  {
    key: '义',
    label: '義',
    hint: '講該不該做',
    verb: '說之以義',
    // 這一句會被送進心智核心。訴求強度由玩家身上「能拿出來的」決定。
    sentence: (who) => `此事關乎大義，${who}不該坐視。`,
  },
  {
    key: '利',
    label: '利',
    hint: '講划不划算',
    verb: '誘之以利',
    sentence: (who) => `這麼做對${who}有利，帳算得過來。`,
  },
  {
    key: '惧',
    label: '懼',
    hint: '講不做的後果',
    verb: '脅之以懼',
    sentence: () => '秦軍破趙之後，下一個就是這裡。',
  },
  {
    key: '恩',
    label: '恩',
    hint: '講你欠我的／我欠你的',
    verb: '動之以恩',
    sentence: () => '舊日的情分，還算不算數？',
  },
];

const APPEAL_BY_KEY = new Map(APPEALS.map((a) => [a.key, a]));

export function createMinds() {
  const store = new Map();

  function mindOf(personId) {
    if (store.has(personId)) return store.get(personId);
    const def = personDef(personId);
    if (!def) return null;
    const mind = createMind(def);
    store.set(personId, mind);
    return mind;
  }

  /**
   * 對某人說一句。appeal 是 {义,利,惧,恩} 的強度（0..1）。
   * 回傳引擎的原始結果，外加說話內容，讓畫面可以誠實呈現。
   */
  function speak(personId, appeal) {
    const mind = mindOf(personId);
    if (!mind) return null;
    const r = mind.hear(appeal, 'actor:player');
    return { ...r, appeal, personId, name: mind.name };
  }

  // 讀一個人的心思：真實的性情、在乎什麼、現在信你多少。
  function read(personId) {
    const mind = mindOf(personId);
    if (!mind) return null;
    const def = mind.def;
    const trust = mind.state.trust['actor:player'] ?? 0.3;
    const values = def.values || {};
    const ranked = Object.entries(values).sort((a, b) => b[1] - a[1]);
    return {
      id: def.id,
      name: def.name,
      title: def.title,
      bio: def.bio,
      voice: def.voice,
      sources: def.sources || [],
      temperament: def.temperament || {},
      values,
      ranked,
      resist: def.resist || {},
      threshold: def.threshold ?? 0.35,
      trust,
      stress: mind.state.stress ?? 0,
      goals: def.goals || [],
      mindAct: def.mindAct || '',
      units: mind.units.map((u) => ({ id: u.id, label: u.label, cap: u.cap, act: u.act, verb: u.verb })),
      modules: mind.modules.map((m) => ({ id: m.id, label: m.label, cap: m.cap, act: m.act })),
      // 他現在看起來的樣子——由信任與壓力推出來，不是寫死的表情
      expression: expressionOf(trust, mind.state.stress ?? 0, def),
    };
  }

  // 表情是狀態的函式。同一句話在不同信任度下，他的反應本來就該不同。
  function expressionOf(trust, stress, def) {
    if (stress > 0.6) return { key: 'wary', label: '戒備', color: '#c2703a' };
    if (trust >= 0.7) return { key: 'warm', label: '願意聽', color: '#7fae6a' };
    if (trust >= 0.5) return { key: 'open', label: '聽著', color: '#9fb0c4' };
    if (trust >= 0.35) return { key: 'flat', label: '不動聲色', color: '#8a8a86' };
    return { key: 'cold', label: '冷淡', color: '#6b6b78' };
  }

  // 玩家身上「現在拿得出來」的籌碼。
  // 這是圍城裡的稀缺：糧食會少，義理會因為一次次失信而變薄。
  function resourcesFor(grain) {
    return {
      义: 0.6,
      利: 0.35 + grain * 0.35,
      惧: 0.5,
      恩: 0.25 + grain * 0.3,
    };
  }

  function save() {
    const out = {};
    for (const [id, mind] of store) out[id] = mind.save();
    return out;
  }

  function load(saved) {
    if (!saved) return;
    for (const [id, state] of Object.entries(saved)) {
      const def = personDef(id);
      if (!def) continue;
      store.set(id, createMind(def, state));
    }
  }

  function trustOf(personId) {
    const mind = mindOf(personId);
    return mind ? (mind.state.trust['actor:player'] ?? 0.3) : 0.3;
  }

  return { mindOf, speak, read, save, load, trustOf, resourcesFor, APPEAL_BY_KEY };
}
