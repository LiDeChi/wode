import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld } from '../src/core/seed.ts';
import { applyIntent, getMind } from '../src/core/world.ts';
import { createVerificationMechanism, installMechanism } from '../src/core/mechanisms.ts';
import { speak, proposeMechanism } from '../server/gateway.ts';
import { WorldStore } from '../server/store.ts';

const dir = mkdtempSync(join(tmpdir(), 'dw-live-probe-')), store = new WorldStore(dir);
try {
  let state = createWorld(42);
  for (let n = 0; n < 5; n++) state = applyIntent(state, { verb: 'give', actorId: 'player', targetId: 'keeper-suspicious', itemId: n % 2 ? 'letter' : 'seal', choice: n % 2 ? 'letter' : 'seal', amount: 2, workId: 'siege', sceneId: 'granary' }).state;
  const speech = await speak(store, 'live-probe', state, 'keeper-suspicious', '这两袋粮已经送给守城的人，先把副页并读好吗？', getMind(state, 'keeper-suspicious'));
  const proposed = await proposeMechanism(store, 'live-probe', state);
  const candidate = proposed.declaration ? createVerificationMechanism(state, proposed.declaration) : null;
  const installed = candidate ? installMechanism(state, candidate).ok : false;
  const result = { timestamp: new Date().toISOString(), speech, modification: proposed.response, declaration: proposed.declaration, audit: candidate?.audit, coordination: candidate ? { before: candidate.coordinationBefore, after: candidate.coordinationAfter } : null, installed };
  writeFileSync('artifacts/live-model-result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ speech: { source: speech.source, input: speech.inputTokens, output: speech.outputTokens, ms: speech.latencyMs, note: speech.note }, modification: { source: proposed.response.source, input: proposed.response.inputTokens, output: proposed.response.outputTokens, ms: proposed.response.latencyMs, note: proposed.response.note }, installed }));
} finally { store.close(); rmSync(dir, { recursive: true }); }
