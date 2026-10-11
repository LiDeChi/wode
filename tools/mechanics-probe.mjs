#!/usr/bin/env node
// 玩法体检探针（t23 起，t32 按 MECHANICS 的 M2 口径扩写）：只读，不改任何 shared/**、不跑 tests/。
//
// 目的：把《窃符》四幕 + 暮色粮仓的机制现状量成数字，给「先打磨玩法」当依据。
// 它只做两件事：用 createPlay 的公共 API 把一局走完，然后读账本（session.ledger.entries）。
// 不 import 内核，不 import 私有的 walk/planPick；人格与地板检查直接复用 shared/engine/simulate.js。
//
// 量什么：
//   grants    两位导演在每一幕到底授予了哪些动词，哪些选项在画面上就被挡掉
//   space     全组合枚举（5 大梁 × 4 夷门 × 4 夜路 × 4 邺城 × 2 导演）的结局与每一步的裁决
//   golden    重放 tests/fixtures/play-scripts.mjs 的 680 个对照脚本，数结局与 null 卡在哪
//   acceptance 每一幕每个选项被接受的比例，按导演、按角色拆；诉求标签**从场景数据里读**，不手抄
//   strategy  命名策略（永远说义/利/惧/恩/等、四种人格）的结局分布
//   cross     大梁 / 夷门的选择对夜里、邺城、结局的影响量
//   dead      死选项：换一个选项、后面一切都一样的情况有多少（投影见 §4 口径）
//   learn     每一幕玩家能看见的反馈（tell / 结局文案 / 追问的那句话）
//   rhythm    每局步数与 estimateSeconds 秒数，地板 8–12 分钟满不满足
//   matrix    九人 × 四诉求的纯矩阵 + 强度×信任扫描（MECHANICS §1：每一列 ≤ 一半）
//   door      门前那一拍：同一串夜路只差夷门那一手，进夜时她犹不犹豫
//   routes    12 条命名路线的重跑（与 tests/fixtures 里的金标准对得上吗）
//   goldenDiff 旧 680 的差异分类：A 类是读数文字（t33），B 类是玩法数据（t13）
//
// 用法：
//   node tools/mechanics-probe.mjs                  # 可读表格打到 stdout
//   node tools/mechanics-probe.mjs --json           # 同一份数据以 JSON 打到 stdout
//   node tools/mechanics-probe.mjs --json out.json  # 写到一个文件（默认不写盘）
//   node tools/mechanics-probe.mjs --section dead   # 只看某一节
// 也可以 import：runPlan / playNight / nightGraph / nightStartStates / hesitationScan /
//   granaryGrid / SPACE / appealMatrix / appealScan / appealAudit / doorPair / routeCheck /
//   hesitationPairs / goldenDiff（t24 的取样就是走这些）。

import { createSession } from '../shared/engine/session.js';
import { createPlay, estimateSeconds, ACT_ORDER, EST_SECONDS } from '../shared/engine/play.js';
import { createMind } from '../shared/core/mind.js';
import { NEED, ANSWERS, simulate, FLOOR_SECONDS } from '../shared/engine/simulate.js';
import { QIFU_SCENES, QIFU_CONTROLLERS } from '../shared/scenes/qiefu.js';
import { WEICHENG_SCENES } from '../shared/scenes/weicheng.js';
import { QIFU_SCENES as V1_QIFU_SCENES } from '../tests/fixtures/scenes-v1-qiefu.mjs';
import { scripts as goldenScripts, runScript } from '../tests/fixtures/play-scripts.mjs';
import { ROUTES as ROUTE_TABLE } from '../tests/fixtures/play-mechanics-v2-scripts.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OLD_GOLDEN = new URL('../tests/fixtures/play-golden.json', import.meta.url);

const PLAYER = 'actor:player';

/* ------------------------------------------------------------------ *
 * 标签：选项 → 诉求
 * ------------------------------------------------------------------ */

// appeal 不在 view().options 里，所以只能从场景数据里读。**不再手抄**：探针 import 时把每一幕控制器
// 配置里带 appeal 的选项收进来（speech/lines 用 cfg.options，standing 用 cfg.targets），
// 场景改了（比如邺城新加一个说「利」的选项）这里一个字都不用改。
// 场景里的 appeal 是一个分布（如 {义:0.8}），探针关心的是主诉求那一个字（旧的 APPEAL 表就是这个形状）
const dominantAppeal = (a) => {
  if (!a || typeof a !== 'object') return null;
  let best = null;
  let w = -1;
  for (const [k, v] of Object.entries(a)) if (v > w) { best = k; w = v; }
  return best;
};

function readSceneOptions(actId) {
  const scene = QIFU_SCENES[actId];
  const out = new Map();
  const eat = (list) => {
    for (const o of list || []) {
      if (!o || !o.id) continue;
      out.set(o.id, {
        id: o.id, verb: o.verb ?? null, to: o.to ?? null, item: o.item ?? null,
        line: o.line ?? '', appeal: dominantAppeal(o.appeal), appealWeights: o.appeal ?? null,
        needs: o.needs ? [...o.needs] : [],
      });
    }
  };
  for (const c of scene?.controllers || []) {
    const cfg = Array.isArray(c) ? c[1] : c;
    if (!cfg || typeof cfg !== 'object') continue;
    eat(cfg.options);
    eat(cfg.targets);
  }
  // 取符之夜自己的五个动作不在控制器配置里，问控制器要（问不到就退回一张固定表）
  if (actId === 'night') {
    let intents = [];
    try { intents = QIFU_CONTROLLERS?.nightwalk?.()?.intents?.() || []; } catch { intents = []; }
    if (!intents.length) intents = ['step', 'rush', 'token_b', 'token_a', 'wait'].map((id) => ({ id }));
    eat(intents);
  }
  const wait = scene?.wait;
  if (wait?.id && !out.has(wait.id)) out.set(wait.id, { id: wait.id, verb: wait.verb ?? 'wait', to: null, item: null, line: wait.line ?? '', appeal: null, needs: [] });
  if (!out.has('wait')) out.set('wait', { id: 'wait', verb: 'wait', to: null, item: null, line: '', appeal: null, needs: [] });
  return out;
}

export const SCENE_OPTIONS = Object.fromEntries(['daliang', 'yimen', 'night', 'ye'].map((a) => [a, readSceneOptions(a)]));
export const APPEAL = Object.fromEntries(Object.entries(SCENE_OPTIONS).map(([a, m]) => [a, Object.fromEntries([...m.values()].filter((o) => o.appeal).map((o) => [o.id, o.appeal]))]));
export const SCENE_NOTE = Object.fromEntries(Object.entries(SCENE_OPTIONS).map(([a, m]) => [a, [...m.values()].map((o) => (o.appealWeights ? `${o.id}=${Object.entries(o.appealWeights).map(([k, v]) => `${k}.${v}`).join('+')}` : o.id))]));
/** 《窃符》这一场的九个人：从场景数据里取，不手抄（别把 session 里其他人算进来） */
export const NINE = Object.keys(QIFU_SCENES.daliang.cast || {});

// shared/engine/simulate.js:56-61 的特征表（探针抄一份，只为了说清「loyal 人格实际会挑哪一个」，
// 因为它才是「永远说义」那条策略的真实实现）。
const APPEAL_FEATURE = {
  义: { ids: ['yi'], re: /义|不薄|缘故|不送|侯生|侯嬴/ },
  利: { ids: ['li'], re: /利/ },
  惧: { ids: ['ju', 'fear', 'king'], re: /惧|畏/ },
  恩: { ids: ['en'], re: /恩/ },
};
function personaAppealOf(opt) {
  const id = String(opt?.id || '');
  for (const a of Object.keys(APPEAL_FEATURE)) if (APPEAL_FEATURE[a].ids.includes(id)) return a;
  const line = String(opt?.line || '');
  for (const a of Object.keys(APPEAL_FEATURE)) if (APPEAL_FEATURE[a].re.test(line)) return a;
  return null;
}

/* ------------------------------------------------------------------ *
 * 走一局（只读，带仪表）
 * ------------------------------------------------------------------ */

const NIGHTS = {
  clean: ['step', 'token_b', 'rush', 'step'],
  seen: ['step', 'step'],
  tokenA: ['token_a'],
  slow: ['step', 'token_b', 'wait', 'step', 'wait', 'step', 'step'],
};
// 每一幕试哪些选项：从场景数据派生（邺城 t13 新加的 li 会自动进来，不用改这里）
const idsOf = (act) => [...SCENE_OPTIONS[act].keys()];
const DALIANG = idsOf('daliang');
const YIMEN = idsOf('yimen');
const YE = idsOf('ye');
const NIGHT_IDS = idsOf('night');
const MAX_STEPS = 120;

/** 上一个动作没挪动就等一拍；否则一直往前挪（和 simulate.js 的 nightPick 同思路） */
function nightFallback(v, memo) {
  const opts = (v.options || []).filter((o) => o.allowed !== false);
  const n = v.night || {};
  const give = opts.find((o) => o.verb === 'give');
  const go = opts.find((o) => o.verb === 'go');
  const wait = opts.find((o) => o.verb === 'wait') || opts[opts.length - 1];
  if (memo.lastPos !== null && memo.lastPos === n.pos && !n.done) return wait.id;
  if (give && !n.token) return give.id;
  return go ? go.id : wait.id;
}

function newReacts(session, from) {
  return session.ledger.entries.slice(from).filter((e) => e.kind === 'actor.react').map((e) => e.payload);
}
const reactOf = (payloads, option) => payloads.find((p) => p.option === option) || null;

/**
 * 按一张表走完一局。plan = { daliang, yimen, night:[id…], ye, granary:{keeper,inspect,decide} }。
 * 想选的选项被导演挡掉（allowed:false）或已经做过（refused）时，记下来再退到 wait/默认走法，
 * 保证一局能走到头——这样「挡掉」和「选起来没差别」才是两回事。
 */
export function runPlan(dir, plan) {
  const s = createSession();
  s.meet(ANSWERS[dir], NEED);
  const p = createPlay(s);
  const rec = { dir, plan, ending: null, stage: null, days: null, flags: null, steps: 0, seconds: 0, acts: {}, stuck: null };
  const memo = { lastPos: null };
  let nightIdx = 0;
  let guard = 0;

  p.begin();
  let v = p.next();
  const advance = () => {
    while ((v.stage === 'act' || v.stage === 'granary') && v.done) v = p.next();
    if (v.stage === 'coda') v = p.next();
  };
  advance();

  const doChoose = (act, want) => {
    const inList = (v.options || []).some((o) => o.id === want);
    const allowedOpt = (v.options || []).some((o) => o.id === want && o.allowed !== false);
    const blocked = inList && !allowedOpt;   // 画面上看得见，导演没授予（视口里 allowed:false）
    const filtered = !inList;                // 画面根本不给你这个选项（optionsWhen 收掉了）
    const from = s.ledger.entries.length;
    let r = null;
    let err = null;
    try { r = p.choose(want); } catch (e) { err = e.message; }
    if (err) {                               // 闸门挡掉：退到 wait（wait 永远可选）
      const wait = (v.options || []).find((o) => o.verb === 'wait' && o.allowed !== false);
      if (!wait) { rec.stuck = `${act}:${want}:${err}`; return false; }
      try { r = p.choose(wait.id); } catch (e2) { rec.stuck = `${act}:${wait.id}:${e2.message}`; return false; }
    }
    const reacts = newReacts(s, from);
    const info = reactOf(reacts, want) || reactOf(reacts, 'wait') || reacts[0] || null;
    v = r.view;
    return { blocked, filtered, refused: !!r.refused, info, person: (r.view.log || []).slice(-1)[0]?.person ?? info?.person ?? null, text: v.outcome?.text ?? null, done: !!v.done, view: v, error: err, offered: (r.view.options || []).length };
  };

  while (v.stage !== 'done' && guard++ < MAX_STEPS) {
    if (v.stage === 'act') {
      const act = v.act;
      let want = null;
      if (act === 'night') want = plan.night[nightIdx++] ?? nightFallback(v, memo);
      else want = plan[act] ?? 'wait';
      if (v.night) memo.lastPos = v.night.pos ?? null;
      const r = doChoose(act, want);
      if (!r) break;
      rec.steps += 1;
      if (act === 'night') {
        const cur = (rec.acts.night ||= { moves: [], seen: null, done: false, rujiReady: null, hesitant: null, tell: null, text: null, reason: null });
        cur.moves.push(`${want}${r.blocked ? '(挡)' : r.filtered ? '(没给出)' : ''}${r.refused ? '(已出手)' : ''}`);
        const n = v.night || {};
        cur.seen = n.seen; cur.done = n.done; cur.rujiReady = n.rujiReady; cur.hesitant = n.hesitant; cur.reason = n.reason || null;
        cur.tell = (v.log || []).slice(-1)[0]?.tell ?? cur.tell;
        cur.text = v.outcome?.text ?? cur.text;
      } else {
        rec.acts[act] = {
          want, blocked: r.blocked, filtered: r.filtered, refused: r.refused, error: r.error, text: r.text,
          accepted: r.info?.accepted ?? null, moved: r.info?.moved ?? null, bar: r.info?.bar ?? null,
          stoppedAt: r.info?.stoppedAt ?? null, reaction: r.info?.action ?? null,
          tell: (v.log || []).slice(-1)[0]?.tell ?? null,
          trust: r.info?.trust ?? null, appeal: APPEAL[act]?.[want] ?? null, to: r.person,
          choice: p.state().acts[act]?.choice ?? null,
        };
      }
    } else if (v.stage === 'granary') {
      const g = plan.granary || {};
      const phase = v.granary?.phase;
      const want = phase === 'inspect' ? (g.inspect || 'seal') : (g.decide || 'report');
      if (g.keeper && v.granary?.keeper !== g.keeper) { v = p.chooseKeeper(g.keeper); }
      const r = doChoose('granary', want);
      if (!r) break;
      rec.steps += 1;
      const cur = (rec.acts.granary ||= { keeper: v.granary?.keeper, tries: [], decision: null, text: null, verdict: null, tell: null });
      if (phase === 'inspect') {
        cur.tries.push({ item: want, tell: (v.log || []).slice(-1)[0]?.tell ?? null, keeperAct: r.info?.action ?? null, stoppedAt: r.info?.stoppedAt ?? null });
        cur.tell = (v.log || []).slice(-1)[0]?.tell ?? cur.tell;
      } else {
        cur.decision = want; cur.text = r.text;
        const ver = s.ledger.entries.filter((e) => e.kind === 'director.approve' || e.kind === 'director.refuse').slice(-1)[0];
        cur.verdict = ver ? ver.kind.replace('director.', '') : null;
      }
    } else if (v.stage === 'coda') { break; }
    advance();
  }

  const st = p.state();
  rec.stage = st.stage;
  rec.ending = st.ending || null;
  rec.days = st.days;
  rec.flags = { ...st.flags };
  rec.rujiTrust = trustOf(s, 'ruji');
  rec.xinlingTrust = trustOf(s, 'xinling');
  rec.seconds = estimateSeconds(p);
  rec.grants = null;
  return rec;
}

function trustOf(session, id) {
  const t = session.minds?.[id]?.state?.trust?.[PLAYER];
  return typeof t === 'number' ? Math.round(t * 1000) / 1000 : null;
}

/* ------------------------------------------------------------------ *
 * 各节数据
 * ------------------------------------------------------------------ */

/** 每一幕每位导演授予了什么动词、哪些选项在画面上就被挡掉（走一局，逐幕记） */
function collectGrants() {
  const out = [];
  for (const dir of ['A', 'B']) {
    const s = createSession();
    s.meet(ANSWERS[dir], NEED);
    const p = createPlay(s);
    p.begin();
    let v = p.next();
    const adv = () => { while ((v.stage === 'act' || v.stage === 'granary') && v.done) v = p.next(); if (v.stage === 'coda') v = p.next(); };
    adv();
    const seen = new Set();
    let guard = 0;
    let nIdx = 0;
    while (v.stage !== 'done' && guard++ < 60) {
      const act = v.act || v.stage;
      if (!seen.has(act)) {
        seen.add(act);
        out.push({
          dir, act, level: v.grants?.level ?? null, verbs: v.grants?.verbs || [],
          options: (v.options || []).map((o) => ({ id: o.id, verb: o.verb, allowed: o.allowed !== false, line: o.line })),
        });
      }
      const opts = (v.options || []).filter((o) => o.allowed !== false);
      const pick = v.act === 'night' ? (nIdx < NIGHTS.clean.length ? NIGHTS.clean[nIdx++] : 'wait') : (opts.find((o) => o.verb !== 'wait') || opts[0]);
      try { v = p.choose(pick).view; } catch (e) { break; }
      adv();
    }
  }
  return out;
}

export const SPACE = () => {
  const runs = [];
  for (const dir of ['A', 'B']) {
    for (const d of DALIANG) for (const y of YIMEN) for (const [nk, moves] of Object.entries(NIGHTS)) for (const e of YE) {
      runs.push(runPlan(dir, { daliang: d, yimen: y, night: moves, ye: e, granary: { keeper: 'keeper_doubt', inspect: 'seal', decide: 'report' }, id: `${dir}/${d}/${y}/${nk}/${e}` }));
    }
  }
  return runs;
};

export function granaryGrid() {
  const runs = [];
  for (const dir of ['A', 'B']) for (const k of ['keeper_doubt', 'keeper_rash']) for (const i of ['seal', 'note', 'pledge']) for (const dec of ['report', 'witness', 'hide']) {
    runs.push(runPlan(dir, { daliang: 'yi', yimen: 'back', night: NIGHTS.clean, ye: 'yi', granary: { keeper: k, inspect: i, decide: dec }, id: `${dir}/granary/${k}/${i}/${dec}` }));
  }
  return runs;
}

/** 重放 680 个对照脚本（不跑测试框架，只调 fixture 自己的 runScript） */
function goldenReplay() {
  const rows = [];
  for (const script of goldenScripts()) {
    const r = runScript({ createSession, createPlay }, script);
    const firstError = (r.trail || []).find((t) => t.includes('!'));
    rows.push({ id: script.id, dir: script.dir, stage: r.stage, ending: r.ending || null, days: r.days, firstError: firstError || null, trail: r.trail });
  }
  return rows;
}

/** 命名策略 × 导演：结局分布、步数、秒数 */
function strategyGrid() {
  const names = {
    义: { daliang: 'yi', yimen: 'back', ye: 'yi' },
    利: { daliang: 'li', yimen: 'wait', ye: 'wait' },
    惧: { daliang: 'king', yimen: 'fear', ye: 'ju' },
    恩: { daliang: 'wait', yimen: 'wait', ye: 'en' },
    等: { daliang: 'wait', yimen: 'wait', ye: 'wait' },
  };
  const rows = [];
  for (const dir of ['A', 'B']) {
    for (const [name, picks] of Object.entries(names)) {
      const run = runPlan(dir, { ...picks, night: NIGHTS.clean, granary: { keeper: 'keeper_doubt', inspect: 'seal', decide: 'report' }, id: `策略:${name}` });
      rows.push({ dir, kind: 'plan', name, ending: run.ending, steps: run.steps, seconds: run.seconds, acts: actsBrief(run) });
    }
    for (const persona of ['curious', 'hasty', 'loyal', 'contrarian']) {
      for (const seed of [1, 2, 3, 7, 11]) {
        const r = simulate(createSession, { answers: ANSWERS[dir], persona, seed });
        rows.push({ dir, kind: 'persona', name: persona, seed, ending: r.ending, steps: r.path.filter((x) => x.includes(':choose:')).length, seconds: r.seconds, stuck: r.stuck });
      }
    }
  }
  return rows;
}

const actsBrief = (run) => Object.fromEntries(Object.entries(run.acts).map(([k, a]) => [k, k === 'night' ? `${a.moves.join('>')}${a.seen ? '|seen' : '|clean'}` : k === 'granary' ? `${a.decision}:${a.verdict}` : `${a.want}${a.blocked ? '(挡)' : a.filtered ? '(没给出)' : ''}${a.accepted === true ? '✓' : a.accepted === false ? '✗' : ''}${a.choice ? '→' + a.choice : ''}`]));

/* ------------------------------------------------------------------ *
 * 分析
 * ------------------------------------------------------------------ */

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** 一局「后面的一切」：MECHANICS §4 的死选项投影
 *  [结局, 天数, 进夜时她犹不犹豫, 夜里的走法与成没成, 身份高低(公子的信任), 如姬的信任,
 *   邺城接没接受与最后怎么选, 夜干净与否, 猜忌, 粮仓批没批]
 *  故意**不算**：账本 hash / 序号、只有文字没有读取方的 claim、没人读的 flag。 */
const sig = (run) => JSON.stringify([
  run.ending, run.days,
  run.acts?.night?.hesitant ?? null,
  run.acts?.night ? `${run.acts.night.moves.join('>')}${run.acts.night.seen ? '|seen' : '|clean'}` : null,
  run.xinlingTrust, run.rujiTrust,
  run.acts?.ye?.accepted ?? null, run.acts?.ye?.choice ?? null,
  run.flags?.night ?? null, run.flags?.kingSuspicious ?? null,
  run.acts?.granary?.verdict ?? null,
]);

function acceptanceTable(space, granary) {
  const byKey = new Map();
  const note = (dir, act, option, info, label) => {
    const key = `${dir}|${act}|${option}`;
    const cur = byKey.get(key) || { dir, act, option, appeal: label ?? APPEAL[act]?.[option] ?? null, accepted: 0, refused: 0, noAppeal: 0, blocked: 0, filtered: 0, persons: {}, moved: [] };
    if (info?.blocked) cur.blocked += 1;
    else if (info?.filtered) cur.filtered += 1;
    else if (info?.accepted === true) { cur.accepted += 1; cur.persons[info.to] = (cur.persons[info.to] || 0) + 1; }
    else if (info?.accepted === false) { cur.refused += 1; cur.persons[info.to] = (cur.persons[info.to] || 0) + 1; }
    else cur.noAppeal += 1;
    if (typeof info?.moved === 'number') cur.moved.push(info.moved);
    byKey.set(key, cur);
  };
  for (const run of space) for (const [act, a] of Object.entries(run.acts)) {
    if (act === 'night') continue;
    if (act === 'granary') continue;
    note(run.dir, act, a.want, { accepted: a.accepted, to: a.to, blocked: a.blocked, filtered: a.filtered, moved: a.moved });
  }
  for (const run of granary) {
    const g = run.acts.granary;
    for (const t of g.tries) note(run.dir, 'granary', t.item, { accepted: null, to: null, blocked: false, filtered: false, moved: null });
  }
  return [...byKey.values()].map((c) => ({ ...c, n: c.accepted + c.refused, rate: pct(c.accepted, c.accepted + c.refused), movedMin: c.moved.length ? Math.min(...c.moved) : null, movedMax: c.moved.length ? Math.max(...c.moved) : null }));
}

/** 按诉求汇总（每一位导演、每一幕都单独一行） */
function appealTable(accept) {
  const by = new Map();
  for (const c of accept) {
    if (!c.appeal) continue;
    const key = `${c.dir}|${c.act}|${c.appeal}`;
    const cur = by.get(key) || { dir: c.dir, act: c.act, appeal: c.appeal, accepted: 0, refused: 0, options: [] };
    cur.accepted += c.accepted; cur.refused += c.refused; cur.options.push(`${c.option}:${c.rate}%`);
    by.set(key, cur);
  }
  return [...by.values()].map((c) => ({ ...c, n: c.accepted + c.refused, rate: pct(c.accepted, c.accepted + c.refused) }));
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

function table(rows, cols) {
  if (!rows.length) return '(空)';
  const width = cols.map((c) => Math.max(String(c), ...rows.map((r) => String(c.f(r) ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(width[i])).join('  ');
  return [line(cols.map((c) => c.t)), line(width.map((w) => '-'.repeat(w))), ...rows.map((r) => line(cols.map((c) => c.f(r))))].join('\n');
}

function render(data) {
  const out = [];
  const sec = (...t) => { out.push('', `== ${t.join(' ')} ==`); };

  sec('0. 规模');
  out.push(`枚举 ${data.counts.space} 局（2 导演 × 5 大梁 × 4 夷门 × 4 夜路 × 4 邺城）；粮仓网格 ${data.counts.granary} 局；对照脚本 ${data.counts.golden} 个；人格 × 种子 ${data.strategies.filter((s) => s.kind === 'persona').length} 局`);

  sec('1. 导演授予（闸门）');
  for (const g of data.grants) {
    const blocked = g.options.filter((o) => !o.allowed);
    out.push(`${g.dir} ${g.act.padEnd(8)} level=${g.level} verbs=[${g.verbs.join(',')}]  可选(${g.options.length - blocked.length}/${g.options.length}) ${g.options.filter((o) => o.allowed).map((o) => o.id).join(' ')}${blocked.length ? `  被挡: ${blocked.map((o) => `${o.id}(${o.verb})`).join(' ')}` : ''}`);
  }

  sec('2. 诉求胜率（被接受 / 有人可说话的那些局）');
  out.push(table(data.acceptance.filter((c) => c.n > 0), [
    { t: '导演', f: (r) => r.dir }, { t: '幕', f: (r) => r.act }, { t: '选项', f: (r) => r.option }, { t: '诉求', f: (r) => r.appeal ?? '-' },
    { t: '接受', f: (r) => r.accepted }, { t: '拒绝', f: (r) => r.refused }, { t: '胜率%', f: (r) => r.rate },
    { t: '导演没给', f: (r) => r.blocked }, { t: '画面没收', f: (r) => r.filtered }, { t: 'moved', f: (r) => (r.movedMin == null ? '-' : r.movedMin === r.movedMax ? r.movedMin : `${r.movedMin}~${r.movedMax}`) },
  ]));
  out.push('', '按人拆（说话的对象）：');
  out.push(table(data.byPerson, [
    { t: '导演', f: (r) => r.dir }, { t: '幕', f: (r) => r.act }, { t: '选项', f: (r) => r.option }, { t: '对谁', f: (r) => r.person },
    { t: '接受', f: (r) => r.accepted }, { t: '拒绝', f: (r) => r.refused }, { t: '胜率%', f: (r) => r.rate },
  ]));
  out.push('', '按诉求汇总：');
  out.push(table(data.appeals, [
    { t: '导演', f: (r) => r.dir }, { t: '幕', f: (r) => r.act }, { t: '诉求', f: (r) => r.appeal },
    { t: '接受/可试', f: (r) => `${r.accepted}/${r.n}` }, { t: '胜率%', f: (r) => r.rate },
  ]));

  sec('3. 策略与人格');
  out.push(table(data.strategies, [
    { t: '导演', f: (r) => r.dir }, { t: '类', f: (r) => r.kind }, { t: '策略', f: (r) => r.name }, { t: '结局', f: (r) => r.ending ?? 'null' },
    { t: '步', f: (r) => r.steps }, { t: '秒', f: (r) => r.seconds }, { t: '每一幕', f: (r) => (r.acts ? JSON.stringify(r.acts) : r.stuck ? 'stuck' : '') },
  ]));

  sec('4. 跨幕影响');
  for (const dir of ['A', 'B']) {
    const rows = data.cross.filter((c) => c.dir === dir);
    out.push(`导演 ${dir}：`);
    out.push(table(rows, [
      { t: '幕', f: (r) => r.act }, { t: '选项', f: (r) => r.option }, { t: '局数', f: (r) => r.n },
      { t: '夜里被看见%', f: (r) => r.nightSeen }, { t: '如姬犹豫%', f: (r) => r.hesitant }, { t: 'rujiReady%', f: (r) => r.rujiReady },
      { t: '邺城接受%', f: (r) => `${r.yeAccepted}(${r.yeTried})` },
      { t: '如姬信任', f: (r) => r.rujiTrust }, { t: '信陵君信任', f: (r) => r.xinlingTrust },
      { t: '结局 h/l/b', f: (r) => `${r.ending.history || 0}/${r.ending['jinbi-lives'] || 0}/${r.ending.broken || 0}` },
    ]));
  }

  sec('5. 死选项（换选项后，后面一切都没差别）');
  out.push(table(data.dead, [
    { t: '导演', f: (r) => r.dir }, { t: '幕', f: (r) => r.act }, { t: '选项', f: (r) => r.option }, { t: '诉求', f: (r) => r.appeal ?? '-' },
    { t: '与 wait 无差别', f: (r) => `${r.sameDiff.same}/${r.sameDiff.total}` }, { t: '导演没给', f: (r) => r.blocked }, { t: '画面没收', f: (r) => r.filtered },
    { t: '文案数', f: (r) => r.texts }, { t: '结局分布', f: (r) => JSON.stringify(r.endings) },
  ]));

  sec('6. 结局与 null（对照脚本 / 枚举）');
  out.push('对照脚本：', JSON.stringify(data.goldenSummary.endings));
  out.push('走不到结局的：', JSON.stringify(data.goldenSummary.nullByStage));
  out.push('第一个报错的选项：', JSON.stringify(data.goldenSummary.nullByFirstError));
  out.push('枚举：', JSON.stringify(data.spaceSummary.endings), ' 每种结局最少步数：', JSON.stringify(data.minSteps));
  out.push('枚举里被导演挡掉（画面 allowed:false）：', JSON.stringify(data.spaceSummary.blocked));
  out.push('枚举里画面根本没给出（optionsWhen 收掉）：', JSON.stringify(data.spaceSummary.filtered));

  sec('7. 可学性（文本层面能看见什么）');
  for (const l of data.learn) {
    out.push('', `${l.dir} ${l.act}：tell=${JSON.stringify(l.tells)}`);
    for (const [k, text] of Object.entries(l.texts)) out.push(`   ${k} → ${text}`);
    for (const pr of l.probes) out.push(`   追问（${pr.when}｜对 ${pr.person}）：${pr.answer}`);
  }

  sec('8. 节奏');
  out.push(`地板 ${FLOOR_SECONDS.min / 60}–${FLOOR_SECONDS.max / 60} 分钟；枚举秒数 ${data.rhythm.space.min}–${data.rhythm.space.max}；人格秒数 ${data.rhythm.persona.min}–${data.rhythm.persona.max}；步数 ${data.rhythm.steps.min}–${data.rhythm.steps.max}`);
  out.push(`满足地板：枚举 ${data.rhythm.spaceOk}；人格 ${data.rhythm.personaOk}`);
  out.push(`estimateSeconds 的 ACT_ORDER 不含 granary：粮仓 ${FLOOR_SECONDS.granary ?? 150} 秒没算进时长（+150 秒后的范围 ${data.rhythm.space.min + 150}–${data.rhythm.space.max + 150} 秒）`);

  sec('9. 粮仓（开单 / 守仓人 / 推什么 / 怎么定）');
  out.push(table(data.granary.rows, [
    { t: '导演', f: (r) => r.dir }, { t: '守仓人', f: (r) => r.keeper }, { t: '推的东西', f: (r) => r.inspect }, { t: '怎么定', f: (r) => r.decide },
    { t: '裁决', f: (r) => r.verdict }, { t: 'tell', f: (r) => r.tell ?? '-' }, { t: '守仓人的动作', f: (r) => r.keeperAct ?? '-' }, { t: '结局', f: (r) => r.ending },
  ]));
  out.push('', '推的东西换一换，裁决会变吗：');
  for (const [k, v] of Object.entries(data.granary.byVerdict)) out.push(`   ${k} → ${v.variants}  裁决不变=${v.verdictSame}`);
  out.push('', '守仓人的反应：');
  for (const [k, v] of Object.entries(data.granary.keeperReactions)) out.push(`   ${k} → ${v.join(' ／ ')}`);

  sec('10. 取符之夜（能不能不被看见）');
  for (const dir of ['A', 'B']) {
    const n = data.night[dir];
    out.push(`导演 ${dir}：可达状态 ${n.states}（重放 ${n.replays} 次）；终点状态 clean=${n.terminalStates.clean} seen=${n.terminalStates.seen}；最快 clean ${n.minMoves.clean ?? '-'} 步 / seen ${n.minMoves.seen ?? '-'} 步${n.unexplored ? `（还有 ${n.unexplored} 个待展开，被上限截断）` : ''}`);
  }

  sec('11. 夜的开幕状态（前两幕能改变它吗）');
  out.push(`前置组合 ${data.nightStart.total} 种（2 导演 × 5 大梁 × 4 夷门）→ 开幕状态 ${data.nightStart.states.length} 种`);
  for (const s of data.nightStart.states) out.push(`   ${s.state}   ← ${s.n} 种组合，例如 ${s.example}`);

  sec('12. 如姬犹豫的门槛（信任扫一遍）');
  for (const r of data.hesitation) {
    out.push(`   信任 ${r.trust.toFixed(2)}（夜里的恩通道 ${r.en}）→ 记着恩 权重 ${r.debtWeight} vs 顾虑被发现 权重 ${r.riskWeight} → 犹豫=${r.hesitant}；她的心思选了「${r.act}」（停层 ${r.stoppedAt}）`);
  }

  sec('13. 九人 × 诉求的纯矩阵（MECHANICS §1）');
  out.push(`人（从场景 cast 里取，共 ${data.matrix.people.length} 个）：${data.matrix.people.join(' ')}`);
  out.push('强度 .8、各自保留初始信任，单独听一句：');
  for (const [appeal, c] of Object.entries(data.matrix.counts)) {
    out.push(`   ${appeal}：${c.accepted}/${c.n} = ${c.rate}%${c.who.length ? `　${c.who.join(' ')}` : ''}`);
  }
  out.push('', '反噬（不是被拒，是被顶回来）：');
  for (const b of data.matrix.backlash) out.push(`   ${b.id} 听到「${b.appeal}」→ 打动 ${b.moved}（反噬 ${b.backlash}，门槛 ${b.threshold}）`);

  sec('14. 强度 × 信任 扫描（每一个截面上，每一列说服了几个人）');
  for (const c of data.scan.cells) out.push(`   强度 ${c.intensity} 信任 ${c.trust} → 义 ${c.per.义} 利 ${c.per.利} 惧 ${c.per.惧} 恩 ${c.per.恩}　最多 ${c.max}/${data.scan.n}${c.ok ? '' : ' ← 过半了'}（共 ${data.scan.n} 人）`);
  out.push(`最坏一格：${JSON.stringify(data.scan.worst)}；每列 ≤ 一半：${data.scan.ok}`);
  out.push(`画面自检（声明了诉求就必须给得出接受/拒绝）：查了 ${data.audit.checked} 局，对不上 ${data.audit.badCount} 处`);

  sec('15. 门前那一拍（同一串夜路，只差夷门那一手）');
  for (const r of data.door) {
    out.push(`   ${r.yimen}｜${r.name}：进夜时犹豫=${r.hesitant}（如姬信任 ${r.rujiTrust}）→ 夜 ${r.night}，结局 ${r.ending}${r.reason ? `（${r.reason}）` : ''}`);
  }
  out.push('', '40 种前置（夷门那一手 → 进夜时她犹不犹豫）：');
  for (const [k, v] of Object.entries(data.pairs.share)) out.push(`   ${k}：${v.hesitant}%（如姬信任 ${JSON.stringify(v.trust)}，${v.n} 例）`);
  out.push(`高信任那一组与低信任那一组的差距：${data.pairs.gap} 个百分点（≥30 才算把「她犹不犹豫」做出来）`);

  sec('16. 12 条命名路线（MECHANICS §5 + R 组合）');
  for (const r of data.routes) {
    out.push(`   ${r.ok ? '✔' : '✘'} ${r.id}：${r.ending}/${r.night} 第 ${r.days} 天 ${r.steps} 步${r.ok ? '' : `（表里期望 ${r.expect.ending}/${r.expect.night}）`}`);
    out.push(`        ${r.why}　犹豫=${r.hesitant} 如姬 ${r.rujiTrust} 公子 ${r.xinlingTrust}${r.reason ? `｜${r.reason}` : ''}`);
  }
  out.push(`12 条里对不上的：${data.routes.filter((r) => !r.ok).length} 条`);

  sec('17. 和旧对照组的差异分类（680 个脚本）');
  const g = data.goldenDiff;
  out.push(`旧金标准结局：${JSON.stringify(g.oldEndings)}（共 ${g.total} 条）`);
  out.push(`A 类·文字（旧场景 v1 重放）：逐字段差异 ${JSON.stringify(g.v1.per)}；只有账本指纹变了 ${g.v1.ledgerHashDiff} 条 → 结局 ${JSON.stringify(g.v1.endings)}`);
  out.push(`B 类·玩法（今天的场景 v2）：逐字段差异 ${JSON.stringify(g.v2.per)}；完全一致 ${g.v2.same} 条 → 结局 ${JSON.stringify(g.v2.endings)}`);
  out.push('A = t33 把读数从人话里拿走（只动账本 payload.reason 的文字与指纹）；B = t13 按 MECHANICS 改了人物初值与四幕后果。');
  return out.join('\n');
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : (process.argv.includes(`--${name}`) ? true : dflt);
}

function main() {
  const grants = collectGrants();
  const space = SPACE();
  const granary = granaryGrid();
  const golden = goldenReplay();
  const strategies = strategyGrid();
  const acceptance = acceptanceTable(space, granary);
  const appeals = appealTable(acceptance);

  // 跨幕影响：按大梁选项 / 夷门选项归组
  const cross = [];
  for (const dir of ['A', 'B']) {
    for (const act of ['daliang', 'yimen']) {
      for (const option of (act === 'daliang' ? DALIANG : YIMEN)) {
        const rows = space.filter((r) => r.dir === dir && r.plan[act] === option);
        const ending = {};
        for (const r of rows) ending[r.ending || 'null'] = (ending[r.ending || 'null'] || 0) + 1;
        const yeTried = rows.filter((r) => r.acts.ye && r.acts.ye.accepted !== null && !r.acts.ye.blocked && !r.acts.ye.filtered);
        const tally = (list) => list.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
        cross.push({
          dir, act, option, n: rows.length, ending,
          nightSeen: pct(rows.filter((r) => r.acts.night?.seen).length, rows.length),
          clean: pct(rows.filter((r) => r.flags?.night === 'clean').length, rows.length),
          hesitant: pct(rows.filter((r) => r.acts.night?.hesitant).length, rows.length),
          rujiReady: pct(rows.filter((r) => r.acts.night?.rujiReady).length, rows.length),
          rujiTrust: JSON.stringify(tally(rows.map((r) => r.rujiTrust))),
          xinlingTrust: JSON.stringify(tally(rows.map((r) => r.xinlingTrust))),
          yeAccepted: pct(yeTried.filter((r) => r.acts.ye.accepted === true).length, yeTried.length),
          yeTried: yeTried.length,
        });
      }
    }
  }

  // 死选项
  const dead = [];
  for (const dir of ['A', 'B']) {
    const runs = space.filter((r) => r.dir === dir);
    const index = new Map(runs.map((r) => [JSON.stringify([r.plan.daliang, r.plan.yimen, r.plan.ye, r.plan.night]), r]));
    for (const act of ['daliang', 'yimen', 'ye']) {
      for (const option of (act === 'daliang' ? DALIANG : act === 'yimen' ? YIMEN : YE)) {
        let same = 0; let total = 0; let blocked = 0; let filtered = 0; const endings = {}; const texts = new Set();
        for (const d of DALIANG) for (const y of YIMEN) for (const e of YE) {
          const want = { daliang: d, yimen: y, ye: e, [act]: option };
          const base = index.get(JSON.stringify([want.daliang, want.yimen, want.ye, NIGHTS.clean]));
          if (!base) continue;
          total += 1;
          if (base.acts[act]?.blocked) blocked += 1;
          if (base.acts[act]?.filtered) filtered += 1;
          if (base.acts[act]?.text) texts.add(base.acts[act].text);
          const ref = { daliang: d, yimen: y, ye: e };
          ref[act] = 'wait';
          const waitRun = index.get(JSON.stringify([ref.daliang, ref.yimen, ref.ye, NIGHTS.clean]));
          if (waitRun && sig(base) === sig(waitRun)) same += 1;
          endings[base.ending || 'null'] = (endings[base.ending || 'null'] || 0) + 1;
        }
        dead.push({ dir, act, option, sameDiff: { same, total }, blocked, filtered, endings, texts: texts.size, appeal: APPEAL[act]?.[option] ?? null });
      }
    }
  }

  const goldenEndings = {}; const nullByStage = {}; const nullByFirstError = {};
  for (const r of golden) {
    const key = r.ending || 'null';
    goldenEndings[key] = (goldenEndings[key] || 0) + 1;
    if (!r.ending) {
      nullByStage[r.stage] = (nullByStage[r.stage] || 0) + 1;
      const msg = (r.firstError || '没有报错').replace(/^[^!]*!/, '');
      nullByFirstError[msg] = (nullByFirstError[msg] || 0) + 1;
    }
  }
  const blockedCount = {}; const filteredCount = {};
  for (const r of space) for (const [act, a] of Object.entries(r.acts)) {
    if (a.blocked) blockedCount[`${act}:${a.want}`] = (blockedCount[`${act}:${a.want}`] || 0) + 1;
    if (a.filtered) filteredCount[`${act}:${a.want}`] = (filteredCount[`${act}:${a.want}`] || 0) + 1;
  }
  const gatedCount = blockedCount;
  const filteredTotal = filteredCount;

  // 可学性：每一幕的文本（按选项拆）+ 追问能问出什么
  const learn = [];
  const REFUSED_OPTION = { daliang: 'li', yimen: 'hou', ye: 'ju' };
  for (const dir of ['A', 'B']) {
    for (const act of ['daliang', 'yimen', 'ye']) {
      const texts = {};
      for (const r of space.filter((x) => x.dir === dir)) {
        const a = r.acts[act]; if (!a || !a.text) continue;
        const key = `${a.want}${a.accepted === true ? '✓' : a.accepted === false ? '✗' : a.accepted === null ? '(无诉求)' : ''}${a.blocked ? '(挡)' : a.filtered ? '(没给出)' : ''}`;
        texts[key] = a.text;
      }
      const probes = [
        ...askProbes(dir, act, act === 'daliang' ? 'yi' : act === 'yimen' ? 'back' : 'yi', '(被接受)'),
        ...askProbes(dir, act, REFUSED_OPTION[act], '(被拒)'),
      ];
      learn.push({ dir, act, texts, tells: [...new Set(space.filter((x) => x.dir === dir).map((r) => r.acts[act]?.tell).filter(Boolean))], probes });
    }
  }

  // 按人拆胜率（每个选项只对一个人说话）
  const byPerson = acceptance.filter((c) => Object.keys(c.persons).length).map((c) => ({
    dir: c.dir, act: c.act, option: c.option, person: Object.keys(c.persons).join(','),
    accepted: c.accepted, refused: c.refused, rate: c.rate, n: c.n,
  }));

  // 粮仓：批不批、看不看出区别
  const granaryRows = granary.map((r) => {
    const g = r.acts.granary || {};
    const last = g.tries[g.tries.length - 1] || {};
    return { dir: r.dir, keeper: r.plan.granary.keeper, keeperSeen: g.keeper, inspect: r.plan.granary.inspect, decide: r.plan.granary.decide, verdict: g.verdict, text: g.text, tell: last.tell, keeperAct: last.keeperAct, stoppedAt: last.stoppedAt, ending: r.ending };
  });
  const granaryByVerdict = {};
  for (const r of granaryRows) {
    const k = `${r.dir}|${r.keeper}|${r.decide}`;
    (granaryByVerdict[k] ||= []).push(`${r.inspect}:${r.verdict}`);
  }
  const inspectMatters = {};
  for (const [k, list] of Object.entries(granaryByVerdict)) {
    const verdicts = new Set(list.map((x) => x.split(':')[1]));
    inspectMatters[k] = { variants: list.join(' '), verdictSame: verdicts.size === 1 };
  }
  const keeperReactions = {};
  for (const r of granaryRows) (keeperReactions[r.keeper] ||= new Set()).add(`${r.tell ?? '-'}｜${r.keeperAct ?? '-'}${r.stoppedAt ? `@${r.stoppedAt}` : ''}`);

  // 取符之夜：能走到哪些终点、最快几步（BFS，按状态去重）
  const night = { A: nightGraph('A'), B: nightGraph('B') };

  // 夜的开幕状态：前两幕怎么选，进夜那一刻的状态变不变
  const nightStart = nightStartStates();

  // 如姬犹豫的门槛：信任从 0.10 扫到 0.50，看她的心思什么时候翻面
  const hesitation = hesitationScan();

  // M2（t32）：九人矩阵、强度×信任扫描、门前那一拍、12 条路线、与旧对照组的差异分类
  const matrix = appealMatrix();
  const scan = appealScan();
  const audit = appealAudit(space);
  const door = doorPair('A');
  const routes = routeCheck();
  const pairs = hesitationPairs();
  const golden2 = goldenDiff();

  // 每种结局最少几步
  const minSteps = {};
  for (const r of space) {
    const k = r.ending || 'null';
    minSteps[k] = Math.min(minSteps[k] ?? 999, r.steps);
  }

  const seconds = (rows) => rows.map((r) => r.seconds);
  const spaceSec = seconds(space); const personaSec = strategies.filter((s) => s.kind === 'persona').map((s) => s.seconds);
  const stepsAll = space.map((r) => r.steps);
  const rhythm = {
    space: { min: Math.min(...spaceSec), max: Math.max(...spaceSec) },
    persona: { min: Math.min(...personaSec), max: Math.max(...personaSec) },
    steps: { min: Math.min(...stepsAll), max: Math.max(...stepsAll) },
    spaceOk: `${Math.min(...spaceSec)}–${Math.max(...spaceSec)} ⊆ 480–720 ? ${Math.min(...spaceSec) >= 480 && Math.max(...spaceSec) <= 720}`,
    personaOk: `${Math.min(...personaSec)}–${Math.max(...personaSec)} ⊆ 480–720 ? ${Math.min(...personaSec) >= 480 && Math.max(...personaSec) <= 720}`,
  };

  const data = {
    generatedBy: 'tools/mechanics-probe.mjs',
    note: '基于工作区当前 play.js + shared/scenes（t2 尚未提交）；只读探针，不改 shared/**',
    counts: { space: space.length, granary: granary.length, golden: golden.length, strategies: strategies.length },
    grants, acceptance, appeals, byPerson, strategies, cross, dead,
    granary: { rows: granaryRows, byVerdict: inspectMatters, keeperReactions: Object.fromEntries(Object.entries(keeperReactions).map(([k, v]) => [k, [...v]])) },
    night, minSteps, nightStart, hesitation,
    matrix, scan, audit, door, routes, pairs, goldenDiff: golden2,
    goldenSummary: { endings: goldenEndings, nullByStage, nullByFirstError },
    spaceSummary: { endings: space.reduce((m, r) => { const k = r.ending || 'null'; m[k] = (m[k] || 0) + 1; return m; }, {}), blocked: blockedCount, filtered: filteredCount },
    learn, rhythm,
    runs: space.map((r) => ({ id: r.plan.id, dir: r.dir, ending: r.ending, flags: r.flags, steps: r.steps, seconds: r.seconds, acts: actsBrief(r) })),
    golden: golden.map((r) => ({ id: r.id, dir: r.dir, stage: r.stage, ending: r.ending, firstError: r.firstError })),
  };

  const wantJson = arg('json', false);
  if (wantJson) {
    const text = JSON.stringify(data, null, 2);
    if (typeof wantJson === 'string') { writeFileSync(wantJson, text); console.log(`写了 ${wantJson}（${text.length} 字节）`); }
    else console.log(text);
    return;
  }
  const section = arg('section', null);
  const text = render(data);
  console.log(section ? text.split(/\n(?=\s*== )/).filter((b) => b.startsWith(`== ${section}`) || b.startsWith(`== ${section}.`) || b.includes(`. ${section}`)).join('\n') : text);
}

/** 夜的开幕状态：前两幕每一种选择组合，进夜那一刻的状态是不是同一个 */
export function nightStartStates() {
  const states = new Map();
  let total = 0;
  for (const dir of ['A', 'B']) {
    for (const dal of DALIANG) {
      for (const ym of YIMEN) {
        const s = createSession();
        s.meet(ANSWERS[dir], NEED);
        const p = createPlay(s);
        p.begin();
        let v = p.next();
        const adv = () => { while ((v.stage === 'act' || v.stage === 'granary') && v.done) v = p.next(); if (v.stage === 'coda') v = p.next(); };
        adv();
        while (v.stage === 'act' && v.act !== 'night') {
          const want = v.act === 'daliang' ? dal : ym;
          try { v = p.choose(want).view; } catch (e) { v = p.choose('wait').view; }
          adv();
        }
        const n = v.night || {};
        const rujiTrust = s.minds?.ruji?.state?.trust?.[PLAYER] ?? null;
        const xinlingTrust = s.minds?.xinling?.state?.trust?.[PLAYER] ?? null;
        const key = JSON.stringify({ pos: n.pos, step: n.step, lantern: n.lantern, token: n.token ?? null, aAlert: !!n.aAlert, bLooksAway: !!n.bLooksAway, rujiReady: !!n.rujiReady, hesitant: !!n.hesitant, rujiTrust, xinlingTrust });
        const e = states.get(key) || { state: key, n: 0, example: `${dir}|${dal}|${ym}` };
        e.n += 1;
        states.set(key, e);
        total += 1;
      }
    }
  }
  return { total, states: [...states.values()] };
}

/**
 * 如姬犹豫的门槛：信任从 0.10 扫到 0.50。
 * 每个信任值跑两遍同样的局：第一遍进夜（nightStart 真的读信任、给出 hesitant），
 * 第二遍停在进夜前用引擎自己的 perceive 复算两路权重——这样读到的两份证据是同一个时刻的。
 */
export function hesitationScan() {
  const walk = (trust) => {
    const s = createSession();
    s.meet(ANSWERS.B, NEED);
    const p = createPlay(s);
    p.begin();
    let v = p.next();
    const adv = () => { while ((v.stage === 'act' || v.stage === 'granary') && v.done) v = p.next(); if (v.stage === 'coda') v = p.next(); };
    adv();
    while (v.stage === 'act' && v.act !== 'night') {
      const isYimen = v.act === 'yimen';
      try { v = p.choose(isYimen ? 'back' : 'yi').view; } catch (e) { v = p.choose('wait').view; }
      if (isYimen) { s.minds.ruji.state.trust['actor:player'] = trust; return { s, p, v }; }   // 停在进夜前
      adv();
    }
    return { s, p, v };
  };
  const rows = [];
  for (let i = 10; i <= 50; i += 2) {
    const trust = i / 100;
    const en = Math.round((trust + 0.1) * 100) / 100;
    const a = walk(trust);
    const v = a.p.next();                       // 进夜 → nightStart 读信任
    const log = (a.s.minds.ruji.state.log || []).slice(-1)[0] || {};
    const b = walk(trust);                      // 同一个时刻，但先别进夜，好看见引擎的算法内部
    const per = b.s.minds.ruji.perceive({ kind: 'night', signature: 'night:ruji', channels: { 恩: en, 惧: 0.5 } });
    const w = (id) => per.candidates.find((c) => c.id === id)?.weight ?? 0;
    rows.push({
      trust, en, debtWeight: w('debt'), riskWeight: w('risk'),
      hesitant: !!v.night?.hesitant, rujiReady: !!v.night?.rujiReady, act: log.act, stoppedAt: log.stoppedAt,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * M2（t32）：九人 × 诉求的纯矩阵、门前的犹豫配对、路线表、对照差异
 * ------------------------------------------------------------------ */

const APPEALS = ['义', '利', '惧', '恩'];
const C_MOVES = ['step', 'token_b', 'rush', 'step'];
const R_MOVES = ['step', 'token_b', 'rush', 'wait', 'step'];      // 低信任在门口多等一拍
const R2_MOVES = ['step', 'token_b', 'rush', ...Array(9).fill('step')];  // 同一串走法，去掉那一拍 → 天亮

/** 装过 cast 之后这九个人的定义与初始信任：从真实会话里取，不手抄 */
function castDefs() {
  const s = createSession();
  s.meet(ANSWERS.A, NEED);
  const p = createPlay(s);
  p.begin();
  p.next();                                   // 大梁开场，cast 已经装进各人的 def
  const out = {};
  for (const id of NINE) {
    const m = s.minds[id];
    if (!m) continue;
    out[id] = { def: m.def, trust: m.def?.trust?.[PLAYER] ?? m.state.trust?.[PLAYER] ?? 0.3 };
  }
  return out;
}

/** 九人纯诉求矩阵：一人一个新 Mind（保留各自的初始信任与阈值），单独听一句 .8 的诉求 */
export function appealMatrix() {
  const defs = castDefs();
  const rows = [];
  for (const [id, info] of Object.entries(defs)) {
    for (const appeal of APPEALS) {
      const m = createMind(info.def);
      const r = m.hear({ [appeal]: 0.8 }, PLAYER);
      rows.push({ id, appeal, trust: info.trust, threshold: info.def?.threshold ?? 0.35, accepted: !!r.accepted, moved: r.moved, fit: r.fit, backlash: r.backlash });
    }
  }
  const counts = {};
  for (const appeal of APPEALS) {
    const list = rows.filter((r) => r.appeal === appeal);
    const yes = list.filter((r) => r.accepted);
    counts[appeal] = { accepted: yes.length, n: list.length, rate: pct(yes.length, list.length), who: yes.map((r) => r.id) };
  }
  const backlash = rows.filter((r) => r.backlash > 0).map((r) => ({ id: r.id, appeal: r.appeal, moved: r.moved, backlash: r.backlash, threshold: r.threshold }));
  return { rows, counts, backlash, people: Object.keys(defs) };
}

/** 强度 × 信任 的扫描：每一个截面上，每一列最多能说服几个人 */
export function appealScan() {
  const defs = castDefs();
  const n = Object.keys(defs).length;
  const cells = [];
  for (const intensity of [0.6, 0.8, 1]) {
    for (const trust of [0, 0.15, 0.2, 0.3, 0.5, 0.65, 1]) {
      const per = {};
      for (const appeal of APPEALS) {
        let yes = 0;
        for (const info of Object.values(defs)) {
          const m = createMind(info.def);
          m.state.trust[PLAYER] = trust;
          if (m.hear({ [appeal]: intensity }, PLAYER).accepted) yes += 1;
        }
        per[appeal] = yes;
      }
      const max = Math.max(...APPEALS.map((a) => per[a]));
      cells.push({ intensity, trust, per, max, ok: max * 2 <= n });
    }
  }
  const worst = cells.reduce((a, b) => (b.max > a.max ? b : a), cells[0]);
  return { n, cells, worst, ok: cells.every((c) => c.ok) };
}

/** 自检：场景里声明了诉求的选项，账本必须给得出接受/拒绝；没声明的必须 accepted=null */
export function appealAudit(space) {
  const bad = [];
  for (const r of space) {
    for (const act of ['daliang', 'yimen', 'ye']) {
      const a = r.acts[act];
      if (!a || a.blocked || a.filtered || a.error) continue;
      const has = !!APPEAL[act]?.[a.want];
      if (has === (a.accepted === null)) bad.push({ id: r.plan.id, act, option: a.want, hasAppeal: has, accepted: a.accepted });
    }
  }
  return { checked: space.length, badCount: bad.length, bad: bad.slice(0, 10) };
}

/** 门前那一拍成对吗：同一串夜路，只差夷门那一手（R 有那一拍 / R2 没有） */
export function doorPair(dir = 'A') {
  const rows = [];
  for (const yimen of YIMEN) {
    for (const [name, moves] of [['R（等）', R_MOVES], ['R2（不等）', R2_MOVES]]) {
      const r = runPlan(dir, { daliang: 'yi', yimen, night: moves, ye: 'en', granary: { keeper: 'keeper_doubt', inspect: 'seal', decide: 'report' }, id: `door/${dir}/${yimen}/${name}` });
      rows.push({ dir, yimen, name, hesitant: r.acts.night?.hesitant ?? null, rujiTrust: r.rujiTrust, night: r.flags?.night, ending: r.ending, reason: r.acts.night?.reason ?? null, yeAccepted: r.acts.ye?.accepted ?? null });
    }
  }
  return rows;
}

/** 12 条命名路线在探针里重跑一遍（和 tests/fixtures 里录的金标准对得上吗） */
export function routeCheck() {
  return ROUTE_TABLE.map((rt) => {
    const rec = runPlan(rt.dir, { daliang: rt.daliang, yimen: rt.yimen, night: rt.night, ye: rt.ye, granary: { keeper: 'keeper_doubt', inspect: 'seal', decide: 'report' }, id: rt.id });
    const night = rec.flags?.night ?? null;
    return { id: rt.id, why: rt.why, expect: rt.expect, ending: rec.ending, night, days: rec.days, steps: rec.steps, rujiTrust: rec.rujiTrust, xinlingTrust: rec.xinlingTrust, hesitant: rec.acts.night?.hesitant ?? null, reason: rec.acts.night?.reason ?? null, yeAccepted: rec.acts.ye?.accepted ?? null, ok: rec.ending === rt.expect.ending && night === rt.expect.night };
  });
}

/** 40 种前置配对：夷门那一手把「进夜时她犹不犹豫」拉开的差距 */
export function hesitationPairs() {
  const rows = [];
  for (const dir of ['A', 'B']) {
    for (const dal of DALIANG) {
      for (const ym of YIMEN) {
        const r = runPlan(dir, { daliang: dal, yimen: ym, night: NIGHTS.clean, ye: 'en', granary: { keeper: 'keeper_doubt', inspect: 'seal', decide: 'report' }, id: `${dir}/${dal}/${ym}` });
        rows.push({ dir, daliang: dal, yimen: ym, hesitant: r.acts.night?.hesitant ?? null, rujiTrust: r.rujiTrust, xinlingTrust: r.xinlingTrust, night: r.flags?.night ?? null, ending: r.ending });
      }
    }
  }
  const by = {};
  for (const r of rows) {
    const k = `${r.dir}/${r.yimen}`;
    const cur = (by[k] ||= { n: 0, hesitant: 0, trust: {} });
    cur.n += 1;
    if (r.hesitant) cur.hesitant += 1;
    cur.trust[r.rujiTrust] = (cur.trust[r.rujiTrust] || 0) + 1;
  }
  const share = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { n: v.n, hesitant: pct(v.hesitant, v.n), trust: v.trust }]));
  const pick = (keys) => keys.map((k) => share[k]?.hesitant ?? 0);
  const high = pick(['A/back', 'A/hou', 'B/back', 'B/hou']);
  const low = pick(['A/fear', 'A/wait', 'B/fear', 'B/wait']);
  const gap = Math.min(...low) - Math.max(...high);
  return { rows, share, gap, ok: gap >= 30 };
}

/** 对照组的差异分类：旧场景（v1）与今天（v2）各跑一遍旧 680，逐字段比 */
export function goldenDiff() {
  const old = JSON.parse(readFileSync(OLD_GOLDEN, 'utf8'));
  const list = goldenScripts();
  const fields = ['stage', 'ending', 'days', 'flags', 'acts', 'logHash', 'ledgerSize', 'trail'];
  const run = (deps) => {
    const per = Object.fromEntries(fields.map((f) => [f, 0]));
    let same = 0;
    let ledger = 0;
    const endings = {};
    for (const sc of list) {
      const g = old[sc.id];
      const now = runScript(deps, sc);
      const diffs = fields.filter((f) => JSON.stringify(now[f]) !== JSON.stringify(g[f]));
      if (!diffs.length && now.ledgerHash === g.ledgerHash) same += 1;
      if (now.ledgerHash !== g.ledgerHash) ledger += 1;
      for (const f of diffs) per[f] += 1;
      const k = now.ending || 'null';
      endings[k] = (endings[k] || 0) + 1;
    }
    return { per, same, ledgerHashDiff: ledger, endings };
  };
  const v1 = run({ createSession, createPlay: (s) => createPlay(s, { scenes: { ...V1_QIFU_SCENES, ...WEICHENG_SCENES } }) });
  const v2 = run({ createSession, createPlay: (s) => createPlay(s) });
  const oldEndings = {};
  for (const sc of list) {
    const k = old[sc.id].ending || 'null';
    oldEndings[k] = (oldEndings[k] || 0) + 1;
  }
  return { total: list.length, fields, v1, v2, oldEndings };
}

/** 走一局：大梁 yi、夷门 back、夜里按 moves、邺城 yi；用来做取符之夜的图搜索 */
export function playNight(dir, moves) {
  const s = createSession();
  s.meet(ANSWERS[dir], NEED);
  const p = createPlay(s);
  p.begin();
  let v = p.next();
  const adv = () => { while ((v.stage === 'act' || v.stage === 'granary') && v.done) v = p.next(); if (v.stage === 'coda') v = p.next(); };
  adv();
  const plan = { daliang: 'yi', yimen: 'back', ye: 'yi' };
  let idx = 0; let guard = 0; let last = null;
  while (v.stage === 'act' && guard++ < 40) {
    if (v.night) last = v.night;
    const act = v.act;
    const want = act === 'night' ? (idx < moves.length ? moves[idx++] : null) : (plan[act] ?? 'wait');
    if (want == null) break;                       // 夜的着法用完，停在夜这一幕
    try { v = p.choose(want).view; } catch (e) {
      const wait = (v.options || []).find((o) => o.verb === 'wait' && o.allowed !== false);
      if (!wait) break;
      try { v = p.choose(wait.id).view; } catch (e2) { break; }
    }
    if (v.night) last = v.night;   // 夜这一幕结束、advance 之后 view().night 会变 null，所以趁现在记
    adv();
  }
  const n = last ?? v.night ?? {};
  const underway = v.stage === 'act' && v.act === 'night' && !v.done;
  return {
    underway,
    key: JSON.stringify([n.pos, n.step, n.lantern, n.token ?? null, !!n.bLooksAway, !!n.aAlert, !!n.rujiReady, !!n.seen, !!n.done]),
    options: underway ? (v.options || []).filter((o) => o.allowed !== false).map((o) => o.id) : [],
    seen: !!n.seen, done: !!n.done, reason: n.reason ?? null, ending: p.state().ending || null,
  };
}

/** 取符之夜能走到哪些终点、各自最快几步（BFS + 状态去重，靠重放实现，没有 clone API） */
export function nightGraph(dir, cap = 2000) {
  const seen = new Set();
  const terminals = { clean: new Set(), seen: new Set() };
  const minMoves = {};
  const queue = [[]];
  let replays = 0;
  while (queue.length && seen.size < cap) {
    const moves = queue.shift();
    const r = playNight(dir, moves);
    replays += 1;
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    if (!r.underway) {
      const k = r.seen ? 'seen' : 'clean';
      terminals[k].add(r.key);
      minMoves[k] = Math.min(minMoves[k] ?? 99, moves.length);
      continue;
    }
    for (const o of r.options) queue.push([...moves, o]);
  }
  return {
    states: seen.size, replays,
    terminalStates: { clean: terminals.clean.size, seen: terminals.seen.size },
    minMoves,
    sampleClean: [...terminals.clean][0] ?? null,
    unexplored: queue.length,
  };
}

/** 追问能问出什么：动手前 / 选完某个选项之后，对同一个人 ask（文本层唯一的数值解释） */
export function askProbes(dir, act, option, note) {
  const person = { daliang: 'xinling', yimen: 'houying', ye: 'jinbi' }[act];
  const plan = { daliang: 'yi', yimen: 'back', ye: 'yi', night: NIGHTS.clean };
  const s = createSession();
  s.meet(ANSWERS[dir], NEED);
  const p = createPlay(s);
  p.begin();
  let v = p.next();
  const adv = () => { while ((v.stage === 'act' || v.stage === 'granary') && v.done) v = p.next(); if (v.stage === 'coda') v = p.next(); };
  adv();
  const out = [];
  const ask = (when) => { try { out.push({ when, person, answer: p.ask(person).answer }); } catch (e) { out.push({ when, person, answer: `ask 不可用：${e.message}` }); } };
  let idx = 0; let guard = 0;
  while (v.stage === 'act' && guard++ < 40) {
    if (v.act === act) {
      ask(`动手前 ${note}`);
      try { v = p.choose(option).view; } catch (e) { out.push({ when: `选 ${option}`, person, answer: `被挡：${e.message}` }); break; }
      ask(`选 ${option} 之后 ${note}`);
      adv();
      continue;
    }
    const want = v.act === 'night' ? (plan.night[idx++] ?? 'step') : (plan[v.act] ?? 'wait');
    try { v = p.choose(want).view; } catch (e) {
      const wait = (v.options || []).find((o) => o.verb === 'wait' && o.allowed !== false);
      if (!wait) break;
      try { v = p.choose(wait.id).view; } catch (e2) { break; }
    }
    adv();
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
