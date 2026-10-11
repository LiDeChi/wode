// HUD：所有 DOM 介面都在這裡。遊戲邏輯只呼叫方法，不直接碰 DOM。
// 介面刻意做得像「器物」而不是「選單」——它是你在場上能用的東西。

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    sceneName: $('scene-name'),
    sceneGrant: $('scene-grant'),
    objective: $('objective'),
    prompt: $('prompt'),
    grainFill: $('grain-fill'),
    grainValue: $('grain-value'),
    dawnFill: $('dawn-fill'),
    dawnValue: $('dawn-value'),
    linebar: $('linebar'),
    lineSpeaker: $('line-speaker'),
    lineText: $('line-text'),
    lineSource: $('line-source'),
    device: $('device'),
    deviceTitle: $('device-title'),
    deviceWhy: $('device-why'),
    deviceOptions: $('device-options'),
    mind: $('mind'),
    mindName: $('mind-name'),
    mindBody: $('mind-body'),
    mindClose: $('mind-close'),
    title: $('title'),
    titleStatus: $('title-status'),
    titleStart: $('title-start'),
    coda: $('coda'),
    codaTitle: $('coda-title'),
    codaText: $('coda-text'),
    codaAgain: $('coda-again'),
  };

  const GRANT_LABEL = {
    say: '可以開口',
    watch: '可以看',
    go: '可以走動',
    give: '可以給',
  };

  let onMindClose = null;

  el.mindClose.addEventListener('click', () => {
    hideMind();
    onMindClose?.();
  });

  function setTag(sceneName, grants, source) {
    el.sceneName.textContent = sceneName;
    if (!grants || grants.length === 0) {
      el.sceneGrant.textContent = '此刻不讓你動';
      el.sceneGrant.dataset.level = '0';
    } else {
      el.sceneGrant.textContent = grants.map((g) => GRANT_LABEL[g] || g).join(' · ');
      el.sceneGrant.dataset.level = String(grants.length);
    }
    if (source) el.sceneGrant.title = `導演設計：${source}`;
  }

  function setObjective(text) {
    el.objective.textContent = text || '';
    el.objective.hidden = !text;
  }

  function setMeters(grain, dawn) {
    el.grainFill.style.width = `${Math.max(0, Math.min(1, grain)) * 100}%`;
    el.grainValue.textContent = `${Math.round(grain * 100)}%`;
    el.grainFill.dataset.low = grain < 0.3 ? '1' : '0';
    el.dawnFill.style.width = `${Math.max(0, Math.min(1, dawn)) * 100}%`;
    el.dawnValue.textContent = dawn >= 1 ? '天亮了' : `${Math.round((1 - dawn) * 100)}%`;
  }

  function setPrompt(text) {
    if (!text) {
      el.prompt.hidden = true;
      return;
    }
    el.prompt.hidden = false;
    el.prompt.textContent = text;
  }

  function showLine(speaker, text, source) {
    el.linebar.hidden = false;
    el.lineSpeaker.textContent = speaker || '';
    el.lineSpeaker.hidden = !speaker;
    el.lineText.textContent = text || '';
    if (source) {
      el.lineSource.hidden = false;
      el.lineSource.textContent = source;
    } else {
      el.lineSource.hidden = true;
    }
  }

  function hideLine() {
    el.linebar.hidden = true;
  }

  function openDevice({ title, why, options, resources }) {
    el.device.hidden = false;
    el.deviceTitle.textContent = title || '你要怎麼做？';
    el.deviceWhy.textContent = why || '';
    el.deviceOptions.replaceChildren();
    options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'device-option';
      btn.dataset.kind = opt.kind;
      if (opt.disabled) btn.disabled = true;

      const top = document.createElement('div');
      top.className = 'opt-top';
      const label = document.createElement('span');
      label.className = 'opt-label';
      label.textContent = opt.label;
      top.append(label);

      if (opt.strength !== undefined && resources) {
        const bar = document.createElement('span');
        bar.className = 'opt-strength';
        const inner = document.createElement('span');
        inner.style.width = `${Math.max(0, Math.min(1, opt.strength)) * 100}%`;
        bar.append(inner);
        top.append(bar);
      }
      btn.append(top);

      if (opt.hint) {
        const hint = document.createElement('span');
        hint.className = 'opt-hint';
        hint.textContent = opt.hint;
        btn.append(hint);
      }
      btn.addEventListener('click', () => opt.onPick?.(i));
      el.deviceOptions.append(btn);
    });
  }

  function closeDevice() {
    el.device.hidden = true;
    el.deviceOptions.replaceChildren();
  }

  function showResult(result) {
    // 說話的結果：把引擎算出來的數字誠實畫出來，不修飾。
    el.deviceOptions.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'opt-result';

    const verdict = document.createElement('div');
    verdict.className = 'verdict';
    verdict.dataset.accepted = result.accepted ? '1' : '0';
    verdict.textContent = result.accepted ? '他被打動了' : '他沒動';
    wrap.append(verdict);

    const rows = [
      ['合他的意', result.fit, 1],
      ['激起反感', result.backlash, 1],
      ['淨推力', result.moved, 1],
      ['他給你的信任', result.trustAfter, 1],
    ];
    for (const [label, value, max] of rows) {
      const row = document.createElement('div');
      row.className = 'res-row';
      const l = document.createElement('span');
      l.className = 'res-label';
      l.textContent = label;
      const track = document.createElement('span');
      track.className = 'res-track';
      const fill = document.createElement('span');
      const pct = Math.max(0, Math.min(1, Math.abs(value) / max)) * 100;
      fill.style.width = `${pct}%`;
      fill.dataset.sign = value < 0 ? 'neg' : 'pos';
      track.append(fill);
      const v = document.createElement('span');
      v.className = 'res-value';
      v.textContent = value.toFixed(3);
      row.append(l, track, v);
      wrap.append(row);
    }

    const reason = document.createElement('div');
    reason.className = 'res-reason';
    reason.textContent = result.reason;
    wrap.append(reason);

    const thr = document.createElement('div');
    thr.className = 'res-threshold';
    thr.textContent = `他點頭的門檻：${result.threshold.toFixed(2)}　淨推力 ${result.moved.toFixed(3)}`;
    wrap.append(thr);

    el.deviceOptions.append(wrap);
  }

  function setDeviceTitle(title, why) {
    el.deviceTitle.textContent = title;
    el.deviceWhy.textContent = why || '';
  }

  function showMind(reading) {
    el.mind.hidden = false;
    el.mindName.textContent = `${reading.name}${reading.title ? ` · ${reading.title}` : ''}`;
    el.mindBody.replaceChildren();

    const addRow = (label, valueText, ratio, extraClass = '') => {
      const row = document.createElement('div');
      row.className = `mind-row ${extraClass}`;
      const l = document.createElement('span');
      l.className = 'mind-label';
      l.textContent = label;
      const track = document.createElement('span');
      track.className = 'mind-track';
      const fill = document.createElement('span');
      fill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
      track.append(fill);
      const v = document.createElement('span');
      v.className = 'mind-value';
      v.textContent = valueText;
      row.append(l, track, v);
      el.mindBody.append(row);
    };

    const expr = document.createElement('div');
    expr.className = 'mind-expr';
    expr.style.borderColor = reading.expression.color;
    expr.textContent = `他現在看起來：${reading.expression.label}`;
    el.mindBody.append(expr);

    const sec = (title) => {
      const h = document.createElement('div');
      h.className = 'mind-sec';
      h.textContent = title;
      el.mindBody.append(h);
    };

    sec('他在乎什麼（越高越容易被這套說動）');
    for (const [k, v] of reading.ranked) addRow(k, v.toFixed(2), v);

    sec('什麼話會激起他的反感');
    const resistKeys = Object.keys(reading.resist);
    if (resistKeys.length === 0) {
      const none = document.createElement('div');
      none.className = 'mind-none';
      none.textContent = '沒有特別會激怒他的話';
      el.mindBody.append(none);
    } else {
      for (const k of resistKeys) {
        const parts = Object.entries(reading.resist[k]).map(([emo, coef]) => `${emo} +${coef}`);
        addRow(`講${k}`, parts.join('、'), 0.6, 'neg');
      }
    }

    sec('他現在對你的信任');
    addRow('信任', reading.trust.toFixed(3), reading.trust);
    addRow('壓力', reading.stress.toFixed(3), reading.stress, reading.stress > 0.5 ? 'neg' : '');

    sec('性情');
    for (const [k, v] of Object.entries(reading.temperament)) addRow(k, v.toFixed(2), v);

    sec('他手上的路數');
    for (const u of reading.units) {
      const d = document.createElement('div');
      d.className = 'mind-unit';
      d.textContent = `${u.label}（${u.verb}）　${u.act}`;
      el.mindBody.append(d);
    }

    if (reading.mindAct) {
      const d = document.createElement('div');
      d.className = 'mind-mindact';
      d.textContent = `心裡：${reading.mindAct}`;
      el.mindBody.append(d);
    }

    if (reading.bio) {
      sec('史料的根據');
      const b = document.createElement('div');
      b.className = 'mind-bio';
      b.textContent = reading.bio;
      el.mindBody.append(b);
    }
  }

  function hideMind() {
    el.mind.hidden = true;
  }

  function isMindOpen() {
    return !el.mind.hidden;
  }

  function setTitleStatus(text, ready) {
    el.titleStatus.textContent = text;
    el.titleStart.disabled = !ready;
  }

  function hideTitle() {
    el.title.hidden = true;
  }

  function showCoda(title, text) {
    el.coda.hidden = false;
    el.codaTitle.textContent = title;
    el.codaText.textContent = text;
  }

  function hideCoda() {
    el.coda.hidden = true;
  }

  return {
    el,
    setTag, setObjective, setMeters, setPrompt,
    showLine, hideLine,
    openDevice, closeDevice, showResult, setDeviceTitle,
    showMind, hideMind, isMindOpen,
    setTitleStatus, hideTitle, showCoda, hideCoda,
    onMindClose: (fn) => { onMindClose = fn; },
    onTitleStart: (fn) => el.titleStart.addEventListener('click', fn),
    onCodaAgain: (fn) => el.codaAgain.addEventListener('click', fn),
  };
}
