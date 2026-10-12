// 第三阶段·可玩性测试：只用 createPlay 的公共 API，不看内核内部怎么实现。
//
// 十组断言对着《窃符》四幕 + 《围城》粮仓问同一件事：内核抽出去之后，
// 导演授予、心智算反应、前兆、看心思不改人、追问、信任的跨幕影响、如姬的犹豫、
// 三种结局、每一笔账追得回用户、存档接着玩——一样都不能少。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../shared/engine/session.js';
import { createPlay } from '../shared/engine/play.js';

const A = { wait: 0.8, polish: 0.8, depth: 0.85 };   // 信陵君府落到陆导：锁死雕琢，只给一句话
const B = { wait: 0.2, polish: 0.2, depth: 0.25 };   // 落到单导：放开手脚
const NEED = '我想看一个人在乱世里怎么做选择';

function start(answers = A) {
  const s = createSession();
  s.meet(answers, NEED);
  const p = createPlay(s);
  p.begin();
  const v = p.next();
  return { s, p, v };
}

/** 一幕做完就往下走，coda 也自动过掉（和 tests/fixtures/play-scripts.mjs 的驱动方式一致） */
function advance(p, v) {
  while ((v.stage === 'act' || v.stage === 'granary') && v.done) v = p.next();
  if (v.stage === 'coda') v = p.next();
  return v;
}

// 取符之夜的一条「干净」路线：令牌先让守卫乙装没看见，再踩着灯的节奏走到后门。
const NIGHT_CLEAN = ['token_b', 'wait', 'step', 'step', 'step', 'wait', 'step'];
// 两条「被看见」路线之一：中庭的守卫乙还没被支开就闯过去。
const NIGHT_SEEN = ['step', 'step'];

function playToNight(answers = A, daliang = 'yi', yimen = 'back') {
  const { s, p } = start(answers);
  p.choose(daliang);
  p.next();
  p.choose(yimen);
  const v = p.next();     // 进夜：nightStart 已经算过如姬犹不犹豫
  return { s, p, v };
}

function playToYe(answers = A, daliang = 'yi', yimen = 'back') {
  const r = playToNight(answers, daliang, yimen);
  for (const id of NIGHT_CLEAN) r.p.choose(id);
  const v = r.p.next();   // 夜结束 → 邺城
  return { ...r, v };
}

/** 一直走到粮仓（coda 已过，ending 已定） */
function playToGranary(answers = A, daliang = 'yi', yimen = 'back', ye = 'yi', night = NIGHT_CLEAN) {
  const { s, p } = start(answers);
  p.choose(daliang);
  p.next();
  p.choose(yimen);
  p.next();
  for (const id of night) p.choose(id);
  p.next();               // → 邺城
  p.choose(ye);
  const v = advance(p, p.view());
  return { s, p, v };
}

/* 1. 导演授予决定能做什么 */
test('导演授予的动词决定你能做什么：陆导只给一句话，单导放开手脚', () => {
  const a = start(A);
  const b = start(B);
  assert.deepEqual(a.v.grants.verbs, ['say', 'watch'], '陆导在这一拍只给了 say');
  assert.deepEqual(b.v.grants.verbs, ['go', 'give', 'say', 'watch'], '单导在这一拍全放开');

  assert.equal(a.v.options.find((o) => o.id === 'king').allowed, false, '没授予 go，进宫说魏王就不能选');
  assert.equal(a.v.options.find((o) => o.id === 'letter').allowed, false, '没授予 give，递竹简就不能选');
  assert.equal(a.v.options.find((o) => o.id === 'wait').allowed, true, '「等」不用授予，永远可选');

  const before = a.s.ledger.size;
  assert.throws(() => a.p.choose('king'), /没有授予「say」/);
  assert.throws(() => a.p.choose('letter'), /没有授予「give」/);
  assert.equal(a.s.ledger.size, before, '被挡下的动作不该写账');

  assert.ok(b.v.options.every((o) => o.allowed), '单导这一幕每一个选项都点得动');
});

/* 2. 同一件东西，两个人的心智算出不同反应 */
test('同一件东西，两个守仓人的心智算出不同反应', () => {
  const { p } = playToGranary();
  p.chooseKeeper('keeper_doubt');
  const doubt = p.choose('seal');
  p.chooseKeeper('keeper_rash');
  const rash = p.choose('seal');

  assert.equal(doubt.r.person, 'keeper_doubt');
  assert.equal(rash.r.person, 'keeper_rash');
  assert.equal(doubt.r.perception.stoppedAt, 'mind', '多疑的老秦把印信递到心智那一层，停住了');
  assert.equal(rash.r.perception.stoppedAt, 'unit', '阿季在手脚那一层就用掉了，直接动身');
  assert.notEqual(doubt.r.tell, rash.r.tell, '停在哪一层不同，前兆就该不同');
  assert.match(doubt.r.tell, /老秦/);
  assert.match(rash.r.tell, /阿季/);
});

/* 3. 前兆 */
test('动手之前先有前兆：反应里带着他停在哪一层，也先写进日志', () => {
  const { p } = start(A);
  const out = p.choose('yi');
  assert.ok(out.r.tell, '反应里应带前兆');
  assert.match(out.r.tell, /信陵君/, '前兆写的是人的样子，不是机制名词');
  assert.equal(out.r.perception.stoppedAt, 'module');
  const last = p.view().log.at(-1);
  assert.equal(last.tell, out.r.tell, '同一句前兆先写进日志');
  assert.equal(last.person, 'xinling');
});

/* 4. 看心思不改人 */
test('看心思只读不写：watch 前后他的心智状态一模一样', () => {
  const { s, p } = start(A);
  const before = JSON.stringify(s.minds.zhaoshi.state);
  const w = p.watch('zhaoshi');
  assert.equal(JSON.stringify(s.minds.zhaoshi.state), before, '看心思不该改他的记忆、信任或压力');
  assert.ok(w.preview, '还没对他做过什么，看的是他对此刻局面的设想');
  assert.ok(w.preview.stoppedAt, '设想照样给出他停在哪一层');
});

/* 5. 追问来自真实状态 */
test('追问给的是人话，读数在 debug 里', () => {
  const { s, p } = start(A);
  p.choose('li');
  const react = s.ledger.last((e) => e.kind === 'actor.react');
  assert.equal(react.payload.act, 'daliang');
  assert.equal(react.payload.accepted, false, '只讲利，公子没被说服');
  const ans = p.ask('xinling');
  assert.equal('debug' in ans, true, '追问要把读数（debug）一起带出来');
  assert.equal(/\d/.test(ans.answer), false, `人话里不该出现读数：${ans.answer}`);
  const last = s.state.play.acts.daliang.last;
  assert.equal(ans.debug.moved, last.moved, 'debug 里是这一次真实的打动');
  assert.equal(ans.debug.bar, last.bar, 'debug 里是这一次真实的门槛');
  assert.equal(ans.debug.accepted, false);
  assert.ok(ans.debug.reason, 'debug 里还带着为什么（那句话的来由）');
  assert.ok(s.trace(ans.seq).ok, '追问也写账，也追得回用户');
});

/* 6. 大梁的信任决定邺城能不能替公子说话 */
test('大梁攒下的信任，决定邺城你能不能替公子说话', () => {
  const high = playToYe(A, 'yi', 'back');   // 说义打动公子，侯嬴又替你把话带到
  const low = playToYe(A, 'wait', 'hou');   // 在大梁只是等着，邺城你就是个生面孔
  const trustIn = (r) => r.v.people.find((x) => x.id === 'xinling').trust;
  assert.ok(trustIn(high) >= 0.45, `高信任局应过线：${trustIn(high)}`);
  assert.ok(trustIn(low) < 0.45, `低信任局应掉线：${trustIn(low)}`);

  const hi = high.p.choose('en');   // 替公子许他全身而归
  const lo = low.p.choose('en');
  assert.equal(hi.r.accepted, true);
  assert.match(hi.text, /解下印绶/, '公子信你，你就是替公子说话，晋鄙交出兵权');
  assert.equal(lo.r.accepted, false);
  assert.match(lo.text, /此事须报大王/, '公子不替你撑腰，话就落不到晋鄙身上');

  const jinbi = (r) => r.s.ledger.last((e) => e.kind === 'actor.trust' && e.payload.person === 'jinbi');
  assert.equal(jinbi(high).payload.after, 0.5, '公子信你，站位给到 0.5');
  assert.equal(jinbi(low).payload.after, 0.15, '没有公子撑腰，站位只有 0.15');
});

/* 7. 夷门影响如姬犹豫 */
test('夷门的一句话，决定如姬取符时犹不犹豫', () => {
  const trusted = playToNight(A, 'yi', 'back');   // 侯嬴把话带给如姬
  const unknown = playToNight(A, 'yi', 'wait');   // 没人替你说，如姬还不认识你
  assert.equal(trusted.v.night.hesitant, false, '恩先吃下了，她不犹豫');
  assert.equal(unknown.v.night.hesitant, true, '被发现的怕先吃下了，她先问会不会被发现');
  assert.equal(unknown.s.state.play.flags.rujiTrust, 0.18);
  assert.equal(trusted.s.state.play.flags.rujiTrust, 0.55);

  const nightReact = (r) => r.s.ledger.last((e) => e.kind === 'actor.react' && e.payload.act === 'night' && e.payload.person === 'ruji');
  assert.equal(nightReact(trusted).payload.hesitant, false);
  assert.equal(nightReact(trusted).payload.trust, 0.55, '账本上写的是她当时的信任，不是含糊的形容词');
  assert.equal(nightReact(unknown).payload.hesitant, true);
  assert.equal(nightReact(unknown).payload.trust, 0.18);
});

/* 8. 三种结局可达 */
test('三种结局都真的走得到：史书的、本作的历史、断链的', () => {
  const history = playToGranary(A, 'yi', 'back', 'yi');         // 干净取符 + 拿军令压晋鄙（他反噬）
  const lives = playToGranary(A, 'yi', 'back', 'en');           // 干净取符 + 替公子说话，晋鄙解下印绶
  const broken = playToGranary(A, 'yi', 'back', 'wait', NIGHT_SEEN);   // 取符失手
  assert.equal(history.s.state.play.ending, 'history');
  assert.equal(lives.s.state.play.ending, 'jinbi-lives');
  assert.equal(broken.s.state.play.ending, 'broken');
  assert.equal(broken.s.state.play.flags.night, 'seen');
  assert.equal(history.s.state.play.flags.night, 'clean');
  // 失手之后兵符没出来，邺城只剩「跟着公子进营」一个选项
  const v = playToGranary(A, 'yi', 'back', 'wait', NIGHT_SEEN).s.state.play;
  assert.equal(v.acts.ye.choice, 'wait');
});

/* 9. 每一笔账追得回用户，审计无孤儿 */
test('全剧的 user.act 与 actor.react 都追得回用户，决定类记录没有孤儿', () => {
  const { s, p } = playToGranary(A, 'yi', 'back', 'yi');
  p.chooseKeeper('keeper_doubt');
  p.choose('note');
  p.choose('report');
  advance(p, p.view());

  const acts = s.ledger.entries.filter((e) => e.kind === 'user.act' || e.kind === 'actor.react');
  assert.ok(acts.length >= 8, `一局应留下足够多的动作与反应，实际 ${acts.length}`);
  for (const e of acts) assert.ok(s.trace(e.seq).ok, `第 ${e.seq} 条（${e.kind}）追不到用户`);
  const audit = s.audit();
  assert.ok(audit.total > 0, '应有决定类记录被审计');
  assert.deepEqual(audit.orphans, [], `这些决定追不到用户：${audit.orphans}`);
});

/* 10. 存档之后接着玩 */
test('存档重开能接着玩，走到同一个结局、同一个账本指纹', () => {
  const run = (resume) => {
    const { s, p } = start(A);
    p.choose('yi');
    if (!resume) return { s, p };
    const s2 = createSession({ saved: JSON.parse(JSON.stringify(s.save())) });
    return { s: s2, p: createPlay(s2) };
  };
  const live = run(false);
  const resumed = run(true);
  for (const r of [live, resumed]) {
    r.p.next();
    r.p.choose('back');
    r.p.next();
    for (const id of NIGHT_CLEAN) r.p.choose(id);
    r.p.next();
    r.p.choose('yi');
    advance(r.p, r.p.view());
  }
  assert.equal(resumed.s.state.play.stage, 'granary');
  assert.equal(resumed.s.state.play.ending, live.s.state.play.ending);
  assert.equal(resumed.s.state.play.days, live.s.state.play.days);
  assert.equal(resumed.s.ledger.size, live.s.ledger.size);
  assert.equal(resumed.s.ledger.entries.at(-1).hash, live.s.ledger.entries.at(-1).hash);
});
