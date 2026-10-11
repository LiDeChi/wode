// 心智内核：单元 → 模块 → 心智。导师、导演、演员是同一种心智，只是单元和动作不同。
// 一件事进来，先由单元按自己的“胃口”就地吃掉；吃不下交给模块；模块吃不下才递到心智。
// 每一步记下“接了多少、剩多少”。停在哪一层，决定了这个人此刻做什么——这就是“换个人，行为不同”的来源。
// 有限状态、确定性：同样的心智、同样的输入，永远得到同样的结果（可以重放、可以审计）。

export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const round = (v) => Math.round(v * 1000) / 1000;

/** capacity 写成数据：{ base, by: { 性情名: 系数 } }，方便存储和展示 */
export function capacityOf(spec, temperament) {
  if (typeof spec === 'number') return spec;
  let v = spec?.base ?? 0.3;
  for (const [k, coef] of Object.entries(spec?.by || {})) v += coef * (temperament[k] ?? 0.5);
  return round(clamp(v, 0, 1.5));
}

/**
 * 定义一个心智。
 * def = {
 *   id, name,
 *   temperament: { 疑心:0..1, 耐性:0..1, 义:0..1, ... },
 *   units:   [{ id, label, module, reads:[通道], capacity, act, verb?, predicts?, canChange?, param? }],
 *   modules: [{ id, label, capacity, act }],
 *   mindAct: '想清楚再动',             // 递到心智时的动作
 *   values:  { 义:0..1, 利:0..1, 惧:0..1, 恩:0..1 },  // 话里的哪种诉求能打动他
 *   resist:  { 义:{惧:0.5} }           // 某种诉求反而激起另一种情绪（魏王：越讲义越怕）
 *   goals:   [动作id...]               // 自己的目标会给这些动作加权
 *   trust:   { 'actor:x': 0..1 }
 * }
 */
export function createMind(def, saved) {
  const t = { ...def.temperament };
  const units = def.units.map((u) => ({ ...u, cap: capacityOf(u.capacity, t) }));
  const modules = (def.modules || []).map((m) => ({ ...m, cap: capacityOf(m.capacity, t) }));
  const state = {
    trust: { ...(def.trust || {}) },
    stress: def.stress ?? 0.2,
    // 记忆：痕迹、激活、巩固。key 是事件签名
    memory: {},
    // 已装上的新办法（改造链装进来的单元）
    installed: [],
    // 设想过的他人（一层他人模型）
    others: {},
    log: [],
    ...(saved ? JSON.parse(JSON.stringify(saved)) : {}),
  };
  for (const u of state.installed) units.push({ ...u, cap: capacityOf(u.capacity, t) });

  function signatureOf(event) {
    return event.signature || event.kind || Object.keys(event.channels || {}).sort().join('+');
  }

  /** 预期：这个人见过多少次同类事，就能预测掉多少。巩固越高，误差越小。 */
  function expectationFor(sig) {
    const m = state.memory[sig];
    if (!m) return 0;
    return round(clamp(0.18 * m.consolidation + 0.08 * m.activation, 0, 0.6));
  }

  /**
   * 感知一件事。event = { kind, signature?, channels:{通道:强度}, reliability?, from?, about? }
   * 返回 { trace, stoppedAt, action, candidates, error, expectation }
   */
  function perceive(event) {
    const sig = signatureOf(event);
    const reliability = event.reliability ?? 1;
    const expectation = expectationFor(sig);
    // 预测误差：未被解释、且可靠的部分才往上走
    const left = {};
    let error = 0;
    for (const [ch, v] of Object.entries(event.channels || {})) {
      const e = Math.max(0, v * reliability - expectation);
      left[ch] = round(e);
      error += e;
    }
    error = round(error);
    const trace = [];
    const candidates = [];
    const tookByModule = {};
    // 单元层：每个单元只读自己那一路
    for (const u of units) {
      let took = 0;
      for (const ch of u.reads) {
        if (!left[ch]) continue;
        const bite = Math.min(left[ch], u.cap - took);
        if (bite <= 0) continue;
        took += bite;
        left[ch] = round(left[ch] - bite);
      }
      took = round(took);
      const leftover = round(Object.values(left).reduce((a, b) => a + b, 0));
      trace.push({ layer: 'unit', id: u.id, label: u.label, module: u.module, cap: u.cap, took, left: leftover });
      if (took > 0) {
        tookByModule[u.module] = round((tookByModule[u.module] || 0) + took);
        candidates.push({ layer: 'unit', id: u.id, act: u.act, verb: u.verb, weight: took });
      }
    }
    // 模块层：吃单元剩下的总量
    let rest = round(Object.values(left).reduce((a, b) => a + b, 0));
    for (const m of modules) {
      const took = round(Math.min(rest, m.cap));
      rest = round(rest - took);
      trace.push({ layer: 'module', id: m.id, label: m.label, cap: m.cap, took, left: rest, fromUnits: tookByModule[m.id] || 0 });
      if (took > 0) candidates.push({ layer: 'module', id: m.id, act: m.act, verb: m.verb, weight: took });
    }
    // 心智层：只知道“一件整体的事”，不知道底层哪几路在响
    trace.push({ layer: 'mind', id: 'mind', label: '心智', took: rest, left: 0 });
    if (rest > 0) candidates.push({ layer: 'mind', id: 'mind', act: def.mindAct || '停下来想', weight: rest * 1.2 });
    // 自己的目标给动作加权；压力让人更倾向就地解决
    for (const c of candidates) {
      if ((def.goals || []).includes(c.act)) c.weight = round(c.weight * 1.25);
      if (c.layer === 'unit') c.weight = round(c.weight * (1 + 0.4 * state.stress));
    }
    candidates.sort((a, b) => b.weight - a.weight);
    const top = candidates[0];
    const stoppedAt = rest > 0.05 ? 'mind' : Object.keys(tookByModule).length && modules.some((m) => trace.find((x) => x.id === m.id && x.took > 0)) ? 'module' : 'unit';
    const result = {
      mind: def.id, signature: sig, error, expectation,
      trace, candidates, stoppedAt,
      action: top ? { act: top.act, verb: top.verb, layer: top.layer, from: top.id } : { act: '不动', layer: 'none' },
    };
    remember(sig, error);
    state.log.push({ sig, stoppedAt, act: result.action.act, error });
    return result;
  }

  /** 记忆：摆到眼前一次就记牢一档；激活随时间衰减（tick） */
  function remember(sig, error) {
    const m = state.memory[sig] || { trace: 0, activation: 0, consolidation: 0 };
    m.trace += 1;
    m.activation = round(clamp(m.activation + 0.5 + 0.3 * error, 0, 2));
    m.consolidation = round(Math.min(3, m.consolidation + (error > 0.3 ? 1 : 0.5)));
    state.memory[sig] = m;
  }

  function tick(dt = 1) {
    for (const m of Object.values(state.memory)) m.activation = round(Math.max(0, m.activation - 0.15 * dt));
  }

  /**
   * 听一句话。appeal = { 义, 利, 惧, 恩 }（0..1），from = 说话人的角色标识。
   * 信不信取决于对说话人的认可度；打不打动取决于自己的 values；有些诉求会激起反向情绪（resist）。
   * 返回 { accepted, moved, fit, backlash, trustBefore, trustAfter, reason }
   */
  function hear(appeal, from) {
    const vals = def.values || {};
    let fit = 0;
    let backlash = 0;
    const why = [];
    for (const [k, v] of Object.entries(appeal || {})) {
      const w = vals[k] ?? 0;
      fit += v * w;
      if (w * v > 0.15) why.push(`${k}打动了他`);
      for (const [emotion, coef] of Object.entries(def.resist?.[k] || {})) {
        backlash += v * coef;
        why.push(`讲${k}反而激起他的${emotion}`);
      }
    }
    fit = round(fit);
    backlash = round(backlash);
    const trustBefore = state.trust[from] ?? 0.3;
    const moved = round(fit * (0.5 + trustBefore) - backlash);
    const accepted = moved >= (def.threshold ?? 0.35);
    // 他人模型：说话人留下的印象（信任随话是否投合而变）
    const trustAfter = round(clamp(trustBefore + (fit > 0.3 ? 0.08 : -0.04) - (backlash > 0.2 ? 0.05 : 0)));
    state.trust[from] = trustAfter;
    state.stress = round(clamp(state.stress + backlash * 0.5));
    return { accepted, moved, fit, backlash, trustBefore, trustAfter, reason: why.length ? why.join('；') : '这些话没有落到他在乎的地方' };
  }

  /**
   * 一层他人模型：用自己的结构去设想别人会怎样。
   * 只知道别人“看起来的性情”（guess），不知道别人真实的单元。返回预测的动作和停层。
   */
  function imagine(otherDef, event, guess) {
    const assumed = { ...otherDef, id: `${def.id}>${otherDef.id}`, temperament: { ...otherDef.temperament, ...(guess || {}) } };
    const sim = createMind(assumed);
    const r = sim.perceive(event);
    state.others[otherDef.id] = { guess: guess || null, lastPredicted: r.action.act };
    return { act: r.action.act, stoppedAt: r.stoppedAt, by: def.id, about: otherDef.id };
  }

  /** 改造链装进来的新办法：变成一个新单元 */
  function install(unitDef) {
    const u = { ...unitDef, cap: capacityOf(unitDef.capacity, t) };
    units.push(u);
    state.installed.push(unitDef);
    return u;
  }

  function uninstall(unitId) {
    const i = units.findIndex((u) => u.id === unitId);
    if (i >= 0) units.splice(i, 1);
    state.installed = state.installed.filter((u) => u.id !== unitId);
  }

  return {
    id: def.id, name: def.name, def, temperament: t, units, modules, state,
    perceive, hear, imagine, install, uninstall, tick, expectationFor,
    /** 只存经历（state）；性情和手艺在 def 里，分开存，角色才可携带 */
    save: () => JSON.parse(JSON.stringify(state)),
  };
}

/** 把一次 perceive 的结果压成一句人能看懂的话，用于心智入口和片场 */
export function explainPerception(r, name = '他') {
  const unitHit = r.trace.filter((x) => x.layer === 'unit' && x.took > 0).map((x) => x.label);
  const mind = r.trace.find((x) => x.layer === 'mind');
  if (r.stoppedAt === 'mind') return `${name}手上的几路（${unitHit.join('、') || '无'}）没吃下，剩下的${mind.took}一路递到心智：${r.action.act}`;
  if (r.stoppedAt === 'module') return `${name}在模块那一层就把事消化了：${r.action.act}`;
  return `${name}在${unitHit[0] || '手脚'}那一层就用掉了，已经动身：${r.action.act}`;
}
