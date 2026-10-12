# 《窃符》机制打磨：学会看人，让选择留下后果

任务 t24，2026-10-11。交付设计，不改玩法代码。现在的问题不是结局少，而是同一句义几乎总有用、夷门承诺不影响夜里。目标：玩家先读人的顾虑，再决定该说什么；失误有可理解的代价，也留补救空间。性情/新台词是本作设计，不冒充史料。

## 1. 体检对照与量法

基线取 `tools/mechanics-probe.mjs` t23 工作版：`node tools/mechanics-probe.mjs --json /tmp/mechanics-t23-for-sol.json`；sol 独立候选实验 `node /tmp/mechanics-sol-t24.mjs`，只在进程里替换初值/场景表，不改仓库、不跑 tests/。候选验证不等于正式实现通过；t23 最终诊断以 `docs/design/mechanics-diagnosis.md` 为准。

| 问题 | 已量到的基线 | 打磨后验收 |
|---|---|---|
| 义压倒其他说项 | 大梁义100%，邺城义95%，恩/惧0%；夷门侯嬴义.6的打动.336，差.014过不了.35 | 九名人物纯诉求矩阵每列≤50%；loyal恒选义不再救晋鄙，读线索换恩/利可以 |
| 跨幕只有数值、没动作差 | 40个前置组合仅1种夜开场；如姬信任.3/.4/.45全不犹豫，差0pp | high/low配对前置的初始hesitant频率差≥30pp；候选达100pp |
| 伪选项/死分支 | A的letter/king各64次被挡；其大梁yi与wait下游签名80/80相同，侯嬴hou亦80/80 | 分开统计挡掉、条件隐藏、真正可用却全无影响；最后一种=0 |
| 结局/非法脚本混淆 | 680旧脚本：history100、jinbi-lives66、broken416、null98；null为48禁give、48禁say、2非法nope | 三结局各≥2条实质不同路线；合法有限路线null=0；非法调用照常拒绝 |
| 有时间标签、无真实时长证据 | 640枚举：history122/lives38/broken480；动作6–11，估时540–615秒（不含粮仓） | 保持合法路线可完成；8–12分钟仍是估时，不能宣称真人用时已验 |

“概率”统一称**固定样本发生频率**：心智没有随机骰子。纯诉求矩阵：九人=信陵君、侯嬴、如姬、晋鄙、魏王、朱亥、赵使、两卫；每人新建Mind、保留自己的初始trust，分别单独hear({某诉求:.8})，阈值用其def。旧义5/9=55.6%、利1/9、惧0/9、恩2/9；候选义1/9=11.1%、利/惧/恩各2/9=22.2%。不同于按台词次数加权的接受率，不得混用分母。

另已扫强度.6/.8/1 × trust 0/.15/.2/.3/.5/.65/1 × 四诉求=84组，每组九人：最大4/9（44.4%），无越过50%。正式仍须扫初始/各可达幕前trust；每个状态截面每列≤4/9。高站位晋鄙新增恩/利接受者，恩/利最多3/9；侯嬴/如姬/晋鄙对义必须backlash>.15。拒绝和反噬是两件事：不是所有失败都变脸。

## 2. 人物初值：cast纯数据，只在本作品生效

captain已授权最小接入：在 `shared/scenes/qiefu.js` 现有场景控制器的init/enter里安装一次cast；不改kernel/effects/rules、play、weicheng、seed/session/core。共用心智仍是唯一裁判，不能在规则里把accepted写成true。

字段形状：`cast: { [personId]: { values?, resist?, trust?, threshold?, temperament?, units?, modules?, goals?, voice?, bio? } }`。这是qiefu本地数据，非新内核契约。values/resist/trust对象完整替换；units/modules数组完整替换；未给字段沿用复制的seed def。cast覆盖全作品人物，在每幕同一入口可加载，研究台改场景副本的cast也走此入口；已核 `shared/engine/play.js:101` 的 `opts.scenes || SCENES`（t26的30a50f8）。

最小实现选现有 `lines.init(ctx)` 作为入口，其他幕在controller表加无选项lines；init只读scene.cast，`createMind({...复制def,...override}, existingMind.save())`替换ctx.minds[id]。首次经历的trust初始化取override；重载必须保留save中的经历trust/stress/memory。**安装标记是当前session对象内的临时标记，不用持久flag阻止重载重新构造def**；同一session不每幕重设trust。不改原seed对象。无cast、无新增控制器的旧场景副本必须逐字节保持旧行为。

| 人物 | values顺序：义/利/惧/恩 | resist（诉求→激起情绪，系数） | 在乎什么 / 看前能懂的禁忌 |
|---|---|---|---|
| 信陵君 | .9/.1/.15/.2 | 利→疑心.3 | 救赵的责任；拿土地交易人命会失去门客身份 |
| 侯嬴 | .15/.75/.15/.25 | 义→疑心.45 | 可行谋划、保住人；空喊大义催他献计会遭冷眼 |
| 如姬 | .15/.1/.1/.95 | 义→畏.3，惧→畏.3 | 私恩与安全；“为天下牺牲”会像拿她作工具 |
| 晋鄙 | .15/.8/.2/.7 | 义→疑心.4，惧→疑心.5 | 交割安排与魏卒安全；用天下大义压军令像夺军 |
| 朱亥 | .2/.2/.15/.85 | 惧→畏.2 | 公子的恩与明确托付；不是听一句义就动铁椎 |
| 赵使 | .25/.2/.85/.2 | 利→疑心.3 | 邯郸眼前的危急；土地价码不像真正救援 |
| 守卫甲 | .1/.15/.7/.2 | 利→疑心.4，义→疑心.3 | 当班失职的风险；拿令牌套交情只使他查得更严 |
| 守卫乙 | .1/.9/.1/.2 | 惧→畏.4，义→疑心.3 | 把责任交给有令牌的人；威逼不能让他闭眼 |
| 魏王 | 不覆盖，沿用seed | 沿用义→惧.5等 | 持两端；仍不可用一种话把他强行说动 |

初始trust沿seed（信陵君.5、如姬/晋鄙.2、其余.3），threshold除晋鄙改.5外沿seed；如姬debt/risk的capacity、goal、stress保持原值，跨幕由信任变化驱动。cast的voice/bio补上表中顾虑；watch.values/resist/goals与台词必须相符，不能数字说忌义、文字却鼓励喊义。

## 3. 四幕数据怎样改

| 幕/意图 | 数据改动 | 可感知后果/规则次序 |
|---|---|---|
| 大梁yi | 义.8保留；接受后明确信陵君trust=.65，clock=-3 | “愿让你替他说话，但又耗三天”；claim→trust→clock固定 |
| 大梁letter（B才允许） | 义.4保留；接受后trust=.5，clock=-2 | 提交实情省一天但没有口头义举的声望；A保持禁用，不放开导演 |
| 大梁li | 接受失败/反噬照心智；trust=.2，clock=-1 | “不再让你代表公子”；少耗时但丢身份，不能只写“降了” |
| 大梁king（B才允许） | kingSuspicious=true、trust=.25、clock=-3保留 | 魏王猜忌仍使邺城bar+.05；不是隐藏必胜进宫路线 |
| 大梁wait | trust=.3、clock=-3 | 机会自己过去；明确“公子尚未将你当作说项人” |
| 夷门back | 仍向公子讲义.7，accepted→rujiTrust/trust=.55、clock=-1 | 尊重侯生所以快回头；如姬先收到可靠托付 |
| 夷门hou | **改利.7**：“先生，别让百余人白死，您有可行的路？”；accepted→ruji=.5、clock=-3 | 侯嬴初始moved=.42≥.35；得到较慢但可靠的谋划，非拿钱贿赂 |
| 夷门fear | 惧.8保留；ruji=.08、clock=-3 | 她只听到门客畏死，不确定是否托得住符；公子信任由hear自身变化 |
| 夷门wait | ruji=.18、clock=-2 | 献计仍会发生，陌生门客缺担保；比fear少耽误一天 |
| 夷门失败back/hou | HOU_PLAN仍在；ruji=.08、clock=-3 | 世界不会因拒绝停住，拒绝有后果；第一条accepted分支先匹配 |
| 夜 | 不改nightwalk移动/巡灯/令牌/等候逻辑；仅人物初值+scene文本 | 开场低trust的如姬risk胜出，需要门口等一拍；高trust无需等；不得直接写hesitant |
| 邺城 | 用**已有standing控制器数据**替代yeStage，避免改该函数硬编码台词 | speaker=xinling、threshold=.45、weight高.5/低.15、bar=.5+猜忌.05；targets见下 |

邺城targets：yi仍纯义.8（“救赵大义，请将军即刻交兵”）、en恩.8（“公子许将军全身归营，不让十万魏卒枉死”）、新增li利.8（“先验换防名册，约定接防和归营，兵权有交代”）、ju惧.8照旧。义在晋鄙处反噬.32；高站位en=.56/li=.64过.5，低站位en=.364/li=.416不过.5。晋鄙的“利”是军务安全利益，不许改成受贿。不要把yi偷偷改混合诉求，让“永远点yi”仍获胜。

有符wait仍由场景规则work(strike)；accepted→persuade、backlash→strike、否则strike先后保留；无符optionsWhen只留wait，仍choice=null、broken，不改play.coda判断。场景加具名非终局flags：高/低托付不另开专门剧情；晋鄙yi反噬可记`jinbiAlienated=true`、ju反噬记`coercion=true`，末段用现场文本讲清施压与威胁不同，禁止用只有装饰性的flag冒充新玩法。

## 4. 跨幕差异、学习与死选项的验收口径

如姬算法仍是原perceive：恩通道=trust+.1、惧=.5；当前debt目标加权、risk容量.42。trust=.08时debt权重约.243 vs risk.454→犹豫；.55时debt约.878→不犹豫。原.3已约.54胜risk，所以原低档不够低。这是边界跨越，不加随机拒绝率。

配对样本：同导演/大梁/夜路/邺城，仅换夷门；40个前置组合分高/低，到**夜刚开场**读hesitant（不能在wait之后读rujiReady充当初态）。目标back/hou成功组0%犹豫，fear/wait/拒绝组100%；差100pp候选已验，正式至少30pp。另外只换大梁yi↔wait，同为hou+clean+en：高身份lives、低身份history；确保跨幕不是只挂一句文案。

玩家第一次进入每幕即可watch读取价值/禁忌、本人目标、对玩家trust。问之前的系统ask仍会说“你还没对他做过什么”，不改通用ask来伪造剧情；**动手前靠watch和场景线索，动手后ask解释同一人物的真实理由**，作为下一局可迁移知识。不要对公子选back却问侯嬴，然后拿“没说什么”当反馈。导师一笔带过仍只省文案，不能改胜负；档位t27负责。

| 入口 | 动手前可读线索 | 可以推断的下一步 |
|---|---|---|
| 夷门侯嬴watch | “可行路比漂亮义话重；他还在观察公子”+利.75/义反噬 | 选hou的保人谋划，不再用义催侯生 |
| 夜如姬watch | 私恩、被发现的怕；trust低时scene写“托付未到，她在等你定神” | 到门口看她停住就等一拍；灯节奏仍需自己读 |
| 两卫watch | 甲怕失职、乙要责任交割；令牌句不称“塞钱” | 令牌交乙而非甲；交一次便不可收回 |
| 邺城晋鄙watch | 魏卒安全/手续、义激起夺軍疑心；公子trust是身份来源 | 先保全或换防；纯义和威逼均不能省手续 |

死选项不是“某两条路恰好同结局”。投影比较 `[ending, days, night初态/轨迹,有效身份高低,夜成功,合法后继集合,邺城accepted/choice]`；不计ledger hash/seq、只有文本的claim、无人读取的flag。固定所有后继，比较某有效选项与wait/其他选项：每个意图至少有一个配对后继改变可用后继、时间代价、身份或结局；所有合法状态都全同则删/改该选项。目标死意图0，且主动选项间不能只有文案不同。终末yi/ju/wait同落history是不同责任但不应只靠责任文案：yi规则额外clock=-1、ju clock=-2、wait clock=0；验实际days差，沿既有clock向后传，不修改围城消费天数的实现。

夜的token_a会暴露、rush会错灯，不算死选项；重复已交令牌是禁用态，不算新决策。夜中原地step（如姬未准备）消耗一拍且走灯，是实质危险。必须让现场文本同时显示“仍在门口、灯已挪”，不能只说“不动”。A被挡letter/king不计算接受率或路线数，不把它们解锁来凑指标。

## 5. 三结局各两条路与未命名机会

记C=`step→token_b→rush→step`；记R=`step→token_b→rush→wait→step`（在门口等她定神）。以下候选在/tmp已跑，A/B均有效；无随机。每条前置不同或心智渠道不同，空加wait/重排同事件不算新路。

| 结局 | 路一 | 路二 | 区分的原因 |
|---|---|---|---|
| jinbi-lives | yi→back→C→en | yi→hou→C→li | 公子的可靠托付/侯生可行谋划，最终保全恩/军务利两个说服通道 |
| history | yi→back→C→yi | wait→hou→C→en | 有身份但义反噬；有符但无身份，恩不足以过门槛 |
| broken | yi→fear→C并一直step（12拍天亮） | yi→wait→step→step | 在门口不肯等造成超时；中庭未让乙转身被看见 |

另有候选实验自己找出的组合：**yi→wait→R→en也能lives**。设计里没设“沉默门客救晋鄙”这类专用分支、连招ID或奖励flag；夷门信任低，但公子身份高，夜里等候恢复进度，最后恩过门槛，三个独立机制自然拼出补救。正式验收再枚举至少一条不在上表主路线中的合法成功轨迹，不往规则塞这条全路径匹配，也不在UI命名成捷径。表中R作为审查证据，不当剧透攻略。

## 6. 对照组为何要分版本

原 `tests/fixtures/play-golden.json` 是“抽内核不改行为”的680条凭证，不能悄悄覆盖。此次用户明确要求机制改变：cast使侯嬴/晋鄙义反噬，夷门信任跨过hesitation边界，大梁身份变化，新增邺城li；因此结局/flags/days/文字/ledger hash变化是**被授权的内容改版**，不是内核回归修复。

保留旧文件和旧版本场景重放；新增 `tests/fixtures/play-mechanics-v2-golden.json` 并保留原680脚本ID作差异表，额外加li与R的脚本。captain若要把现有parity测试切到新基线，先归档旧golden+旧场景快照并公开每一类差异理由，不能用重录掩盖失败。非法98条不是新结局，仍分开验“明确拒绝”；合法0卡住。no-cast/旧场景副本必须仍过原680，cast改版才对新golden。实验未重录任何文件。

## 7. 可派工任务（文件范围不重叠）

| 任务 | 唯一写入范围 | 验收数字与交接 |
|---|---|---|
| M1 场景与人物打磨（可给t13） | `shared/scenes/qiefu.js` | cast接入+表内人物/四幕数据；无cast原行为不变，纯诉求各≤4/9、义反噬≥3人、跨幕差≥30pp、三结局各2路、每有效意图有后继反事实、死意图0；存档重载前后身份/hesitant一致；不碰play/weicheng/kernel/core/seed。初值与规则同文件归一个owner，别再按幕分人抢文件 |
| M2 体检与改版证据（t23完成后派QA） | `tools/mechanics-probe.mjs`、`tests/mechanics-polish.test.js`、`tests/fixtures/play-mechanics-v2-{scripts.mjs,golden.json}`、`docs/design/mechanics-polish-evidence.md` | 自动发现standing新增li/读实际appeal，分别报告九人矩阵与台词加权；40前置配对、高低身份与6路线证据、R组合；合法null0/原非法拒绝；死意图0/≤50%/≥30pp；逐项列680差异原因并保留旧文件。仓库测试由captain执行，worker只Node只读probe |

M2依赖M1；报告数字达不到就退回M1调数据，不改内核阈值公式以迁就表格。t26只负责围城/play，t27只负责导师档位；此设计不碰这两处，不增加音频/模型工作，也不以重录替代680内核迁移证据。
