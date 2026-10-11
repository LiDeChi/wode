// t49：生活循环的契约测试（docs/KERNEL.md §9、docs/design/LIVING.md §9–§11）。
//
// 只按契约签名写，不读运行时内部：入口默认关闭且逐字节不变、暂停与续档、同一拍的输入、
// 分两段推进 = 一次推进、纯读不写、脉搏与感知去重、经历跨场留而本段主张不串台、
// 导演的生活计划一 beat 只进一次账、记忆存储九条字面契约。
//
// 驱动方式与 tests/fixtures/play-mechanics-v2-scripts.mjs 一致：createSession() + meet(answers, need)，
// 对照的基线是当前那一份 play-mechanics-v2-golden.json（它就是「不传 living 时」录的）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../shared/engine/session.js';
import { createPlay } from '../shared/engine/play.js';
import { MEMORY_DEFAULTS, createMemoryStore, impactOf, sigOf } from '../shared/core/memory.js';
import { CADENCE_BY_PACE } from '../shared/life/plan.js';
import { taste } from '../shared/agents/stagecraft.js';
import { ANSWERS, NEED, runScript, scripts } from './fixtures/play-mechanics-v2-scripts.mjs';

const v2 = JSON.parse(readFileSync(new URL('./fixtures/play-mechanics-v2-golden.json', import.meta.url), 'utf8'));

/** 一场已经见过导师、已经开场进入第一幕的会话；living 打开时才带生活入口 */
function freshPlay({ dir = 'A', seed = 'ep-1', living = true } = {}) {
  const session = createSession();
  session.meet(ANSWERS[dir], NEED);
  const play = createPlay(session, living ? { living: 'director', seed } : {});
  play.begin();
  play.next();
  return { session, play };
}

const kindsOf = (session, kind) => session.ledger.entries.filter((e) => e.kind === kind);
const cadenceOf = (pace) => (CADENCE_BY_PACE.find(([min]) => pace >= min) || [0, 4])[1];

/** 记忆条目：只给派生量，事实文本一律不进来（契约：事实只在账本） */
function memEntry(over = {}) {
  return { kind: 'event', tick: 1, impact: 0.5, ...over };
}

test('入口关掉时，同一串脚本与旧对照组逐字节相同', () => {
  const legacy = scripts().filter((s) => s.group === 'legacy');
  assert.equal(legacy.length, 680, '旧对照组应该正好是 680 条脚本');
  const sample = legacy.filter((_, i) => i % 85 === 0).slice(0, 8);
  assert.ok(sample.length >= 8);
  for (const sc of sample) {
    assert.deepEqual(runScript({ createSession, createPlay }, sc), v2[sc.id], `${sc.id} 与基线不一致`);
  }
});

test('开关只多生活那几样：不传 living 时存档、画面与返回对象一个字段都不多', () => {
  const off = freshPlay({ living: false });
  assert.equal('life' in off.session.state.play, false, '不传 living 时存档里不该有 life 键');
  assert.equal('episode' in off.session.state, false, '不传 living 时不该有 episode');
  assert.equal(off.play.advance, undefined);
  assert.equal(off.play.life, undefined);
  assert.equal(off.play.lifeRead, undefined);
  assert.equal(off.play.lifeTrace, undefined);
  assert.equal(off.play.lifeRecall, undefined);
  assert.equal('life' in off.play.view(), false, '不传 living 时画面不该多 life 字段');
  assert.equal(kindsOf(off.session, 'director.life-design').length, 0, '默认路径不写生活计划');

  const on = freshPlay({ living: true });
  for (const fn of ['advance', 'lifeEnter', 'lifeRead', 'lifeTrace', 'lifeRecall', 'kernel']) {
    assert.equal(typeof on.play[fn], 'function', `开了 living 应该有 ${fn}`);
  }
  assert.equal(typeof on.play.life, 'object', '开了 living 才有 life 那一叠');
  const life = on.play.view().life;
  assert.deepEqual(Object.keys(life).sort(), ['ended', 'paused', 'policy', 'scene', 'tick']);
  assert.equal(life.tick, 0);
  assert.equal(life.scene, 'daliang');
  assert.equal(life.paused, false);
  assert.equal(life.ended, false);
  assert.equal(typeof on.session.state.play.life, 'object', '开了 living 生活状态才随档走');
});

test('入口打开后，玩家自己走的每一步仍然走同一个世界', () => {
  const sample = scripts().filter((s) => s.group === 'legacy').filter((_, i) => i % 170 === 0).slice(0, 4);
  for (const sc of sample) {
    const { play } = freshPlay({ dir: sc.dir });
    let v = play.view();
    const finish = () => {
      while ((v.stage === 'act' || v.stage === 'granary') && v.done) v = play.next();
      if (v.stage === 'coda') v = play.next();
    };
    finish();
    for (const step of sc.steps) {
      try {
        const [op, arg] = step.split(':');
        if (op === 'c') v = play.choose(arg).view;
        else if (op === 'w') play.watch(arg);
        else if (op === 'a') play.ask(arg);
        else if (op === 'k') v = play.chooseKeeper(arg);
      } catch {
        // 旧对照组里被挡住的步也照样被记下来，这里一样跳过继续
      }
      finish();
    }
    const st = play.state();
    const base = v2[sc.id];
    // 生活的账本会多出脉冲与计划，但玩家走出来的世界（舞台、结局、天数、旗标、每一幕的选择）相同
    assert.equal(v.stage, base.stage, `${sc.id} 舞台不同`);
    assert.equal(st.ending, base.ending, `${sc.id} 结局不同`);
    assert.equal(st.days, base.days, `${sc.id} 天数不同`);
    assert.deepEqual(st.flags, base.flags, `${sc.id} 旗标不同`);
    assert.deepEqual(
      Object.fromEntries(Object.entries(st.acts).map(([k, a]) => [k, a.choice])),
      Object.fromEntries(Object.entries(base.acts).map(([k, a]) => [k, a.choice])),
      `${sc.id} 每一幕的选择不同`,
    );
  }
});

test('暂停时一拍都不走，恢复后接着走', () => {
  const { session, play } = freshPlay();
  const before = session.ledger.size;
  const r1 = play.advance({ toTick: 20, paused: true });
  assert.equal(r1.tick, 0, '暂停期间逻辑拍不动');
  assert.equal(play.life.state().tick, 0);
  assert.equal(session.ledger.size, before, '暂停期间不写账');
  assert.equal(kindsOf(session, 'world.pulse').length, 0);

  const r2 = play.advance({ toTick: 20, paused: false });
  assert.equal(r2.tick, 20, '恢复后一次推进到目标拍');
  assert.equal(play.life.state().paused, false);
  assert.ok(kindsOf(session, 'world.pulse').length > 0, '恢复后世界才开始有脉搏');
});

test('续档：存档之后重开接着走，与一直走到底一样', () => {
  const straight = freshPlay({ seed: 'ep-save' });
  straight.play.advance({ toTick: 8 });

  const cut = freshPlay({ seed: 'ep-save' });
  cut.play.advance({ toTick: 4 });
  const saved = cut.session.save();
  assert.equal(typeof saved.play.life, 'object', '存档里带着生活状态');

  const session2 = createSession(saved);
  const play2 = createPlay(session2, { living: 'director', seed: 'ep-save' });
  const resumed = play2.advance({ toTick: 8 });
  assert.equal(resumed.tick, 8, '续档后接着推到同一拍');
  assert.deepEqual(session2.state.play.life, straight.session.state.play.life, '续档后的生活状态与一直走的一样');
  assert.equal(session2.ledger.size, straight.session.ledger.size, '续档后账本长度也一样');
  assert.equal(
    kindsOf(session2, 'director.life-design').length, 1,
    '续档重开时导演不再重复提交这一场的计划',
  );
});

test('同一拍里先玩家输入，再环境与演员', () => {
  const { session, play } = freshPlay();
  const r = play.advance({ toTick: 8, inputs: [{ id: 'i1', tick: 8, op: 'ask', args: { person: 'xinling' } }] });
  assert.deepEqual(r.processed.map((p) => [p.id, p.tick, p.repeated]), [['i1', 8, undefined]]);
  const asked = session.ledger.entries.find((e) => e.kind === 'user.ask' && e.payload?.person === 'xinling');
  const pulse = session.ledger.entries.find((e) => e.kind === 'world.pulse' && e.payload?.tick === 8);
  assert.ok(asked, '这一拍该有玩家的追问');
  assert.ok(pulse, '这一拍该落一条世界脉搏');
  assert.ok(asked.seq < pulse.seq, '同一拍里玩家输入先于环境与演员');
});

test('同一个输入 id 只跑一次', () => {
  const { session, play } = freshPlay();
  const input = { id: 'same', tick: 2, op: 'ask', args: { person: 'xinling' } };
  const r1 = play.advance({ toTick: 4, inputs: [input] });
  assert.equal(r1.processed[0].repeated, undefined);
  const r2 = play.advance({ toTick: 4, inputs: [input] });
  assert.equal(r2.processed[0].repeated, true, '重复提交同一个 id 要标成 repeated');
  const asked = session.ledger.entries.filter((e) => e.kind === 'user.ask' && e.payload?.person === 'xinling');
  assert.equal(asked.length, 1, '账本上只该有一次追问');
});

test('分两段推进到同一拍，与一次推进到同一拍相同', () => {
  const one = freshPlay({ seed: 'ep-split' });
  one.play.advance({ toTick: 6 });

  const two = freshPlay({ seed: 'ep-split' });
  two.play.advance({ toTick: 3 });
  two.play.advance({ toTick: 6 });

  assert.deepEqual(two.session.state.play.life, one.session.state.play.life, '两段的存档与一次不同');
  assert.equal(two.session.ledger.size, one.session.ledger.size);
  const lastOf = (s) => s.ledger.entries[s.ledger.entries.length - 1]?.hash;
  assert.equal(lastOf(two.session), lastOf(one.session), '两段的账本指纹不同');
});

test('纯读：读镜、追片段、看画面都不改存档与账本', () => {
  const { session, play } = freshPlay();
  play.advance({ toTick: 8 });
  assert.ok(Object.keys(play.life.state().perceptions).length > 0, '这一拍该留下真实感知片段');

  const before = { saved: JSON.stringify(session.save()), size: session.ledger.size, hash: session.ledger.entries.at(-1).hash };
  const read = play.lifeRead('daliang');
  for (const seq of Object.keys(play.life.state().perceptions)) play.lifeTrace(Number(seq));
  play.life.read('daliang');
  play.view();

  assert.equal(JSON.stringify(session.save()), before.saved, '纯读之后存档变了');
  assert.equal(session.ledger.size, before.size, '纯读之后账本长了');
  assert.equal(session.ledger.entries.at(-1).hash, before.hash);

  // 读镜给的是结构化片段：每片带来源、层级、对象、原因 id、账本位置与人可读字段路径
  assert.equal(read.scene, 'daliang');
  assert.equal(read.work, 'qiefu');
  assert.ok(Array.isArray(read.actors) && read.actors.length > 0);
  for (const a of read.actors) {
    assert.equal(typeof a.id, 'string');
    assert.equal(typeof a.name, 'string');
    assert.ok(Array.isArray(a.thinking));
  }
  assert.ok(read.causes.length > 0, '读镜该给出最近的因果片段');
  for (const c of read.causes) {
    assert.equal(typeof c.seq, 'number');
    assert.equal(typeof c.kind, 'string');
    assert.equal(typeof c.path, 'string');
    assert.ok(Array.isArray(c.cause));
  }
  assert.equal(typeof read.watching.path, 'string');
  assert.ok(read.policy === null || typeof read.policy.path === 'string');
  const traced = play.lifeTrace(Number(Object.keys(play.life.state().perceptions)[0]));
  assert.ok(traced.path.startsWith('play.life.perceptions['));
  assert.ok(['mind', 'module', 'unit'].includes(traced.layer));
});

test('环境脉搏按世界签名去重，演员对同一条脉搏只感知一次', () => {
  const { session, play } = freshPlay();
  play.advance({ toTick: 24 });
  const pulses = kindsOf(session, 'world.pulse');
  assert.ok(pulses.length > 0, '二十几拍该有脉搏');
  for (let i = 1; i < pulses.length; i += 1) {
    assert.notEqual(pulses[i].payload.signature, pulses[i - 1].payload.signature, '世界没变就不该再落一条脉搏');
  }
  const seen = new Set();
  for (const e of kindsOf(session, 'actor.react')) {
    const frag = play.lifeTrace(e.seq);
    if (!frag?.signature?.startsWith('pulse:')) continue;
    const key = `${frag.person}|${frag.signature}`;
    assert.equal(seen.has(key), false, `${key} 被同一件事算了两次`);
    seen.add(key);
  }
  assert.ok(seen.size > 0, '演员至少该真看过一件事');
  // 演员自己动时：from 一定是演员，cause 指向他自己的那次反应
  for (const e of kindsOf(session, 'actor.act')) {
    assert.ok(String(e.from).startsWith('actor:'), `actor.act 的 from 必须是演员：${e.from}`);
    const react = session.ledger.entries.find((x) => x.seq === e.cause?.[0]);
    assert.ok(react && react.kind === 'actor.react', 'actor.act 的 cause 要指向他自己的反应');
  }
});

test('记忆：默认值与两把尺子（sigOf / impactOf）是契约里那几个数', () => {
  assert.deepEqual(MEMORY_DEFAULTS, {
    capacity: 240, decay: 0.99, consolidateAt: 1.2, bucketSize: 8, overFetch: 4,
    throttleTicks: 5, forgetRatio: 0.3, keepRecent: 15, exemptImpact: 0.6, levels: 2,
    weights: { relevance: 3, importance: 2, recency: 0.5 },
  });
  assert.equal(sigOf({ kind: 'event', actorId: 'xinling', sceneId: 'daliang', seq: 12 }), 'event|xinling|daliang|s12');
  assert.equal(sigOf({ kind: 'thought', actorId: 'a', sceneId: 's', keywords: ['符', '义'] }), 'thought|a|s|义+符');
  assert.equal(sigOf({ kind: 'event', tick: 3 }), 'event|-|-|t3');
  assert.equal(impactOf({ error: 0.5, goalHit: true, first: true, moved: 0.4 }), 0.74);
  assert.equal(impactOf({ impact: 9 }), 1, '显式 impact 优先并夹到 0..1');
  assert.equal(impactOf({ impact: -3 }), 0);
  assert.equal(impactOf({}), 0);
});

test('记忆：同一个 sig 只留一条，重复发生只把它点亮到上限', () => {
  const m = createMemoryStore();
  const first = m.remember(memEntry({ seq: 7, actorId: 'xinling', sceneId: 'daliang' }));
  const again = m.remember(memEntry({ seq: 7, actorId: 'xinling', sceneId: 'daliang' }));
  assert.equal(again, first, '同一件事该返回同一个 id');
  assert.equal(m.size(), 1, '同一件事不该留两条');
  assert.equal(m.get(first).activation, 0.8, '再次发生把手上的事点亮一档');
  for (let i = 0; i < 20; i += 1) m.remember(memEntry({ seq: 7, actorId: 'xinling', sceneId: 'daliang' }));
  assert.equal(m.get(first).activation, 2, 'activation 有上限 2');
  const other = m.remember(memEntry({ seq: 8, actorId: 'xinling', sceneId: 'daliang' }));
  assert.notEqual(other, first);
  assert.equal(m.size(), 2);
});

test('记忆：recall 三路融合、分数 round3、同输入同输出、不回传事实', () => {
  const entries = [
    memEntry({ seq: 1, actorId: 'xinling', sceneId: 'daliang', tick: 1, impact: 0.8, keywords: ['义', '门客'] }),
    memEntry({ seq: 2, actorId: 'ruji', sceneId: 'night', tick: 5, impact: 0.5, keywords: ['符', '义'] }),
    memEntry({ kind: 'thought', seq: 3, actorId: 'xinling', sceneId: 'daliang', tick: 9, impact: 0.3, keywords: ['兵权'] }),
  ];
  const build = () => {
    const s = createMemoryStore();
    for (const e of entries) s.remember(e);
    return s;
  };
  const a = build();
  const b = build();
  const q = { actorId: 'xinling', sceneId: 'daliang', keywords: ['义'], tick: 12, k: 3 };
  const r1 = a.recall(q);
  const r2 = a.recall(q);
  const r3 = b.recall(q);
  assert.ok(r1.length > 0);
  assert.deepEqual(r2, r1, '同一个 store 同输入要同输出');
  assert.deepEqual(r3, r1, '同构的 store 同输入要同输出');
  for (const item of r1) {
    assert.deepEqual(Object.keys(item).sort(), ['depth', 'id', 'impact', 'kind', 'score', 'seq', 'tick']);
    assert.deepEqual(Object.keys(item.score).sort(), ['importance', 'recency', 'relevance', 'rrf', 'total']);
    for (const v of Object.values(item.score)) assert.equal(v, Math.round(v * 1000) / 1000, '分数要 round3');
    assert.equal(typeof item.seq, 'number', '记忆只留账本 seq');
  }
  assert.ok(r1[0].score.total >= r1.at(-1).score.total, '要按总分从高到低排');
  const asText = JSON.stringify(r1);
  for (const bad of ['"line"', '"appeal"', '"said"', '"text"']) {
    assert.equal(asText.includes(bad), false, `召回结果不该带账本事实字段 ${bad}`);
  }
  assert.equal(JSON.stringify(a.save()).includes('"line"'), false);
});

test('记忆：巩固要计数器到位，产出 depth+1 并指向被收拢的那几条', () => {
  const m = createMemoryStore({ bucketSize: 2, consolidateAt: 1.2, levels: 1, keepRecent: 99 });
  const a = m.remember(memEntry({ seq: 1, actorId: 'xinling', sceneId: 'daliang', tick: 1, impact: 1, keywords: ['义'] }));
  const b = m.remember(memEntry({ seq: 2, actorId: 'ruji', sceneId: 'night', tick: 5, impact: 1, keywords: ['符', '义'], who: ['xinling'] }));
  const made = m.consolidate({ toTick: 5 });
  assert.equal(made.length, 1);
  const e = made[0];
  assert.equal(e.kind, 'thought');
  assert.equal(e.depth, 1, '巩固出来的上一层 depth 是旧的 +1');
  assert.equal(e.sig, `sum1:${b}+${a}`, '被收拢的那几条按最新在前记在 sig 里');
  assert.deepEqual(e.from.slice().sort(), [a, b].sort());
  assert.deepEqual(e.keywords, ['义', '符'], '关键词取并集并排序');
  assert.equal(e.impact, 1, 'impact 取最大');
  assert.equal(e.seq, 2, 'seq 指向最新那一条');
  assert.deepEqual(m.consolidate({ toTick: 5 }), [], '已经收拢过的不再重复产出');

  const low = createMemoryStore({ bucketSize: 2, consolidateAt: 1.2 });
  low.remember(memEntry({ seq: 1, tick: 1, impact: 0.1 }));
  low.remember(memEntry({ seq: 2, tick: 2, impact: 0.1 }));
  assert.deepEqual(low.consolidate({ toTick: 2 }), [], 'impact 没攒够就不巩固');
});

test('记忆：tick 只让激活变淡；遗忘按期限、冷掉、容量，高 impact 豁免', () => {
  const m = createMemoryStore({ keepRecent: 0, forgetRatio: 1, exemptImpact: 0.6 });
  const hi = m.remember(memEntry({ seq: 1, tick: 1, impact: 0.9, activation: 0.1 }));
  const expiring = m.remember(memEntry({ seq: 2, tick: 2, impact: 0.2, activation: 0.1, expires: 5 }));
  const cold = m.remember(memEntry({ seq: 3, tick: 3, impact: 0.2, activation: 0.1 }));

  m.tick({ toTick: 1 });
  assert.equal(m.size(), 3, 'tick 不遗忘');
  assert.equal(m.get(hi).activation, 0, '每一拍让激活变淡 0.15，见底就是 0');

  const f = m.forget({ toTick: 6 });
  assert.deepEqual(Object.keys(f).sort(), ['dropped', 'kept']);
  assert.ok(f.dropped.includes(expiring), '写了期限的到期就走');
  assert.ok(f.dropped.includes(cold), '冷掉又不够重的可以丢');
  assert.equal(f.dropped.includes(hi), false, 'impact 够高的豁免淘汰');
  assert.equal(f.kept, 1);
  assert.equal(m.get(hi) !== null, true, '豁免的那条还在');

  const m2 = createMemoryStore({ keepRecent: 0, forgetRatio: 1, exemptImpact: 0.6 });
  const heavyButExpired = m2.remember(memEntry({ seq: 1, tick: 1, impact: 0.9, activation: 0.1, expires: 5 }));
  const f2 = m2.forget({ toTick: 6 });
  assert.deepEqual(f2.dropped, [heavyButExpired], '明写期限的不受高 impact 豁免');
  assert.equal(f2.kept, 0);
});

test('记忆：save / restore 是纯 JSON 往返，restore 整体替换', () => {
  const m = createMemoryStore();
  const one = m.remember(memEntry({ seq: 1, actorId: 'xinling', sceneId: 'daliang', tick: 1, keywords: ['义'] }));
  m.remember(memEntry({ seq: 2, actorId: 'ruji', sceneId: 'night', tick: 4, keywords: ['符'] }));
  const saved = m.save();
  assert.deepEqual(Object.keys(saved).sort(), ['cfg', 'entries', 'nextId', 'now', 'pending', 'v']);
  const json = JSON.stringify(saved);
  const round = JSON.parse(json);
  assert.deepEqual(round, saved, 'save 出来必须能直接 JSON 往返');

  const back = createMemoryStore({ saved: round });
  assert.deepEqual(back.save(), saved, 'restore 之后状态要一致');
  assert.equal(back.size(), 2);
  const q = { actorId: 'xinling', tick: 10, k: 2 };
  assert.deepEqual(back.recall(q), m.recall(q), '恢复后的召回与原来一样');
  assert.equal(back.get(one).seq, 1, '记忆里留的是账本位置');

  const small = createMemoryStore({ saved: { ...round, entries: round.entries.slice(0, 1), nextId: 9 } });
  assert.equal(small.size(), 1);
  small.restore(saved);
  assert.equal(small.size(), 2, 'restore 是整体替换，不是合并');
  assert.equal(small.save().nextId, saved.nextId);
});

test('经历跨场留着：换到下一场以后，上一场真看过的还在记忆里', () => {
  const { play } = freshPlay();
  play.advance({ toTick: 8 });
  const afterFirst = Object.keys(play.life.state().experiences);
  assert.ok(afterFirst.some((k) => k.includes('pulse:daliang:')), '第一场该留下真看过的经历');

  play.choose('yi');
  play.next();
  play.lifeEnter('yimen');
  play.advance({ toTick: 24 });
  const keys = Object.keys(play.life.state().experiences);
  assert.ok(keys.some((k) => k.includes('pulse:daliang:')), '换场以后上一场的经历还在');
  assert.ok(keys.some((k) => k.includes('pulse:yimen:')), '这一场也留下自己的经历');
  const sceneIds = new Set(play.life.save().store.entries.map((e) => e.sceneId).filter(Boolean));
  assert.ok(sceneIds.has('daliang') && sceneIds.has('yimen'), '两场的经历都在同一份记忆装置里');
});

test('结局隔离：本段外的主张不进这一段，明确继承的才进', () => {
  const { session, play } = freshPlay();
  play.advance({ toTick: 4 });
  const oldClaims = session.claims.all().map((c) => c.id);
  assert.ok(oldClaims.length > 0, '开场那条链上该已经有主张');

  const ep2 = session.beginEpisode({ work: 'qiefu' });
  assert.equal(ep2.id, 'ep2');
  const scope0 = session.episodeScope();
  for (const id of scope0.claimIds) assert.equal(oldClaims.includes(id), false, '上一段的主张不算数');

  const fresh = session.claims.add({
    subject: '如姬', predicate: '交出了', object: '兵符', holder: 'user', channel: '明说',
    evidence: [], weight: 2, note: 't49 测试里的新主张',
  }).claim;
  const scope1 = session.episodeScope();
  assert.ok(scope1.claimIds.includes(fresh.id), '这一段自己产出的主张要算数');
  for (const id of oldClaims) assert.equal(scope1.claimIds.includes(id), false, '旧主张仍然不串台');

  session.beginEpisode({ work: 'qiefu', inherit: [oldClaims[0]] });
  const scope2 = session.episodeScope();
  assert.ok(scope2.claimIds.includes(oldClaims[0]), '明确继承的才进来');
  assert.equal(scope2.previous, 'ep2');
});

test('导演的生活计划：一个 beat 只进一次账，policy 钉着自己的 seq，并随手艺变', () => {
  const { session, play } = freshPlay();
  play.advance({ toTick: 1 });
  const designs = kindsOf(session, 'director.life-design');
  assert.equal(designs.length, 1, '进这一场只提交一次生活计划');
  const entry = designs[0];
  assert.equal(entry.from, `director:${session.state.directorId}`);
  assert.equal(entry.payload.work, 'qiefu');
  assert.equal(entry.payload.beat, play.life.state().sceneId, '这一拍记的就是进的那一场');
  const policy = entry.payload.policy;
  assert.ok(policy.cadenceTicks >= 2 && policy.cadenceTicks <= 4, '节奏落在 2..4 拍');
  assert.equal(typeof policy.waitForPlayer, 'boolean');
  assert.ok(policy.autonomy.people.length > 0, '计划要说清谁可以自己动');
  assert.ok(policy.autonomy.verbs.includes('think'), '至少「想一想」是允许演员自己动的');
  assert.ok(policy.warning.ticks >= 1);
  assert.ok(typeof policy.why === 'string' && policy.why.length > 0, '计划要留一句给人看的原因');
  assert.ok(['slow', 'after-decision'].includes(policy.historyReveal));
  assert.equal(policy.sourceSeq, null, '纯函数里先留空，提交时才钉 seq');

  const beats = session.state.designs.qiefu.beats ?? [];
  const stored = beats.find((b) => b.id === entry.payload.beat) ?? beats.find((b) => b.id === 'daliang');
  assert.ok(stored, '这一 beat 的案上该有这份计划');
  assert.equal(stored.lifePolicy.sourceSeq, entry.seq, '存档里的 policy 要钉在账本那一条上');

  play.advance({ toTick: 3 });
  assert.equal(kindsOf(session, 'director.life-design').length, 1, '同一 beat 再进不重复记账');

  // 计划确实是照着导演的手艺算的（taste 的节奏与三个映射）
  const director = session.director();
  const t = taste(director);
  assert.equal(policy.cadenceTicks, cadenceOf(t.craft.节奏));
  assert.equal(policy.historyReveal, t.craft.悲剧 > 0.6 ? 'slow' : 'after-decision');
  assert.equal(policy.waitForPlayer, !(director.craft().freedomBias > director.craft().lockBias));
});
