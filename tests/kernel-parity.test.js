// 第三阶段·内核抽取：把四幕和粮仓改写成“控制器 + 规则表”的数据之后，
// 同一串选择必须走出同一个世界——账本指纹、结局、天数、每一幕的结果一笔不差。
// 对照组是抽取之前用旧 play.js 录下的 tests/fixtures/play-golden.json。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../shared/engine/session.js';
import { createPlay } from '../shared/engine/play.js';
import { scripts, runScript } from './fixtures/play-scripts.mjs';

const golden = JSON.parse(readFileSync(new URL('./fixtures/play-golden.json', import.meta.url), 'utf8'));

test('对照组覆盖三种结局、两位导演、看心思与追问、出错的输入', () => {
  const ids = scripts().map((s) => s.id);
  assert.deepEqual(Object.keys(golden).sort(), [...ids].sort());
  const endings = new Set(Object.values(golden).map((g) => g.ending));
  for (const e of ['history', 'jinbi-lives', 'broken']) assert.ok(endings.has(e), `缺结局 ${e}`);
});

test('同一串选择，抽内核前后走出同一个世界', () => {
  const diffs = [];
  for (const sc of scripts()) {
    const got = runScript({ createSession, createPlay }, sc);
    try { assert.deepEqual(got, golden[sc.id]); } catch { diffs.push(sc.id); }
  }
  assert.deepEqual(diffs.slice(0, 10), [], `${diffs.length} 个脚本走出了不同的世界`);
});
