// 第二阶段：基于同一个世界设定的多个呈现，彼此之间的关联由主张图算出，并且被你的选择和导演的性情改变。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../shared/engine/session.js';
import { growWorld, CHOICES } from '../shared/engine/works.js';
import { STATUS } from '../shared/core/claims.js';

const A = { wait: 0.8, polish: 0.8, depth: 0.85 };   // 会分到爱雕琢的陆导
const B = { wait: 0.2, polish: 0.2, depth: 0.25 };   // 会分到爱放开的单导
const NEED = '我想看一个人在乱世里怎么做选择';
const grow = (answers, choices) => growWorld(createSession, { answers, need: NEED, choices });
const types = (w) => new Set(w.edges.map((e) => e.type));
const edge = (w, from, to, type) => w.edges.find((e) => e.from === from && e.to === to && e.type === type);

test('五种关系都能从同一张主张图里算出来', () => {
  const all = new Set();
  for (const answers of [A, B]) {
    for (const night of ['clean', 'seen']) for (const weicheng of ['report', 'witness', 'hide']) {
      for (const t of types(grow(answers, { night, weicheng }))) all.add(t);
    }
  }
  assert.deepEqual([...all].sort(), ['争议', '并行', '引用', '反转', '承接'].sort());
});

test('每一条作品写进图里的主张、每一次导演批或不批，都追得回你', () => {
  const w = grow(A, { weicheng: 'report' });
  const s = w.session;
  const written = s.ledger.entries.filter((e) => (e.kind.startsWith('claim.') && e.payload.presentation) || e.kind === 'director.approve' || e.kind === 'director.refuse');
  assert.ok(written.length >= 15, `只有 ${written.length} 条`);
  for (const e of written) assert.ok(s.trace(e.seq).ok, `第 ${e.seq} 条（${e.kind}）追不到你`);
  assert.deepEqual(s.audit().orphans, []);
});

test('你在《取符之夜》的一个动作，改变了《窃符》和《围城》之间的关系', () => {
  const ok = grow(B, { night: 'clean' });
  const fail = grow(B, { night: 'seen' });
  assert.ok(edge(ok, 'qiefu', 'weicheng', '争议'), '取符成功：魏营说援军在路上，城里说不会来，冲突推不动');
  assert.ok(!edge(fail, 'qiefu', 'weicheng', '争议'));
  assert.ok(edge(fail, 'qiefu', 'weicheng', '引用'), '取符失败：城里听到的和魏营一样，变成引用');
  const fu = fail.session.claims.consensus('兵符', '去向');
  assert.match(String(fu.object), /留在卧内/);
  assert.match(String(fail.session.claims.consensus('邯郸', '结局').object), /本作的历史/);
});

test('同一个选择，不同性情的导演，世界走向不同：爱雕琢的要两件证据才肯推翻共识', () => {
  const lu = grow(A, { weicheng: 'report' });
  const shan = grow(B, { weicheng: 'report' });
  assert.equal(lu.session.state.directorId, 'lu');
  assert.equal(shan.session.state.directorId, 'shan');
  assert.ok(edge(lu, 'changping', 'weicheng', '争议'), '陆导没批，守仓人的说法成了争议');
  assert.ok(edge(shan, 'changping', 'weicheng', '反转'), '单导批了，城外的共识被推翻');
  const refuse = lu.session.ledger.last((e) => e.kind === 'director.refuse');
  assert.equal(refuse.payload.need, 2);
  assert.equal(refuse.payload.evidence, 1);
  // 陆导也会批，只要你拉上李同作第二件证据
  assert.ok(edge(grow(A, { weicheng: 'witness' }), 'changping', 'weicheng', '反转'));
});

test('被推翻的不删除，留作“曾经的共识”，并记下推翻它的解释', () => {
  const s = grow(B, { weicheng: 'report' }).session;
  const old = s.claims.find((c) => c.subject === '邯郸' && c.predicate === '存粮' && c.object === '尚可支撑')[0];
  assert.equal(old.status, STATUS.FORMER);
  assert.ok(old.history.some((h) => h.what === 'overturned' && /城外/.test(h.explanation)));
  assert.match(String(s.claims.consensus('邯郸', '存粮').object), /仓中已空/);
});

test('选择瞒下来：没有反转也没有争议，围城只是沿用了城外的说法', () => {
  const w = grow(B, { weicheng: 'hide' });
  assert.ok(edge(w, 'changping', 'weicheng', '引用'));
  assert.ok(!edge(w, 'changping', 'weicheng', '反转') && !edge(w, 'changping', 'weicheng', '争议'));
});

test('并行的两种说法，差异追得到各自的持有者和渠道', () => {
  const w = grow(A, {});
  const e = edge(w, 'qiefu', 'weicheng', '并行');
  const [a, b] = e.claims.map((id) => w.session.claims.get(id));
  assert.notEqual(a.holder, b.holder);
  assert.deepEqual([a.channel, b.channel].sort(), ['亲历', '被告知'].sort());
});

test('同样的你、同样的选择，长出一模一样的世界', () => {
  const x = grow(A, { night: 'seen', qiefu: 'persuade', weicheng: 'witness' }).session.ledger.toJSON();
  const y = grow(A, { night: 'seen', qiefu: 'persuade', weicheng: 'witness' }).session.ledger.toJSON();
  assert.equal(x.at(-1).hash, y.at(-1).hash);
  assert.ok(Object.keys(CHOICES).length === 3);
});
