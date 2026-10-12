# 交互内核契约（第三阶段·给子代理）

所有场景底层是同一个五步循环：

> **玩家做一件事 → 变成一个事件 → 感知得到它的心智收到 → 心智自己算反应 → 反应改变世界**

说服和潜行只差两处：**谁收到事件**、**你想让心智怎么反应**。所以没有单独的“潜行系统”，守卫甲的灯就是他的注意力。

本文是模块之间的接口。签名和数据形状照写，不要改名、不要多包一层。总规则同 `docs/CONTRACT.md` 第 0 节（零依赖、ES 模块、`shared/` 里不得用 `fs`/`process`/`window`/`document`/`Math.random`/`Date`）。

---

## 0. 硬约束：抽内核不许改变行为

旧的 `shared/engine/play.js`（四幕 + 粮仓，每幕一个手写 resolver）已经用 680 个固定脚本录下对照组：`tests/fixtures/play-golden.json`，脚本在 `tests/fixtures/play-scripts.mjs`。

- 抽完之后 `tests/kernel-parity.test.js` 必须通过：**同一串选择，账本最后一条的 hash、账本条数、结局、天数、flags、每一幕的结果、日志、追问的回答一笔不差**。
- 账本 hash 对 `payload` 的**字段顺序**敏感（`JSON.stringify`）。所以 `user.act` / `actor.react` / `actor.trust` / `claim.*` 这几种记录的 payload 字段和顺序必须跟旧 `play.js` 里 `reactOf` / `setTrust` / `claim` 写出的一模一样；写账的**先后顺序**也一样（例：邺城先写 `actor.trust` 再写 `user.act`）。
- `shared/engine/play.js` 保留同名导出和同样的公共 API（`createPlay(session) → { begin, next, choose, watch, ask, chooseKeeper, view, grantsOf, state }`、`PLAYER`、`HOLDER`、`ACT_ORDER`、`EST_SECONDS`、`START_DAYS`、`KEEPERS`、`estimateSeconds`），变成内核之上的薄外壳。`view()` 的旧字段一个不少，只允许**新增** `controllers` 字段（见 §5）。
- 不许重录对照组。对照组变了，说明行为变了。

---

## 1. 文件与归属

| 路径 | 内容 | 写的人 |
|---|---|---|
| `shared/kernel/kernel.js` | `createKernel`：授予闸门、事件总线与感知、心智裁决 `react`、规则匹配、效果、记账 | kernel |
| `shared/kernel/effects.js` | 效果的封闭清单（§4） | kernel |
| `shared/kernel/rules.js` | `matchRule(when, facts)`、`firstRule(rules, facts)` | kernel |
| `shared/kernel/controllers/*.js` | 八个控制器（§3），每个文件一个，默认导出工厂 | kernel |
| `shared/scenes/qiefu.js`、`shared/scenes/weicheng.js` | 四幕与粮仓，写成数据（§2） | scenes |
| `shared/engine/play.js` | 薄外壳：舞台流转（intro→film→act→coda→granary→done）+ 调内核 | scenes |
| `shared/engine/simulate.js` | 模拟玩家与地板检查（§6） | sim |
| `web/play.html`、`web/play.js`、`web/play.css`、`web/widgets/*.js` | 可玩页面，一个控制器一个小部件 | ui |
| `tests/kernel-*.test.js`、`tests/stage3-*.test.js` | 测试 | qa |

`shared/core/*`、`shared/agents/*`、`shared/engine/session.js`、`shared/engine/works.js`、`shared/data/seed.js` 只读。

---

## 2. 场景 = 控制器组合 + 规则表（数据，不是代码）

```js
// shared/scenes/qiefu.js
export const SCENES = {
  daliang: {
    work: 'qiefu', beat: 'daliang', title, place, goal, scene, lead, people: [...],
    ambient: { kind, channels },            // 看心思时“他此刻面对的局面”
    gate: false,                            // 可选：这一场不受导演授权闸门约束（只有围城粮仓这么写）
    controllers: [                          // 顺序有意义：before 钩子和 tick 按这个顺序跑
      ['speech',   { lines: [ { id:'yi', to:'xinling', appeal:{义:0.8}, channels:{义:0.6,请求:0.3}, line:'…' }, …,
                              { id:'king', needs:['go'], to:'weiwang', appeal:{惧:0.7}, channels:{…}, line:'跟公子进宫，对魏王说…' } ] }],
      ['handover', { items: [ { id:'letter', to:'xinling', item:'赵使的竹简', appeal:{义:0.4}, channels:{…}, line:'…' } ] }],
      ['space',    { places: ['府中', '宫里'] }],   // 进宫这件事由 space 记位置；king 的动词仍是 say，needs go
      ['clock',    { key:'days' }],
      ['lens',     {}],
    ],
    wait: { id:'wait', to:'xinling', line:'不出声，看公子自己怎么办' },
    rules: [                                // 从上到下，第一条匹配的生效（等价于旧的 if/else 链）
      { when:{ intent:'king' }, then:[ ['claim',{subject:'魏王',…}], ['flag','kingSuspicious',true], ['clock',-3] ],
        text:'魏王的手指在案上停住。…', cost:'…' },
      { when:{ intent:'li' }, then:[ ['clock',-3], ['claim',{…}] ], text:'…', cost:'…' },
      { when:{ intent:['yi','letter'], accepted:true }, then:[ … ], text:{ letter:'…', yi:'…' }, cost:'…' },
      …
    ],
    finish: 'after-first-rule',             // 一次选择就收幕；取符之夜是 'on-end'（直到 end 效果）
  },
  yimen: { … }, night: { … }, ye: { … },
};
// shared/scenes/weicheng.js
export const SCENES = { granary: { … } };
```

选项的 id 必须和旧 `ACTS` 一致（对照组按 id 选）。选项在 `view().options` 里的顺序也和旧的一致。

`gate: false` 是给围城粮仓留的口子：这一场不受导演授权约束，内核的 `allowed()` 见到它就放行（意图的 `allowed` 与画面上的选项都恒为真）。原因是旧实现对粮仓从来不查闸门——旧 `view()` 对粮仓选项一律写 `allowed: true`，`granaryChoose` 也不看 `allowed`（A 组导演在暮色那一拍只授 `[say, watch]`，粮仓的「给」照样能做）。只有粮仓声明这个字段。

写规则表时有两处必须守住（都栽过，改场景的人请照做）：

1. **`when` 只能写这次意图本身或 `apply` 不会改的状态，别写 `apply` 会翻的字段。** 匹配发生在控制器 `apply` 之后：围城粮仓的 `desk.apply` 会在「检验」那一步就把 `phase` 从 `inspect` 翻成 `decide`，所以 `when:{ctrl:{desk:{phase:…}}}` 会让两条规则在同一次 dispatch 上都命中，`work` 效果在检验时也多跑一遍——账本多 7 条，680 个脚本里 582 个对不上。改成按意图写（`when:{intent:['seal','note','pledge']}` / `{intent:['report','witness','hide']}`）就归零。要看「事后状态」只能读 `facts` 里已经算好的字段（`accepted`、`backlash`、`verdict`、`tell`…）。
2. **每一幕自己的计数（`steps` 之类）不要放在各幕共用的那条路径上。** 旧实现只在取符之夜数 `a.steps`；把自增放进所有幕的公共分支，`state.play.acts.daliang` 也会长出 `steps` 字段——对照组不比它，但存档形状变了，`estimateSeconds()` 这类读数会跟着漂。

---

## 3. 控制器接口

每个控制器文件默认导出一个工厂：

```js
export default function speech(cfg) {
  return {
    id: 'speech',
    init(world) -> state,                    // 这一场开始时的状态（存进 world.ctrl[id]，随 session.save 走）
    intents(ctx) -> Intent[],                // 你此刻能做的事（粗粒度，2–4 个）
    before?(intent, ctx),                    // 任何意图执行前（站位在这里改信任，见邺城）
    apply?(intent, ctx) -> Reaction|null,    // 只处理自己 owns 的意图：变成事件、交给 ctx.react
    tick?(ctx),                              // 一步过去：钟走、灯走
    restore?(ctx),                           // 恢复存档时补装一次（幂等）；不写就与以前一字不差
    view(ctx) -> object,                     // 页面画这个控制器要的东西
  };
}
```

**`init` 与 `restore` 的分工**（读档回来时）：`init(ctx)` 只在「这一场第一次开门」时跑一次，返回值就是这一场的控制器状态，随 `session.save()` 一起走。读档时不重跑 `init`（那会把存档里的状态盖掉），而是对**当前这一场**的每个控制器调一次 `restore?.(ctx)`——给那些不能进存档的东西补装：把演员装进人物心智、把外部表接回来之类。规矩：`restore` 必须幂等（同一场在一个内核实例里最多调一次，反复读档也不叠加），**不写 `restore` 的控制器行为一字不变**。自查 `/tmp/t33-restore.mjs`：假控制器数 init/restore 调用次数（无存档 → 只有 `init`；读档 → 只有一次 `restore`，控制器状态没被盖掉）；真实路径 play.js 存档 → `createSession({saved})` → 第一步 `watch` 只走 `restore`、不重跑 `init`。

```js
Intent   = { id, verb:'say'|'give'|'go'|'wait'|'watch'|'ask', to?:personId, line, item?, appeal?, channels?, needs?:verb[], owner:controllerId }
Event    = { kind:verb, signature:`${sceneId}:${intentId}`, from:PLAYER, to?, at?, channels, appeal?, reliability? }
Reaction = { person, name, tell, perception, heard, accepted, backlash, userSeq, reactSeq }   // 只有 ctx.react 能造
```

| 控制器 | 拥有的状态 | 意图 → 事件 |
|---|---|---|
| `speech` 说话 | 台词、语言档位 | 诉求向量 → `hear` |
| `handover` 递物 | 物品栏（一件只能出手一次） | 物品 → `perceive` 的通道 |
| `space` 空间 | 格子/图、位置、阻挡 | 移动 → 附近能感知的心智收到 |
| `clock` 时钟 | 步数、剩几天、上限 | `tick` → 压力、期限 |
| `attention` 注意力 | 每个心智看向哪里（日程或心智自选）、开/关 | 决定一次感知检查发不发生 |
| `standing` 站位 | 信任、你替谁说话 | `before`：改变你的话落下来的分量 |
| `evidence` 证据 | 收集到的证据 | 请求推翻一个主张（导演批或不批） |
| `lens` 心智入口 | 只读 | 看（watch）与问（ask） |

`ctx` 提供：`session, ledger, claims, minds, scene, sceneId, world`（这一场共享：`flags`、`days`、`ctrl[id]` 各控制器状态、`last` 最近一次反应）`, react(person, opts), effect(effectSpec, cause), name(id), trustOf(id)`。

---

## 4. 内核

```js
// shared/kernel/kernel.js
export const ALWAYS = ['wait', 'watch', 'ask'];          // 等 / 看 / 问 不用导演授予
export function createKernel(session, { scenes, controllers }) -> {
  grants(sceneId) -> { verbs, level, why, language },      // = 旧 grantsOf，读 session.state.designs[work].beats
  allowed(sceneId, intent) -> boolean,                     // [verb, ...needs] 全在 grants 里（ALWAYS 除外）
  enter(sceneId) -> world,                                 // 建控制器实例、init 状态
  intents(sceneId) -> Intent[]（带 allowed）,
  dispatch(sceneId, intentId) -> Outcome,                  // before* → apply → tick* → 规则 → 效果 → 记账
  react(sceneId, intent, personId, { channels, appeal, bar }) -> Reaction,   // = 旧 reactOf，逐字段照搬
  watch(sceneId, personId), ask(sceneId, personId),        // = 旧 watch / ask
}
Outcome = { r:Reaction|null, text, cost?, claims:[claimId], choice?, end?:string, refused?:true, debug?:object }
```

**玩家看到的只有人话，读数走 `debug`。** `text`（以及 `watch()` 的 `preview.explain`、`ask()` 的 `answer`）里不出现「打动 0.72 ≥ 门槛 0.35」这类公式；同一件事的数字放在同一个结果的 `debug` 里：`dispatch` 的 `outcome.debug.depth`（细演档的读数）、`watch()` 的 `debug.watch`、`ask()` 的 `debug`（`accepted / moved / bar / stoppedAt / action / reason / goal / trust / stress / depth`）。`view()` 原样把它们带出去（play.js 的 `view()` 已经把 outcome/watch/ask 交给页面），调试面板与模拟玩家读 `debug`，玩家文字只读 `text`。`mind.hear()` 的 `reason` 与 `explainPerception()` 的 `explain` 也都是人话（不带数字）。

**心智是唯一的裁判。** 反应只在 `react` 里算（`mind.hear` 与 `mind.perceive`）。规则只读心智的输出，**永远不能直接设定反应**——否则“一种诉求说服所有人”会回来。

规则可读的事实（`facts`）：`intent`（id）、`person`、`accepted`、`backlash`、`stoppedAt`、`action`（字符串，`when.action` 可写正则）、`flag:{k:v}`、`trust:{person, gte|lt}`、`at`（位置）、`ctrl.<id>.<key>`（控制器状态）。

### 效果：封闭清单（`shared/kernel/effects.js`）

`['trust', person, value, why]` 设信任（写 `actor.trust`）· `['relay', from, to, amount, why]` 把信任转给别人 · `['flag', k, v]` · `['claim', spec, presentation?]` · `['clock', delta]` · `['move', person|'player', to]` · `['attention', person, 'on'|'off']` · `['work', workId, choice, opts?]`（调 `playWork`）· `['end', outcome]` · `['cite', claimId]`。

每个效果的 `cause` 由内核自动填：触发它的那次反应的 `reactSeq`；没有反应时用那次 `user.act` 的 seq。**新增效果种类要改契约，不许在场景里塞函数。**

---

## 5. 页面要的东西

`view()` 旧字段不变；新增 `controllers: [{ id, view }]`，按场景里控制器的顺序。页面按 id 找小部件：`web/widgets/<id>.js` 默认导出 `render(el, view, act)`，`act(intentId)` 回调把意图交回去。说话显示成台词，递物显示成桌上的东西，空间显示成格子，时钟显示成剩余天数/步数，注意力显示成灯和视线。页面上的文字只念 `text` / `answer`；数字读数的 `debug` 字段（见 §4）留给调试面板与模拟玩家，不往玩家眼前放。

---

## 6. 模拟玩家与地板检查（`shared/engine/simulate.js`）

只用 `createPlay` 的公共 API 和 `view().options`，所以任何新场景都自动被测到。

```js
export const PERSONAS = { curious, hasty, loyal, contrarian };   // 四种玩家：先看心思再动 / 直接动手 / 总选义 / 总选反着来
export function simulate(createSession, { answers, persona, seed }) -> { ending, seconds, path:[…], stuck:boolean }
export function floorChecks(createSession) -> { deadEnds:[], endings:{history,jinbi-lives,broken}, sameAppealWinsAll:boolean, seconds:{min,max}, ok }
```

地板：没有死路（任何时刻至少一个 allowed 选项）；三种结局都走得到；同一种诉求不能说服所有人；一局 8–12 分钟（`estimateSeconds`）。

---

## 7. 第二步：两个新组合，零内核改动

- **被偷听**（大梁）：`speech` + `attention`。你在大梁说的话，魏王的耳目可能听见，魏王对信陵君的猜忌上升。
- **押粮**（围城）：`space` + `clock` + `handover`。天黑之前把粮穿过城，不被饥民拦下。

这一步的验收：`git diff shared/kernel` 为空；新场景文件只有控制器清单加规则表；地板检查自动覆盖它们。

---

## 8. 每场档位（细演 / 普通 / 一笔带过）

导师按「一场」分算力：`shared/agents/mentor.js` 的 `allot()` 用 depth 与 centrality 加权定档，超预算时从最不中心的往下降，把结果记在 `mentor.allot` 里（**按 beat id 记**）。内核负责把档位真的演出来。

```js
// shared/kernel/depth.js
export const TIERS = ['细演', '普通', '一笔带过'];
export const TIER_COST = { 细演: 3, 普通: 2, 一笔带过: 1 };   // 档位即成本
export const DEFAULT_TIER = '普通';
export const ELIDED_NOTE = '这里被省略了';

// shared/engine/play.js
export function createPlay(session, opts)   // opts = { tiers, tierOf, budget }，都可选
p.tierOf('night') -> '细演'                 // 这一场演到哪一档
p.tiers() -> { night: '细演', … }           // 已经定下来的档位表（缓存在存档里）
```

`tiers` 可以是：函数 `(sceneId, scene) => 档位`；按场景 id 的表 `{ night: '细演' }`；按 beat 的表；按作品的表；或者字符串 `'mentor'`（读 `session.mentor.state().chosen`，那份表按 beat id 记，内核用 `scene.beat` 对上，如 `granary → 'dusk'`）。值认 `细演/普通/一笔带过`、`3/2/1`、`deep/normal/brief`。

**默认不传 `tiers`/`tierOf` 时每一场都是「普通」，并且不碰任何状态**：档位表不写、账本不写、`view()` 一个字段都不多。所以 680 个脚本的对照组不受影响（`node --test tests/kernel-parity.test.js` 2/2）。

三档只动三处文字——`dispatch()` 收尾、`watch()`、`ask()`；胜负规则一个字不改：

| 档位 | 演出来是什么 |
| --- | --- |
| 细演 | 反应之后多一句「他心里在盘算」：感知里哪几路先吃下（候选与权重）、他要的正是哪件事、`hear()` 的打动/反弹与信任前后、压力大时的急。追问时一并说出「他要的是什么」；看心思即使刚对他做过事，也再算一次真实拉扯。**没有真实状态可说时不编**（那就不加这一句）。 |
| 普通 | 与没有档位时逐字节相同。 |
| 一笔带过 | 旁白只留第一句，括号里的机制说明不再念出来，真删掉了才用「（这里被省略了）」标出来；`view()` 带 `elided: true` 与 `elidedNote`。追问只答一句。没删东西时不加标记（不骗人）。 |

算力：`budget` 非空时按 `TIER_COST` 记帐（内核的 `tierSpend()`），不够就从当前这场往下降档（细演→普通→一笔带过），**降到底照常演完，不抛错、不中断**——玩家只是看到「这里被省略了」。降档只改文字厚薄：680 个脚本 × 4 种档位来源（不传 / 细演 / 一笔带过 / `'mentor'`）逐一比对，结局、天数、旗标、每一幕的选择全一致；账本条数与其余内容一笔不差，只有 `user.ask` 那条的 `answer` 文字本身随档位变长变短。

自查（`/tmp/t27-depth-check.mjs`）：同一串选择分别用三档跑完一局，打印每幕字数与 `elided` 标记，结局相同。

---

## 9. 生活循环（持续生活：`living` 入口）

§1–§8 是「玩家做一件事 → 演一次」。这一节是同一套内核上的**持续生活**：玩家不动的时候，世界照逻辑拍走，演员自己看、自己想、自己动。全部是确定性结构，不调 LLM、不抽随机（唯一种子入口是调用方传进来并存下的 `seed`）。

### 入口：默认关闭，一字不变

```js
const play = createPlay(session, { living: 'director', seed: 'ep-1' });   // living: true 等价
play.advance({ toTick: 12, inputs: [{ id: 'i1', tick: 3, op: 'choose', args: ['a1'] }] });
play.lifeRead('daliang');        // 读镜（只读）
play.lifeTrace(seq);             // 当时那条感知片段
```

- 不传 `living`：`state.play` 里连 `life` 键都不建，`view()` 一个字段不多，返回对象不多一个方法，账本一笔不差（680 脚本 digest 与不传时相同：`530555aae5c4774a`）。
- 传了才多出：`advance`、`lifeEnter(sceneId)`、`lifeRead(sceneId)`、`lifeTrace(seq)`、`lifeRecall(query)`、`life`、`kernel()`；`view().life = { tick, scene, paused, ended, policy }`。
- 新增可枚举字段只有 `state.play.life`（`shared/engine/play.js` 的 `freshLifeState()`）与 `session.state.episode`。旧路径不写这两个键。

### 逻辑拍（`shared/life/life.js`）

- 一个整数逻辑拍 = 一秒；浏览器把前台秒数换成 `toTick` 传进来，**内核里没有帧循环**。
- `advance({toTick, inputs, paused}) -> {from,to,tick,scene,processed,reactions,outcomes,events,ended,end,paused,view}`；`events` 是 `outcomes` 的同一份投影。输入 `args` 可用数组、字符串或 `{id/person/option}`；每个输入后立刻同步新场，结束就停止旧场事件。`paused` 不推进；`ended` 只接受 `next/begin` 续场，不再演旧场。
- `tick` 是段内全局拍，`sceneTick` 入场归零；规则事实 `tick` 和日程 `at` 用本场拍。日程任意整数 `at` 到期即派环境事件，8/16/24/32 不是硬编码。未声明 `scene.life` 的场不派生活事件。
- 幂等：同一个 `input.id` 只跑一次（第二次记 `repeated:true`）；`toTick` 不大于当前拍则原地返回。**分两段推进到同一拍 = 一次推进**（digest 相同）。
- 子种子：`makeRng(\`${seed}/${episodeId}/${sceneId}/${tick}/${actorId}/${eventId}\`)`（`shared/core/rng.js`）；不需要抽签就不消费随机。禁 `Math.random` / `Date` / `window` / `document` / `fs` / `process`。

### 脉搏与自主（`shared/kernel/kernel.js` 的 `dispatchEvent`）

- `dispatchEvent(sceneId, event)`，`event = {id,tick,origin:'actor'|'environment',from,kind,channels,cause,policy}`。
- 环境签名只看天数、旗标、控制器、已知地点、可见动作与到期日程刻度，**不含内部 reactSeq**。没变且无到期事件 → `{silent:true}`；变化才落 `world.pulse`。环境后果的 cause 指向该 pulse，静候不会反复生经历。
- 演员每个 pulse 只看一次；真实接收事件另按 `actor:actSeq` 去重。自主动作须停在 unit、获 `autonomy.people/verbs` 独立授予、通过 `life.gate`、本拍未行动，才写 `actor.act`（cause 指自己的 react）。规则后果挂成功 act；事实 `acted/actSeq/refused/verb/unit/actionLayer` 区分想法与执行，refused 为 `autonomy/gate/already`。
- `life.receivers[from]` 可用 ID 数组或 `[{person,when}]`；未声明时只投给已知同地点的人（`world.places`、`ctrl.space.positions` 或 `life.positions`），未知位置不广播。已行动者的可听/可见收件人下拍先收动作、再普通巡查；链为 `actor.act → 收件人的 actor.react → 其 actor.act`。
- 演员的授予来自导演的 `policy.autonomy`（**独立授予，不借玩家的 `beat.grants`**）；两套授予内核分别检查。
- 规则：这类场景的规则表里多 `event` / `pulse` / `tick` / `policy` 四个事实；效果清单多一条 `['act', person, spec]`（写 `actor.act`，`verb` 默认 `'think'`，没授予则返回 `{refusedAct:true}`）。

### 导演的生活计划（`shared/life/plan.js`）

- `designLife({director, design, scenes, work, seed}) -> {policies, decisions}`；纯函数，不写状态，**按 work 逐个调用**。
- `policy = {beat,scene,work,waitForPlayer,cadenceTicks,autonomy:{people,verbs},warning:{ticks,why},historyReveal,environment:{cadenceTicks,kind,channels,schedule},stimulus,conditions,gate,why,version,decidedAt,directorId,sourceSeq}`。
- 场景的 `life.conditions:[{name,when}]` 选 `stimulus[person][name]`；直接通道或 `{when,channels,else}` 亦可。`gate[person][verb]:{when}` 或 `{any:[{when},…]}` 读同一份规则事实；父级 `verbs` 可进一步限动词。`plans.need` 与中文 label 仅说明，内核只读结构字段。
- 读 `stagecraft.taste(director).craft`：`freedomBias > lockBias` → 演员不等玩家（`autonomy.verbs` 加上该场声明的动词），否则只想不动；`节奏` 分档决定 `cadenceTicks`（2 / 3 / 4 拍）；`悲剧 > 0.6` → `historyReveal:'slow'`，否则 `'after-decision'`。
- 每拍评估：只对新真实 `user.react` 学习一次（`episode.learnedThrough`），导演/手艺版本进入计划缓存键。`commitLifeDesign` 只在决定内容改变时写 `director.life-design` 并钉 `sourceSeq/decidedAt`；同决定返回 `{committed:false}`，其余拍沿用该真实来源。

### 读镜（`shared/life/view.js`）

- `createLifeView({session,kernel,life}).read(sceneId)`：**只读**——不调 `play.view()`，不碰心智（不 `tick` / `perceive` / `hear`，也不调会写 `user.ask` 的 `ask`）。返回 `{scene,beat,work,tick,place,title,policy,actors,director,mentor,causes,experiences,watching}`。
- 每个片段带 `source / layer / object / reasonId / seq / at / path`：来源、层级、对象、原因 id、账本 seq 全在结构里。`say(rec)` 只是模板翻译层，改措辞不参与任何计算（以后可换 LLM 措辞）。
- `life.perception(seq)` / `lifeTrace(seq)` 取**当时**留下的 signature/action/actionLayer/actionFrom/cause/trace；`actors.last` 对齐真实 mind.log 的 sig/act，再匹配该人反应 seq；托付读 `actor:player`，位置也读 `world.places`。
- `experiences` 从 store 按 actorId/sceneId 作只读投影，含 `person/key/signature/seq/activation/consolidation/impact/depth`，不调用会改 lastAccess 的 recall。`lifeRecall({actorId,sceneId,keywords,k})` 是显式召回，补 person/key/activation；读镜重复调用 save 不变。
- 所有真实感知（包括玩家输入与开场）按 seq 去重索引，重要度来自 error/goalHit/first/moved；事件 seq 与同类签名分开，同类再次发生点亮同槽并更新最新 seq。导演投影含 craft/learned，导师含 notes/chosen/spent/budget。

### 导师心智（`shared/agents/mentor.js`）

- 只在启用持续生活的会话里 `enableMind()`（用已有 `STAFF.mentor` 定义），关掉入口就没有这个心智，存档里也没有 `mind` 键。
- 每段连续停留满 8 拍只记一次：先落 `user.pause:{scene,fromTick,toTick,ticks}`，再 `observe(input,[pauseSeq])` 写 `notes.pause`，纸条说停留时长；入场/真实输入/恢复前台重新计时，手改 `source:'你改的'` 不被观察覆盖。**不调 learn**，后台/暂停不算。

### 经验跨局留、历史不串台

- living 开局显式 `beginEpisode`；恢复保留原 `episode:{id,n,work,openSeq,from,to,inherit,claimIds,previous,learnedThrough}`，不重开。新段重置拍、sceneTick、输入去重、队列与 ended，记忆/心智/手艺继承；memoryOffset 让衰减时序跨段连续。
- `life.experiences` 是已索引反应 seq 的去重表，store 是记忆；`session.save()` 同步当前 store，二者与 perceptions/episode 一起续档。恢复入口兼容 `createSession(saved)` 与 `createSession({saved,speaker})`；前者直接接受 save 返回值或其 JSON 往返，恢复当前场/原拍/计划来源，不重提交。`node /tmp/t57-resume-sol3.mjs` 验四种形态续到第8拍与直走的 life/episode/完整账本一致。
- 自动 end 回接 `act.done/outcome`，已有 work 效果不重写；可 next，且不伪造 user.react。
- `find(subject,predicate)` 只在**本段**（`session.episodeScope().claimIds`）里找下场 / 结局 / 学习反应 → 上一局晋鄙的下场不参与新分支的结局计算。不开生活时 `episodeScope()` 为 null，行为与旧版逐字节相同。

### 记忆存储的字面契约（`shared/core/memory.js`）

供测试直接断言（`/tmp/t44-memory.mjs` 是参照实现）：

1. 导出 `createMemoryStore(opts)`、`MEMORY_DEFAULTS`、`sigOf(entry)`、`impactOf(entry)`。
2. 默认值全在 `MEMORY_DEFAULTS`：`{capacity:240, decay:0.99, consolidateAt:1.2, bucketSize:8, overFetch:4, throttleTicks:5, forgetRatio:0.3, keepRecent:15, exemptImpact:0.6, levels:2, weights:{relevance:3,importance:2,recency:0.5}}`。
3. `remember(entry) -> id`（字符串 `m1`、`m2`…）：同一个 `sig` 返回同一个 id，只把 activation 加亮 `+0.2`（上限 2）。
4. `sigOf`：`` `${kind}|${actorId}|${sceneId}|${seq ? 's' + seq : (关键词排序并集 || 't' + tick)}` `` —— **事实只在账本，记忆只留账本 seq 与派生量**。
5. `impactOf`：`clamp01(0.4*error + 0.3*goalHit + 0.2*first + 0.1*min(1,|moved|))`；显式传 `impact` 则优先。
6. `recall(query) -> [{id,seq,kind,tick,depth,impact,score:{relevance,importance,recency,rrf,total}}]`：三路（actor / scene / keyword）各自排名 → RRF `Σ 1/(rank+1)` → **先归一再加权 3 : 2 : 0.5**；所有分数 `round3`；同输入同输出。命中即更新 `lastAccess`，按 `throttleTicks` 节流。
7. `consolidate({toTick}) -> [entry]`：`pending >= consolidateAt` 且原始条目 ≥ `bucketSize` 才做；产出 `depth+1`，`sig` 为 `sum1:<ids>`（再上一层 `sum2:<ids>`）；关键词 / who 取并集、impact 取最大、seq 取最新，被用过的条目置 `bucketed`。
8. `forget({toTick}) -> {dropped:[id],kept:n}`：`expires` 过期（明确指令，**不受豁免**）+ 冷掉（`activation <= 0` 且 `impact < exemptImpact`）+ 容量淘汰（`impact >= exemptImpact` 豁免、最近 `keepRecent` 条永远留、一次最多丢 `forgetRatio`）。
9. `tick({toTick})` 只推进时序（activation 每拍 −0.15、`now`），**不巩固不遗忘**；`save() / restore(saved)` 是纯 JSON（`{v,nextId,now,pending,entries,cfg}`），`restore` 整体替换；存档里没有账本事实（不出现 `line` / `appeal` / `said`）。

### 自查

- `/tmp/t44-parity.mjs`：680 个脚本结果的 digest，工作树与 HEAD 相同（默认关闭生活 → 行为逐字段不变）。
- `/tmp/t44-life.mjs`：两段 = 一次、输入幂等、纯读零写、关入口等二十秒 = 没等、同种子同结果、没新刺激不伪造经历、授予允许时演员自己动（`cause` 指向他自己的反应）、经历跨局留而旧局下场不串台。
- `/tmp/t44-memory.mjs`：上面 9 条字面契约逐条断言。
- t52 当前复验：`node /tmp/t52-sol3.mjs` 覆盖 M1–M10/S2/S5；`node /tmp/t52-night-sol3.mjs` 只走公共 advance，验一次递符、有限听见的非空原因链、等拍与宫门外零行动、8/16/24/32 巡灯及自动 next；`node /tmp/t52-parity-sol3.mjs` 得到 680 / `530555aae5c4774a`。这些是临时最小脚本，未跑仓库测试。
