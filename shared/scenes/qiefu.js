// 《窃符》四幕，写成数据（docs/KERNEL.md §2，机制见 docs/design/MECHANICS.md）。
//
// QIFU_SCENES 是机制改版：人物初值在 cast，四幕后果在规则表。相对旧 golden 结局、天数、
// 旗标和账本都会变，这是被授权的内容改版，不是内核回归。旧 golden 不要用这次结果覆盖。
//
// 无 cast、控制器表仍是旧三件套的场景副本，必须保持旧行为：
//   - lines 没有 scene.cast 时 init/restore 什么都不做；
//   - nightwalk 只有场景带 cast 时，才把「停在门口」写成「人还在门口、灯已经挪走」；
//   - yeStage 原样留着，给仍点名它的旧副本用。本文件的邺城改用内核 standing，不再走 yeStage。
//
// 账本顺序（改规则时先看这里）：
//   1. 夷门：先反应，再写主张，再献计，最后写如姬信任。献计每条规则都带。
//   2. 邺城：standing 先 setTrust('jinbi') 再 react。规则只读 accepted / backlash，不把 accepted 写成 true。
//   3. 取符之夜：移动 → 灯走一步 → 守卫甲警觉 → 灯照到正在动的你 → 到后门 → 超过 12 步天亮。
//   4. 大梁：义被接受时 claim → trust → clock；利是少耗一天并丢掉替公子说话的身份。

import { createMind } from '../core/mind.js';

const round = (v) => Math.round(v * 1000) / 1000;

/** 只活在这一次 session 上，不进存档。重载时 session 是新的，会再装一次 def，但不会用初值盖掉经历。 */
const CAST_MARK = Symbol.for('ling.qiefu.cast');

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

/** 这份存档里的心智已经不是 seed 初值：信任、压力、记忆、装上的办法，任一变过都算经历过。 */
function lived(saved, seedDef) {
  if (!saved) return false;
  if (saved.log?.length || saved.installed?.length) return true;
  if (saved.memory && Object.keys(saved.memory).length) return true;
  if (saved.others && Object.keys(saved.others).length) return true;
  const seedTrust = seedDef.trust || {};
  const now = saved.trust || {};
  for (const k of new Set([...Object.keys(seedTrust), ...Object.keys(now)])) {
    if ((now[k] ?? null) !== (seedTrust[k] ?? null)) return true;
  }
  return (saved.stress ?? 0.2) !== (seedDef.stress ?? 0.2);
}

function mergeCast(seedDef, override) {
  const next = clone(seedDef);
  for (const key of ['values', 'resist', 'trust', 'threshold', 'temperament', 'units', 'modules', 'goals', 'voice', 'bio', 'stress']) {
    if (override[key] !== undefined) next[key] = clone(override[key]);
  }
  return next;
}

/**
 * 只读 scene.cast，把作品人物的 def 换成这一份。信任的初值只在「还没经历过」时取 override；
 * 同一 session 之后每幕再进来，只按当时的 save() 重建，不把信任打回表上的初值。
 * 研究台改的是场景副本上的 cast，这里每次都读 ctx.scene.cast。
 */
function installCast(ctx) {
  const cast = ctx.scene?.cast;
  if (!cast || !ctx.session || !ctx.minds) return;
  if (!ctx.session[CAST_MARK]) ctx.session[CAST_MARK] = Object.create(null);
  const book = ctx.session[CAST_MARK];
  for (const [id, override] of Object.entries(cast)) {
    const mind = ctx.minds[id];
    if (!override || !mind) continue;
    if (!book[id]) book[id] = { seed: clone(mind.def), fresh: !lived(mind.save(), mind.def) };
    const saved = mind.save();
    const merged = mergeCast(book[id].seed, override);
    let state = saved;
    if (book[id].fresh && override.trust && !lived(saved, book[id].seed)) {
      state = { ...saved, trust: clone(override.trust) };
    }
    ctx.minds[id] = createMind(merged, state);
  }
}

/**
 * 《窃符》本地人物初值（MECHANICS.md §2）。未写的字段沿用 seed。
 * 信任初值不写在这里，沿用 seed：信陵君 .5、如姬/晋鄙 .2、其余 .3。
 */
export const QIFU_CAST = {
  xinling: {
    values: { 义: 0.9, 利: 0.1, 惧: 0.15, 恩: 0.2 },
    resist: { 利: { 疑心: 0.3 } },
    voice: '救赵是我的事。拿土地换人命，我门下不讲。',
    bio: 'S77：“數請魏王，及賓客辯士說王萬端”，终不得；欲率宾客赴秦军。他在乎救赵的责任；拿土地交易人命，会失去替他说话的身份。性情为本作设计假设。',
  },
  houying: {
    values: { 义: 0.15, 利: 0.75, 惧: 0.15, 恩: 0.25 },
    resist: { 义: { 疑心: 0.45 } },
    voice: '可行的路，比漂亮的义话重。我还在看公子。',
    bio: 'S77：“欲以觀公子”“侯生視公子色終不變”；献计窃符，约定到军之日北向自刎。他要可行的谋划、要保住人；空喊大义催他献计，他会冷眼。性情为本作设计假设。',
  },
  ruji: {
    values: { 义: 0.15, 利: 0.1, 惧: 0.1, 恩: 0.95 },
    resist: { 义: { 畏: 0.3 }, 惧: { 畏: 0.3 } },
    voice: '我记得公子的恩。被发现的怕也在。托付未到，我要先问一句。',
    bio: 'S77：父为人所杀，信陵君使客斬其仇頭，如姬感恩。她在乎私恩和自己的安全；为天下牺牲听起来像拿她作工具。性情为本作设计假设。',
  },
  jinbi: {
    values: { 义: 0.15, 利: 0.8, 惧: 0.2, 恩: 0.7 },
    resist: { 义: { 疑心: 0.4 }, 惧: { 疑心: 0.5 } },
    threshold: 0.5,
    voice: '十万魏卒的安全，和交割的手续，我要看清楚。拿大义压军令，像是来夺军。',
    bio: 'S77：“晉鄙合符，疑之”，不肯授兵；信陵君称其“嚄唶宿將”。他要交割安排和魏卒安全；用天下大义压军令，像是来夺军。性情为本作设计假设。',
  },
  zhuhai: {
    values: { 义: 0.2, 利: 0.2, 惧: 0.15, 恩: 0.85 },
    resist: { 惧: { 畏: 0.2 } },
    voice: '公子的恩我记得。没有明确托付，我不动铁椎。',
    bio: 'S77：“朱亥袖四十斤鐵椎，椎殺晉鄙”。他认公子的恩和明确托付，不是听一句义就动铁椎。性情为本作设计假设。',
  },
  zhaoshi: {
    values: { 义: 0.25, 利: 0.2, 惧: 0.85, 恩: 0.2 },
    resist: { 利: { 疑心: 0.3 } },
    voice: '邯郸等不及。拿土地来谈，不像来救命的。',
    bio: 'Z3 中赵向魏求救的使者；原文不载其名。他在乎邯郸眼前的危急；土地价码不像真正救援。性情为本作设计假设。',
  },
  guard_a: {
    values: { 义: 0.1, 利: 0.15, 惧: 0.7, 恩: 0.2 },
    resist: { 利: { 疑心: 0.4 }, 义: { 疑心: 0.3 } },
    voice: '当班失职，我担不起。拿令牌套交情，我查得更严。',
    bio: '虚构。守卫甲怕当班失职；拿令牌套交情，只使他查得更严。令牌该交给乙，不是塞钱。性情为本作设计假设。',
  },
  guard_b: {
    values: { 义: 0.1, 利: 0.9, 惧: 0.1, 恩: 0.2 },
    resist: { 惧: { 畏: 0.4 }, 义: { 疑心: 0.3 } },
    voice: '有令牌，责任就有人接。威逼不能让我闭眼。',
    bio: '虚构。守卫乙要把责任交给有令牌的人；威逼不能让他闭眼。令牌交一次便不可收回。性情为本作设计假设。',
  },
  weiwang: {
    voice: '寡人再想想。一种话就想让寡人动兵，没有这回事。',
    bio: 'S77：魏王畏秦，“使人止晉鄙，留軍壁鄴，名為救趙，實持兩端以觀望”。他持两端；没有一种话能把他强行说动。性情为本作设计假设。',
  },
};

/**
 * lines：递交选项，并作为 cast 的安装口（MECHANICS.md §2）。
 * 反应仍走内核「intent.to」那条路。没有 options 的 lines 不增加选项，只负责装人物。
 */
/**
 * 进场正文按站位二选一。句子来自本场 standing.why，不另写一套门槛。
 * 只改玩家看见的 scene / goal，不写信任、不写旗标、不改选项台词（选项台词会进账本）。
 */
function applyOpening(ctx) {
  const spec = ctx.scene?.opening;
  if (!spec || spec.by !== 'standing') return;
  const cfg = (ctx.scene.controllers || []).find((row) => row[0] === 'standing')?.[1] || {};
  const which = cfg.speaker && ctx.trustOf(cfg.speaker) >= (cfg.threshold ?? 0.45) ? 'high' : 'low';
  const why = (cfg.why || {})[which];
  if (!why) return;
  if (typeof spec.scene === 'string') ctx.scene.scene = spec.scene.replaceAll('{why}', why);
  if (typeof spec.goal === 'string') ctx.scene.goal = spec.goal.replaceAll('{why}', why);
}

export function lines(cfg = {}) {
  const options = cfg.options || [];
  return {
    id: cfg.id || 'lines',
    init(ctx) { installCast(ctx); applyOpening(ctx); return {}; },
    restore(ctx) { installCast(ctx); applyOpening(ctx); },
    intents() {
      return options.map((o, i) => ({ ...o, order: o.order ?? (cfg.order ?? 100) + i }));
    },
  };
}

const NIGHT_LANTERN = [1, 2, 3, 2];      // 守卫甲提灯巡夜，每一步照到的格子（固定节奏，学得会）
const NIGHT_GOAL = 4;                    // 0 宫门外 → 1 回廊 → 2 中庭（守卫乙）→ 3 卧内门口（如姬）→ 4 后门
const NIGHT_LIMIT = 12;                  // 超过这么多步天就亮了
const NIGHT_TILES = ['宫门外', '回廊', '中庭', '卧内门口', '后门'];

/**
 * 取符之夜：走一格这件事写在账本上只有 {act,option,pos}（旧 nightStep 手写的那条），
 * 位置、灯、令牌、如姬定没定神，全在这一场自己手里。
 * 内核在这一场只做三件事：把这一步记进账本（ctx.act）、让守卫与如姬反应（ctx.react / 内核 perceive）、
 * 跑本场的规则表（灯走过之后谁看见了谁 → flag + work 两条效果）。
 * 移动、巡灯、令牌、等候的判定不改。带 cast 时，停在门口的那一步必须同时看见「人还在门口、灯已经挪走」。
 */
export function nightwalk() {
  const OPTIONS = [
    { id: 'step', verb: 'go', line: '往前挪一格' },
    { id: 'rush', verb: 'go', line: '一口气冲两格' },
    { id: 'token_b', verb: 'give', to: 'guard_b', item: '宫中令牌', channels: { 令: 0.6, 人: 0.3 }, line: '把令牌塞给中庭的守卫乙' },
    { id: 'token_a', verb: 'give', to: 'guard_a', item: '宫中令牌', channels: { 令: 0.6, 人: 0.3 }, line: '把令牌递给提灯的守卫甲' },
    { id: 'wait', verb: 'wait', line: '贴着墙根，等灯过去' },
  ];
  const st = (ctx) => ctx.ctrl('nightwalk');
  return {
    id: 'nightwalk',
    init() {
      return {
        pos: 0, step: 0, lantern: NIGHT_LANTERN[0], token: null, bLooksAway: false, aAlert: false,
        rujiReady: false, hesitant: false, seen: false, done: false, reason: null, trail: [],
        moved: false, lastText: '',            // 只给外壳读：这一步的动作文本（旧 out.text）
      };
    },
    intents(ctx) {
      const s = st(ctx);
      return OPTIONS.map((o, i) => ({
        ...o,
        order: 100 + i,
        usable: !((o.id === 'token_a' || o.id === 'token_b') && s?.token),
        refusedText: '令牌已经出手了。',
      }));
    },
    apply(intent, ctx) {
      const s = st(ctx);
      const before = s.pos;
      let text = '';
      let r = null;
      let moved = false;
      let heldDoor = false;
      if (intent.id === 'token_b' || intent.id === 'token_a') {
        if (s.token) return { text: '令牌已经出手了。', refused: true };
        const who = intent.id === 'token_b' ? 'guard_b' : 'guard_a';
        r = ctx.react(who);
        s.token = who;
        if (who === 'guard_b') {
          s.bLooksAway = /装作没看见/.test(r.perception.action.act);
          text = s.bLooksAway ? '守卫乙掂了掂令牌，把头转向墙那边。' : `守卫乙${r.perception.action.act}。`;
        } else {
          s.aAlert = true;
          text = `守卫甲举灯照你的脸：「${ctx.minds.guard_a.def.voice}」`;
        }
      } else if (intent.id === 'wait') {
        ctx.act({ id: 'wait' }, { pos: s.pos });
        if (s.pos === 3 && !s.rujiReady) {
          s.rujiReady = true;
          text = '门后的如姬低声问：「会不会被发现？」你等她定下神，她把半块兵符递了出来。';
        } else text = '你贴着墙根，屏住气。';
      } else {
        ctx.act(intent, { pos: s.pos });
        const want = intent.id === 'rush' ? 2 : 1;
        for (let i = 0; i < want; i++) {
          if (s.pos === 3 && !s.rujiReady) { heldDoor = true; text = '如姬还在门后，低声问：「会不会被发现？」你停住了。'; break; }
          s.pos += 1;
          moved = true;
          if (s.pos === 2 && !s.bLooksAway) { s.seen = true; s.reason = '中庭的守卫乙看见了你'; break; }
          if (s.pos >= NIGHT_GOAL) break;
        }
        if (!text) text = `你挪到了${NIGHT_TILES[s.pos]}。`;
      }
      // 灯往前走一步；谁看没看见你，按旧 nightStep 的那四条判，顺序也一样
      s.step += 1;
      s.lantern = NIGHT_LANTERN[s.step % NIGHT_LANTERN.length];
      if (heldDoor && ctx.scene?.cast) {
        text = `你仍在${NIGHT_TILES[s.pos]}，灯已挪到${NIGHT_TILES[s.lantern]}。如姬还在门后，低声问：「会不会被发现？」`;
      }
      if (!s.seen && s.aAlert) { s.seen = true; s.reason = '守卫甲拦住了你，要看令牌'; }
      if (!s.seen && moved && s.lantern === s.pos && s.pos < NIGHT_GOAL) { s.seen = true; s.reason = `灯照到了${NIGHT_TILES[s.pos]}，你还在动`; }
      if (!s.seen && s.pos >= NIGHT_GOAL) { s.done = true; text += ' 你从后门出来，怀里揣着半块兵符。'; }
      if (!s.seen && !s.done && s.step >= NIGHT_LIMIT) { s.seen = true; s.reason = '天快亮了，换班的卫士撞见了你'; }
      if (s.seen) { s.done = true; text += ` ${s.reason}。`; }
      s.trail.push({ step: s.step, option: intent.id, from: before, to: s.pos, lantern: s.lantern, seen: s.seen });
      s.moved = moved;
      s.lastText = text;
      return { r, text, end: s.done ? (s.seen ? 'seen' : 'clean') : undefined };
    },
    view(ctx) {
      const s = st(ctx) || {};
      return {
        pos: s.pos, step: s.step, lantern: s.lantern, token: s.token, bLooksAway: s.bLooksAway,
        aAlert: s.aAlert, rujiReady: s.rujiReady, hesitant: s.hesitant, seen: s.seen, done: s.done,
        reason: s.reason, trail: s.trail,
      };
    },
  };
}

/**
 * 邺城旧副本用的控制器。本文件的 QIFU_SCENES.ye 已改用内核 standing，不再调用它。
 * 留下是为了：没有 cast、控制器表仍写 yeStage 的旧场景副本，行为与改版前一致。
 *   (1) 「没有兵符」那一支要按 wait 的 id 写账，并且不设信任；
 *   (2) 门槛 bar 随「魏王猜忌」浮动，且 setTrust 必须排在 react 前面。
 */
export function yeStage() {
  const OPTIONS = [
    { id: 'yi', verb: 'say', to: 'jinbi', appeal: { 义: 0.8 }, channels: { 军令: 0.3 }, line: '「将军，邯郸旦暮且下。救赵是大义，魏国的义也在将军手里。」' },
    { id: 'en', verb: 'say', to: 'jinbi', appeal: { 恩: 0.8 }, channels: { 兵权: 0.3 }, line: '「公子许将军全身而归，十万魏卒不必死在邺下。」' },
    { id: 'ju', verb: 'say', to: 'jinbi', appeal: { 惧: 0.8 }, channels: { 兵权: 0.4 }, line: '「将军不交兵权，朱亥的铁椎就在身后。」' },
  ];
  return {
    id: 'yeStage',
    init() { return { board: {}, speakingFor: 'xinling', lastStanding: null }; },
    intents() {
      return OPTIONS.map((o, i) => ({ ...o, order: 100 + i }));
    },
    apply(intent, ctx) {
      const s = ctx.ctrl('yeStage');
      const gotFu = ctx.world.flags.night === 'clean';
      if (!gotFu) {
        ctx._intent = { ...intent, id: 'wait' };       // 旧 resolveYe：只把 id 换成 wait，verb/line 保持所选那一项
        const r = ctx.react('jinbi', { channels: intent.channels, appeal: null, bar: null });
        return { r, text: '公子一行到了邺下，手里没有兵符。晋鄙闭营不见，十万魏军仍停在原地。', claims: [], choice: null };
      }
      if (intent.id === 'wait') {
        const r = ctx.react('jinbi', {});
        return { r, text: `晋鄙${r.perception.action.act}。朱亥从袖中抽出铁椎，晋鄙倒在帐中。`, claims: [], choice: 'strike' };
      }
      // 合符而疑：他的门槛比平时高。公子信你，你就是替公子说话
      const which = ctx.trustOf('xinling') >= 0.45 ? 'high' : 'low';
      const standing = which === 'high' ? 0.5 : 0.15;
      ctx.setTrust('jinbi', standing, standing > 0.3 ? '公子让你上前替他说话' : '晋鄙不认识你这个新来的门客', [ctx.openSeq].filter(Boolean));
      s.lastStanding = which;
      const bar = round(0.5 + (ctx.world.flags.kingSuspicious ? 0.05 : 0));
      const r = ctx.react('jinbi', { channels: intent.channels, appeal: intent.appeal, bar });
      return { r };
    },
    view(ctx) {
      const s = ctx.ctrl('yeStage') || {};
      return { kind: 'standing', board: s.board, speakingFor: s.speakingFor, standing: s.lastStanding };
    },
  };
}

/** 侯嬴的计：不管你说什么都会献出来（结构牢），变的是如姬信不信你、路上耽误了几天 */
const HOU_PLAN = ['claim', { subject: '侯嬴', predicate: '献计', object: '从如姬处取符', holder: '侯嬴', note: '史书所载' }];
const RUJI_BACK = '侯嬴转告：公子门下有明白人，托付可靠';
const RUJI_HOU = '侯嬴把可行的路告诉了如姬';
const RUJI_WAIT = '如姬只听说有个陌生门客跟着回来';
const RUJI_LOW = '如姬只听到门客畏死，不确定托不托得住符';

const YE_STRIKE = ['work', 'qiefu', 'strike', { reuseOpen: true }];
const YE_PERSUADE = ['work', 'qiefu', 'persuade', { reuseOpen: true }];
const JINBI_HEARD = ['claim', { subject: '晋鄙', predicate: '听了门客的话', object: '解下印绶', holder: '晋鄙' }];

export const QIFU_SCENES = {
  daliang: {
    work: 'qiefu', beat: 'daliang', title: '信陵君府', place: '大梁', lead: 'xinling',
    people: ['xinling', 'zhaoshi', 'zhuhai'],
    goal: '魏王不肯发兵。替信陵君想个办法。先看清他忌什么。',
    scene: '赵使的竹简摊在案上，信陵君已经第三次从宫里空手回来。他救赵，但不拿土地换人命。',
    ambient: { kind: 'plead', channels: { 请求: 0.6, 义: 0.3 } },
    cast: QIFU_CAST,
    controllers: [
      ['speech', { order: 100, options: [
        { id: 'yi', verb: 'say', to: 'xinling', appeal: { 义: 0.8 }, channels: { 义: 0.6, 请求: 0.3 }, line: '「公子，赵亡则魏危。救赵是义，不救，天下的士人都要寒心。」' },
        { id: 'li', verb: 'say', to: 'xinling', appeal: { 利: 0.8 }, channels: { 请求: 0.4 }, line: '「救下赵国，魏国能得河东的地。」' },
      ] }],
      ['lines', { options: [
        { id: 'letter', order: 102, verb: 'give', to: 'xinling', item: '赵使的竹简', appeal: { 义: 0.4 }, channels: { 请求: 0.6, 义: 0.4 }, line: '把赵使的竹简推到公子手边' },
        { id: 'king', order: 103, verb: 'say', needs: ['go'], to: 'weiwang', appeal: { 惧: 0.7 }, channels: { 秦: 0.6, 威胁: 0.4 }, line: '跟公子进宫，对魏王说：「秦军不足畏。」' },
      ] }],
    ],
    wait: { id: 'wait', to: 'xinling', line: '不出声，看公子自己怎么办' },
    finish: 'after-first-rule',
    rules: [
      { when: { intent: 'king' },
        then: [
          ['claim', { subject: '魏王', predicate: '对信陵君', object: '更加猜忌，闭门不见', holder: '魏王', note: '新来的门客当面说秦不足畏' }],
          ['flag', 'kingSuspicious', true],
          ['trust', 'weiwang', 0.25, '新来的门客当面说秦不足畏'],
          ['clock', -3],
        ],
        text: '魏王的手指在案上停住。第二天，宫里传出话来：公子不必再来了。这不是一条进宫就能赢的路，邺城的晋鄙会更难说动。',
        cost: '魏王更猜忌信陵君；邺城的晋鄙会更难说动' },
      { when: { intent: 'wait' },
        then: [
          ['trust', 'xinling', 0.3, '公子尚未将你当作说项人'],
          ['clock', -3],
        ],
        text: '公子自己又进宫去了，{action}。回来时，脸色更沉。他还没把你当作说项的人。',
        cost: '机会自己过去了，公子尚未将你当作说项人' },
      { when: { intent: 'li' },
        then: [
          ['claim', { subject: '信陵君', predicate: '看新来的门客', object: '只讲利，不再让他代表自己', holder: '信陵君' }],
          ['trust', 'xinling', 0.2, '不再让你代表公子'],
          ['clock', -1],
        ],
        text: '公子看了你一眼：「拿土地换人命，我门下不讲这个。」他不再让你代表他说话。这一次少耗了一天，身份先丢了。',
        cost: '少耗了一天，但你失去了替公子说话的身份' },
      { when: { intent: 'letter', accepted: true },
        then: [
          ['claim', { subject: '信陵君', predicate: '门客的话', object: '竹简是实情，不是口头的义举', holder: '信陵君' }],
          ['trust', 'xinling', 0.5, '竹简是实情，不是口头的义举'],
          ['trust', 'ruji', 0.5, '竹简到了公子手里，如姬知道这是实情'],
          ['flag', 'rujiTrust', 0.5],
          ['clock', -2],
        ],
        text: '公子把竹简又读了一遍，卷起来揣进袖里，起身往宫里去。提交实情省了一天，但这不是口头义举的声望。',
        cost: '提交实情省一天，但没有口头义举的声望' },
      { when: { intent: 'yi', accepted: true },
        then: [
          ['claim', { subject: '信陵君', predicate: '门客的话', object: '义不容辞，再请魏王', holder: '信陵君' }],
          ['trust', 'xinling', 0.65, '愿让你替他说话'],
          ['clock', -3],
        ],
        text: '公子按着案几站起来：「说得是。」他又一次进宫去了。他愿让你替他说话，可这一来一去又是三天。',
        cost: '愿让你替他说话，但又耗三天' },
      { when: { intent: 'letter' },
        then: [['clock', -2]],
        text: '公子点点头，没有接话。',
        cost: '这句话没落到他心上' },
      { when: { intent: 'yi' },
        then: [['clock', -3]],
        text: '公子点点头，没有接话。',
        cost: '这句话没落到他心上' },
    ],
  },

  yimen: {
    work: 'qiefu', beat: 'yimen', title: '夷门', place: '大梁东门', lead: 'xinling',
    people: ['xinling', 'houying'],
    goal: '公子要带宾客去和秦军拼命。侯嬴站在门口，不送。先看他在等什么样的话。',
    scene: '车骑百余乘过夷门，侯嬴只说了一句「公子勉之，老臣不能从」。可行的路比漂亮的义话重。',
    ambient: { kind: 'snub', channels: { 人: 0.5, 恩: 0.4 } },
    cast: QIFU_CAST,
    controllers: [
      ['lines', {}],
      ['speech', { order: 100, options: [
        { id: 'back', verb: 'say', to: 'xinling', appeal: { 义: 0.7 }, channels: { 义: 0.5, 人: 0.3 }, line: '「侯生待公子不薄，今天不送，必有缘故。」' },
        { id: 'fear', verb: 'say', to: 'xinling', appeal: { 惧: 0.8 }, channels: { 请求: 0.3 }, line: '「秦军虎狼，去了就是送死。」' },
        { id: 'hou', verb: 'say', to: 'houying', appeal: { 利: 0.7 }, channels: { 人: 0.5, 观察: 0.3 }, line: '「先生，别让百余人白死，您有可行的路？」' },
      ] }],
    ],
    wait: { id: 'wait', to: 'xinling', line: '跟着车走，不出声' },
    finish: 'after-first-rule',
    rules: [
      { when: { intent: 'hou', accepted: true },
        then: [
          ['claim', { subject: '侯嬴', predicate: '看信陵君门下', object: '有人问得出可行的路', holder: '侯嬴' }],
          HOU_PLAN,
          ['trust', 'ruji', 0.5, RUJI_HOU],
          ['flag', 'rujiTrust', 0.5],
          ['clock', -3],
        ],
        text: '侯嬴看了你一会儿，点了点头：「百余人不能白死。」他把路慢慢说出来。这一问比让公子回头慢，但是条可行的路，不是拿钱买他。',
        cost: '得到较慢但可靠的谋划，如姬会知道你问过可行的路' },
      { when: { intent: 'hou' },
        then: [HOU_PLAN, ['trust', 'ruji', 0.08, RUJI_LOW], ['flag', 'rujiTrust', 0.08], ['clock', -3]],
        text: '侯嬴不理你，抬头看天。计他还是献了，如姬却没得到能托付的人。',
        cost: '献计仍会发生，如姬不确定托不托得住符' },
      { when: { intent: 'wait' },
        then: [HOU_PLAN, ['trust', 'ruji', 0.18, RUJI_WAIT], ['flag', 'rujiTrust', 0.18], ['clock', -2]],
        text: '车走出几里，公子勒住马：「我待侯生不薄，他为什么不送？」他自己掉头回来了。计献出来了，如姬只知道有个陌生门客。',
        cost: '献计仍会发生，陌生门客缺担保，比畏死少耽误一天' },
      { when: { intent: 'back', accepted: true },
        then: [
          ['claim', { subject: '信陵君', predicate: '夷门之后', object: '听门客一句话折返', holder: '信陵君' }],
          HOU_PLAN,
          ['trust', 'ruji', 0.55, RUJI_BACK],
          ['flag', 'rujiTrust', 0.55],
          ['clock', -1],
        ],
        text: '公子勒住马，看了你一眼，掉头回到夷门。侯生这才把路说出来。如姬先收到了可靠的托付。',
        cost: '尊重侯生所以快回头，如姬先收到可靠托付' },
      { when: { intent: 'fear' },
        then: [
          ['claim', { subject: '信陵君', predicate: '看新来的门客', object: '怕死', holder: '信陵君' }],
          HOU_PLAN,
          ['trust', 'ruji', 0.08, RUJI_LOW],
          ['flag', 'rujiTrust', 0.08],
          ['clock', -3],
        ],
        text: '公子只说：「我知道。」车照样往前走，走出很远，他才自己回头。如姬只听到门客畏死，不确定这个人托不托得住符。',
        cost: '她只听到门客畏死，不确定是否托得住符' },
      { when: {},
        then: [HOU_PLAN, ['trust', 'ruji', 0.08, RUJI_LOW], ['flag', 'rujiTrust', 0.08], ['clock', -3]],
        text: '公子没听进去，车照样往前走，走出很远才回头。计还是献了，如姬没得到能托付的人。',
        cost: '世界不会因拒绝停住，如姬不确定托不托得住符' },
    ],
  },

  night: {
    work: 'qiefu', beat: 'night', title: '取符之夜', place: '魏王卧内', lead: 'ruji',
    people: ['ruji', 'guard_a', 'guard_b'],
    goal: '如姬在卧内取符。你要从宫门外摸到后门，把符接出来，不被看见。',
    scene: '守卫甲提着灯，在回廊、中庭、卧内门口之间来回；守卫乙站在中庭。托付未到，如姬会在门口等你定神；托付到了，她不等。甲怕失职，乙要的是令牌上的责任，不是塞钱。',
    ambient: { kind: 'creep', channels: { 人: 0.4 } },
    cast: QIFU_CAST,
    controllers: [['lines', {}], ['nightwalk', {}]],
    wait: null,                       // 等待由 nightwalk 自己列（它的 payload 只有 {act,option,pos}）
    finish: 'on-end',                 // 一幕走完不是一次选择，而是「符出没出卧内」
    keepWork: true,                   // 旧代码只有这一场把 playWork 的结果写进 outcome
    runReact: ['night', 'run'],       // 旧：符落定的那一刻额外交一次真实反应给导演
    rules: [
      { when: { ctrl: { nightwalk: { done: true, seen: true } } },
        then: [['flag', 'night', 'seen'], ['work', 'night', 'seen']],
        choice: 'seen',
        text: '{ctrl.nightwalk.reason}。兵符留在了卧内。' },
      { when: { ctrl: { nightwalk: { done: true } } },
        then: [['flag', 'night', 'clean'], ['work', 'night', 'clean']],
        choice: 'clean',
        text: '符出了卧内。' },
    ],
  },

  ye: {
    work: 'qiefu', beat: 'ye', title: '邺城', place: '邺', lead: 'jinbi',
    people: ['jinbi', 'zhuhai', 'xinling'],
    goal: '晋鄙合了符，还是起疑。他要的是魏卒安全和交割手续，不是一句大义。',
    scene: '晋鄙把两半兵符并在一起，抬头看信陵君：「今吾拥十万之众，单车来代之，何如哉？」拿大义压军令，像是来夺军。',
    // 进场时 lines 按公子信不信你，把 {why} 换成 standing.why 的高/低那一句。进场前这两句保持原样。
    opening: {
      by: 'standing',
      goal: '{why}。他要的是魏卒安全和交割手续，不是一句大义。',
      scene: '晋鄙把两半兵符并在一起，抬头看信陵君：「今吾拥十万之众，单车来代之，何如哉？」{why}。他在意的是十万魏卒能不能安全回去，和交割有没有手续，不是一句大义。',
    },
    ambient: { kind: 'doubt', channels: { 印信: 0.7, 兵权: 0.6 } },
    cast: QIFU_CAST,
    controllers: [
      ['lines', {}],
      ['standing', {
        speaker: 'xinling',
        threshold: 0.45,
        weight: { high: 0.5, low: 0.15 },
        why: { high: '公子让你上前替他说话', low: '晋鄙不认识你这个新来的门客' },
        bar: { base: 0.5, add: 0.05, flag: 'kingSuspicious' },
        people: ['jinbi', 'xinling'],
        targets: [
          { id: 'yi', to: 'jinbi', appeal: { 义: 0.8 }, channels: { 军令: 0.3 }, line: '「救赵大义，请将军即刻交兵。」' },
          { id: 'en', to: 'jinbi', appeal: { 恩: 0.8 }, channels: { 兵权: 0.3 }, line: '「公子许将军全身归营，不让十万魏卒枉死。」' },
          { id: 'li', to: 'jinbi', appeal: { 利: 0.8 }, channels: { 兵权: 0.4, 军令: 0.3 }, line: '「先验换防名册，约定接防和归营，兵权有交代。」' },
          { id: 'ju', to: 'jinbi', appeal: { 惧: 0.8 }, channels: { 兵权: 0.4 }, line: '「将军不交兵权，朱亥的铁椎就在身后。」' },
        ],
      }],
    ],
    wait: { id: 'wait', to: 'jinbi', line: '不出声，看朱亥的铁椎落下' },
    // 没有兵符时，画面只留「等待」，并把台词改成「跟着公子进营」
    optionsWhen: { fact: 'flags.night', not: 'clean', only: ['wait'], line: { wait: '跟着公子进营' } },
    finish: 'after-first-rule',
    rules: [
      { when: { flag: { night: 'clean' }, intent: 'wait' },
        then: [YE_STRIKE],
        text: '晋鄙{action}。朱亥从袖中抽出铁椎，晋鄙倒在帐中。你没有再开口，这一下不多耗一天。',
        choice: 'strike' },
      { when: { flag: { night: 'clean' }, intent: 'en', accepted: true },
        then: [JINBI_HEARD, YE_PERSUADE],
        text: '晋鄙握着兵符看了很久，解下印绶，放在案上。十万魏卒可以全身归营。朱亥的手从袖口里慢慢收了回去。',
        choice: 'persuade' },
      { when: { flag: { night: 'clean' }, intent: 'li', accepted: true },
        then: [JINBI_HEARD, ['clock', -1], YE_PERSUADE],
        text: '晋鄙把换防名册对过，约定了接防和归营，才解下印绶。这是军务上的交代，不是受贿。名册对过，多耗了一天。',
        choice: 'persuade' },
      { when: { flag: { night: 'clean' }, accepted: true },
        then: [JINBI_HEARD, YE_PERSUADE],
        text: '晋鄙握着兵符看了很久，解下印绶，放在案上。朱亥的手从袖口里慢慢收了回去。',
        choice: 'persuade' },
      { when: { flag: { night: 'clean' }, intent: 'yi', backlash: true },
        then: [
          ['claim', { subject: '晋鄙', predicate: '临死前说', object: '拿大义压军令，是来夺军', holder: '晋鄙' }],
          ['flag', 'jinbiAlienated', true],
          ['clock', -1],
          YE_STRIKE,
        ],
        text: '晋鄙按剑而起：「拿天下大义压军令，果然是来夺军的！」这是拿大义压他，不是吓他。朱亥的铁椎落下。',
        choice: 'strike' },
      { when: { flag: { night: 'clean' }, intent: 'ju', backlash: true },
        then: [
          ['claim', { subject: '晋鄙', predicate: '临死前说', object: '铁椎是威胁，不是交代', holder: '晋鄙' }],
          ['flag', 'coercion', true],
          ['clock', -2],
          YE_STRIKE,
        ],
        text: '晋鄙按剑而起：「拿铁椎逼我交兵，这是威胁，不是交代。」和拿大义压他不是一回事。朱亥的铁椎落下。',
        choice: 'strike' },
      { when: { flag: { night: 'clean' }, backlash: true },
        then: [
          ['claim', { subject: '晋鄙', predicate: '临死前说', object: '魏王果然疑我', holder: '晋鄙' }],
          YE_STRIKE,
        ],
        text: '晋鄙按剑而起：「果然是来夺军的！」朱亥的铁椎落下。',
        choice: 'strike' },
      { when: { flag: { night: 'clean' } },
        then: [YE_STRIKE],
        text: '晋鄙摇头：「此事须报大王。」手续没交代清。朱亥看了公子一眼，铁椎落下。',
        choice: 'strike' },
      { when: {},
        then: [YE_STRIKE],
        text: '公子一行到了邺下，手里没有兵符。晋鄙闭营不见，十万魏军仍停在原地。',
        choice: null },
    ],
  },
};

/** 对外就这一张表（tests/assets.test.js 与资产生成管线按 docs/KERNEL.md §2 读它） */
export const SCENES = QIFU_SCENES;

export const QIFU_CONTROLLERS = { lines, nightwalk, yeStage };
export { NIGHT_GOAL, NIGHT_LIMIT, NIGHT_LANTERN, NIGHT_TILES };
