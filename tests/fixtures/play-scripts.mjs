// 第三阶段·内核抽取的对照组：一批固定的玩法脚本，跑在 createPlay 上，记下最后的世界。
// 抽内核之前先用旧的 play.js 录一份（tools/record-play-golden.mjs → play-golden.json），
// 抽完之后同样的脚本必须得到同样的账本指纹（tests/kernel-parity.test.js）。
//
// 脚本是一串步骤：
//   'c:<option>'  choose（这一幕做完会自动 next）
//   'w:<person>'  watch 看心思        'a:<person>'  ask 追问
//   'k:<keeper>'  chooseKeeper 换守仓人
// 每个脚本跑在一个新 session 上，导演由 answers 决定（A 陆导爱雕琢，B 单导爱放开）。

import { hashHex } from '../../shared/core/ledger.js';

export const ANSWERS = {
  A: { wait: 0.8, polish: 0.8, depth: 0.85 },
  B: { wait: 0.2, polish: 0.2, depth: 0.25 },
};
export const NEED = '我想看一个人在乱世里怎么做选择';

const NIGHT = {
  clean: ['step', 'token_b', 'rush', 'step'],
  seen: ['step', 'step'],
  tokenA: ['token_a'],
  slow: ['step', 'token_b', 'wait', 'step', 'wait', 'step', 'step'],
};
const DALIANG = ['yi', 'li', 'letter', 'king', 'wait'];
const YIMEN = ['back', 'fear', 'hou', 'wait'];
const YE = ['yi', 'en', 'ju', 'wait'];

export function scripts() {
  const out = [];
  for (const dir of ['A', 'B']) {
    for (const d of DALIANG) for (const y of YIMEN) for (const [nk, n] of Object.entries(NIGHT)) for (const e of YE) {
      out.push({ id: `${dir}/${d}/${y}/${nk}/${e}`, dir, steps: [`c:${d}`, `c:${y}`, ...n.map((x) => `c:${x}`), `c:${e}`, 'c:seal', 'c:report'] });
    }
    for (const k of ['keeper_doubt', 'keeper_rash']) for (const i of ['seal', 'note', 'pledge']) for (const dec of ['report', 'witness', 'hide']) {
      out.push({ id: `${dir}/granary/${k}/${i}/${dec}`, dir, steps: ['c:yi', 'c:back', ...NIGHT.clean.map((x) => `c:${x}`), 'c:yi', `k:${k}`, `c:${i}`, `c:${dec}`] });
    }
    // 看心思、追问、换守仓人重看：这些也写账、也改人的记忆
    out.push({ id: `${dir}/curious`, dir, steps: ['w:xinling', 'c:yi', 'a:xinling', 'w:zhaoshi', 'w:houying', 'c:hou', 'a:houying', 'w:ruji', 'w:guard_a', ...NIGHT.clean.map((x) => `c:${x}`), 'w:jinbi', 'c:en', 'a:jinbi', 'c:note', 'k:keeper_rash', 'c:note', 'c:witness'] });
    out.push({ id: `${dir}/errors`, dir, steps: ['c:nope', 'c:wait', 'c:wait', 'c:token_b', 'c:token_b', 'c:token_a', 'c:wait', 'k:nobody', 'c:hide'] });
  }
  return out;
}

/** 在一个新 session 上跑一个脚本，返回能比对的结果（不含随时间变化的东西） */
export function runScript({ createSession, createPlay }, script) {
  const s = createSession();
  s.meet(ANSWERS[script.dir], NEED);
  const p = createPlay(s);
  p.begin();
  let v = p.next();
  const trail = [];
  const advance = () => { while ((v.stage === 'act' || v.stage === 'granary') && v.done) v = p.next(); if (v.stage === 'coda') v = p.next(); };
  advance();
  for (const step of script.steps) {
    const [op, arg] = step.split(':');
    try {
      if (op === 'c') { const r = p.choose(arg); v = r.view; trail.push(`${step}=${r.refused ? 'refused' : 'ok'}`); }
      else if (op === 'w') { const r = p.watch(arg); trail.push(`${step}=${r.preview ? r.preview.stoppedAt : r.last?.stoppedAt}`); }
      else if (op === 'a') { const r = p.ask(arg); trail.push(`${step}=${r.answer}`); }
      else if (op === 'k') { v = p.chooseKeeper(arg); trail.push(`${step}=ok`); }
      advance();
    } catch (e) { trail.push(`${step}!${e.message}`); }
  }
  const st = p.state();
  const last = s.ledger.entries[s.ledger.entries.length - 1];
  return {
    stage: v.stage, ending: st.ending, days: st.days, flags: st.flags,
    acts: Object.fromEntries(Object.entries(st.acts).map(([k, a]) => [k, { choice: a.choice, signal: a.signal, text: a.outcome?.text || null }])),
    logHash: hashHex(st.log.map((l) => l.text)),
    ledgerSize: s.ledger.entries.length, ledgerHash: last?.hash,
    trail,
  };
}
