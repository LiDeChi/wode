// 第三阶段·M2 的新基线（t32 重录）：680 条旧对照脚本 + 12 条命名路线。
// 旧基线 tests/fixtures/play-golden.json **原样留着**：第三个测试用旧场景快照把它重放出来，
// 证明当年那 680 条到现在仍然一笔不差（玩法层），差的只有从人话里拿走的读数文字
// （t33 的 reason、t38 粮仓决定那一步的正文）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../shared/engine/session.js';
import { createPlay } from '../shared/engine/play.js';
import { QIFU_SCENES as V1_QIFU_SCENES } from './fixtures/scenes-v1-qiefu.mjs';
import { WEICHENG_SCENES as V1_WEICHENG_SCENES } from './fixtures/scenes-v1-weicheng.mjs';
import { scripts, runScript } from './fixtures/play-mechanics-v2-scripts.mjs';

const v2 = JSON.parse(readFileSync(new URL('./fixtures/play-mechanics-v2-golden.json', import.meta.url), 'utf8'));
const old = JSON.parse(readFileSync(new URL('./fixtures/play-golden.json', import.meta.url), 'utf8'));

test('新基线覆盖 680 条旧脚本 + 12 条路线，三种结局都在', () => {
  const ids = scripts().map((s) => s.id);
  assert.deepEqual(Object.keys(v2).sort(), [...ids].sort());
  assert.equal(ids.filter((id) => !id.startsWith('A/') && !id.startsWith('B/')).length, 0);
  const endings = new Set(Object.values(v2).map((g) => g.ending));
  for (const e of ['history', 'jinbi-lives', 'broken']) assert.ok(endings.has(e), `缺结局 ${e}`);
});

test('同一串选择，与 M2 新基线走出同一个世界', () => {
  const diffs = [];
  for (const sc of scripts()) {
    const got = runScript({ createSession, createPlay }, sc);
    try { assert.deepEqual(got, v2[sc.id]); } catch { diffs.push(sc.id); }
  }
  assert.deepEqual(diffs.slice(0, 10), [], `${diffs.length} 个脚本走出了不同的世界`);
});

test('旧 golden 原样留着，旧场景还能把它一笔不差地重放出来', () => {
  // 旧场景 = 抽内核那一刻的四幕（scenes-v1-qiefu）+ 粮仓改人话之前的那一版（scenes-v1-weicheng）
  const v1Play = (s) => createPlay(s, { scenes: { ...V1_QIFU_SCENES, ...V1_WEICHENG_SCENES } });
  const fields = ['stage', 'ending', 'days', 'flags', 'acts', 'logHash', 'ledgerSize', 'trail'];
  const diffs = [];
  let hashOnly = 0;
  for (const sc of scripts().filter((s) => s.group === 'legacy')) {
    const got = runScript({ createSession, createPlay: v1Play }, sc);
    const want = old[sc.id];
    const bad = fields.filter((f) => JSON.stringify(got[f]) !== JSON.stringify(want[f]));
    if (bad.length) diffs.push(`${sc.id}:${bad.join(',')}`);
    else if (got.ledgerHash !== want.ledgerHash) hashOnly += 1;
  }
  assert.deepEqual(diffs.slice(0, 10), [], `${diffs.length} 个脚本在旧场景下也走出不同的世界`);
  // 指纹变了、玩法没变：t33 把读数从人话里拿走，只动了账本里那句 reason 的文字
  assert.equal(hashOnly, 644, `账本指纹变化的脚本数从 644 变成了 ${hashOnly}`);
});
