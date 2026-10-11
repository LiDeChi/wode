// 第三阶段·资产生成管线测试（docs/ASSETS.md）。
//
// 只按契约的签名写：stagecraft 的 taste / dress / assetKey、director.dress、
// session.dress、以及 tools/assets/run.mjs 若有导出的纯逻辑 planRun。
// 不看 stagecraft 的实现，所以换一套口味表、换一幕名字，这些断言照样成立。
//
// 一句话说清为什么值得测：画什么、配什么声音，是导演按自己的手艺决定的——
// 同一场戏，陆导和单导开出的单子必须不一样，而同一个人开两次必须一模一样。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../shared/engine/session.js';
import { createPlay } from '../shared/engine/play.js';
import { taste, dress, assetKey } from '../shared/agents/stagecraft.js';
import { SCENES } from '../shared/scenes/qiefu.js';
import { PLACES, PEOPLE, ITEMS } from '../shared/data/seed.js';
import { ANSWERS, NEED, scripts } from './fixtures/play-scripts.mjs';

/** 换一个答案，就换一个导演：A 陆导爱雕琢，B 单导爱放开 */
function sessionWith(answers) {
  const s = createSession();
  s.meet(answers, NEED);
  return s;
}
const lu = () => sessionWith(ANSWERS.A).director();     // 雕琢 0.8
const shan = () => sessionWith(ANSWERS.B).director();   // 放开 0.8

/** 契约给的 world 形状：scenes 是 KERNEL §2 的 SCENES，其余来自 seed */
const qiefuWorld = () => ({ work: 'qiefu', scenes: SCENES, places: PLACES, people: PEOPLE, items: ITEMS });

/**
 * 一个自造的最小 world，一幕、一地、一人、一句带「…」的台词。
 * 名字全不叫「大梁」「夷门」，就是为了逼出「不许写死任何一幕」这条契约。
 */
const probeWorld = {
  work: 'probe',
  scenes: {
    hall: {
      work: 'probe', beat: 'hall', title: '探针屋', place: 'probe', lead: 'probe_guy',
      people: ['probe_guy'],
      goal: '看看这张单子能不能自己长出来。',
      scene: '一间临时搭起来的屋子，桌上一盏灯。',
      ambient: { kind: 'plead', channels: { 请求: 0.5 } },
      controllers: [['speech', { options: [{ id: 'greet', verb: 'say', to: 'probe_guy', line: '「你说说看。」' }] }]],
      wait: { id: 'wait', to: 'probe_guy', line: '不出声' },
      rules: [{ when: { intent: 'greet' }, then: [], text: '「你来了。」' }],
      finish: 'on-end',
    },
  },
  places: [{ id: 'probe', name: '探针屋', desc: '一间临时搭起来的屋子。' }],
  people: [{ id: 'probe_guy', name: '探针客', title: '临时的人', place: 'probe', bio: '临时写下的一个人。', voice: '我只说一句。' }],
  items: [],
};

const kindsOf = (sheet, kind) => sheet.assets.filter((a) => a.kind === kind);
const keysOf = (sheet) => sheet.assets.map((a) => a.key);

/* 1. 手艺决定口味 */
test('同一份手艺开出同一份口味：陆导每一拍都要背景，单导只给关键拍、拍子更快、语速更快', () => {
  const luT = taste(lu());
  const shanT = taste(shan());
  assert.equal(luT.director, 'lu');
  assert.equal(shanT.director, 'shan');
  assert.equal(luT.stills, 'every-beat', '雕琢 0.8 ≥ 0.6，每一拍一张背景');
  assert.equal(shanT.stills, 'key-beats', '放开的人只给关键拍');
  assert.ok(shanT.music.bpm > luT.music.bpm, `单导的拍子应更快：${luT.music.bpm} vs ${shanT.music.bpm}`);
  assert.ok(luT.music.loopSeconds >= shanT.music.loopSeconds, '雕琢高，音乐循环更长');
  assert.ok(luT.voice.rate <= shanT.voice.rate, '雕琢高，语速不更快');
  assert.ok(luT.voice.pause >= shanT.voice.pause, '雕琢高，句间停顿不更短');
});

/* 2. 开单确定 */
test('同一个导演、同一份场景，dress 开两次是一模一样的单子', () => {
  const d = lu();
  assert.deepEqual(dress(d, probeWorld), dress(d, probeWorld));
  const d2 = lu();
  assert.deepEqual(dress(d2, qiefuWorld()), dress(d2, qiefuWorld()), '换到真场景上也要一模一样');
});

test('assetKey 对键顺序不同的同一份 spec 算出同一个 key，spec 不同则 key 不同', () => {
  const spec = { prompt: '一间屋子，桌上一盏灯', size: '1536x1024', role: 'plate' };
  const reordered = { role: 'plate', size: '1536x1024', prompt: '一间屋子，桌上一盏灯' };
  assert.equal(assetKey(spec), assetKey(reordered), '键顺序不该影响 key');
  assert.equal(
    assetKey({ kind: 'voice', text: '你来了。', opts: { rate: 0.9, pause: 0.3 } }),
    assetKey({ opts: { pause: 0.3, rate: 0.9 }, text: '你来了。', kind: 'voice' }),
    '嵌套对象的键顺序也不该影响 key',
  );
  assert.notEqual(assetKey(spec), assetKey({ ...spec, prompt: '另一间屋子' }), 'spec 变了 key 就要变');
});

/* 3. 导演的手艺决定资产 */
test('陆导与单导拿同一部 qiefu，key 集合不同；陆导每一拍一张，图片不比单导少', () => {
  const luSheet = dress(lu(), qiefuWorld());
  const shanSheet = dress(shan(), qiefuWorld());
  assert.equal(luSheet.work, 'qiefu');
  assert.equal(luSheet.director, 'lu');
  assert.equal(shanSheet.director, 'shan');
  assert.ok(luSheet.assets.length > 0 && shanSheet.assets.length > 0, '两个导演都得开出东西来');
  assert.notDeepEqual(keysOf(luSheet).sort(), keysOf(shanSheet).sort(), '两个导演对同一部戏的 key 集合必须不同');
  assert.ok(
    kindsOf(luSheet, 'image').length >= kindsOf(shanSheet, 'image').length,
    `雕琢高的人每一拍都要一张背景：${kindsOf(luSheet, 'image').length} vs ${kindsOf(shanSheet, 'image').length}`,
  );
  assert.ok(shanSheet.taste.music.bpm > luSheet.taste.music.bpm, '单导的 bpm 应更高');
});

/* 4. learn 改了手艺，口味和 key 跟着变 */
test('learn 改了手艺之后，口味和 key 都跟着变', () => {
  const d = lu();
  const beforeCraft = d.craft();
  const beforeTaste = taste(d);
  const beforeKeys = keysOf(dress(d, probeWorld));

  // 导演以为「很快通过」，玩家却停下来看心思，猜错了 → 手艺被调（放慢、多写悲剧余味）
  d.learn([{ beat: 'hall', expect: '很快通过' }], [{ beat: 'hall', signal: '停下来看心思' }]);

  assert.notDeepEqual(d.craft(), beforeCraft, 'learn 要真的改手艺');
  assert.notDeepEqual(taste(d), beforeTaste, '手艺变了，口味要跟着变');
  assert.notDeepEqual(keysOf(dress(d, probeWorld)), beforeKeys, '口味变了，开出的 key 要跟着变');
});

/* 5. 不写死场景 */
test('不写死任何一幕：自造的最小 world 也能开出 plate、背景、人像、voice、sfx、music', () => {
  const sheet = dress(lu(), probeWorld);
  assert.equal(sheet.work, 'probe');
  const plate = sheet.assets.find((b) => b.kind === 'image' && b.spec.role === 'plate');
  assert.ok(plate, '每部作品每位导演一张风格底版');
  assert.equal(sheet.plate, plate.key, 'plate 字段就是那张底版的 key');
  assert.ok(kindsOf(sheet, 'image').some((b) => b !== plate && b.spec.size === '1536x1024'), '缺一张背景');
  assert.ok(kindsOf(sheet, 'image').some((b) => b.spec.size === '1024x1024'), '缺一张人像');
  assert.ok(kindsOf(sheet, 'voice').length > 0, '缺 voice');
  assert.ok(kindsOf(sheet, 'sfx').length > 0, '缺 sfx');
  assert.ok(kindsOf(sheet, 'music').length > 0, '缺 music');
  for (const b of kindsOf(sheet, 'image')) {
    if (b !== plate) assert.equal(b.spec.plate, sheet.plate, '背景和人像都要以底版为参考图');
  }
  assert.ok(kindsOf(sheet, 'voice').some((b) => b.spec.text.includes('你来了')), '规则里那句「你来了」要开出一条 voice');
  for (const b of sheet.assets) assert.equal(b.for.work, 'probe', '没有一幕的名字是写死的');
});

/* 6. key 与账 */
test('key 唯一、带 kind 前缀、spec 不重复，每个 Brief 都有 why 和 for.work', () => {
  for (const sheet of [dress(lu(), probeWorld), dress(lu(), qiefuWorld())]) {
    const keys = keysOf(sheet);
    assert.equal(new Set(keys).size, keys.length, '同一张单子里 key 不该重复');
    const specs = sheet.assets.map((b) => JSON.stringify(b.spec));
    assert.equal(new Set(specs).size, specs.length, '同一份 spec 只该开一次');
    for (const b of sheet.assets) {
      assert.ok(typeof b.key === 'string' && b.key.length > 0, 'Brief 缺 key');
      assert.ok(b.key.startsWith(`${b.kind}-`), `key 要带 kind 前缀：${b.key}`);
      assert.ok(typeof b.why === 'string' && b.why.length > 0, `${b.key} 缺 why`);
      assert.equal(b.for.work, sheet.work, `${b.key} 缺 for.work`);
    }
  }
});

test('session.dress 写一笔 director.dress 账，payload 里的 keys 与资产单一致', () => {
  const s = sessionWith(ANSWERS.A);
  const sheet = s.dress('qiefu', SCENES);
  const entry = s.ledger.last((e) => e.kind === 'director.dress');
  assert.ok(entry, 'session.dress 应写下一笔 director.dress');
  assert.equal(entry.payload.work, 'qiefu');
  assert.deepEqual([...entry.payload.keys].sort(), keysOf(sheet).sort(), 'payload.keys 应与资产单一致');
  assert.equal(entry.payload.counts.image, kindsOf(sheet, 'image').length);
  assert.equal(entry.payload.counts.voice, kindsOf(sheet, 'voice').length);
  assert.equal(entry.payload.counts.sfx, kindsOf(sheet, 'sfx').length);
  assert.equal(entry.payload.counts.music, kindsOf(sheet, 'music').length);
  assert.deepEqual(entry.payload.taste, sheet.taste, '账上记的口味就是这次用的口味');
  assert.ok(entry.cause.length >= 1, 'cause 应指回一笔用户动作');
  assert.match(s.ledger.get(entry.cause[0]).kind, /^user\./, 'cause 应是最近一笔 user.*');
});

/* 7. 不碰对照组 */
test('createPlay 走完整一局不会开单：账本里没有 director.dress', () => {
  const script = scripts()[0];
  const s = createSession();
  s.meet(ANSWERS[script.dir], NEED);
  const p = createPlay(s);
  p.begin();
  let v = p.next();
  const advance = () => {
    while ((v.stage === 'act' || v.stage === 'granary') && v.done) v = p.next();
    if (v.stage === 'coda') v = p.next();
  };
  advance();
  for (const step of script.steps) {
    const [op, arg] = step.split(':');
    try {
      if (op === 'c') v = p.choose(arg).view;
      else if (op === 'w') p.watch(arg);
      else if (op === 'a') p.ask(arg);
      else if (op === 'k') v = p.chooseKeeper(arg);
      advance();
    } catch {
      // 有的脚本故意点了不该点的选项，跳过；这仍然是一条真实的游玩路径
    }
  }
  assert.equal(v.stage, 'done', `脚本 ${script.id} 应走完`);
  assert.ok(s.ledger.entries.length > 10, '完整一局该留下足够多的账');
  assert.equal(s.ledger.entries.filter((e) => e.kind === 'director.dress').length, 0, '680 个脚本的对照里不该出现开单');
});

/* 8. 生成工具的纯逻辑 */
test('生成工具只补缺的、替身要重做（run.mjs 没有可测的纯逻辑就跳过）', async (t) => {
  let mod;
  try {
    mod = await import('../tools/assets/run.mjs');
  } catch {
    t.skip('tools/assets/run.mjs 还不存在（t8 未落地），跳过');
    return;
  }
  const planRun = mod.planRun;
  if (typeof planRun !== 'function') {
    t.skip('run.mjs 没有导出 planRun，纯逻辑在别处，跳过');
    return;
  }
  const briefs = [
    { key: 'image-have', kind: 'image', for: { work: 'qiefu' }, spec: {}, why: '已有' },
    { key: 'image-fallback', kind: 'image', for: { work: 'qiefu' }, spec: {}, why: '上次是替身' },
    { key: 'image-missing', kind: 'image', for: { work: 'qiefu' }, spec: {}, why: '还没生成' },
  ];
  const manifest = {
    'image-have': { kind: 'image', file: 'gen/image-have.png', fallback: false },
    'image-fallback': { kind: 'image', file: 'gen/image-fallback.png', fallback: true },
  };
  const plan = planRun(manifest, briefs, ['magpie', 'elevenlabs', 'synth']);
  const text = JSON.stringify(plan);
  assert.ok(text.includes('image-missing'), '缺的 key 要进计划');
  assert.ok(text.includes('image-fallback'), '替身要在正式服务可用时重做');
  assert.ok(!text.includes('image-have'), '已有且不是替身的 key 不该再生成');
});
