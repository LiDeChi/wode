// 粮仓那三句「人话」改动「之前」的《围城》场景快照（t38 用）：
//   git show 34f27b5:shared/scenes/weicheng.js      （= t38 父提交）
// 用途只有一个——tests/kernel-parity.test.js 的第三个测试要拿「旧场景」把 tests/fixtures/play-golden.json
// 一笔不差地重放出来。t38 只改了粮仓决定那一步给玩家看的正文（导演批没批 / 爱雕琢 / 两件证据 → 城里人的反应），
// 旧基线里的那三句必须有个地方冻着，所以这里留一份改动前的场景表。
// 注意：这不是「抽内核之前」的粮仓（那份是 phase 匹配规则，配现在的内核会重复跑 work 效果），
// 而是「内核已经接管粮仓、但文字还没改」的那一版。
// 不要改这个文件；它就该永远是那一刻的样子。
// 《围城》粮仓（docs/KERNEL.md §2）：一幕 = 控制器清单 + 有序规则表 + 文本。
//
// 这一场和《窃符》四幕不同的一点：旧代码对粮仓不查导演闸门（旧 view() 对粮仓选项一律 allowed:true，
// granaryChoose 也不看 allowed），所以这道场景声明 gate:false（内核的 allowed() 需要认可它，见 commit 说明）。
//
// 两个阶段（检验 / 决定）不是两条规则，而是同一个 desk 控制器的两种姿态：
// 检验阶段把东西推到守仓人面前，让他有反应（账本里是 user.act + actor.react）；
// 决定阶段把这次决定交给导演（work 效果 → director.approve / director.refuse），批没批决定最后那句话。

/** 桌上三样东西 / 三条路。旧 ACTS.granary 的 inspect 与 decide，字段与顺序都照旧 */
export const GRANARY_ITEMS = {
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

/**
 * 守仓人的桌子。他手里的账就是这一场的状态：先看（谁坐在对面、你推过来什么、他怎么反应），
 * 再做决定。检验阶段这一步要留下「你推了什么，他怎么反应」的账（tries 是旧代码里的现场记录）。
 */
export function desk(cfg = {}) {
  const inspect = cfg.inspect || GRANARY_ITEMS.inspect;
  const decide = cfg.decide || GRANARY_ITEMS.decide;
  const order = cfg.order ?? 100;
  const st = (ctx) => ctx.ctrl('desk');
  return {
    id: 'desk',
    init() {
      // 形状与旧 s.granary 一致：keeper / phase / inspected / keeperAct（tries 第一次检验后才出现）
      return { keeper: 'keeper_doubt', phase: 'inspect', inspected: null, keeperAct: null };
    },
    intents(ctx) {
      const s = st(ctx);
      const phase = s?.phase || 'inspect';
      const list = phase === 'inspect' ? inspect : decide;
      return list.map((o, i) => ({ ...o, verb: phase === 'inspect' ? 'give' : 'say', order: order + i }));
    },
    apply(intent, ctx) {
      const s = st(ctx);
      if (s.phase !== 'inspect') return {};      // 决定阶段：账已经交给导演，规则表负责收尾
      // 旧 granaryChoose 的检验分支：先反应，再记「你推了什么、他怎么反应」
      const r = ctx.react(s.keeper, { channels: intent.channels });
      s.inspected = intent.id;
      s.keeperAct = r.perception.action.act;
      s.phase = 'decide';
      (s.tries || (s.tries = [])).push({
        keeper: s.keeper, item: intent.item, act: s.keeperAct, stoppedAt: r.perception.stoppedAt,
      });
      return { r };
    },
    view(ctx) {
      const s = st(ctx) || {};
      return {
        keeper: s.keeper, phase: s.phase, inspected: s.inspected, keeperAct: s.keeperAct,
        ...(s.tries ? { tries: s.tries } : {}),
      };
    },
  };
}

export const WEICHENG_SCENES = {
  granary: {
    work: 'weicheng', beat: 'dusk', title: '暮色粮仓', place: '邯郸城内', lead: null,
    people: ['borrower'],
    goal: '账对不上。借粮者在桌前，桌上三样东西：印信、借条、担保物。',
    scene: '天快黑了，麻袋堆在墙角，守仓人的手一直按在账册上。',
    // 旧代码对粮仓不查闸门：选项在画面上是 allowed:true，choose 也不看 allowed（内核需要认可这个字段）
    gate: false,
    controllers: [['desk', { order: 100, inspect: GRANARY_ITEMS.inspect, decide: GRANARY_ITEMS.decide }]],
    wait: null,
    finish: 'after-first-rule',
    rules: [
      // 检验：把东西推过去，守仓人给个反应（旧 text = `${tell}。${name}${action}。`）
      { when: { intent: ['seal', 'note', 'pledge'] }, text: '{tell}。{name}{action}。' },
      // 决定：交给导演批，批没批决定最后那句话（旧三句，hide 不看导演）
      {
        when: { intent: ['report', 'witness', 'hide'] },
        then: [['work', 'weicheng', '@intent', { reuseOpen: true }]],
        text: {
          hide: '你把账合上。城里的说法和城外一样：存粮尚可支撑。',
          '*': {
            approve: '导演批了：{verdict.rule}。「邯郸存粮尚可支撑」成了曾经的共识。',
            refuse: '导演没批：{verdict.rule}。守仓人的说法挂着，推不动城外的共识。',
            default: '导演没批：{verdict.rule}。守仓人的说法挂着，推不动城外的共识。',
          },
        },
      },
    ],
  },
};

/** 对外一张表（与 qiefu.js 的 SCENES 同形） */
export const SCENES = WEICHENG_SCENES;

export const WEICHENG_CONTROLLERS = { desk };

