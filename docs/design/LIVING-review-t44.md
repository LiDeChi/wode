# t44 生活循环设计审查

范围：e57ef9e、6eb291e、b4f26e7、b1d54c6；只读检查实现，对照 `docs/design/LIVING.md:24`、`docs/research/agent-memory/DECISION.md:6`、`docs/KERNEL.md:223`。未运行仓库测试，本文不复述 §9 自查为已验证结果。

结论：已经能读到导演的整场等待选择、当次真实感知与原心智记忆；尚不能把“逐拍选择、演员做出后果、成长跨局留下”整条链交给呈现层直接使用。以下“必须修”是 t44 接缝问题；取符之夜的具体规则属于 t45（`docs/design/LIVING.md:149`、`docs/design/LIVING.md:150`）。

## 必须修

- **M1｜导演选择目前是每幕一次，学习后不会重新选。** `shared/life/plan.js:34` 确实读手艺并以 `freedom > lock` 选择等待；但 `shared/engine/play.js:495` 缓存键只有作品/beat 名单，`shared/engine/session.js:137` 一旦有 lifePolicy 就永久复用。未按逻辑拍或手艺版本提交，也没有逐拍反馈学习；当前 learn 仍在收束调用（`shared/engine/session.js:96`）。应给 opt-in 计划明确拍/版本与学习去重，缓存纳入导演和手艺版本；后果规则读取该拍决定。复验：同一导演经历真实偏差、手艺改变后，下一个设计决定可变且不重复学。依据 `docs/design/LIVING.md:34`、`docs/design/LIVING.md:40`。

- **M2｜读镜“他刚才为什么这么做”读错字段。** `shared/life/view.js:63` 读取 log 的 action/signature/seq，但实际日志只有 `{sig, stoppedAt, act, error}`（`shared/core/mind.js:123`）；所以 actors.last 的动作、签名和来源为空。trust 也用不存在的“门客（你）”/user 键（`shared/life/view.js:93`），实际如姬存 actor:player（`shared/data/seed.js:200`）。应从该人真实反应 seq 与 perceptions 读动作/来源，区分 stoppedAt 与 action.layer，并用正确玩家键。位置读取还漏了 world.places（`shared/life/view.js:92`、`shared/kernel/kernel.js:216`）。复验：如姬真实反应后，铜纽旁的身段、行动层、托付和 seq 都指向同一次记录。依据 `docs/design/LIVING.md:60`、`docs/design/LIVING.md:62`。

- **M3｜经历投影永远空，不能直接修成会写原记忆的召回。** `shared/life/view.js:113` 调 recall({limit:6})，没有人/场/关键词时三路都是空（`shared/core/memory.js:142`）；limit 不是 k。即便补筛选，返回也不含 person/key/activation/consolidation（`shared/core/memory.js:215`），且 recall 命中会写 lastAccess（`shared/core/memory.js:214`），违反纯读镜。应提供独立只读投影，按 actorId/sceneId/sig 映射真实条目并保留 seq，不让看扣片成为经历。复验：读前后 save 完全相同，经历扣片显示已有条目。依据 `docs/design/LIVING.md:56`、`docs/KERNEL.md:264`。

- **M4｜记忆算法有了，生活写入却没有给它成长材料。** `shared/life/life.js:79` 只写签名/人/场/seq/trace，未给 error、goalHit、first、moved、keywords、who；`shared/core/memory.js:46` 因而把 impact 算成 0，pending 不会达到巩固阈值（`shared/core/memory.js:124`）。这里只索引生活 dispatch 的感知，玩家动作/开场感知虽有 perceptions，也没有进入经历索引。新 pulse 的 sig 带 seq（`shared/kernel/kernel.js:519`），同类事不会累积在同一个原心智槽。应从真实感知计算重要度/检索字段，并把“事件唯一指针”与“同类心智签名”区分；同局与续局沿同类槽增长。复验：真实同类刺激第二次增加 trace/consolidation；单纯等待只衰减 activation。依据 `docs/research/agent-memory/DECISION.md:44`、`docs/design/LIVING.md:28`。

- **M5｜静态环境会被演员自己的账本序号不断唤醒。** pulseSignature 包含 last.reactSeq 与 lastAct.seq（`shared/kernel/kernel.js:117`、`shared/kernel/kernel.js:121`），每次生活 perceive 又改 world.last（`shared/kernel/kernel.js:323`）；下一次八拍检查便把同一处境当新 pulse，全体重感知，继续加经历。应把可观察处境变化与内部反应编号分开；真说话/递物可触发事件，只有“想过了”不触发环境重生。复验：固定灯、人、物且无输入，首轮后继续等二十秒不再增加同类经历。依据 `docs/design/LIVING.md:24`、`docs/KERNEL.md:250`。

- **M6｜actor.act 的可追溯后果链仍有断口。** 初次自动动作正确指向自己的反应（`shared/kernel/kernel.js:526`），但 eventRules 后果默认指向 reactSeq 而非 actSeq（`shared/kernel/kernel.js:538`）；环境 pulse 写下后没有设 ctx._lastSeq，环境规则的 claim/clock 等可能无 cause（`shared/kernel/kernel.js:504`）。下一拍排队虽携带 act cause（`shared/life/life.js:82`），kernel 又忽略它、只按 seenPulse 感知（`shared/kernel/kernel.js:515`、`shared/kernel/kernel.js:519`）；自己的动作不能可靠让附近人接续反应。应保留触发事件/实际行动 seq，后果挂真实执行动作，明确接收者与可见性；别让每个人都收到 ambient。复验：低问→守卫听见→守卫反应→拦人，每环有真实 cause，未听见者不反应。依据 `docs/design/LIVING.md:22`、`docs/design/LIVING.md:111`、`docs/design/LIVING.md:137`。

- **M7｜跨局隔离入口与续档边界没有闭合。** `shared/engine/session.js:30` 恢复 state 时遗漏 saved.episode；`shared/engine/play.js:143` 开 living 也未调用 beginEpisode，当前 shared 中只有方法定义（`shared/engine/session.js:106`）。所以通常入口 episodeScope 为 null，find 又查旧局全部主张（`shared/engine/play.js:218`）；续档即使曾显式开始也丢范围。应明确由谁开启/恢复段落并保存 episode；新段重置进度、输入去重和 ended，保留经验，恢复原段不重开。复验：存档恢复保留 ep 编号/范围；新段旧晋鄙下场不参与结局。依据 `docs/design/LIVING.md:101`、`docs/design/LIVING.md:103`、`docs/KERNEL.md:275`。

- **M8｜停顿观察缺原始来源，且会覆写手改纸条。** `shared/life/life.js:171` 把 cause 放进 input，但 observe 的 cause 是第二参数（`shared/agents/mentor.js:255`）；没有 user.pause，notes.pause 回指不了真实停顿。sinceTick 从全局 0 起、enter 不重置（`shared/life/life.js:37`、`shared/life/life.js:48`），显示的是绝对 tick 而非停留时长（`shared/agents/mentor.js:259`）；观察也直接 setNote，缺“你改的”保护。应记录所属场/起止拍的原始观察，再引用写轻墨，手改页不覆盖；逐场与持续停顿去重明确。复验：第 30 拍入场停 8 拍，纸边说“待了 8 秒”且能追到输入；暂停不计入。依据 `docs/design/LIVING.md:50`、`docs/design/LIVING.md:52`、`docs/design/LIVING.md:137`。

- **M9｜跨场输入在一次 advance 内仍让旧场继续走。** `shared/life/life.js:153` 先执行 next/begin 等，随后 runTick 却仍取原 sceneId（`shared/life/life.js:91`）；syncLifeScene 只在整段 advance 后调用（`shared/engine/play.js:558`）。同拍输入出现 end 也没有立即停止剩余输入，runTick 环境分支仍可执行（`shared/life/life.js:150`、`shared/life/life.js:158`、`shared/life/life.js:101`）。应在每个输入后同步场/终止状态，终止就清楚阻断后续队列。复验：一次推进含第 3 拍换场，与拆段推进产生同场事件；结束后无多余 pulse。依据 `docs/design/LIVING.md:135`。

- **M10｜演完的生活结果尚未接回可玩进度。** kernel event 的 end 只令 life.ended=true（`shared/life/life.js:86`），没有更新 act.done/outcome/choice；next 仍要求 act.done（`shared/engine/play.js:343`）。应接收自动完成结果、落作品与本幕进度，避免“演员做完了，玩家还卡在门口”；不要调用默认 signalOf 冒充“很快通过”（`shared/engine/play.js:271`）。复验：演员自行完成这幕后能进入下一幕，账本没有虚构 user.react。依据 `docs/design/LIVING.md:137`。

## 建议

- **S1｜t45 先做三件看得见的事。** ①如姬命中 risk 就向可听见的人低问，压力/信任可变但不自动递符；②命中 debt 且人在门边、真实托付/兵符所有权/独立 give 授予成立，才递一次；③守卫听到低问或看见移动后，命中既有拦人动作才要令牌/拦人。两个如姬动作已有定义（`shared/data/seed.js:191`、`shared/data/seed.js:192`），旧位置/递物状态可复用（`shared/scenes/qiefu.js:198`、`shared/scenes/qiefu.js:233`），但不能把旧 wait 无条件设 rujiReady 移植为时间动作。分别锁低托付问风险、高托付递一次、未进入视线不抓人。依据 `docs/design/LIVING.md:85`、`docs/design/LIVING.md:87`。

- **S2｜巡灯是三件行为的外部条件，不冒充演员手艺。** t45 声明仅 night 可自动生活，日程八拍推进灯/期限，等拍冻结机会；期限独立于 step，先示警，再按位置/移动/视线判断被看见（`shared/scenes/qiefu.js:251`、`shared/scenes/qiefu.js:256`、`shared/scenes/qiefu.js:258`）。但当前环境先用“没变化”早退、才跑规则（`shared/kernel/kernel.js:501`），日程可能被挡住；t44 应先提供可运行的环境日程入口或先处理到期事件再判断 pulse。当前计划对所有 scene.people 开 think 并统一显示近灯理由（`shared/life/plan.js:48`、`shared/life/plan.js:59`），应按场景候选能力选择，无生活声明的粮仓保留只读。依据 `docs/design/LIVING.md:83`、`docs/design/LIVING.md:87`。

- **S3｜自发动作需同时辨别“停层”和“选中动作层”。** 当前门槛是新 pulse、人物有效、stoppedAt==='unit'、人物/动词获授（`shared/kernel/kernel.js:515`、`shared/kernel/kernel.js:523`）；action.layer 是另一字段（`shared/core/mind.js:120`）。物件、位置、注意力、接受/抵触门槛仍应由 t45 规则明确检查，act 效果自身只验证授权（`shared/kernel/effects.js:104`）。建议暴露行动来源单元、被拒原因与收件人，不用一个“手动了”字段代替递物成功。依据 `docs/design/LIVING.md:113`、`docs/design/LIVING.md:135`。

- **S4｜成长装置能做一部分，应明示剩余接缝。** t46 可读 memory 的 trace/activation/consolidation、installed、stress 与真实 lifeTrace，先修 M2–M4 才能稳定连扣片；t47 可读 notes.value/source/seq、mentor chosen/spent/budget、导演 craft 和 learn.errors/before/after，读镜目前只投影 notes 与导演原因（`shared/life/view.js:147`、`shared/life/view.js:154`），宜补这些只读投影而不调用 dress；t48 可沿账本 cause 与当时 perceptions 手摇，须先修 M6/M7 才能解释分支而不串台（`shared/life/view.js:171`）。依据 `docs/design/LIVING.md:63`、`docs/design/LIVING.md:64`、`docs/design/LIVING.md:67`、`docs/design/LIVING.md:69`。

- **S5｜对外接口与文档示例需统一。** lifeRead(sceneId) 的参数传给 life.read，但它实际无参、只读当前场（`shared/engine/play.js:629`、`shared/life/life.js:193`）；§9 输入示例 args 是数组，而 runInput 读取 id/option（`docs/KERNEL.md:231`、`shared/engine/play.js:543`）。advance 实际返回 tick/scene/processed/reactions/outcomes/ended/paused/view，与文档 from/to/events 不同（`shared/life/life.js:176`、`docs/KERNEL.md:243`）。接三种 UI 前固定字面接口，防止“看别场”看成当前场。

## 不用改

- **N1｜“等不等”确实由导演手艺选择且呈现可读取。** 不是按姓名分支：freedom/lock/pace/tragedy 进入纯选择表（`shared/life/plan.js:36`），陆导/单导初始性情有差别（`shared/data/seed.js:416`、`shared/data/seed.js:434`）。life-design 写账并把 sourceSeq 放回设计（`shared/engine/session.js:140`），read.policy 有等待、间隔、授予、示警、揭示、原因和 sourceSeq（`shared/life/view.js:136`）。保留这条结构，修 M1 的拍/版本语义即可；无需把选择交给模型。依据 `docs/design/LIVING.md:36`、`docs/design/LIVING.md:38`。

- **N2｜未发现 LLM 或墙钟/非确定随机进入新增决策。** 新 life/plan/view/memory 与 kernel 事件路径只消费结构；seed 持久化后按 episode/scene/tick/actor/event 派生 makeRng（`shared/life/life.js:24`、`shared/life/life.js:41`），目前只传 RNG，未抽取来裁判。say 只是模板（`shared/life/view.js:13`），现有 speaker/narrate 在翻译路径（`shared/engine/narrate.js:120`）。保持“LLM 只翻译”的界限；浏览器前台计时仍由 t46 外部送逻辑拍，本审查不保证未检查的 UI 时钟实现。依据 `docs/research/agent-memory/DECISION.md:6`、`docs/research/agent-memory/DECISION.md:75`。

- **N3｜默认关闭、独立授予与真实 trace 的方向正确。** opts.living 才创建 life/mentor mind 和可选感知缓存（`shared/engine/play.js:143`、`shared/engine/play.js:153`）；读镜不调 watch/ask/perceive，kernel 当场留完整 trace（`shared/kernel/kernel.js:324`）；actor.act 的 from 是 actor 且基本链真实（`shared/kernel/kernel.js:526`）。保留旧 680 对照，不靠重录旧组掩盖增量问题；此次只做静态审查，未重新验证 digest。依据 `docs/design/LIVING.md:79`、`docs/design/LIVING.md:81`。
