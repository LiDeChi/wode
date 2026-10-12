// 抽内核「之前」的《窃符》场景快照（t32 用）：
//   git show e30209a^:shared/scenes/qiefu.js
// 用途只有一个——证明内核抽取与 t33 的文字改造之后，这张旧场景表跑出来的旧 680 脚本
// 与 tests/fixtures/play-golden.json 仍然一笔不差（差只允许出在 t33 改过的 reason 文字上）。
// 不要改这个文件；它就该永远是那一刻的样子。
// 《窃符》四幕，写成数据（docs/KERNEL.md §2）：控制器清单 + 有序规则表 + 文本。
//
// 这里是「旧 play.js 的 if/else 链」搬过家之后的样子：选项来自控制器的 intents()（顺序就是旧 ACTS 的顺序），
// 后果来自从上到下第一条命中的规则（when + then 效果）。选项 id、文本、账本字段与顺序都和旧的一模一样，
// 所以 680 个脚本的对照组一笔不差。
//
// 四处「顺序」是账本 hash 的命门，改这个文件时先看这里：
//   1. 夷门：先写这次反应（内核的 react），再写具体主张，再写「献计」，最后写如姬的信任。
//      旧实现里献计与信任无条件追加在每次选择之后，所以它们排在每条规则 then 的末尾（一次只命中一条规则）。
//   2. 邺城：先 setTrust('jinbi') 再 react——替谁说话，决定这句话有多重（在 yeStage 里）。
//   3. 取符之夜：移动 → 灯走一步 → 守卫甲警觉 → 灯照到正在动的你 → 到后门 → 超过 12 步天亮（在 nightwalk 里）。
//   4. 大梁：说「利」提前返回（只写「只讲利」）；「义不容辞」只在 accepted 时写。
//
// 三处内核的共用控制器表达不了、由本场自己的控制器补上的地方（原因写在各自的注释里）：
//   - 递东西（大梁的 letter）：payload 要 {option:'letter', item:'赵使的竹简'}，speech 不带 item、handover 的 id 由物品拼出来。
//   - 取符之夜的每一步在账本上只有 {act,option,pos}（旧 nightStep 手写的），位置/灯/令牌都在 nightwalk 手里。
//   - 邺城「没有兵符」那一支要按 wait 的 id 写账、且不设信任：yeStage 照旧写。

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * lines：只把选项交给内核 —— 反应走内核「intent.to」那条路（就是旧 reactOf 的 to 分支，payload 的
 * option/verb/line/item 全部原样进账）。order 按选项自己写的值排；speech 用 cfg.order + i，
 * 插不进「公子的两个说项」中间，所以递竹简那一项由这里列。
 */
export function lines(cfg = {}) {
  const options = cfg.options || [];
  return {
    id: cfg.id || 'lines',
    init() { return {}; },
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
          if (s.pos === 3 && !s.rujiReady) { text = '如姬还在门后，低声问：「会不会被发现？」你停住了。'; break; }
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
 * 邺城：晋鄙合了符还是起疑。两件事内核的 standing 表达不了——
 *   (1) 「没有兵符」那一支要按 wait 的 id 写账（旧 resolveYe 传的是 {...opt, id:'wait'}），并且不设信任；
 *   (2) 门槛 bar 随「魏王猜忌」浮动，且 setTrust 必须排在 react 前面。
 * 所以这一场自己认领三个说项：先 setTrust，再 react；规则表读 accepted / backlash 定后果。
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
const RUJI_HIGH = '侯嬴转告：公子门下有明白人';
const RUJI_LOW = '如姬只听说公子门下多了个新人';

export const QIFU_SCENES = {
  daliang: {
    work: 'qiefu', beat: 'daliang', title: '信陵君府', place: '大梁', lead: 'xinling',
    people: ['xinling', 'zhaoshi', 'zhuhai'],
    goal: '魏王不肯发兵。替信陵君想个办法。',
    scene: '赵使的竹简摊在案上，信陵君已经第三次从宫里空手回来。',
    ambient: { kind: 'plead', channels: { 请求: 0.6, 义: 0.3 } },
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
          ['clock', -3],
        ],
        text: '魏王的手指在案上停住。第二天，宫里传出话来：公子不必再来了。',
        cost: '魏王更猜忌信陵君；邺城的晋鄙会更难说动' },
      { when: { intent: 'wait' },
        then: [['clock', -3]],
        text: '公子自己又进宫去了，{action}。回来时，脸色更沉。',
        cost: '三天过去了' },
      { when: { intent: 'li' },
        then: [['claim', { subject: '信陵君', predicate: '看新来的门客', object: '只讲利', holder: '信陵君' }], ['clock', -3]],
        text: '公子看了你一眼：「我门下的人，也讲这个？」他没再问你的意见。',
        cost: '公子对你的信任降了' },
      { when: { intent: 'letter', accepted: true },
        then: [['claim', { subject: '信陵君', predicate: '门客的话', object: '义不容辞，再请魏王', holder: '信陵君' }], ['clock', -2]],
        text: '公子把竹简又读了一遍，卷起来揣进袖里，起身往宫里去。',
        cost: '公子更信你了' },
      { when: { intent: 'yi', accepted: true },
        then: [['claim', { subject: '信陵君', predicate: '门客的话', object: '义不容辞，再请魏王', holder: '信陵君' }], ['clock', -3]],
        text: '公子按着案几站起来：「说得是。」他又一次进宫去了。',
        cost: '公子更信你了' },
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
    goal: '公子要带宾客去和秦军拼命。侯嬴站在门口，不送。',
    scene: '车骑百余乘过夷门，侯嬴只说了一句「公子勉之，老臣不能从」。',
    ambient: { kind: 'snub', channels: { 人: 0.5, 恩: 0.4 } },
    controllers: [
      ['speech', { order: 100, options: [
        { id: 'back', verb: 'say', to: 'xinling', appeal: { 义: 0.7 }, channels: { 义: 0.5, 人: 0.3 }, line: '「侯生待公子不薄，今天不送，必有缘故。」' },
        { id: 'fear', verb: 'say', to: 'xinling', appeal: { 惧: 0.8 }, channels: { 请求: 0.3 }, line: '「秦军虎狼，去了就是送死。」' },
        { id: 'hou', verb: 'say', to: 'houying', appeal: { 义: 0.6 }, channels: { 观察: 0.5, 人: 0.3 }, line: '回头问侯嬴：「先生不送，是在等公子回来吧？」' },
      ] }],
    ],
    wait: { id: 'wait', to: 'xinling', line: '跟着车走，不出声' },
    finish: 'after-first-rule',
    rules: [
      { when: { intent: 'hou', accepted: true },
        then: [
          ['claim', { subject: '侯嬴', predicate: '看信陵君门下', object: '有人看得懂这场试探', holder: '侯嬴' }],
          HOU_PLAN,
          ['trust', 'ruji', 0.45, RUJI_HIGH],
          ['flag', 'rujiTrust', 0.45],
          ['clock', -3],
        ],
        text: '侯嬴看了你一会儿，笑了，不答，只把门闩落下。他知道公子门下有人看得懂这场试探。',
        cost: '侯嬴会把你的事告诉如姬' },
      { when: { intent: 'hou' },
        then: [HOU_PLAN, ['trust', 'ruji', 0.3, RUJI_LOW], ['flag', 'rujiTrust', 0.3], ['clock', -3]],
        text: '侯嬴不理你，抬头看天。',
        cost: '如姬还不认识你' },
      { when: { intent: 'wait' },
        then: [HOU_PLAN, ['trust', 'ruji', 0.3, RUJI_LOW], ['flag', 'rujiTrust', 0.3], ['clock', -2]],
        text: '车走出几里，公子勒住马：「我待侯生不薄，他为什么不送？」他自己掉头回来了。',
        cost: '如姬还不认识你' },
      { when: { intent: 'back', accepted: true },
        then: [
          ['claim', { subject: '信陵君', predicate: '夷门之后', object: '听门客一句话折返', holder: '信陵君' }],
          HOU_PLAN,
          ['trust', 'ruji', 0.4, RUJI_HIGH],
          ['flag', 'rujiTrust', 0.4],
          ['clock', -1],
        ],
        text: '公子勒住马，看了你一眼，掉头回到夷门。',
        cost: '侯嬴会把你的事告诉如姬' },
      { when: { intent: 'fear' },
        then: [
          ['claim', { subject: '信陵君', predicate: '看新来的门客', object: '怕死', holder: '信陵君' }],
          HOU_PLAN,
          ['trust', 'ruji', 0.3, RUJI_LOW],
          ['flag', 'rujiTrust', 0.3],
          ['clock', -3],
        ],
        text: '公子只说：「我知道。」车照样往前走，走出很远，他才自己回头。',
        cost: '如姬还不认识你' },
      { when: {},
        then: [HOU_PLAN, ['trust', 'ruji', 0.3, RUJI_LOW], ['flag', 'rujiTrust', 0.3], ['clock', -3]],
        text: '公子没听进去，车照样往前走，走出很远才回头。',
        cost: '如姬还不认识你' },
    ],
  },

  night: {
    work: 'qiefu', beat: 'night', title: '取符之夜', place: '魏王卧内', lead: 'ruji',
    people: ['ruji', 'guard_a', 'guard_b'],
    goal: '如姬在卧内取符。你要从宫门外摸到后门，把符接出来，不被看见。',
    scene: '守卫甲提着灯，在回廊、中庭、卧内门口之间来回；守卫乙站在中庭。',
    ambient: { kind: 'creep', channels: { 人: 0.4 } },
    controllers: [['nightwalk', {}]],
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
    goal: '晋鄙合了符，还是起疑。朱亥站在公子身后，袖子里是四十斤的铁椎。',
    scene: '晋鄙把两半兵符并在一起，抬头看信陵君：「今吾拥十万之众，单车来代之，何如哉？」',
    ambient: { kind: 'doubt', channels: { 印信: 0.7, 兵权: 0.6 } },
    controllers: [['yeStage', {}]],
    wait: { id: 'wait', to: 'jinbi', line: '不出声，看朱亥的铁椎落下' },
    // 没有兵符时，旧 view() 只留「等待」，并把台词改成「跟着公子进营」
    optionsWhen: { fact: 'flags.night', not: 'clean', only: ['wait'], line: { wait: '跟着公子进营' } },
    finish: 'after-first-rule',
    rules: [
      { when: { flag: { night: 'clean' }, intent: 'wait' },
        then: [['work', 'qiefu', 'strike', { reuseOpen: true }]],
        text: '晋鄙{action}。朱亥从袖中抽出铁椎，晋鄙倒在帐中。',
        choice: 'strike' },
      { when: { flag: { night: 'clean' }, accepted: true },
        then: [
          ['claim', { subject: '晋鄙', predicate: '听了门客的话', object: '解下印绶', holder: '晋鄙' }],
          ['work', 'qiefu', 'persuade', { reuseOpen: true }],
        ],
        text: '晋鄙握着兵符看了很久，解下印绶，放在案上。朱亥的手从袖口里慢慢收了回去。',
        choice: 'persuade' },
      { when: { flag: { night: 'clean' }, backlash: true },
        then: [
          ['claim', { subject: '晋鄙', predicate: '临死前说', object: '魏王果然疑我', holder: '晋鄙' }],
          ['work', 'qiefu', 'strike', { reuseOpen: true }],
        ],
        text: '晋鄙按剑而起：「果然是来夺军的！」朱亥的铁椎落下。',
        choice: 'strike' },
      { when: { flag: { night: 'clean' } },
        then: [['work', 'qiefu', 'strike', { reuseOpen: true }]],
        text: '晋鄙摇头：「此事须报大王。」朱亥看了公子一眼，铁椎落下。',
        choice: 'strike' },
      { when: {},
        then: [['work', 'qiefu', 'strike', { reuseOpen: true }]],
        text: '公子一行到了邺下，手里没有兵符。晋鄙闭营不见，十万魏军仍停在原地。',
        choice: null },
    ],
  },
};

/** 对外就这一张表（tests/assets.test.js 与资产生成管线按 docs/KERNEL.md §2 读它） */
export const SCENES = QIFU_SCENES;

export const QIFU_CONTROLLERS = { lines, nightwalk, yeStage };
export { NIGHT_GOAL, NIGHT_LIMIT, NIGHT_LANTERN, NIGHT_TILES };
