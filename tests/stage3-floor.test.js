// 第三阶段·地板检查：四种模拟玩家 × 两位导演走满整局，外加取符之夜穷举。
// 只用 createPlay 公共 API，所以之后长出的新场景会被同一套检查自动覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../shared/engine/session.js';
import { floorChecks } from '../shared/engine/simulate.js';

test('没有死路、三种结局都走得到、没有一种诉求能说服所有人、一局 8–12 分钟', () => {
  const f = floorChecks(createSession);
  assert.deepEqual(f.deadEnds, []);
  for (const e of ['history', 'jinbi-lives', 'broken']) assert.ok(f.endings[e] > 0, `走不到结局 ${e}`);
  assert.equal(f.sameAppealWinsAll, false);
  assert.ok(f.seconds.min >= 480 && f.seconds.max <= 720, `时长 ${f.seconds.min}–${f.seconds.max} 秒`);
  assert.equal(f.ok, true);
});
