# 《取符之夜》自主行动审计（t59 · 只读）

回答一个问题：设计里的「不等你」在《取符之夜》里能不能真的显形。全部结论来自当前 HEAD 的代码与公开入口实测（`createSession` / `session.meet` / `createPlay({living:'director'})` / `begin` / `next` / `choose` / `advance`）。未改仓库代码，未跑仓库测试。

## 0 一句话结论

能显形，但只在两个条件同时成立时：①导演是**单导**（`freedomBias > lockBias`，`shared/life/plan.js:41`）；②玩家**自己已经走到如姬门口**（`pos:3`）或**走进巡灯照到的格子**（`moved:true` 且 `nightLanternPos === pos`）。陆导在任何玩家可达状态都不会产生 `actor.act`，因为他的自主动词表只有 `think`（`shared/life/plan.js:51`），而闸门给每人只列了 `give/say/go`，`think` 同样过不去（`shared/scenes/qiefu.js:531-535`）。玩家一动不动时，两位导演都不会有自主动作——探针的旧档（pos0）量的正是这一档（`tools/living-probe.mjs:13-19`），而它 t58 加的门边档也把「陆导门边 0 条 / 单导门边 ≥1 条」写成了预期（`tools/living-probe.mjs:303-304`）。本审计用另一条门边路线独立复到同一结论（见 §2）。

## 1 一次 `actor.act` 的全部必要条件

每一条都必须同时成立；任一失败即无自主动作。

1. 生活开关：`shared/engine/play.js:143`（`living:'director'|true`，默认 `null`）；`:144` 生活存档；`:145` 打开心；`:160` 建 life。
2. 场景声明演员与动词：`shared/scenes/qiefu.js:512-515`（`actors:['ruji','guard_a','guard_b']`、`verbs:['give','say','go']`）。
3. 导演把该人该动词授予出去：`shared/life/plan.js:50-51`；内核逐条检查 `shared/kernel/kernel.js:136-141`，失败记 `refused='autonomy'`（`shared/kernel/kernel.js:613`）。
4. 这一拍他还没动过：`shared/kernel/kernel.js:614`（`world.actedTick[from] === tick` → `refused='already'`）。
5. 场景闸门放行：`shared/kernel/kernel.js:615` → `:541-550`（读 `policy.gate` 或 `scene.life.gate`，逐人逐动词；`.any` 是唯一或语义；`ctrl` 深匹配 `shared/kernel/rules.js:59`，`trust` 缺省 0.3 `shared/kernel/rules.js:58`）。
6. 位置与世界旗标到位：`shared/scenes/qiefu.js:179-201`（递符要 `pos:3` + `fuWithRuji`+`fuOwner:'ruji'`+`nightHand:null`；低问要 `pos:3`+`nightAsk:null`；甲拦人要 `moved:true` 且 `nightLanternPos === pos`；乙转头要 `pos:3`+`nightHeardB`）。旗标由场景/环境规则写：`shared/scenes/qiefu.js:586-589`（`life-own`，第 8 拍把半符放进如姬手里）。
7. 有一记**新**环境脉搏：非动作脉冲每个演员每记脉搏只感知一次（`shared/kernel/kernel.js:596-599`）；动作脉冲按 `world.seenActs` 去重（`shared/kernel/kernel.js:590-593`）。脉搏来自 `shared/life/life.js:163-172`（第 1 拍、每 8 拍、或日程到点 `force`）。
8. 他停在**单元**层：`shared/core/mind.js:116` 给出 `stoppedAt`，只有 `'unit'` 才可能动手（`shared/kernel/kernel.js:611`）。实测陆导那几拍三人全停在 `unit`，仍无一动作——所以第 3 条才是主闸。
9. 选中的正是闸门期望的那个动作：`shared/core/mind.js:120`（`action.act/verb/layer`）；如姬高托付要选中 `debt → give`（`shared/data/seed.js:187-200` 单元权重 + `shared/scenes/qiefu.js:522-529` 刺激）。
10. 动作真的落账：`shared/kernel/kernel.js:618-619`（`actor.act`，`cause:[r.reactSeq]`）、`:620`（`world.lastAct`）、`:621`（`actedTick`）。
11. 后果规则要看见 `acted:true` 且 `refused:null`：`shared/scenes/qiefu.js:609-637`；被判拒的动作不会触发未声明 `refused` 的规则（`shared/kernel/kernel.js:664`）。

因果链三段都可读，UI 讲「他为什么这么做」有据：环境脉冲 → 演员感知（`shared/kernel/kernel.js:601-607`，`:595` 记 `cause:[world.pulseSeq]`）→ 动作（`:619` 记 `cause:[react.seq]`）→ 收件人排队（`:634` `receiversOf`，`shared/life/life.js:140` 下一拍投递）→ 乙真的转头（实测 t3）。

## 2 真能长出自主动作的玩家可达状态

实测命令 `node /tmp/t59-verify-sol3.mjs`（公开入口，seed 3；高托付＝`义`+`折返`，低托付＝两次`再等等`；夜里动作＝`把令牌给乙`→`一口气冲两格`→`往前挪一格`）：

| 导演 | 托付 | 夜里动作 | 位置 | 自主动作 |
|---|---|---|---|---|
| 陆导 | 高 0.55 | 令牌给乙+冲两格+挪一格 | 3 卧内门口 | 无（`verbs:["think"]`） |
| 单导 | 高 0.55 | 同上 | 3 | `ruji give@t8`、`guard_a say@t24` |
| 单导 | 低 0.18 | 同上 | 3 | `ruji say@t2`、`guard_b go@t3`、`guard_a say@t24` |
| 单导 | 低 0.18 | 只到 令牌给乙+冲两格 | 2 中庭 | `guard_a say@t16` |
| 单导 | 高 0.55 | 不动 | 0 | 无 |
| 陆导 | 高 0.55 | 不动 | 0 | 无 |

最小复现两条，都不超过二十秒：

- **递符**：选放开的人做导演（`shared/engine/simulate.js:39-42`）→ 三问里选到高托付（0.55 ≥ 0.45）→ 夜里「把令牌给乙」「一口气冲两格」「往前挪一格」→ 之后不点，等到第一记更鼓（第 8 拍）如姬递符。位置与旗标见 `shared/scenes/qiefu.js:179-184`、`:586-589`。
- **甲拦人**（不用到门口）：单导 + 同样两下走到中庭 → 不点 → 第 16 拍巡灯照到中庭（`shared/scenes/qiefu.js:590-605` 的 `life-patrol-2`），同拍甲看见拦人。

上面两条与设计自己的探针互相印证：探针的门边路线是 `token_b`/`step`/`wait`/`step`/`step`（`tools/living-probe.mjs:46`），本审计用的是 `token_b`/`rush`/`step`，两条都停在 pos3 且 `seen=false`，结论一致。

**阻塞条件**：现在没有任何闸门能只靠时间、或靠玩家「不动」放行自主动作——如姬两条闸门都要求 `ctrl.nightwalk.pos === 3`，两条守卫闸门要求 `moved === true` 且灯照到玩家所在格。所以 `docs/design/LIVING.md:83` 的「玩家容易看见我没动她动了」只有在玩家已经把自己送到门边/灯下才成立；玩家若留在「宫门外」，这条体验链是闭合的。若希望「空等也显形」，需要场景作者补一条不依赖玩家位置的机会（例如巡灯经过门口时如姬听见更鼓而低问），这属于 `shared/scenes/**` 的配方决定，不在内核。

## 3 「陆导的等拍保持机会与期限」在代码里是什么

- `waitForPlayer` 只是**自主动词表的开关**：`shared/life/plan.js:41`（`autonomous = freedomBias > lockBias`）→ `:51`（不放开时 `verbs = ['think']`）→ `:56`。除展示外无人用它做分支：`shared/life/view.js:191`、`web/play/living.js:87-89`、`web/hub/records.js:72`、`web/film/filmstage.js:207`、`tools/living-probe.mjs:248`、`tests/living.test.js:456`、`tests/living.test.js:477`。
- 机会与期限来自**环境日程**，与等不等无关：`shared/scenes/qiefu.js:549-558`（8/16/24/32 四拍，32 拍 `end:'dawn'`）、`shared/life/life.js:163-172`（每 8 拍或日程到点派发）、环境自己的 `cadenceTicks`（`shared/life/plan.js:71`，缺省 `:22`）。所以陆导的「等」只等于「演员不自己动」，巡灯、更鼓、天亮照走；唯一能冻住期限的是暂停（`shared/life/life.js:215`，`docs/design/LIVING.md:151` 已写）。探针同样把这一点写成了预期：「两位导演在门边照样走同一份期限（灯/到期）」（`tools/living-probe.mjs:305`）。
- 建议在 `docs/design/LIVING.md:87` 那句之后补一句（只建议，本报告未改原文）：「等拍只锁演员的自主动词；巡灯、更鼓与天亮期限由 `environment.schedule` 照走，除非整场暂停。」另 `docs/design/LIVING.md:13` 的旧句「灯和期限仍靠玩家动作走」与现状（期限按拍走）已冲突，建议标明为改动前行为。

## 4 边界与未验证项

- 只读：没有改任何仓库文件（本报告本身是唯一新增），没有跑 `npm test`/仓库测试，也没有执行仓库工具 `tools/living-probe.mjs`（只读了它的契约与预期行）。
- 只用公开入口，没有伪造动作、没有改存档来制造 `actor.act`；实测脚本在 `/tmp/t59-verify-sol3.mjs`，不进仓库。
- 实测只跑了 seed 3 的一条公开路线；探针的门边档用 1/2/3/7/11 五个种子（`tools/living-probe.mjs:31`），本审计没有代跑。
- 未验证：粮仓场（第一版只读）；UI 是否真把上述引用画出来（本审计只核了字段读取点，未在浏览器里看）。
- 一处值得写进验收的观察（不是缺陷断言）：玩家不动、但灯照到他所在格时，甲也会拦人；这符合 `docs/design/LIVING.md:87`「看见条件仍检查位置、动作与视线」，但会让「不动＝安全」的直觉落空。
