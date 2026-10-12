// 旁注：角色“当时的说法”接上廉价模型，规则兜底；账本一个字都不改。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../shared/engine/session.js';
import { narrate, narratableRecords } from '../shared/engine/narrate.js';
import { createSpeaker } from '../shared/agents/gateway.js';
import { auditService, loadLedger } from '../shared/core/ledger.js';

const ANSWERS = { wait: 0.8, polish: 0.8, depth: 0.85 };

/** 一次完整的信息流动：用户 → 导师 → 导演 → 呈现 → 用户反应 → 导演对照 */
function runSession() {
  const s = createSession();
  s.meet(ANSWERS, '我想看一个人在乱世里怎么做选择');
  s.commission('qiefu');
  s.react('qiefu', 'daliang', '停下来看心思');
  s.react('qiefu', 'yimen', '追问为什么');
  s.wrap('qiefu');
  return s;
}

const okCall = (text, model = 'fake-fast') => async () => ({ text, model, ms: 3, tokens: 7 });
const badCall = () => async () => { throw new Error('model gateway down'); };
const calls = (ledger) => ledger.entries.filter((e) => e.kind === 'gateway.call');

test('模型成功：旁注 source=model，账本原记录 hash 一个不动，只多出 gateway.call', async () => {
  const s = runSession();
  const total = narratableRecords(s.ledger).length;
  assert.ok(total > 0, '应该有导师/导演的规则台词可以配旁注');
  const size0 = s.ledger.size;
  const hashes0 = s.ledger.entries.map((e) => e.hash);
  const speaker = createSpeaker({ ledger: s.ledger, call: okCall('这一拍我替你锁死，慢慢看。'), limits: { 对白: total } });

  const out = await narrate(s, { seqs: narratableRecords(s.ledger).map((e) => e.seq), speaker });

  assert.equal(out.length, total);
  assert.ok(out.every((o) => o.source === 'model'), '模型成功时应该全部是 model');
  assert.ok(out.every((o) => o.text === '这一拍我替你锁死，慢慢看。'));
  for (const o of out) {
    assert.equal(s.voices[o.seq].source, 'model');
    assert.equal(s.voices[o.seq].text, o.text);
  }
  // 账本只追加 gateway.call：原记录的 hash 必须逐个相同（否则 cause 链和指纹就坏了）
  assert.deepEqual(s.ledger.entries.slice(0, size0).map((e) => e.hash), hashes0);
  assert.equal(s.ledger.size, size0 + out.length, '每条决定只多出一条 gateway.call');
  const gc = calls(s.ledger);
  assert.equal(gc.length, total);
  assert.ok(gc.every((e) => e.payload.purpose === '对白' && e.payload.ok === true));
  assert.ok(gc.every((e) => {
    const src = s.ledger.get(e.cause[0]);
    return e.cause.length === 1 && (src.kind.startsWith('mentor.') || src.kind.startsWith('director.'));
  }), 'gateway.call 的 cause 应指向产生这句话的导师/导演决定');
  // 决策记录本身没有被改写：说的还是规则那一句，saidSource 还是 rule
  for (const e of narratableRecords(s.ledger)) assert.equal(e.saidSource, 'rule');
  assert.equal(s.audit().ok, true);
  assert.deepEqual(s.audit().orphans, []);
});

test('模型抛错：用规则 fallback，source=rule，依然留一条失败的 gateway.call', async () => {
  const s = runSession();
  const target = narratableRecords(s.ledger)[0];
  const size0 = s.ledger.size;
  const hashes0 = s.ledger.entries.map((e) => e.hash);
  const speaker = createSpeaker({ ledger: s.ledger, call: badCall(), limits: { 对白: 3 } });

  const out = await narrate(s, { seqs: [target.seq], speaker });

  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'rule');
  assert.equal(out[0].text, target.said, '抛错时必须一字不改用规则台词');
  assert.equal(s.voices[target.seq].source, 'rule');
  assert.equal(s.voices[target.seq].text, target.said);
  assert.deepEqual(s.ledger.entries.slice(0, size0).map((e) => e.hash), hashes0);
  const gc = calls(s.ledger);
  assert.equal(gc.length, 1);
  assert.equal(gc[0].payload.ok, false);
  assert.deepEqual(gc[0].cause, [target.seq], '模型调用要挂在产生这句话的那条决定上');
  assert.equal(s.ledger.size, size0 + 1);
  assert.equal(s.audit().ok, true);
});

test('超出对白上限：不调用、不记账，直接回到规则台词', async () => {
  const s = runSession();
  const recs = narratableRecords(s.ledger);
  const size0 = s.ledger.size;
  const speaker = createSpeaker({ ledger: s.ledger, call: okCall('模型不会跑到这里'), limits: { 对白: 0 } });

  const out = await narrate(s, { seqs: [recs[0].seq], speaker });

  assert.equal(out[0].source, 'rule');
  assert.equal(out[0].text, recs[0].said);
  assert.equal(calls(s.ledger).length, 0, '超额不应产生 gateway.call');
  assert.equal(s.ledger.size, size0, '账本不动');
});

test('已经旁注过的不重复花钱，也不会被覆盖；存档带走 voices 且指纹一致', async () => {
  const s = runSession();
  const recs = narratableRecords(s.ledger);
  const speaker = createSpeaker({ ledger: s.ledger, call: okCall('第一版说法'), limits: { 对白: recs.length } });
  await narrate(s, { seqs: recs.map((e) => e.seq), speaker });
  const first = { ...s.voices[recs[0].seq] };
  const size1 = s.ledger.size;

  const speaker2 = createSpeaker({ ledger: s.ledger, call: okCall('第二版说法'), limits: { 对白: recs.length } });
  const again = await narrate(s, { seqs: recs.map((e) => e.seq), speaker2 });
  assert.deepEqual(again, [], '已旁注的记录应全部跳过');
  assert.deepEqual(s.voices[recs[0].seq], first);
  assert.equal(s.ledger.size, size1, '跳过时账本一条不加');

  // 存档再读回：voices 还在，账本指纹仍一致
  const saved = JSON.parse(JSON.stringify(s.save()));
  const s2 = createSession({ saved });
  assert.deepEqual(s2.voices, s.voices);
  assert.equal(s2.ledger.size, s.ledger.size);
  assert.deepEqual(auditService(s2.ledger), auditService(s.ledger));
  // 原记录没被改过：重建一份老账本也会指纹一致
  assert.doesNotThrow(() => loadLedger(saved.ledger));
});

test('旁注用的 persona 来自 seed STAFF：导师是制片人，陆导/单导用自己的名字和 voice', async () => {
  const s = runSession();
  const recs = narratableRecords(s.ledger);
  const seen = [];
  const call = async (request) => { seen.push(request); return { text: '好', model: 'fake', ms: 1, tokens: 1 }; };
  const speaker = createSpeaker({ ledger: s.ledger, call, limits: { 对白: recs.length } });

  await narrate(s, { seqs: recs.map((e) => e.seq), speaker });

  assert.equal(seen.length, recs.length);
  const mentorReq = seen.find((r) => r.system.includes('给你排戏的制片人'));
  assert.ok(mentorReq, '导师的 persona 应是「给你排戏的制片人」');
  const dirId = s.state.directorId;
  const dir = s.directors[dirId].def;
  assert.ok(dir?.name, '导演的名字应来自 seed 的 STAFF');
  const dirReq = seen.find((r) => r.system.includes(dir.name) && r.system.includes('公元前258年'));
  assert.ok(dirReq, `导演的 persona 应带 seed 里的名字：${dir.name}`);
  assert.ok(seen.every((r) => r.maxTokens >= 64), 'maxTokens 至少 64');
  assert.ok(seen.every((r) => r.system.includes('不超过40字')), '提示词要带字数上限');
  assert.ok(seen.some((r) => r.user.includes('用你的口吻把这句话说出来')), 'user 行给的是“该说什么意思”');
  // 给模型的 view 里要带上这个角色当时真知道的事，且不夹账本原始 payload 结构
  assert.ok(seen.every((r) => Array.isArray(r.system.split('\n')) && r.system.includes('- ')), 'view 逐条进提示词');
  assert.ok(seen.every((r) => !r.system.includes('{"')), '不要把原始 payload JSON 塞进提示词');
});
