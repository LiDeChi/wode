// 第三阶段：模拟玩家与地板检查（docs/KERNEL.md §6）。
//
// 这里只用《窃符》的公共 API：createPlay 的 begin / next / choose / watch / ask / chooseKeeper /
// view / state，加上 play.js 的 estimateSeconds。不 import 内核、不 import 场景表、不认某一幕的名字，
// 所以内核抽完之后、以及后面两个新组合（被偷听、押粮）接进来之后，
// 同一套地板检查自动把它们也覆盖到——只要那个场景经 createPlay 出场。
//
// 四种玩家不是四段写死的脚本，而是四条“看着 view().options 做决定”的规则，
// 判断只靠选项自己的 id / verb / line 这些确定性特征：
//   curious    先看心思再动：这一幕的人没看全就先看，看完再问一句，最后才动手
//   hasty      直接动手：第一个能选的（wait 除外）就选，不看心思也不追问
//   loyal      总选讲义的：选项里读得出「义」的就选它；读不出来走稳妥路线（夜里先递令牌再挪）
//   contrarian 总选反着来：反过来挑最后一个能选的；进粮仓先把守仓人换成另一个
//
// 地板（§6）：
//   没有死路             任何时刻 view().options 里至少有一个 allowed（wait 永远可选）
//   三种结局都走得到      history / jinbi-lives / broken（外加对取符之夜做有限深度枚举）
//   一种诉求说服不了所有人 sameAppealWinsAll 必须是 false
//   一局 8–12 分钟        estimateSeconds 的 min/max 落在这个区间

import { createPlay, estimateSeconds } from './play.js';
import { makeRng } from '../core/rng.js';

/** 见导师时说的那句话（和对照组 tests/fixtures/play-scripts.mjs 一致，玩家画像才可比） */
export const NEED = '我想看一个人在乱世里怎么做选择';

/** 两位导演的偏好：A 陆导爱雕琢、B 单导爱放开（同 tests/fixtures/play-scripts.mjs 的 ANSWERS） */
export const ANSWERS = {
  A: { wait: 0.8, polish: 0.8, depth: 0.85 },
  B: { wait: 0.2, polish: 0.2, depth: 0.25 },
};

/** 一局的时长地板：8–12 分钟（秒） */
export const FLOOR_SECONDS = { min: 8 * 60, max: 12 * 60 };

/** 一局最多几个决定，防死循环（正常一局 10–20 个） */
const MAX_STEPS = 80;
/** 取符之夜的有限深度枚举：最多探这么多步、最多重放这么多次（夜里本来就有天亮的步数上限） */
const NIGHT_DEPTH = 14;
const NIGHT_BUDGET = 800;
/** 结局只有这三种（play.js 的 coda 里定） */
const ENDINGS = ['history', 'jinbi-lives', 'broken'];
/** 地板检查用的种子：同一个种子永远同一个世界 */
const SEEDS = [1, 2, 3, 7, 11];
/** 四种诉求 */
const APPEALS = ['义', '利', '惧', '恩'];

/* ------------------------------------------------------------------ *
 * 选项的确定性特征
 * ------------------------------------------------------------------ */

// 诉求在选项上留下的确定痕迹：先认 id（场景作者写的 token），再认台词里说出口的那个字。
// 「义」还把点着人情的那几句（不薄 / 缘故 / 不送 / 侯生 / 侯嬴）算进来：
// 说的都是同一路诉求，才谈得上“一种诉求能不能说服所有人”。
// 换新场景只要照着写特征，判断逻辑不用动；认不出来的选项不归任何一路。
const APPEAL_FEATURE = {
  义: { ids: ['yi'], re: /义|不薄|缘故|不送|侯生|侯嬴/ },
  利: { ids: ['li'], re: /利/ },
  惧: { ids: ['ju', 'fear', 'king'], re: /惧|畏/ },
  恩: { ids: ['en'], re: /恩/ },
};

function appealOf(option) {
  const id = String(option?.id || '');
  for (const a of APPEALS) if (APPEAL_FEATURE[a].ids.includes(id)) return a;
  const line = String(option?.line || '');
  for (const a of APPEALS) if (APPEAL_FEATURE[a].re.test(line)) return a;
  return null;
}

const allowedOptions = (v) => (v.options || []).filter((o) => o.allowed !== false);
const isActView = (v) => v.stage === 'act' || v.stage === 'granary';

/** 第一个能动的选项（wait 除外）；全是 wait 就还是 wait */
const pickFirst = (opts) => opts.find((o) => o.verb !== 'wait') || opts[0];
/** 最后一个能动的选项：这就是“反着来” */
function pickLast(opts) {
  const list = opts.filter((o) => o.verb !== 'wait');
  if (list.length) return list[list.length - 1];
  return opts[opts.length - 1];
}
/** 用种子随机挑一个能动的选项（重放得出同一个世界） */
function pickRng(opts, rng) {
  const list = opts.filter((o) => o.verb !== 'wait');
  const pool = list.length ? list : opts;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/* ------------------------------------------------------------------ *
 * 走一局
 * ------------------------------------------------------------------ */

function freshMemo(seed) {
  return { rng: makeRng(seed ?? 1), lastPos: null, lastChoice: null, nightStalled: false, switchedKeeper: false };
}

/**
 * 带格子的一幕（view().night）怎么走：先把能出手的东西递出去，再往前走；
 * 上一步没挪动（被人挡住）就停一拍，等下一拍再挪。不认幕的名字，只认“这一幕有没有格子”。
 */
function nightPick(v, memo) {
  const opts = allowedOptions(v);
  const n = v.night || {};
  if (memo.lastChoice === 'wait') memo.nightStalled = false;
  else if (memo.lastPos !== null && memo.lastPos === n.pos && !n.done) memo.nightStalled = true;
  else memo.nightStalled = false;
  memo.lastPos = n.pos;
  const give = opts.find((o) => o.verb === 'give');
  const go = opts.find((o) => o.verb === 'go');
  const wait = opts.find((o) => o.verb === 'wait') || opts[opts.length - 1];
  const id = give && !n.token ? give.id : go && !memo.nightStalled ? go.id : wait.id;
  memo.lastChoice = id;
  return id;
}

/** 按一张“这一幕选什么”的表走；表里没有的幕，格子用稳妥走法，其余挑第一个能动的 */
function planPick(v, opts, plan, memo) {
  const want = plan[v.act];
  if (want && opts.some((o) => o.id === want)) return want;
  if (v.night) return nightPick(v, memo);
  return pickFirst(opts).id;
}

/** 把 planPick 包成 walk 要的“每一步做什么” */
function chooser(plan, memo) {
  return (v, opts) => ({ op: 'choose', id: planPick(v, opts, plan, memo) });
}

/**
 * 走一局。step(view, opts, play) 决定每一步做什么（watch / ask / choose / keeper）。
 * shouldStop 用来到半路停下（枚举取符之夜时，停在那一幕的起点）。
 * 返回 { play, view, acts, path, error }：error 非空就是走不下去——地板检查里的“死路”。
 */
function walk(createSession, answers, step, shouldStop) {
  const s = createSession();
  s.meet(answers, NEED);
  const play = createPlay(s);
  const acts = [];
  const path = [];
  play.begin();
  let v = play.next();
  let guard = 0;
  while (v.stage !== 'done' && guard++ < MAX_STEPS) {
    if (shouldStop && shouldStop(v)) return { play, view: v, acts, path, error: null };
    if (!isActView(v)) { v = play.next(); continue; }
    if (v.done) { v = play.next(); continue; }
    const act = v.act || v.stage;
    const opts = allowedOptions(v);
    acts.push({ act, options: (v.options || []).slice() });
    if (!opts.length) {
      path.push(`${act}:stuck:no-allowed-option`);
      return { play, view: v, acts, path, error: 'no-allowed-option' };
    }
    const action = step(v, opts, play) || {};
    try {
      if (action.op === 'watch') { play.watch(action.person); path.push(`${act}:watch:${action.person}`); v = play.view(); }
      else if (action.op === 'ask') { play.ask(action.person); path.push(`${act}:ask:${action.person}`); v = play.view(); }
      else if (action.op === 'keeper') { v = play.chooseKeeper(action.id); path.push(`${act}:keeper:${action.id}`); }
      else {
        if (!action.id || !opts.some((o) => o.id === action.id)) {
          path.push(`${act}:stuck:choice-not-allowed:${action.id}`);
          return { play, view: v, acts, path, error: `choice-not-allowed:${action.id}` };
        }
        v = play.choose(action.id).view;
        path.push(`${act}:choose:${action.id}`);
      }
    } catch (e) {
      path.push(`${act}:stuck:${e.message}`);
      return { play, view: v, acts, path, error: e.message };
    }
  }
  if (v.stage !== 'done') {
    path.push('stuck:step-limit');
    return { play, view: v, acts, path, error: 'step-limit' };
  }
  return { play, view: v, acts, path, error: null };
}

/* ------------------------------------------------------------------ *
 * 四种玩家
 * ------------------------------------------------------------------ */

export const PERSONAS = {
  curious: {
    id: 'curious',
    label: '先看心思再动',
    next(v, opts, play, memo) {
      const people = (v.people || []).map((p) => p.id);
      const unwatched = people.filter((id) => !(v.watched || []).includes(id));
      if (unwatched.length) return { op: 'watch', person: unwatched[0] };
      const unasked = people.filter((id) => !(v.asked || []).includes(id));
      if (unasked.length) return { op: 'ask', person: unasked[0] };
      if (v.night) return { op: 'choose', id: nightPick(v, memo) };
      return { op: 'choose', id: pickRng(opts, memo.rng).id };
    },
  },
  hasty: {
    id: 'hasty',
    label: '直接动手',
    next(v, opts) {
      return { op: 'choose', id: pickFirst(opts).id };
    },
  },
  loyal: {
    id: 'loyal',
    label: '总选讲义的',
    next(v, opts, play, memo) {
      const yi = opts.find((o) => appealOf(o) === '义');
      if (yi) return { op: 'choose', id: yi.id };
      if (v.night) return { op: 'choose', id: nightPick(v, memo) };
      return { op: 'choose', id: pickFirst(opts).id };
    },
  },
  contrarian: {
    id: 'contrarian',
    label: '总选反着来',
    next(v, opts, play, memo) {
      // 粮仓默认是守仓人·老秦；反着来的人先把人换成另一个，再看同一件东西会怎样
      const g = v.granary;
      if (g && g.phase === 'inspect' && !memo.switchedKeeper) {
        const other = (g.keepers || []).find((k) => k.id !== g.keeper);
        if (other) { memo.switchedKeeper = true; return { op: 'keeper', id: other.id }; }
      }
      return { op: 'choose', id: pickLast(opts).id };
    },
  },
};

/**
 * 让一个模拟玩家替你把一局走完。
 * 返回 { ending, seconds, path, stuck }：stuck 为 true 表示半路走不下去（没有死路的地板就被打破了）。
 */
export function simulate(createSession, opts = {}) {
  const answers = opts.answers || ANSWERS.A;
  const name = PERSONAS[opts.persona] ? opts.persona : 'curious';
  const persona = PERSONAS[name];
  const memo = freshMemo(opts.seed);
  const r = walk(createSession, answers, (v, o, play) => persona.next(v, o, play, memo), null);
  const st = r.play.state();
  return {
    ending: st.ending || null,
    seconds: estimateSeconds(r.play),
    path: r.path,
    stuck: !!r.error || st.stage !== 'done',
  };
}

/* ------------------------------------------------------------------ *
 * 地板检查
 * ------------------------------------------------------------------ */

/** 这一句到达那个人身上，是被接受还是被顶回来；读不出来返回 null（当作没被接受） */
function readAccepted(play, person) {
  if (!person) return null;
  try {
    const w = play.watch(person);
    if (w.last && typeof w.last.accepted === 'boolean') return w.last.accepted;
  } catch (e) { /* 这一幕没给看心思的入口 */ }
  try {
    const a = play.ask(person);
    if (/说到我心里去了/.test(a.answer)) return true;
    if (/不懂我在想什么/.test(a.answer)) return false;
  } catch (e) { /* 同上 */ }
  return null;
}

/**
 * 一种诉求算不算“说服所有人”：要同时满足两条——
 *   1) 每一幕（每一幕 = 有诉求可说出口的那些幕）里都拿得出这种诉求；
 *   2) 每一幕里能说这种诉求的每一个选项，都被接受（同一种诉求对不同的人说，也得人人都吃）。
 * 两条都满足才算 true；这个地板要求它是 false（§6）。
 * 这一轮用 B（动词给得最全）来探，保证每一句都拿得出手；读不出接受与否的也算没被接受。
 */
function probeAppeals(createSession, answers) {
  const survey = walk(createSession, answers, chooser({}, freshMemo('survey')), null);
  const appealActs = new Set();
  const cases = [];
  for (const rec of survey.acts) {
    const carrying = rec.options.filter((o) => appealOf(o));
    if (carrying.length) appealActs.add(rec.act);
    for (const o of carrying) cases.push({ appeal: appealOf(o), act: rec.act, id: o.id, to: o.to || null });
  }

  const stats = {};
  for (const a of APPEALS) stats[a] = { acts: new Set(), checked: 0, refused: 0 };
  const detail = [];
  for (const c of cases) {
    const plan = {};
    for (const rec of survey.acts) {
      const first = rec.options.filter((o) => o.allowed !== false && appealOf(o) === c.appeal)[0];
      plan[rec.act] = first ? first.id : null;
    }
    plan[c.act] = c.id;
    const accepted = probeChoice(createSession, answers, plan, c.act, c.to);
    stats[c.appeal].acts.add(c.act);
    stats[c.appeal].checked += 1;
    if (accepted !== true) stats[c.appeal].refused += 1;
    detail.push({ appeal: c.appeal, act: c.act, id: c.id, to: c.to, accepted });
  }

  let sameAppealWinsAll = false;
  const table = {};
  for (const a of APPEALS) {
    const s = stats[a];
    const everywhere = appealActs.size > 0 && [...appealActs].every((act) => s.acts.has(act));
    const scanned = s.checked > 0 && s.refused === 0;
    table[a] = { acts: [...s.acts], checked: s.checked, refused: s.refused, everywhere, scanned };
    if (everywhere && scanned) sameAppealWinsAll = true;
  }
  return { sameAppealWinsAll, acts: [...appealActs], table, detail };
}

/** 按表走一局，走到 targetAct 做完那次选择就回来读“被不被接受” */
function probeChoice(createSession, answers, plan, targetAct, person) {
  const s = createSession();
  s.meet(answers, NEED);
  const play = createPlay(s);
  const memo = freshMemo('probe');
  play.begin();
  let v = play.next();
  let guard = 0;
  while (v.stage !== 'done' && guard++ < MAX_STEPS) {
    if (!isActView(v)) { v = play.next(); continue; }
    if (v.done) { v = play.next(); continue; }
    const opts = allowedOptions(v);
    if (!opts.length) return null;
    const act = v.act;
    const want = plan[act];
    const usable = !!want && opts.some((o) => o.id === want);
    if (act === targetAct && !usable) return null; // 想说的这句这一幕拿不出来，就当它没被接受
    const id = usable ? want : v.night ? nightPick(v, memo) : pickFirst(opts).id;
    v = play.choose(id).view;
    if (act === targetAct) return readAccepted(play, person);
  }
  return null;
}

/* ---------------- 取符之夜的有限深度枚举 ---------------- */

/** 走到那一幕的起点（带格子的一幕），再把给定的走法接上去 */
function nightBase(createSession, answers, moves) {
  const base = walk(createSession, answers, chooser({}, freshMemo('night')), (v) => !!v.night);
  if (base.error || !base.view.night) return { error: base.error || 'night-not-open', view: base.view, play: base.play };
  let v = base.view;
  for (const m of moves) {
    if (v.done) break;
    const opts = allowedOptions(v);
    if (!opts.some((o) => o.id === m)) return { error: `not-allowed:${m}`, view: v, play: base.play };
    v = base.play.choose(m).view;
  }
  return { error: null, view: v, play: base.play };
}

/** 夜里此刻的状态指纹：只留会影响后面的事，用它去重，枚举才不会爆炸 */
function nightSig(v) {
  const n = v.night || {};
  return [n.pos, n.step, n.token || '-', n.aAlert ? 1 : 0, n.bLooksAway ? 1 : 0, n.rujiReady ? 1 : 0, n.seen ? 1 : 0].join('|');
}

/** 这一夜走完了，接下来那一幕的每一种选择各走一次，看结局落在哪边 */
function yeEnding(createSession, answers, moves, yeId) {
  const base = nightBase(createSession, answers, moves);
  if (base.error || !base.view.done) return null;
  const play = base.play;
  const v = play.next();
  const opts = allowedOptions(v);
  const id = opts.some((o) => o.id === yeId) ? yeId : opts[0]?.id;
  if (!id) return null;
  play.choose(id);
  play.next(); // 拉远：结局长在 coda 里
  return play.state().ending || null;
}

/**
 * 对带格子的那一幕做有限深度枚举：每一步都从当下 allowed 的选项里分支，
 * 用状态指纹去重（同一个局面不再重复探），所以是有限的、也是确定的。
 * 返回 { fates, endings, deadEnds }。
 */
function enumerateNight(createSession, answers) {
  const fates = new Set();
  const endings = new Set();
  const deadEnds = [];
  const seen = new Set(['start']);
  let frontier = [{ moves: [] }];
  let budget = NIGHT_BUDGET;

  const terminal = (base, moves) => {
    const fate = base.play.state().flags.night;
    fates.add(fate);
    if (fate !== 'clean') { endings.add('broken'); return; }
    const yeView = base.play.next(); // 只用它读这一幕有哪些选项
    for (const o of allowedOptions(yeView)) {
      const e = yeEnding(createSession, answers, moves, o.id);
      if (e) endings.add(e);
    }
  };

  for (let depth = 0; depth < NIGHT_DEPTH && frontier.length; depth++) {
    const next = [];
    for (const node of frontier) {
      const base = nightBase(createSession, answers, node.moves);
      if (base.error) { deadEnds.push({ moves: node.moves.join('>'), error: base.error }); continue; }
      if (base.view.done) { terminal(base, node.moves); continue; }
      for (const o of allowedOptions(base.view)) {
        if (budget-- <= 0) break;
        const moves = [...node.moves, o.id];
        const child = nightBase(createSession, answers, moves);
        if (child.error) { deadEnds.push({ moves: moves.join('>'), error: child.error }); continue; }
        if (child.view.done) { terminal(child, moves); continue; }
        const sig = nightSig(child.view);
        if (seen.has(sig)) continue;
        seen.add(sig);
        next.push({ moves });
      }
    }
    frontier = next;
  }
  return { fates, endings, deadEnds };
}

/* ---------------- 地板检查 ---------------- */

/**
 * 把地板逐条跑一遍：
 *   两套导演偏好 × 四种玩家 × 若干种子走满一局；再对带格子的那一幕做有限深度枚举。
 * 返回 { deadEnds, endings, sameAppealWinsAll, seconds:{min,max}, ok }。
 * endings 是走到的次数（> 0 就是走得到；有限枚举至少记 1 次）。
 */
export function floorChecks(createSession) {
  const deadEnds = [];
  const endings = { history: 0, 'jinbi-lives': 0, broken: 0 };
  const seconds = [];

  for (const dir of ['A', 'B']) {
    for (const persona of Object.keys(PERSONAS)) {
      for (const seed of SEEDS) {
        const r = simulate(createSession, { answers: ANSWERS[dir], persona, seed });
        if (r.stuck) deadEnds.push({ answers: dir, persona, seed, where: r.path[r.path.length - 1] || null, path: r.path.slice(-4) });
        if (endings[r.ending] !== undefined) endings[r.ending] += 1;
        seconds.push(r.seconds);
      }
    }
  }

  const night = enumerateNight(createSession, ANSWERS.B);
  for (const d of night.deadEnds) deadEnds.push({ answers: 'B', persona: 'enumeration', seed: null, where: d.error, path: [d.moves] });
  for (const e of night.endings) if (endings[e] === 0) endings[e] = 1;

  const { sameAppealWinsAll } = probeAppeals(createSession, ANSWERS.B);

  const sec = {
    min: seconds.length ? Math.min(...seconds) : 0,
    max: seconds.length ? Math.max(...seconds) : 0,
  };
  const ok = deadEnds.length === 0
    && ENDINGS.every((e) => endings[e] > 0)
    && sameAppealWinsAll === false
    && sec.min >= FLOOR_SECONDS.min
    && sec.max <= FLOOR_SECONDS.max;

  return { deadEnds, endings, sameAppealWinsAll, seconds: sec, ok };
}
