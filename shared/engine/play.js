// 第三阶段：呈现的可玩性。
//
// 《窃符》是一部能玩的作品：四幕（大梁、夷门、取符之夜、邺城），外加《围城》里的一场暮色粮仓。
// 这里只写“规则”，不写画面；同样的输入，永远同样的世界（可以重放、可以给模拟玩家跑）。
//
// 可玩性从哪里来（设计总稿第 17 节）：
// - 你学的不是规则，是人。每个人的反应都由他自己的心智算出来（shared/core/mind.js 的 hear / perceive），
//   性情稳定所以学得会，内部状态（信任、压力、记忆）在变所以变化有来由。
// - 交互由导演授予：每一幕你能用哪些动词（说 / 给 / 去），来自导演对这一拍的设计（director.grant）。
//   “等着 / 不出声”永远可以选——你什么都不做，世界也会按每个人自己的目标往前走。
// - 每个动作先有前兆（他停住了 / 皱眉 / 已经动了），再有反应；点开心智入口，能看到他读到了什么、停在哪一层。
// - 你的影响被记住：大梁里信陵君对你的信任，决定你在邺城能不能替他说话；
//   夷门你说的话，决定如姬取符时犹不犹豫。前面的选择在后面的幕里被引用。
// - 结局不是写死的：史书的走法、晋鄙活下来的“本作的历史”、取符失手的断链，三种都真的走得到。
// - 你的结果写回同一张主张图：取符之夜和邺城分别交给 works.js 的 playWork，第二阶段的五种关系跟着变。
// - 导演的回路闭合：每一幕你是先看心思、先追问、还是直接动手，作为真实反应交给导演，和他的预测对照。

import { STATUS } from '../core/claims.js';
import { explainPerception, clamp } from '../core/mind.js';
import { playWork, worldRelations } from './works.js';

const round = (v) => Math.round(v * 1000) / 1000;

/** 玩家在这些作品里用的身份 */
export const PLAYER = 'actor:player';
export const HOLDER = '门客（你）';

/** 《窃符》可玩的四幕；开场与拉远是零交互的电影段 */
export const ACT_ORDER = ['daliang', 'yimen', 'night', 'ye'];

/** 每一幕估计用时（秒），给地板检查估时长；电影段和尾声一起算 */
export const EST_SECONDS = { film: 60, daliang: 120, yimen: 120, night: 150, ye: 120, coda: 60, granary: 150 };

/** 围城的时间压力：邯郸还能撑几天（本作的抽象刻度，不是史料数字） */
export const START_DAYS = 30;

/** 心智停在哪一层 → 你能先看到的前兆（不用文字解释机制，只写人的样子） */
const TELL = {
  mind: (n) => `${n}停住了，半天没出声`,
  module: (n) => `${n}皱了皱眉，看了旁人一眼`,
  unit: (n) => `${n}没等你说完，已经有了动作`,
  backlash: (n) => `${n}的脸色变了`,
};

const NIGHT_LANTERN = [1, 2, 3, 2];      // 守卫甲提灯巡夜，每一步照到的格子，固定的节奏，学得会
const NIGHT_GOAL = 4;                    // 0 宫门外 → 1 回廊 → 2 中庭（守卫乙站着）→ 3 卧内门口（如姬）→ 4 后门
const NIGHT_LIMIT = 12;                  // 超过这么多步天就亮了
const NIGHT_TILES = ['宫门外', '回廊', '中庭', '卧内门口', '后门'];

/**
 * 每一幕的设定。options 里每一项：
 *   id, verb: 'say'|'give'|'go'|'wait', needs?: [额外需要的动词], to: 人物 id,
 *   line: 你做的事（世界里的话或动作，不是命令），appeal?: {义,利,惧,恩}, channels: 对方感到的那一路
 * wait 永远可选（不需要授予）。
 */
export const ACTS = {
  daliang: {
    title: '信陵君府', place: '大梁', beat: 'daliang', lead: 'xinling',
    people: ['xinling', 'zhaoshi', 'zhuhai'],
    goal: '魏王不肯发兵。替信陵君想个办法。',
    scene: '赵使的竹简摊在案上，信陵君已经第三次从宫里空手回来。',
    ambient: { kind: 'plead', channels: { 请求: 0.6, 义: 0.3 } },
    options: [
      { id: 'yi', verb: 'say', to: 'xinling', appeal: { 义: 0.8 }, channels: { 义: 0.6, 请求: 0.3 }, line: '「公子，赵亡则魏危。救赵是义，不救，天下的士人都要寒心。」' },
      { id: 'li', verb: 'say', to: 'xinling', appeal: { 利: 0.8 }, channels: { 请求: 0.4 }, line: '「救下赵国，魏国能得河东的地。」' },
      { id: 'letter', verb: 'give', to: 'xinling', item: '赵使的竹简', appeal: { 义: 0.4 }, channels: { 请求: 0.6, 义: 0.4 }, line: '把赵使的竹简推到公子手边' },
      { id: 'king', verb: 'say', needs: ['go'], to: 'weiwang', appeal: { 惧: 0.7 }, channels: { 秦: 0.6, 威胁: 0.4 }, line: '跟公子进宫，对魏王说：「秦军不足畏。」' },
      { id: 'wait', verb: 'wait', to: 'xinling', line: '不出声，看公子自己怎么办' },
    ],
  },
  yimen: {
    title: '夷门', place: '大梁东门', beat: 'yimen', lead: 'xinling',
    people: ['xinling', 'houying'],
    goal: '公子要带宾客去和秦军拼命。侯嬴站在门口，不送。',
    scene: '车骑百余乘过夷门，侯嬴只说了一句「公子勉之，老臣不能从」。',
    ambient: { kind: 'snub', channels: { 人: 0.5, 恩: 0.4 } },
    options: [
      { id: 'back', verb: 'say', to: 'xinling', appeal: { 义: 0.7 }, channels: { 义: 0.5, 人: 0.3 }, line: '「侯生待公子不薄，今天不送，必有缘故。」' },
      { id: 'fear', verb: 'say', to: 'xinling', appeal: { 惧: 0.8 }, channels: { 请求: 0.3 }, line: '「秦军虎狼，去了就是送死。」' },
      { id: 'hou', verb: 'say', to: 'houying', appeal: { 义: 0.6 }, channels: { 观察: 0.5, 人: 0.3 }, line: '回头问侯嬴：「先生不送，是在等公子回来吧？」' },
      { id: 'wait', verb: 'wait', to: 'xinling', line: '跟着车走，不出声' },
    ],
  },
  night: {
    title: '取符之夜', place: '魏王卧内', beat: 'night', lead: 'ruji',
    people: ['ruji', 'guard_a', 'guard_b'],
    goal: '如姬在卧内取符。你要从宫门外摸到后门，把符接出来，不被看见。',
    scene: '守卫甲提着灯，在回廊、中庭、卧内门口之间来回；守卫乙站在中庭。',
    options: [
      { id: 'step', verb: 'go', line: '往前挪一格' },
      { id: 'rush', verb: 'go', line: '一口气冲两格' },
      { id: 'token_b', verb: 'give', to: 'guard_b', item: '宫中令牌', channels: { 令: 0.6, 人: 0.3 }, line: '把令牌塞给中庭的守卫乙' },
      { id: 'token_a', verb: 'give', to: 'guard_a', item: '宫中令牌', channels: { 令: 0.6, 人: 0.3 }, line: '把令牌递给提灯的守卫甲' },
      { id: 'wait', verb: 'wait', line: '贴着墙根，等灯过去' },
    ],
  },
  ye: {
    title: '邺城', place: '邺', beat: 'ye', lead: 'jinbi',
    people: ['jinbi', 'zhuhai', 'xinling'],
    goal: '晋鄙合了符，还是起疑。朱亥站在公子身后，袖子里是四十斤的铁椎。',
    scene: '晋鄙把两半兵符并在一起，抬头看信陵君：「今吾拥十万之众，单车来代之，何如哉？」',
    ambient: { kind: 'doubt', channels: { 印信: 0.7, 兵权: 0.6 } },
    options: [
      { id: 'yi', verb: 'say', to: 'jinbi', appeal: { 义: 0.8 }, channels: { 军令: 0.3 }, line: '「将军，邯郸旦暮且下。救赵是大义，魏国的义也在将军手里。」' },
      { id: 'en', verb: 'say', to: 'jinbi', appeal: { 恩: 0.8 }, channels: { 兵权: 0.3 }, line: '「公子许将军全身而归，十万魏卒不必死在邺下。」' },
      { id: 'ju', verb: 'say', to: 'jinbi', appeal: { 惧: 0.8 }, channels: { 兵权: 0.4 }, line: '「将军不交兵权，朱亥的铁椎就在身后。」' },
      { id: 'wait', verb: 'wait', to: 'jinbi', line: '不出声，看朱亥的铁椎落下' },
    ],
  },
  granary: {
    title: '暮色粮仓', place: '邯郸城内', beat: 'dusk', lead: null, work: 'weicheng',
    people: ['borrower'],
    goal: '账对不上。借粮者在桌前，桌上三样东西：印信、借条、担保物。',
    scene: '天快黑了，麻袋堆在墙角，守仓人的手一直按在账册上。',
    inspect: [
      { id: 'seal', item: '印信', channels: { 印信: 0.7 }, line: '把印信推到守仓人面前' },
      { id: 'note', item: '借条', channels: { 数量: 0.7 }, line: '把借条推到守仓人面前' },
      { id: 'pledge', item: '担保物', channels: { 人: 0.6 }, line: '把担保物推到守仓人面前' },
    ],
    decide: [
      { id: 'report', line: '拿着仓簿副页去报' },
      { id: 'witness', line: '拉上李同一起去报' },
      { id: 'hide', line: '先瞒下来' },
    ],
  },
};

/** 两个守仓人：同一套心智结构，只换性情（23.4 同一件事，换个人） */
export const KEEPERS = ['keeper_doubt', 'keeper_rash'];

function freshState() {
  return {
    stage: 'intro',            // intro → film → act → coda → granary → done
    actIndex: 0,
    days: START_DAYS,
    acts: {},                  // actId → { watched:[], asked:[], choice, outcome, done, signal }
    flags: {},
    log: [],                   // { act, kind, text, seq, person?, tell? }
    night: null,
    granary: null,
    ending: null,
  };
}

/**
 * 在一个已经见过导师的 session 上玩《窃符》。状态放在 session.state.play，随 session.save() 一起存。
 * 返回的每个方法都只改 session，不碰画面。
 */
export function createPlay(session) {
  const { ledger, claims, minds } = session;
  session.state.play ||= freshState();
  const P = () => session.state.play;
  const name = (id) => minds[id]?.name || id;

  const currentActId = () => {
    const p = P();
    if (p.stage === 'act') return ACT_ORDER[p.actIndex];
    if (p.stage === 'granary') return 'granary';
    return null;
  };
  const actState = (id) => (P().acts[id] ||= { watched: [], asked: [], choice: null, outcome: null, done: false, signal: null });
  const openSeqOf = (work) => ledger.last((e) => e.kind === 'present.open' && e.payload.presentation === work)?.seq;
  const workOf = (actId) => (actId === 'granary' ? 'weicheng' : 'qiefu');

  /** 导演对这一拍授予的动词。电影段 level 0 → 什么都不给 */
  function grantsOf(actId) {
    const work = workOf(actId);
    const beatId = ACTS[actId]?.beat;
    const beat = session.state.designs?.[work]?.beats?.find((b) => b.id === beatId);
    return { verbs: beat?.grants || [], level: beat?.level ?? 0, why: beat?.why || '', language: beat?.language || '看不见' };
  }

  function allowed(actId, opt) {
    if (opt.verb === 'wait') return true;
    const g = grantsOf(actId).verbs;
    return [opt.verb, ...(opt.needs || [])].every((v) => g.includes(v));
  }

  function log(entry) {
    P().log.push({ act: currentActId(), ...entry });
  }

  function claim(spec, cause, presentation = 'qiefu') {
    const r = claims.add({ presentation, holder: HOLDER, channel: '亲历', ...spec, cause });
    return r.claim;
  }

  function find(subject, predicate) {
    return claims.consensus(subject, predicate) || claims.find((c) => c.subject === subject && c.predicate === predicate && c.status !== STATUS.FORMER).slice(-1)[0];
  }

  function trustOf(personId) {
    return round(minds[personId]?.state.trust[PLAYER] ?? 0.3);
  }

  function setTrust(personId, v, why, cause) {
    const before = trustOf(personId);
    minds[personId].state.trust[PLAYER] = round(clamp(v));
    return ledger.append({
      kind: 'actor.trust', from: `actor:${personId}`, to: PLAYER, cause,
      payload: { person: personId, before, after: trustOf(personId), why },
    }).seq;
  }

  /** 一个人对一件事的反应：先算心智，再写账（你的动作 → 他的反应），返回给画面的东西 */
  function reactOf(actId, opt, personId, { channels, appeal, bar } = {}) {
    const mind = minds[personId];
    const act = ACTS[actId];
    const userSeq = ledger.append({
      kind: 'user.act', from: 'user', to: `actor:${personId}`, cause: [openSeqOf(workOf(actId))].filter(Boolean),
      payload: { act: actId, option: opt.id, verb: opt.verb, line: opt.line, item: opt.item || null },
    }).seq;
    let heard = null;
    if (appeal) heard = mind.hear(appeal, PLAYER);
    const ch = channels || opt.channels || act.ambient?.channels || { 人: 0.4 };
    const perception = mind.perceive({ kind: opt.verb, signature: `${actId}:${opt.id}`, channels: ch, reliability: heard ? clamp(0.5 + heard.trustBefore) : 1 });
    const accepted = heard ? heard.moved >= (bar ?? mind.def.threshold ?? 0.35) : null;
    const backlash = heard ? heard.backlash > 0.15 : false;
    const n = name(personId);
    const tell = backlash ? TELL.backlash(n) : TELL[perception.stoppedAt](n);
    const reactSeq = ledger.append({
      kind: 'actor.react', from: `actor:${personId}`, to: PLAYER, cause: [userSeq],
      payload: {
        act: actId, person: personId, option: opt.id, stoppedAt: perception.stoppedAt, action: perception.action.act,
        accepted, moved: heard?.moved ?? null, bar: heard ? (bar ?? mind.def.threshold) : null,
        backlash: heard?.backlash ?? 0, trust: heard ? [heard.trustBefore, heard.trustAfter] : null,
        reason: heard?.reason || explainPerception(perception, n),
      },
    }).seq;
    const r = { person: personId, name: n, tell, perception, heard, accepted, backlash, userSeq, reactSeq };
    actState(actId).last = { person: personId, reactSeq, stoppedAt: perception.stoppedAt, action: perception.action.act, reason: heard?.reason || null, explain: explainPerception(perception, n), accepted, moved: heard?.moved ?? null, bar: heard ? round(bar ?? mind.def.threshold) : null };
    return r;
  }

  /* ---------------- 每一幕的后果 ---------------- */

  function resolveDaliang(opt) {
    const s = P();
    if (opt.id === 'king') {
      const r = reactOf('daliang', opt, 'weiwang', { appeal: opt.appeal });
      const c = claim({ subject: '魏王', predicate: '对信陵君', object: '更加猜忌，闭门不见', holder: '魏王', note: '新来的门客当面说秦不足畏' }, [r.reactSeq]);
      s.flags.kingSuspicious = true;
      s.days -= 3;
      return { r, text: `魏王的手指在案上停住。第二天，宫里传出话来：公子不必再来了。`, claims: [c.id], cost: '魏王更猜忌信陵君；邺城的晋鄙会更难说动' };
    }
    if (opt.id === 'wait') {
      const r = reactOf('daliang', opt, 'xinling');
      s.days -= 3;
      return { r, text: `公子自己又进宫去了，${r.perception.action.act}。回来时，脸色更沉。`, claims: [], cost: '三天过去了' };
    }
    const r = reactOf('daliang', opt, 'xinling', { appeal: opt.appeal });
    s.days -= opt.id === 'letter' ? 2 : 3;
    if (opt.id === 'li') {
      const c = claim({ subject: '信陵君', predicate: '看新来的门客', object: '只讲利', holder: '信陵君' }, [r.reactSeq]);
      return { r, text: '公子看了你一眼：「我门下的人，也讲这个？」他没再问你的意见。', claims: [c.id], cost: '公子对你的信任降了' };
    }
    if (r.accepted) {
      const c = claim({ subject: '信陵君', predicate: '门客的话', object: '义不容辞，再请魏王', holder: '信陵君' }, [r.reactSeq]);
      return { r, text: opt.id === 'letter' ? '公子把竹简又读了一遍，卷起来揣进袖里，起身往宫里去。' : '公子按着案几站起来：「说得是。」他又一次进宫去了。', claims: [c.id], cost: '公子更信你了' };
    }
    return { r, text: '公子点点头，没有接话。', claims: [], cost: '这句话没落到他心上' };
  }

  function resolveYimen(opt) {
    const s = P();
    let r; let text; const added = [];
    let rujiBonus = 0;
    if (opt.id === 'hou') {
      r = reactOf('yimen', opt, 'houying', { appeal: opt.appeal });
      if (r.accepted) {
        text = '侯嬴看了你一会儿，笑了，不答，只把门闩落下。他知道公子门下有人看得懂这场试探。';
        added.push(claim({ subject: '侯嬴', predicate: '看信陵君门下', object: '有人看得懂这场试探', holder: '侯嬴' }, [r.reactSeq]).id);
        rujiBonus = 0.15;
      } else text = '侯嬴不理你，抬头看天。';
      s.days -= 3;     // 公子照样先走，半路才回
    } else if (opt.id === 'wait') {
      r = reactOf('yimen', opt, 'xinling');
      text = `车走出几里，公子勒住马：「我待侯生不薄，他为什么不送？」他自己掉头回来了。`;
      s.days -= 2;
    } else {
      r = reactOf('yimen', opt, 'xinling', { appeal: opt.appeal });
      if (opt.id === 'back' && r.accepted) {
        text = '公子勒住马，看了你一眼，掉头回到夷门。';
        added.push(claim({ subject: '信陵君', predicate: '夷门之后', object: '听门客一句话折返', holder: '信陵君' }, [r.reactSeq]).id);
        rujiBonus = 0.1;
        s.days -= 1;
      } else if (opt.id === 'fear') {
        text = '公子只说：「我知道。」车照样往前走，走出很远，他才自己回头。';
        added.push(claim({ subject: '信陵君', predicate: '看新来的门客', object: '怕死', holder: '信陵君' }, [r.reactSeq]).id);
        s.days -= 3;
      } else {
        text = '公子没听进去，车照样往前走，走出很远才回头。';
        s.days -= 3;
      }
    }
    // 侯嬴的计，不管你说什么都会献出来（结构牢）；变的是如姬信不信你、路上耽误了几天
    const plan = claim({ subject: '侯嬴', predicate: '献计', object: '从如姬处取符', holder: '侯嬴', note: '史书所载' }, [r.reactSeq]);
    added.push(plan.id);
    const trust = round(0.3 + rujiBonus);
    const tseq = setTrust('ruji', trust, rujiBonus ? '侯嬴转告：公子门下有明白人' : '如姬只听说公子门下多了个新人', [r.reactSeq]);
    s.flags.rujiTrust = trust;
    return { r, text, claims: added, cost: rujiBonus ? '侯嬴会把你的事告诉如姬' : '如姬还不认识你', trustSeq: tseq };
  }

  function nightStart() {
    const s = P();
    // 如姬取符前心里转几转：她对你的信（恩）和被发现的怕（惧）谁先吃下，决定她犹不犹豫
    const ruji = minds.ruji;
    const trust = trustOf('ruji');
    const perception = ruji.perceive({ kind: 'night', signature: 'night:ruji', channels: { 恩: round(trust + 0.1), 惧: 0.5 } });
    const hesitant = perception.action.act === ruji.def.units.find((u) => u.id === 'risk')?.act;
    const seq = ledger.append({
      kind: 'actor.react', from: 'actor:ruji', to: PLAYER, cause: [openSeqOf('qiefu')].filter(Boolean),
      payload: { act: 'night', person: 'ruji', stoppedAt: perception.stoppedAt, action: perception.action.act, trust, hesitant, reason: explainPerception(perception, '如姬') },
    }).seq;
    actState('night').last = { person: 'ruji', reactSeq: seq, stoppedAt: perception.stoppedAt, action: perception.action.act, explain: explainPerception(perception, '如姬'), reason: hesitant ? '她对你的信不够，被发现的怕先吃下了' : '恩先吃下了，她不犹豫' };
    s.night = { pos: 0, step: 0, lantern: NIGHT_LANTERN[0], token: null, bLooksAway: false, aAlert: false, rujiReady: !hesitant, hesitant, seen: false, done: false, reason: null, trail: [] };
    return { hesitant, seq };
  }

  function nightStep(opt) {
    const n = P().night;
    const before = n.pos;
    let text = '';
    let r = null;
    let moved = false;
    if (opt.id === 'token_b' || opt.id === 'token_a') {
      if (n.token) return { text: '令牌已经出手了。', refused: true };
      const who = opt.id === 'token_b' ? 'guard_b' : 'guard_a';
      r = reactOf('night', opt, who);
      n.token = who;
      if (who === 'guard_b') {
        n.bLooksAway = /装作没看见/.test(r.perception.action.act);
        text = n.bLooksAway ? '守卫乙掂了掂令牌，把头转向墙那边。' : `守卫乙${r.perception.action.act}。`;
      } else {
        n.aAlert = true;
        text = `守卫甲举灯照你的脸：「${minds.guard_a.def.voice}」`;
      }
    } else if (opt.id === 'wait') {
      const uSeq = ledger.append({ kind: 'user.act', from: 'user', to: 'presentation:qiefu', cause: [openSeqOf('qiefu')].filter(Boolean), payload: { act: 'night', option: 'wait', pos: n.pos } }).seq;
      n.lastSeq = uSeq;
      if (n.pos === 3 && !n.rujiReady) { n.rujiReady = true; text = '门后的如姬低声问：「会不会被发现？」你等她定下神，她把半块兵符递了出来。'; }
      else text = '你贴着墙根，屏住气。';
    } else {
      const uSeq = ledger.append({ kind: 'user.act', from: 'user', to: 'presentation:qiefu', cause: [openSeqOf('qiefu')].filter(Boolean), payload: { act: 'night', option: opt.id, pos: n.pos } }).seq;
      n.lastSeq = uSeq;
      const want = opt.id === 'rush' ? 2 : 1;
      for (let i = 0; i < want; i++) {
        if (n.pos === 3 && !n.rujiReady) { text = '如姬还在门后，低声问：「会不会被发现？」你停住了。'; break; }
        n.pos += 1;
        moved = true;
        if (n.pos === 2 && !n.bLooksAway) { n.seen = true; n.reason = '中庭的守卫乙看见了你'; break; }
        if (n.pos >= NIGHT_GOAL) break;
      }
      if (!text) text = `你挪到了${NIGHT_TILES[n.pos]}。`;
    }
    // 灯往前走一步
    n.step += 1;
    n.lantern = NIGHT_LANTERN[n.step % NIGHT_LANTERN.length];
    if (!n.seen && n.aAlert) { n.seen = true; n.reason = '守卫甲拦住了你，要看令牌'; }
    if (!n.seen && moved && n.lantern === n.pos && n.pos < NIGHT_GOAL) { n.seen = true; n.reason = `灯照到了${NIGHT_TILES[n.pos]}，你还在动`; }
    if (!n.seen && n.pos >= NIGHT_GOAL) { n.done = true; text += ' 你从后门出来，怀里揣着半块兵符。'; }
    if (!n.seen && !n.done && n.step >= NIGHT_LIMIT) { n.seen = true; n.reason = '天快亮了，换班的卫士撞见了你'; }
    if (n.seen) { n.done = true; text += ` ${n.reason}。`; }
    n.trail.push({ step: n.step, option: opt.id, from: before, to: n.pos, lantern: n.lantern, seen: n.seen });
    return { r, text, night: { ...n } };
  }

  function resolveYe(opt) {
    const s = P();
    const gotFu = s.flags.night === 'clean';
    if (!gotFu) {
      const r = reactOf('ye', { ...opt, id: 'wait' }, 'jinbi');
      return { r, text: '公子一行到了邺下，手里没有兵符。晋鄙闭营不见，十万魏军仍停在原地。', claims: [], choice: null };
    }
    if (opt.id === 'wait') {
      const r = reactOf('ye', opt, 'jinbi');
      return { r, text: `晋鄙${r.perception.action.act}。朱亥从袖中抽出铁椎，晋鄙倒在帐中。`, claims: [], choice: 'strike' };
    }
    // 合符而疑：他的门槛比平时高。你是谁，决定你说的话有多重——公子信你，你就是替公子说话
    const standing = trustOf('xinling') >= 0.45 ? 0.5 : 0.15;
    const bar = round(0.5 + (s.flags.kingSuspicious ? 0.05 : 0));
    const tseq = setTrust('jinbi', standing, standing > 0.3 ? '公子让你上前替他说话' : '晋鄙不认识你这个新来的门客', [openSeqOf('qiefu')].filter(Boolean));
    const r = reactOf('ye', opt, 'jinbi', { appeal: opt.appeal, bar });
    if (r.accepted) {
      const c = claim({ subject: '晋鄙', predicate: '听了门客的话', object: '解下印绶', holder: '晋鄙' }, [r.reactSeq]);
      return { r, text: '晋鄙握着兵符看了很久，解下印绶，放在案上。朱亥的手从袖口里慢慢收了回去。', claims: [c.id], choice: 'persuade', trustSeq: tseq };
    }
    if (r.backlash) {
      const c = claim({ subject: '晋鄙', predicate: '临死前说', object: '魏王果然疑我', holder: '晋鄙' }, [r.reactSeq]);
      return { r, text: '晋鄙按剑而起：「果然是来夺军的！」朱亥的铁椎落下。', claims: [c.id], choice: 'strike', trustSeq: tseq };
    }
    return { r, text: '晋鄙摇头：「此事须报大王。」朱亥看了公子一眼，铁椎落下。', claims: [], choice: 'strike', trustSeq: tseq };
  }

  /** 每一幕结束：你的真实反应交给导演（先看心思 / 先追问 / 直接动手） */
  function signalOf(a) {
    if (a.watched.length) return '停下来看心思';
    if (a.asked.length) return '追问为什么';
    return '很快通过';
  }

  function finishAct(actId) {
    const a = actState(actId);
    a.done = true;
    a.signal = signalOf(a);
    const work = workOf(actId);
    session.react(work, ACTS[actId].beat, a.signal);
  }

  /* ---------------- 对外的方法 ---------------- */

  function begin() {
    if (!session.state.met) throw new Error('先见导师，再进作品');
    const s = P();
    if (s.stage !== 'intro') return view();
    if (!session.state.plays?.changping) playWork(session, 'changping');
    session.commission('qiefu');
    s.stage = 'film';
    log({ kind: 'film', text: '长平之后，秦军围邯郸。赵使一路向魏国求救；魏王令晋鄙的十万军停在邺，不许再走。' });
    return view();
  }

  function next() {
    const s = P();
    if (s.stage === 'film') { s.stage = 'act'; s.actIndex = 0; return view(); }
    if (s.stage === 'act') {
      const id = ACT_ORDER[s.actIndex];
      if (!actState(id).done) throw new Error('这一幕还没做出选择');
      s.actIndex += 1;
      if (s.actIndex >= ACT_ORDER.length) return coda();
      if (ACT_ORDER[s.actIndex] === 'night') nightStart();
      return view();
    }
    if (s.stage === 'coda') { return startGranary(); }
    if (s.stage === 'granary') {
      if (!actState('granary').done) throw new Error('粮仓这一场还没做完');
      s.stage = 'done';
      return view();
    }
    return view();
  }

  function choose(optionId) {
    const s = P();
    const actId = currentActId();
    if (!actId) throw new Error('现在没有可以做的选择');
    if (actId === 'granary') return granaryChoose(optionId);
    const a = actState(actId);
    if (a.done) throw new Error('这一幕已经做完了');
    const opt = ACTS[actId].options.find((o) => o.id === optionId);
    if (!opt) throw new Error(`没有这个选项：${optionId}`);
    if (!allowed(actId, opt)) throw new Error(`导演这一幕没有授予「${opt.verb}」`);
    let out;
    if (actId === 'daliang') out = resolveDaliang(opt);
    else if (actId === 'yimen') out = resolveYimen(opt);
    else if (actId === 'night') {
      out = nightStep(opt);
      if (out.refused) return { ...out, view: view() };
      a.steps = (a.steps || 0) + 1;
      log({ kind: 'act', text: out.text, person: out.r?.person, tell: out.r?.tell, option: opt.id });
      if (s.night.done) {
        const pick = s.night.seen ? 'seen' : 'clean';
        s.flags.night = pick;
        const w = playWork(session, 'night', pick);
        session.react('night', 'run', signalOf(a));
        a.choice = pick;
        a.outcome = { text: s.night.seen ? `${s.night.reason}。兵符留在了卧内。` : '符出了卧内。', work: w.touched };
        finishAct('night');
      }
      return { ...out, view: view() };
    } else if (actId === 'ye') {
      out = resolveYe(opt);
      if (out.choice || s.flags.night !== 'clean') {
        const w = playWork(session, 'qiefu', out.choice || 'strike', { reuseOpen: true });
        out.work = w.touched;
      }
    }
    a.choice = opt.id;
    a.outcome = { text: out.text, cost: out.cost || null, claims: out.claims || [], choice: out.choice || null };
    log({ kind: 'act', text: out.text, person: out.r?.person, tell: out.r?.tell, option: opt.id, seq: out.r?.reactSeq });
    finishAct(actId);
    return { ...out, view: view() };
  }

  /** 心智入口：看他此刻读到了什么、停在哪一层、想要什么。看心思不花时间，但导演会知道你停下来看了 */
  function watch(personId) {
    const actId = currentActId();
    const mind = minds[personId];
    if (!mind) throw new Error(`没有这个人：${personId}`);
    if (actId && grantsOf(actId).verbs.length && !grantsOf(actId).verbs.includes('watch')) throw new Error('导演这一幕没有授予「看心思」');
    if (actId) { const a = actState(actId); if (!a.watched.includes(personId)) a.watched.push(personId); }
    const last = actId ? actState(actId).last : null;
    const mine = last && last.person === personId ? last : null;
    // 还没对他做过什么：用他此刻面对的局面设想一遍（不写记忆），让你在动手前就能建立预期
    let preview = null;
    if (!mine) {
      const ch = (actId && ACTS[actId].ambient?.channels) || { 人: 0.4 };
      const r = mind.perceive({ kind: 'look', signature: `look:${actId}:${personId}`, channels: ch });
      // perceive 会写记忆；看心思不该改人，所以撤回这一笔
      delete mind.state.memory[`look:${actId}:${personId}`];
      mind.state.log.pop();
      preview = { trace: r.trace, stoppedAt: r.stoppedAt, action: r.action.act, explain: explainPerception(r, mind.name) };
    }
    return {
      person: personId, name: mind.name, title: mind.def.title, bio: mind.def.bio,
      temperament: mind.temperament, values: mind.def.values, resist: mind.def.resist,
      trust: trustOf(personId), stress: round(mind.state.stress),
      wants: (mind.def.goals || [])[0] || null,
      units: mind.units.map((u) => ({ id: u.id, label: u.label, cap: u.cap, reads: u.reads, act: u.act })),
      modules: mind.modules.map((m) => ({ id: m.id, label: m.label, cap: m.cap })),
      last: mine, preview,
    };
  }

  /** 追问「为什么」：回答来自他真实的心智状态，不是临场编的（只回答你对他做过的那件事） */
  function ask(personId) {
    const actId = currentActId();
    if (actId) { const a = actState(actId); if (!a.asked.includes(personId)) a.asked.push(personId); }
    const last = actId ? actState(actId).last : null;
    const n = name(personId);
    let answer;
    if (!last || last.person !== personId) answer = `${n}看了你一眼，没说什么。（你还没对${n}做过什么）`;
    else if (last.accepted === true) answer = `${n}：「你的话说到我心里去了。」（${last.reason}；打动 ${last.moved} ≥ 门槛 ${last.bar}）`;
    else if (last.accepted === false) answer = `${n}：「你不懂我在想什么。」（${last.reason}；打动 ${last.moved} < 门槛 ${last.bar}）`;
    else answer = `${n}：「我本来就要这么做。」（${last.explain}）`;
    const seq = ledger.append({ kind: 'user.ask', from: 'user', to: `actor:${personId}`, cause: last ? [last.reactSeq] : [], payload: { act: actId, person: personId, answer } }).seq;
    return { person: personId, answer, seq };
  }

  function coda() {
    const s = P();
    s.stage = 'coda';
    const fate = find('晋鄙', '下场');
    const end = find('邯郸', '结局');
    const ending = s.flags.night !== 'clean' ? 'broken' : /交出兵权/.test(String(fate?.object)) ? 'jinbi-lives' : 'history';
    s.ending = ending;
    const wrap = session.wrap('qiefu');
    const book = '《史记》：公子遂将晋鄙军……进兵击秦军，秦军解去，遂救邯郸，存赵。侯生果北乡自刭。';
    const lived = {
      history: '你亲历的和史书一致：铁椎落下，晋鄙死在帐中，魏军往邯郸去。',
      'jinbi-lives': '你亲历的与史书不同：晋鄙解下印绶，随军而行。这是「本作的历史」。',
      broken: '你亲历的与史书不同：兵符没能出宫，魏军停在邺。邯郸没有等到援军——这是「本作的历史」。',
    }[ending];
    const daysText = s.days > 0 ? `援军到时，邯郸还能撑 ${s.days} 天。` : '援军到时，城里已经撑到了极限。';
    log({ kind: 'coda', text: `${lived} ${ending === 'broken' ? '' : daysText}` });
    s.coda = { ending, book, lived, days: s.days, fate: fate?.object || null, end: end?.object || null, director: wrap ? { seq: wrap.seq, errors: wrap.errors } : null };
    return view();
  }

  function startGranary() {
    const s = P();
    s.stage = 'granary';
    session.commission('weicheng');
    s.granary = { keeper: s.granary?.keeper || 'keeper_doubt', phase: 'inspect', inspected: null, keeperAct: null };
    return view();
  }

  /** 换一个守仓人再看一次（只在查看之前能换；换了之后同一件东西，看两个人怎么办） */
  function chooseKeeper(id) {
    const g = P().granary;
    if (!g) throw new Error('还没到粮仓');
    if (!KEEPERS.includes(id)) throw new Error(`没有这个守仓人：${id}`);
    g.keeper = id;
    if (g.phase === 'decide') { g.phase = 'inspect'; g.inspected = null; g.keeperAct = null; }
    return view();
  }

  function granaryChoose(optionId) {
    const s = P();
    const g = s.granary;
    const act = ACTS.granary;
    const a = actState('granary');
    if (g.phase === 'inspect') {
      const opt = act.inspect.find((o) => o.id === optionId);
      if (!opt) throw new Error(`没有这个选项：${optionId}`);
      const r = reactOf('granary', { ...opt, verb: 'give' }, g.keeper, { channels: opt.channels });
      g.inspected = opt.id;
      g.keeperAct = r.perception.action.act;
      g.phase = 'decide';
      const text = `${r.tell}。${name(g.keeper)}${r.perception.action.act}。`;
      (g.tries ||= []).push({ keeper: g.keeper, item: opt.item, act: r.perception.action.act, stoppedAt: r.perception.stoppedAt });
      log({ kind: 'act', text, person: g.keeper, tell: r.tell, option: opt.id, seq: r.reactSeq });
      return { r, text, view: view() };
    }
    const opt = act.decide.find((o) => o.id === optionId);
    if (!opt) throw new Error(`没有这个选项：${optionId}`);
    const w = playWork(session, 'weicheng', opt.id, { reuseOpen: true });
    const verdict = ledger.last((e) => e.kind === 'director.approve' || e.kind === 'director.refuse');
    let text;
    if (opt.id === 'hide') text = '你把账合上。城里的说法和城外一样：存粮尚可支撑。';
    else if (verdict?.kind === 'director.approve') text = `导演批了：${verdict.payload.rule}。「邯郸存粮尚可支撑」成了曾经的共识。`;
    else text = `导演没批：${verdict?.payload.rule}。守仓人的说法挂着，推不动城外的共识。`;
    a.choice = opt.id;
    a.outcome = { text, work: w.touched };
    log({ kind: 'act', text, option: opt.id });
    finishAct('granary');
    session.wrap('weicheng');
    return { text, view: view() };
  }

  /** 画面需要的一切：现在在哪、能做什么、为什么只能做这些 */
  function view() {
    const s = P();
    const actId = currentActId();
    const base = { stage: s.stage, days: s.days, ending: s.ending, log: s.log.slice(-30), flags: { ...s.flags } };
    if (s.stage === 'intro' || s.stage === 'film') return { ...base, film: s.stage === 'film' ? s.log[0]?.text : null };
    if (s.stage === 'coda') return { ...base, coda: s.coda };
    if (s.stage === 'done') {
      return { ...base, coda: s.coda, granary: s.granary, edges: worldRelations(session), acts: summarizeActs() };
    }
    const act = ACTS[actId];
    const a = actState(actId);
    const grants = grantsOf(actId);
    const people = act.people.concat(actId === 'granary' ? [s.granary.keeper] : []).map((id) => ({
      id, name: name(id), title: minds[id]?.def.title, trust: trustOf(id), stress: round(minds[id]?.state.stress ?? 0),
      look: minds[id]?.def.look || null, voice: minds[id]?.def.voice || '',
    }));
    let options;
    if (actId === 'granary') {
      options = (s.granary.phase === 'inspect' ? act.inspect : act.decide).map((o) => ({ id: o.id, verb: s.granary.phase === 'inspect' ? 'give' : 'say', line: o.line, item: o.item || null, allowed: true }));
    } else {
      options = act.options.map((o) => ({ id: o.id, verb: o.verb, to: o.to || null, toName: o.to ? name(o.to) : null, line: o.line, item: o.item || null, allowed: allowed(actId, o) && !(actId === 'night' && o.verb === 'give' && s.night?.token) }));
      if (actId === 'ye' && s.flags.night !== 'clean') options = options.filter((o) => o.id === 'wait').map((o) => ({ ...o, line: '跟着公子进营' }));
    }
    return {
      ...base, act: actId, index: actId === 'granary' ? null : s.actIndex, title: act.title, place: act.place,
      goal: act.goal, scene: act.scene, grants, people, options, done: a.done, outcome: a.outcome,
      watched: a.watched, asked: a.asked,
      night: actId === 'night' ? { ...s.night, tiles: NIGHT_TILES, pattern: NIGHT_LANTERN, limit: NIGHT_LIMIT } : null,
      granary: actId === 'granary' ? { ...s.granary, keepers: KEEPERS.map((id) => ({ id, name: name(id) })) } : null,
      prediction: (session.state.predictions?.[workOf(actId)]?.list || []).find((p) => p.beat === act.beat) || null,
    };
  }

  function summarizeActs() {
    const s = P();
    return [...ACT_ORDER, 'granary'].filter((id) => s.acts[id]).map((id) => ({ id, title: ACTS[id].title, choice: s.acts[id].choice, signal: s.acts[id].signal, text: s.acts[id].outcome?.text || '' }));
  }

  return { begin, next, choose, watch, ask, chooseKeeper, view, grantsOf, state: P };
}

/** 一局走完要多久（秒），给地板检查用 */
export function estimateSeconds(play) {
  const s = play.state();
  let t = EST_SECONDS.film + EST_SECONDS.coda;
  for (const id of ACT_ORDER) if (s.acts[id]) t += id === 'night' ? Math.min(EST_SECONDS.night, 15 * (s.acts.night.steps || 0) + 45) : EST_SECONDS[id];
  return t;
}
