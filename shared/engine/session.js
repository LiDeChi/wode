// 一次会话：把用户、导师、导演、演员、主张图接在同一本账上。
// 第一阶段要证明的链：你的需求 → 导师 → 导演 → 呈现 → 演员在其中演 → 你的反应回到导师和导演。
// 这里不写任何画面，只负责“谁把什么交给谁，因为什么”。

import { createLedger, loadLedger, auditService, traceToUser } from '../core/ledger.js';
import { createClaimGraph } from '../core/claims.js';
import { createMind } from '../core/mind.js';
import { createMentor } from '../agents/mentor.js';
import { createDirector } from '../agents/director.js';
import { PEOPLE, STAFF, HISTORY } from '../data/seed.js';
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
  const claims = createClaimGraph(ledger);
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

  /** 一部作品看完：导演把所有反应和自己的预测对照，调整手艺 */
  function wrap(presentationId) {
    const pred = state.predictions[presentationId];
    if (!pred) return null;
    const reactions = ledger.entries
      .filter((e) => e.kind === 'user.react' && e.payload.scene === presentationId)
      .map((e) => ({ beat: e.payload.beat, signal: e.payload.signal, seq: e.seq }));
    const r = director().learn(pred.list, reactions, [pred.seq, ...reactions.map((x) => x.seq)]);
    ledger.append({ kind: 'present.deliver', from: `presentation:${presentationId}`, to: 'user', cause: [r.seq], payload: { presentation: presentationId } });
    return r;
  }

  function editNote(field, value) {
    const before = mentor.notes()[field]?.value;
    const u = ledger.append({ kind: 'user.edit-note', from: 'user', to: 'mentor', payload: { field, from: before, to: value } });
    return mentor.editNote(field, value, u.seq);
  }

  function save() {
    return {
      ledger: ledger.toJSON(),
      mentor: mentor.state(),
      directors: Object.fromEntries(Object.entries(directors).map(([k, d]) => [k, d.state()])),
      minds: Object.fromEntries(Object.entries(minds).map(([k, m]) => [k, m.save()])),
      ...state,
    };
  }

  return {
    ledger, claims, mentor, directors, minds, state, speaker,
    // voices 是 state.voices 的同一个对象：narrate 直接往会话上写旁注，save 也一起存
    voices: state.voices,
    meet, commission, react, wrap, editNote, director, save,
    audit: () => auditService(ledger),
    trace: (seq) => traceToUser(ledger, seq),
  };
}
