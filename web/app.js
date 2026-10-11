/* 數字世界 · 第一階段
   這一頁只做一件事：把賬本畫出來，讓你點任何一個決定，都能沿 cause 追回自己。
   頁面上所有文字都來自真實 session（ledger / mentor / director / claims），沒有一處假數據。 */

import { createSession } from '/shared/engine/session.js';
import { createSpeaker, makeBrowserCall } from '/shared/agents/gateway.js';
import { narrate, narratableRecords } from '/shared/engine/narrate.js';
import { PREFS_QUESTIONS, STAFF } from '/shared/data/seed.js';
import { CATALOG } from '/shared/play/catalog.js';
import { roleKind, DECISION_KINDS } from '/shared/core/ledger.js';

const $ = (id) => document.getElementById(id);

/* ---------------- 小工具 ---------------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** 按碼點截斷，中文不會被切壞 */
function clip(s, n) {
  const a = Array.from(String(s ?? ''));
  return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
}

const mono = (v) => esc(typeof v === 'string' ? v : JSON.stringify(v));
const round2 = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4600);
}

/* ---------------- 狀態 ---------------- */

const S = {
  A: null,            // 主 session
  B: null,            // 「換一個你」的第二個 session
  speaker: null,      // 惰性建立的說話網關
  selected: null,     // { key:'A'|'B', seq }
  showClaims: false,  // claim.* 史料設定記錄默認摺疊
  narrateBusy: false,
  narrateMsg: '',
  wrapMsg: '',
  wrapReacts: null,   // 上一次「看完」時帳上已有幾條 user.react（防止重複點擊多寫一筆 director.learn）
  orphanOpen: false,
  saveMsg: '',
  gateway: null,      // /api/health 的 gateway 布林
};

const BEAT_TITLE = Object.fromEntries((CATALOG.qiefu?.beats || []).map((b) => [b.id, b.title]));
const beatTitle = (id) => BEAT_TITLE[id] || id;

const FIELD_LABEL = {
  wait: '等不等', polish: '雕琢 / 改變', depth: '人心粗細', surprise: '意外',
  emotion: '情緒', need: '你那句話', director: '配的導演',
};
const EMOTIONS = ['悲悯', '责任', '亲密', '紧张', '好奇', '顿悟'];
const VERB_LABEL = { go: '走過去', give: '遞東西', say: '說一句', watch: '看他的心思' };
const SIGNALS = ['停下来看心思', '追问为什么', '很快通过', '重来一次'];
const DIRECTOR_NAME = Object.fromEntries((STAFF.directors || []).map((d) => [d.id, d.name || d.id]));

/* ---------------- 泳道 ---------------- */

const LANES = [
  { key: 'user', label: '你' },
  { key: 'mentor', label: '導師' },
  { key: 'director', label: '導演' },
  { key: 'presentation', label: '呈現' },
  { key: 'actor', label: '演員' },
  { key: 'world', label: '世界' },
  { key: 'gateway', label: '網關' },
  { key: 'claim', label: '史料設定' },
];
const LANE_LABEL = Object.fromEntries(LANES.map((l) => [l.key, l.label]));
const laneOf = (e) => (e.kind.startsWith('claim.') ? 'claim' : roleKind(e.from));

/** 一條記錄的一句話：優先旁注（session.voices），否則規則 said，否則自己拼一句 */
function oneLine(session, e) {
  const v = session?.voices?.[e.seq];
  if (v && v.text) return { text: v.text, source: v.source === 'model' ? 'model' : 'rule', voiced: true };
  if (e.said) return { text: e.said, source: 'rule', voiced: true };
  const p = e.payload || {};
  if (e.kind === 'user.meet') return { text: `我說：${p.need || '（沒寫）'}`, source: 'user' };
  if (e.kind === 'user.react') return { text: `我在「${beatTitle(p.beat)}」${p.signal}`, source: 'user' };
  if (e.kind === 'user.edit-note') return { text: `我把「${FIELD_LABEL[p.field] || p.field}」改成 ${p.to}`, source: 'user' };
  if (e.kind === 'present.open') return { text: `《${CATALOG[p.presentation]?.title || p.presentation}》開演`, source: 'rule' };
  if (e.kind === 'present.deliver') return { text: `《${CATALOG[p.presentation]?.title || p.presentation}》看完了`, source: 'rule' };
  if (e.kind === 'gateway.call') {
    return { text: `${p.purpose || '說話'}：${p.ok ? '說成了' : '沒說成，退回規則台詞'}${p.model ? '｜' + p.model : ''}`, source: 'rule' };
  }
  if (e.kind.startsWith('claim.')) return { text: `${p.subject || ''}${p.predicate || ''}（${p.holder || ''}）`, source: 'rule' };
  return { text: e.kind, source: 'rule' };
}

/** 一個 session 的作品視圖：檔位、設計、預測。新建和讀檔都走這裡，所以刷新後也一致 */
function commissionView(session, presentationId = 'qiefu') {
  const allot = session.ledger.last((e) => e.kind === 'mentor.allot');
  return {
    need: session.mentor.notes().need?.value || '',
    chosen: allot?.payload?.chosen || {},
    spent: allot?.payload?.spent,
    budget: allot?.payload?.budget,
    design: session.state.designs?.[presentationId] || null,
    preds: session.state.predictions?.[presentationId]?.list || [],
    directorId: session.state.directorId,
  };
}

/* ---------------- 頂部服務審計 ---------------- */

function renderAudit() {
  const bar = $('audit-bar');
  const list = $('orphan-list');
  if (!S.A) {
    bar.innerHTML = '<span class="dim">還沒開世界</span>';
    list.hidden = true;
    return;
  }
  const a = S.A.audit();
  const roles = Object.entries(a.byRole)
    .map(([k, v]) => `${LANE_LABEL[k] || k} ${v.served}/${v.total}`).join(' · ');
  bar.innerHTML = `
    <div class="audit-main">
      <span class="audit-num">${a.total}</span> 個決定 ·
      <span class="audit-num ok">${a.served}</span> 個追得到你 ·
      <button class="orphan-btn ${a.orphans.length ? 'bad' : 'ok'}" data-act="orphans" type="button">${a.orphans.length} 個孤兒</button>
      <span class="audit-roles">${esc(roles)}</span>
    </div>
    <div class="audit-sub">${a.ok
      ? '每一個導師、導演的決定，沿 cause 往回走，都走到了你做過或說過的事。'
      : '有決定追不到你，展開看看是哪幾條。'}</div>`;

  if (!S.orphanOpen) { list.hidden = true; return; }
  list.hidden = false;
  if (!a.orphans.length) {
    list.innerHTML = '<div>沒有孤兒：每個決定都沿 cause 走到了你。這裡是空的，正是要證明的結果。</div>';
    return;
  }
  const rows = a.orphans.map((seq) => {
    const e = S.A.ledger.get(seq);
    return `<tr><td>#${seq}</td><td>${esc(e?.kind || '')}</td><td>${esc(e?.from || '')}</td></tr>`;
  }).join('');
  list.innerHTML = `<table><thead><tr><th>seq</th><th>kind</th><th>from</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------------- 泳道圖 ---------------- */

const GEO = { NODE_W: 168, NODE_H: 66, GAP: 58, LANE_H: 106, HEAD_H: 30, LEFT: 8 };

function renderGraphInto(host, session, key) {
  const all = session.ledger.entries;
  const claimCount = all.filter((e) => e.kind.startsWith('claim.')).length;
  $('claim-count').textContent = String(claimCount);

  const entries = S.showClaims ? all : all.filter((e) => !e.kind.startsWith('claim.'));
  const lanes = LANES.filter((l) => (l.key !== 'claim' || S.showClaims) && entries.some((e) => laneOf(e) === l.key));
  const laneIdx = new Map(lanes.map((l, i) => [l.key, i]));

  const { NODE_W, NODE_H, GAP, LANE_H, HEAD_H, LEFT } = GEO;
  const width = LEFT + entries.length * (NODE_W + GAP) + 40;
  const height = HEAD_H + Math.max(1, lanes.length) * LANE_H + 12;

  const pos = new Map();
  entries.forEach((e, i) => {
    const li = laneIdx.get(laneOf(e));
    if (li === undefined) return;
    pos.set(e.seq, {
      x: LEFT + i * (NODE_W + GAP),
      y: HEAD_H + li * LANE_H + (LANE_H - NODE_H) / 2,
    });
  });

  const sel = S.selected && S.selected.key === key ? S.selected.seq : null;
  const tr = sel ? session.trace(sel) : null;
  const path = tr?.ok ? tr.path : [];
  const pathIdx = new Map(path.map((s, i) => [s, i]));

  const edges = [];
  for (const e of entries) {
    for (const c of e.cause) {
      const a = pos.get(c), b = pos.get(e.seq);
      if (!a || !b) continue;
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
      const dx = Math.max(22, (x2 - x1) * 0.5);
      const on = pathIdx.has(c) && pathIdx.get(e.seq) === pathIdx.get(c) + 1;
      edges.push(`<path class="edge${on ? ' on' : sel ? ' dim' : ''}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}" />`);
    }
  }

  const nodes = entries.map((e) => {
    const p = pos.get(e.seq);
    if (!p) return '';
    const line = oneLine(session, e);
    const isClaim = e.kind.startsWith('claim.');
    const isDecision = DECISION_KINDS.includes(e.kind);
    const on = pathIdx.has(e.seq);
    const cls = ['node', on ? 'on-path' : (sel ? 'dim' : ''), isDecision ? 'decision' : '', isClaim ? 'claim' : '']
      .filter(Boolean).join(' ');
    const badge = line.voiced
      ? `<b class="src ${line.source === 'model' ? 'model' : 'rule'}">${line.source === 'model' ? '模' : '規'}</b>`
      : (line.source === 'user' ? '<b class="src user">我</b>' : '');
    return `<div class="${cls}" data-act="select" data-session="${key}" data-seq="${e.seq}"
      style="left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px" title="${esc(line.text)}">
      <div class="n-top"><span class="n-seq">#${e.seq}</span><span class="n-kind">${esc(e.kind)}</span>${badge}</div>
      <div class="n-said">${esc(clip(line.text, 46))}</div>
    </div>`;
  });

  const heads = entries.map((e, i) => {
    const x = LEFT + i * (NODE_W + GAP);
    return `<div class="head-seq" style="left:${x}px;width:${NODE_W}px">#${e.seq}</div>`;
  }).join('');

  const cols = entries.map((e, i) => `<div class="col-mark" style="left:${LEFT + i * (NODE_W + GAP) - GAP / 2}px"></div>`).join('');
  const rules = lanes.map((l, i) => `<div class="lane-rule" style="top:${HEAD_H + i * LANE_H}px"></div>`).join('');

  host.innerHTML = `
    <div class="graph-row">
      <div class="lane-labels" style="height:${height}px">
        <div style="height:${HEAD_H}px"></div>
        ${lanes.map((l) => `<div class="lane-label" style="height:${LANE_H}px"><span>${l.label}</span></div>`).join('')}
      </div>
      <div class="graph-scroll">
        <div class="graph-canvas" style="width:${width}px;height:${height}px">
          <svg class="edges" width="${width}" height="${height}">${edges.join('')}</svg>
          ${rules}${cols}${heads}${nodes.join('')}
        </div>
      </div>
    </div>`;
}

/** 選中的決定可能在幾千像素之外：把泳道橫向捲到它中間，否則點了看不到高亮。 */
function focusGraph() {
  if (!S.selected) return;
  const scroll = document.querySelector(`#graph-${S.selected.key.toLowerCase()} .graph-scroll`);
  const node = scroll?.querySelector(`.node[data-seq="${S.selected.seq}"]`);
  if (!scroll || !node) return;
  const target = node.offsetLeft - (scroll.clientWidth - node.offsetWidth) / 2;
  scroll.scrollLeft = Math.max(0, target);
}

function renderGraphs() {
  const hostA = $('graph-a');
  const hostB = $('graph-b');
  const wrapB = $('graph-b-wrap');
  if (!S.A) { hostA.innerHTML = ''; wrapB.hidden = true; return; }
  // 重畫會換掉整個泳道，先把橫向捲動位置記下來，否則每按一次反應就跳回最左邊
  const keep = {
    a: document.querySelector('#graph-a .graph-scroll')?.scrollLeft ?? 0,
    b: document.querySelector('#graph-b .graph-scroll')?.scrollLeft ?? 0,
  };
  renderGraphInto(hostA, S.A, 'A');
  if (S.B) {
    wrapB.hidden = false;
    renderGraphInto(hostB, S.B, 'B');
  } else {
    wrapB.hidden = true;
    hostB.innerHTML = '';
  }
  const sa = document.querySelector('#graph-a .graph-scroll');
  if (sa) sa.scrollLeft = keep.a;
  const sb = document.querySelector('#graph-b .graph-scroll');
  if (sb) sb.scrollLeft = keep.b;
}

/* ---------------- 側欄：這一個決定 ---------------- */

function payloadRows(e) {
  const p = e.payload || {};
  const keys = Object.keys(p);
  const hard = ['input', 'options', 'chosen'];
  const ordered = [...hard.filter((k) => keys.includes(k)), ...keys.filter((k) => !hard.includes(k))];
  if (!ordered.length) return '<div class="p-row"><span class="p-k">payload</span><span class="p-v">（空）</span></div>';
  return ordered.map((k) => {
    const v = p[k];
    const isHard = hard.includes(k);
    return `<div class="p-row"><span class="p-k">${esc(k)}${isHard ? '（硬）' : ''}</span>
      <span class="p-v ${isHard ? 'hard' : ''}">${mono(typeof v === 'number' ? round2(v) : v)}</span></div>`;
  }).join('');
}

function renderInspector() {
  const host = $('inspector');
  if (!S.A || !S.selected) {
    host.innerHTML = '<p class="hint">點泳道裡任何一個導師或導演的決定，這裡會顯示它硬的部分（input / options / chosen）、它當時的說法，以及它怎麼走到你。</p>';
    return;
  }
  const session = S.selected.key === 'B' ? S.B : S.A;
  const e = session?.ledger.get(S.selected.seq);
  if (!e) { host.innerHTML = '<p class="hint">這條記錄不在目前的 session 裡。</p>'; return; }

  const line = oneLine(session, e);
  const tr = session.trace(e.seq);
  const chips = tr.ok
    ? tr.path.map((seq, i) => {
      const en = session.ledger.get(seq);
      const self = seq === e.seq ? ' self' : (roleKind(en.from) === 'user' ? ' user' : '');
      return `${i ? '<span class="chip arrow">→</span>' : ''}<button class="chip${self}" data-act="select" data-session="${S.selected.key}" data-seq="${seq}" type="button">#${seq} ${esc(LANE_LABEL[laneOf(en)] || en.from)}</button>`;
    }).join('')
    : '<span class="dim">這條追不到你（孤兒）。</span>';

  const voice = session.voices?.[e.seq];
  host.innerHTML = `
    <div class="i-head">#${e.seq} · ${esc(e.kind)} · ${esc(e.from)} → ${esc(e.to)}</div>
    <div class="trace">${chips}</div>
    <div class="said"><span class="who">${esc(LANE_LABEL[laneOf(e)] || e.from)}當時的說法${voice ? `（${voice.source === 'model' ? '模型' : '規則'}）` : ''}</span>${esc(line.text)}</div>
    ${payloadRows(e)}
    <div class="p-row"><span class="p-k">hash</span><span class="p-v">${esc(e.hash)}</span></div>
    ${tr.ok ? '' : '<p class="hint">孤兒：沒有任何一條 cause 能走到你做過的事，這正是「為用戶服務」要被檢驗的地方。</p>'}`;
}

/* ---------------- 各拍反應 ---------------- */

function renderBeats() {
  const host = $('beats');
  if (!S.A) { host.innerHTML = ''; return; }
  const cv = commissionView(S.A);
  const design = cv.design;
  if (!design) { host.innerHTML = '<p class="hint">還沒有排戲。</p>'; return; }

  const reactions = S.A.ledger.entries.filter((e) => e.kind === 'user.react' && e.payload.scene === 'qiefu');
  const chosenLine = Object.entries(cv.chosen).map(([k, v]) => `${esc(beatTitle(k))}·${esc(v)}`).join('，');

  host.innerHTML = `
    <div class="beats-head">
      ${esc(design.slot)}做 · 情緒「${esc(design.emotion)}」 · 導演 ${esc(DIRECTOR_NAME[design.director] || design.director)}
      ｜檔位：${chosenLine}｜預算 ${esc(cv.spent)}/${esc(cv.budget)}
    </div>
    ${design.beats.map((b) => {
      const pred = cv.preds.find((p) => p.beat === b.id);
      const mine = reactions.filter((r) => r.payload.beat === b.id);
      const counts = SIGNALS.map((s) => {
        const n = mine.filter((r) => r.payload.signal === s).length;
        return n ? `<span class="b-count">${esc(s)} ×${n}</span>` : '';
      }).filter(Boolean).join('');
      const cat = CATALOG.qiefu.beats.find((x) => x.id === b.id);
      const grants = (b.grants || []).map((g) => VERB_LABEL[g] || g).join('、') || '不讓動';
      return `<div class="beat">
        <div class="b-title">${esc(cat?.title || b.id)}<small>${esc(cat?.scene || b.scene)} · 模板「${esc(b.template)}」 · 檔 ${b.level}
          ${b.locked ? '· 鎖死雕琢' : ''} · 放開：${esc(grants)} · 說話：${esc(b.language)}</small></div>
        <div class="b-desc">${esc(cat?.desc || '')}</div>
        <div class="b-meta">
          <span>導演的說法：<em class="b-why">${esc(b.why)}</em></span>
          ${pred ? `<span>導演猜你：${esc(pred.expect)}（信心 ${esc(pred.confidence)}）</span>` : '<span class="dim">這一拍導演沒猜你。</span>'}
        </div>
        <div class="b-actions">
          ${SIGNALS.map((s) => `<button class="btn small" data-act="react" data-beat="${b.id}" data-signal="${s}" type="button">${s}</button>`).join('')}
          ${counts}
        </div>
      </div>`;
    }).join('')}`;
}

/* ---------------- 導師筆記 ---------------- */

const NOTE_FIELDS = ['wait', 'polish', 'depth', 'surprise', 'emotion', 'need', 'director'];
const SRC_CLASS = { '问': 'wen', '观察': 'guan', '你改的': 'mine' };

function renderNotes() {
  const host = $('notes');
  if (!S.A) { host.innerHTML = ''; return; }
  const notes = S.A.mentor.notes();
  const rows = NOTE_FIELDS.map((f) => {
    const n = notes[f];
    if (!n) return '';
    const numeric = ['wait', 'polish', 'depth', 'surprise'].includes(f);
    let input;
    if (numeric) {
      input = `<input class="n-input" data-field="${f}" type="number" step="0.05" min="0" max="1" value="${esc(n.value)}" />`;
    } else if (f === 'emotion') {
      input = `<select class="n-input" data-field="${f}">${EMOTIONS.map((e2) => `<option value="${e2}"${e2 === n.value ? ' selected' : ''}>${e2}</option>`).join('')}</select>`;
    } else {
      input = `<input class="n-input wide" data-field="${f}" type="text" value="${esc(n.value)}" />`;
    }
    return `<tr data-row="${f}">
      <td>${esc(FIELD_LABEL[f] || f)}</td>
      <td>${input}</td>
      <td><span class="src-badge ${SRC_CLASS[n.source] || 'guan'}">${esc(n.source)}</span></td>
      <td><button class="btn small" data-act="edit-note" data-field="${f}" type="button">改</button></td>
    </tr>`;
  }).join('');
  host.innerHTML = `<table class="notes-table">
    <thead><tr><th>欄位</th><th>值</th><th>來源</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/* ---------------- 換一個你 ---------------- */

function oppositeOf(answers) {
  const out = {};
  for (const q of PREFS_QUESTIONS) {
    const cur = answers[q.id];
    const vs = q.options.map((o) => o.value);
    out[q.id] = vs.reduce((a, b) => (Math.abs(b - cur) > Math.abs(a - cur) ? b : a));
  }
  return out;
}

function contrastNeed(emotion) {
  const map = {
    责任: '来点紧张刺激的，越快越好',
    紧张: '我想知道这些人为什么这么选',
    顿悟: '我想看一个人怎么在乱世里做选择',
    亲密: '走走看看，随便逛逛就好',
    好奇: '我想弄清楚这一切的原因',
    悲悯: '来点紧张刺激的',
  };
  return map[emotion] || '来点紧张刺激的';
}

function renderCompare() {
  const host = $('compare');
  if (!S.A) { host.innerHTML = ''; return; }
  if (!S.B) {
    const notes = S.A.mentor.notes();
    host.innerHTML = `
      <p class="hint">同一頁再開一個你：用相反的三個回答、相反的情緒需求。
      導師會配另一個導演、另一套檔位、每個拍不同的 level / 放開方式 / 說話權。作品因人而異，這樣才看得見。</p>
      <p class="hint">目前：等不等 ${esc(round2(notes.wait?.value))} · 雕琢 ${esc(round2(notes.polish?.value))}
        · 看細 ${esc(round2(notes.depth?.value))} · 情緒 ${esc(notes.emotion?.value)}</p>
      <button class="btn small" data-act="alt" type="button">開一個相反的你</button>`;
    return;
  }
  const a = commissionView(S.A), b = commissionView(S.B);
  const diff = (x, y) => (String(x) === String(y) ? '' : ' class="diff"');
  const rows = [];
  rows.push(['需求那句話', esc(a.need), esc(b.need)]);
  rows.push(['導師配的導演', esc(DIRECTOR_NAME[a.directorId] || a.directorId), esc(DIRECTOR_NAME[b.directorId] || b.directorId)]);
  rows.push(['定的情緒', esc(a.design?.emotion), esc(b.design?.emotion)]);
  rows.push(['交片時機', esc(a.design?.slot), esc(b.design?.slot)]);
  for (const id of Object.keys({ ...a.chosen, ...b.chosen })) {
    rows.push([`檔位·${beatTitle(id)}`, esc(a.chosen[id] ?? '—'), esc(b.chosen[id] ?? '—')]);
  }
  for (const beat of CATALOG.qiefu.beats) {
    const x = (a.design?.beats || []).find((k) => k.id === beat.id);
    const y = (b.design?.beats || []).find((k) => k.id === beat.id);
    const gx = (x?.grants || []).map((g) => VERB_LABEL[g] || g).join('、') || '不讓動';
    const gy = (y?.grants || []).map((g) => VERB_LABEL[g] || g).join('、') || '不讓動';
    rows.push([`${beat.title}·level`, esc(x?.level ?? '—'), esc(y?.level ?? '—')]);
    rows.push([`${beat.title}·放開`, esc(gx), esc(gy)]);
    rows.push([`${beat.title}·說話`, esc(x?.language ?? '—'), esc(y?.language ?? '—')]);
  }
  host.innerHTML = `
    <table class="cmp">
      <thead><tr><th>比什麼</th><th>你</th><th>相反的你</th></tr></thead>
      <tbody>${rows.map(([k, x, y]) => `<tr><td class="k">${esc(k)}</td><td${diff(x, y)}>${x}</td><td${diff(x, y)}>${y}</td></tr>`).join('')}</tbody>
    </table>
    <p class="hint">朱砂格子＝兩邊不一樣。同一部《竊符》，換一個人來要，導演與檔位都換了。</p>
    <button class="btn small" data-act="close-alt" type="button">關掉對照</button>`;
}

/* ---------------- 存檔與權限 ---------------- */

function renderSave() {
  const host = $('save');
  host.innerHTML = `
    <div class="save-actions">
      <button class="btn small" data-act="save" type="button">存檔（PUT /api/world）</button>
      <button class="btn small" data-act="load" type="button">讀回</button>
      <button class="btn small" data-act="refuse" type="button">越權演示：導演改導師筆記</button>
    </div>
    <p class="hint">${esc(S.saveMsg || '存檔寫進伺服器的 .runtime/world.json；重新整理頁面會自動讀回同一本賬。')}</p>
    <p class="hint">模型網關：${S.gateway === null ? '還沒探測' : S.gateway ? '可用（可以讓角色自己說一句）' : '不可用（只用規則台詞，頁面照樣能跑）'}</p>`;
}

/* ---------------- 總渲染 ---------------- */

function render() {
  renderAudit();
  renderGraphs();
  renderInspector();
  renderBeats();
  renderNotes();
  renderCompare();
  renderSave();
  $('narrate-status').textContent = S.narrateMsg;
  $('wrap-msg').textContent = S.wrapMsg;
  $('narrate-btn').disabled = S.narrateBusy;
}

/* ---------------- 初見 ---------------- */

function renderPrefs() {
  $('prefs').innerHTML = PREFS_QUESTIONS.map((q) => `
    <div class="pref">
      <div class="q">${esc(q.q)}</div>
      ${q.options.map((o, i) => `<label><input type="radio" name="pref-${q.id}" value="${o.value}"${i === 0 ? ' checked' : ''} /> ${esc(o.label)}</label>`).join('')}
    </div>`).join('');
}

function readAnswers() {
  const answers = {};
  for (const q of PREFS_QUESTIONS) {
    const el = document.querySelector(`input[name="pref-${q.id}"]:checked`);
    answers[q.id] = el ? Number(el.value) : q.options[0].value;
  }
  return answers;
}

function startWorld() {
  const need = $('need-input').value.trim() || '我想看一个人在乱世里怎么做选择';
  S.A = createSession();
  S.A.meet(readAnswers(), need);
  S.A.commission('qiefu');
  S.selected = null;
  S.wrapMsg = '';
  S.wrapReacts = null;
  S.narrateMsg = '';
  $('intro').hidden = true;
  $('stage').hidden = false;
  render();
  toast('導師按你的回答記好筆記、配好導演，《竊符》開排了。');
}

/* ---------------- 存讀 ---------------- */

async function saveWorld() {
  if (!S.A) return toast('還沒有世界可以存。');
  const body = { v: 1, savedAt: new Date().toISOString(), a: S.A.save(), b: S.B ? S.B.save() : null };
  const res = await fetch('/api/world', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { S.saveMsg = '存檔失敗：' + (data.error || res.status); }
  else { S.saveMsg = `已存檔（${data.bytes} bytes）：整本賬、導師筆記、導演手藝、旁注都寫進 .runtime/world.json。`; }
  render();
  toast(S.saveMsg);
}

async function loadWorld(silent) {
  const res = await fetch('/api/world');
  if (res.status === 404) {
    if (!silent) toast('伺服器上還沒有存檔。');
    return false;
  }
  if (!res.ok) { if (!silent) toast('讀檔失敗：' + res.status); return false; }
  const data = await res.json();
  if (!data?.a?.ledger) { if (!silent) toast('存檔裡沒有可讀的 session。'); return false; }
  try {
    S.A = createSession({ saved: data.a });
    S.B = data.b?.ledger ? createSession({ saved: data.b }) : null;
  } catch (err) {
    toast('讀檔被拒絕：' + (err?.message || err));
    return false;
  }
  S.selected = null;
  $('intro').hidden = true;
  $('stage').hidden = false;
  S.saveMsg = `已讀回存檔（${data.savedAt || '未知時間'}，賬本 ${S.A.ledger.size} 條），指紋逐條比對通過。`;
  render();
  if (!silent) toast('讀回來了，賬本指紋一致。');
  return true;
}

async function probeHealth() {
  try {
    const h = await (await fetch('/api/health')).json();
    S.gateway = !!h.gateway;
  } catch { S.gateway = null; }
}

/* ---------------- 動作 ---------------- */

async function narrateNext() {
  if (S.narrateBusy) return;
  if (!S.A) return toast('先開世界。');
  S.narrateBusy = true;
  render();
  try {
    if (S.gateway === false && !confirm('本機模型網關看起來沒開：每一句都會等到超時才退回規則台詞，會很慢。仍要試嗎？')) return;
    if (!S.speaker) S.speaker = createSpeaker({ ledger: S.A.ledger, call: makeBrowserCall() });
    const todo = narratableRecords(S.A.ledger).filter((e) => !S.A.voices[e.seq]).map((e) => e.seq);
    if (!todo.length) { toast('賬本裡每一句都配過旁注了（或沒有可配的台詞）。'); return; }
    const batch = todo.slice(0, 6);
    let done = 0, modeled = 0;
    for (const seq of batch) {
      S.narrateMsg = `正在讓角色自己說：${done}/${batch.length}（單句最多等 6 秒，慢了就退回規則台詞）`;
      render();
      await narrate(S.A, { seqs: [seq], speaker: S.speaker });
      done++;
      if (S.A.voices[seq]?.source === 'model') modeled++;
    }
    S.narrateMsg = `這一批 ${done} 句：${modeled} 句模型說的、${done - modeled} 句退回規則台詞。${todo.length > batch.length ? `還有 ${todo.length - batch.length} 句可以配。` : '賬本裡能配的都配完了。'}`;
  } catch (err) {
    S.narrateMsg = '旁注失敗：' + (err?.message || err);
  } finally {
    S.narrateBusy = false;
    render();
  }
}

function editNote(field) {
  const row = document.querySelector(`[data-row="${field}"]`);
  if (!row || !S.A) return;
  const sel = row.querySelector('select');
  const inp = row.querySelector('input');
  let v;
  if (sel) v = sel.value;
  else if (inp && inp.type === 'number') {
    const n = Number(inp.value);
    if (!Number.isFinite(n)) return toast('請填 0 到 1 之間的數。');
    v = Math.max(0, Math.min(1, n));
  } else v = inp ? inp.value : '';
  S.A.editNote(field, v);
  render();
  toast(`你把「${FIELD_LABEL[field] || field}」改成 ${v}，導師記成「你改的」；之後你的反應不會再覆蓋它。`);
}

function react(beat, signal) {
  S.A.react('qiefu', beat, signal);
  render();
  toast(`你在「${beatTitle(beat)}」${signal}：導師記一條，導演也會拿來對照他的猜測。`);
}

function wrapUp() {
  // 「看完」是把目前的預測和你的反應對照一次：同一批反應只對照一次。
  // 沒有這道閘，連點兩下會多寫一筆一模一樣的 director.learn（實測：21 個決定 → 23 個）。
  // 你又點了新反應之後，這道閘自己就鬆開，可以再對照一次。
  const reacts = S.A.ledger.entries.filter((e) => e.kind === 'user.react').length;
  if (S.wrapReacts !== null && reacts === S.wrapReacts) {
    toast('這一輪已經對照過了：你又沒有新反應，導演不會多寫一筆。');
    return;
  }
  const r = S.A.wrap('qiefu');
  if (!r) { S.wrapMsg = '這部戲還沒有可對照的預測。'; render(); return; }
  S.wrapReacts = reacts;
  const learn = S.A.ledger.get(r.seq);
  const c = learn.payload.craft;
  S.wrapMsg = `導演把 ${learn.payload.errors.length} 個反應和他的猜測對照：命中 ${Math.round(learn.payload.hitRate * 100)}%。手藝 節奏 ${c.before.paceBias}→${c.after.paceBias}、悲劇 ${c.before.tragedyBias}→${c.after.tragedyBias}（寫成 #${r.seq}）。`;
  render();
  toast('《竊符》看完，導演改了手藝，記錄在賬上。');
}

function makeAlt() {
  if (!S.A) return;
  const notes = S.A.mentor.notes();
  const answers = { wait: notes.wait?.value ?? 0.5, polish: notes.polish?.value ?? 0.5, depth: notes.depth?.value ?? 0.5 };
  const opp = oppositeOf(answers);
  const need = contrastNeed(notes.emotion?.value);
  S.B = createSession();
  S.B.meet(opp, need);
  S.B.commission('qiefu');
  render();
  toast(`第二個你開好了：${need}（相反的回答）。往下看對照表。`);
}

function refuseDemo() {
  if (!S.A) return;
  const seq = S.A.director().tryEditMentor('depth');
  S.selected = { key: 'A', seq };
  render();
  focusGraph();
  const e = S.A.ledger.get(seq);
  toast(`導演想改導師的「人心粗細」，被拒絕：#${seq} ${e.payload.attempted}，理由：${e.payload.reason}`);
}

function resetWorld() {
  S.A = null; S.B = null; S.speaker = null; S.selected = null;
  S.wrapMsg = ''; S.wrapReacts = null; S.narrateMsg = ''; S.saveMsg = ''; S.orphanOpen = false;
  $('stage').hidden = true;
  $('intro').hidden = false;
  render();
  toast('回到初見。存檔還在伺服器上，隨時可以讀回。');
}

/* ---------------- 事件 ---------------- */

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  try {
    if (act === 'select') {
      const changed = !S.selected || S.selected.key !== t.dataset.session || S.selected.seq !== Number(t.dataset.seq);
      S.selected = { key: t.dataset.session, seq: Number(t.dataset.seq) };
      render();
      if (changed) focusGraph();
      $('inspector-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (act === 'orphans') {
      S.orphanOpen = !S.orphanOpen;
      render();
    } else if (act === 'edit-note') {
      editNote(t.dataset.field);
    } else if (act === 'react') {
      react(t.dataset.beat, t.dataset.signal);
    } else if (act === 'alt') {
      makeAlt();
    } else if (act === 'close-alt') {
      S.B = null; render();
    } else if (act === 'refuse') {
      refuseDemo();
    } else if (act === 'save') {
      await saveWorld();
    } else if (act === 'load') {
      await loadWorld(false);
    }
  } catch (err) {
    toast('操作失敗：' + (err?.message || err));
  }
});

$('start-btn').addEventListener('click', () => { try { startWorld(); } catch (err) { toast(err?.message || String(err)); } });
$('load-btn').addEventListener('click', () => loadWorld(false));
$('narrate-btn').addEventListener('click', narrateNext);
$('reset-btn').addEventListener('click', resetWorld);
$('wrap-btn').addEventListener('click', () => { if (!S.A) return; wrapUp(); });
$('claim-toggle').addEventListener('change', (ev) => { S.showClaims = ev.target.checked; render(); });

/* ---------------- 開場 ---------------- */

renderPrefs();
(async () => {
  await probeHealth();
  render();
  await loadWorld(true);
})();
