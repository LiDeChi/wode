# 让角色活起来：持续交互、经验与历史

> 产品设计交付，尚未实现。让玩家看到人正在理解处境、照自己的心意做事，并在下次见面时认出他的成长。
> 本轮只写设计，不改程序、不运行仓库测试。普通界面只用人话和实物机关；字段名、读数、种子和因果编号仅在 `?dev=1` 展示。

## 1. 今天卡在哪里，第一版要通到哪里

演员住在战国现场，导演住在设计工作区，导师住在需求笔记和资源账里。玩家通过导演做出的呈现见到他们，不打开管理报表。依据：`docs/数字世界 设计总稿 v3（草案） (2).md:85`、`docs/数字世界 设计总稿 v3（草案） (2).md:313`、`docs/数字世界 设计总稿 v3（草案） (2).md:463`。

代码已核实：

- 心智有性情、目标、信任、压力，以及记忆的痕迹、激活、巩固；`perceive` 返回完整三层经过，当前日志只存摘要（`shared/core/mind.js:31`、`shared/core/mind.js:64`、`shared/core/mind.js:123`）。
- 演员并非完全没有开场反应：取符之夜如姬已自己感知一次，决定是否犹豫。**以下说法只描述开放生活层（opt-in `living:'director'`）之前的旧行为，不是现状**：那时灯和期限都靠玩家动作走，每次输入才走一步、换灯位，走到第 12 步才判天快亮（`shared/scenes/qiefu.js:275`、`shared/scenes/qiefu.js:283`）；内核自己也没有时钟，只在自己的动作路径上叫控制器的 `tick`（`shared/kernel/kernel.js:436`）。开了生活层以后期限怎么走，见 §6 的「期限怎么走（现状记录）」。
- 导演已有心智，主要用来设想玩家；设计与学习由会话调用。导师设定有单元，却尚未实例化三层心智，当前按笔记规则工作（`shared/agents/director.js:43`、`shared/agents/director.js:137`、`shared/agents/mentor.js:50`、`shared/data/seed.js:396`）。
- 每幕结束才把玩家反应交给导师，作品收束才让导演对照预测；纯粹不动不会产生这些信号（`shared/engine/play.js:220`、`shared/engine/session.js:76`、`shared/engine/session.js:83`）。
- 可玩页每次新建会话；电影只记操作；戏台依据上次电影的开场口味重新问导师，尚非持续生活（`web/play/main.js:387`、`web/film/format.js:1`、`web/hub/hub.js:23`）。

第一版补三条线：场内持续生活；成长留在同一个世界；导演把心智怎样影响历史演给玩家看。装置是状态的出口，摇头、翻页、加刻痕都必须有来处。

## 2. 演员：在自己的处境里生活

**环境。** 只看到所在场景的人、物、声响和别人告诉他的事；不能偷看导演草稿或全局结局。主张可得视图已有依据（`shared/core/claims.js:165`），位置、注意力决定谁收到新事件。

**循环。** 每两秒检查环境是否真的变了；灯移近、有人说话、手中物换了，才形成新感知。性情决定哪一路吃得多，目标加权，压力催促就地处理，未消化的部分往上递。先用身段露出结果，再由导演授予范围内的动词产生后果；没有新刺激就保持姿态，并按逻辑时间衰减记忆的激活，不伪造新经历。依据：`shared/core/mind.js:81`、`shared/core/mind.js:109`、`shared/core/mind.js:136`。

**节奏与他人。** 身段平滑变化，心智两秒一拍，重要变故立即入队。听人说话会改变信任与压力（`shared/core/mind.js:145`）；行动让附近的人感知，后者再反应。导演决定能做什么、何时推进、照亮什么；导师给这一场的档位，决定解释与表现的细密程度，不能替演员决定相信谁。

**经验。** 真正经历一次，同类事件 `memory[signature].trace` 和 `consolidation` 留下变化；`activation` 会淡去，不承诺所有指标只升不降。`installed` 表示已装上的新办法，没有安装记录就不演成“学会新手艺”（`shared/core/mind.js:128`、`shared/core/mind.js:184`）。

## 3. 导演：安排世界的节奏，自己也修正判断

**环境。** 需求、每场资源、设计稿、可用场景、预测牌、玩家真实反应和演员演出的结果。现有字段是 `session.state.designs / predictions`、导演 `craft()` 与 `state().mind.others`（`shared/engine/session.js:59`、`shared/agents/director.js:245`）。

**循环。** 每场前感知任务，设想玩家，给动词和预先段落；每一拍收集反馈，对照自己的判断；场后修正手艺，再安排下一场。现有 `learn` 的误差会改 `paceBias / tragedyBias`，其余手艺不能假装随之变化（`shared/agents/director.js:176`）。新增逐拍调用须去重，作品收束不得对同一反应再学习一遍。

**世界等不等你，是他的设计选择。** 每场、每拍新增设计项 `lifePolicy`：`waitForPlayer / cadenceTicks / autonomy`（哪些演员、哪些动词）、`warning / historyReveal / why / sourceSeq`。允许“等你但人仍在思考”，也允许“不等你，有人自己递符”；开技术能力不等于所有场都不停走。`autonomy` 是导演给演员的独立授予，不借用玩家的 `beat.grants`：如姬可以说给守卫或递符，并不代表玩家能自由说话。两种授予都由内核分别检查。

**性情必须进入选择。** 采用现有 `craft.lockBias / freedomBias / paceBias`，以及 `stagecraft.taste(d).craft.节奏`；口味表已有静止留白和贴近人物的区别（`shared/agents/stagecraft.js:15`、`shared/agents/stagecraft.js:121`）。新增确定性选择表：允许自发行动的拍，`freedomBias > lockBias` 倾向不等，反之等；节奏决定推进间隔，悲剧偏好决定如何揭示代价，而非强制悲剧结局。

陆导在如姬门口保留等待，先让犹豫被看见；单导放开的是「递符」这类自主动作——谁能在自己的拍上主动动身（`shared/life/plan.js:41`、`shared/life/plan.js:51`）；巡灯与天亮不随导演变，两位导演照同一份场景日程走（见 §6 的「期限怎么走（现状记录）」；期限归谁仍待用户裁决）。两人的初始性情支持这个差别（`shared/data/seed.js:415`、`shared/data/seed.js:433`）。学习后按更新的手艺重新选择，不能按导演姓名写死。决定写入新增 `director.life-design`，挂到该场 `director.design`；片场案上看到“我留给你等她”或“她会自己动身”。

**互相影响。** 演员的真实反应让导演知道安排有没有成立；玩家的实际信号让他学会放慢或加快；结果交给导师作为观察材料，导演不得直接改导师笔记或预算（`shared/agents/mentor.js:225`）。档位低时省略表现，不越过授予闸门。

## 4. 导师：一边看你，一边管下一场

**环境。** 需求笔记、你亲手改的偏好、见面与停顿记录、资源账、导演交付。现有状态为 `notes / chosen / spent / budget / director`（`shared/agents/mentor.js:240`）；分配按 `depth` 与场景中心程度计算（`shared/agents/mentor.js:114`）。

**循环。** 每次见面收需求；已确认的追问、重玩、通过按现有规则学习；玩家停顿时看一眼，写“你在这里待了一会儿”这条观察。新增导师心智只在启用持续生活的会话内实例化，用已有 `STAFF.mentor` 定义处理这些输入；输出仍经过笔记、分配和权限边界。

**节奏。** 见面立即运行；场中停留八秒后记录一次，持续停留不重复写；场结束再分配下一场。后台标签页、暂停、等待资源加载不算玩家兴趣。现有 `learn('停顿')` 返回空，不能伪装成已有学习；新增观察单列 `notes.pause`，保留来源，不凭停留就断言“你爱深层人心”（`shared/agents/mentor.js:200`）。

**互相影响。** 你的笔记 → 导师给每场档位 → 导演设计 → 演员表现 → 你追问或重玩 → 导师更新了解。你亲手改过的条目继续禁止观察覆盖（`shared/agents/mentor.js:101`、`shared/agents/mentor.js:209`）。灯油是分配账的呈现：现有 `spent` 是分配量而非实时调用消耗，不宣传已有真算力计费。

## 5. 看得见清单：每个动作都要能回指状态

下表“新增”是实现契约，不是已存在字段；没有来源时装置保持静止或说“还没发生”。只读镜头可用临时缓存，不写会话、心智或账本。

| 人与入口 | 实物机关与玩家能看懂的变化 | 真实读取与界限 |
| --- | --- | --- |
| 演员／`web/play.html` | 皱眉、停手、视线转向眼前的人；低声话从对应动作模板取 | `world.last.person / action / stoppedAt / reason`、`minds[id].state.stress / trust`、`def.goals`；摘要在 `shared/kernel/kernel.js:246`。无对话事件不能让两人交换新情报；中性呼吸不算心智证据。 |
| 演员／看铜纽 | 人身旁展开三层铜槽，水先过小槽，再过合槽，最后落入心池；留下吸收量和余流 | 本次 `perception.trace[].layer / took / left` 与 `stoppedAt`；三层全程各有槽，不把每个单元的累计 `left` 相加。来源：`shared/core/mind.js:92`、`shared/core/mind.js:103`、`shared/core/mind.js:107`。 |
| 演员／看铜纽的证据 | 一股水显示“刚才发生的”，另一股标“若此刻问他”；选中的行动另有小闸门 | `stoppedAt` 与 `action.layer` 不是同一字段；现有 `watch().preview.trace` 是撤回写入的设想，不能称刚才经历（`shared/kernel/kernel.js:442`）。真实完整 trace 需新增 opt-in `state.play.life.perceptions`，按反应 seq 保存。 |
| 演员／身上与随身物 | 经历扣片多一道刻痕；记忆槽越熟越深，亮度随记忆淡去；新手艺扣片装上才出现 | `state.memory[sig].trace / consolidation / activation`、`state.installed[].id`、新增经历索引中的来源 seq；扣片是经历的呈现，不自动增加物品栏或权力。 |
| 导演／片场角落的案（play／hub） | 预测牌在左，真实反应木签落右，猜错才添批注；厚手稿留着以前的批注 | `state.predictions[work].list[].expect`、账本 `user.react.payload.signal / beat`、`director.learn.payload.errors / craft.before / craft.after`（`shared/agents/director.js:206`）；只有产生 learn 才能“学一笔”。 |
| 导演／案上节奏机关 | 栓住的沙漏表示等你，松开的漏斗表示世界继续；留谁会做什么的短句 | 新增设计 `lifePolicy` 与 `director.life-design.payload`；灯光口味只读 `taste().look.light / framing`，资产单读已有 `director.dress`，不能为看一眼调用会写账的 `dress`（`shared/agents/director.js:226`）。 |
| 导师／`web/hub.html` 台边笔记 | 真有新了解才添一页；手改内容留压条，观察内容用轻墨；点纸边读因为什么 | `mentor.state().notes[field].value / source / seq` 和该 seq 的 `mentor.note / mentor.learn`；页厚来自相关账本记录，`mentor.learn.payload.before / after` 是成长证据。 |
| 导师／台边资源案 | 每场各一盏蜡烛，灯芯粗细显示细密程度；已分配灯油与未分配油壶分开 | `chosen[beat] / spent / budget`；实际降档读 `play.tiers()` 与 kernel 的 `tierSpend()`（`shared/kernel/kernel.js:63`、`docs/KERNEL.md:199`）。普通火焰摇动只表示火，不表示在学习。 |
| 三人／`web/film.html` 放映厅 | 手摇回放还原动作、感知、批注与后果，经历扣片随当时状态出现 | 新录制中的初始存档、设计、逻辑拍、反应 seq；旧 v1 仅 `steps`（`web/film/format.js:24`），保留原放映语义。播放不得增加当今角色的记忆。 |
| 三人／`web/lab.html` 推演机 | 拉同一根操纵杆，只换一个人的性情；水的落层、人偶动作、史简岔路一起变 | 同初始快照与种子下的 `perception`、反应记录、结局、主张状态。当前各次新建会话（`web/lab/runner.js:9`），新增试验须连时间脚本一起锁住；观察不得污染主世界。 |

不用网页卡片、柱状报表或数值仪表代替机关。上次经验和这次经验叠在同一件实物上，数字只藏在开发读数里。本次灯油设计按任务的新要求执行，替代总稿旧有“不做灯油装置”的取向（`docs/数字世界 设计总稿 v3（草案） (2).md:146`）。

## 6. 后果边界与首场选择

**只读呈现。** 从已存在状态推身段、灯芯、页厚和因果线。需要演算“他现在会怎样”时，复制完整心智再 `perceive`，注明设想；不对原心智调用 `tick / perceive / hear`，不调用会写 `user.ask` 的 `ask`。当前 `watch` 会登记观察，不能每帧自动调用（`shared/kernel/kernel.js:427`、`shared/kernel/kernel.js:489`）。既有玩家点看／问路径照旧。

**有后果的生活。** 时间衰减、真实感知、NPC 说给别人听、移动、递物、导演学习、导师添笔记，都改变可保存状态，必须走有记录的事件。不用动画偷偷改位置或信任，也不把自动动作冒充 `user.act`。

技术入口建议 `createPlay(session, { living: 'director' })`；不传或传 `false` 完全走旧路径，不创建 life 状态、不记新事件、不改旧 view 形状、不多算一次心智。传 `'director'` 只允许读取导演每拍的 `lifePolicy`；缺设计项按“等你、无自动后果”。同一个已启用会话各场可以不同。

旧的 680 个脚本继续锁原行为、字段顺序与写账顺序；不得重录 `tests/fixtures/play-mechanics-v2-golden.json`，保留 `tests/kernel-parity.test.js` 对照。依据：`docs/KERNEL.md:13`。新增 opt-in 字段与事件是下一阶段契约增量，不在抽内核阶段悄悄破例。

**第一版只开取符之夜一场。** 它有如姬的恩与怕、真实托付、巡灯和截止时机，能回指心智与场景状态，玩家容易看见“我没动，她动了”。粮仓第一版只读呈现，先不让借粮者擅自拿粮，以免引入尚未定义的所有权后果。

单导的不等拍：每两秒检查一次，巡灯每八秒推进一次（日程来自场景，两位导演相同）；光声变化后，如姬重新感知。选中现有 `risk` 动作就低问，选中 `debt` 动作且位置与授予允许才递符；一拍最多一次递物，已递不再递。不因经过八秒就硬设 `rujiReady`，不把玩家空等套成旧 `choose('wait')`。

守卫遇到演员动作才感知，选中拦人动作才拦；巡灯由导演环境日程推进，不谎称已有“巡逻”心智单元。启用设计中期限随新增时间事件推进，期限与动作步数分账；看见条件仍检查位置、动作与视线，不能仅凭时间宣告被抓。陆导的等拍只锁演员的自主行动，期限照走（归谁待用户裁决，见「期限怎么走（现状记录）」），身段仍显心中拉扯。提前由更鼓、近灯和如姬低问示警。

**期限怎么走（现状记录）**

- **拍是绝对拍**：一个整数逻辑拍就是前台一秒，前台按秒把 `toTick` 递进来，内核里没有帧循环（`docs/KERNEL.md:242`、本文 §9、`web/play/main.js:568-580`）；玩家点一下也走同一根拍（`web/play/main.js:138-146`）。
- **巡灯和天亮按绝对拍走，两位导演一样**：灯位与到期写在场景日程里——第 8/16/24/32 拍，第 32 拍 `end:'dawn'`（`shared/scenes/qiefu.js:549-558`）；导演计划把这段日程原样抄进来（`shared/life/plan.js:75`），生活循环到拍就派发，不等人开口（`shared/life/life.js:163-171`、`shared/life/plan.js:22`）。探针与 t59 审计两份独立测量读到的都是同一份 8/16/24/32 与同一个天亮收场（`tools/living-probe.mjs:305`、`docs/design/LIVING-autonomy-audit.md:52`）。
- **导演手里的选择只作用在「谁能在自己的拍上主动动身」**：`waitForPlayer` 由手艺推出（`shared/life/plan.js:41`、`shared/life/plan.js:56`），它拉开的是自主动词表（`shared/life/plan.js:51`）；期限不在这份选择里。陆导的「等」是演员不自己动身，灯、更鼓与天亮照走。

**待用户裁决（本文未决定）**：期限要不要也交给导演？两种走向并列如下——甲：期限也归导演（等你的时候机会不流走、天亮照来）；乙：期限继续归剧本，两位导演一样（即现状）。这个问题还没定，本文只记录现状，不代表已决定，也不写成已完成。

新对照组建议 `tests/fixtures/living-v1-golden.json`：锁初始存档、导演逐拍决定、种子、含空等的输入脚本、NPC 动作、记忆变化、结局与账本。需要新组是因为“同样点击，不同等待”现在是不同输入，记忆与后果也可能不同；新组补充旧组，不能替换旧组。

## 7. 经验跨局留下，历史不能串台

当前 `session.save()` 已含 `ledger / claims / mentor / directors / minds`，并可加载（`shared/engine/session.js:23`、`shared/engine/session.js:116`）。缺的是产品持久化和新一场的边界。

| 要保留什么 | 保存与呈现规则 |
| --- | --- |
| 演员性情与手艺 | 基础 `def` 保持设定版本引用；`minds[id].installed` 独立留安装来源。不能把经历扣片当成新单元。 |
| 演员经历 | 保留 `minds[id].memory / log / trust / stress / others`、账本和主张图；新增经历索引仅指账本 seq，不复制一套事实。水槽深度、刻痕读原字段。 |
| 导演成长 | 每位导演各保留 `directors[id].craft / mind` 与 `director.learn` 历史；换导演不偷拿另一位手艺。手稿只因真实批注变厚。 |
| 导师成长 | 保留 `mentor.notes / chosen / spent / budget` 和相关记录；新增 mentor mind 仅在启用存档保存。手改和观察来源不能丢。 |
| 一局中的过程 | opt-in `state.play.life` 保存逻辑拍、设计版本、已处理输入、真实感知 trace 与去重标记；续场恢复原拍，不重跑开场，不凭开页面增加经历。 |

同世界“继续下一段”沿用会话与经验，以新 episode 进度开始，不重新 `meet` 清掉学习；见面只补新回答，已有手改条目保留。“重演这一段”复制当时快照成独立分支；“重新开一个世界”才从头开始。新增 episode 索引记录开场 seq、继承主张 id 与本段产出的 id；寻找下场、结局、学习反应时按本段及明确继承项取，不能沿用目前按作品收集所有反应的范围（`shared/engine/session.js:87`）。旧局晋鄙的下场不得参与新分支结局计算，经历不替另一条历史提供凭空证据。

第二次到访：保存后回戏台，导师仍记得那次追问，导演旧批注还在，演员同类记忆仍有更深巩固；继续同世界遇到同类事能更熟悉。重演比较分支差异，不把测试结局写回主世界。后台与关页期间不补几十次循环；时钟只在前台且未暂停时走。

## 8. 导演把“心智让历史拐弯”做成呈现

结局竹简旁加一台牵线机：从那个人的铜槽牵出绳，绕过行动与兵符实物，再落到史简分叉。导演按新增 `historyReveal` 决定何时展开：陆导在结局慢慢拉开，单导在决定后先露一段；推演机可手摇逐环核对。同一事实链换节奏，不能换事实。

真实链先读 `actor.react.payload.stoppedAt / action / accepted / backlash / reason`，再沿账本 `cause` 找 `actor.trust`、`claim.add`、`claim.overturn` 与作品结果；新增真实感知缓存补全 `trace`。只连存在的因果边，若旧记录缺边，显示“这一段尚不能还原”，不由旁白补故事。

区分两个机制：水停哪里决定动作倾向，话能否打动还由诉求、抵触、信任和门槛决定（`shared/core/mind.js:116`、`shared/core/mind.js:145`）。晋鄙活不活同时受兵符与接受结果影响（`shared/scenes/qiefu.js:539`、`shared/engine/play.js:375`）；不能把最高层水槽画成唯一结局开关。

可复验三条岔路：兵符出宫且晋鄙接受交割 → `jinbi-lives`；出宫但未说服 → `history`；未出宫 → `broken`。分别显“印绶放下”“铁椎落下”“援军未至”，读 `state.play.ending / coda.fate / coda.end`，标清史料与本作可能。

共识机关：原竹简保留，新简沿旁边走；只有 `claims[].status === 'former'` 且有 `overturnedBy`、`claim.overturn.payload.explanation / affected` 才松旧绳。拒绝则读 `claim.overturn-refused.payload.missing`，原绳仍扣住；`disputed` 显并存，不宣布推翻（`shared/core/claims.js:123`、`shared/core/claims.js:158`）。玩家说“晋鄙没死”的一条主张不等于世界已经认同。

## 9. 接口草案：生活负责节奏，内核继续裁判

新增 `shared/life/`，将时钟、逐拍计划、读镜与成长投影放在这层；不把浏览器帧循环塞入 kernel 的动作 `tick`。有后果事件经内核新入口复用感知、规则、封闭效果与审计；以下均为拟新增 API：

```js
export function designLife({ director, design, scenes, seed }) // -> { policies, decisions }
export function createLifeView({ session, play })             // -> { read(sceneId), trace(seq) }
export function createLife({ session, kernel, plan, seed, saved })
// -> { advance({ toTick, inputs }), read(), save() }
// inputs: [{ id, tick, op, args }]; advance -> { processed, reactions, outcomes, view }
export function dispatchEvent(sceneId, event)                 // kernel 新入口 -> Outcome
// event: { id, tick, origin:'actor'|'environment', from, kind, channels, cause, policySeq }
```

`designLife` 与读镜不写原状态；返回 decisions 由已启用会话统一提交一次 `director.life-design`。读镜返回身段、记忆装置、导演案、导师笔记、因果片段，每片段带开发可读字段路径与 seq；不得内部调用 `play.view()` 去首次入场或自动询问。

`advance` 以一秒一个整数逻辑拍运行，浏览器在外部将前台秒数转 `toTick`，Node 直接喂脚本。重复 `toTick` 与输入 id 幂等；同拍先处理玩家输入，再按场景声明顺序处理环境和演员，动作受位置、物件、注意力与授予限制。一旦结束，不再执行排队动作。

真实循环记 `world.pulse → actor.react → actor.act → claim.*` 的 cause；自动动作 from 必须是演员。无玩家动作也能演完时，不伪造“很快通过”的用户信号。停顿另记 `user.pause` 原始观察和所属拍；导演学习、导师观察各回指真实输入并去重。

唯一种子入口为调用者传入并保存的 `seed`；按 `seed / episodeId / sceneId / tick / actorId / eventId` 派生子种子，用现有 `makeRng`（`shared/core/rng.js:4`）。同输入快照和时间脚本必得同结果；无需同分抽签就不消费随机。禁止 `Math.random / Date / window / document / fs / process`，零依赖 ES 模块，浏览器与 Node 共用。

真实 trace 必须在感知当时留存，不能用当前记忆倒算过去；相同静态处境不无限制造新记忆。登记事件才可巩固，时间拍只使激活变淡。旧路径不得新增以上可枚举字段或记录。

## 10. 五个实现任务：写入范围互不重叠

先核心接口与场景计划，再并行接三种呈现。测试文件由后续 QA 独立负责；以下是交付要求，本轮未运行。

| 任务与唯一写入范围 | 验收标准 | 可复验的小例子 |
| --- | --- | --- |
| A 核心生活与续档：`shared/**`，明确排除 `shared/scenes/**` | 完成读镜、调度、导演设计、导师心智、存档边界；默认路径字节不变；旧组通过，新组含暂停／续档／同拍输入／跨场与跨局隔离；纯读前后 save 和账本相同，Node／浏览器同种子同结果。 | 固定快照，两段 advance 到同拍与一次 advance 相同；保存恢复只长后续真经历；关入口时等二十秒等同没等。 |
| B 场景配方：仅 `shared/scenes/**` | 仅取符之夜增生活情境、动词映射、时间规则与候选计划；旧分支和顺序不动；陆导等、单导不等由手艺选择；规则只消费心智结果，兵符与位置约束仍有效。 | 同托付与空等脚本：单导如姬依心智递符或问风险；陆导保留时机（指不抢先让演员动身；期限归谁见 §6 待裁决）；托付低不能因时间到就无条件递符。 |
| C 可玩现场：仅 `web/play/**` | 接逻辑拍、只读身段、铜槽、经历扣片、导演案、结局牵线机；入口和关闭控制落现有主控，基础 html 不动；每件有来源，数字只 dev；保留键盘与暂停。 | 进取符之夜不碰东西二十秒，说出两件人物自己的事；点看铜纽，证据回指当次感知；暂停后期限不跑。 |
| D 戏台与放映：仅 `web/hub/**`、`web/film/**` | 同世界续档、真笔记／灯油、导演旧批注与当场决定；新增录制保存初始快照与拍序，v1 原语义不动；回放不写主世界。 | 追问后回戏台，再来仍有那页笔记；开上一段电影，刻痕在当时出现；关电影当前角色没多一段经历。 |
| E 推演机关：仅 `web/lab/**` | 生活脚本、种子、初始经验可锁；铜槽到史简链可手摇；每次只换一个变量，试验独立于主世界；不出现数值报表。 | 同空等脚本换导演，看谁能在自己的拍上主动动身（巡灯与天亮两位导演一样；「机会流不流走」归谁待用户裁决，见 §6）；锁导演改如姬托付，核对行动／trace／结局链；主世界账本不长。 |

A、B 须先作为下一阶段扩展任务明确契约范围；`docs/KERNEL.md:38` 在原抽内核任务中将 core／agents／session 列为只读，本设计不授权现有成员顺手改这些文件。实际切任务时给 A 明确新增授权，其余任务通过约定读镜接入。

## 11. 成功标准与交付边界

首次进入一场，在前台不点任何东西待二十秒，玩家能说出至少两件“某个人在想或在做的事”。取符之夜按当前托付读真实结果：低托付可说“如姬担心被发现，手停在门后”，高托付则应看到她准备递符，不能统一播放犹豫；另一件可说“守卫盯住来人，要令牌”。证据分别为如姬真实动作／停层与守卫可见目标／本次感知或明示的只读设想，不用通用呼吸、烛火或背诵人设凑数。单导生活拍还应有一件真改变机会（指如姬或守卫真的动身；期限归谁见 §6 待裁决）；陆导等拍也要让心中拉扯可见。导演案可作为另一个角色的证据：他已决定这拍等不等，并把原因留在案上。

第二次到访认出至少一处因真经历变深的痕迹；沿导演牵线机关解释至少一处心智与历史的关系，分清设想、发生、接受、共识与争议。开发模式抽查来源字段、seq 与 cause，断链即不合格。

目前交付是一份可拆任务的设计，没有实现持续生活、跨局成长或新录制。不承诺后台世界推进、自由生成对话、真算力计费、角色游历，或所有幕同时自发行动。实现后按上述小例子复验，旧对照组仍是底线。
