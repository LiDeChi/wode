# 实现契约（给子代理）

本文是模块之间的接口。**签名和数据形状必须严格照写**，不要改名、不要多包一层、不要换参数顺序。
看不懂的地方，读 `docs/数字世界 设计总稿 v3（草案） (2).md` 对应章节。

## 0. 总规则

- 纯 JavaScript ES 模块（`.js`，`export`/`import`），**零依赖**，不要 npm 包。浏览器与 Node 22+ 都要能跑同一份 `shared/` 代码：所以 `shared/` 里**不得**用 `fs`、`process`、`window`、`document`。
- 所有导入写相对路径并带 `.js` 后缀。
- 中文写注释和界面文字；注释简短，说“为什么”。
- **确定性**：`shared/` 不得调用 `Math.random()`、`Date.now()`、`new Date()`。需要随机就用 `makeRng(seed)`（见下）。时间由调用方传入。
- 硬的和软的分开：结构化的决定（输入、选项、所选）放 `payload`；一句“他当时的说法”放 `said`，可以来自模型，也可以是规则模板。
- **每一个导师、导演的决定都必须带 `cause`**（账本里让它产生的那几条记录的 `seq`），而且这条 `cause` 链最终要能走到 `from:'user'` 的记录。这是整个第一阶段要证明的东西。

### 0.1 两个「角色」：世界内人物 与 机器侧心智体

「角色」在总稿和本文里有两个不同的所指，同名不同指，写文档和写实现时必须分开。依据：`docs/notes/note1.md:23`（「要培育的是机器的 agent，不是特定世界里的角色」）与 `docs/notes/note1.md:212`／`:259`（「导师、导演、演员都是角色，同一种心智」）相冲突，用户 2026-10-12 裁决。

- **世界内人物**：活在设定时代里的具体人物。第一版是战国的人（魏王、信陵君、如姬……）。**它不是产品要培育的对象**，只是第一个对象，可以整体换掉——换一个时代就换一批。
- **机器侧心智体**：常驻在产品里的三种心智体，即**导师、导演、演员**。三者共用同一种心智结构（`shared/core/mind.js:1-4`），只是单元、动作与设定不同。**产品要培育的是它们。**

边界三条：

- `note1.md:23` 说的「角色」是**世界内人物**。
- `note1.md:212`／`:259` 与总稿 `:858` 说的「角色」是**机器侧心智体**。
- §1 那套角色标识（`'mentor'`、`'director:<id>'`、`'actor:<id>'`）只描述**机器侧心智体**；`'user'` 与 `'world'` 两者都不是。

写文档时不要单独用「角色」两个字，写全称。

## 1. 已有的核心（主代理写好了，只读，不要改）

### `shared/core/ledger.js`
```js
createLedger() -> ledger
ledger.append({ kind, from, to='world', payload={}, cause=[], said?, saidSource?, scene? }) -> entry
// entry = { seq, kind, from, to, payload, cause:number[], said?, saidSource?, scene?, hash }
ledger.get(seq) / ledger.entries / ledger.size / ledger.ofKind('mentor') / ledger.last(pred) / ledger.subscribe(fn)
traceToUser(ledger, seq) -> { ok, path:[seq 从用户到这条], root }
ancestors(ledger, seq) / descendants(ledger, seq) -> seq[]
auditService(ledger) -> { total, served, orphans, byRole, ok }
roleKind('director:lu') -> 'director'; roleId('director:lu') -> 'lu'
hashHex(any) -> string
```
角色标识：`'user'`、`'mentor'`、`'director:<id>'`、`'actor:<id>'`、`'world'`、`'gateway'`、`'presentation:<id>'`。
史料层的 `HISTORY[].holder` 另允许 `'narrator:<sourceId>'`（例：`'narrator:S77'`），表示“这句话是那本书的叙述者说的”，用来保留说话人；它不是角色标识，只出现在主张的 `holder` 里，不参与 `roleKind`/`roleId`。

账本 `kind` 命名（只能用这些前缀）：
| kind | 谁写 | payload 要点 |
|---|---|---|
| `user.meet` | 用户 | `{ answers:{wait,polish,depth,surprise}, need:string }` |
| `user.edit-note` | 用户 | `{ field, from, to }` |
| `user.act` | 用户 | `{ scene, verb, target, item?, option? }` |
| `user.react` | 用户 | `{ scene, beat, signal, value? }` signal ∈ `'停下来看心思'|'追问为什么'|'很快通过'|'重来一次'|'中途离开'|'停顿'` |
| `mentor.note` | 导师 | `{ field, value, source:'问'\|'观察'\|'你改的' }`；`field` ∈ `'wait'\|'polish'\|'depth'\|'surprise'\|'emotion'\|'need'\|'director'`。`field:'director'` 由 `mentor.chooseDirector` 写：`value` 是导演 id，`source:'观察'` |
| `mentor.allot` | 导师 | `{ input, options, chosen:{[sceneId]:tier}, spent, budget }` |
| `mentor.brief` | 导师 | `{ director, need, emotion, prefs, budget, tiers }` |
| `mentor.learn` | 导师 | `{ field, before, after, signal }` |
| `mentor.refuse` | 导师 | `{ attempted, by, reason }` |
| `director.design` | 导演 | 见 §4 |
| `director.predict` | 导演 | `{ presentation, predictions:[{beat, expect, confidence}] }` |
| `director.grant` | 导演 | `{ scene, verbs:[...], level, language:'看不见'|'选一句'|'自由说' }` |
| `director.schedule` | 导演 | `{ input, options, chosen, slot:'现在'|'稍后'|'之后' }` |
| `director.learn` | 导演 | `{ beat, expected, actual, error, craft:{before,after} }` |
| `actor.perceive` | 演员 | `{ scene, signature, stoppedAt, act, trace }` |
| `actor.say` / `actor.give` / `actor.go` / `actor.watch` | 演员 | `{ scene, target, item?, ... }` |
| `world.verb-refused` | 世界 | `{ actor, verb, scene, reason }` |
| `world.chain` | 世界 | `{ link, result:'held'|'changed'|'filled', why }` |
| `present.open` / `present.deliver` | 呈现 | `{ presentation, scene }` |
| `gateway.call` | 网关 | `{ purpose, model, ms, tokens, ok }` |
| `claim.*` | 主张图（自动） | — |

### `shared/core/claims.js`
```js
createClaimGraph(ledger) -> G
G.add({ subject, predicate, object, holder, channel:'亲历'|'被告知'|'公开'|'设定', evidence=[], deps=[], presentation=null, weight=1, cause=[], note })
  -> { claim, check:{conflicts, maxCost, verdict:'none'|'misunderstanding'|'reversal-needed'}, seq }
G.endorse(id, holder, weight, cause, presentation) / G.read(id, presentation, cause) / G.cite(id, presentation, cause)
G.overturn(oldId, { replacement, evidence, explanation, approvedBy, presentation, cause }) -> { ok, cost, missing?, affected?, newId? }
G.consensus(subject, predicate) / G.viewFor(holder, {told}) / G.relations(presA, presB) -> [{type:'承接'|'引用'|'并行'|'争议'|'反转', claims}]
G.overturnCost(id) / G.get(id) / G.all() / G.find(pred)
```
claim = `{ id, subject, predicate, object, holder, channel, evidence, deps, endorsers, citedBy, readBy, presentation, status:'active'|'former'|'disputed', seq, history }`

### `shared/core/mind.js`
```js
createMind(def, savedState?) -> mind
mind.perceive({ kind, signature?, channels:{通道:强度}, reliability? }) -> { trace, stoppedAt:'unit'|'module'|'mind', action:{act, verb, layer, from}, candidates, error, expectation }
mind.hear(appeal:{义,利,惧,恩}, fromRole) -> { accepted, moved, fit, backlash, trustBefore, trustAfter, reason }
mind.imagine(otherDef, event, guess?) -> { act, stoppedAt }
mind.install(unitDef) / mind.uninstall(id) / mind.tick(dt) / mind.save()
explainPerception(result, name) -> string
```
心智定义 `def`：
```js
{ id, name,
  temperament: { 疑心, 耐性, 义, 畏, 恩, ... 0..1 },
  units: [{ id, label, module, reads:['通道名'...], capacity:{ base, by:{性情名:系数} } | number, act:'动作描述', verb?:'go'|'give'|'say'|'watch' }],
  modules: [{ id, label, capacity, act, verb? }],
  mindAct: '递到心智时做的事',
  values: { 义, 利, 惧, 恩 },      // 话里的哪种诉求打动他
  resist: { 义: { 惧: 0.5 } },     // 某种诉求反而激起什么
  threshold: 0.35,
  goals: ['动作描述'...],
  trust: { 'actor:player': 0.3 } }
```
`capacity` 的值 = base + Σ 系数×性情。**性情决定胃口**：同样的事件，胃口大的单元就地吃掉，人就动身；胃口小，事情递到心智，人就停下来想。

工具：`shared/core/rng.js`（主代理写）
```js
makeRng(seed:string) -> () => number   // [0,1)
```

## 2. 设定数据 `shared/data/seed.js`

```js
export const SOURCES      // { [id]: { id, title, url, location, quote, kind:'primary'|'design'|'ledger', note } }
export const PLACES       // [{ id, name, desc }]   daliang 大梁·信陵君府, yimen 夷门, palace 魏王卧内, ye 邺, handan 邯郸, granary 邯郸粮仓
export const PEOPLE       // [心智定义 + 展示字段]，字段见下
export const STAFF        // { mentor: 心智定义, directors: [心智定义...] }
export const ITEMS        // [{ id, name, desc, appeal:{义,利,惧,恩} }]   玩家“说”的方式：递一样东西
export const HISTORY      // [主张草稿]  史料层：{ subject, predicate, object, holder, channel:'设定', evidence:[sourceId], confidence, note }；holder 允许 'narrator:<sourceId>'（例 'narrator:S77'，见 §1）
export const CHAIN        // [成因链环节]，字段见下
export const PREFS_QUESTIONS // 导师第一次见面问的三个很粗的问题，见下
```

PEOPLE 每个人在心智定义之外加：`{ title, place, historical:boolean, bio, look:{ color:'#hex', glyph:'单字' }, voice:'说话习惯一句话', sources:[sourceId] }`

必须有这些人（id 固定）：`weiwang` 魏王、`xinling` 信陵君、`houying` 侯嬴、`ruji` 如姬、`jinbi` 晋鄙、`zhuhai` 朱亥、`pingyuan` 平原君、`litong` 李同、`zhaoshi` 赵使、`keeper_doubt` 守仓人·老秦（多疑，虚构）、`keeper_rash` 守仓人·阿季（耐性低，虚构）、`borrower` 借粮者（虚构）、`guard_a` 宫中守卫甲、`guard_b` 宫中守卫乙、`player` 新来的门客（虚构，玩家控制意图）。

性情是设计假设（设计稿 §17.8），`bio` 里要写明“性情为本作设计假设”。

**换人测试的硬要求**：两个守仓人面对同一事件
`{ kind:'缺额', channels:{ 数量:0.7, 印信:0.4, 人:0.5 } }`
- `keeper_doubt`：结果 `stoppedAt === 'mind'`，`action.act` 是“把所有印信摊开，一份份对照”
- `keeper_rash`：结果 `stoppedAt === 'unit'`，`action.act` 是“直接去追借粮者”
靠的是 capacity 的性情系数，不是写死分支。两人 units/modules 结构相同，只有 temperament 不同。

**说服的硬要求**（hear）：
- 魏王：`hear({义:0.8}, 'actor:player').accepted === false` 且 backlash > 0（讲义反而更怕）。任何单一诉求都说不动他；`threshold` 提到 0.55 且「利/惧」也有 resist，凑几样好处也不动。
- 信陵君：`hear({义:0.8}, 'actor:player')` 在 trust 0.5 时 accepted；`hear({利:0.8})` 不 accepted。
- 晋鄙：默认 trust 0.2，`hear({惧:0.7})` 不 accepted（越压越疑）；`hear({义:0.8, 恩:0.4})` 在 trust ≥ 0.5 时 accepted。
- 不能有一种 appeal 让魏王、信陵君、晋鄙、侯嬴四人全部 accepted（防“被话术摆平”）。

ITEMS 至少：`bamboo` 赵使求救的竹简（义）、`wine` 一杯酒（恩）、`seal` 印信（利+惧）、`qin_warning` 秦使的警告（惧）、`ledger_page` 仓簿副页（证据，义 0.3）、`hammer` 铁椎（惧 0.9）。

CHAIN（设计稿 §16.3），6 个环节，id 固定：`halt` 魏王止步、`plead` 信陵君穷尽正路、`plan` 侯嬴献计、`steal` 如姬窃符、`seize` 邺城夺军、`relief` 解围。每个：
```js
{ id, label, people:[id], belief:'一句话', resources:'一句话', confidence:0..1, mutable:boolean,
  irreplaceable:boolean, sources:[sourceId], alternative:'条件不满足时历史怎样自己补上（一句话）',
  changed:'若被改变，本作的历史会怎样（一句话）' }
```
`halt`、`relief` 的 `mutable:false`。

PREFS_QUESTIONS：
```js
[{ id:'wait', q:'等一会儿，换来更精致的？', options:[{label:'现在就要', value:0.2},{label:'可以等', value:0.8}] },
 { id:'polish', q:'你更想要哪一种？', options:[{label:'雕琢好的一段', value:0.8},{label:'能真的改变它', value:0.2}] },
 { id:'depth', q:'人心要看多细？', options:[{label:'看个大概', value:0.25},{label:'越细越好', value:0.85}] }]
```
（`surprise` 不问，默认 0.5，由观察修正。）

STAFF.mentor 与 STAFF.directors 也是心智定义：
- 导师的单元读玩家信号（通道：`等待`、`停顿`、`追问`、`重玩`、`离开`）。
- 两位导演：`lu` 陆导（偏爱锁死雕琢、偏悲剧余味），`shan` 单导（偏爱放开、快节奏）。导演 temperament 里有 `雕琢`、`悲剧`、`节奏`、`放开` 四个数。导演的单元读 `停顿`、`追问`、`重玩`、`很快通过`。

## 3. 导师 `shared/agents/mentor.js`

```js
export function createMentor({ ledger, def, budget = 10 }) -> mentor
mentor.meet({ answers, need }, userSeq) -> { notes, seqs:number[] }
  // 为每个字段写一条 mentor.note（source:'问'），cause=[userSeq]
  // need 是用户自己写的一句话；按关键词推出 emotion（见下表），也写一条 note：field 'emotion'
mentor.notes() -> { wait:{value,source,seq}, polish:{...}, depth:{...}, surprise:{...}, emotion:{...}, need:{...} }
mentor.editNote(field, value, userSeq) -> seq        // 用户改笔记，source:'你改的'
mentor.allot(scenes, cause) -> { chosen:{[sceneId]:tier}, seq }
  // scenes = [{ id, title, centrality:0..1 }]；tier ∈ '细演'(3) | '普通'(2) | '一笔带过'(1)
  // 规则：depth 高、centrality 高 → 细演；超预算从 centrality 最低的往下降。payload 写 input/options/chosen/spent/budget
  // said：一句导师的说法，例如“这几场我给细演，你说过想看清人心”。
mentor.chooseDirector(directors, cause) -> { director, seq }
  // 按口味配导演：polish 高 → 偏爱雕琢的；polish 低 → 偏爱放开的。写 mentor.brief 之前的一条 mentor.note? 不，直接在 brief 里体现
mentor.brief(directorId, cause) -> { brief, seq }
  // brief = { director, need, emotion, prefs:{wait,polish,depth,surprise}, budget, tiers }
mentor.learn(signal, userSeq) -> seq | null
  // signal = { kind:'停下来看心思'|'追问为什么'|'很快通过'|'重来一次'|'中途离开'|'停顿', beat }
  // 规则：看心思/追问 → depth +0.08；很快通过 → depth -0.06；重来一次 → surprise +0.05、polish -0.04；中途离开 → wait -0.1
  // 只在字段 source 不是 '你改的' 时改（用户亲手改过的，观察不能覆盖）。写 mentor.learn
mentor.guard(action, by) -> seq    // 别人（导演）试图改导师的分配规则或笔记：拒绝，写 mentor.refuse
mentor.state() -> 可序列化对象；createMentor({ ..., saved }) 能恢复
```
need → emotion 关键词（按顺序匹配，第一条命中即用；都不中用 '悲悯'）：
| 关键词 | emotion |
|---|---|
| 选择、决定、改变、取舍 | 责任 |
| 紧张、刺激、危险、追 | 紧张 |
| 为什么、真相、原因、弄清 | 顿悟 |
| 信任、朋友、谈心、亲近 | 亲密 |
| 走走、看看、探索、好奇 | 好奇 |
| 人、命运、悲、结局 | 悲悯 |

## 4. 导演 `shared/agents/director.js`

```js
export const TEMPLATES   // 设计稿 §13 情感→交互：
// { 责任:['分配','决策'], 亲密:['对话'], 紧张:['即时动作'], 好奇:['探索'], 顿悟:['解谜'], 悲悯:['观看'] }
export function createDirector({ ledger, def, mentor }) -> director   // mentor 只用来调用 mentor.guard
director.id / director.role  // role = 'director:<id>'
director.design(brief, catalog, cause) -> { design, seq }
director.predict(design, notes, cause) -> { predictions, seq }
director.grant(beat, cause) -> seq
director.schedule(options, cause) -> { chosen, seq }
director.learn(predictions, reactions, cause) -> { errors, seq }
director.tryEditMentor(field) -> seq   // 演示权限边界：调用 mentor.guard，返回拒绝记录
director.craft()  // 当前手艺参数 { lockBias, tragedyBias, paceBias, freedomBias }
director.state()
```

`catalog` 是一个呈现的节拍目录（由 `shared/play/catalog.js` 提供，见 §6）：
```js
{ id, title, kind:'film'|'game'|'action', beats:[{ id, scene, title, emotions:['责任',...], levels:[0,1,2], centrality, canLock:boolean }] }
```
`design` 形状（**严格照写**）：
```js
{ presentation, director, emotion, slot:'现在'|'稍后'|'之后',
  beats:[{ id, scene, template, level:0|1|2|3, prefab:'高'|'中'|'低', locked:boolean,
           grants:['go'|'give'|'say'|'watch'...], language:'看不见'|'选一句'|'自由说', why }] }
```
设计规则（全部确定性）：
- 每个 beat 的 `template`：beat.emotions 里与 brief.emotion 相同的优先；否则 beat.emotions[0]；再从 TEMPLATES 查第一个。
- `level`：polish 高（>0.6）→ 取 beat.levels 的最小值；polish 低（<0.4）→ 最大值；否则中间。导演的 `放开` 性情 > 0.6 时 +1（不超过 levels 最大值）。
- `locked`：beat.canLock && (polish + 导演雕琢)/2 > 0.55。
- `prefab`：locked → '高'；level ≥ 2 → '低'；否则 '中'。
- `grants`：level 0 → []；level 1 → ['say']；level 2 → ['go','give','say']；template 是 '即时动作' → ['go','give']；'观看' → []。另外凡 level ≥ 1 都加 'watch'（看心思）。
- `language`：level 0 → '看不见'；level 1、2 → '选一句'；level 3 → '自由说'。
- `slot`：wait < 0.4 → '现在'；否则 polish > 0.6 → '稍后'，否则 '现在'。
- `why`：一句话，说出依据，必须提到 brief 里的一个字段（例：“你说想要能真的改变它，所以这里放开”）。
`director.design` 写一条 `director.design`，`payload = design`，`cause` 包含传入的 cause。

`predict`：对每个 level ≥ 1 的 beat，用导演心智的 `imagine` 设想玩家（玩家性情由 notes 推：depth→好奇，surprise→冒险，polish→雕琢），预测 expect ∈ `'停下来看心思'|'追问为什么'|'很快通过'|'重来一次'`，confidence 0..1。映射规则：设想结果 stoppedAt==='mind' → '停下来看心思'；'module' → '追问为什么'；'unit' → '很快通过'。

`learn`：reactions = `[{ beat, signal }]`。每条与预测对照：相同 error 0，不同 error 1。整体命中率低于 0.5 时：若玩家多停下来看心思而导演预测很快通过 → `paceBias -0.1`、`tragedyBias +0.05`；反之 `paceBias +0.1`。每次 learn 写一条 `director.learn`（含 craft.before/after）。手艺参数会影响下一次 design 的 level 选择（paceBias > 0.15 时 level 往低调 1）。

## 5. 网关 `shared/agents/gateway.js` 与服务器 `server/index.mjs`

```js
export function createSpeaker({ ledger, call, limits = { 对白:30, 设想:6, 改造:1 } }) -> speaker
// call(request) -> Promise<{ text, model, ms, tokens }>   由宿主注入：浏览器里 POST /api/speak；Node 测试里可传假的
speaker.say({ purpose:'对白'|'设想'|'改造', role, persona, view:[string], line, fallback, maxChars = 40, cause = [] })
  -> Promise<{ text, source:'model'|'rule', model?, ms? }>
// 超额、call 抛错、超时（8 秒）、返回空 → 用 fallback，source:'rule'。
// 每次真的调用（成功或失败）都写 ledger 'gateway.call'。
// 输出过滤：去掉引号、换行；超过 maxChars 截断；包含“AI”“模型”“作为一个”等出戏词 → 视为失败用 fallback。
speaker.usage() -> { 对白:{used,limit}, 设想:{...}, 改造:{...} }
```
提示词：system 写“你是{persona}，生活在公元前258年。只知道下面这些事：{view 逐条}。用你的口吻说一句话，不超过{maxChars}字，不要旁白，不要引号。”；user 写 `line`（要表达的意思）。

`server/index.mjs`：Node 内置 `http`，零依赖。
- 静态托管仓库根目录下的 `web/`、`shared/`、`docs/`（`/` → `web/index.html`）。正确的 MIME（.js 用 `text/javascript`）。
- `POST /api/speak` body `{ system, user, maxTokens }` → 转发到 `${MODEL_GATEWAY_URL||'http://127.0.0.1:3425/v1'}/chat/completions`，`Authorization: Bearer ${MODEL_GATEWAY_KEY||ANTHROPIC_AUTH_TOKEN}`，model 取 `MODEL_FAST || 'group/auto-glm-5-3-flash'`，备用 `MODEL_FALLBACK || 'commandcode/deepseek/deepseek-v4.1-flash'`（这个是推理模型，max_tokens 至少 800）。返回 `{ text, model, ms, tokens }`。主模型超时 6 秒，备用模型独立 10 秒（主模型慢不能占掉备用模型的时间）；都失败返回 502 `{ error }`。
- `GET /api/health` → `{ ok, model, gateway:boolean }`。
- `GET/PUT /api/world` 存取 `.runtime/world.json`（整个世界的存档 JSON）。
- 只绑 `127.0.0.1`，端口 `PORT || 4320`。凭据只在服务器，不发给浏览器。

## 6. 呈现目录 `shared/play/catalog.js`

```js
export const CATALOG   // { [presentationId]: catalog }，形状见 §4
export const WORKS     // 作品墙：[{ id, title, kind, length:'约1分钟', viewpoint:'谁的眼睛', summary, reads:[...], writes:[...] }]
```
作品（id 固定）：`changping` 《长平之后》film；`weicheng` 《围城》game；`qiefu` 《窃符》game；`night` 《取符之夜》action；`studio` 片场。
《窃符》beats：`open`(film, 悲悯, levels[0])、`daliang`(大梁, 责任/亲密, levels[1,2])、`yimen`(夷门, 亲密/顿悟, levels[1,2])、`night`(取符之夜, 紧张, levels[2])、`ye`(邺城, 责任/悲悯, levels[1,2])、`coda`(拉远与史, 悲悯, levels[0])。
《围城》beats：`dusk`(暮色粮仓, 责任, levels[1,2])、`morning`(第二天·守仓人视角, 顿悟, levels[0,1])。
《取符之夜》beats：`run`(紧张, levels[2])。《长平之后》beats：`film`(悲悯, levels[0])。
`centrality` 写 0..1；《窃符》的 `ye`、`night` 最高。

## 7. 不做

游历、完整科研、账户系统、npm 依赖、构建步骤。

**多世界不在这一节。** 它是**导演的呈现作品集与师承关系**，不是平行宇宙切换器：多个呈现可以共用同一个世界，也可以各自是世界；另一个导演看到某个主题感兴趣，也可以做；导演之间互相借鉴，作品可能是续集或系列。这是导演手上的设计选择，不是全局开关（与 `docs/HANDOFF.md` 记的「世界等不等你由导演设计」同一条血脉）。依据：用户 2026-10-12 裁决，见总稿 §24「已定」。
