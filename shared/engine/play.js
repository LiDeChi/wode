// 第三阶段：呈现的可玩性。
//
// 《窃符》是一部能玩的作品：四幕（大梁、夷门、取符之夜、邺城），外加《围城》里的一场暮色粮仓。
// 这一版开始「抽骨架」：每一幕不再各写一条 if/else 链，而是
//   场景数据（shared/scenes/**：控制器组合 + 有序规则表 + 文本） + 共用交互内核（shared/kernel/**）。
// 这个文件只剩下「舞台流转」和「对外那张脸」。
//
// 迁移状态：全部搬完。
//   · 大梁 / 夷门 / 取符之夜 / 邺城 —— 选项来自控制器的 intents()，后果来自规则表 + 效果。
//   · 暮色粮仓 —— 同样跑在内核上（shared/scenes/weicheng.js）。这一场和四幕不同的一点：旧代码
//     对粮仓从来不查导演授权（旧 view() 对粮仓选项一律 allowed:true，granaryChoose 也不看 allowed），
//     所以那道场景声明了 gate:false，内核的 allowed() 见到它直接放行（docs/KERNEL.md §2）。
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
import { ELIDED_NOTE } from '../kernel/depth.js';
import CONTROLLERS from '../kernel/controllers/index.js';
import { designLife } from '../life/plan.js';
import { createLife } from '../life/life.js';
import { QIFU_SCENES, QIFU_CONTROLLERS, NIGHT_LIMIT, NIGHT_LANTERN, NIGHT_TILES } from '../scenes/qiefu.js';
import { WEICHENG_SCENES, WEICHENG_CONTROLLERS } from '../scenes/weicheng.js';
// 两个新组合（docs/KERNEL.md §7）住在各自的文件里，只是加进同一张场景表，不改上面两部作品
import { OVERHEARD_SCENES, OVERHEARD_CONTROLLERS } from '../scenes/daliang-overheard.js';
import { ESCORT_SCENES, ESCORT_CONTROLLERS } from '../scenes/weicheng-escort.js';

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
 * 场景表。五场全部来自 shared/scenes/**（选项在它们的控制器里，不在这张表里）。
 * 对外仍然叫 ACTS：舞台流转要用每一幕的 beat 与标题。
 */
export const SCENES = { ...QIFU_SCENES, ...WEICHENG_SCENES, ...OVERHEARD_SCENES, ...ESCORT_SCENES };

/** 内核自带八个通用控制器（说话 / 递东西 / 走动 / 计时 / 注意 / 地位 / 证据 / 透镜）；
 *  各幕自己写的控制器（由场景数据点名）也在这里合进去。 */
export const SCENE_CONTROLLERS = { ...QIFU_CONTROLLERS, ...WEICHENG_CONTROLLERS, ...OVERHEARD_CONTROLLERS, ...ESCORT_CONTROLLERS };

export const ACTS = SCENES;

/**
 * 两个新组合（docs/KERNEL.md §7）的场景 id：被偷听、押粮。
 * 它们不是《窃符》《围城》的分幕——不进 ACT_ORDER、不占 acts 的位置、不影响一局的存档形状，
 * 由 createPlay(session).enterExtra(id) 单独进场，演完 stage 直接到 done。
 */
export const EXTRA_IDS = ['daliang_overheard', 'escort'];

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
 * 持续生活的存档形状（只在 createPlay({living:...}) 时才建）。
 * 逻辑拍、已处理的输入、真实感知片段、记忆存储、导演的生活计划都在这里，随 session.save() 一起走。
 * 不启用生活的会话里，state.play 里连这个键都没有。
 */
function freshLifeState() {
  return {
    v: 1,
    seed: null,            // 唯一随机入口：调用方传进来并存下来
    episodeId: 'ep1',
    tick: 0,
    sceneId: null,
    policies: {},
    processed: {},         // 输入 id → { tick, op }（重复 id 只跑一次）
    pendingInputs: [],
    queue: [],
    perceptions: {},       // 反应 seq → 感知当时留下的真实片段
    experiences: {},
    store: null,           // 记忆存储的存档
    paused: false,
    ended: false,
    pause: { sinceTick: 0, recorded: null },
  };
}

/**
 * 在一个已经见过导师的 session 上玩《窃符》。状态放在 session.state.play，随 session.save() 一起存。
 * 返回的每个方法都只改 session，不碰画面。
 *
 * opts（都可选）：
 *   scenes: 换一张场景表（默认就是本文件上面那张 SCENES）。形状与 docs/KERNEL.md §2 相同；
 *           科研台用它注入深拷贝的场景做控制变量重跑。场景表只影响「怎么演」，不影响账本里的事实顺序。
 *   tiers: {'night':'细演'} | {'night':3} | 'mentor'   —— 也可以按 beat / 按作品给；'mentor' 读导师的分配结果
 *   tierOf: (actId, scene) => 档位
 *   budget: 算力上限；不够就往下降档，降到底照常演完
 * 不传档位时每一场都是「普通」，与没有档位的老行为逐字节相同（680 个脚本的对照组）。
 */
export function createPlay(session, opts = {}) {
  const { ledger, claims, minds } = session;
  session.state.play ||= freshState();
  const P = () => session.state.play;
  // 场景表可以换；本文件里所有场景查找都走这一份（createKernel / grantsOf / view / 舞台流转）
  const scenes = opts.scenes || SCENES;

  // ---- 持续生活（docs/design/LIVING.md §9）：显式打开才有 ----
  // 不传 opts.living（默认）时 life 是 null：这一份文件后面所有生活相关的分支都不进，
  // 存档形状、账本、view() 的字段与 680 个脚本的对照组逐字节相同。
  const living = opts.living === 'director' || opts.living === true ? 'director' : null;
  const lifeState = living ? (session.state.play.life ||= freshLifeState()) : null;
  if (living) session.mentor?.enableMind?.();

  // 内核的 work 效果要调 session.playWork；旧实现是直接 import playWork。这里把它接上（不进存档）。
  session.playWork = (workId, choice, opts) => playWork(session, workId, choice, opts);

  // 内核把「天数 / 旗标 / 各场控制器的状态」放在 session.state.play.kernel（随存档走）。
  // 旧代码读写的是 s.days / s.flags / s.night，所以把它们接到同一份数据上：
  // 存档里仍然是同一个 JSON 形状，只是同一个值不会有两份。
  const kern = createKernel(session, { scenes, controllers: { ...CONTROLLERS, ...SCENE_CONTROLLERS }, store: session.state.play, days: START_DAYS, tiers: opts.tiers, tierOf: opts.tierOf, budget: opts.budget, perceptions: lifeState?.perceptions });

  // 生活循环：一秒一个整数逻辑拍。input 走原来那几条路（choose/watch/ask/…），
  // 所以玩家做的事在账本上还是同一种记录，生活只是替它挑了个拍子。
  let lifePlanCache = null;
  let lifePlanKey = null;
  const lifePlanRef = { get policies() { return lifePlan().policies; } };
  const life = living ? createLife({
    session, kernel: kern, plan: lifePlanRef, seed: opts.seed ?? 'life',
    store: lifeState, scenes, input: (inp) => runInput(inp),
  }) : null;
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
  // 粮仓那三样东西与两个阶段住在 desk 控制器里；旧代码里它叫 s.granary。
  Object.defineProperty(session.state.play, 'granary', {
    configurable: true, enumerable: true,
    get: () => kern.root().worlds?.granary?.ctrl?.desk ?? null,
    set: () => { /* 守仓人的桌子由 desk 自己持有 */ },
  });

  const name = (id) => minds[id]?.name || id;

  const currentActId = () => {
    const p = P();
    if (p.stage === 'act') return ACT_ORDER[p.actIndex];
    if (p.stage === 'granary') return 'granary';
    if (p.stage === 'extra') return p.extra?.id ?? null;   // 新组合：一场一个 id
    return null;
  };
  const actState = (id) => (P().acts[id] ||= { watched: [], asked: [], choice: null, outcome: null, done: false, signal: null });
  const openSeqOf = (work) => ledger.last((e) => e.kind === 'present.open' && e.payload.presentation === work)?.seq;
  // 一场属于哪个作品：场景数据自己说了算（注入的场景表也能带自己的 work）
  const workOf = (actId) => scenes[actId]?.work || (actId === 'granary' ? 'weicheng' : 'qiefu');

  /** 导演对这一拍授予的动词。电影段 level 0 → 什么都不给 */
  function grantsOf(actId) {
    if (!actId || !scenes[actId]) return { verbs: [], level: 0, why: '', language: '看不见' };
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
    // 开了持续生活时只看「本段经历 + 明确继承」里的主张：上一局的结局、下场不参与这一段的计算
    const scope = session.episodeScope?.() ?? null;
    const only = scope ? scope.claimIds : null;
    return claims.consensus(subject, predicate, only)
      || claims.find((c) => c.subject === subject && c.predicate === predicate && c.status !== STATUS.FORMER && (!only || only.includes(c.id))).slice(-1)[0];
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
    session.react(work, scenes[actId].beat, a.signal);
  }

  /* ---------------- 对外的方法 ---------------- */

  // ── 新组合（docs/KERNEL.md §7）：被偷听、押粮 ──────────────────────────────
  // 两个新玩法只由「控制器清单 + 有序规则表 + 文本」组成（见 shared/scenes/daliang-overheard.js
  // 与 weicheng-escort.js），内核一行没改；这里只多了一个进场入口，玩法本身没有特例分支：
  // 进场 = 内核的 enter()，做选择 = 内核的 dispatch()，收束 = 规则表里的 end 效果。

  /** 走进一个新组合（sceneId ∈ EXTRA_IDS）。只新增入口，不动原作的 begin/next/choose */
  function enterExtra(sceneId) {
    const s = P();
    if (!EXTRA_IDS.includes(sceneId) || !scenes[sceneId]) throw new Error(`没有这个新组合：${sceneId}`);
    if (s.stage === 'act' || s.stage === 'granary') throw new Error('先把这一幕做完，再进新组合');
    const a = actState(sceneId);
    a.done = false; a.choice = null; a.outcome = null; a.watched = []; a.asked = [];
    s.extra = { id: sceneId, ending: null };
    s.stage = 'extra';
    kern.enter(sceneId);                       // 建场（幂等）：各控制器 init
    log({ kind: 'extra', text: scenes[sceneId].scene });
    return view();
  }

  /** 新组合里的一次选择：与四幕同一条路（查闸门 → dispatch → 记 log → 收束），只是不进 acts 的分幕流程 */
  function extraChoose(actId, optionId) {
    const s = P();
    const a = actState(actId);
    if (a.done) throw new Error('这一场已经做完了');
    const opt = kern.intents(actId).find((o) => o.id === optionId);
    if (!opt) throw new Error(`没有这个选项：${optionId}`);
    if (!kern.allowed(actId, opt)) throw new Error(`导演这一幕没有授予「${opt.verb}」`);

    const out = kern.dispatch(actId, optionId);
    if (out.refused) return { ...out, view: view() };

    log({ kind: 'act', text: out.text, person: out.r?.person, tell: out.r?.tell, option: opt.id, seq: out.r?.reactSeq });
    if (out.work) out.work = out.work.touched;
    a.choice = opt.id;
    a.outcome = { text: out.text, cost: out.cost || null, claims: out.claims || [], choice: out.choice || null, end: out.end || null };
    remember(actId);
    if (out.end) {                             // 规则表给了收束（end 效果）→ 这一场就到这里
      a.done = true;
      s.extra = { id: actId, ending: out.end };
    }
    return { ...out, view: view() };
  }

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
    if (s.stage === 'extra') {
      const id = currentActId();
      if (id && !actState(id).done) throw new Error('这一场还没做完');
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
    if (s.stage === 'extra') return extraChoose(actId, optionId);
    const a = actState(actId);
    if (a.done) throw new Error('这一幕已经做完了');
    const opt = kern.intents(actId).find((o) => o.id === optionId);
    if (!opt) throw new Error(`没有这个选项：${optionId}`);
    // 内核的 allowed 字段把「闸门」和「这件事已经做过」合成一个布尔；旧实现只把闸门写成异常，
    // 已经做过的那一项要落成 refused（夜里的令牌出手两次就是这一支）。
    if (!kern.allowed(actId, opt)) throw new Error(`导演这一幕没有授予「${opt.verb}」`);

    const out = kern.dispatch(actId, optionId);
    if (out.refused) return { ...out, view: view() };

    if (actId === 'night') {
      // 步数只有取符之夜数（旧实现就是只在夜里加 a.steps）
      a.steps = (a.steps || 0) + 1;
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
    const g = kern.enter('granary').ctrl.desk;      // 建桌子（幂等）；旧代码在这里新建 s.granary
    g.keeper = g.keeper || 'keeper_doubt';
    g.phase = 'inspect';
    g.inspected = null;
    g.keeperAct = null;
    delete g.tries;                                  // 旧代码新建对象，前一次的现场记录不带走
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
   * 暮色粮仓：两步都在内核上（shared/scenes/weicheng.js 的 desk 控制器 + 规则表）。
   * 检验阶段把东西推过去，守仓人给个反应；决定阶段交给导演批，收尾（收幕 / 包场）留在这里。
   */
  function granaryChoose(optionId) {
    const a = actState('granary');
    const phase = P().granary?.phase;                // 桌子翻面发生在 dispatch 里，先记下原来那一面
    const out = kern.dispatch('granary', optionId);
    if (out.refused) return { ...out, view: view() };
    if (phase === 'decide') {
      const text = out.text;
      a.choice = optionId;
      a.outcome = { text, work: out.work?.touched ?? null };
      log({ kind: 'act', text, option: optionId });
      finishAct('granary');
      session.wrap('weicheng');
      return { text, view: view() };
    }
    remember('granary');
    log({ kind: 'act', text: out.text, person: out.r?.person, tell: out.r?.tell, option: optionId, seq: out.r?.reactSeq });
    return { r: out.r, text: out.text, view: view() };
  }

  /* ---------------- 持续生活：导演的生活计划与逻辑拍（只在 living 打开时走到） ---------------- */

  /** 导演给每一场每一拍的生活计划。纯函数，不写状态；真正的提交只发生在 lifePolicyFor。 */
  function lifePlan() {
    const designs = session.state.designs || {};
    // 导演案可能晚于 createPlay 才落（先 meet 再 begin）：案一变就重算
    const key = Object.keys(designs).sort().map((w) => `${w}:${(designs[w].beats || []).map((b) => b.id).join(',')}`).join('|');
    if (!lifePlanCache || lifePlanKey !== key) {
      const director = session.director?.() ?? null;
      const works = [...new Set(Object.values(scenes).map((s) => s.work).filter(Boolean))];
      const policies = {};
      const decisions = [];
      for (const w of works) {
        const got = designLife({ director, design: designs, work: w, scenes, seed: opts.seed ?? 'life' });
        Object.assign(policies, got.policies);
        decisions.push(...got.decisions);
      }
      lifePlanCache = { policies, decisions };
      lifePlanKey = key;
    }
    return lifePlanCache;
  }

  /** 一个 beat 只提交一次生活计划（第二次进这一场直接读存档里的那份） */
  function lifePolicyFor(sceneId) {
    const scene = scenes[sceneId];
    if (!scene) return null;
    const work = workOf(sceneId);
    const beat = scene.beat ?? sceneId;
    const planned = lifePlan().policies[beat] || lifePlan().policies[sceneId];
    if (!planned) return null;
    const done = session.commitLifeDesign({ work, beat, policy: planned, cause: [openSeqOf(work)].filter(Boolean) });
    return done?.policy ?? planned;
  }

  function lifeEnter(sceneId) {
    if (!life) return null;
    const id = sceneId || currentActId();
    if (!id || !scenes[id]) return null;
    life.enter(id, lifePolicyFor(id));
    return id;
  }

  /** 这一拍走完，舞台可能已经翻到下一场：把生活循环挪过去（同一 beat 不重复提交） */
  function syncLifeScene() {
    if (!life) return null;
    const id = currentActId();
    if (id && scenes[id] && id !== life.state().sceneId) lifeEnter(id);
    return life.state().sceneId;
  }

  /** 玩家做的事仍然走原来那几条路：账本、反应、文字一字不变，只是由逻辑拍来触发 */
  function runInput(inp) {
    const a = inp?.args || {};
    if (inp?.op === 'choose') return choose(a.id ?? a.option);
    if (inp?.op === 'watch') return watch(a.person ?? a.id);
    if (inp?.op === 'ask') return ask(a.person ?? a.id);
    if (inp?.op === 'chooseKeeper') return chooseKeeper(a.id ?? a.keeper);
    if (inp?.op === 'granary') return granaryChoose(a.id ?? a.choice);
    if (inp?.op === 'begin') return begin();
    if (inp?.op === 'next') return next();
    return null;
  }

  /** 推进到某一拍：同一 toTick 重复调用、同一 input id 重复提交都只发生一次 */
  function advance(args = {}) {
    if (!life) return null;
    lifeEnter(life.state().sceneId || currentActId());
    const r = life.advance(args);
    syncLifeScene();
    return r;
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
    const act = scenes[actId];
    const a = actState(actId);
    const grants = grantsOf(actId);
    const people = (act.people || []).concat(actId === 'granary' ? [s.granary.keeper] : []).map((id) => ({
      id, name: name(id), title: minds[id]?.def.title, trust: trustOf(id), stress: round(minds[id]?.state.stress ?? 0),
      look: minds[id]?.def.look || null, voice: minds[id]?.def.voice || '',
    }));
    let options;
    const intents = kern.intents(actId);
    if (actId === 'granary') {
      // 粮仓那一场声明了 gate:false，所以画面上一直是 allowed:true；选项字段与旧实现逐个相同
      options = intents.map((o) => ({ id: o.id, verb: o.verb, line: o.line, item: o.item || null, allowed: o.allowed }));
    } else {
      options = intents.map((o) => ({ id: o.id, verb: o.verb, to: o.to || null, toName: o.to ? name(o.to) : null, line: o.line ?? o.label ?? null, item: o.item || null, allowed: o.allowed }));
      // 有些幕的开场只留一个选项（只改画面，不改 choose 的可选项）
      const ow = act.optionsWhen;
      if (ow) {
        const got = readPath(s, ow.fact);
        const hit = 'not' in ow ? got !== ow.not : got === ow.is;
        if (hit) options = options.filter((o) => ow.only.includes(o.id)).map((o) => ({ ...o, line: ow.line?.[o.id] ?? o.line }));
      }
    }
    const controllers = kern.views(actId);
    const nightView = controllers.find((c) => c.id === 'nightwalk')?.view || null;
    const tier = kern.tierOf(actId);
    const out = {
      ...base, act: actId, index: actId === 'granary' || s.stage === 'extra' ? null : s.actIndex, title: act.title, place: act.place,
      goal: act.goal, scene: act.scene, grants, people, options, done: a.done, outcome: a.outcome,
      watched: a.watched, asked: a.asked, controllers,
      night: actId === 'night' ? { ...nightView, tiles: NIGHT_TILES, pattern: NIGHT_LANTERN, limit: NIGHT_LIMIT } : null,
      granary: actId === 'granary' ? { ...s.granary, keepers: KEEPERS.map((id) => ({ id, name: name(id) })) } : null,
      prediction: (session.state.predictions?.[workOf(actId)]?.list || []).find((p) => p.beat === act.beat) || null,
    };
    // 档位：默认那一档（普通）不往画面上加任何字段，旧画面逐字段相同
    if (tier !== '普通') out.tier = tier;
    if (tier === '一笔带过') { out.elided = true; out.elidedNote = ELIDED_NOTE; }
    // 开了持续生活才多这一项：现在第几拍、导演给这一场的生活计划
    if (life) {
      const ls = life.state();
      out.life = { tick: ls.tick, scene: ls.sceneId, paused: ls.paused, ended: ls.ended, policy: life.policy?.(ls.sceneId) ?? null };
    }
    return out;
  }

  function summarizeActs() {
    const s = P();
    return [...ACT_ORDER, 'granary'].filter((id) => s.acts[id]).map((id) => ({ id, title: scenes[id]?.title, choice: s.acts[id].choice, signal: s.acts[id].signal, text: s.acts[id].outcome?.text || '' }));
  }

  return {
    begin, next, choose, watch, ask, chooseKeeper, view, grantsOf, state: P, tierOf: (actId) => kern.tierOf(actId), tiers: () => kern.tierPlan(), enterExtra, extraScenes: () => EXTRA_IDS.slice(),
    // 开了持续生活才多这几条；默认关闭时返回对象与旧实现逐字段相同
    ...(life ? {
      life,
      kernel: () => kern,
      advance,
      lifeEnter,
      lifeRead: (sceneId) => { const id = sceneId || life.state().sceneId; return id ? life.read(id) : null; },
      lifeTrace: (seq) => life.trace(seq),
      lifeRecall: (q) => life.recall(q),
    } : {}),
  };
}

/** 一局走完要多久（秒），给地板检查用 */
export function estimateSeconds(play) {
  const s = play.state();
  let t = EST_SECONDS.film + EST_SECONDS.coda;
  for (const id of ACT_ORDER) if (s.acts[id]) t += id === 'night' ? Math.min(EST_SECONDS.night, 15 * (s.acts.night.steps || 0) + 45) : EST_SECONDS[id];
  return t;
}
