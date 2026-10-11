import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Intent, WorldState, Preferences, Evidence, Claim, Tier } from '../src/core/types.ts';
import { createWorld } from '../src/core/seed.ts';
import { applyIntent, getMind, checkConsistency, changePreferences, chooseDirectorCast, proposeReversal, approveReversal, advanceClock, citeClaims, getGrant } from '../src/core/world.ts';
import { createVerificationMechanism, installMechanism, rollbackMechanism, runSwapBenchmark, buildModificationRequest } from '../src/core/mechanisms.ts';
import { speak, proposeMechanism, gatewayConfiguration } from './gateway.ts';
import { WorldStore } from './store.ts';
import { preparePresentation, recordCall, renewBudget } from '../src/core/presentation.ts';
import { sourceEvidence } from '../src/data/catalog.ts';
import { resetWorld, continueImport } from '../src/core/lifecycle.ts';
import { recordNightRun, resolveNight } from '../src/core/night-run.ts';

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2_000_000) throw new Error('请求太大');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求格式不对');
  return value;
}
function session(req: IncomingMessage, res: ServerResponse): string {
  const match = req.headers.cookie?.match(/(?:^|;\s*)dw_session=([a-f0-9-]{36})(?:;|$)/);
  if (match) return match[1];
  const id = randomUUID();
  res.setHeader('Set-Cookie', `dw_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
  return id;
}
function validateImport(value: unknown): value is WorldState {
  if (!value || typeof value !== 'object') return false;
  const s = value as WorldState;
  if (s.schemaVersion !== 1 || !Number.isInteger(s.version) || s.version < 1 || !Number.isInteger(s.day) || s.day < 0 || s.day > 365 || !s.entities || !s.story || !s.preferences || !s.budget || !s.resources || !s.relationships) return false;
  if (![s.claims, s.events, s.experiences, s.decisions, s.reversals, s.mechanisms, s.causeChain, s.seenWorks, s.acknowledgments].every(Array.isArray)) return false;
  if (!s.entities.player || !s.entities.director || !s.entities.mentor || !Array.isArray(s.story.choices)) return false;
  if (s.claims.some(c => !c || typeof c.id !== 'string' || !s.entities[c.subject] || !Array.isArray(c.holders) || c.holders.some(id => !s.entities[id]) || !Array.isArray(c.evidence) || !Array.isArray(c.dependencies) || !c.endorsements || !Array.isArray(c.citations))) return false;
  if (Object.values(s.resources).some(r => !r || ['grain', 'money', 'soldiers', 'favor'].some(k => typeof r[k as keyof typeof r] !== 'number' || !Number.isFinite(r[k as keyof typeof r]) || r[k as keyof typeof r] < 0))) return false;
  if (s.mechanisms.some(m => m.installed && !m.audit?.every(a => a.passed))) return false;
  try { return checkConsistency(s).ok; } catch { return false; }
}
const workIds = new Set(['prologue', 'qiefu', 'siege', 'night', 'studio', 'replay']);

export function createApi(store: WorldStore) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path === '/health' || path === '/healthz') { send(res, 200, { ok: true, app: 'digital-world-qiefu' }); return true; }
    if (!path.startsWith('/api/')) return false;
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) throw new Error('origin'); }
      catch { send(res, 403, { error: '这个请求不是从你的剧场发出的。' }); return true; }
    }
    const id = session(req, res);
    let state = store.read(id) || store.create(id, { ...createWorld(42), lastSeen: Date.now() });
    // The hourly renewal just below is server housekeeping, not a competing tab: it
    // bumps the version, so the stale-page check has to compare against the version
    // the client actually holds, captured before renewal runs.
    const clientVersion = state.version;
    try {
      const now = Date.now();
      if (now - state.budget.hourStarted >= 3_600_000) {
        const renewed = renewBudget(state, now);
        renewed.lastSeen = state.lastSeen;
        store.save(id, renewed, state.version);
        state = store.read(id)!;
      }
      if (req.method === 'GET') {
        if (path === '/api/state') {
          const elapsed = Math.min(365 - state.day, Math.floor((Date.now() - state.lastSeen) / 86_400_000));
          if (state.lastSeen > 0 && elapsed > 0) {
            const next = advanceClock(state, elapsed);
            next.lastSeen = Date.now();
            store.save(id, next, state.version);
            state = store.read(id)!;
          }
          send(res, 200, { state, gateway: { configured: !!gatewayConfiguration().url, mode: gatewayConfiguration().url ? 'live-ready' : 'recorded' } });
        } else if (path === '/api/checks') send(res, 200, { consistency: checkConsistency(state), benchmark: runSwapBenchmark(state), modification: buildModificationRequest(state) });
        else if (path === '/api/export') send(res, 200, { format: 'digital-world-v1', state, recordings: store.recordings(id) });
        else send(res, 404, { error: '没有这个入口。' });
        return true;
      }
      if (req.method !== 'POST') { send(res, 405, { error: '请用剧场中的操作入口。' }); return true; }
      const data = await body(req);
      if (data.baseVersion !== clientVersion) { send(res, 409, { error: '另一个页面已推进这场戏。已取回最新进度，请重做这一步。', state }); return true; }
      const priorVersion = state.version;
      let next = structuredClone(state);
      let message = '';
      let extra: Record<string, unknown> = {};
      if (path === '/api/night-run') {
        const work = data.workId as 'qiefu' | 'night';
        const result = data.finish === true ? resolveNight(state, work, data.frames, data.abandoned === true) : recordNightRun(state, work, data.frames);
        if (!result.ok) { send(res, 422, { ...result, error: result.message }); return true; }
        next = result.state; message = result.message;
      } else if (path === '/api/intent') {
        const intent = data.intent as Intent;
        if (!intent || typeof intent !== 'object' || intent.actorId !== 'player' || !workIds.has(intent.workId) || typeof intent.sceneId !== 'string' || (intent.text !== undefined && (typeof intent.text !== 'string' || intent.text.length > 500))) { send(res, 400, { error: '这个动作没有被授予。', state }); return true; }
        const result = applyIntent(state, intent);
        if (!result.ok) { send(res, 422, { ...result, error: result.error || result.message }); return true; }
        next = result.state;
        message = result.message;
        extra = { event: result.event, pendingReversal: result.pendingReversal };
      } else if (path === '/api/preferences') {
        const p = data.preferences as Partial<Preferences>;
        if (!p || Object.keys(p).some(k => !['patience', 'freedom', 'detail', 'surprises'].includes(k)) || (p.patience && !['now', 'later'].includes(p.patience)) || (p.freedom && !['crafted', 'open'].includes(p.freedom)) || (p.detail && !['detailed', 'normal', 'brief'].includes(p.detail)) || (p.surprises !== undefined && typeof p.surprises !== 'boolean')) { send(res, 400, { error: '请从笔记里的选项更正。' }); return true; }
        next = changePreferences(state, p);
        message = '导师已把更正写进笔记。';
      } else if (path === '/api/presentation') {
        const work = data.workId as WorldState['seenWorks'][number];
        const sceneId = String(data.sceneId || 'court');
        if (!workIds.has(work)) { send(res, 400, { error: '没有这部作品。' }); return true; }
        const tier = (data.tier || state.preferences.detail) as Tier;
        if (!['detailed', 'normal', 'brief'].includes(tier)) { send(res, 400, { error: '请选择一个演出档位。' }); return true; }
        const prepared = preparePresentation(state, work, sceneId, tier);
        if (!prepared.ok) { send(res, 422, { ...prepared, error: prepared.message }); return true; }
        next = prepared.state;
        message = tier === 'brief' ? prepared.message : '';
      } else if (path === '/api/cast') {
        const result = chooseDirectorCast(state, String(data.actorId));
        if (!result.ok) { send(res, 422, { ...result, error: result.error || result.message }); return true; }
        next = result.state;
        message = result.message;
      } else if (path === '/api/mechanism') {
        if (data.operation === 'rollback') { next = rollbackMechanism(state, String(data.id)); message = '已换回旧的核验办法。'; }
        else if (data.operation === 'recorded') {
          const result = installMechanism(state, createVerificationMechanism(state));
          if (!result.ok) { send(res, 422, { ...result, error: result.message }); return true; }
          next = result.state; message = `${result.message}来源为内置有限提案，未发出模型请求。`;
        } else {
          const baseline = createVerificationMechanism(state);
          if (!baseline.audit.every(a => a.passed)) { send(res, 422, { error: '请先留下五次真实粮仓交接，再试作。', state }); return true; }
          const proposal = await proposeMechanism(store, id, state);
          const mechanism = createVerificationMechanism(state, proposal.declaration);
          const result = proposal.response.attempted && !proposal.declaration ? { ok: false, state, message: '模型提案未通过结构核验，未安装；这次调用已经记账。' } : installMechanism(state, mechanism);
          next = recordCall(result.state, { kind: 'modification', ...proposal.response });
          message = result.ok ? `${result.message}${proposal.response.source === 'live' ? '提案来自现场模型。' : '使用已录制或内置的有限提案。'}` : result.message;
          extra = { mechanism: result.ok ? mechanism : undefined, rejectedCandidate: result.ok ? undefined : mechanism, response: proposal.response };
        }
      } else if (path === '/api/reversal') {
        if (data.operation === 'approve') {
          const result = approveReversal(state, String(data.id), 'director');
          if (!result.ok) { send(res, 422, { ...result, error: result.error || result.message }); return true; }
          next = result.state; message = result.message;
        } else {
          const old = state.claims.find(c => c.id === 'grain-debt' && c.status === 'active');
          if (!old || !state.events.some(e => e.intent.sceneId === 'granary' && e.intent.choice)) { send(res, 422, { error: '请先在粮仓完成交接，再把原账册摆到分镜桌上。', state }); return true; }
          const verified = applyIntent(state, { verb: 'verify', actorId: 'player', targetId: 'keeper-suspicious', sceneId: 'granary', workId: 'siege' });
          if (!verified.ok) { send(res, 422, { ...verified, error: verified.message }); return true; }
          const evidence: Evidence[] = [sourceEvidence('granary-ledger', 0.9)];
          const proposed: Omit<Claim, 'id' | 'version'> = { ...old, value: 0, text: '核验副页后：旧的两袋已经送到守城人，首页重复计为未归。', holders: ['player', 'borrower', 'keeper-suspicious'], dependencies: [], citations: [], endorsements: { player: 1, borrower: 1, 'keeper-suspicious': 1 }, evidence, status: 'active', channel: 'public', createdBy: 'studio', supersedes: old.id };
          const result = proposeReversal(verified.state, old.id, evidence, '仓簿副页记下了同两袋的交付，首页没有扣除。旧共识依据首页反复引用，错把漏记当成欠粮。', proposed);
          if (!result.ok && !result.pendingReversal) { send(res, 422, { ...result, error: result.error || result.message }); return true; }
          next = result.state; message = result.message; extra = { pendingReversal: result.pendingReversal };
        }
      } else if (path === '/api/clock') {
        const days = Number(data.days);
        if (!Number.isInteger(days) || days < 1 || days > 365) { send(res, 400, { error: '这一季只能推进 1 到 365 天。' }); return true; }
        next = advanceClock(state, days); message = '时间过去了，旧记忆仍在。';
      } else if (path === '/api/speech') {
        const actorId = String(data.actorId || '');
        const text = String(data.text || '').slice(0, 500);
        const grant = getGrant(String(data.sceneId || 'granary'));
        if (!grant.actorIds.includes(actorId) || grant.language !== 'free' || !text.trim()) { send(res, 422, { error: '这一场尚未授予自由说话，先递一件东西。', state }); return true; }
        const spoken = applyIntent(state, { verb: 'say', actorId: 'player', targetId: actorId, text, sceneId: grant.sceneId, workId: (data.workId || 'siege') as Intent['workId'] });
        if (!spoken.ok) { send(res, 422, { ...spoken, error: spoken.error || spoken.message }); return true; }
        next = spoken.state;
        const response = await speak(store, id, state, actorId, text, getMind(spoken.state, actorId));
        next = recordCall(next, { kind: 'dialogue', ...response });
        message = response.text; extra = { response };
      } else if (path === '/api/import') {
        const imported = (data.bundle as { state?: unknown })?.state;
        if (!validateImport(imported)) { send(res, 422, { error: '这份记录不完整或版本不支持。原进度仍在。', state }); return true; }
        const continued = continueImport(state, imported);
        if (!continued.ok) { send(res, 422, { ...continued, error: continued.message }); return true; }
        next = continued.state; message = continued.message;
      } else if (path === '/api/reset') {
        next = resetWorld(state); message = '新的演出已经备好。';
      } else { send(res, 404, { error: '没有这个入口。' }); return true; }
      if (next.version <= priorVersion) { send(res, 200, { state, message, ...extra }); return true; }
      next.lastSeen = Date.now();
      if (!store.save(id, next, priorVersion)) { send(res, 409, { error: '另一个页面已经推进，已取回最新记录。', state: store.read(id) }); return true; }
      send(res, 200, { state: next, message, ...extra });
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : '这一步没有写入。请重试。', state });
    }
    return true;
  };
}
