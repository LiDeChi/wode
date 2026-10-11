// 第二阶段：同一个世界的多个呈现，靠一张主张图连在一起。
// 每部作品只能做两件事：读它视野里的主张；通过动作（包括你的选择）产生新主张。
// 作品之间的五种关系（承接 / 引用 / 并行 / 争议 / 反转）不是手写标签，而是演完之后从主张图里算出来的。
// 所有写入都带 cause：作品的“开演”记录 → 导演的设计 → 导师 → 你；你的选择本身也是一条 user 记录。

import { STATUS } from '../core/claims.js';

/** 默认的观看顺序：先看电影，再亲手取符，再回到《窃符》的主线，最后进城看另一面 */
export const WORLD_ORDER = ['changping', 'night', 'qiefu', 'weicheng'];

/** 每部作品里你能做的选择。值只从 options 里取，第一个是史书的走法 */
export const CHOICES = {
  night: {
    beat: 'run', label: '取符之夜，你怎么护送如姬',
    options: [
      { id: 'clean', label: '贴着墙根等巡夜过去', note: '符顺利出了卧内' },
      { id: 'seen', label: '抢在巡夜前冲过去', note: '惊动卫士，符没能带出来' },
    ],
  },
  qiefu: {
    beat: 'ye', label: '邺城，晋鄙合符而疑',
    options: [
      { id: 'strike', label: '不出声，看朱亥的铁椎落下', note: '史书的走法' },
      { id: 'persuade', label: '上前替信陵君再说一句', note: '晋鄙交出兵权而活：本作的历史' },
    ],
  },
  weicheng: {
    beat: 'dusk', label: '粮仓的账对不上，守仓人怎么办',
    options: [
      { id: 'report', label: '拿着仓簿副页去报', note: '一件证据' },
      { id: 'witness', label: '拉上李同一起去报', note: '两件证据：仓簿 + 亲眼见过城中的人' },
      { id: 'hide', label: '先瞒下来', note: '城里的说法与城外一致' },
    ],
  },
};

export const WORK_HOLDERS = {
  changping: '史官', night: '门客（你）', qiefu: '门客（你）', weicheng: '守仓人',
};

/**
 * 导演批不批一次反转，由他的性情决定：爱雕琢的要两件证据，爱放开的一件就够。
 * 这条规则也写进账本（director.approve / director.refuse），所以“谁批的、凭什么”可追。
 */
export function evidenceNeeded(directorDef) {
  return (directorDef?.temperament?.雕琢 ?? 0) > 0.5 ? 2 : 1;
}

function normalize(choices = {}) {
  const out = {};
  for (const [w, spec] of Object.entries(CHOICES)) {
    const v = choices[w];
    out[w] = spec.options.some((o) => o.id === v) ? v : spec.options[0].id;
  }
  return out;
}

/**
 * 在一个已经见过导师的 session 上演一部作品。
 * opts.reuseOpen：已经排过片的作品不再 commission。
 * 返回 { work, openSeq, chooseSeq, added:[claimId], touched:[{op,id}] }
 */
export function playWork(session, workId, choice, opts = {}) {
  const { ledger, claims } = session;
  if (!session.state.met) throw new Error('先见导师，再看作品');
  session.state.plays ||= {};
  // reuseOpen：作品已经由可玩的呈现排过片（第三阶段），不再重复排一次
  if (!(opts.reuseOpen && session.state.designs?.[workId])) session.commission(workId);
  const openSeq = ledger.last((e) => e.kind === 'present.open' && e.payload.presentation === workId).seq;
  const touched = [];
  let chooseSeq = null;

  if (CHOICES[workId]) {
    const spec = CHOICES[workId];
    const pick = spec.options.find((o) => o.id === choice) || spec.options[0];
    chooseSeq = ledger.append({
      kind: 'user.choose', from: 'user', to: `presentation:${workId}`, cause: [openSeq],
      payload: { presentation: workId, beat: spec.beat, choice: pick.id, label: pick.label },
    }).seq;
  }
  const byOpen = [openSeq];
  const byChoice = chooseSeq ? [chooseSeq] : byOpen;
  const holder = WORK_HOLDERS[workId];
  const find = (subject, predicate) => claims.consensus(subject, predicate) || claims.find((c) => c.subject === subject && c.predicate === predicate && c.status !== STATUS.FORMER)[0];
  const add = (spec, cause) => { const r = claims.add({ presentation: workId, holder, ...spec, cause }); touched.push({ op: 'add', id: r.claim.id, verdict: r.check.verdict }); return r.claim; };
  const read = (c) => { if (c) { claims.read(c.id, workId, byOpen); touched.push({ op: 'read', id: c.id }); } };
  const cite = (c, cause = byOpen) => { if (c) { claims.cite(c.id, workId, cause); touched.push({ op: 'cite', id: c.id }); } };
  const endorse = (c, who, w, cause) => claims.endorse(c.id, who, w, cause, workId);

  if (workId === 'changping') {
    // 史官在城外：他看得见的是城头和魏营，看不见仓里
    add({ subject: '邯郸', predicate: '处境', object: '被秦军围困', channel: '公开', weight: 2, note: '长平之后，秦军合围' }, byOpen);
    add({ subject: '邯郸', predicate: '存粮', object: '尚可支撑', channel: '公开', weight: 2, note: '城外只见城头旌旗不乱' }, byOpen);
    add({ subject: '魏王', predicate: '对救赵', object: '令晋鄙止步于邺', channel: '公开', weight: 2, note: '秦使警告：敢救赵者先击之' }, byOpen);
  }

  if (workId === 'night') {
    read(find('魏王', '对救赵'));              // 没有魏王止步，就没有这一夜
    if (choice === 'seen') {
      add({ subject: '兵符', predicate: '去向', object: '惊动卫士，兵符留在卧内', channel: '亲历', note: '你抢在巡夜前冲了出去' }, byChoice);
      add({ subject: '门客', predicate: '被发现', object: '卫士记下了你的脸', channel: '亲历' }, byChoice);
    } else {
      add({ subject: '兵符', predicate: '去向', object: '出了卧内，交到信陵君手里', channel: '亲历', note: '你贴着墙根等巡夜过去' }, byChoice);
    }
  }

  if (workId === 'qiefu') {
    read(find('邯郸', '处境'));
    cite(find('魏王', '对救赵'));               // 门客们的处境就从魏王止步开始
    cite(find('邯郸', '存粮'));                 // 大梁的人也以为邯郸还撑得住，所以魏王才等得起
    const fu = find('兵符', '去向');
    read(fu);
    add({ subject: '平原君', predicate: '在做什么', object: '还在宅中歌舞', channel: '被告知', note: '大梁的传闻' }, byOpen);
    const gotFu = !fu || /信陵君手里/.test(String(fu.object));
    if (gotFu) {
      const fate = choice === 'persuade'
        ? add({ subject: '晋鄙', predicate: '下场', object: '交出兵权，随军而行', channel: '亲历', deps: fu ? [fu.id] : [], note: '本作的历史，与史书不同' }, byChoice)
        : add({ subject: '晋鄙', predicate: '下场', object: '为朱亥铁椎所杀', channel: '亲历', deps: fu ? [fu.id] : [], note: '与史书一致' }, byChoice);
      const march = add({ subject: '魏军', predicate: '动向', object: '信陵君已夺军，正往邯郸', channel: '亲历', deps: [fate.id] }, byChoice);
      endorse(march, '信陵君', 2, byChoice);
      endorse(march, '朱亥', 1, byChoice);
      add({ subject: '邯郸', predicate: '结局', object: '援军将至', channel: '亲历', deps: [march.id] }, byChoice);
    } else {
      const fate = add({ subject: '晋鄙', predicate: '下场', object: '未见兵符，按兵不动', channel: '亲历', deps: [fu.id], note: '取符之夜断了链' }, byOpen);
      const march = add({ subject: '魏军', predicate: '动向', object: '十万军仍停在邺', channel: '亲历', deps: [fate.id] }, byOpen);
      add({ subject: '邯郸', predicate: '结局', object: '援军未至（本作的历史）', channel: '亲历', deps: [march.id] }, byOpen);
    }
  }

  if (workId === 'weicheng') {
    read(find('邯郸', '处境'));
    add({ subject: '平原君', predicate: '在做什么', object: '散家财给守城的人', channel: '亲历', note: '守仓人亲眼看见' }, byOpen);
    const march = find('魏军', '动向');
    if (march && /停在邺/.test(String(march.object))) cite(march);   // 城里听到的和魏营里的一样
    else add({ subject: '魏军', predicate: '动向', object: '魏军不会来了', channel: '被告知', note: '城里的传言' }, byOpen);

    const grain = find('邯郸', '存粮');
    if (choice === 'hide') {
      cite(grain, byChoice);
    } else if (grain) {
      const d = session.director();
      const evidence = choice === 'witness' ? ['仓簿副页', '李同：城中炊骨易子'] : ['仓簿副页'];
      const cost = claims.overturnCost(grain.id);
      const need = evidenceNeeded(d.def);
      const ask = ledger.append({
        kind: 'present.ask-reversal', from: `presentation:${workId}`, to: d.role, cause: byChoice,
        payload: { claim: grain.id, cost, evidence },
      }).seq;
      const ok = evidence.length >= need;
      const verdictSeq = ledger.append({
        kind: ok ? 'director.approve' : 'director.refuse', from: d.role, to: `presentation:${workId}`, cause: [ask],
        payload: { claim: grain.id, cost, evidence: evidence.length, need, rule: need > 1 ? '爱雕琢：推翻共识要两件证据' : '爱放开：一件证据就放行' },
      }).seq;
      const replacement = { subject: '邯郸', predicate: '存粮', object: '仓中已空，城里炊骨易子', holder, channel: '亲历', note: '守仓人的仓簿' };
      if (ok) {
        const r = claims.overturn(grain.id, {
          replacement, evidence, presentation: workId, approvedBy: d.role, cause: [verdictSeq],
          explanation: '史官在城外，只看见城头旌旗不乱，看不见仓里',
        });
        touched.push({ op: 'overturn', id: grain.id, by: r.newId });
      } else {
        // 没批下来：守仓人的说法照样进图，但推不动共识，成了“争议”
        add({ ...replacement, evidence }, [verdictSeq]);
      }
    }
  }

  session.state.plays[workId] = { choice: chooseSeq ? ledger.get(chooseSeq).payload.choice : null, openSeq, chooseSeq };
  return { work: workId, openSeq, chooseSeq, touched };
}

/** 两部作品之间的全部关系；方向按观看顺序（先看的在前） */
export function worldRelations(session, order = WORLD_ORDER) {
  const played = order.filter((w) => session.state.plays?.[w]);
  const edges = [];
  for (let i = 0; i < played.length; i++) {
    for (let j = i + 1; j < played.length; j++) {
      const a = played[i]; const b = played[j];
      const rel = [...session.claims.relations(a, b), ...session.claims.relations(b, a).filter((r) => r.type === '承接' || r.type === '引用' || r.type === '反转').map((r) => ({ ...r, reverse: true }))];
      for (const r of rel) edges.push({ from: r.reverse ? b : a, to: r.reverse ? a : b, type: r.type, claims: r.claims });
    }
  }
  // 同一对作品、同一种关系、同一组主张只留一条
  const seen = new Set();
  return edges.filter((e) => { const k = `${e.from}>${e.to}|${e.type}|${e.claims.join(',')}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * 从你的回答和你在各作品里的选择，长出一整个世界。纯确定：同样的输入，同样的世界。
 * createSession 由调用方传入，避免 engine 之间循环依赖。
 */
export function growWorld(createSession, { answers, need, choices = {}, order = WORLD_ORDER }) {
  const s = createSession();
  s.meet(answers, need);
  const picks = normalize(choices);
  for (const w of order) playWork(s, w, picks[w]);
  return { session: s, choices: picks, edges: worldRelations(s, order) };
}
