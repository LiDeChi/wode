import { entryKey, normalizeBlocks } from './text-model.js';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const button = (label, fn) => { const n = el('button', 'text-button', label); n.type = 'button'; n.addEventListener('click', fn); return n; };
const fingerprint = (e) => JSON.stringify(e);
let readerCount = 0;

/** 安全文本：只生成已知语义元素；不插入原文 HTML。 */
export function renderTextBlocks(root, blocks, { dev = false } = {}) {
  for (const b of blocks) {
    const n = el(b.type === 'quote' ? 'blockquote' : b.type === 'heading' ? (b.level === 2 ? 'h3' : 'h2') : b.type === 'list' ? 'ul' : 'p');
    n.dataset.blockId = b.id;
    if (b.type === 'list') for (const item of b.items) n.append(el('li', '', item));
    else { if (b.speaker) n.append(el('span', 'text-speaker', b.speaker)); n.append(document.createTextNode(b.text)); }
    if (dev && b.refs?.length) n.append(el('small', 'text-ref', b.refs.map((r) => `${r.recordId || r.captureId || '无记录'} ${r.field}`).join('；')));
    root.append(n);
  }
}

/** 一个 reader 一个 modal。只持有呈现模型，不持有 session/play。 */
export function createTextReader({ root, resolveSource, onReadingChange = () => {}, dev = false }) {
  const uid = `text-reader-${++readerCount}`;
  root.classList.add('text-reader'); root.lang = 'zh-CN';
  const list = el('div', 'text-entry-list'); const live = el('p', 'text-live'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
  const dialog = el('dialog', 'text-dialog'); dialog.id = `${uid}-dialog`; dialog.setAttribute('aria-labelledby', `${uid}-title`);
  const header = el('header', 'text-dialog-header');
  const heading = el('h1'); heading.id = `${uid}-title`; heading.tabIndex = -1;
  const closeButton = button('关闭读页', close); closeButton.classList.add('text-close');
  header.append(heading, closeButton);
  const notice = el('div', 'text-version-notice');
  const scroll = el('div', 'text-scroll');
  const article = el('article', 'text-prose'); const source = el('section', 'text-source'); source.setAttribute('aria-label', '同一份出处');
  scroll.append(article, source); dialog.append(header, notice, scroll); root.append(list, live, dialog);
  const versions = new Map(); const cards = new Map(); const preferences = new Map(); const anchors = new Map();
  let current = null, pinned = null, opener = null, controller = null, destroyed = false, quiet = false, selectionBeforeClose = null, noticeSignature = null;
  const versionKey = (m) => JSON.stringify([m.scope, m.revision]);
  const find = (m, id) => m?.entries.find((e) => e.id === id);
  const announce = (s) => { if (!quiet && live.textContent !== s) live.textContent = s; };
  const changed = () => onReadingChange({ open: dialog.open, modal: dialog.open });
  const selectedIn = (node) => { const sel = window.getSelection(); return sel?.rangeCount && !sel.isCollapsed && node.contains(sel.anchorNode); };
  const isBusy = (node) => node.contains(document.activeElement) || selectedIn(node);
  const captureAnchor = () => {
    const top = scroll.getBoundingClientRect().top;
    const blocks = [...article.querySelectorAll('[data-block-id]')];
    const block = blocks.find((b) => b.getBoundingClientRect().bottom > top) || blocks[0];
    return { blockId: block?.dataset.blockId || null, offset: block ? block.getBoundingClientRect().top - top : 0, scrollTop: scroll.scrollTop };
  };
  const applyAnchor = (a) => {
    if (!a) { scroll.scrollTop = 0; return; }
    const b = [...article.querySelectorAll('[data-block-id]')].find((n) => n.dataset.blockId === a.blockId);
    scroll.scrollTop = b ? scroll.scrollTop + b.getBoundingClientRect().top - scroll.getBoundingClientRect().top - a.offset : a.scrollTop;
  };
  const pinKey = () => pinned && JSON.stringify([pinned.model.scope, pinned.entry.subjectId, pinned.entry.id, pinned.model.revision]);
  function remember() { if (pinned) anchors.set(pinKey(), captureAnchor()); }
  function availability(entry) {
    return entry.availability === 'partial' ? '材料不完整：保留了摘要，原话未留存。' : entry.availability === 'missing' ? '没有留存这一段材料；当前无法追看原文。' : '';
  }
  function clearSource() { controller?.abort(); controller = null; source.replaceChildren(); }
  function showPinned() {
    clearSource(); article.replaceChildren(); heading.textContent = pinned.entry.title;
    article.append(el('p', 'text-capture', `${pinned.model.capturedAt || '留存材料'} · 第 ${pinned.model.revision} 版`));
    const gap = availability(pinned.entry); if (gap) article.append(el('p', 'text-gap', gap));
    renderTextBlocks(article, pinned.entry.blocks, { dev });
    const foot = el('nav', 'text-reading-actions'); foot.setAttribute('aria-label', '阅读操作');
    foot.append(button('追看同一份出处', () => readSource())); article.append(foot);
    refreshNotice(); applyAnchor(anchors.get(pinKey()));
  }
  function refreshNotice() {
    const signature = pinned && current ? JSON.stringify([pinKey(), current.scope, current.revision, find(current, pinned.entry.id), [...versions.keys()]]) : null;
    if (signature === noticeSignature) return;
    noticeSignature = signature;
    notice.replaceChildren(); if (!pinned || !current) return;
    if (current.scope !== pinned.model.scope) { notice.append(el('p', '', '上一场的留存页。')); return; }
    const latest = find(current, pinned.entry.id);
    const hasLater = latest && current.revision !== pinned.model.revision && fingerprint(latest) !== fingerprint(pinned.entry);
    if (hasLater) {
      notice.append(el('span', '', '有后续，正在读的这一页保持原样。'), button('读后续', () => {
        remember(); pinned = { model: current, entry: latest }; showPinned(); closeButton.focus(); announce('已打开后续版本。');
      })); announce('有后续；点“读后续”再换页。');
    } else if (latest && current.revision !== pinned.model.revision) notice.append(el('span', '', '材料相同，继续读这一页。'));
    const older = [...versions.values()].filter((m) => m.scope === pinned.model.scope && m.revision !== pinned.model.revision && find(m, pinned.entry.id));
    if (older.length) notice.append(button('回看留存旧页', () => { remember(); const m = older[0]; pinned = { model: m, entry: find(m, pinned.entry.id) }; showPinned(); closeButton.focus(); }));
  }
  async function readSource() {
    clearSource(); const requestPin = pinKey(); const localController = new AbortController(); controller = localController;
    const h = el('h2', '', '同一份出处'); h.tabIndex = -1; source.append(h, el('p', 'text-source-note', '只查这页绑定的留存材料。'));
    h.focus();
    if (!pinned.entry.refs.length || !resolveSource) { source.append(el('p', 'text-gap', '未提供可定位的出处。')); announce('缺来源：未提供记录。'); return; }
    for (const ref of pinned.entry.refs) {
      const section = el('div', 'text-source-record'); section.append(el('h3', '', ref.label || '留存记录'), el('p', 'text-source-note', '正在读取……')); source.append(section);
      try {
        const result = await resolveSource(ref, { signal: localController.signal });
        if (destroyed || localController.signal.aborted || pinKey() !== requestPin) return;
        section.lastChild.remove();
        const returned = result.ref;
        const same = returned && ['scope', 'revision', 'recordId', 'seq', 'captureId', 'field'].every((k) => String(returned[k] ?? '') === String(ref[k] ?? ''));
        if (!same) { section.append(el('p', 'text-gap', '返回材料不属于这一页，已丢弃。')); continue; }
        const status = result.status;
        if (result.blocks?.length) renderTextBlocks(section, normalizeBlocks(result.blocks, [ref]), { dev });
        if (status !== 'ok') { const gaps = Array.isArray(result.missing) ? result.missing : [result.missing || '这份记录未保存原文。']; section.append(el('p', 'text-gap', gaps.join('；'))); announce('缺来源：部分原文未留存。'); }
        if (dev) section.append(el('p', 'text-ref', JSON.stringify(ref)));
      } catch (error) { if (!localController.signal.aborted && pinKey() === requestPin) section.append(el('p', 'text-gap', '这份来源暂时无法读取；保留当前正文。')); }
    }
  }
  function close() {
    if (!dialog.open) return;
    remember(); const s = window.getSelection(); selectionBeforeClose = s?.rangeCount && !s.isCollapsed ? s.getRangeAt(0).cloneRange() : null;
    clearSource(); dialog.close(); changed();
    const target = opener?.isConnected ? opener : list.querySelector('summary'); target?.focus();
  }
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', (event) => { event.stopPropagation(); });
  dialog.addEventListener('keyup', (event) => event.stopPropagation());
  dialog.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
  dialog.addEventListener('touchmove', (event) => event.stopPropagation(), { passive: true });
  function open(entryId, { part = 'text' } = {}) {
    if (!current || !find(current, entryId)) return false;
    opener = document.activeElement;
    const entry = find(current, entryId);
    if (!pinned || entryKey(pinned.model.scope, pinned.entry) !== entryKey(current.scope, entry)) { remember(); selectionBeforeClose = null; pinned = {model: current, entry}; showPinned(); }
    if (!dialog.open) dialog.showModal();
    heading.focus(); changed();
    if (selectionBeforeClose) { try { const s = window.getSelection(); s.removeAllRanges(); s.addRange(selectionBeforeClose); } catch {} selectionBeforeClose = null; }
    if (part === 'source') readSource(); return true;
  }
  function update(model) {
    current = model; versions.set(versionKey(model), model);
    const activeKeys = new Set();
    for (const entry of model.entries) {
      const key = entryKey(model.scope, entry); activeKeys.add(key); let card = cards.get(key);
      if (!card) {
        const details = el('details', 'text-entry'); details.dataset.entryId = entry.id;
        const summary = el('summary'); const title = el('span', 'text-entry-title', entry.title); const short = el('span', 'text-entry-short', entry.short); summary.append(title, short);
        const inside = el('div', 'text-entry-inside'); const p = el('p', 'text-summary', entry.summary);
        const controls = el('nav', 'text-entry-actions'); controls.setAttribute('aria-label', `${entry.title}阅读操作`);
        controls.append(button('细读这页', () => open(entry.id)), button('追看出处', () => open(entry.id, { part: 'source' })));
        inside.append(p, controls); details.append(summary, inside); list.append(details); details.open = preferences.get(key) ?? false;
        card = { details, title, short, p, entry, scope: model.scope }; cards.set(key, card);
        details.addEventListener('toggle', () => preferences.set(key, details.open));
        details.addEventListener('focusout', () => { queueMicrotask(() => { if (!isBusy(details) && card.pending) patchCard(card, card.pending); }); });
      } else if (fingerprint(card.entry) !== fingerprint(entry)) {
        if (isBusy(card.details)) card.pending = entry; else patchCard(card, entry);
      }
      card.details.hidden = false;
    }
    for (const [key, card] of cards) if (!activeKeys.has(key)) { if (isBusy(card.details)) card.details.dataset.previous = 'true'; else card.details.hidden = true; }
    refreshNotice();
  }
  function patchCard(card, entry) { card.title.textContent = entry.title; card.short.textContent = entry.short; card.p.textContent = entry.summary; card.entry = entry; card.pending = null; }
  function exportReadingState() {
    remember(); return { v: 1, quiet, preferences: [...preferences], anchors: [...anchors],
      pinned: pinned ? { scope: pinned.model.scope, revision: pinned.model.revision, entryId: pinned.entry.id, subjectId: pinned.entry.subjectId } : null,
      open: dialog.open };
  }
  function restoreReadingState(state) {
    if (!state || state.v !== 1) return;
    quiet = !!state.quiet; for (const [k, v] of state.preferences || []) preferences.set(k, !!v);
    for (const [k, v] of state.anchors || []) anchors.set(k, v);
    for (const [k, card] of cards) card.details.open = preferences.get(k) ?? false;
    if (!state.pinned) return;
    const p = state.pinned; const m = versions.get(JSON.stringify([p.scope, p.revision]));
    if (m && find(m, p.entryId)) pinned = {model:m,entry:find(m,p.entryId)};
    else pinned = {model:{scope:p.scope,revision:p.revision,capturedAt:'旧留存已不可用'},entry:{id:p.entryId,subjectId:p.subjectId,title:'旧页未留存',availability:'missing',blocks:[],refs:[]}};
    showPinned(); if (state.open && !dialog.open) { opener = document.activeElement; dialog.showModal(); heading.focus(); changed(); }
  }
  return { update, open, close, exportReadingState, restoreReadingState,
    setNotifications(enabled) { quiet = !enabled; live.textContent = ''; },
    destroy() { close(); destroyed = true; controller?.abort(); list.remove(); live.remove(); dialog.remove(); cards.clear(); versions.clear(); },
  };
}

/** 可选台词表现。全文给辅助技术一次读取；显示整句不调用继续。 */
export function createDialogue({ root, speaker, text, onContinue = () => {}, animate = false }) {
  root.classList.add('text-dialogue'); root.lang = 'zh-CN';
  const who = el('p', 'text-speaker', speaker); const line = el('p', 'text-dialogue-line');
  const accessible = el('span', 'text-sr-only', text); const visible = el('span'); visible.setAttribute('aria-hidden', 'true'); line.append(accessible, visible);
  const actions = el('div', 'text-entry-actions'); let timer, index = 0;
  const graphemes = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('zh-CN', {granularity:'grapheme'}).segment(text)].map((s) => s.segment) : Array.from(text);
  function finish() { clearTimeout(timer); index = graphemes.length; visible.textContent = text; show.hidden = true; next.disabled = false; }
  const show = button('显示整句', finish); const next = button('继续', () => { finish(); onContinue(); }); actions.append(show, next); root.append(who, line, actions);
  function type() { visible.textContent += graphemes[index++]; if (index < graphemes.length) timer = setTimeout(type, /[，。！？；……]/.test(graphemes[index - 1]) ? 100 : 24); else finish(); }
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const motionChange = () => { if (motion.matches) finish(); }; motion.addEventListener('change', motionChange);
  if (animate && !motion.matches) { next.disabled = true; type(); } else finish();
  return { finish, destroy() { clearTimeout(timer); motion.removeEventListener('change', motionChange); root.replaceChildren(); } };
}
