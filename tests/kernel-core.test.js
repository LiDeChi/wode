// 第三阶段·内核单元测试。
//
// 只依赖 docs/KERNEL.md 的契约签名：createKernel / ALWAYS（shared/kernel/kernel.js）、
// matchRule / firstRule（shared/kernel/rules.js）、效果清单（shared/kernel/effects.js，§4）。
// 不 import 任何场景数据、控制器实现或 shared/scenes/*，所以换一套场景这些断言照样成立。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../shared/engine/session.js';
import { createKernel, ALWAYS } from '../shared/kernel/kernel.js';
import { matchRule, firstRule } from '../shared/kernel/rules.js';

const NEED = '我想看一个人在乱世里怎么做选择';
const ANSWERS = { wait: 0.8, polish: 0.8, depth: 0.85 };

/** 一个最小的说话控制器：只为把内核的闸门、规则、效果、记账跑起来 */
function speech(cfg) {
  return {
    id: 'speech',
    init: () => ({}),
    intents: () => cfg.lines.map((l) => ({
      id: l.id, verb: 'say', to: l.to, line: l.line,
      appeal: l.appeal, channels: l.channels, owner: 'speech',
    })),
    // 只有真经 ctx.react 的动作才会长出 Reaction；这里可以开关，专门验证这一点
    apply: (intent, ctx) => (cfg.react ? ctx.react(intent.to, { appeal: intent.appeal, channels: intent.channels }) : null),
    view: () => ({}),
  };
}

const LINES = [
  { id: 'yi', to: 'xinling', appeal: { 义: 0.8 }, channels: { 义: 0.6, 请求: 0.3 }, line: '「赵亡则魏危，救赵是义。」' },
  { id: 'li', to: 'xinling', appeal: { 利: 0.8 }, channels: { 请求: 0.4 }, line: '「救下赵国，魏国能得河东的地。」' },
];

const SCENE = {
  work: 'qiefu',
  beat: 'hall',
  title: '堂上',
  place: '大梁',
  goal: '把每一处闸门试出来',
  scene: '一个只为单测内核而搭的最小场景：一个人、一句话、一张规则表。',
  lead: 'xinling',
  people: ['xinling', 'jinbi'],
  ambient: { kind: 'plead', channels: { 请求: 0.5 } },
  wait: { id: 'wait', to: 'xinling', line: '不出声，看他自己怎么办' },
  finish: 'after-first-rule',
};

/**
 * 搭一台最小内核：真 session（账本/心智都是真的），但导演授予由测试直接写死，
 * 这样“授了什么动词”由测试决定，不依赖四个场景或导演性情。
 */
function bare({ grants = ['say'], then = [['flag', 'heard', true]], text = '公子按着案几站起来。', react = true } = {}) {
  const session = createSession();
  session.meet(ANSWERS, NEED);
  session.state.designs = {
    qiefu: { beats: [{ id: 'hall', scene: 'hall', grants, level: grants.length ? 2 : 0, language: '选一句', why: '单测用' }] },
  };
  const scene = {
    ...SCENE,
    controllers: [['speech', { lines: LINES, react }]],
    rules: [{ when: { intent: ['yi', 'li'] }, then, text }],
  };
  const kernel = createKernel(session, { scenes: { hall: scene }, controllers: { speech } });
  return { session, kernel };
}

/* ---------------- 授予闸门 ---------------- */

test('等、看、问 是不用导演授予的三种动词', () => {
  assert.deepEqual(ALWAYS, ['wait', 'watch', 'ask']);
});

test('导演没授予的动词被挡，等/看/问 永远可选', () => {
  const { kernel } = bare({ grants: ['say'] });
  kernel.enter('hall');
  assert.deepEqual(kernel.grants('hall').verbs, ['say']);
  assert.ok(kernel.allowed('hall', { verb: 'say' }));
  assert.ok(!kernel.allowed('hall', { verb: 'give' }), '没授予 give，就不该可选');
  for (const verb of ALWAYS) {
    assert.ok(kernel.allowed('hall', { verb }), `${verb} 不该被闸门挡住`);
  }
  // 一个动词都没授予时，等/看/问 仍然可选
  const none = bare({ grants: [] });
  none.kernel.enter('hall');
  assert.deepEqual(none.kernel.grants('hall').verbs, []);
  for (const verb of ALWAYS) assert.ok(none.kernel.allowed('hall', { verb }));
});

test('带 needs 的动词要 needs 里每一项都被授予才可选', () => {
  const missing = bare({ grants: ['say'] });
  missing.kernel.enter('hall');
  assert.ok(missing.kernel.allowed('hall', { verb: 'say' }));
  assert.ok(!missing.kernel.allowed('hall', { verb: 'say', needs: ['go'] }), 'say 有了、go 没有，仍不可选');

  const complete = bare({ grants: ['say', 'go'] });
  complete.kernel.enter('hall');
  assert.ok(complete.kernel.allowed('hall', { verb: 'say', needs: ['go'] }), 'say 和 go 都授予了才可选');
});

test('intents 列出的每个意图都带着 allowed', () => {
  const { kernel } = bare({ grants: ['say'] });
  kernel.enter('hall');
  const list = kernel.intents('hall');
  assert.ok(list.length >= 2, `至少应有一句话和一个「等」，实际 ${list.length}`);
  for (const intent of list) {
    assert.equal(typeof intent.allowed, 'boolean', `${intent.id} 缺 allowed`);
  }
  assert.ok(list.some((i) => i.id === 'yi' && i.allowed), '授予了 say，yi 应可选');
  assert.ok(list.some((i) => i.id === 'wait' && i.allowed), '「等」应永远可选');
});

/* ---------------- 规则匹配（纯函数） ---------------- */

test('第一条匹配的规则生效，后面的不再看', () => {
  const rules = [
    { when: { intent: 'a', accepted: true }, then: [['flag', 'first', true]] },
    { when: { intent: ['a', 'b'] }, then: [['flag', 'second', true]] },
    { when: { intent: 'b' }, then: [['flag', 'third', true]] },
  ];
  assert.equal(firstRule(rules, { intent: 'a', accepted: true }), rules[0]);
  assert.equal(firstRule(rules, { intent: 'a', accepted: false }), rules[1], '第一条不匹配，第二条要接住');
  assert.equal(firstRule(rules, { intent: 'b' }), rules[1], '数组形式的 intent 也匹配，且仍按从上到下取第一条');
  assert.ok(!firstRule(rules, { intent: 'z' }), '没有一条匹配时应为空');
});

test('when.action 可以写成正则，按动作文本匹配', () => {
  assert.ok(matchRule({ action: /^挪/ }, { action: '挪一格' }));
  assert.ok(!matchRule({ action: /^挪/ }, { action: '贴着墙根，等灯过去' }));
  assert.ok(matchRule({ action: '挪一格' }, { action: '挪一格' }), '字符串也应能精确匹配');
  assert.ok(!matchRule({ action: '挪一格' }, { action: '一口气冲两格' }));
});

test('flag 条件要求事实里的旗号相等', () => {
  assert.ok(matchRule({ flag: { kingSuspicious: true } }, { flag: { kingSuspicious: true } }));
  assert.ok(!matchRule({ flag: { kingSuspicious: true } }, { flag: { kingSuspicious: false } }));
  assert.ok(!matchRule({ flag: { kingSuspicious: true } }, { flag: {} }), '旗号没升起时条件不成立');
});

test('trust 条件按某个人的信任读数比较', () => {
  const facts = { trust: { xinling: 0.5 } };
  assert.ok(matchRule({ trust: { person: 'xinling', gte: 0.45 } }, facts));
  assert.ok(!matchRule({ trust: { person: 'xinling', gte: 0.55 } }, facts));
  assert.ok(matchRule({ trust: { person: 'xinling', lt: 0.55 } }, facts));
  assert.ok(!matchRule({ trust: { person: 'xinling', lt: 0.45 } }, facts));
});

test('多个条件要同时成立才算匹配', () => {
  const when = { intent: 'yi', accepted: true, flag: { night: 'clean' } };
  assert.ok(matchRule(when, { intent: 'yi', accepted: true, flag: { night: 'clean' } }));
  assert.ok(!matchRule(when, { intent: 'yi', accepted: false, flag: { night: 'clean' } }));
  assert.ok(!matchRule(when, { intent: 'li', accepted: true, flag: { night: 'clean' } }));
  assert.ok(!matchRule(when, { intent: 'yi', accepted: true, flag: { night: 'seen' } }));
});

/* ---------------- Reaction 只能来自 ctx.react ---------------- */

test('没经过 ctx.react 的动作，不会凭空长出一个反应', () => {
  const { session, kernel } = bare({ react: false, text: '公子点点头。' });
  kernel.enter('hall');
  const out = kernel.dispatch('hall', 'yi');
  assert.equal(out.r, null, '控制器没调 ctx.react，就不该有 Reaction');
  assert.equal(session.ledger.entries.filter((e) => e.kind === 'actor.react').length, 0);
  assert.equal(out.text, '公子点点头。', '规则照样匹配，只是没有反应');
});

test('经过 ctx.react 的动作，反应带着 user.act 与 actor.react 两条账', () => {
  const { session, kernel } = bare({ react: true });
  kernel.enter('hall');
  const out = kernel.dispatch('hall', 'yi');
  assert.ok(out.r, '经过 react 的动作应有反应');
  assert.equal(typeof out.r.userSeq, 'number');
  assert.equal(typeof out.r.reactSeq, 'number');
  assert.equal(session.ledger.get(out.r.userSeq).kind, 'user.act');
  assert.equal(session.ledger.get(out.r.reactSeq).kind, 'actor.react');
  assert.equal(out.r.person, 'xinling');
});

test('规则不能直接造一个反应：清单里没有 react 这种效果', () => {
  const { kernel } = bare({ then: [['react', 'xinling', { tell: '假的前兆' }]] });
  kernel.enter('hall');
  assert.throws(() => kernel.dispatch('hall', 'yi'), '规则直接设反应应被拒绝');
});

/* ---------------- 效果与记账 ---------------- */

test('规则里的效果逐条落地，写下的账都追得回用户', () => {
  const then = [
    ['trust', 'xinling', 0.7, '一句话说到心里'],
    ['flag', 'heard', true],
    ['clock', -2],
    ['claim', { subject: '信陵君', predicate: '门客的话', object: '义不容辞' }, '大梁的当面之言'],
    ['end', 'history'],
  ];
  const { session, kernel } = bare({ react: true, then });
  const world = kernel.enter('hall');
  const before = session.ledger.size;
  const out = kernel.dispatch('hall', 'yi');

  const added = session.ledger.entries.slice(before);
  assert.ok(added.length >= 3, `效果至少要写下三条账（user.act / actor.react / actor.trust / claim），实际 ${added.length}`);
  for (const e of added) assert.ok(session.trace(e.seq).ok, `第 ${e.seq} 条（${e.kind}）追不到用户`);

  assert.ok(added.some((e) => e.kind === 'actor.trust'), 'trust 效果应写下 actor.trust');
  assert.ok(added.some((e) => e.kind.startsWith('claim.')), 'claim 效果应写下主张');
  assert.equal(session.minds.xinling.state.trust['actor:player'], 0.7, '信任被效果改到 0.7');
  assert.equal(world.flags.heard, true, 'flag 效果改的是这一场共享的 world');
  assert.deepEqual(out.claims.length, 1, 'Outcome.claims 应是这次生效的主张 id 列表');
  assert.equal(out.end, 'history', 'end 效果把结局交给 Outcome.end');
});

test('不在封闭清单里的效果种类直接抛错', () => {
  const { kernel } = bare({ then: [['反间', 'xinling', 1]] });
  kernel.enter('hall');
  assert.throws(() => kernel.dispatch('hall', 'yi'), /反间|效果|effect/);
});
