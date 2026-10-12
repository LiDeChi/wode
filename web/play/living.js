// 生活装置只读已经落账的状态；铜槽固定在打开时的感知，不随下一拍偷换。
import { bodyOf } from './body.js';
const LAYERS = { unit: '手上的小槽', module: '习惯的合槽', mind: '心里的深池' };
const SIGNAL = { '很快通过': '很快动手', '停下来看心思': '先看他的心思', '追问为什么': '追问缘由' };
const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; };

function source(el, value, dev) {
  el.__source = value;
  if (!dev) return;
  // 同一件装置每拍都会重放证据；就地改写，不叠成一摞。数字只在这一层出现。
  const pre = el.querySelector(':scope > pre.source-read') ?? el.append(node('pre', 'source-read', '')) ?? el.lastElementChild;
  pre.textContent = JSON.stringify(value, null, 2);
}

export function createLivingUI({ dev, ui, onPause, onToggle, onResume }) {
  const controls = node('div', 'life-controls');
  const toggle = node('button', 'life-switch', '让人物生活'); toggle.type = 'button'; toggle.id = 'living-toggle';
  toggle.setAttribute('aria-pressed', 'true'); toggle.onclick = onToggle;
  const pause = node('button', 'life-switch', '暂停'); pause.type = 'button'; pause.id = 'life-pause'; pause.onclick = onPause; pause.hidden = true;
  controls.append(toggle, pause); document.body.append(controls);
  const resume = node('button', 'enter', '继续这个世界'); resume.type = 'button'; resume.id = 'life-resume'; resume.onclick = onResume;
  document.querySelector('.title-inner').append(resume); resume.hidden = !localStorage.getItem('dw.world') && !localStorage.getItem('dw.livingWorld');
  const desk = node('details', 'director-desk'); desk.id = 'director-desk'; desk.hidden = true;
  const lid = node('summary', '', '导演案'); const board = node('div', 'director-board'); desk.append(lid, board); document.body.append(desk);
  const witness = node('div', 'life-witness'); witness.id = 'life-witness'; witness.setAttribute('aria-live', 'polite'); document.body.append(witness);
  let pinned = null;
  let focusBack = null;
  let lastWitness = '';

  function traces(data, label, rec) {
    const tray = node('section', 'copper-tray'); tray.append(node('h3', '', label));
    const rows = Array.isArray(data?.trace) ? data.trace : [];
    const channel = node('div', 'copper-channel');
    for (const [layer, name] of Object.entries(LAYERS)) {
      const entries = rows.filter(x => x?.layer === layer);
      // took 是各单元吸收量；left 只取该层最后一槽，不能把累计余流相加。
      const took = entries.reduce((sum, x) => sum + Number(x.took || 0), 0);
      const left = Number(entries.at(-1)?.left || 0);
      const basin = node('div', `copper-basin ${layer} ${data?.stoppedAt === layer ? 'stopped' : ''}`);
      basin.style.setProperty('--water', `${Math.min(90, Math.max(0, took * 55))}%`);
      basin.append(node('span', 'basin-label', name), node('i', 'basin-water'));
      basin.append(node('small', '', !entries.length ? '没有留存' : took > 0 ? left > 0 ? '留下一股，还往下流' : '在这里接住' : '水从这里经过'));
      channel.append(basin);
    }
    tray.append(channel);
    const act = typeof data?.action === 'object' ? data.action.act : data?.action;
    tray.append(node('p', 'action-gate', act ? `动作闸：${act}` : '动作闸尚未留下记录'));
    const actionLayer = data?.actionLayer ?? (typeof data?.action === 'object' ? data.action.layer : null);
    tray.append(node('p', 'source-note', actionLayer ? `水停在${LAYERS[data.stoppedAt] ?? '未知处'}；动作来自${LAYERS[actionLayer] ?? '未知处'}。` : '水的停处与动作的来处分别记录；缺少动作来处时不替它补。'));
    source(tray, rec, dev); return tray;
  }

  function memories(actor, entries) {
    const strip = node('section', 'memory-clasps'); strip.append(node('h3', '', '随身经历扣片'));
    const memory = actor?.memory ?? [];
    for (const m of memory) {
      const buckle = node('div', 'memory-buckle');
      const depth = Math.max(0, Number(m.consolidation || 0));
      buckle.style.setProperty('--depth', `${1 + depth * 2}px`);
      buckle.style.opacity = String(.5 + Math.min(1, Number(m.activation || 0) / 2) * .5);
      const cuts = node('span', 'memory-cuts'); cuts.setAttribute('aria-label', Number(m.trace) > 1 ? '同类经历又留了一道刻痕' : '初次经历的刻痕');
      for (let i = 0; i < Math.min(12, Number(m.trace || 0)); i++) cuts.append(node('i', ''));
      buckle.append(cuts, node('span', '', Number(m.trace) > 1 ? '这件事，他又经历过了' : '这件事，他经历过'));
      const refs = entries.filter(e => e.signature === m.signature && e.person === actor.id);
      source(buckle, { path: m.path, signature: m.signature, trace: m.trace, consolidation: m.consolidation, activation: m.activation, seq: m.seq, experiences: refs }, dev);
      strip.append(buckle);
    }
    for (const exp of entries.filter(e => e.person === actor?.id)) {
      const b = node('div', 'memory-buckle indexed'); b.style.setProperty('--depth', `${1 + Number(exp.depth ?? 0) * 2}px`);
      b.append(node('span', 'memory-cuts', '│'.repeat(Math.min(8, 1 + Number(exp.depth ?? 0)))));
      b.append(node('span', '', Number(exp.depth) > 0 ? '几次经历合成了更深的扣片' : '这次动静留在身上'));
      source(b, exp, dev); strip.append(b);
    }
    for (const installed of actor?.installed ?? []) { const b = node('p', 'installed-clasp', '装上的新办法'); source(b, installed, dev); strip.append(b); }
    if (!memory.length) strip.append(node('p', '', '尚未留下可读的经历。'));
    return strip;
  }

  return {
    controls, desk,
    enabled(on) { toggle.setAttribute('aria-pressed', String(on)); toggle.textContent = on ? '人物生活：开' : '人物生活：关'; },
    paused(on, active) { pause.hidden = !active; pause.textContent = on ? '继续生活' : '暂停'; pause.setAttribute('aria-pressed', String(on)); document.body.classList.toggle('life-paused', on); },
    read(read, view, session) {
      desk.hidden = !read; if (!read) { witness.textContent = ''; return; }
      const p = read.policy;
      board.replaceChildren();
      const sand = node('div', `pace-hourglass ${p?.waitForPlayer ? 'tied' : 'loose'}`); sand.append(node('i', ''));
      const decision = node('p', 'director-decision', !p ? '还没有这一拍的安排。' : p.waitForPlayer ? '这一拍，他等你' : `这一拍他不等：${p.cadenceTicks ?? '—'} 拍一次世界动静`);
      decision.title = p?.waitForPlayer ? '栓住的沙漏：导演把这一拍留给你' : '松开的漏斗：世界自己往前走';
      const why = node('p', 'director-why', p?.why?.replace(/ruji/g, '如姬').replace(/guard_a/g, '守卫甲').replace(/guard_b/g, '守卫乙') ?? '尚未留下原因。');
      // 拍次与账本号是给 ?dev=1 看的数字；案上给人看的只有「等不等、为了什么」。
      const decided = node('p', 'director-seq', p?.decidedAt != null ? '这条安排已经落账。' : '这条安排还没有落账。');
      source(decided, { path: 'director.policy', decidedAt: p?.decidedAt ?? null, sourceSeq: p?.sourceSeq ?? null, version: p?.version ?? null }, dev);
      source(decision, p, dev); board.append(sand, decision, why, decided);
      const expect = node('div', 'prediction-slip', view.prediction ? `预测牌：${SIGNAL[view.prediction.expect] ?? view.prediction.expect}` : '这一幕尚无预测牌');
      source(expect, { path: `session.state.predictions.${read.work}`, prediction: view.prediction }, dev); board.append(expect);
      const reactions = session.ledger.entries.filter(e => e.kind === 'user.react' && e.payload.beat === read.beat && e.seq >= (session.state.episode?.from ?? 0));
      for (const rx of reactions.slice(-2)) { const s = node('p', 'reaction-stick', `真实木签：${SIGNAL[rx.payload.signal] ?? rx.payload.signal}`); source(s, rx, dev); board.append(s); }
      const learns = session.ledger.entries.filter(e => e.kind === 'director.learn' && e.from === `director:${session.state.directorId}`);
      for (const e of learns.slice(-2)) { const s = node('p', 'director-annotation', e.payload.errors?.some(x => x.error) ? '他猜错过，手稿留着一笔批注。' : '这次对照已有落笔。'); source(s, e, dev); board.append(s); }
      const bodies = read.actors.filter(a => a.id !== 'player').slice(0, 3).map(a => bodyOf(a, session.ledger.entries, session.state.episode?.from ?? 0));
      const text = bodies.map(a => a.thinking + a.happened).join('。');
      if (text !== lastWitness) {
        // 复用同一批节点：每拍重建会把展开的细节和读屏焦点一起抖掉
        if (witness.children.length !== bodies.length) witness.replaceChildren(...bodies.map(() => { const s = node('details', 'body-slip'); s.append(node('summary', '', ''), node('p', '', '')); return s; }));
        bodies.forEach((b, i) => {
          const slip = witness.children[i];
          slip.children[0].textContent = b.thinking;
          slip.children[1].textContent = b.happened;
          source(slip, b.source, dev);
        });
        lastWitness = text;
      }
      source(witness, bodies.map(a => a.source), false);
    },
    mind(data, read, real, session) {
      focusBack = document.activeElement;
      ui.showMind({ ...data, preview: null, units: [], trust: null, stress: null });
      ui.el.mindExplain.textContent = real?.reason ?? data.preview?.explain ?? '还没有这一次的真实感知；下面是若此刻问他的设想。';
      ui.el.mindMeters.replaceChildren(); ui.el.mindUnits.replaceChildren();
      const actor = read?.actors.find(a => a.id === data.person);
      pinned = real ? JSON.parse(JSON.stringify(real)) : null;
      if (pinned) ui.el.mindMeters.append(traces(pinned, '刚才发生的 · 留存的水', { ...pinned, entry: session.ledger.get(pinned.seq) }));
      else ui.el.mindMeters.append(node('p', 'source-note', '真实铜槽尚未留存；不能用现在的心思倒算刚才。'));
      if (data.preview) ui.el.mindMeters.append(traces(data.preview, '若此刻问他 · 设想的水', { source: 'preview', path: 'watch().preview', ...data.preview }));
      ui.el.mindUnits.append(memories(actor, read?.experiences ?? []));
      ui.el.mindClose.focus();
    },
    close() { pinned = null; ui.hideMind(); focusBack?.focus?.(); },
    chain(session, read) {
      document.getElementById('history-loom')?.remove();
      const loom = node('details', `history-loom ${read?.policy?.historyReveal ?? 'slow'}`); loom.id = 'history-loom'; loom.append(node('summary', '', '手摇牵线机：心思怎样落到史简'));
      const track = node('div', 'loom-track');
      const entries = session.ledger.entries;
      const descendants = new Set();
      const roots = entries.filter(e => e.kind === 'actor.react' && e.seq >= (session.state.episode?.from ?? 0));
      const root = [...roots].reverse().find(e => entries.some(c => c.cause.includes(e.seq) && ['actor.act', 'claim.add', 'actor.trust'].includes(c.kind)));
      if (root) descendants.add(root.seq);
      const selected = [];
      for (const e of entries) {
        if (descendants.has(e.seq) || e.cause.some(c => descendants.has(c))) {
          descendants.add(e.seq);
          if (['actor.react', 'actor.act', 'actor.trust', 'claim.add', 'claim.overturn', 'claim.overturn-refused', 'work.play', 'present.deliver'].includes(e.kind)) selected.push(e);
        }
      }
      for (const e of selected.slice(0, 9)) {
        const names = { 'actor.react': '铜槽里的心思', 'actor.act': '手上的行动', 'actor.trust': '托付改变', 'claim.add': '写进本作的竹简', 'claim.overturn': '旧绳已松，新简走旁路', 'claim.overturn-refused': '旧绳仍扣着', 'work.play': '作品落到这里', 'present.deliver': '导演收束' };
        const slip = node('button', 'loom-slip', names[e.kind]); slip.type = 'button';
        const detail = node('p', 'loom-detail', e.payload.reason ?? e.payload.action ?? e.payload.explanation ?? e.payload.note ?? '这一环有真实记录。'); detail.hidden = true;
        slip.onclick = () => { detail.hidden = !detail.hidden; };
        const peg = node('div', 'loom-peg'); peg.append(slip, detail); source(peg, e, dev); track.append(peg);
      }
      if (!selected.some(e => ['work.play', 'present.deliver'].includes(e.kind))) track.append(node('p', 'loom-missing', '这一段尚不能还原到结局；只牵存在的因果边。'));
      const end = node('p', 'loom-ending', session.state.play?.coda?.fate ?? session.state.play?.coda?.end ?? '史简尚未收束');
      source(end, { path: 'session.state.play.coda', ending: session.state.play?.ending, coda: session.state.play?.coda }, dev);
      loom.append(track, end); document.querySelector('.ending-inner').append(loom);
      return loom;
    },
  };
}
