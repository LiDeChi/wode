// 第一阶段：角色之间的信息流动，证明是真的为用户服务。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../shared/engine/session.js';
import { traceToUser, roleKind, auditService } from '../shared/core/ledger.js';

const ANSWERS_A = { wait: 0.8, polish: 0.8, depth: 0.85 };   // 能等、爱雕琢、要看细
const ANSWERS_B = { wait: 0.2, polish: 0.2, depth: 0.25 };   // 现在就要、要能改变、看个大概

function run(answers, need) {
  const s = createSession();
  s.meet(answers, need);
  const c = s.commission('qiefu');
  return { s, c };
}

test('每一个导师和导演的决定，沿 cause 往回走，都走到用户', () => {
  const { s } = run(ANSWERS_A, '我想看一个人在乱世里怎么做选择');
  s.react('qiefu', 'daliang', '停下来看心思');
  s.react('qiefu', 'yimen', '追问为什么');
  s.wrap('qiefu');
  const a = s.audit();
  assert.ok(a.total >= 6, `决定太少：${a.total}`);
  assert.deepEqual(a.orphans, [], `这些决定追不到用户：${a.orphans}`);
  assert.ok(a.byRole.mentor.total > 0 && a.byRole.director.total > 0);
});

test('链条的顺序是：用户 → 导师 → 导演 → 呈现', () => {
  const { s, c } = run(ANSWERS_A, '想弄清楚为什么信陵君要窃符');
  const path = traceToUser(s.ledger, c.designSeq).path.map((q) => roleKind(s.ledger.get(q).from));
  assert.equal(path[0], 'user');
  assert.ok(path.includes('mentor'));
  assert.equal(path[path.length - 1], 'director');
  const open = s.ledger.last((e) => e.kind === 'present.open');
  const p2 = traceToUser(s.ledger, open.seq).path.map((q) => roleKind(s.ledger.get(q).from));
  assert.deepEqual([p2[0], p2[p2.length - 1]], ['user', 'presentation']);
});

test('不同的用户，得到不同的导演、不同的档位、不同的作品设计', () => {
  const A = run(ANSWERS_A, '我想看一个人在乱世里怎么做选择');
  const B = run(ANSWERS_B, '来点紧张刺激的');
  assert.notEqual(A.s.state.directorId, B.s.state.directorId, '口味不同，导师应配不同导演');
  assert.notDeepEqual(A.c.allot.chosen, B.c.allot.chosen, '看细与看个大概，算力档位应不同');
  const lv = (c) => c.design.beats.map((b) => b.level).join();
  assert.notEqual(lv(A.c), lv(B.c), '雕琢与放开，交互档位应不同');
  assert.notEqual(A.c.design.emotion, B.c.design.emotion, '需求里的情感不同，导演选的交互种类应不同');
});

test('导师从你的反应里学；你亲手改过的字段，观察不能覆盖', () => {
  const { s } = run(ANSWERS_B, '我想看一个人在乱世里怎么做选择');
  const d0 = s.mentor.notes().depth.value;
  s.react('qiefu', 'daliang', '停下来看心思');
  s.react('qiefu', 'yimen', '停下来看心思');
  const d1 = s.mentor.notes().depth.value;
  assert.ok(d1 > d0, `看心思后 depth 应上升：${d0} → ${d1}`);
  s.editNote('depth', 0.1);
  s.react('qiefu', 'ye', '停下来看心思');
  assert.equal(s.mentor.notes().depth.value, 0.1);
  assert.equal(s.mentor.notes().depth.source, '你改的');
});

test('导演对照预测与真实反应，手艺被改动，并留下记录', () => {
  const { s } = run(ANSWERS_A, '我想看一个人在乱世里怎么做选择');
  const preds = s.state.predictions.qiefu.list;
  assert.ok(preds.length >= 2, '导演应对可交互的节拍做预测');
  // 故意和预测反着来
  const flip = { 停下来看心思: '很快通过', 追问为什么: '很快通过', 很快通过: '停下来看心思', 重来一次: '很快通过' };
  for (const p of preds) s.react('qiefu', p.beat, flip[p.expect]);
  const before = s.director().craft();
  const r = s.wrap('qiefu');
  const after = s.director().craft();
  assert.notDeepEqual(before, after, '全错时手艺应变化');
  const learn = s.ledger.get(r.seq);
  assert.equal(learn.kind, 'director.learn');
  assert.ok(traceToUser(s.ledger, r.seq).ok);
});

test('导演不能改导师的笔记：越权被拒，并记账', () => {
  const { s } = run(ANSWERS_A, '想弄清楚为什么');
  const seq = s.director().tryEditMentor('depth');
  assert.equal(s.ledger.get(seq).kind, 'mentor.refuse');
});

test('存档再读回，账本指纹一致，审计结果不变', () => {
  const { s } = run(ANSWERS_A, '我想看一个人在乱世里怎么做选择');
  s.react('qiefu', 'daliang', '追问为什么');
  const saved = JSON.parse(JSON.stringify(s.save()));
  const s2 = createSession({ saved });
  assert.equal(s2.ledger.size, s.ledger.size);
  assert.deepEqual(auditService(s2.ledger), auditService(s.ledger));
  saved.ledger[3].payload = { tampered: true };
  assert.throws(() => createSession({ saved }), /指纹不符/);
});

test('存档读回后，导演的手艺和「他猜你」的记忆都回来', () => {
  const { s } = run(ANSWERS_A, '我想看一个人在乱世里怎么做选择');
  s.react('qiefu', 'daliang', '追问为什么');
  s.react('qiefu', 'yimen', '很快通过');
  s.wrap('qiefu');
  const before = s.director().state();
  const restored = createSession({ saved: JSON.parse(JSON.stringify(s.save())) }).director().state();
  assert.deepEqual(restored.craft, before.craft, '手艺不该在存档里丢掉');
  assert.ok(before.mind.others?.player, '导演本来应该记得你');
  assert.deepEqual(restored.mind.others?.player, before.mind.others.player, '导演猜你的记忆不该在存档里丢掉');
});
