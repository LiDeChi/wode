# 角色记忆 / 上下文组装 / LLM 循环：复用决策

调查对象：concordia、generative_agents、letta、ai-town、mem0、graphiti、cognee、langgraphjs、mastra、LlamaIndexTS。
每份取证的路径与行号见同目录 `<owner>__<repo>.md`（都标注了 `path:line@sha`）。

**总定调（用户 m01618 / captain m01801）**：LLM 在本项目只有两种身份——**写代码的助手**、**把结构里的结果翻成人话的翻译**。角色的感知与决策必须沉淀成结构（确定性心智、规则、记忆结构）。下面凡「让 LLM 当裁判/决策者」的部分，一律只作对照，不采用。

## 1. 复用决策表

| 仓库 | 许可 | 决定 | 抄什么（自己实现，零依赖） | 为什么这样定 |
|---|---|---|---|---|
| generative_agents | Apache-2.0 | **照抄公式与字段** | 记忆条目字段（三元组/type/depth/keywords/impact/lastAccess/expiration）、三路分量**先归一再加权**（相关度 3 : 重要度 2 : 新近度 0.5）、新近度指数衰减 `decay^i`（0.99）、反思=计数器累加到位 | 2023 停更、Django+gensim+openai 重栈；但公式与结构纯数学，可无损重写 |
| ai-town | MIT | **照抄思路** | over-fetch 10 倍再精排、三路等权归一化相加、窗口求和触发反思、重要度解析失败兜底 5、lastAccess 节流（5 分钟）、tick 一拍一件事 + 防重入 | 要 Convex（数据库+向量索引+调度器都在云上） |
| graphiti | Apache-2.0 | **照抄两个小算法** | ① RRF `1/(rank+1)` 求和做多路融合；② 事实的 `valid_at`/`invalid_at` 双向时间（不覆盖，写作废时间）；③ 原始→实体→摘要三层 | 要 neo4j + LLM 抽实体；我们本就有结构，不需要抽 |
| langgraphjs | MIT | **照抄接口形状** | `put/getTuple/list/putWrites/deleteThread` 的检查点语义；`get(namespace,key)`/`search(namespacePrefix)` 的命名空间检索；内存实现（嵌套对象 + Map，几十行）；**「中间写入必须按固定顺序重放」** | 运行时 import `@langchain/core`，monorepo 构建重 |
| cognee | Apache-2.0 | 借结构 | 分层桶摘要：按 `maxBucketSize` 分桶、按 level 挂父子、每桶一条摘要；长期记忆（top-k）与会话记忆（最近 N）分开配置 | 要 openai + 向量/图库；它的检索 query 与摘要都靠 LLM |
| LlamaIndexTS | MIT | 借设计 | **按 token 预算逐条装配、加不下就停**；两段预算（先给结构化块，剩下的按比例给「最近发生」）；可插拔块接口（提供内容与分配预算解耦） | monorepo 内部依赖链 |
| mastra | 分块（`ee/` 专有） | 借设计 | **两级压缩阈值 + 提前缓冲**（到预算 20%/50% 就开始准备压缩）；工作记忆=有模板的块，**空模板不许覆盖真实数据**；「取最近 N 条」要写成显式测试 | 非零依赖（zod/lru-cache/xxhash-wasm…）；观察记忆是 21517 行 LLM 子系统；`ee/` 红线 |
| mem0 | Apache-2.0 | 借结构 | **每次记忆变更写一条带时间戳的历史事件**（ADD/UPDATE/DELETE/NONE），本体只存当前状态；只把「确认写成」的记进历史；条目有稳定 id 可回放 | 抽取与「新增还是覆盖」全交给 LLM 裁判；TS SDK 拖 axios/openai/uuid/zod |
| concordia | Apache-2.0 | 只借设计 | 记忆三种取法并存（相似度 top-k + 谓词 scan + 最近 k）、写入按内容去重、上下文按声明顺序拼组件、四拍循环命名（观察/谁动/结算/终止） | 是模拟框架不是库，pip 锁含 torch/vllm，要 embedder |
| letta | Apache-2.0 + **禁令** | 🔴 **只读历史，一行不抄** | （仅思想）核心记忆=有 label + 字符上限的块；上下文按预算分桶；达阈值淘汰老消息保留最近 N | `AGENTS.md:20-31@5bcdd17` 明文禁止把旧实现抄进另一个项目、禁止与其他记忆系统做比较；`main` 只是落地页 |

🔴 两条许可红线：**letta**（项目方禁令，虽然 Apache-2.0）与 **mastra `ee/`**（专有 EE 许可，我们只碰 `packages/memory` 的设计）。

## 2. 我们的三件事怎么做

### 2.1 角色记忆（结构，零依赖）

一条记忆（扩展 `shared/core/mind.js:39` 现有的 `state.memory`）：

```
{ seq,            // 指向 session.ledger 的 seq —— 唯一事实源在账本，记忆只存指针（LIVING §7）
  kind,           // 'event' | 'thought' | 'claim'（按型分链，照 ConceptNode.type）
  tick, sceneId,
  who: [...],     // 在场/被牵动的人
  sig,            // 稳定签名：去重与「同一件事再次发生」判定
  keywords: [...],// 诉求/动词/物件/人名 → 倒排索引
  impact,         // 重要度，**由规则算**，不是 LLM 打分
  depth,          // 0=原始感知，1=巩固，2=再巩固（照 add_thought 的 depth+1）
  activation, consolidation,   // 已有字段，保留
  lastAccess, expires }
```

- **impact（规则给分，替换 LLM 的 poignancy）**：由感知结果直接算，例如
  `impact = clamp(0.4*error + 0.3*(命中 goals ? 1 : 0) + 0.2*(首次发生 ? 1 : 0) + 0.1*min(1, |moved|))`。
  （`error` 来自 `perceive` 的 stopAt/剩余权重，`moved` 来自 `hear`；都是现成的确定性量。）
- **检索（无向量）**：
  - 相关度 = 结构化命中（同一人/同一场 + 诉求通道命中 + 关键词倒排强度），照 ai-town/generative_agents 的「三路各自归一到 0..1 再加权」，权重 相关度 3 : 重要度 2 : 新近度 0.5；
  - 新近度 = `decay^(now - tick)`（decay 取 0.99）；
  - 多路召回（按人 / 按场 / 按关键词）用 **RRF `1/(rank+1)` 求和**融合，避免量纲对齐；
  - 先 over-fetch 3–5 倍再精排（我们数据量小，不必 10 倍）；
  - 命中即更新 `lastAccess`，**以逻辑拍节流**（照 ai-town 的节流思想）。
- **巩固（consolidate）**：每拍把 impact 累加进 `pending`；达阈值就巩固一次——从最近一批原始条目按规则抽出一条 `depth+1` 的 `thought`（关键词取并集、who 取并集、impact 取和/最大）。再上一层用 **分桶分层**（cognee）：每 N 条原始 → 一桶一条摘要，每 M 桶 → 再上一条。两级阈值（mastra）：原始层超预算压成「观察」，观察层超预算压成「反思」。
- **遗忘（forget）**：`activation` 按拍衰减（已有 `mind.tick` 的 0.15/拍）+ `expires` 过期 + 容量上限淘汰；淘汰时**保留高 impact**（珍贵记忆豁免），照 letta「淘汰 30%、保留最近 15 条」的比例思想。

### 2.2 上下文组装

按「块 + 两段预算」装（LlamaIndexTS），顺序显式声明（concordia `concat_contexts`）：

1. 人设块：`def.values/resist/goals/threshold/voice/bio`（有上限，超了按 impact 裁）
2. 关系块：`state.trust` 与 `others`
3. 本场块：goal/rules/在场人物/本拍可见线索（tell）
4. 「最近发生」：按预算逐条加，**加不下就停**（不是全塞）
5. 「相关长期记忆」：`recall()` 的结果（带分数明细，便于调试与可学性）

LLM 只出现在这一步的最后：把**已经算好的结构结果**翻成一句人话（内心话/说法）。措辞可换、结构不可换。

### 2.3 逻辑循环（四拍，全部结构化）

1. **观察**：谁被牵动（`perceive` 的通道与停层）→ 写记忆（impact 由规则算）
2. **决定**：演员按 value/policy 规则打分选，玩家给输入，环境给事件
3. **结算**：effects 写 claim/trust/flags/clock
4. **落账**：账本 append（seq）→ 记忆写回（存 seq）→ 节流 lastAccess

- 幂等与顺序（langgraph 的教训）：同一 `(tick, inputId)` 只处理一次；同拍顺序固定「玩家输入 → 环境 → 演员」；种子派生只用 `makeRng`（`shared/core/rng.js:4`），**禁 Math.random / Date**。
- 每拍产出「状态快照 + 该拍副作用」，可回放（对应 `put`/`putWrites`）。
- LLM 的位置：只有翻译层（措辞）。**开发辅助**（写代码、重构、review）也算 LLM 的合法用法，但不在运行时。

## 3. 给 kernel2 的接口建议（store / recall / consolidate / forget）

```js
createMemoryStore({ capacity, decay, consolidateAt, bucketSize, overFetch })
  → {
      // 写：去重(sig) + 规则算 impact + 只存账本 seq
      remember(entry) -> id

      // 读：结构化查询，无自然语言、无向量
      //   query = { actorId, sceneId, tick, appeals:[], keywords:[], people:[],
      //             need: 'decide' | 'speak', k, budget }
      // 多路召回 → RRF 融合 → 精排（归一再加权）→ 更新 lastAccess（按拍节流）
      recall(query) -> [{ id, seq, kind, tick, depth, impact, score:{relevance,importance,recency,rrf} }]

      // 巩固：计数器/两级阈值触发；产出 depth+1 条目；分桶分层
      consolidate({ toTick }) -> [entry]

      // 遗忘：activation 衰减 + 过期 + 容量淘汰（高 impact 豁免）
      forget({ toTick }) -> { dropped: [id], kept: n }

      tick({ toTick }) -> void          // 只推进时序（activation/lastAccess）
      save() / restore(saved)
    }
```

- **接缝**：`shared/core/mind.js:39` 的 `state.memory` 由它托管；`session.ledger.entries` 是唯一事实源（记忆存 seq，不复制事实）；`session.save()`（`shared/engine/session.js:23/@:116`）里加一条 `memory`。
- **不引入**：向量库、embedding、图数据库、任何 npm 包；浏览器与 Node 共用纯 ES 模块。
- **可测**：`recall` 返回分数明细；`consolidate`/`forget` 返回被处理/被丢的 id 列表——三者都能写成确定性断言（同输入同输出），这样「记忆真的变了」这件事可以被脚本验证，而不是靠读文本感受。
