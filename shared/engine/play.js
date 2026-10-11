// 第三阶段：呈现的可玩性。
//
// 《窃符》是一部能玩的作品：四幕（大梁、夷门、取符之夜、邺城），外加《围城》里的一场暮色粮仓。
// 这一版开始「抽骨架」：每一幕不再各写一条 if/else 链，而是
//   场景数据（shared/scenes/**：控制器组合 + 有序规则表 + 文本） + 共用交互内核（shared/kernel/**）。
// 这个文件只剩下「舞台流转」和「对外那张脸」。
//
// 这一版的迁移状态（小步提交，见 commit 说明）：
//   · 已迁：大梁 / 夷门 / 取符之夜 / 邺城 —— 选项来自控制器的 intents()，后果来自规则表 + 效果。
//   · 未迁：暮色粮仓仍在旧路径（下面的 granaryChoose）。原因是内核的 allowed() 对每一次 dispatch
//     都查导演闸门，而旧实现对粮仓从来不查（旧 view() 对粮仓选项一律 allowed:true，granaryChoose
//     也不看 allowed）；场景数据里已经声明了 gate:false，但内核还没认这个字段。
//     等内核补上一句 `if (sceneOf(sceneId).gate === false) return true;`，粮仓就搬过去。
//
// 对外面子和旧实现一致：begin/next/choose/watch/ask/chooseKeeper/view/grantsOf/state；
// view() 里旧字段一个不少，另加 controllers:[{id,view}]（每个控制器自己那块的渲染数据）。
//
// 可玩性从哪里来（设计总稿第 17 节）：
// - 你学的不是规则，是人。每个人的反应都由他自己的心智算出来（shared/core/mind.js 的 hear / perceive），
//   性情稳定所以学得会，内部状态（信任、压力、记忆）在变所以变化有来由。
// - 交互由导演授予：每一幕你能用哪些动词（说 / 给 / 去），来自导演对这一拍的设计（director.grant）。
//   “等着 / 不出声”永远可以选——你什么都不做，世界也会按每个人自己的目标往前走。
// - 每个动作先有前兆（他停住了 / 皱眉 / 已经动了），再有反应；点开心智入口，能看到他读到了什么、停在哪一层。
// - 你的影响被记住：大梁里信陵君对你的信任，决定你在邺城能不能替他说话；
//   夷门你说的话，决定如姬取符时犹不犹豫。前面的选择在后面的幕里被引用。
// - 结局不是写死的：史书的走法、晋鄙活下来的“本作的历史”、取符失手的断链，三种都真的走得到。
// - 你的结果写回同一张主张图：取符之夜和邺城分别交给 works.js 的 playWork，第二阶段的五种关系跟着变。
// - 导演的回路闭合：每一幕你是先看心思、先追问、还是直接动手，作为真实反应交给导演，和他的预测对照。

import { STATUS } from '../core/claims.js';
import { explainPerception } from '../core/mind.js';
import { playWork, worldRelations } from './works.js';
import { createKernel } from '../kernel/kernel.js';
import CONTROLLERS from '../kernel/controllers/index.js';
import { QIFU_SCENES, QIFU_CONTROLLERS, NIGHT_LIMIT, NIGHT_LANTERN, NIGHT_TILES } from '../scenes/qiefu.js';
import { WEICHENG_SCENES, WEICHENG_CONTROLLERS } from '../scenes/weicheng.js';

export { explainPerception } from '../core/mind.js';

const round = (v) => Math.round(v * 1000) / 1000;

/** 玩家在这些作品里用的身份 */
export const PLAYER = 'actor:player';
export const HOLDER = '门客（你）';

/** 《窃符》可玩的四幕；开场与拉远是零交互的电影段 */
export const ACT_ORDER = ['daliang', 'yimen', 'night', 'ye'];

/** 每一幕估计用时（秒），给地板检查估时长；电影段和尾声一起算 */
export const EST_SECONDS = { film: 60, daliang: 120, yimen: 120, night: 150, ye: 120, coda: 60, granary: 150 };

/** 围城的时间压力：邯郸还能撑几天（本作的抽象刻度，不是史料数字） */
export const START_DAYS = 30;

/** 两个守仓人：同一套心智结构，只换性情（23.4 同一件事，换个人） */
export const KEEPERS = ['keeper_doubt', 'keeper_rash'];

/**
 * 场景表。四幕来自 shared/scenes/qiefu.js（选项在它们的控制器里，不在这张表里）；
 * 粮仓那一场也已经写好场景数据，但它暂时还跑在旧路径上，所以这里同时留着旧那一份设定。
 */
export const SCENES = { ...QIFU_SCENES, ...WEICHENG_SCENES };

/** 内核自带八个通用控制器（说话 / 递东西 / 走动 / 计时 / 注意 / 地位 / 证据 / 透镜）；
 *  各幕自己写的控制器（由场景数据点名）也在这里合进去。 */
export const SCENE_CONTROLLERS = { ...QIFU_CONTROLLERS, ...WEICHENG_CONTROLLERS };

/** 旧形状的粮仓设定：搬去内核之前，旧那几段代码还按它读进度与三样东西 */
const GRANARY = {
  title: '暮色粮仓', place: '邯郸城内', beat: 'dusk', lead: null, work: 'weicheng',
  people: ['borrower'],
  goal: '账对不上。借粮者在桌前，桌上三样东西：印信、借条、担保物。',
  scene: '天快黑了，麻袋堆在墙角，守仓人的手一直按在账册上。',
  inspect: [
    { id: 'seal', item: '印信', channels: { 印信: 0.7 }, line: '把印信推到守仓人面前' },
    { id: 'note', item: '借条', channels: { 数量: 0.7 }, line: '把借条推到守仓人面前' },
    { id: 'pledge', item: '担保物', channels: { 人: 0.6 }, line: '把担保物推到守仓人面前' },
  ],
  decide: [
    { id: 'report', line: '拿着仓簿副页去报' },
    { id: 'witness', line: '拉上李同一起去报' },
    { id: 'hide', line: '先瞒下来' },
  ],
};

/** 对外仍然叫 ACTS：每一幕的设定（四幕的 options 在各自的控制器里） */
export const ACTS = { ...SCENES, granary: GRANARY };

function freshState() {
  return {
    stage: 'intro',            // intro → film → act → coda → granary → done
    actIndex: 0,
    days: START_DAYS,
    acts: {},                  // actId → { watched:[], asked:[], choice, outcome, done, signal }
    flags: {},
    log: [],                   // { act, kind, text, seq, person?, tell? }
    night: null,
    granary: null,
    ending: null,
  };
}

/**
 * 在一个已经见过导师的 session 上玩《窃符》。状态放在 session.state.play，随 session.save() 一起存。
 * 返回的每个方法都只改 session，不碰画面。
 */
export function createPlay(session) {
  const { ledger, claims, minds } = session;
  session.state.play ||= freshState();
  const P = () => session.state.play;

  // 内核的 work 效果要调 session.playWork；旧实现是直接 import playWork。这里把它接上（不进存档）。
  session.playWork = (workId, choice, opts) => playWork(session, workId, choice, opts);

  // 内核把「天数 / 旗标 / 各场控制器的状态」放在 session.state.play.kernel（随存档走）。
  // 旧代码读写的是 s.days / s.flags / s.night，所以把它们接到同一份数据上：
  // 存档里仍然是同一个 JSON 形状，只是同一个值不会有两份。
  const kern = createKernel(session, { scenes: SCENES, controllers: { ...CONTROLLERS, ...SCENE_CONTROLLERS }, store: session.state.play, days: START_DAYS });
  Object.defineProperty(session.state.play, 'days', {
    configurable: true, enumerable: true,
    get: () => kern.days(),
    set: (v) => { kern.root().days = v; },
  });
  Object.defineProperty(session.state.play, 'flags', {
    configurable: true, enumerable: true,
    get: () => kern.flags(),
    set: (v) => { kern.root().flags = v; },
  });
  // 取符之夜的状态住在 nightwalk 控制器里；旧代码里它叫 s.night。
  Object.defineProperty(session.state.play, 'night', {
    configurable: true, enumerable: true,
    get: () => kern.root().worlds?.night?.ctrl?.nightwalk ?? null,
    set: () => { /* 夜的状态由 nightwalk 自己持有 */ },
  });

  const name = (id) => minds[id]?.name || id;

  const currentActId = () => {
    const p = P();
    if (p.stage === 'act') return ACT_ORDER[p.actIndex];
    if (p.stage === 'granary') return 'granary';
    return null;
  };
  const actState = (id) => (P().acts[id] ||= { watched: [], asked: [], choice: null, outcome: null, done: false, signal: null });
  const openSeqOf = (work) => ledger.last((e) => e.kind === 'present.open' && e.payload.presentation === work)?.seq;
  const workOf = (actId) => (actId === 'granary' ? 'weicheng' : 'qiefu');

  /** 导演对这一拍授予的动词。电影段 level 0 → 什么都不给 */
  function grantsOf(actId) {
    if (!actId || !SCENES[actId]) return { verbs: [], level: 0, why: '', language: '看不见' };
    return kern.grants(actId);
  }

  function log(entry) {
    P().log.push({ act: currentActId(), ...entry });
  }

  function claim(spec, cause, presentation = 'qiefu') {
    const r = claims.add({ presentation, holder: HOLDER, channel: '亲历', ...spec, cause });
    return r.claim;
  }

  function find(subject, predicate) {
    return claims.consensus(subject, predicate) || claims.find((c) => c.subject === subject && c.predicate === predicate && c.status !== STATUS.FORMER).slice(-1)[0];
  }

  function trustOf(personId) {
    return round(minds[personId]?.state.trust[PLAYER] ?? 0.3);
  }

  /** 一场的世界（内核的控制器状态都在这里面） */
  const worldOf = (actId) => kern.world(actId);

  /** 把内核记下的「他对你这件事的反应」抄回旧的动作档案（旧代码里它是 a.last） */
  function remember(actId) {
    const a = actState(actId);
    a.last = worldOf(actId).last ?? null;
    return a.last;
  }

  /** 读一个点路径（只给画面的 optionsWhen 用） */
  function readPath(obj, path) {
    return String(path).split('.').reduce((cur, k) => (cur == null ? undefined : cur[k]), obj);
  }

  /* ---------------- 每一幕的后果 ---------------- */

  /**
   * 取符之夜开门：如姬取符前心里转几转（她对你的信与被发现的怕谁先吃下，决定她犹不犹豫）。
   * 这是一次「没有玩家动作的感知」，只写 actor.react。
   */
  function nightStart() {
    const world = kern.enter('night');
    const nw = world.ctrl.nightwalk;
    const trust = trustOf('ruji');
    const r = kern.perceive('night', 'ruji',
      { kind: 'night', signature: 'night:ruji', channels: { 恩: round(trust + 0.1), 惧: 0.5 } },
      { trust, hesitant: { unit: 'risk' } });
    const hesitant = r.perception.action.act === minds.ruji?.def.units.find((u) => u.id === 'risk')?.act;
    const last = {
      person: 'ruji', reactSeq: r.reactSeq, stoppedAt: r.perception.stoppedAt, action: r.perception.action.act,
      explain: explainPerception(r.perception, '如姬'),
      reason: hesitant ? '她对你的信不够，被发现的怕先吃下了' : '恩先吃下了，她不犹豫',
    };
    actState('night').last = last;
    world.last = last;
    nw.rujiReady = !hesitant;
    nw.hesitant = hesitant;
  }

  function signalOf(a) {
    if (a.watched.length) return '停下来看心思';
    if (a.asked.length) return '追问为什么';
    return '很快通过';
  }

  function finishAct(actId) {
    const a = actState(actId);
    a.done = true;
    a.signal = signalOf(a);
    const work = workOf(actId);
    session.react(work, ACTS[actId].beat, a.signal);
  }

  /* ---------------- 对外的方法 ---------------- */

  function begin() {
    if (!session.state.met) throw new Error('先见导师，再进作品');
    const s = P();
    if (s.stage !== 'intro') return view();
    if (!session.state.plays?.changping) playWork(session, 'changping');
    session.commission('qiefu');
    s.stage = 'film';
    log({ kind: 'film', text: '长平之后，秦军围邯郸。赵使一路向魏国求救；魏王令晋鄙的十万军停在邺，不许再走。' });
    return view();
  }

  function next() {
    const s = P();
    if (s.stage === 'film') { s.stage = 'act'; s.actIndex = 0; return view(); }
    if (s.stage === 'act') {
      const id = ACT_ORDER[s.actIndex];
      if (!actState(id).done) throw new Error('这一幕还没做出选择');
      s.actIndex += 1;
      if (s.actIndex >= ACT_ORDER.length) return coda();
      if (ACT_ORDER[s.actIndex] === 'night') nightStart();
      return view();
    }
    if (s.stage === 'coda') { return startGranary(); }
    if (s.stage === 'granary') {
      if (!actState('granary').done) throw new Error('粮仓这一场还没做完');
      s.stage = 'done';
      return view();
    }
    return view();
  }

  function choose(optionId) {
    const s = P();
    const actId = currentActId();
    if (!actId) throw new Error('现在没有可以做的选择');
    if (actId === 'granary') return granaryChoose(optionId);
    const a = actState(actId);
    if (a.done) throw new Error('这一幕已经做完了');
    const opt = kern.intents(actId).find((o) => o.id === optionId);
    if (!opt) throw new Error(`没有这个选项：${optionId}`);
    // 内核的 allowed 字段把「闸门」和「这件事已经做过」合成一个布尔；旧实现只把闸门写成异常，
    // 已经做过的那一项要落成 refused（夜里的令牌出手两次就是这一支）。
    if (!kern.allowed(actId, opt)) throw new Error(`导演这一幕没有授予「${opt.verb}」`);

    const out = kern.dispatch(actId, optionId);
    if (out.refused) return { ...out, view: view() };
    a.steps = (a.steps || 0) + 1;

    if (actId === 'night') {
      // 夜晚这一步的文本由 nightwalk 给（灯走完、谁看见了谁之后）；规则表另外给「符落定」那句话
      const nw = worldOf('night').ctrl.nightwalk;
      log({ kind: 'act', text: nw.lastText, person: out.r?.person, tell: out.r?.tell, option: opt.id });
      if (nw.done) {
        const pick = nw.seen ? 'seen' : 'clean';
        s.flags.night = pick;
        session.react('night', 'run', signalOf(a));
        a.choice = pick;
        a.outcome = { text: out.text, work: out.work?.touched ?? null };
        finishAct('night');
      }
      return { ...out, view: view() };
    }

    log({ kind: 'act', text: out.text, person: out.r?.person, tell: out.r?.tell, option: opt.id, seq: out.r?.reactSeq });
    if (out.work) out.work = out.work.touched;       // 旧：out.work = w.touched
    a.choice = opt.id;
    a.outcome = { text: out.text, cost: out.cost || null, claims: out.claims || [], choice: out.choice || null };
    remember(actId);
    finishAct(actId);
    return { ...out, view: view() };
  }

  function watch(personId) {
    const actId = currentActId();
    const r = kern.watch(actId, personId);            // 闸门、回滚、返回字段都在内核里（与旧实现同）
    const a = actId ? actState(actId) : null;
    if (a && !a.watched.includes(personId)) a.watched.push(personId);
    return r;
  }

  function ask(personId) {
    const actId = currentActId();
    const r = kern.ask(actId, personId);
    const a = actId ? actState(actId) : null;
    if (a && !a.asked.includes(personId)) a.asked.push(personId);
    return r;
  }

  function coda() {
    const s = P();
    s.stage = 'coda';
    const fate = find('晋鄙', '下场');
    const end = find('邯郸', '结局');
    const ending = s.flags.night !== 'clean' ? 'broken' : /交出兵权/.test(String(fate?.object)) ? 'jinbi-lives' : 'history';
    s.ending = ending;
    const wrap = session.wrap('qiefu');
    const book = '《史记》：公子遂将晋鄙军……进兵击秦军，秦军解去，遂救邯郸，存赵。侯生果北乡自刭。';
    const lived = {
      history: '你亲历的和史书一致：铁椎落下，晋鄙死在帐中，魏军往邯郸去。',
      'jinbi-lives': '你亲历的与史书不同：晋鄙解下印绶，随军而行。这是「本作的历史」。',
      broken: '你亲历的与史书不同：兵符没能出宫，魏军停在邺。邯郸没有等到援军——这是「本作的历史」。',
    }[ending];
    const daysText = s.days > 0 ? `援军到时，邯郸还能撑 ${s.days} 天。` : '援军到时，城里已经撑到了极限。';
    log({ kind: 'coda', text: `${lived} ${ending === 'broken' ? '' : daysText}` });
    s.coda = { ending, book, lived, days: s.days, fate: fate?.object || null, end: end?.object || null, director: wrap ? { seq: wrap.seq, errors: wrap.errors } : null };
    return view();
  }

  function startGranary() {
    const s = P();
    s.stage = 'granary';
    session.commission('weicheng');
    s.granary = { keeper: s.granary?.keeper || 'keeper_doubt', phase: 'inspect', inspected: null, keeperAct: null };
    return view();
  }

  /** 换一个守仓人再看一次（只在查看之前能换；换了之后同一件东西，看两个人怎么办） */
  function chooseKeeper(id) {
    const g = P().granary;
    if (!g) throw new Error('还没到粮仓');
    if (!KEEPERS.includes(id)) throw new Error(`没有这个守仓人：${id}`);
    g.keeper = id;
    if (g.phase === 'decide') { g.phase = 'inspect'; g.inspected = null; g.keeperAct = null; }
    return view();
  }

  /**
   * 暮色粮仓：还没搬到内核（内核的 allowed() 不认 gate:false，见文件头）。
   * 除了反应改由内核记（kern.react），其余照旧。
   */
  function granaryChoose(optionId) {
    const s = P();
    const g = s.granary;
    const act = ACTS.granary;
    const a = actState('granary');
    if (g.phase === 'inspect') {
      const opt = act.inspect.find((o) => o.id === optionId);
      if (!opt) throw new Error(`没有这个选项：${optionId}`);
      const r = kern.react('granary', { ...opt, verb: 'give' }, g.keeper, { channels: opt.channels });
      remember('granary');
      g.inspected = opt.id;
      g.keeperAct = r.perception.action.act;
      g.phase = 'decide';
      const text = `${r.tell}。${name(g.keeper)}${r.perception.action.act}。`;
      (g.tries ||= []).push({ keeper: g.keeper, item: opt.item, act: r.perception.action.act, stoppedAt: r.perception.stoppedAt });
      log({ kind: 'act', text, person: g.keeper, tell: r.tell, option: opt.id, seq: r.reactSeq });
      return { r, text, view: view() };
    }
    const opt = act.decide.find((o) => o.id === optionId);
    if (!opt) throw new Error(`没有这个选项：${optionId}`);
    const w = playWork(session, 'weicheng', opt.id, { reuseOpen: true });
    const verdict = ledger.last((e) => e.kind === 'director.approve' || e.kind === 'director.refuse');
    let text;
    if (opt.id === 'hide') text = '你把账合上。城里的说法和城外一样：存粮尚可支撑。';
    else if (verdict?.kind === 'director.approve') text = `导演批了：${verdict.payload.rule}。「邯郸存粮尚可支撑」成了曾经的共识。`;
    else text = `导演没批：${verdict?.payload.rule}。守仓人的说法挂着，推不动城外的共识。`;
    a.choice = opt.id;
    a.outcome = { text, work: w.touched };
    log({ kind: 'act', text, option: opt.id });
    finishAct('granary');
    session.wrap('weicheng');
    return { text, view: view() };
  }

  /** 画面需要的一切：现在在哪、能做什么、为什么只能做这些 */
  function view() {
    const s = P();
    const actId = currentActId();
    const base = { stage: s.stage, days: s.days, ending: s.ending, log: s.log.slice(-30), flags: { ...s.flags } };
    if (s.stage === 'intro' || s.stage === 'film') return { ...base, film: s.stage === 'film' ? s.log[0]?.text : null };
    if (s.stage === 'coda') return { ...base, coda: s.coda };
    if (s.stage === 'done') {
      return { ...base, coda: s.coda, granary: s.granary, edges: worldRelations(session), acts: summarizeActs() };
    }
    const act = ACTS[actId];
    const a = actState(actId);
    const grants = grantsOf(actId);
    const people = (act.people || []).concat(actId === 'granary' ? [s.granary.keeper] : []).map((id) => ({
      id, name: name(id), title: minds[id]?.def.title, trust: trustOf(id), stress: round(minds[id]?.state.stress ?? 0),
      look: minds[id]?.def.look || null, voice: minds[id]?.def.voice || '',
    }));
    let options;
    let controllers = [];
    if (actId === 'granary') {
      // 旧路径：粮仓选项从来不查闸门，画面上一直是 allowed:true
      options = (s.granary.phase === 'inspect' ? act.inspect : act.decide).map((o) => ({ id: o.id, verb: s.granary.phase === 'inspect' ? 'give' : 'say', line: o.line, item: o.item || null, allowed: true }));
    } else {
      const intents = kern.intents(actId);
      options = intents.map((o) => ({ id: o.id, verb: o.verb, to: o.to || null, toName: o.to ? name(o.to) : null, line: o.line, item: o.item || null, allowed: o.allowed }));
      controllers = kern.views(actId);
      // 有些幕的开场只留一个选项（只改画面，不改 choose 的可选项）
      const ow = act.optionsWhen;
      if (ow) {
        const got = readPath(s, ow.fact);
        const hit = 'not' in ow ? got !== ow.not : got === ow.is;
        if (hit) options = options.filter((o) => ow.only.includes(o.id)).map((o) => ({ ...o, line: ow.line?.[o.id] ?? o.line }));
      }
    }
    const nightView = controllers.find((c) => c.id === 'nightwalk')?.view || null;
    return {
      ...base, act: actId, index: actId === 'granary' ? null : s.actIndex, title: act.title, place: act.place,
      goal: act.goal, scene: act.scene, grants, people, options, done: a.done, outcome: a.outcome,
      watched: a.watched, asked: a.asked, controllers,
      night: actId === 'night' ? { ...nightView, tiles: NIGHT_TILES, pattern: NIGHT_LANTERN, limit: NIGHT_LIMIT } : null,
      granary: actId === 'granary' ? { ...s.granary, keepers: KEEPERS.map((id) => ({ id, name: name(id) })) } : null,
      prediction: (session.state.predictions?.[workOf(actId)]?.list || []).find((p) => p.beat === act.beat) || null,
    };
  }

  function summarizeActs() {
    const s = P();
    return [...ACT_ORDER, 'granary'].filter((id) => s.acts[id]).map((id) => ({ id, title: ACTS[id].title, choice: s.acts[id].choice, signal: s.acts[id].signal, text: s.acts[id].outcome?.text || '' }));
  }

  return { begin, next, choose, watch, ask, chooseKeeper, view, grantsOf, state: P };
}

/** 一局走完要多久（秒），给地板检查用 */
export function estimateSeconds(play) {
  const s = play.state();
  let t = EST_SECONDS.film + EST_SECONDS.coda;
  for (const id of ACT_ORDER) if (s.acts[id]) t += id === 'night' ? Math.min(EST_SECONDS.night, 15 * (s.acts.night.steps || 0) + 45) : EST_SECONDS[id];
  return t;
}
