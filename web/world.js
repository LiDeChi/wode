// 第二阶段页面：一个世界，四部作品，作品之间的线全部由主张图算出。
// 你在每部作品里拨的那个机关（选择），会让世界重新长一遍，线跟着变。

import { createSession } from '/shared/engine/session.js';
import { growWorld, CHOICES, WORLD_ORDER, WORK_HOLDERS, evidenceNeeded } from '/shared/engine/works.js';
import { ancestors } from '/shared/core/ledger.js';
import { STATUS } from '/shared/core/claims.js';
import { PREFS_QUESTIONS } from '/shared/data/seed.js';
import { CATALOG } from '/shared/play/catalog.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'dw.world.v1';
const KIND = { film: '電影 · 零交互', action: '動作 · 兩三分鐘', game: '遊戲' };
const POS = {
  changping: { x: 190, y: 120, glyph: '城', place: '城外高處' },
  night: { x: 600, y: 110, glyph: '夜', place: '大梁 · 魏王臥內' },
  qiefu: { x: 600, y: 430, glyph: '符', place: '大梁 → 鄴' },
  weicheng: { x: 1010, y: 290, glyph: '倉', place: '邯鄲城內' },
};
// 有的两部作品之间隔着别的海报，线要绕开
const BEND = { 'changping—weicheng': 255 };
const TYPE_ZH = { 承接: '承接', 引用: '引用', 并行: '並行', 争议: '爭議', 反转: '反轉' };
const STATUS_ZH = { active: '站得住', former: '曾經的共識', disputed: '爭議中，推不動' };

let S = { answers: null, need: '', choices: {}, world: null, prevEdges: null, focus: null };

const title = (w) => `《${CATALOG[w]?.title || w}》`;
const claimOf = (id) => S.world.session.claims.get(id);
const claimLine = (c) => `${c.subject}${c.predicate}：${c.object}`;
const edgeKey = (e) => `${e.from}>${e.to}|${e.type}|${e.claims.map((id) => { const c = claimOf(id); return c ? `${c.subject}${c.predicate}` : id; }).join(',')}`;

/* ---------------- 长出世界 ---------------- */

function grow() {
  S.world = growWorld(createSession, { answers: S.answers, need: S.need, choices: S.choices });
  S.choices = S.world.choices;
  localStorage.setItem(KEY, JSON.stringify({ answers: S.answers, need: S.need, choices: S.choices }));
}

function pairTypes(edges) {
  const m = new Map();
  for (const e of edges) {
    const k = [e.from, e.to].sort().join('—');
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(e.type);
  }
  return m;
}

function narrateDiff(work, optionLabel, before, after) {
  const a = pairTypes(before); const b = pairTypes(after);
  const pairs = new Set([...a.keys(), ...b.keys()]);
  const lines = [];
  for (const p of pairs) {
    const x = [...(a.get(p) || [])].sort().join('、'); const y = [...(b.get(p) || [])].sort().join('、');
    if (x === y) continue;
    const [m, n] = p.split('—');
    const tz = (s) => s.split('、').filter(Boolean).map((t) => TYPE_ZH[t]).join('、') || '沒有線';
    lines.push(`${title(m)}與${title(n)}：${tz(x)} → ${tz(y)}`);
  }
  return `你在${title(work)}改成「${optionLabel}」。` + (lines.length ? '世界重新長了一遍：' + lines.join('；') + '。' : '這一下沒有改變作品之間的線，但改了作品裡的事——點那部作品看。');
}

/* ---------------- 画面 ---------------- */

function renderDirector() {
  const d = S.world.session.director();
  const need = evidenceNeeded(d.def);
  $('director').innerHTML = `<span class="mask">${esc(d.def.name.slice(0, 1))}</span>
    <span class="dname">${esc(d.def.name)}</span>
    <span class="dbio">${need > 1 ? '愛雕琢：推翻一條共識，要兩件證據' : '愛放開：一件證據就肯放行'}</span>`;
}

function posterClaims(w) {
  return S.world.session.claims.all().filter((c) => c.presentation === w);
}

function renderPosters() {
  const host = $('posters');
  host.innerHTML = WORLD_ORDER.map((w) => {
    const p = POS[w]; const cat = CATALOG[w]; const spec = CHOICES[w];
    const mine = posterClaims(w);
    const lead = mine.find((c) => c.status !== STATUS.FORMER && /結局|结局|存粮|去向|下场/.test(c.predicate)) || mine[0];
    const knob = spec ? `<div class="knob" role="group" aria-label="${esc(spec.label)}">
        <div class="knob-q">${esc(spec.label)}</div>
        ${spec.options.map((o) => `<button type="button" class="slat${S.choices[w] === o.id ? ' on' : ''}" data-work="${w}" data-opt="${o.id}" title="${esc(o.note)}">${esc(o.label)}</button>`).join('')}
      </div>` : '<div class="knob still">電影：你只看。它把城外看見的說成公開的說法，放進圖裡。</div>';
    return `<article class="poster m-${w}${S.focus === w ? ' focus' : ''}" style="left:${p.x - 130}px;top:${p.y - 92}px" data-poster="${w}">
      <div class="motif" aria-hidden="true"><span class="glyph">${p.glyph}</span><i></i><i></i><i></i></div>
      <header><h3>${esc(title(w))}</h3><span class="kind">${esc(KIND[cat.kind] || cat.kind)}</span></header>
      <p class="who">${esc(p.place)} · ${esc(WORK_HOLDERS[w])}的眼睛</p>
      <p class="lead">${lead ? esc(claimLine(lead)) : ''}</p>
      ${knob}
    </article>`;
  }).join('');
}

function curve(a, b, offset, t = 0.5) {
  const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
  const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; const ny = dx / len;
  const cx = mx + nx * offset; const cy = my + ny * offset;
  const u = 1 - t;
  return { d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`, lx: u * u * a.x + 2 * u * t * cx + t * t * b.x, ly: u * u * a.y + 2 * u * t * cy + t * t * b.y };
}

function renderThreads(fresh = new Set()) {
  const byPair = new Map();
  for (const e of S.world.edges) {
    const k = [e.from, e.to].sort().join('—');
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(e);
  }
  let html = '';
  for (const [pair, list] of byPair) {
    list.forEach((e, i) => {
      const off = (i - (list.length - 1) / 2) * 34 + (BEND[pair] ?? 18) * (e.from < e.to ? 1 : -1) * (pair.startsWith(e.from) ? 1 : 1);
      const t = (BEND[pair] ? 0.74 : 0.5) + (i - (list.length - 1) / 2) * 0.1;
      const { d, lx, ly } = curve(POS[e.from], POS[e.to], off, t);
      const k = edgeKey(e);
      const idx = S.world.edges.indexOf(e);
      const isNew = fresh.has(k);
      const twin = e.type === '并行' ? `<path class="twin" d="${d}" transform="translate(0,5)" />` : '';
      const mark = e.type === '反转' ? `<g class="crack" transform="translate(${lx},${ly})"><circle r="11" /><path d="M-7,-7 L-1,0 L-5,4 L6,8" /></g>`
        : e.type === '争议' ? `<g class="knot" transform="translate(${lx},${ly})"><circle r="6" /></g>` : '';
      html += `<g class="thread t-${e.type}${isNew ? ' fresh' : ''}${S.focus && S.focus !== e.from && S.focus !== e.to ? ' dim' : ''}" data-edge="${idx}" tabindex="0">
        <path class="hit" d="${d}" />
        <path class="ink" d="${d}" ${e.type === '承接' || e.type === '引用' ? 'marker-end="url(#arrow)"' : ''} />${twin}${mark}
        <text x="${lx}" y="${ly - 12}">${TYPE_ZH[e.type]}</text>
      </g>`;
    });
  }
  $('lines').innerHTML = html;
}

function renderGhosts(removed) {
  $('ghosts').innerHTML = removed.map((e) => {
    const { d } = curve(POS[e.from], POS[e.to], 18);
    return `<path class="ghost t-${e.type}" d="${d}" />`;
  }).join('');
  setTimeout(() => { $('ghosts').innerHTML = ''; }, 2200);
}

function renderFormer() {
  const s = S.world.session;
  const former = s.claims.all().filter((c) => c.status === STATUS.FORMER && c.presentation);
  const box = $('former');
  box.hidden = !former.length;
  box.innerHTML = former.length ? `<h3>曾經的共識</h3>` + former.map((c) => {
    const h = c.history.find((x) => x.what === 'overturned');
    const by = c.overturnedBy && s.claims.get(c.overturnedBy);
    return `<div class="tomb"><s>${esc(claimLine(c))}</s>
      <span>（${esc(c.holder)}·${esc(c.channel)}，出自${esc(title(c.presentation))}）</span>
      <em>被${by ? esc(title(by.presentation)) + '的' + esc(by.holder) : ''}推翻：${esc(h?.explanation || '')}。它沒有被刪掉。</em></div>`;
  }).join('') : '';
}

function renderStudio() {
  const s = S.world.session; const d = s.director();
  const rows = WORLD_ORDER.map((w) => {
    const des = s.state.designs[w];
    if (!des) return '';
    const beats = des.beats.map((b) => `<span class="beat${b.locked ? ' locked' : ''}" title="${esc(b.why)}">${esc(CATALOG[w].beats.find((x) => x.id === b.id)?.title || b.id)}<small>${b.locked ? '鎖死雕琢' : b.level >= 2 ? '放開' : b.level === 1 ? '留一句話' : '只看'}</small></span>`).join('');
    return `<div class="srow"><b>${esc(title(w))}</b>${beats}</div>`;
  }).join('');
  const verdict = s.ledger.last((e) => e.kind === 'director.approve' || e.kind === 'director.refuse');
  $('studio').innerHTML = `<h3>片場：${esc(d.def.name)}怎麼排這四部</h3>${rows}
    ${verdict ? `<p class="verdict ${verdict.kind === 'director.approve' ? 'yes' : 'no'}">${esc(d.def.name)}${verdict.kind === 'director.approve' ? '批了' : '沒批'}《圍城》的推翻請求：手上 ${verdict.payload.evidence} 件證據，他要 ${verdict.payload.need} 件（${esc(verdict.payload.rule)}）。</p>` : ''}`;
}

/* ---------------- 浮层：这根线为什么在 ---------------- */

function whyChain(seqs) {
  const s = S.world.session;
  const all = new Set();
  for (const q of seqs) for (const a of ancestors(s.ledger, q)) all.add(a);
  const out = [];
  for (const q of [...all].sort((a, b) => a - b)) {
    const e = s.ledger.get(q);
    if (e.kind === 'user.meet') out.push(`你初見時說：「${e.payload.need}」`);
    if (e.kind === 'user.choose') out.push(`你在${title(e.payload.presentation)}選了「${e.payload.label}」`);
    if (e.kind === 'mentor.brief') out.push('導師把你的回答寫成需求，交給導演');
    if (e.kind === 'director.approve' || e.kind === 'director.refuse') out.push(`${s.director().def.name}${e.kind === 'director.approve' ? '批准' : '拒絕'}：${e.payload.rule}`);
  }
  return [...new Set(out)];
}

function claimCard(c) {
  const s = S.world.session;
  return `<div class="cc s-${c.status}">
    <div class="cc-top"><b>${esc(c.holder)}</b><span class="ch">${esc(c.channel)}</span><span class="st">${STATUS_ZH[c.status]}</span></div>
    <div class="cc-body">${esc(claimLine(c))}</div>
    ${c.note ? `<div class="cc-note">${esc(c.note)}</div>` : ''}
    <div class="cc-foot">出自${esc(title(c.presentation))} · 推翻它要付 ${s.claims.overturnCost(c.id)}</div>
  </div>`;
}

function openEdge(idx) {
  const e = S.world.edges[idx]; const cs = e.claims.map(claimOf);
  const [a, b] = cs;
  const s = S.world.session;
  let head;
  if (e.type === '承接') head = `${title(e.from)}裡長出的「${claimLine(a)}」，被${title(e.to)}讀到，成了它的起點。`;
  if (e.type === '引用') head = `${title(e.to)}沿用了${title(e.from)}的說法。被沿用一次，它就更難推翻（現在要付 ${s.claims.overturnCost(a.id)}）。`;
  if (e.type === '并行') head = `同一件事，兩雙眼睛：${esc(a.holder)}是「${a.channel}」來的，${esc(b.holder)}是「${b.channel}」來的。兩說並存，差別追得到渠道。`;
  if (e.type === '争议') head = `兩說衝突。前一條推翻成本 ${s.claims.overturnCost(a.id)}，夠高，沒有人批准就推不動，後一條只能掛著「爭議」。`;
  if (e.type === '反转') head = `${title(e.to)}推翻了${title(e.from)}裡被沿用過的共識。新證據、解釋、導演批准，三樣齊了。舊的那條留在圖裡。`;
  const seqs = cs.flatMap((c) => c.history.map((h) => h.seq));
  const why = whyChain(seqs);
  $('slip-body').innerHTML = `<p class="kicker t-${e.type}">${TYPE_ZH[e.type]} · ${esc(title(e.from))} → ${esc(title(e.to))}</p>
    <p class="head">${head}</p>
    ${cs.map(claimCard).join('')}
    <h4>這根線為什麼在</h4>
    <ol class="why">${why.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;
  $('slip').hidden = false;
}

function openPoster(w) {
  const s = S.world.session;
  const mine = posterClaims(w);
  const readIds = s.claims.all().filter((c) => c.readBy.includes(w) || c.citedBy.includes(w));
  $('slip-body').innerHTML = `<p class="kicker">${esc(title(w))} · ${esc(WORK_HOLDERS[w])}的眼睛</p>
    <p class="head">它只做兩件事：讀它看得見的說法，用動作放回新的說法。它改不了別的作品裡已有的話。</p>
    <h4>它讀到的（${readIds.length}）</h4>${readIds.map(claimCard).join('') || '<p class="none">什麼也沒讀，它是第一部。</p>'}
    <h4>它放回圖裡的（${mine.length}）</h4>${mine.map(claimCard).join('')}`;
  $('slip').hidden = false;
}

/* ---------------- 交互 ---------------- */

function fit() {
  const k = Math.min(1, ($('fit').clientWidth - 8) / 1200);
  $('stage').style.transform = `scale(${k})`;
  $('fit').style.height = `${560 * k + 8}px`;
}

function render(fresh) {
  renderDirector(); renderPosters(); renderThreads(fresh); renderFormer(); renderStudio();
}

function setChoice(work, opt) {
  if (S.choices[work] === opt) return;
  const before = S.world.edges.map((e) => ({ ...e, key: edgeKey(e) }));
  S.choices = { ...S.choices, [work]: opt };
  grow();
  const after = S.world.edges.map((e) => ({ ...e, key: edgeKey(e) }));
  const beforeKeys = new Set(before.map((e) => e.key));
  const afterKeys = new Set(after.map((e) => e.key));
  const fresh = new Set(after.filter((e) => !beforeKeys.has(e.key)).map((e) => e.key));
  render(fresh);
  renderGhosts(before.filter((e) => !afterKeys.has(e.key)));
  const label = CHOICES[work].options.find((o) => o.id === opt).label;
  $('narration').textContent = narrateDiff(work, label, before, after);
  $('narration').classList.remove('pulse'); void $('narration').offsetWidth; $('narration').classList.add('pulse');
}

function enter() {
  $('meet').hidden = true; $('world').hidden = false;
  grow(); render(); fit();
  $('narration').textContent = `導師聽完你的話，替你挑了${S.world.session.director().def.name}。四部作品按順序演完，線是演完之後從圖裡算出來的。撥一下作品下面的機關，看線怎麼變。`;
}

function showMeet() {
  $('world').hidden = true; $('meet').hidden = false;
  $('prefs').innerHTML = PREFS_QUESTIONS.map((q) => `<div class="pref"><div class="q">${esc(q.q)}</div>
    ${q.options.map((o, i) => `<label><input type="radio" name="p-${q.id}" value="${o.value}"${(S.answers ? S.answers[q.id] === o.value : i === 0) ? ' checked' : ''} /> ${esc(o.label)}</label>`).join('')}</div>`).join('');
  $('need').value = S.need || '';
}

document.addEventListener('click', (ev) => {
  const slat = ev.target.closest('.slat');
  if (slat) { ev.stopPropagation(); setChoice(slat.dataset.work, slat.dataset.opt); return; }
  const th = ev.target.closest('.thread');
  if (th) { openEdge(Number(th.dataset.edge)); return; }
  const po = ev.target.closest('.poster');
  if (po) { S.focus = S.focus === po.dataset.poster ? null : po.dataset.poster; render(); if (S.focus) openPoster(S.focus); else $('slip').hidden = true; return; }
  if (ev.target.closest('#slip-close')) { $('slip').hidden = true; S.focus = null; render(); }
  if (ev.target.closest('#director')) showMeet();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { $('slip').hidden = true; S.focus = null; if (S.world) render(); }
  if (ev.key === 'Enter' && ev.target.closest?.('.thread')) openEdge(Number(ev.target.closest('.thread').dataset.edge));
});
$('go').addEventListener('click', () => {
  const answers = {};
  for (const q of PREFS_QUESTIONS) answers[q.id] = Number(document.querySelector(`input[name="p-${q.id}"]:checked`)?.value ?? q.options[0].value);
  S.answers = answers; S.need = $('need').value.trim() || '我想看一個人在亂世裡怎麼做選擇';
  S.prevEdges = null; enter();
});
window.addEventListener('resize', () => S.world && fit());

const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } })();
if (saved?.answers) { S = { ...S, ...saved }; enter(); } else showMeet();
