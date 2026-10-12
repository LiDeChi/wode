// 生活台（t48，docs/design/LIVING.md §10 E）：把持续生活那一段搁在推演机旁边，手摇着一拍一拍看。
//
// 这个文件只算账、不画东西，也不碰主世界：每次「上弦」都新建一个**私有的**会话与玩法，
// 试验里长出来的账本、记忆和感知留档都留在这一份里；主世界那本账一行都不动（arm() 会记下来核对）。
//
// 锁住的三样东西（§10 E）：生活脚本、种子、初始经验。每上弦一次只换一样，
// 其余照上一回——牌上会写清楚「只改了哪一样」，好让两回的结果能对着看。
import { createSession } from '/shared/engine/session.js';
import { createPlay, SCENES } from '/shared/engine/play.js';
import { createMind } from '/shared/core/mind.js';
import { ANSWERS, NEED } from '/shared/engine/simulate.js';

/** 生活脚本：写死的拍与输入。空等就是不投任何东西，让这一段自己走。 */
export const SCRIPTS = [
  { id: 'wait', name: '空等', note: '谁也不碰，看这一段自己走', inputs: [] },
  { id: 'ask', name: '问一句', note: '第 4 拍问如姬一句', inputs: [{ tick: 4, op: 'ask', args: { id: 'ruji' } }] },
  { id: 'watch', name: '走近看', note: '第 6 拍盯住守卫甲', inputs: [{ tick: 6, op: 'watch', args: { id: 'guard_a' } }] },
];
/** 种子：牌面上刻记号，真实数字只在 ?dev=1 露。 */
export const SEEDS = [
  { id: 1, mark: '甲' }, { id: 2, mark: '乙' }, { id: 3, mark: '丙' },
  { id: 4, mark: '丁' }, { id: 5, mark: '戊' }, { id: 6, mark: '己' },
];
export const DIRECTORS = [
  { id: 'lu', name: '陆导', short: '陆' },
  { id: 'shan', name: '单导', short: '单' },
];
export const CARRIES = [
  { id: 'fresh', name: '空手进场', note: '记忆装置里什么都没有' },
  { id: 'carry', name: '带着上一段', note: '把上一回摇出来的经历装回去' },
];
export const TRUSTS = [
  { id: .3, name: '低', note: '如姬心里没底' },
  { id: .6, name: '高', note: '如姬答应得实' },
];
export const SPAN = 32;               // 这一段最长多少拍（取符之夜的天亮）
const NIGHT = 'night';
const NIGHT_PEOPLE = ['ruji', 'guard_a', 'guard_b'];

const PERSON = { ruji: '如姬', guard_a: '守卫甲', guard_b: '守卫乙' };
const at = (list, id) => list.find((x) => x.id === id) || list[0];

/** 从记忆条目里挑出这一段的痕迹，换成一句人话（牌子用）。 */
function markLine(e) {
  const who = PERSON[e.actorId] || e.actorId || '有人';
  const what = (e.keywords || []).filter((k) => !['module', 'unit', 'mind', 'night'].includes(k)).slice(0, 2).join('·') || e.sig;
  return { who, text: `${who}记着「${what}」`, bright: e.activation ?? 0, depth: e.depth ?? 0, seq: e.seq ?? null };
}

export function createLifeRun({ settings = {}, main = null } = {}) {
  let locks = { script: 'wait', seed: 3, director: 'lu', carry: 'fresh', rujiTrust: settings.rujiTrust ?? .3 };
  let world = null;        // 这一段：session / play / 已经长出来的行
  let carried = null;      // 上一回留下的记忆装置（初始经验）
  let prev = null;         // 上一回的结果，给「对着看」用
  let armed = false;

  function build() {
    const scene = at(SCRIPTS, locks.script);
    const session = createSession();
    for (const [id, mind] of Object.entries(session.minds)) {
      const def = structuredClone(mind.def);
      // 「初始设定」只有如姬取符前的托付这一路是这台机子原来就有的旋钮，别的照旧
      if (id === 'ruji') def.trust = { ...def.trust, 'actor:player': locks.rujiTrust };
      session.minds[id] = createMind(def);
    }
    const scenes = structuredClone(SCENES);
    for (const rule of scenes.yimen.rules) for (const effect of rule.then || []) {
      if ((effect[0] === 'trust' && effect[1] === 'ruji') || (effect[0] === 'flag' && effect[1] === 'rujiTrust'))
        effect[2] = Math.min(1, Math.max(0, +(locks.rujiTrust + effect[2] - .3).toFixed(3)));
    }
    session.meet(ANSWERS[locks.director === 'shan' ? 'B' : 'A'], NEED);
    const play = createPlay(session, { scenes, living: 'director', seed: locks.seed });
    if (locks.carry === 'carry' && carried?.store) play.life.memory().restore(carried.store);
    // 走到取符之夜：前面的幕按同一个脚本选（这是「生活脚本」的一部分，不随机）
    play.begin();
    let v = play.next();
    let guard = 0;
    while (v.act !== NIGHT && guard++ < 200) {
      if (v.stage !== 'act' || v.done) { v = play.next(); continue; }
      const opts = (v.options || []).filter((o) => o.allowed !== false);
      if (!opts.length) { v = play.next(); continue; }
      v = play.choose((opts.find((o) => o.id === 'yi') || opts[0]).id).view;
    }
    world = {
      session, play, script: scene, enteredAt: null,
      pulses: [], notices: [], acts: [], slip: [], broken: 0, seen: new Set(),
      startLedger: session.ledger.entries.length,
      mainBefore: main?.entries?.length ?? null,
    };
    armed = true;
    return world;
  }

  /** 上弦：锁里换了哪一样就重来一段（换一样就重来，这是「每次只换一个变量」的做法）。 */
  function arm(patch = {}) {
    const before = { ...locks };
    if (world) carried = world.play.life.save();
    const changed = [];
    for (const k of Object.keys(patch)) {
      if (patch[k] === undefined || patch[k] === locks[k]) continue;
      locks = { ...locks, [k]: patch[k] };
      changed.push(k);
    }
    if (world) {
      prev = {
        verdict: verdictOf().key, text: verdictOf().text,
        locks: { ...before },
        changed,
        counts: countsOf(),
        policy: world.policy || null,
      };
    }
    build();
    const scene = at(SCRIPTS, locks.script);
    world.script = scene;
    world.pending = scene.inputs.slice();
    world.arm = { changed, before };
    return read();
  }

  function fire(tick) {
    const due = (world.pending || []).filter((x) => x.tick <= tick);
    world.pending = (world.pending || []).filter((x) => x.tick > tick);
    return due.map(({ tick: t, ...rest }) => ({ ...rest, id: `${rest.op}:${t}`, tick }));
  }

  /** 摇一拍。返回这一拍的链（哪一环真的动了）。 */
  function crank(n = 1) {
    if (!armed) arm();
    const link = { tick: null, slot: [], pulse: null, eyes: [], posts: [], hand: null, ledger: null };
    for (let i = 0; i < n; i++) {
      const from = world.play.life.tick();
      if (from >= SPAN || world.play.life.state().ended) break;
      const ins = fire(from + 1);
      const r = world.play.advance({ toTick: from + 1, inputs: ins });
      link.tick = r.to;
      link.slot = ins.map((x) => `${x.op === 'ask' ? '问一句' : x.op === 'watch' ? '走近看' : x.op}${x.args?.id ? '（' + (PERSON[x.args.id] || x.args.id) + '）' : ''}`);
      for (const o of r.outcomes) {
        if (o.kind === 'environment') {
          link.pulse = { text: o.text, seq: o.seq ?? null };
          world.pulses.push(link.pulse);
        } else if (o.kind === 'actor.act') {
          link.hand = { person: o.person, text: o.text || o.choice || '自己动了', seq: o.seq ?? null };
          world.acts.push(link.hand);
        } else if (o.text || o.choice) {
          link.ledger = { text: o.text || o.choice, seq: o.seq ?? null };
        }
      }
      for (const r2 of r.reactions) {
        const tr = world.play.lifeTrace(r2.seq);
        const rec = { person: r2.person, seq: r2.seq, ok: !!tr, text: tr?.object ?? null, layer: tr?.layer ?? null };
        link.eyes.push(rec);
        world.notices.push(rec);
        if (!tr) world.broken += 1;
        else if (!world.seen.has(r2.seq)) {
          world.seen.add(r2.seq);
          world.slip.push({ who: PERSON[r2.person] || r2.person, text: tr.object || '有了动静', seq: r2.seq, at: r.to, layer: tr.layer });
        }
      }
      world.last = r;
      if (r.ended) { world.end = r.end; break; }
    }
    world.chain = link;
    world.policy = world.play.lifeRead(NIGHT)?.policy || world.policy;
    return link;
  }

  // 还没上弦就直接摇到天亮：先按现在锁着的条件上一回弦，再一拍一拍摇过去。
  const toEnd = () => { if (!world) arm(); while (!world.play.life.state().ended && world.play.life.tick() < SPAN) crank(1); return read(); };

  function countsOf() {
    if (!world) return { notices: 0, acts: 0, slip: 0, broken: 0, pulses: 0 };
    return { notices: world.notices.length, acts: world.acts.length, slip: world.slip.length, broken: world.broken, pulses: world.pulses.length };
  }

  /** 机会是被抓住还是溜走：看这一段里有没有人真的动身（有 actor.act 才算）。 */
  function verdictOf() {
    if (!world) return { key: 'idle', text: '还没上弦', why: '' };
    const done = !!world.end;
    if (!done) return { key: 'running', text: '这一段还没走完', why: `还有 ${Math.max(0, SPAN - world.play.life.tick())} 拍到天亮` };
    if (world.acts.length) return { key: 'seized', text: '机会被抓住了', why: `${PERSON[world.acts[0].person] || world.acts[0].person} 自己动了手：${world.acts[0].text}` };
    return { key: 'lost', text: '机会溜走了', why: '到天亮都没有人真的动手——心里的事在走，手上没动。' };
  }

  function read() {
    if (!world) {
      const scene = at(SCRIPTS, locks.script);
      return {
        armed: false, running: false, done: false, tick: 0, span: SPAN,
        locks: { script: scene.name, scriptNote: scene.note, seed: at(SEEDS, locks.seed).mark, director: at(DIRECTORS, locks.director).name, carry: at(CARRIES, locks.carry).name, trust: locks.rujiTrust, trustName: at(TRUSTS, locks.rujiTrust).name },
        counts: { notices: 0, acts: 0, slip: 0, broken: 0, pulses: 0 },
        chain: null, slip: [], verdict: verdictOf(), prev, policy: null, actors: [], marks: [],
        isolation: { mainBefore: main?.entries?.length ?? null, mainNow: main?.entries?.length ?? null },
      };
    }
    const view = world.play.lifeRead(NIGHT);
    const actors = (view?.actors || []).map((a) => ({
      id: a.id, name: PERSON[a.id] || a.name || a.id,
      plate: a.last ? `${a.last.object}（停在${a.last.layer === 'mind' ? '心智' : a.last.layer === 'module' ? '老习惯' : '动作'}层）` : '还没有动静',
      seq: a.last?.seq ?? null, trust: a.trust,
    }));
    const memories = world.play.life.memory().all ? world.play.life.memory().all() : [];
    const marks = memories.filter((e) => e.sceneId === NIGHT || NIGHT_PEOPLE.includes(e.actorId))
      .sort((a, b) => (b.activation ?? 0) - (a.activation ?? 0) || (b.consolidation ?? 0) - (a.consolidation ?? 0)).slice(0, 6).map(markLine);
    const scene = at(SCRIPTS, locks.script);
    const counts = countsOf();
    return {
      armed, running: armed && !world.end, done: !!world.end, tick: world.play.life.tick(), span: SPAN,
      locks: { script: scene.name, scriptNote: scene.note, seed: at(SEEDS, locks.seed).mark, director: at(DIRECTORS, locks.director).name, carry: at(CARRIES, locks.carry).name, trust: locks.rujiTrust, trustName: at(TRUSTS, locks.rujiTrust).name },
      changed: world.arm?.changed ?? [], changedText: (world.arm?.changed ?? []).map((k) => ({ script: '生活脚本', seed: '种子', director: '导演', carry: '初始经验', rujiTrust: '如姬托付' }[k])).filter(Boolean),
      counts,
      chain: world.chain || null,
      pulse: world.pulses[world.pulses.length - 1] || null,
      slip: world.slip.slice(-8),
      slipAll: world.slip.length,
      end: world.end || null,
      verdict: verdictOf(),
      prev,
      policy: world.policy ? { why: world.policy.why, verbs: world.policy.autonomy?.verbs || [], wait: world.policy.waitForPlayer } : null,
      actors, marks,
      ledger: { start: world.startLedger, now: world.session.ledger.entries.length },
      isolation: { mainBefore: world.mainBefore, mainNow: main?.entries?.length ?? null },
    };
  }

  return {
    arm, crank, toEnd, read,
    get locks() { return { ...locks }; },
    saveCarry: () => (world ? world.play.life.save() : null),
    /** 自查用：内部的真实对象，别给画面用 */
    _world: () => world,
  };
}
