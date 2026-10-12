// 一次会话：把用户、导师、导演、演员、主张图接在同一本账上。
// 第一阶段要证明的链：你的需求 → 导师 → 导演 → 呈现 → 演员在其中演 → 你的反应回到导师和导演。
// 这里不写任何画面，只负责“谁把什么交给谁，因为什么”。

import { createLedger, loadLedger, auditService, traceToUser } from '../core/ledger.js';
import { createClaimGraph } from '../core/claims.js';
import { createMind } from '../core/mind.js';
import { createMentor } from '../agents/mentor.js';
import { createDirector } from '../agents/director.js';
import { PEOPLE, STAFF, HISTORY, PLACES, ITEMS } from '../data/seed.js';
import { CATALOG } from '../play/catalog.js';

/** 史料层是设定，不由任何人的决定产生，所以记成 'world' 发出的设定主张 */
function seedHistory(claims) {
  for (const h of HISTORY) {
    claims.add({
      subject: h.subject, predicate: h.predicate, object: h.object, holder: h.holder || '史书',
      channel: '设定', evidence: h.evidence || [], weight: 3, note: h.note,
    });
  }
}

export function createSession({ saved, speaker } = {}) {
  const ledger = saved?.ledger ? loadLedger(saved.ledger) : createLedger();
  const claims = createClaimGraph(ledger, saved?.claims);
  if (!saved) seedHistory(claims);
  const mentor = createMentor({ ledger, def: STAFF.mentor, saved: saved?.mentor });
  const directors = Object.fromEntries(STAFF.directors.map((d) => [d.id, createDirector({ ledger, def: d, mentor, saved: saved?.directors?.[d.id] })]));
  const minds = Object.fromEntries(PEOPLE.map((p) => [p.id, createMind(p, saved?.minds?.[p.id])]));
  const state = {
    met: !!saved?.met,
    directorId: saved?.directorId || null,
    designs: saved?.designs || {},
    predictions: saved?.predictions || {},
    // 旁注表：账本记录 seq → { text, source:'model'|'rule' }（见 narrate.js）
    // 账本只追加、不改，所以“他当时的说法”单独放这里，存档时一起带走
    voices: saved?.voices || {},
    // 第二阶段：每部作品演过没有、选了什么；第三阶段：可玩呈现的进度（play.js）
    plays: saved?.plays || {},
    play: saved?.play || null,
    // 本段经历的边界（开场 seq / 继承的主张）。没开过经历时这个键不出现，存档形状一字不变。
    ...(saved?.episode ? { episode: saved.episode } : {}),
  };

  /** 第一次见面：用户回答三个粗问题，写一句自己的需求 */
  function meet(answers, need) {
    const u = ledger.append({ kind: 'user.meet', from: 'user', to: 'mentor', payload: { answers, need } });
    const r = mentor.meet({ answers, need }, u.seq);
    const pick = mentor.chooseDirector(STAFF.directors, [u.seq, ...r.seqs]);
    state.directorId = pick.director;
    state.met = true;
    return { userSeq: u.seq, director: pick.director };
  }

  function director() { return directors[state.directorId]; }

  /**
   * 排一部作品：导师分配算力档位 → 给导演交需求 → 导演设计、授予交互、设想玩家。
   * 每一步的 cause 都接到上一步，最上面接到用户。
   */
  function commission(presentationId, cause = []) {
    const cat = CATALOG[presentationId];
    if (!cat) throw new Error(`没有这部作品：${presentationId}`);
    const root = cause.length ? cause : [ledger.last((e) => e.from === 'user')?.seq].filter(Boolean);
    const allot = mentor.allot(cat.beats.map((b) => ({ id: b.id, title: b.title, centrality: b.centrality })), root);
    const brief = mentor.brief(state.directorId, [allot.seq, ...root]);
    const d = director();
    const design = d.design({ ...brief.brief, tiers: allot.chosen }, cat, [brief.seq]);
    const grants = design.design.beats.map((b) => d.grant(b, [design.seq]));
    const notes = mentor.notes();
    const pred = d.predict(design.design, notes, [design.seq]);
    state.designs[presentationId] = { ...design.design, seq: design.seq };
    state.predictions[presentationId] = { list: pred.predictions, seq: pred.seq };
    ledger.append({ kind: 'present.open', from: `presentation:${presentationId}`, to: 'user', cause: [design.seq, ...grants], payload: { presentation: presentationId } });
    return { allot, brief, design: design.design, designSeq: design.seq, predictions: pred.predictions };
  }

  /** 用户在呈现里的反应：同时交给导师（了解你）和导演（对照预测） */
  function react(presentationId, beat, signal) {
    const u = ledger.append({ kind: 'user.react', from: 'user', to: 'mentor', payload: { scene: presentationId, beat, signal } });
    const learned = mentor.learn({ kind: signal, beat }, u.seq);
    return { userSeq: u.seq, mentorSeq: learned };
  }

  /**
   * 一部作品看完：导演把所有反应和自己的预测对照，调整手艺。
   * 开了持续生活（state.episode 存在）时只看「本段经历」的反应：
   * 上一次走进同一部作品的反应不再算进来（docs/design/LIVING.md §7 历史不串台）。
   */
  function learnLife() {
    const ep = state.episode;
    if (!ep) return null;
    const pred = state.predictions[ep.work];
    if (!pred) return null;
    const rx = ledger.entries.filter((e) => e.kind === 'user.react' && e.payload.scene === ep.work && e.seq >= ep.from && e.seq > (ep.learnedThrough ?? 0));
    if (!rx.length) return null;
    const r = director().learn(pred.list, rx.map((e) => ({ beat: e.payload.beat, signal: e.payload.signal, seq: e.seq })), [pred.seq, ...rx.map((e) => e.seq)]);
    ep.learnedThrough = rx.at(-1).seq;
    return r;
  }

  function wrap(presentationId) {
    const pred = state.predictions[presentationId];
    if (!pred) return null;
    const ep = state.episode;
    const scope = ep && ep.work === presentationId ? ep : null;
    const reactions = ledger.entries
      .filter((e) => e.kind === 'user.react' && e.payload.scene === presentationId && (!scope || (e.seq >= scope.from && e.seq > (scope.learnedThrough ?? 0))))
      .map((e) => ({ beat: e.payload.beat, signal: e.payload.signal, seq: e.seq }));
    const r = director().learn(pred.list, reactions, [pred.seq, ...reactions.map((x) => x.seq)]);
    ledger.append({ kind: 'present.deliver', from: `presentation:${presentationId}`, to: 'user', cause: [r.seq], payload: { presentation: presentationId } });
    if (scope) { scope.to = ledger.size; if (reactions.length) scope.learnedThrough = reactions.at(-1).seq; }
    return r;
  }

  // ---- 生活循环的「一段经历」（docs/design/LIVING.md §7）----
  // 只在启用持续生活的会话里才有 state.episode；不启用时这个键根本不出现，存档形状一字不变。

  /** 开一段经历：记下开场 seq、明确继承的主张 id；本段产出的 id 由 episodeScope() 现算 */
  function beginEpisode({ work, inherit = [] } = {}) {
    const prev = state.episode;
    const ep = {
      id: `ep${(prev?.n ?? 0) + 1}`,
      n: (prev?.n ?? 0) + 1,
      work: work ?? null,
      openSeq: ledger.last((e) => e.kind === 'present.open' && e.payload.presentation === work)?.seq ?? null,
      from: ledger.size + 1,
      to: null,
      inherit: inherit.slice(),
      claimIds: [],
      previous: prev?.id ?? null,
    };
    state.episode = ep;
    return { ...ep, claimIds: [] };
  }

  /** 这一段经历能看见哪些主张：本段产出的 + 明确继承的。其余（上一局的结局、下场）不算数 */
  function episodeScope() {
    const ep = state.episode;
    if (!ep) return null;
    const all = typeof claims.all === 'function' ? claims.all() : [];
    ep.claimIds = all
      .filter((c) => (c.seq != null && c.seq >= ep.from) || ep.inherit.includes(c.id))
      .map((c) => c.id);
    return { ...ep, claimIds: ep.claimIds.slice() };
  }

  /**
   * 原始观察：玩家在这一场停了多久（可追溯，不替代导师的纸条）。
   * 记的是所属场与起止拍，账本上是一条 user.pause。
   */
  function recordPause({ scene = null, fromTick = null, toTick = null, ticks = null } = {}) {
    const seq = ledger.append({
      kind: 'user.pause', from: 'user', to: 'world',
      payload: { scene, fromTick, toTick, ticks: ticks ?? (toTick != null && fromTick != null ? toTick - fromTick : null) },
    }).seq;
    return { seq, seqs: [seq] };
  }

  /**
   * 导演给这一场的生活计划：同一份决定只提交一次（内容没变就不再记账）；
   * 手艺变了、或逻辑拍推进后重新算出的决定不一样时，才落新的一条。
   */
  function commitLifeDesign({ work, beat, policy, cause = [] } = {}) {
    const design = state.designs?.[work];
    const i = design?.beats?.findIndex?.((x) => x.id === beat) ?? -1;
    if (i < 0) return null;
    const b = design.beats[i];
    const same = (x, y) => x && y && ['waitForPlayer', 'cadenceTicks', 'historyReveal', 'why', 'version', 'autonomy', 'environment', 'stimulus', 'conditions', 'gate', 'directorId'].every((k) => JSON.stringify(x[k]) === JSON.stringify(y[k]));
    if (b?.lifePolicy && same(b.lifePolicy, policy)) {
      return { seq: b.lifePolicy.sourceSeq ?? null, policy: b.lifePolicy, committed: false };
    }
    const d = director();
    if (!d || typeof d.lifeDesign !== 'function') return null;
    const r = d.lifeDesign({ work, beat, policy }, cause);
    const pinned = { ...policy, sourceSeq: r.seq };
    // 只换 state 里那一份：账本里那条 director.design 的 payload 不能被就地改（改了存档指纹就不符）
    state.designs[work] = { ...design, beats: design.beats.map((x, j) => (j === i ? { ...x, lifePolicy: pinned } : x)) };
    return { seq: r.seq, policy: pinned, committed: true };
  }

  function editNote(field, value) {
    const before = mentor.notes()[field]?.value;
    const u = ledger.append({ kind: 'user.edit-note', from: 'user', to: 'mentor', payload: { field, from: before, to: value } });
    return mentor.editNote(field, value, u.seq);
  }

  /**
   * 开资产单（docs/ASSETS.md §3）：导演按自己的手艺给这一部作品列清单。
   * 只有显式调用才会走到这里——演出的任何路径（createPlay）都不调它，
   * 所以 680 个脚本对照组的账本一笔不变；调一次会写一笔 director.dress。
   */
  // 场景数据由调用方递进来（import shared/scenes/<work>.js 的 SCENES）：会话不静态依赖场景文件，
  // 场景组改到一半时，会话、演出和对照组照样能加载。
  function dress(work, scenes) {
    if (!scenes || typeof scenes !== 'object') throw new Error(`没有这部作品的场景数据：${work}（调用时把 SCENES 递进来）`);
    const d = director();
    if (!d) throw new Error('还没有导演：先上传记让导师请一位');
    const cause = [ledger.last((e) => e.from === 'user')?.seq].filter(Boolean);
    return d.dress({ work, scenes, places: PLACES, people: PEOPLE, items: ITEMS }, cause);
  }

  const saveLife = () => api.saveLife?.();
  function save() {
    if (state.play?.life) saveLife();
    return {
      ledger: ledger.toJSON(),
      claims: claims.toJSON(),
      mentor: mentor.state(),
      directors: Object.fromEntries(Object.entries(directors).map(([k, d]) => [k, d.state()])),
      minds: Object.fromEntries(Object.entries(minds).map(([k, m]) => [k, m.save()])),
      ...state,
    };
  }

  const api = {
    ledger, claims, mentor, directors, minds, state, speaker,
    // voices 是 state.voices 的同一个对象：narrate 直接往会话上写旁注，save 也一起存
    voices: state.voices,
    meet, commission, react, wrap, editNote, director, dress, save,
    // 生活循环（docs/design/LIVING.md §7）：一段经历的范围与导演的生活计划
    beginEpisode, episodeScope, commitLifeDesign, recordPause, learnLife,
    audit: () => auditService(ledger),
    trace: (seq) => traceToUser(ledger, seq),
  };
  return api;
}
