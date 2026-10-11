import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldStore } from '../server/store.ts';
import { speak, proposeMechanism } from '../server/gateway.ts';
import { createWorld } from '../src/core/seed.ts';
import { evaluateMind } from '../src/core/mind.ts';
import { applyIntent, replayEvents, checkConsistency } from '../src/core/world.ts';
import { createVerificationMechanism, executeVerification, installMechanism } from '../src/core/mechanisms.ts';
import { preparePresentation, recordCall, renewBudget } from '../src/core/presentation.ts';
import { continueImport, resetWorld } from '../src/core/lifecycle.ts';
import { NightGame } from '../src/game/night.ts';
import { recordNightRun, resolveNight, replayNight } from '../src/core/night-run.ts';
import type { NightView } from '../src/presentation/contracts.ts';

// Play the night for real, reading the guards the way a player has to. Fixed tick counts
// would encode one lucky timing and quietly stop meaning anything the next time the tuning
// moves; waiting on where the guards actually are is the thing the scene asks of a player.
function playNightGame(): NightGame {
  const game = new NightGame(() => {}, () => {});
  const step = () => game.tick(1 / 30);
  const until = (key: string, done: (v: NightView) => boolean) => {
    game.key(key, true);
    for (let n = 0; n < 30 * 90 && !done(game.view) && !game.view.finished; n++) step();
    game.key(key, false);
  };
  const wait = (done: (v: NightView) => boolean) => {
    for (let n = 0; n < 30 * 90 && !done(game.view) && !game.view.finished; n++) step();
  };
  // A guard facing 0 walks +z and one facing PI walks -z, so "walking away" is angle < 1.
  const aAway = (v: NightView) => v.guards[0].z > -2.2 && v.guards[0].angle < 1;
  const bAway = (v: NightView) => v.guards[1].z > -0.6 && v.guards[1].angle < 1;
  game.crouching = true;
  until('a', v => v.x <= -5.4);
  until('w', v => v.z <= -4.3);
  wait(aAway);
  until('d', v => v.x >= 2.5);
  wait(bAway);
  until('d', v => v.x >= 5.2);
  until('s', v => v.inReach);
  game.grab(true);
  wait(v => v.obtained);
  game.grab(false);
  until('w', v => v.z <= -4.3);
  until('a', v => v.x <= 2.5);
  wait(aAway);
  until('a', v => v.x <= -5.4);
  until('s', v => v.finished);
  return game;
}

const handoff = { actorId: 'player', targetId: 'keeper-suspicious', verb: 'give', itemId: 'seal', choice: 'seal', amount: 2, workId: 'siege', sceneId: 'granary' } as const;
test('gateway records actual usage, rejects unavailable identity, caches, and never drops failed attempts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dw-gateway-')), store = new WorldStore(dir);
  let calls = 0, mode = 'valid';
  const inputs: unknown[] = [];
  const server = createServer(async (req, res) => {
    calls++;
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    inputs.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'failure') { res.writeHead(503).end('{}'); return; }
    const content = mode === 'invalid' ? 'not-json' : mode === 'private' ? JSON.stringify({ text: '如姬明日会取符。', entityIds: ['ruji'] }) : mode === 'mechanism' ? JSON.stringify({ name: '凭页共验', fields: ['discrepancy', 'sourceVerified'], rules: [{ field: 'discrepancy', operator: 'gt', value: 0, action: 'verify-seal' }, { field: 'sourceVerified', operator: 'eq', value: true, action: 'compare-ledger' }, { field: 'sourceVerified', operator: 'eq', value: true, action: 'share-receipt' }] }) : JSON.stringify({ text: '先把印信摆在眼前，我再对账。', entityIds: ['keeper-suspicious'] });
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 123, completion_tokens: 45 } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const saved = { url: process.env.MODEL_GATEWAY_URL, input: process.env.MODEL_INPUT_PRICE, output: process.env.MODEL_OUTPUT_PRICE };
  process.env.MODEL_GATEWAY_URL = `http://127.0.0.1:${addr.port}`; process.env.MODEL_INPUT_PRICE = '1'; process.env.MODEL_OUTPUT_PRICE = '2';
  try {
    let s = createWorld(42); const trace = evaluateMind(s, 'keeper-suspicious', { topic: '粮仓', discrepancy: 2 });
    const first = await speak(store, 'session', s, 'keeper-suspicious', '先核印信', trace);
    assert.equal(first.source, 'live'); assert.equal(first.inputTokens, 123); assert.equal(first.outputTokens, 45); assert.equal(first.cost, .000213);
    const cached = await speak(store, 'session', s, 'keeper-suspicious', '先核印信', trace);
    assert.equal(cached.source, 'recorded'); assert.equal(cached.attempted, false); assert.equal(calls, 1);
    mode = 'private'; const privateReply = await speak(store, 'session', s, 'keeper-suspicious', '看看欠额', trace);
    assert.equal(privateReply.accepted, false); assert.equal(privateReply.source, 'rules'); assert.equal(privateReply.inputTokens, 123);
    mode = 'invalid'; const bad = await speak(store, 'session', s, 'keeper-suspicious', '对账', trace);
    assert.equal(bad.attempted, true); assert.equal(bad.usageKnown, true); assert.equal(bad.accepted, false);
    mode = 'failure'; const failed = await speak(store, 'session', s, 'keeper-suspicious', '再看看', trace);
    assert.equal(failed.usageKnown, false); assert.equal(failed.attempted, true);
    s = recordCall(s, { kind: 'dialogue', ...failed }); assert.equal(s.budget.dialogue, 1);
    for (let i = 0; i < 5; i++) s = applyIntent(s, handoff).state;
    mode = 'mechanism'; const proposed = await proposeMechanism(store, 'session', s);
    assert.ok(proposed.declaration); assert.equal(proposed.response.source, 'live');
    const m = createVerificationMechanism(s, proposed.declaration);
    assert.ok(m.audit.every(a => a.passed)); assert.equal(m.name, '凭页共验');
    assert.equal(installMechanism(s, m).ok, true);
    const request = JSON.stringify(inputs.at(-1)); assert.ok(request.includes('coordinationSteps')); assert.ok(!request.includes('先核印信'));
    assert.equal(store.recordings('session').length, 6);
  } finally {
    for (const [key, value] of Object.entries({ MODEL_GATEWAY_URL: saved.url, MODEL_INPUT_PRICE: saved.input, MODEL_OUTPUT_PRICE: saved.output })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await new Promise<void>(resolve => server.close(() => resolve())); store.close(); rmSync(dir, { recursive: true });
  }
});
test('physical night inputs survive save/replay and arbitrary success declarations fail', () => {
  const initial = createWorld(42);
  const game = playNightGame();
  assert.equal(game.view.finished, true); assert.equal(game.view.detected, false); assert.equal(game.view.obtained, true);
  assert.equal(game.view.spotted, false, '这一条路线应当一路无人看清');
  assert.deepEqual(replayNight(game.frames()).view, game.view);
  const s = recordNightRun(initial, 'night', game.frames()).state;
  assert.deepEqual(replayEvents(initial, s.events), s);
  const resolved = resolveNight(s, 'night', game.frames()); assert.equal(resolved.ok, true, resolved.message); assert.equal(resolved.state.story.sealObtained, true);
  assert.deepEqual(replayEvents(initial, resolved.state.events), resolved.state);
  assert.equal(resolveNight(initial, 'night', []).ok, false);
  assert.equal(applyIntent(initial, { verb: 'escort', actorId: 'player', targetId: 'ruji', itemId: 'seal', choice: 'escape', amount: 1, sceneId: 'night', workId: 'night' }).ok, false);
});
test('siege relief and army selection preserve real resource totals and primary-source timing', () => {
  const initial = createWorld(42);
  const distributed = applyIntent(initial, { actorId: 'player', verb: 'give', targetId: 'pingyuan', itemId: 'pledge', choice: 'distribute', sceneId: 'siege-square', workId: 'siege' });
  assert.equal(distributed.ok, true, distributed.message); assert.equal(distributed.state.resources.pingyuan.money, 0); assert.equal(distributed.state.resources.citizen.money, 20);
  assert.deepEqual(replayEvents(initial, distributed.state.events), distributed.state);
  assert.equal(applyIntent(distributed.state, { actorId: 'player', verb: 'give', targetId: 'pingyuan', itemId: 'pledge', choice: 'distribute', sceneId: 'siege-square', workId: 'siege' }).ok, false);
  let s = applyIntent(initial, { actorId: 'player', verb: 'persuade', targetId: 'xinling', choice: 'petition', sceneId: 'court', workId: 'qiefu' }).state;
  s = applyIntent(s, { actorId: 'player', verb: 'say', targetId: 'houying', choice: 'return', sceneId: 'gate', workId: 'qiefu' }).state;
  const game = playNightGame();
  s = resolveNight(s, 'qiefu', game.frames()).state;
  const alive = applyIntent(s, { actorId: 'player', verb: 'verify', targetId: 'jinbi', itemId: 'seal', choice: 'verify', sceneId: 'camp', workId: 'qiefu' });
  assert.equal(alive.ok, true, alive.message); assert.equal(alive.state.story.ending, 'counterfactual'); assert.equal(alive.state.story.jinbiFate, 'alive');
  assert.ok(alive.event!.traces.some(t => t.actorId === 'jinbi' && t.action.startsWith('承担')));
  assert.deepEqual(replayEvents(initial, alive.state.events), alive.state);
  const unchanged = structuredClone(s); unchanged.entities.jinbi.temperament!.patience = .1;
  const noChange = applyIntent(unchanged, { actorId: 'player', verb: 'verify', targetId: 'jinbi', itemId: 'seal', choice: 'verify', sceneId: 'camp', workId: 'qiefu' });
  assert.ok(noChange.state.claims.some(c => c.predicate === 'work.siege' && c.value === 'still-besieged'));
  const final = applyIntent(s, { actorId: 'player', verb: 'command', targetId: 'zhuhai', itemId: 'hammer', choice: 'force', sceneId: 'camp', workId: 'qiefu' });
  assert.equal(final.ok, true, final.message); assert.equal(final.state.story.ending, 'historical');
  assert.equal(final.state.resources.xinling.soldiers, 80000); assert.equal(final.state.resources.wei.soldiers, 20000); assert.equal(final.state.resources.jinbi.soldiers, 0);
  assert.equal(checkConsistency(final.state).ok, true); assert.deepEqual(replayEvents(initial, final.state.events), final.state);
  assert.ok(final.state.claims.some(c => c.predicate === 'work.farewell' && c.text.includes('不等待')));
});
test('safe alternate declaration is measured; incomplete, executable and stale candidates are never installed', () => {
  let s = createWorld(42); for (let i = 0; i < 5; i++) s = applyIntent(s, handoff).state;
  const unsafe = createVerificationMechanism(s, { name: 'bad', fields: ['discrepancy'], rules: [{ field: 'discrepancy', operator: 'gt', value: 0, action: 'fetch' }] });
  assert.equal(installMechanism(s, unsafe).ok, false);
  const incomplete = createVerificationMechanism(s, { name: '只核印', fields: ['discrepancy'], rules: [{ field: 'discrepancy', operator: 'gt', value: 0, action: 'verify-seal' }] });
  assert.equal(installMechanism(s, incomplete).ok, false);
  const m = createVerificationMechanism(s);
  assert.equal(executeVerification(m, { discrepancy: 2, sourceVerified: false, coordinationSteps: 5 }).length, 0);
  assert.equal(executeVerification(m, { discrepancy: 2, sourceVerified: true, coordinationSteps: 5 }).length, 3);
  assert.equal(installMechanism(applyIntent(s, handoff).state, m).ok, false);
});
test('presentation, model accounting, hourly renewal, mechanism and reset are deterministic', () => {
  const initial = createWorld(42); let s = preparePresentation(initial, 'siege', 'granary', 'normal').state;
  s = recordCall(s, { kind: 'dialogue', model: 'fixture', inputTokens: 4, outputTokens: 3, latencyMs: 2, cost: 0, cached: false, source: 'rules', attempted: true, usageKnown: false });
  s = renewBudget(s, 1000); assert.equal(s.budget.dialogue, 0);
  for (let i = 0; i < 5; i++) s = applyIntent(s, handoff).state;
  s = installMechanism(s, createVerificationMechanism(s)).state;
  assert.deepEqual(replayEvents(initial, s.events), s);
  const reset = resetWorld(s); assert.equal(checkConsistency(reset).ok, true); assert.equal(reset.claims.length, initial.claims.length);
  assert.deepEqual(replayEvents(s, [reset.events[0]]), reset);
});
test('import retains immutable evidence versions and provides a replayable monotonic storage anchor', () => {
  const initial = createWorld(42); const imported = applyIntent(initial, handoff).state;
  let local = createWorld(42); for (let i = 0; i < 6; i++) local = applyIntent(local, handoff).state;
  const result = continueImport(local, imported); assert.equal(result.ok, true);
  assert.ok(result.state.version > local.version); assert.deepEqual(result.state.events[0], imported.events[0]);
  assert.equal(checkConsistency(result.state).ok, true);
  assert.deepEqual(replayEvents(initial, result.state.events), result.state);
});
