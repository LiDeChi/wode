// 页面上的一切字：台词条、签、看心思、漏刻、结局。都是 DOM，但只有台词条常驻。
const $ = (id) => document.getElementById(id);

const PUNCT = new Set(['。', '，', '、', '；', '：', '？', '！', '…', '—', '\n']);

export function createUI({ dev = false } = {}) {
  const el = {
    tags: $('tags'),
    sceneTag: $('scene-tag'), sceneName: $('scene-name'), scenePlace: $('scene-place'), sceneGrants: $('scene-grants'),
    days: $('days'), daysFill: $('days-fill'), daysValue: $('days-value'),
    objective: $('objective'), tell: $('tell'),
    linebar: $('linebar'), lineSpeaker: $('line-speaker'), lineText: $('line-text'), advance: $('advance'),
    mind: $('mind'), mindName: $('mind-name'), mindTitle: $('mind-title'), mindClose: $('mind-close'),
    mindExplain: $('mind-explain'), mindMeters: $('mind-meters'), mindUnits: $('mind-units'),
    clepsydra: $('clepsydra'), clepsydraWater: $('clepsydra-water'), clepsydraTile: $('clepsydra-tile'), clepsydraSteps: $('clepsydra-steps'),
    title: $('title'), film: $('film'), filmText: $('film-text'), filmDirector: $('film-director'), enterFilm: $('enter-film'),
    ending: $('ending'), endingBadge: $('ending-badge'), endingLived: $('ending-lived'), endingBook: $('ending-book'),
    endingDays: $('ending-days'), endingSummary: $('ending-summary'), endingActions: $('ending-actions'),
    fatal: $('fatal'), fatalDetail: $('fatal-detail'), restart: $('restart'),
    dev: $('dev'),
  };

  const tagNodes = new Map();
  const gizmoNodes = new Map();
  let typing = null;

  // ── 大字：打字机 ────────────────────────────────────────────
  function typeInto(node, text, speed = 26) {
    let i = 0;
    node.textContent = '';
    return new Promise((resolve) => {
      const step = () => {
        if (!typing || typing.node !== node) return;   // 被打断
        const ch = text[i];
        node.textContent += ch;
        i += 1;
        if (i >= text.length) { typing = null; resolve(); return; }
        const pause = PUNCT.has(ch) ? 190 : speed;
        typing.timer = setTimeout(step, pause);
      };
      typing = { node, full: text, skip: () => { clearTimeout(typing.timer); node.textContent = text; typing = null; resolve(); } };
      step();
    });
  }

  function skipTyping() { if (typing?.skip) typing.skip(); }

  return {
    el,

    show(node, on = true) { if (node) node.hidden = !on; },

    // ── 场名 / 天数 / 目标 / 前兆 ──────────────────────────────
    setScene(view) {
      if (!view) return;
      el.sceneName.textContent = view.title ?? '';
      el.scenePlace.textContent = view.place ?? '';
      const verbs = view.grants?.verbs ?? [];
      const names = { say: '说话', give: '递物', wait: '等', watch: '看心思', ask: '追问', go: '走' };
      el.sceneGrants.textContent = verbs.length ? `本篇授予 ${verbs.map((v) => names[v] ?? v).join(' · ')}` : '';
      el.sceneTag.hidden = false;
    },
    setDays(n, max = 30) {
      if (n === undefined || n === null) { el.days.hidden = true; return; }
      el.days.hidden = false;
      const pct = Math.max(0, Math.min(1, n / max));
      el.daysFill.style.width = `${pct * 100}%`;
      el.daysValue.textContent = `${n} 天`;
    },
    objective(text) { el.objective.hidden = !text; el.objective.textContent = text ?? ''; },
    hint(text) {
      el.objective.textContent = text ?? '';
      el.objective.classList.add('hinting');
      clearTimeout(this._hintT);
      this._hintT = setTimeout(() => el.objective.classList.remove('hinting'), 2600);
    },
    tell(text) {
      if (!text) { el.tell.hidden = true; return; }
      el.tell.textContent = text;
      el.tell.hidden = false;
      clearTimeout(this._tellT);
      this._tellT = setTimeout(() => { el.tell.hidden = true; }, 4200);
    },

    // ── 台词条 ────────────────────────────────────────────────
    async say(name, text) {
      el.linebar.hidden = false;
      el.lineSpeaker.textContent = name ?? '';
      el.advance.hidden = true;
      await typeInto(el.lineText, text ?? '');
      el.advance.hidden = false;
    },
    async advance() {
      if (typing) { skipTyping(); }
      // 等玩家点的时候，那颗「继续」必须亮着——它就是给玩家看的
      el.advance.hidden = false;
      return new Promise((resolve) => {
        const go = () => {
          el.advance.removeEventListener('click', go);
          document.removeEventListener('keydown', key);
          el.linebar.removeEventListener('click', go);
          el.advance.hidden = true;
          resolve();
        };
        const key = (e) => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); go(); }
        };
        el.advance.addEventListener('click', go);
        el.linebar.addEventListener('click', (e) => { if (!typing) go(); });
        document.addEventListener('keydown', key);
      });
    },
    hideLine() { el.linebar.hidden = true; },

    // ── 场景里的签 ────────────────────────────────────────────
    setTags(entries) {
      const seen = new Set();
      const stack = new Map();
      for (const e of entries) {
        const id = e.key + '|' + (e.intent ?? '');
        seen.add(id);
        // 同一个人身上可能挂着好几张诉求签：给每张排个号，别叠在同一个像素上
        const n = stack.get(e.key) ?? 0;
        stack.set(e.key, n + 1);
        let node = tagNodes.get(id);
        if (!node) {
          node = document.createElement('button');
          node.type = 'button';
          node.addEventListener('click', () => { node.__entry?.onClick?.(); });
          node.addEventListener('mouseenter', () => { if (node.__entry?.hint) this.hint(node.__entry.hint); });
          el.tags.appendChild(node);
          tagNodes.set(id, node);
        }
        node.__entry = e;
        node.dataset.stack = String(n);
        node.className = 'tag ' + (e.kind === 'person' ? 'tag-person' : e.kind === 'flavor' ? 'tag-flavor' : '');
        node.textContent = e.label;
        node.dataset.key = e.key;
        node.dataset.intent = e.intent ?? '';
        node.dataset.disabled = e.disabled ? '1' : '';
        node.title = e.hint ?? '';
      }
      for (const [k, node] of tagNodes) {
        if (!seen.has(k)) { node.remove(); tagNodes.delete(k); }
      }
    },
    /**
     * 每帧把签放到场景对应位置（浏览器坐标）。getScreen(key) → {x,y,visible}
     * 规矩：人名签贴头顶，机关（看/问）挪到人的侧下方，谁也不许压住谁的字。
     */
    syncTags(getScreen) {
      const placed = [];
      for (const node of [...tagNodes.values(), ...gizmoNodes.values()]) {
        const p = getScreen(node.dataset.key);
        if (!p || !p.visible) { node.style.visibility = 'hidden'; continue; }
        const n = Number(node.dataset.stack ?? 0);
        const dx = Number(node.dataset.dx ?? 0);
        const dy = Number(node.dataset.dy ?? 0);
        let x = p.x + dx + (n > 0 ? (n % 2 ? 15 : -15) : 0);
        let y = p.y + dy - n * 34;
        node.style.visibility = 'visible';
        node.style.zIndex = String(1000 - Math.round(p.depth ?? 0) + n);

        // 同一屏上好几张签：重叠就往上抬，抬到顶了再往下让
        const w = node.offsetWidth || 84;
        const h = node.offsetHeight || 30;
        const box = () => ({ l: x - w / 2, r: x + w / 2, t: y - h, b: y });
        let up = true;
        for (let guard = 0; guard < 24; guard += 1) {
          const cur = box();
          const hit = placed.find((q) => cur.l < q.r - 2 && cur.r > q.l + 2 && cur.t < q.b - 2 && cur.b > q.t + 2);
          if (!hit) break;
          if (up && y - h - 8 < 6) up = false;      // 上方没地方了，改往下让
          y = up ? y - h - 8 : hit.b + h + 8;
        }
        placed.push(box());
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
      }
    },
    clearTags() {
      for (const n of tagNodes.values()) n.remove();
      tagNodes.clear();
      this.clearGizmos();
    },

    // ── 人物身旁的两个小机关：看心思 / 追问 ───────────────────
    setGizmos(entries) {
      const seen = new Set();
      for (const e of entries) {
        seen.add(e.key);
        let node = gizmoNodes.get(e.key);
        if (!node) {
          node = document.createElement('div');
          node.className = 'gizmos';
          el.tags.appendChild(node);
          gizmoNodes.set(e.key, node);
        }
        node.dataset.key = e.key;
        // 机关挂在人的侧下方：不挡头顶那块写名字的木牌
        node.dataset.dx = String(e.dx ?? 52);
        node.dataset.dy = String(e.dy ?? 30);
        node.innerHTML = '';
        for (const action of e.actions ?? []) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'gizmo';
          b.dataset.role = action.role ?? '';
          b.textContent = action.label;
          b.title = action.title ?? '';
          b.addEventListener('click', (ev) => { ev.stopPropagation(); action.onClick?.(); });
          node.appendChild(b);
        }
      }
      for (const [k, node] of gizmoNodes) {
        if (!seen.has(k)) { node.remove(); gizmoNodes.delete(k); }
      }
    },
    clearGizmos() {
      for (const n of gizmoNodes.values()) n.remove();
      gizmoNodes.clear();
    },

    // ── 看心思 ────────────────────────────────────────────────
    showMind(data) {
      el.mind.hidden = false;
      el.mindName.textContent = data.name ?? '';
      el.mindTitle.textContent = data.title ?? '';
      const preview = data.preview;
      const bits = [];
      if (preview?.trace?.length) bits.push(preview.trace.join(' → '));
      if (preview?.explain) bits.push(preview.explain);
      if (preview?.stoppedAt) bits.push(`心思停在「${preview.stoppedAt}」`);
      if (preview?.action) bits.push(`看起来要：${preview.action}`);
      el.mindExplain.textContent = bits.length ? bits.join('\n') : (data.wants ? `他此刻想要的是：${data.wants}` : '看不出他此刻在想什么。');
      el.mindMeters.innerHTML = '';
      for (const [label, value] of [['信', data.trust], ['紧', data.stress]]) {
        if (value === undefined || value === null) continue;
        const row = document.createElement('div');
        row.className = 'mind-meter';
        row.innerHTML = `<span class="mind-meter-name">${label}</span>`
          + `<span class="mind-meter-track"><span class="mind-meter-fill" style="width:${Math.round(Math.max(0, Math.min(1, value)) * 100)}%"></span></span>`
          + `<span class="mind-meter-value">${Math.round(value * 100)}</span>`;
        el.mindMeters.appendChild(row);
      }
      el.mindUnits.innerHTML = '';
      const units = data.units ?? [];
      if (!units.length) {
        const p = document.createElement('div');
        p.className = 'mind-empty';
        p.textContent = '他还没动。你现在看，只能看到没动过的样子。';
        el.mindUnits.appendChild(p);
      } else {
        for (const u of units.slice(-6)) {
          const row = document.createElement('div');
          row.className = 'mind-unit';
          row.innerHTML = `<span class="mind-unit-label">${u.label}</span>`
            + `<span class="mind-unit-act">${u.act ?? ''}</span>`
            + `<span class="mind-unit-cap">${u.cap ?? ''}</span>`;
          el.mindUnits.appendChild(row);
        }
      }
    },
    hideMind() { el.mind.hidden = true; },
    bindMindClose(fn) { el.mindClose.addEventListener('click', fn); },

    // ── 漏刻 ─────────────────────────────────────────────────
    showClepsydra(night) {
      if (!night) { el.clepsydra.hidden = true; return; }
      el.clepsydra.hidden = false;
      const limit = night.limit ?? 12;
      const step = night.step ?? 0;
      const left = Math.max(0, limit - step);
      el.clepsydraWater.style.height = `${Math.round((left / limit) * 100)}%`;
      el.clepsydraTile.textContent = night.tiles?.[night.pos] ?? '';
      el.clepsydraSteps.textContent = `水还剩 ${left} 滴 · 已走 ${step} 步`;
      el.clepsydraWater.style.background = left / limit < 0.25
        ? 'linear-gradient(180deg,#8a3a2f,#4a1f18)'
        : 'linear-gradient(180deg,#6f9cc4,#2f4f70)';
    },
    hideClepsydra() { el.clepsydra.hidden = true; },

    // ── 结局 ─────────────────────────────────────────────────
    showCoda(coda, { onGranary, onClose } = {}) {
      el.ending.hidden = false;
      el.endingBadge.textContent = coda.end ?? coda.ending ?? '';
      el.endingLived.textContent = coda.lived ?? '';
      el.endingBook.textContent = coda.book ?? '';
      el.endingDays.textContent = coda.days !== undefined ? `这件事，用了 ${coda.days} 天。` : '';
      el.endingSummary.hidden = true;
      el.endingActions.innerHTML = '';
      const b1 = document.createElement('button');
      b1.type = 'button';
      b1.className = 'enter';
      b1.textContent = '再去粮仓';
      b1.addEventListener('click', () => onGranary?.());
      const b2 = document.createElement('button');
      b2.type = 'button';
      b2.className = 'enter';
      b2.textContent = '就此收束';
      b2.addEventListener('click', () => onClose?.());
      el.endingActions.append(b1, b2);
    },
    /**
     * 收束页做成一件案上装置：每一幕一片竹简，依次落到案上；最后一片盖朱红封泥，写「完」。
     * @param {Array<{title?:string,id?:string,outcome?:string}>} acts
     * @param {{onRestart?:Function,onFilm?:Function,ending?:{title?:string,kind?:string}}} opts
     */
    showFinal(acts, { onRestart, onFilm, ending } = {}) {
      el.ending.hidden = false;
      // 案头挂的是这一局的结局名，封泥上的「完」留给最后一片竹简
      el.endingBadge.textContent = ending?.title || '完';
      el.endingLived.textContent = '';
      el.endingBook.textContent = '';
      el.endingDays.textContent = '';
      el.endingSummary.hidden = false;
      el.endingSummary.className = 'ending-desk';
      el.endingSummary.innerHTML = '';

      const list = (acts ?? []).filter(Boolean);
      const slips = document.createElement('div');
      slips.className = 'ending-slips';

      const slipOf = (i, actName, body) => {
        const slip = document.createElement('article');
        slip.className = 'slip';
        slip.style.setProperty('--i', String(i));
        const head = document.createElement('h3');
        head.className = 'slip-act';
        head.textContent = actName;
        const text = document.createElement('p');
        text.className = 'slip-text';
        text.textContent = body;
        slip.append(head, text);
        return slip;
      };

      list.forEach((act, i) => {
        slips.appendChild(slipOf(i, act.title ?? act.id ?? '', act.outcome || '（没有留下结果）'));
      });
      if (!list.length) slips.appendChild(slipOf(0, '这一局', '没有留下可记的幕。'));

      // 最后一片：结局那一片，盖封泥
      const last = slipOf(list.length, '完', ending?.title ? `结局：${ending.title}` : '这一局到此为止。');
      last.classList.add('slip-last');
      if (ending?.kind) {
        const kind = document.createElement('span');
        kind.className = 'slip-kind';
        kind.textContent = ending.kind;
        last.appendChild(kind);
      }
      const seal = document.createElement('span');
      seal.className = 'slip-seal';
      seal.textContent = '完';
      last.appendChild(seal);
      slips.appendChild(last);
      el.endingSummary.appendChild(slips);

      el.endingActions.innerHTML = '';
      if (onFilm) {
        // 「把这一局拍成电影」＝案上一卷可以抽开的卷轴
        const f = document.createElement('button');
        f.type = 'button';
        f.id = 'film-btn';
        f.className = 'device device-scroll';
        f.title = '把这一局存成一份可以重放的电影';
        f.innerHTML = '<span class="scroll-rod"></span><span class="scroll-sheet">把这一局拍成电影</span><span class="scroll-rod"></span>';
        f.addEventListener('click', () => onFilm());
        el.endingActions.appendChild(f);
      }
      // 「再做一次」＝翻过来的沙漏
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'restart-btn';
      b.className = 'device device-hourglass';
      b.title = '翻过沙漏，从头再来一局';
      b.innerHTML = '<span class="hourglass"></span><span class="hourglass-label">再做一次</span>';
      b.addEventListener('click', () => {
        b.classList.add('flipping');
        setTimeout(() => onRestart?.(), 620);
      });
      el.endingActions.appendChild(b);
    },
    hideEnding() { el.ending.hidden = true; },

    fatal(message, detail) {
      el.fatal.hidden = false;
      el.fatal.querySelector('.fatal-line').textContent = message || '这一场出了点岔子。';
      el.fatalDetail.textContent = detail ? String(detail).slice(0, 400) : '';
    },
    bindRestart(fn) { el.restart.addEventListener('click', fn); },

    dev(obj) {
      if (!dev) return;
      el.dev.hidden = false;
      el.dev.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    },
  };
}
