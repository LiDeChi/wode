// 心智：换人测试、说服、不被话术摆平。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMind } from '../shared/core/mind.js';
import { PEOPLE, ITEMS, CHAIN, HISTORY, SOURCES } from '../shared/data/seed.js';

const P = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
const mind = (id, trust) => createMind(trust === undefined ? P[id] : { ...P[id], trust: { ...(P[id].trust || {}), 'actor:player': trust } });
const SHORTFALL = { kind: '缺额', channels: { 数量: 0.7, 印信: 0.4, 人: 0.5 } };

test('设定里有全部固定的人、物、成因链', () => {
  for (const id of ['weiwang', 'xinling', 'houying', 'ruji', 'jinbi', 'zhuhai', 'pingyuan', 'litong', 'zhaoshi', 'keeper_doubt', 'keeper_rash', 'borrower', 'guard_a', 'guard_b', 'player']) assert.ok(P[id], `缺 ${id}`);
  for (const id of ['bamboo', 'wine', 'seal', 'qin_warning', 'ledger_page', 'hammer']) assert.ok(ITEMS.find((i) => i.id === id), `缺物件 ${id}`);
  assert.deepEqual(CHAIN.map((c) => c.id), ['halt', 'plead', 'plan', 'steal', 'seize', 'relief']);
  assert.equal(CHAIN.find((c) => c.id === 'halt').mutable, false);
  assert.equal(CHAIN.find((c) => c.id === 'relief').mutable, false);
  for (const h of HISTORY) for (const s of h.evidence || []) assert.ok(SOURCES[s], `史料主张引用了不存在的出处 ${s}`);
});

test('换人测试：两个守仓人结构相同，只有性情不同', () => {
  const a = P.keeper_doubt; const b = P.keeper_rash;
  assert.deepEqual(a.units, b.units);
  assert.deepEqual(a.modules, b.modules);
  assert.notDeepEqual(a.temperament, b.temperament);
});

test('换人测试：同样的缺额，多疑的停到心智，急躁的在手脚就动身', () => {
  const d = mind('keeper_doubt').perceive(SHORTFALL);
  const r = mind('keeper_rash').perceive(SHORTFALL);
  assert.equal(d.stoppedAt, 'mind', JSON.stringify(d.trace));
  assert.match(d.action.act, /印信/);
  assert.equal(r.stoppedAt, 'unit', JSON.stringify(r.trace));
  assert.match(r.action.act, /追/);
});

test('同一个人第二次遇到同类事，预期变高，误差变小', () => {
  const m = mind('keeper_doubt');
  const first = m.perceive(SHORTFALL);
  const second = m.perceive(SHORTFALL);
  assert.ok(second.expectation > first.expectation);
  assert.ok(second.error < first.error);
});

test('说服：魏王讲义反而更怕，任何单一诉求都说不动', () => {
  const r = mind('weiwang').hear({ 义: 0.8 }, 'actor:player');
  assert.equal(r.accepted, false);
  assert.ok(r.backlash > 0);
  for (const k of ['义', '利', '惧', '恩']) assert.equal(mind('weiwang', 0.9).hear({ [k]: 0.9 }, 'actor:player').accepted, false, `魏王被 ${k} 说动了`);
});

test('说服：信陵君被义打动，不被利打动', () => {
  assert.equal(mind('xinling', 0.5).hear({ 义: 0.8 }, 'actor:player').accepted, true);
  assert.equal(mind('xinling', 0.5).hear({ 利: 0.8 }, 'actor:player').accepted, false);
});

test('说服：晋鄙越压越疑；信任够时义和恩才行', () => {
  assert.equal(mind('jinbi').hear({ 惧: 0.7 }, 'actor:player').accepted, false);
  assert.equal(mind('jinbi', 0.55).hear({ 义: 0.8, 恩: 0.4 }, 'actor:player').accepted, true);
});

test('不被话术摆平：没有一句话能同时说服魏王、信陵君、晋鄙、侯嬴', () => {
  const grid = [0, 0.4, 0.8];
  for (const y of grid) for (const l of grid) for (const j of grid) for (const e of grid) {
    const appeal = { 义: y, 利: l, 惧: j, 恩: e };
    const all = ['weiwang', 'xinling', 'jinbi', 'houying'].every((id) => mind(id, 0.6).hear(appeal, 'actor:player').accepted);
    assert.equal(all, false, `这句话摆平了所有人：${JSON.stringify(appeal)}`);
  }
});
