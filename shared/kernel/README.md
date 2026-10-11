# 交互内核（shared/kernel/**）

契约在 `docs/KERNEL.md`。这里只讲怎么接、谁持有什么状态、以及照搬旧 `play.js` 时必须守住的那几处顺序。

## 接法

```js
import { createKernel } from '../kernel/kernel.js';
import CONTROLLERS from '../kernel/controllers/index.js';

const kernel = createKernel(session, { scenes, controllers: CONTROLLERS, store: session.state.play });
```

`store` 是内核状态放在哪。默认放 `session.state.kernel`；薄外壳传 `session.state.play`，这样
`world`（每场的控制器状态、最近一次反应、被谁看见了）随 session 一起存。
`root`（`{ days, flags, worlds, current }`）就挂在 store 下，天数与旗标是 play 级的，每场共享一个。

## 对外

| 名字 | 做什么 |
| --- | --- |
| `ALWAYS` | `['wait','watch','ask']`，不用导演授予 |
| `kernel.grants(sceneId)` | 这一幕导演授予了哪些动词、哪一档语言 |
| `kernel.allowed(sceneId, intent)` | 这个选项现在能不能做 |
| `kernel.enter(sceneId)` | 建控制器实例、跑 `init` 与入场感知（同一场第二次进不重来） |
| `kernel.intents(sceneId)` | 选项表，带 `allowed`；末尾自动补场景的 `wait` |
| `kernel.dispatch(sceneId, intentId)` | 做一件事，返回 `Outcome = { r, text, cost?, claims, choice?, end?, refused? }` |
| `kernel.watch(sceneId, person)` / `kernel.ask(sceneId, person)` | 看心思 / 追问，照旧文案 |
| `kernel.act(sceneId, intent, extra)` | 只在账本上记一笔 `user.act`，不产生反应（夜里走一格） |
| `kernel.perceive(sceneId, person, event, extra)` | 没有玩家动作的感知（开门时如姬自己心里转几转），只写 `actor.react` |
| `kernel.views(sceneId)` | 每个控制器自己那块的渲染数据 |
| `kernel.ctrlOf(sceneId, id)` | 控制器实例，调方法用 |

一次 `dispatch` 的顺序是：`before`（所有控制器）→ 认领这个选项的控制器 `apply` → `tick`（所有控制器）
→ 场景 `rules` 的第一条命中 → 它 `then` 里的效果 → 组 `Outcome`。
选项没人认领时：`watch`/`ask` 走内核那两条只读的路；带 `to` 的走 `react`；其余（例如 `wait`）留给规则。

## 规则能读的事实

`intent / person / name / voice / scene / work / accepted / backlash / stoppedAt / action / moved / tell /
flag.<k> / flags.<k> / trust.<person> / at / place / tile / days / seen / seenBy / seenReason /
ctrl.<控制器>.<键> / verdict.kind（approve|refuse）`。
`action` 可以写正则（例如 `/后门|中庭/`）。`then` 里的效果只有十种，见 `effects.js` 的 `EFFECTS`。
effect 的 cause 自动取这次反应的 `reactSeq`，没反应就取这次 `user.act` 的 `seq`；
要显式指定就写 `{ effect: [...], cause: [...] }`。

## 八个控制器各自持有什么

| 控制器 | 状态 | 它管什么 |
| --- | --- | --- |
| `speech` | `{ said: {intentId: 次数}, register }` | 台词与语言档位；档位只缩放 `appeal` 的分量 |
| `handover` | `{ items, used, given }` | 物品栏，一件东西只能出手一次；出手走哪条感知通道由它定 |
| `space` | `{ at, index, positions, visited, blocked }` | 格子、位置、阻挡（`ctrl.space.at` 给规则判） |
| `clock` | `{ step, limit, spent }`（另有 play 级 `days`） | 步数、上限、每步推进；`tick` 在规则之前跑 |
| `attention` | `{ looking: {人: 'on'\|'off'\|目标}, calls }` | 每个心智看向哪里、开还是关 |
| `standing` | `{ board, speakingFor, lastStanding }` | 信任榜；你替谁说话会改这次话的分量（`bar`） |
| `evidence` | `{ held, asserted, used }` | 收下哪些证据、拿哪条去 cite |
| `lens` | 不持状态 | 只读的看心思 / 追问，只负责把选项列出来 |

## 照搬旧实现时必须守住的顺序

- `react()` 里 `user.act` 与 `actor.react` 的 payload 字段名和顺序与旧 `reactOf` 一致，`trust` 效果与旧
  `setTrust` 一致，`claim` 效果与旧 `claim()` 一致（默认 `qiefu` / `门客（你）` / `亲历`）。账本 hash 对顺序敏感。
- 邺城：`standing` 的 `apply` 先 `setTrust` 再 `react`（旧实现里那笔 `actor.trust` 就在 `user.act` 前面）。
- 夷门：先 `react`，再 cite 主张，最后才是那份计划。
- 看心思在导演授予了动词但没含 `watch` 时抛 `导演这一幕没有授予「看心思」`；没对这个人做过事时
  `preview` 会先把 `look:scene:person` 那次感知撤掉（记忆与 log 都回滚）。
- `等待`这个选项如果要有账本记录，请让场景给它一个认领的控制器（各幕的旧写法不同），内核不替它猜。
