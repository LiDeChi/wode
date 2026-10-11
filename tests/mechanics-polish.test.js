// 第三阶段·M2 验收线（docs/design/MECHANICS.md）：
//   1) 四种诉求都活得下去——九个人 × 四诉求的每一列都不过半，每种诉求都有人听
//   2) 没有死意图——每一幕带诉求的选项，挑了它和挑「等」后面都不一样
//   3) 门前那一拍——低信任的人只有这一条补救路
//   4) 三种结局各有至少两条路，合法的一局不会走不到结局
//   5) 一局 8–12 分钟
// 数字全部来自 tools/mechanics-probe.mjs（只读探针，只走公共 API，不改 shared/**）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  appealMatrix, appealScan, deadIntents, doorPair, hesitationPairs, routeCheck, SPACE,
} from '../tools/mechanics-probe.mjs';
import { legalScripts } from './fixtures/play-mechanics-v2-scripts.mjs';

const v2 = JSON.parse(readFileSync(new URL('./fixtures/play-mechanics-v2-golden.json', import.meta.url), 'utf8'));

test('九个人 × 四种诉求：每一列都不过半，而且每种诉求都有人听', () => {
  const m = appealMatrix();
  assert.equal(m.people.length, 9, '要量的是九个人：信陵君/侯嬴/如姬/晋鄙/魏王/朱亥/赵使/两位守卫');
  for (const [appeal, c] of Object.entries(m.counts)) {
    assert.ok(c.accepted * 2 <= c.n, `「${appeal}」说服了 ${c.accepted}/${c.n} 个人，过半了`);
    assert.ok(c.accepted >= 1, `「${appeal}」一个人都说不动：这一列是死的`);
  }
  assert.ok(m.counts.义.accepted < m.counts.恩.accepted, '说义不该比讲恩更好使');
});

test('强度 × 信任 的每一个截面上，每一列也不过半', () => {
  const s = appealScan();
  assert.equal(s.ok, true, `最坏的一格（强度 ${s.worst.intensity}／信任 ${s.worst.trust}）里有一列过半：${JSON.stringify(s.worst.per)}`);
});

test('没有死意图：每一幕带诉求的选项，挑了它和挑「等」后面都不一样', () => {
  const di = deadIntents(SPACE());
  assert.deepEqual(di.dead.map((r) => `${r.dir}/${r.act}:${r.option}`), [], '这些选项挑了以后世界没变');
  assert.ok(di.counts.gated >= 1, '陆导把 give/say 挡在画面外，是看得见的闸门，不算死');
});

test('门前那一拍：她拿不定主意时，只有多等一拍才走得干净', () => {
  const pairs = hesitationPairs();
  assert.ok(pairs.gap >= 30, `说动她与没说动她的差距只有 ${pairs.gap} 个百分点`);
  const rows = doorPair('A');
  const hesitant = rows.filter((r) => r.hesitant);
  const waited = hesitant.filter((r) => r.name.includes('R（等）'));
  const notWaited = hesitant.filter((r) => r.name.includes('R2（不等）'));
  assert.equal(waited.length, 2, '两条低信任的路（吓他 / 不送）都要量到');
  assert.equal(notWaited.length, 2);
  for (const r of waited) assert.equal(r.night, 'clean', `她犹豫、你等了，还是被看见（${r.yimen}）`);
  for (const r of notWaited) assert.equal(r.night, 'seen', `她犹豫、你没等，却照样干净（${r.yimen}）——门口那一拍就没用了`);
});

test('三种结局各有至少两条路，合法的一局不会卡在半路', () => {
  const routes = routeCheck();
  assert.equal(routes.length, 12);
  assert.deepEqual(routes.filter((r) => !r.ok).map((r) => r.id), [], '这些路线没有走出表里写的结局');
  const by = {};
  for (const r of routes) by[r.ending] = (by[r.ending] || 0) + 1;
  for (const e of ['history', 'jinbi-lives', 'broken']) assert.ok((by[e] || 0) >= 2, `结局 ${e} 只有 ${by[e] || 0} 条路`);
  for (const s of legalScripts()) assert.ok(v2[s.id]?.ending, `合法路线 ${s.id} 没走到结局`);
  const nulls = Object.entries(v2).filter(([, g]) => !g.ending);
  assert.equal(nulls.length, 162, '旧 680 里故意撞闸门的那 162 条仍然走不到结局');
  for (const [id, g] of nulls) {
    assert.ok((g.trail || []).some((t) => String(t).includes('!')), `${id} 卡住时没有给出「这一手被拒绝」的说明`);
  }
});

test('一局 8–12 分钟：12 条路线的估算秒数都落在地板里', () => {
  for (const r of routeCheck()) {
    assert.ok(r.seconds >= 480 && r.seconds <= 720, `${r.id} 用了 ${r.seconds} 秒`);
  }
});
