// 导师：替用户记口味、分预算、配导演。只听用户的话（问、改、停下来的信号），不听导演。
// 每一个决定都写进账本，并把 cause 指回用户那一条，所以“为用户服务”可以被 traceToUser 检验。

import { traceToUser } from '../core/ledger.js';
import { clamp } from '../core/mind.js';

const TIERS = ['细演', '普通', '一笔带过'];
// 档位即成本：细演 3、普通 2、一笔带过 1
const TIER_NUM = { 细演: 3, 普通: 2, 一笔带过: 1 };
const FIELDS = ['wait', 'polish', 'depth', 'surprise'];
const DEFAULT_VALUE = 0.5;

// 情感关键词：按表的顺序匹配，第一条命中即用
const EMOTION_RULES = [
  ['责任', ['选择', '决定', '改变', '取舍']],
  ['紧张', ['紧张', '刺激', '危险', '追']],
  ['顿悟', ['为什么', '真相', '原因', '弄清']],
  ['亲密', ['信任', '朋友', '谈心', '亲近']],
  ['好奇', ['走走', '看看', '探索', '好奇']],
  ['悲悯', ['人', '命运', '悲', '结局']],
];

// 玩家停下、追问、很快通过、重来、离开时，导师怎么调口味
const LEARN_RULES = {
  '停下来看心思': [['depth', 0.08]],
  '追问为什么': [['depth', 0.08]],
  '很快通过': [['depth', -0.06]],
  '重来一次': [['surprise', 0.05], ['polish', -0.04]],
  '中途离开': [['wait', -0.1]],
};

const LEARN_SAID = {
  '停下来看心思': '你停下来看心思，我就把人心往细里写。',
  '追问为什么': '你追问为什么，我就把人心往细里写。',
  '很快通过': '你很快就过了，我少写一点人心。',
  '重来一次': '你想重来，我下次多给一点意外，雕琢少一点。',
  '中途离开': '你中途走了，我下次少让你等。',
};

const round2 = (v) => Math.round(v * 100) / 100;

/** 从一句话里推出情感；都不中用“悲悯”。 */
export function pickEmotion(need = '') {
  for (const [emotion, words] of EMOTION_RULES) {
    if (words.some((w) => need.includes(w))) return emotion;
  }
  return '悲悯';
}

export function createMentor({ ledger, def, budget = 10, saved } = {}) {
  const s = saved ? JSON.parse(JSON.stringify(saved)) : {};
  // notes：{ [field]: { value, source:'问'|'观察'|'你改的', seq } }
  let notes = s.notes || {};
  let chosen = s.chosen || {};
  let spent = s.spent ?? 0;
  let director = s.director ?? null; // { id, seq }
  let allotSeq = s.allotSeq ?? null;
  // 最近一条能追到用户的记录：拒绝记录要挂在它上面
  let anchor = s.anchor ?? null;
  const budgetNow = s.budget ?? budget;

  /** 统一写入口：from 固定为 mentor；cause 去重、去掉非法值；能追到用户就更新 anchor */
  function write(kind, payload, cause, said, to = 'world') {
    const c = [...new Set(cause.filter((x) => Number.isInteger(x)))];
    const e = ledger.append({ kind, from: 'mentor', to, payload, cause: c, said, saidSource: 'rule' });
    if (traceToUser(ledger, e.seq).ok) anchor = e.seq;
    return e;
  }

  function setNote(field, value, source, cause, said) {
    const e = write('mentor.note', { field, value, source }, cause, said);
    notes[field] = { value, source, seq: e.seq };
    return e.seq;
  }

  /** 第一次见面：把用户的三个问题、一句话的诉求，各记一条笔记 */
  function meet({ answers = {}, need = '' } = {}, userSeq) {
    const seqs = [];
    const said = {
      wait: (v) => (v < 0.4 ? '你现在就要，我就不让你等。' : '你愿意等，我就慢慢雕。'),
      polish: (v) => (v > 0.6 ? '你要一段雕好的，我往精里做。' : '你要能真改变它，我往动里做。'),
      depth: (v) => (v > 0.6 ? '你要看人心看细，我就往细里写。' : '你只看个大概，我不往细里钻。'),
    };
    for (const f of FIELDS) {
      const asked = answers[f] !== undefined;
      const v = asked ? answers[f] : DEFAULT_VALUE;
      // surprise 不问，按观察修正：这里只放中间值
      const line = said[f] ? said[f](v) : '你没问惊喜，我先放中间，等你的动作来改它。';
      seqs.push(setNote(f, v, asked ? '问' : '观察', [userSeq], line));
    }
    const emotion = pickEmotion(need);
    seqs.push(setNote('emotion', emotion, '问', [userSeq], `你要的是${emotion}，我就往这上面配。`));
    seqs.push(setNote('need', need, '问', [userSeq], `你说的这句话我原样存着：“${need}”。`));
    return { notes: snapshotNotes(), seqs };
  }

  function snapshotNotes() {
    return JSON.parse(JSON.stringify(notes));
  }

  /** 用户亲手改笔记：source 记为“你改的”，之后观察不能覆盖它 */
  function editNote(field, value, userSeq) {
    return setNote(field, value, '你改的', [userSeq], `你改成了${value}，这一条我听你的。`);
  }

  /**
   * 预算分配：depth 与 centrality 加权定档，超预算时从 centrality 最低的往下降。
   * scenes = [{ id, title, centrality }]
   *
   * 这里定的档位就是「这一场的人演得多细」（docs/KERNEL.md §6）：内核用 createPlay(session,{tiers:'mentor'})
   * 读走 chosen（按 beat id 记）。预算不够时从最不中心的往下降档，降到底也照常演完——不抛错、不中断。
   * 输入脏（不是数组、centrality 不是数）时按默认值算，一样不抛错。
   */
  function allot(scenes = [], cause = []) {
    if (!Array.isArray(scenes)) scenes = [];
    const depth = notes.depth?.value ?? DEFAULT_VALUE;
    const items = scenes.map((sc, i) => {
      const c = clamp(Number.isFinite(sc?.centrality) ? sc.centrality : DEFAULT_VALUE);
      const score = depth * 0.6 + c * 0.4;
      const tier = score >= 0.6 ? '细演' : score >= 0.35 ? '普通' : '一笔带过';
      return { id: sc.id, c, i, tier, cut: false };
    });
    const total = () => items.reduce((a, x) => a + TIER_NUM[x.tier], 0);
    while (total() > budgetNow) {
      const cands = items.filter((x) => TIER_NUM[x.tier] > 1).sort((a, b) => a.c - b.c || a.i - b.i);
      if (!cands.length) break;
      const x = cands[0];
      x.tier = x.tier === '细演' ? '普通' : '一笔带过';
      x.cut = true;
    }
    const out = {};
    for (const x of items) out[x.id] = x.tier;
    const sum = total();
    chosen = out;
    spent = sum;
    const anyCut = items.some((x) => x.cut);
    let line = depth > 0.6 ? '你说人心要看细，这几场我给细演。' : '人心看个大概就行，这几场我省着演。';
    if (anyCut) line += '预算就这么多，其余的我先一笔带过。';
    const e = write(
      'mentor.allot',
      {
        input: scenes.map((sc) => ({ id: sc?.id, centrality: sc?.centrality })),
        options: TIERS,
        chosen: out,
        spent: sum,
        budget: budgetNow,
      },
      [...cause, notes.depth?.seq],
      line,
    );
    allotSeq = e.seq;
    return { chosen: out, seq: e.seq };
  }

  /** 按口味配导演：polish 高偏爱雕琢，低偏爱放开；同分取先到的 */
  function chooseDirector(directors = [], cause = []) {
    const polish = notes.polish?.value ?? DEFAULT_VALUE;
    const key = polish > 0.5 ? '雕琢' : '放开';
    let best = null;
    for (const d of directors) {
      const sc = d.temperament?.[key] ?? 0;
      if (!best || sc > best.sc) best = { d, sc };
    }
    if (!best) return { director: null, seq: null };
    const id = best.d.id;
    const name = best.d.name || id;
    const e = write(
      'mentor.note',
      { field: 'director', value: id, source: '观察' },
      [...cause, notes.polish?.seq],
      `这一部我找${name}掌舵：你要的${polish > 0.5 ? '是雕琢' : '是放开'}。`,
    );
    director = { id, seq: e.seq };
    return { director: id, seq: e.seq };
  }

  /** 给导演的任务单：需要什么、什么情绪、口味、预算、档位 */
  function brief(directorId, cause = []) {
    const prefs = {};
    for (const f of FIELDS) prefs[f] = notes[f]?.value ?? DEFAULT_VALUE;
    const b = {
      director: directorId,
      need: notes.need?.value ?? '',
      emotion: notes.emotion?.value ?? '悲悯',
      prefs,
      budget: budgetNow,
      tiers: TIERS,
    };
    const seqs = FIELDS.map((f) => notes[f]?.seq);
    const e = write(
      'mentor.brief',
      b,
      [...cause, ...seqs, allotSeq],
      `我把“${b.emotion}”这个口味交给${directorId}，预算 ${budgetNow}，你说过的地方我都记着。`,
      directorId ? `director:${directorId}` : 'world',
    );
    return { brief: b, seq: e.seq };
  }

  /**
   * 从玩家的反应里学口味。只改没被用户亲手改过的字段。
   * signal = { kind, beat }。没有规则的信号（如“停顿”）返回 null。
   */
  function learn(signal = {}, userSeq) {
    const rules = LEARN_RULES[signal.kind];
    if (!rules) return null;
    let last = null;
    for (const [field, delta] of rules) {
      const cur = notes[field] ?? { value: DEFAULT_VALUE, source: '观察', seq: null };
      if (cur.source === '你改的') continue;
      const before = cur.value;
      const after = round2(clamp(before + delta));
      const e = write(
        'mentor.learn',
        { field, before, after, signal: signal.kind, beat: signal.beat },
        [userSeq],
        LEARN_SAID[signal.kind],
      );
      notes[field] = { value: after, source: '观察', seq: e.seq };
      last = e.seq;
    }
    return last;
  }

  /** 导演想改导师的规则或笔记：拒绝，并写下拒绝记录（to 指向提出者） */
  function guard(action, by) {
    // 没有可追溯的锚点时，退回账本里最近一条用户记录，保证 cause 能走到用户
    const userEntry = ledger.entries.filter((x) => x.from === 'user').pop();
    const link = anchor ?? userEntry?.seq;
    const e = write(
      'mentor.refuse',
      { attempted: action, by, reason: '导师的分配规则和笔记只听用户，导演不能改。' },
      link !== undefined ? [link] : [],
      '这是我的规则，不归导演改。',
      by,
    );
    return e.seq;
  }

  function state() {
    return JSON.parse(JSON.stringify({
      notes, chosen, spent, director, allotSeq, anchor, budget: budgetNow,
    }));
  }

  return {
    def,
    budget: budgetNow,
    meet,
    notes: snapshotNotes,
    editNote,
    allot,
    chooseDirector,
    brief,
    learn,
    guard,
    state,
  };
}
