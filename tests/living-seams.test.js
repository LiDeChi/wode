// t53：docs/KERNEL.md §9；M1–M10/S2/S5，以及真实取符之夜公共 advance。
// 只用公开入口；注入的场景/心智是确定性测试配方，边界状态注入另行标明。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../shared/engine/session.js';
import { createPlay } from '../shared/engine/play.js';
import { createMind } from '../shared/core/mind.js';
import { QIFU_SCENES } from '../shared/scenes/qiefu.js';

const ANSWERS = { A: { wait: .8, polish: .8, depth: .85 }, B: { wait: .2, polish: .2, depth: .25 } };
const NEED = '我想看一个人在乱世里怎么做选择';
const entries = (s, kind) => s.ledger.entries.filter((e) => e.kind === kind);
const json = (x) => JSON.stringify(x);
const record = (s, seq) => s.ledger.entries.find((e) => e.seq === seq);
const cloneScenes = () => structuredClone(QIFU_SCENES);

function boot({ scenes = QIFU_SCENES, dir = 'A', seed = 't53', minds } = {}) {
  const session = createSession();
  session.meet(ANSWERS[dir], NEED);
  if (minds) Object.assign(session.minds, minds);
  const play = createPlay(session, { living: 'director', seed, scenes });
  play.begin();
  play.next();
  return { session, play };
}

// 单通道被一个单元完全接下，保证停在 unit；名字、台词不参与判定。
function actor(id, verb = 'say') {
  return createMind({
    id, name: id, temperament: {}, values: {}, trust: { 'actor:player': .45, user: .99 },
    units: [{ id: 'respond', label: '回应', module: 'notice', reads: ['测试'], capacity: 1.5, act: 'respond', verb }],
    modules: [], goals: [],
  });
}

function minimal({ actors = ['xinling'], schedule = [], rules = [], life = {} } = {}) {
  const scenes = cloneScenes();
  scenes.daliang = {
    ...scenes.daliang, people: actors.slice(), rules,
    life: {
      actors: actors.slice(), verbs: [],
      stimulus: Object.fromEntries(actors.map((id) => [id, { 测试: .4 }])),
      receivers: Object.fromEntries(actors.map((id) => [id, []])),
      environment: { cadenceTicks: 8, schedule }, ...life,
    },
  };
  return scenes;
}

function assertOwnReaction(session, act) {
  assert.ok(act, '动作必须真实存在，不能对空列表作验证');
  assert.match(act.from, /^actor:/);
  assert.equal(act.cause.length, 1);
  const react = record(session, act.cause[0]);
  assert.equal(react?.kind, 'actor.react');
  assert.equal(react.from, act.from, '动作来自这个人自己的真实反应');
  return react;
}

test('M1：真实偏差改变计划版本；同一反馈只学一次，静候不重复提交', () => {
  const { session, play } = boot();
  const old = play.lifeRead('daliang').policy;
  const feedback = session.react('qiefu', 'daliang', 'unexpected');
  play.advance({ toTick: 1 });
  const changed = play.lifeRead('daliang').policy;
  assert.notEqual(changed.version, old.version);
  assert.notEqual(changed.sourceSeq, old.sourceSeq);
  assert.equal(changed.decidedAt, 1);
  assert.equal(record(session, changed.sourceSeq)?.kind, 'director.life-design');
  const learns = entries(session, 'director.learn');
  assert.ok(learns.length > 0);
  assert.ok(learns.at(-1).cause.includes(feedback.userSeq));
  assert.equal(session.state.episode.learnedThrough, feedback.userSeq);
  const designs = entries(session, 'director.life-design').length;
  play.advance({ toTick: 4 });
  assert.equal(entries(session, 'director.learn').length, learns.length);
  assert.equal(entries(session, 'director.life-design').length, designs);
  assert.equal(play.lifeRead('daliang').policy.sourceSeq, changed.sourceSeq);
});

test('M2：最近动作、行动层、来源、玩家信任与位置对应同一次真实反应', () => {
  const scenes = minimal({ actors: ['ruji'], rules: [
    { when: { tick: 1 }, then: [['move', 'ruji', '测试门边']] },
  ] });
  const { session, play } = boot({ scenes, minds: { ruji: actor('ruji') } });
  play.advance({ toTick: 4 });
  const ruji = play.lifeRead('daliang').actors.find((a) => a.id === 'ruji');
  assert.ok(ruji?.last);
  assert.equal(ruji.trust, .45, '读 actor:player，不能读 user 的 .99');
  assert.equal(ruji.at, '测试门边');
  const log = session.minds.ruji.state.log.at(-1);
  const traced = play.lifeTrace(ruji.last.seq);
  assert.equal(record(session, ruji.last.seq)?.kind, 'actor.react');
  assert.equal(traced.person, 'ruji');
  assert.equal(ruji.last.signature, log.sig);
  assert.equal(ruji.last.action, log.act);
  for (const key of ['signature', 'action', 'actionLayer', 'actionFrom', 'stoppedAt']) {
    assert.ok(traced[key], `真实片段缺 ${key}`);
    assert.equal(ruji.last[key], traced[key]);
  }
  for (const key of ['source', 'layer', 'object', 'reasonId', 'seq', 'at', 'path']) {
    assert.ok(Object.hasOwn(ruji.last, key), `读镜缺 ${key}`);
  }
  assert.ok(Array.isArray(traced.cause) && traced.cause.length > 0);
});

test('M3/M4：玩家和开场真实经历非空；读镜与追片段前后 save 逐字节相同', () => {
  const { session, play } = boot();
  play.choose('wait');
  play.advance({ toTick: 1 });
  const read = play.lifeRead('daliang');
  assert.ok(read.experiences.length > 0);
  assert.ok(read.experiences.some((e) => e.impact > 0));
  for (const e of read.experiences) {
    for (const key of ['person', 'key', 'signature', 'seq', 'activation', 'consolidation', 'impact', 'depth']) {
      assert.notEqual(e[key], undefined, `经历缺 ${key}`);
      assert.notEqual(e[key], null, `经历 ${key} 为空`);
    }
    assert.ok(play.lifeTrace(e.seq), '经历指针必须指向留档的真实片段');
    assert.equal(record(session, e.seq)?.kind, 'actor.react');
  }
  const before = json(session.save());
  const hash = session.ledger.entries.at(-1).hash;
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(play.lifeRead('daliang'), read);
    for (const e of read.experiences) play.lifeTrace(e.seq);
    play.view();
  }
  assert.equal(json(session.save()), before);
  assert.equal(session.ledger.entries.at(-1).hash, hash);
});

test('M4：同类真实刺激在原槽增长；续档继续同槽且与直走完全相同', () => {
  const scenes = cloneScenes();
  scenes.daliang.life = { actors: ['xinling'], verbs: [], stimulus: { xinling: { 义: .4 } },
    environment: { cadenceTicks: 8, schedule: [{ at: 5 }, { at: 9 }] } };
  const { session, play } = boot({ scenes, seed: 't53-growth' });
  play.advance({ toTick: 4 });
  const key = Object.keys(session.minds.xinling.state.memory).find((k) => k.startsWith('life:'));
  assert.ok(key, '第一轮必须产生真实同类槽');
  const before = { ...session.minds.xinling.state.memory[key] };
  const slot = play.life.memory().all().find((e) => e.actorId === 'xinling' && e.sceneId === 'daliang' && e.kind === 'perception');
  assert.ok(slot?.impact > 0);
  const oldSeq = slot.seq;
  const restored = createSession({ saved: JSON.parse(json(session.save())) });
  const resumed = createPlay(restored, { living: 'director', seed: 't53-growth', scenes });
  play.advance({ toTick: 12 });
  resumed.advance({ toTick: 12 });
  const grown = session.minds.xinling.state.memory[key];
  assert.ok(grown.trace > before.trace);
  assert.ok(grown.consolidation > before.consolidation);
  const sameSlot = play.life.memory().get(slot.id);
  assert.ok(sameSlot.seq > oldSeq, '同槽指向最新真实发生');
  assert.equal(sameSlot.sig, slot.sig);
  assert.equal(json(restored.save()), json(session.save()));
});

test('M4/M5：固定处境只衰减，内部 reactSeq 不再唤醒脉搏或制造经历', () => {
  const scenes = minimal();
  const { session, play } = boot({ scenes, minds: { xinling: actor('xinling') } });
  play.advance({ toTick: 4 });
  const pulses = entries(session, 'world.pulse').length;
  const reactions = entries(session, 'actor.react').length;
  const indexed = json(play.life.state().experiences);
  const memories = play.life.memory().all().map((e) => ({ id: e.id, seq: e.seq, sig: e.sig, activation: e.activation }));
  const key = 'life:daliang:xinling:think';
  const mind = { ...session.minds.xinling.state.memory[key] };
  assert.equal(pulses, 1);
  assert.ok(memories.length > 0 && mind.trace > 0);
  assert.equal(entries(session, 'actor.act').length, 0, 'say 未获授，真实反应不能冒充执行');
  play.advance({ toTick: 32 });
  assert.equal(entries(session, 'world.pulse').length, pulses);
  assert.equal(entries(session, 'actor.react').length, reactions);
  assert.equal(json(play.life.state().experiences), indexed);
  assert.equal(session.minds.xinling.state.memory[key].trace, mind.trace);
  assert.equal(session.minds.xinling.state.memory[key].consolidation, mind.consolidation);
  assert.ok(session.minds.xinling.state.memory[key].activation <= mind.activation);
  for (const prior of memories) {
    const now = play.life.memory().get(prior.id);
    assert.ok(now, '静候不能丢掉此最小例子的近期经历');
    assert.equal(now.seq, prior.seq);
    assert.equal(now.sig, prior.sig);
    assert.ok(now.activation <= prior.activation);
  }
});

test('M6：动作→真实主张后果→有限接收者；未知/未授权收件人没有该动作反应', () => {
  const scenes = minimal({ actors: ['xinling', 'zhaoshi', 'ruji'], life: {
    verbs: ['say'], receivers: { xinling: ['zhaoshi'], zhaoshi: [], ruji: [] },
    gate: { xinling: { when: { flag: { once: null } } }, zhaoshi: { when: { flag: { never: true } } }, ruji: { when: { flag: { never: true } } } },
  }, rules: [{ when: { person: 'xinling', not: { actSeq: null } }, then: [
    ['flag', 'once', true], ['claim', { subject: '测试发言', predicate: '造成', object: '真实后果', holder: 'xinling' }],
  ] }] });
  const minds = Object.fromEntries(['xinling', 'zhaoshi', 'ruji'].map((id) => [id, actor(id)]));
  const { session, play } = boot({ scenes, minds, dir: 'B' });
  // 7 拍以内只有入场那一次环境拍：动作只发生一次，避免第 8 拍环境签名变化再派一次
  play.advance({ toTick: 7 });
  const act = entries(session, 'actor.act').find((e) => e.payload.person === 'xinling');
  assertOwnReaction(session, act);
  const claim = entries(session, 'claim.add').find((e) => e.payload.subject === '测试发言');
  assert.ok(claim, '后果不是空旗标遍历');
  assert.deepEqual(claim.cause, [act.seq]);
  assert.equal(play.state().flags.once, true);
  const receiver = entries(session, 'actor.react').filter((e) => e.cause.includes(act.seq));
  assert.equal(receiver.length, 1);
  assert.equal(receiver[0].from, 'actor:zhaoshi');
  assert.deepEqual(receiver[0].cause, [act.seq]);
  assert.deepEqual(play.lifeTrace(receiver[0].seq).cause, [act.seq]);
  assert.equal(entries(session, 'actor.react').some((e) => e.from === 'actor:ruji' && e.cause.includes(act.seq)), false);
  assert.equal(entries(session, 'actor.act').filter((e) => e.payload.person === 'xinling').length, 1);
});

test('M7：恢复保留 episode、范围、经验、队列与输入；新段只重置进度', () => {
  const scenes = minimal();
  const { session, play } = boot({ scenes });
  play.advance({ toTick: 4, inputs: [{ id: 'remember-input', tick: 3, op: 'ask', args: { person: 'xinling' } }] });
  const oldClaim = session.claims.add({ subject: '晋鄙', predicate: '下场', object: '旧局下场', holder: 'user', channel: '被告知' }).claim;
  const saved = JSON.parse(json(session.save()));
  assert.ok(saved.play.life.store.entries.length > 0);
  for (const options of [saved, { saved }]) {
    const resumed = createSession(options);
    const p = createPlay(resumed, { living: 'director', scenes });
    assert.deepEqual(resumed.state.episode, saved.episode);
    assert.deepEqual(p.life.save(), saved.play.life);
    assert.ok(resumed.episodeScope().claimIds.includes(oldClaim.id));
    const id = resumed.state.episode.id;
    p.begin();
    assert.equal(resumed.state.episode.id, id, '恢复不重开段');
  }
  const history = json(play.life.memory().save());
  const perceptions = json(play.life.state().perceptions);
  const craft = session.director().craft();
  const oldId = session.state.episode.id;
  session.beginEpisode({ work: 'qiefu' });
  play.advance({ toTick: 0 });
  const ls = play.life.state();
  assert.notEqual(ls.episodeId, oldId);
  assert.equal(ls.episodeId, session.state.episode.id);
  assert.equal(ls.tick, 0);
  assert.equal(ls.sceneTick, 0);
  assert.equal(ls.memoryOffset, 4);
  assert.deepEqual(ls.processed, {});
  assert.deepEqual(ls.pendingInputs, []);
  assert.deepEqual(ls.queue, []);
  assert.equal(ls.ended, false);
  assert.equal(json(play.life.memory().save()), history);
  assert.equal(json(ls.perceptions), perceptions);
  assert.deepEqual(session.director().craft(), craft);
  assert.equal(session.episodeScope().claimIds.includes(oldClaim.id), false);
  session.beginEpisode({ work: 'qiefu', inherit: [oldClaim.id] });
  assert.ok(session.episodeScope().claimIds.includes(oldClaim.id));
});

test('M8：第30拍入场后停8拍，纸条追到原始停留；手改和暂停均受保护', () => {
  const { session, play } = boot();
  play.advance({ toTick: 30 });
  play.choose('wait');
  play.next();
  play.advance({ toTick: 31 }); // 先消费刚才真实选择的反馈，后续停留不新增学习。
  const learned = entries(session, 'director.learn').length;
  play.advance({ toTick: 37 });
  assert.equal(entries(session, 'user.pause').filter((e) => e.payload.scene === 'yimen').length, 0);
  play.advance({ toTick: 38 });
  const pause = entries(session, 'user.pause').at(-1);
  assert.deepEqual(pause.payload, { scene: 'yimen', fromTick: 30, toTick: 38, ticks: 8 });
  const note = session.mentor.notes().pause;
  assert.ok(record(session, note.seq).cause.includes(pause.seq));
  assert.ok(note.value.includes('8'), '写相对时长8，不写绝对拍38');
  assert.equal(entries(session, 'director.learn').length, learned, '停留不会学成玩家反馈');
  play.advance({ toTick: 40 });
  assert.equal(entries(session, 'user.pause').at(-1).seq, pause.seq, '连续停留只记一次');
  session.editNote('pause', '我自己写的停留注记');
  assert.equal(session.mentor.notes().pause.source, '你改的');
  play.life.resume();
  play.advance({ toTick: 48 });
  assert.equal(session.mentor.notes().pause.value, '我自己写的停留注记');
  assert.equal(session.mentor.notes().pause.source, '你改的');
  const size = session.ledger.size;
  play.advance({ toTick: 60, paused: true });
  assert.equal(play.life.state().tick, 48);
  assert.equal(session.ledger.size, size);
});

test('M9/S5：一次 advance 换场与拆段 save/digest 相同，旧场不继续派事件', () => {
  const inputs = [{ id: 'c', tick: 2, op: 'choose', args: ['wait'] }, { id: 'n', tick: 3, op: 'next' }];
  const scenes = cloneScenes();
  for (const id of ['daliang', 'yimen']) scenes[id].life = {
    actors: [], environment: { cadenceTicks: 8, schedule: [{ at: 5 }] },
  };
  const a = boot({ scenes }), b = boot({ scenes });
  const r = a.play.advance({ toTick: 12, inputs });
  b.play.advance({ toTick: 3, inputs });
  b.play.advance({ toTick: 12 });
  assert.equal(json(a.session.save()), json(b.session.save()));
  assert.equal(a.session.ledger.entries.at(-1).hash, b.session.ledger.entries.at(-1).hash);
  assert.equal(r.scene, 'yimen');
  assert.equal(a.play.life.state().sceneTick, 10);
  assert.deepEqual(Object.keys(r).sort(), ['from', 'to', 'tick', 'scene', 'processed', 'reactions', 'outcomes', 'events', 'ended', 'end', 'paused', 'view'].sort());
  assert.equal(r.from, 0);
  assert.equal(r.to, 12);
  assert.equal(r.tick, 12);
  assert.deepEqual(r.events, r.outcomes);
  assert.equal(a.play.lifeRead('daliang').scene, 'daliang');
  assert.equal(a.play.lifeRead('yimen').scene, 'yimen');
  assert.equal(a.play.lifeRead('daliang').title, QIFU_SCENES.daliang.title);
  assert.equal(a.play.life.state().sceneId, 'yimen', '看别场不切换当前场');
  const pulses = entries(a.session, 'world.pulse');
  assert.ok(pulses.some((e) => e.payload.scene === 'daliang' && e.payload.tick === 1));
  assert.ok(pulses.some((e) => e.payload.scene === 'yimen' && e.payload.tick === 3));
  assert.equal(pulses.some((e) => e.payload.scene === 'daliang' && e.payload.tick >= 3), false, '换场后旧场不继续派事件');
});

test('S2：没有life声明的场只索引真实感知，静候不会派生活事件', () => {
  const { session, play } = boot();
  play.advance({ toTick: 24 });
  assert.equal(entries(session, 'world.pulse').length, 0);
  assert.equal(entries(session, 'actor.act').length, 0);
  assert.deepEqual(play.lifeRead('daliang').policy.autonomy.people, []);
});

for (const [form, args] of [['array', ['wait']], ['string', 'wait'], ['id', { id: 'wait' }], ['option', { option: 'wait' }]]) {
  test(`S5：choose args ${form} 沿同一个公共入口执行`, () => {
    const { play } = boot();
    const r = play.advance({ toTick: 1, inputs: [{ id: 'choice', tick: 1, op: 'choose', args }] });
    assert.equal(r.processed.length, 1);
    assert.equal(play.view().done, true);
    assert.equal(play.state().acts.daliang.choice, 'wait');
  });
}

test('M9/M10/S2：非8倍数日程到期收幕；结束后无pulse，延后next接回进度', () => {
  const scenes = minimal({ actors: [], schedule: [{ at: 5 }], rules: [
    { when: { tick: 5 }, then: [['end', 'automatic']], text: '测试收幕' },
  ] });
  const { session, play } = boot({ scenes });
  const beforeRx = entries(session, 'user.react').length;
  const result = play.advance({ toTick: 5 });
  assert.equal(result.ended, true);
  assert.equal(result.end.outcome, 'automatic');
  assert.equal(play.state().acts.daliang.done, true);
  assert.equal(play.state().acts.daliang.outcome.end, 'automatic');
  assert.equal(play.view().done, true);
  assert.equal(entries(session, 'user.react').length, beforeRx);
  assert.ok(entries(session, 'world.pulse').some((e) => e.payload.tick === 5));
  const pulses = entries(session, 'world.pulse').length;
  const r = play.advance({ toTick: 6, inputs: [{ id: 'later', tick: 8, op: 'next' }] });
  assert.equal(r.ended, true);
  assert.equal(entries(session, 'world.pulse').length, pulses);
  play.advance({ toTick: 8 });
  assert.equal(play.view().act, 'yimen');
  assert.equal(play.life.state().ended, false);
  assert.equal(entries(session, 'user.react').length, beforeRx);
});

test('M10：演员自行完成后act.done/outcome可进入下一幕，没有伪造玩家反馈', () => {
  const scenes = minimal({ life: { verbs: ['say'] }, rules: [
    { when: { person: 'xinling', acted: true }, then: [['end', 'actor-finished']], text: '演员自行收幕' },
  ] });
  const { session, play } = boot({ scenes, dir: 'B', minds: { xinling: actor('xinling') } });
  const before = entries(session, 'user.react').length;
  const r = play.advance({ toTick: 4 });
  const act = actsBy(session, 'xinling', 'say')[0];
  assertOwnReaction(session, act);
  assert.equal(r.ended, true);
  assert.equal(r.end.seq, act.seq);
  assert.equal(r.end.from, 'xinling');
  assert.equal(play.state().acts.daliang.done, true);
  assert.equal(play.state().acts.daliang.outcome.by, 'actor:xinling');
  assert.equal(play.state().acts.daliang.outcome.seq, act.seq);
  assert.equal(play.state().acts.daliang.outcome.end, 'actor-finished');
  assert.equal(entries(session, 'user.react').length, before);
  const pulses = entries(session, 'world.pulse').length;
  play.advance({ toTick: 20 });
  assert.equal(entries(session, 'world.pulse').length, pulses);
  play.next();
  assert.equal(play.view().act, 'yimen');
  assert.equal(play.life.state().ended, false);
  assert.equal(entries(session, 'user.react').length, before);
});

// 真实取符之夜：不手派环境/演员事件、不改缓存policy、不注入位置。
function night({ dir = 'B', choice = 'back', seed = 't56', scenes = QIFU_SCENES } = {}) {
  const ctx = boot({ dir, seed, scenes });
  ctx.play.choose('yi'); ctx.play.next(); ctx.play.choose(choice); ctx.play.next();
  assert.equal(ctx.play.view().act, 'night');
  assert.equal(ctx.play.view().night.pos, 0);
  return ctx;
}
function door(play) {
  for (const id of ['token_b', 'wait', 'step', 'step', 'step']) play.choose(id);
  assert.equal(play.view().night.pos, 3);
  assert.equal(play.view().night.step, 5);
  assert.equal(play.view().done, false);
}
const actsBy = (session, person, verb) => entries(session, 'actor.act').filter((e) => e.payload.person === person && (!verb || e.payload.verb === verb));

test('night：单导高托付门边只递一次；物权随真实动作改变', () => {
  const { session, play } = night();
  door(play);
  play.advance({ toTick: 10 });
  assert.equal(actsBy(session, 'ruji', 'give').length, 1);
  assertOwnReaction(session, actsBy(session, 'ruji', 'give')[0]);
  assert.equal(play.state().flags.nightHand, true);
  assert.equal(play.state().flags.fuOwner, 'player');
  assert.equal(play.state().flags.fuWithRuji, false);
  assert.notEqual(play.state().flags.nightAsk, true);
  play.advance({ toTick: 24 });
  assert.equal(actsBy(session, 'ruji', 'give').length, 1);
  assert.equal(play.lifeRead('night').scene, 'night');
});

function assertGuardChain(session, play, ask, person, tick) {
  const actions = actsBy(session, person);
  assert.equal(actions.length, 1, `${person} 必须只有一次真实执行`);
  const act = actions[0];
  if (tick === null) {
    assert.equal(act.payload.tick, ask.payload.tick + 1, `${person} 在收到问的下一拍才执行`);
    assert.ok(act.payload.tick <= 10, `${person} 不拖到本次 advance 之外`);
  } else {
    assert.equal(act.payload.tick, tick);
  }
  const react = assertOwnReaction(session, act);
  assert.deepEqual(react.cause, [ask.seq]);
  const fragment = play.lifeTrace(react.seq);
  assert.ok(fragment);
  assert.deepEqual(fragment.cause, [ask.seq]);
  assert.equal(fragment.person, person);
}

test('night/M6：早问第3拍只有乙回应，甲没有听到该问的反应', () => {
  const { session, play } = night({ choice: 'wait' });
  door(play);
  play.advance({ toTick: 10 });
  const asks = actsBy(session, 'ruji', 'say');
  assert.equal(asks.length, 1);
  assertOwnReaction(session, asks[0]);
  assert.equal(actsBy(session, 'ruji', 'give').length, 0);
  assert.equal(play.state().flags.nightAsk, true);
  assert.notEqual(play.state().flags.nightHand, true);
  assertGuardChain(session, play, asks[0], 'guard_b', null);
  assert.equal(actsBy(session, 'guard_a').length, 0);
  assert.equal(entries(session, 'actor.react').some((e) => e.from === 'actor:guard_a' && e.cause.includes(asks[0].seq)), false);
});

test('night/M6：晚问第24拍先排收件，第25拍甲乙各自从低问反应再行动', () => {
  const { session, play } = night({ choice: 'wait', seed: 't56-final' });
  play.advance({ toTick: 16 });
  door(play);
  play.advance({ toTick: 24 });
  const asks = actsBy(session, 'ruji', 'say');
  assert.equal(asks.length, 1);
  assert.equal(asks[0].payload.tick, 24);
  assert.equal(actsBy(session, 'guard_a').length, 0, '同拍巡查不能抢先执行');
  assert.equal(actsBy(session, 'guard_b').length, 0);
  assert.deepEqual(play.life.state().queue.filter((q) => q.actSeq === asks[0].seq).map((q) => q.from).sort(), ['guard_a', 'guard_b']);
  play.advance({ toTick: 25 });
  for (const id of ['guard_a', 'guard_b']) assertGuardChain(session, play, asks[0], id, 25);
  assert.notEqual(play.state().flags.nightHand, true);
});

for (const choice of ['back', 'wait']) {
  test(`night：陆导${choice}未独立授予动作，等拍只想不执行`, () => {
    const { session, play } = night({ dir: 'A', choice });
    door(play); play.advance({ toTick: 10 });
    assert.equal(entries(session, 'actor.act').length, 0);
    assert.notEqual(play.state().flags.nightHand, true);
    assert.notEqual(play.state().flags.nightAsk, true);
    assert.equal(play.lifeRead('night').policy.waitForPlayer, true);
    assert.equal(play.lifeRead('night').policy.autonomy.verbs.includes('give'), false);
  });
}

test('night/S2/M10：宫门外零动作；巡灯8/16/24/32独立于步数并自动收幕', () => {
  const { session, play } = night();
  const step = play.view().night.step;
  for (const [tick, pos] of [[8, 1], [16, 2], [24, 3], [32, 4]]) {
    play.advance({ toTick: tick });
    assert.equal(play.state().flags.nightLanternPos, pos);
    assert.equal(play.view().night.step, step);
    assert.equal(play.view().night.pos, 0);
  }
  assert.equal(entries(session, 'actor.act').length, 0);
  assert.notEqual(play.state().flags.nightBlock, true);
  assert.equal(play.view().done, true);
  const count = entries(session, 'user.react').length;
  const pulses = entries(session, 'world.pulse').length;
  play.advance({ toTick: 40 });
  assert.equal(entries(session, 'world.pulse').length, pulses);
  assert.equal(entries(session, 'user.react').length, count);
  play.next();
  assert.equal(play.view().act, 'ye');
});

for (const [name, patch, expected] of [
  ['错物权', { owner: 'someone-else', withRuji: true }, 0],
  ['兵符不在如姬手中', { owner: 'ruji', withRuji: false }, 0],
  ['真实玩家托付恰好.45', { trust: .45 }, 1],
  ['真实玩家托付低于.45', { trust: .449 }, 0],
]) {
  test(`night：${name}边界`, () => {
    const { session, play } = night({ seed: 't56-gates' });
    door(play); play.advance({ toTick: 7 });
    // 测试状态注入：不是玩家动作；第8拍的所有权初始化不覆盖既有owner。
    if (patch.owner) Object.assign(play.state().flags, { fuOwner: patch.owner, fuWithRuji: patch.withRuji });
    if (patch.trust != null) session.minds.ruji.state.trust['actor:player'] = patch.trust;
    play.advance({ toTick: 10 });
    assert.equal(actsBy(session, 'ruji', 'give').length, expected);
    assert.equal(play.state().flags.nightHand === true, expected === 1);
    if (expected) assert.equal(play.state().flags.fuOwner, 'player');
  });
}

test('night：场景不声明give时，正式导演计划不会授予递符', () => {
  const scenes = cloneScenes();
  scenes.night.life.verbs = ['say', 'go'];
  const { session, play } = night({ scenes, seed: 't56-gates' });
  door(play); play.advance({ toTick: 10 });
  assert.equal(play.lifeRead('night').policy.autonomy.verbs.includes('give'), false);
  assert.equal(actsBy(session, 'ruji', 'give').length, 0);
  assert.notEqual(play.state().flags.nightHand, true);
});
