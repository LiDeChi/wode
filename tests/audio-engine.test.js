/**
 * 声音引擎契约测试 —— 只按 docs/AUDIO.md（§2 接口、§3 路由与预算、§7 验收）
 * 与 tools/audio/README.md 的「Provider 接入说明（固定接口）」写，不读实现。
 *
 * 测试假设（README 未写死、engine 落地前需要对齐的三处，写在这里方便一处改完）：
 * 1. createAudioEngine({ providers }) 收「适配器实例数组」（README：Adapter 是对象或类实例，
 *    每个能力可注册任意多个 Provider）。若实现改成 id→adapter 的映射，只需要改这里的 harness。
 * 2. engine.mjs 与 providers/mock.mjs 都还没落地。这里用一个完全按 README 固定 Adapter 接口
 *    写的测试内 MockProvider（确定性产物 + 可编排价格/失败/重试），不 import 还不存在的模块，
 *    这样 engine.mjs 一落地测试就能跑；e2e 时想换成真 MockProvider，只换 makeProvider 一处。
 * 3. config 直接传对象（budget / unknownPriceCeiling / policy / provider.priceOverride）。
 *    每个测试用独立临时目录（env DW_AUDIO_HOME 与 home 都指过去）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createAudioEngine } from '../tools/audio/engine.mjs';
import { httpError } from '../tools/audio/errors.mjs';

const FAKE_KEY = 'sk-TESTKEY-DONOTLOG-9f3a2b';

// ---------------------------------------------------------------- 测试用假件

/** 完全按 README 固定接口写的 MockProvider：确定性短 wav，可编排价格、失败与重试。 */
function makeProvider(opts = {}) {
  const cfg = {
    id: 'mock',
    local: true,
    quality: 'local',
    capabilities: ['speech', 'music', 'sfx', 'clone'],
    price: 0, // 数值 = 已知价格；null = 价格未知
    priceSource: 'test',
    failTimes: 0, // 前几次 run 抛 cfg.error
    error: null,
    requiresKey: null, // 例如 'MONID_API_KEY'
    ...opts,
  };
  const calls = { capabilities: 0, available: 0, estimate: 0, run: 0, lastReq: null };

  const priceOf = (req) => (typeof cfg.price === 'function' ? cfg.price(req) : cfg.price);

  return {
    id: cfg.id,
    local: cfg.local,
    calls,

    async capabilities() {
      calls.capabilities += 1;
      return cfg.capabilities.map((capability) => ({
        capability,
        model: cfg.models?.[capability] ?? `mock-${capability}`,
        quality: cfg.quality,
        license: 'test license',
      }));
    },

    async available(req, ctx) {
      calls.available += 1;
      if (cfg.requiresKey) {
        const key = await ctx.secrets.get(cfg.requiresKey);
        return { ok: !!key, action: `在钥匙串里设置 ${cfg.requiresKey}` };
      }
      return { ok: true, action: '本地 Mock，无需配置' };
    },

    async estimate(req) {
      calls.estimate += 1;
      const estimated = priceOf(req);
      return {
        estimated,
        currency: 'USD',
        priceSource: estimated === null ? 'unknown' : cfg.priceSource,
      };
    },

    async run(req) {
      calls.run += 1;
      calls.lastReq = req;
      if (calls.run <= cfg.failTimes) throw cfg.error ?? httpError(503);
      const estimated = priceOf(req);
      return {
        buffer: Buffer.from(`RIFF-mock-${cfg.id}`),
        format: 'wav',
        seconds: req.duration ?? 2,
        actual: estimated === null ? null : estimated,
        voice_id: req.capability === 'clone' ? `remote-voice-${cfg.id}` : undefined,
        license: 'test license',
        quality: cfg.quality,
      };
    },
  };
}

/** 注入的假 fetch：不联网，只数调用次数并回一份带 RIFF 头的假响应。 */
function fakeFetch() {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'audio/wav' },
      async arrayBuffer() {
        return Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0]).buffer;
      },
      async text() {
        return '';
      },
      async json() {
        return {};
      },
    };
  };
  return { calls, fetch };
}

function freshDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dw-audio-${name}-`));
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** 每个测试一套独立环境：临时 DW_AUDIO_HOME + 注入 fetch/now/secrets + 显式 providers。 */
function harness({ name = 'case', mode = 'auto', providers = [], config, secrets = {}, authorize } = {}) {
  const dir = freshDir(name);
  process.env.DW_AUDIO_HOME = dir;
  const fetcher = fakeFetch();
  const options = {
    home: dir,
    mode,
    providers,
    config,
    authorize,
    fetch: fetcher.fetch,
    now: () => 1756000000000,
    secrets: {
      async get(n) {
        return secrets[n] ?? null;
      },
      async has(n) {
        return !!secrets[n];
      },
    },
  };
  const engine = createAudioEngine(options);
  return {
    dir,
    engine,
    fetchState: fetcher,
    /** 重启：同一个 home 再新建一个 engine（§7-7）。 */
    reopen: (extra = {}) => createAudioEngine({ ...options, ...extra }),
  };
}

function refAudio(dir, name = 'ref.wav') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from('RIFF-ref'));
  return file;
}

const CONSENT = { by: 'user:me', statement: '我授权克隆自己的声音', at: '2026-10-11T08:00:00Z', subject: 'self' };

async function rejection(promise, expectedCode) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, expectedCode, `期望 code=${expectedCode}，实到 ${err.code}：${err.message}`);
    assert.equal(typeof err.action, 'string');
    assert.ok(err.action.length > 0, '可操作的错误必须带 action');
    return true;
  });
}

// ---------------------------------------------------------------- §7-1 无 key 全流程

test('没有任何 key 时，auto 模式下 MockProvider 能把语音、音乐、音效三件都做完并落盘', async () => {
  const mock = makeProvider({ id: 'mock', price: 0 });
  const h = harness({ name: 'nokey', mode: 'auto', providers: [mock], secrets: {} });

  const speech = await h.engine.generate_speech({ text: '风起。' });
  const music = await h.engine.generate_music({ prompt: '沉稳节拍', duration: 4 });
  const sfx = await h.engine.generate_sfx({ prompt: '竹简落地', duration: 1 });

  for (const r of [speech, music, sfx]) {
    assert.equal(r.status, 'succeeded');
    assert.equal(r.provider, 'mock');
    assert.ok(fs.existsSync(r.file), `结果文件应存在：${r.file}`);
    assert.ok(fs.statSync(r.file).size > 0);
  }
  assert.equal(mock.calls.run, 3);
  assert.equal(h.fetchState.calls.length, 0, 'Mock 产物是 buffer，不该发任何网络请求');
});

// ---------------------------------------------------------------- §7-5 Local Only 零云请求

test('local-only 模式下跑完整流程，注入的假 fetch 调用次数为 0', async () => {
  const mock = makeProvider({ id: 'mock', local: true, price: 0 });
  const h = harness({ name: 'localonly', mode: 'local-only', providers: [mock] });

  const r = await h.engine.generate_speech({ text: '风起。' });

  assert.equal(r.status, 'succeeded');
  assert.equal(h.fetchState.calls.length, 0, 'local-only 绝不发云端请求');
});

test('local-only 且注册的 Provider 都不是本地时，报 local_only 并给出可操作的 action', async () => {
  const cloud = makeProvider({ id: 'cloudish', local: false, quality: 'cloud', price: 0.05 });
  const h = harness({ name: 'nolocal', mode: 'local-only', providers: [cloud], secrets: {} });

  await assert.rejects(h.engine.generate_speech({ text: '风起。' }), (err) => {
    assert.equal(err.code, 'local_only');
    assert.equal(typeof err.action, 'string');
    assert.ok(err.action.length > 0, '要告诉用户切到 auto 并配哪个 key');
    return true;
  });
  assert.equal(cloud.calls.run, 0);
});

// ---------------------------------------------------------------- §7-3 克隆与 Voice ID

test('带 consent 克隆成功并分配本地 Voice ID；用同一 voice_id 再生成语音时复用同一身份', async () => {
  const mock = makeProvider({ id: 'mock', price: 0 });
  const h = harness({ name: 'clone', providers: [mock] });

  const cloned = await h.engine.clone_voice({
    audio_file: refAudio(h.dir),
    name: '公子',
    consent: CONSENT,
  });
  assert.equal(cloned.status, 'succeeded');
  assert.equal(typeof cloned.voice_id, 'string');
  assert.ok(cloned.voice_id.length > 0, '克隆要给出稳定的本地 Voice ID');

  const voices = await h.engine.list_voices();
  assert.ok(Array.isArray(voices));
  assert.ok(
    voices.some((v) => (typeof v === 'string' ? v === cloned.voice_id : v?.voice_id === cloned.voice_id || v?.id === cloned.voice_id)),
    'list_voices 里应能查到这条本地身份',
  );

  const spoken = await h.engine.generate_speech({ text: '风起。', voice_id: cloned.voice_id });
  assert.equal(spoken.status, 'succeeded');
  assert.equal(spoken.voice_id, cloned.voice_id);
  assert.equal(mock.calls.lastReq.voice_id, cloned.voice_id, '生成时要把本地身份传下去');
  assert.equal(mock.calls.lastReq.provider_voice_id, 'remote-voice-mock', '云端映射要跟着 Provider 走');
});

test('不带 consent 克隆被拒，code 为 consent', async () => {
  const mock = makeProvider({ id: 'mock', price: 0 });
  const h = harness({ name: 'noconsent', providers: [mock] });

  await rejection(h.engine.clone_voice({ audio_file: refAudio(h.dir), name: '公子' }), 'consent');
  await rejection(
    h.engine.clone_voice({
      audio_file: refAudio(h.dir),
      name: '公子',
      consent: { by: 'user:me', statement: '授权', at: '2026-10-11T08:00:00Z', subject: 'other' },
    }),
    'consent',
  );
  assert.equal(mock.calls.run, 0, '没授权就不能碰 Provider');
});

// ---------------------------------------------------------------- §7-4 换 Provider

test('同一个接口下用 provider: 就能换 Provider，另一个 Provider 不会被顺带调用', async () => {
  const a = makeProvider({ id: 'mockA', price: 0 });
  const b = makeProvider({ id: 'mockB', price: 0 });
  const h = harness({ name: 'switch', providers: [a, b] });

  const viaB = await h.engine.generate_speech({ text: '风起。', provider: 'mockB' });
  assert.equal(viaB.provider, 'mockB');
  assert.equal(b.calls.run, 1);
  assert.equal(a.calls.run, 0, '换 Provider 不该顺带调用别的 Provider');

  const viaA = await h.engine.generate_speech({ text: '风起。', provider: 'mockA' });
  assert.equal(viaA.provider, 'mockA');
  assert.equal(a.calls.run, 1);
});

// ---------------------------------------------------------------- §7-6 价格未知 / 预算

test('价格未知且没有 authorize 钩子时，code 为 price_unknown 且 Provider 一次都没被调用', async () => {
  const unknown = makeProvider({ id: 'mock', price: null, priceSource: 'unknown' });
  const h = harness({ name: 'priceunknown', providers: [unknown] });

  await rejection(h.engine.generate_speech({ text: '风起。' }), 'price_unknown');
  assert.equal(unknown.calls.run, 0, '未授权不许付费执行');
});

test('价格未知时即使 authorize 放行，没有 unknownPriceCeiling 也拒绝；配了上限才执行', async () => {
  const unknown = makeProvider({ id: 'mock', price: null, priceSource: 'unknown' });

  const noCeiling = harness({ name: 'noceiling', providers: [unknown], authorize: async () => true });
  await rejection(noCeiling.engine.generate_speech({ text: '风起。' }), 'price_unknown');
  assert.equal(unknown.calls.run, 0, '没有上限时确认也不能越过预算硬上限');

  const withCeiling = harness({
    name: 'ceiling',
    providers: [unknown],
    authorize: async () => true,
    config: { unknownPriceCeiling: 1 },
  });
  const r = await withCeiling.engine.generate_speech({ text: '风起。' });
  assert.equal(r.status, 'succeeded');
  assert.equal(unknown.calls.run, 1);
});

test('单次估算超过 perCall 预算时 code 为 budget，且 Provider 未被调用', async () => {
  const pricey = makeProvider({ id: 'mock', price: 0.25 });
  const h = harness({ name: 'percall', providers: [pricey], config: { budget: { perCall: 0.1 } } });

  await rejection(h.engine.generate_speech({ text: '风起。' }), 'budget');
  assert.equal(pricey.calls.run, 0, '超预算不执行、不重试');
});

test('同一天第二次调用超过 daily 预算时被挡，code 为 budget 且 Provider 只被调用一次', async () => {
  const paid = makeProvider({ id: 'mock', price: 0.2 });
  const h = harness({ name: 'daily', providers: [paid], config: { budget: { daily: 0.3 } } });

  const first = await h.engine.generate_speech({ text: '第一次。' });
  assert.equal(first.status, 'succeeded');

  await rejection(h.engine.generate_speech({ text: '第二次。' }), 'budget');
  assert.equal(paid.calls.run, 1, '第二次不该到达 Provider');
});

// ---------------------------------------------------------------- §7-6 重试与回退

test('收费任务失败不自动重试：Provider 只被调用一次，结果是 failed 带 error', async () => {
  const paid = makeProvider({ id: 'mock', price: 0.2, failTimes: 9, error: httpError(503) });
  const h = harness({ name: 'noretrypaid', providers: [paid], config: { budget: { perCall: 1 } } });

  const r = await h.engine.generate_speech({ text: '风起。' });

  assert.equal(r.status, 'failed');
  assert.equal(paid.calls.run, 1, '收费任务失败后不能自动重复付费');
  assert.equal(typeof r.error?.code, 'string');
  assert.ok(r.error.code.length > 0);
});

test('免费且 retryable 的失败最多重试一次：第二次成功就成功，失败也到此为止', async () => {
  const freeOnce = makeProvider({ id: 'mock', price: 0, failTimes: 1, error: httpError(503) });
  const h = harness({ name: 'retryfree', providers: [freeOnce] });

  const r = await h.engine.generate_speech({ text: '风起。' });
  assert.equal(r.status, 'succeeded');
  assert.equal(freeOnce.calls.run, 2, '免费 + retryable 重试一次');

  const alwaysBad = makeProvider({ id: 'mock', price: 0, failTimes: 99, error: httpError(503) });
  const h2 = harness({ name: 'retryfree2', providers: [alwaysBad] });
  const failed = await h2.engine.generate_speech({ text: '风起。' });
  assert.equal(failed.status, 'failed');
  assert.equal(alwaysBad.calls.run, 2, '最多重试一次，不许无限重试');
});

test('失败不回退到更贵的 Provider：便宜的挂了就报失败，贵的不会被调用', async () => {
  const cheap = makeProvider({ id: 'cheap', local: true, price: 0.05, failTimes: 9, error: httpError(503) });
  const pricey = makeProvider({ id: 'pricey', local: true, price: 5, quality: 'cloud' });
  const h = harness({
    name: 'nofallback',
    providers: [cheap, pricey],
    config: { budget: { perCall: 10 } },
  });

  const r = await h.engine.generate_speech({ text: '风起。' });

  assert.equal(r.status, 'failed');
  assert.equal(r.provider, 'cheap');
  assert.equal(pricey.calls.run, 0, '没有 allowEscalation 就不许回退到更贵的 Provider');
});

// ---------------------------------------------------------------- §7-7 重启

test('同一个 home 新建 engine 后，get_job、list_voices、get_usage 都还在', async () => {
  const mock = makeProvider({ id: 'mock', price: 0 });
  const h = harness({ name: 'restart', providers: [mock] });

  const spoken = await h.engine.generate_speech({ text: '风起。' });
  const cloned = await h.engine.clone_voice({ audio_file: refAudio(h.dir), name: '公子', consent: CONSENT });

  const restarted = h.reopen();
  const job = await restarted.get_job(spoken.job_id);
  assert.equal(job.status, 'succeeded');
  assert.equal(job.job_id, spoken.job_id);

  const voices = await restarted.list_voices();
  assert.ok(Array.isArray(voices));
  assert.ok(voices.length >= 1, 'Voice ID 要跨重启');
  assert.ok(
    voices.some((v) => (typeof v === 'string' ? v === cloned.voice_id : v?.voice_id === cloned.voice_id || v?.id === cloned.voice_id)),
  );

  const usage = await restarted.get_usage();
  assert.equal(typeof usage, 'object');
  assert.ok(usage !== null);
});

// ---------------------------------------------------------------- §7-8 错误映射

test('网络故障、欠费、限流分别映射到 network、insufficient_balance、rate_limit，且都带 action', async () => {
  const cases = [
    { name: 'net', status: 500, code: 'network' },
    { name: 'balance', status: 402, code: 'insufficient_balance' },
    { name: 'rate', status: 429, code: 'rate_limit' },
  ];

  for (const c of cases) {
    const bad = makeProvider({ id: 'mock', local: false, quality: 'cloud', price: 0.2, failTimes: 9, error: httpError(c.status) });
    const h = harness({ name: `err-${c.name}`, providers: [bad], config: { budget: { perCall: 1 } } });

    const r = await h.engine.generate_speech({ text: '风起。' });

    assert.equal(r.status, 'failed', `${c.status} 应当是执行后失败`);
    assert.equal(r.error.code, c.code, `HTTP ${c.status} 的 code`);
    assert.equal(typeof r.error.action, 'string');
    assert.ok(r.error.action.length > 0, `${c.code} 要告诉用户下一步做什么`);
  }
});

// ---------------------------------------------------------------- §2 transcribe 未接

test('transcribe 返回 config 错误，说明还没有接 STT', async () => {
  const h = harness({ name: 'stt', providers: [makeProvider({ id: 'mock' })] });

  await assert.rejects(h.engine.transcribe({ audio_file: refAudio(h.dir) }), (err) => {
    assert.equal(err.code, 'config');
    assert.equal(typeof err.action, 'string');
    assert.ok(err.action.length > 0);
    return true;
  });
});

// ---------------------------------------------------------------- §2 结果字段

test('成功结果字段齐全：job_id、provider、model、file、cost.estimated、meta.createdAt', async () => {
  const mock = makeProvider({ id: 'mock', price: 0.12 });
  const h = harness({ name: 'shape', providers: [mock], config: { budget: { perCall: 1 } } });

  const r = await h.engine.generate_music({ prompt: '沉稳节拍', duration: 4 });

  assert.equal(typeof r.job_id, 'string');
  assert.ok(r.job_id.length > 0);
  assert.equal(r.status, 'succeeded');
  assert.equal(typeof r.provider, 'string');
  assert.equal(typeof r.model, 'string');
  assert.equal(typeof r.file, 'string');
  assert.ok(fs.existsSync(r.file));
  assert.equal(typeof r.format, 'string');
  assert.equal(typeof r.cost, 'object');
  assert.equal(typeof r.cost.estimated, 'number');
  assert.equal(r.cost.currency, 'USD');
  assert.equal(typeof r.meta, 'object');
  assert.ok(['string', 'number'].includes(typeof r.meta.createdAt), 'meta.createdAt 要有时间');
  assert.equal(r.meta.prompt, '沉稳节拍');

  const job = await h.engine.get_job(r.job_id);
  assert.equal(job.job_id, r.job_id);
});

// ---------------------------------------------------------------- §0-4 / §7 密钥不外泄

test('假 API Key 不出现在 jobs.json、usage.json 与结果对象里', async () => {
  const cloud = makeProvider({ id: 'monidish', local: false, quality: 'cloud', price: 0.05, requiresKey: 'MONID_API_KEY' });
  const h = harness({
    name: 'secret',
    providers: [cloud],
    secrets: { MONID_API_KEY: FAKE_KEY },
    config: { budget: { perCall: 1 } },
  });

  const r = await h.engine.generate_speech({ text: '风起。' });
  assert.equal(r.status, 'succeeded', '配了 key 就该能走云端这条路');
  assert.equal(cloud.calls.available > 0, true, 'engine 要真的向 secrets 要过 key');

  const dumped = JSON.stringify(r) + JSON.stringify(await h.engine.get_usage()) + JSON.stringify(await h.engine.list_voices());
  assert.equal(dumped.includes(FAKE_KEY), false, '结果/用量/声线里都不许出现 key');

  for (const file of ['jobs.json', 'usage.json', 'voices.json', 'registry.json']) {
    const text = readIfExists(path.join(h.dir, file));
    assert.equal(text.includes(FAKE_KEY), false, `${file} 里不许出现 key`);
  }
});
