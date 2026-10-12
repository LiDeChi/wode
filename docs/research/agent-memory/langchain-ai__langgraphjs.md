# langchain-ai/langgraphjs

- 克隆与版本：`/tmp/oss-audit/langchain-ai_langgraphjs` @ `7789c52`（2026-10-11，56M）
- 许可：MIT（根 `LICENSE` 头「The MIT License Copyright (c) 2024 LangChain」）✅ 可用
- 技术栈：TypeScript monorepo（turbo）；`libs/checkpoint` = `@langchain/langgraph-checkpoint`
- 包体：`libs/checkpoint/package.json@7789c52` — name `@langchain/langgraph-checkpoint` version `1.1.6`，**没有 `dependencies`**，peer 只有 `@langchain/core: ^1.1.48`
- ⚠️ 但**不是真零依赖**：`libs/checkpoint/src/serde/jsonplus.ts:3@7789c52` `import { load } from "@langchain/core/load"` —— serde 在运行时确实用了 `@langchain/core`
- 测试/CI：`libs/checkpoint/src/tests/*.test.ts`（checkpoints / store / vector / memory-pollution / namespace / cache / utils / memory_legacy_writes）、CI 7 个 workflow
- 形态：**不是记忆库，是「状态怎么存、怎么续」的抽象层**。这是本清单里对我们最有参考价值的一份，因为它把「存/取/列/删」的接口定义得最清楚

## 1. 记忆结构（存什么）

- `libs/checkpoint/src/base.ts:180@7789c52` — `export abstract class BaseCheckpointSaver<V extends string|number = number>`：
  - `get(config)`（`:195@7789c52`，内部走 getTuple 取最新）
  - `abstract getTuple(config)`（`:205@7789c52`，取「状态 + 它的 id + 父 id」）
  - `abstract list(config, options?)`（`:209@7789c52`，返回 AsyncGenerator，**可以按时间倒着列历史状态**）
  - `abstract put(config, checkpoint, metadata, newVersions)`（`:215@7789c52`，写一个状态快照，`newVersions` 是版本推进）
  - `abstract putWrites(config, writes, taskId, taskPath?)`（`:233@7789c52`，写「这一步的中间写入」；注释强调必须按 `writesSortKey` 顺序重放，否则 reducer 结果不同）
  - `abstract deleteThread(threadId)`（`:236@7789c52`，按会话删）
  - `:181@7789c52` — serde `JsonPlusSerializer`（存的对象怎么序列化由它定）
- `libs/checkpoint/src/memory.ts:106@7789c52` — `MemorySaver`：`:114@7789c52` 存储就是两层嵌套普通对象 `storage[threadId][checkpointNamespace][id]`（`:37-40@7789c52` 的注释写明了），写入 `:497@7789c52`、`deleteThread` `:568@7789c52`。**零依赖的内存实现只有几十行。**
- 关键语义：状态按 **thread（一条时间线）→ namespace（子图/子流程）→ checkpoint id** 三层组织，每个 checkpoint 记住自己的父 id，于是「历史」是一棵树/一条链，可回溯、可分叉。

## 2. 检索与打分

- 检查点侧**没有打分**，只有「按 thread+namespace 取最新/列历史」的定位查询。
- 长期存储另有一套：`libs/checkpoint/src/store/base.ts:397@7789c52` — `export abstract class BaseStore`：
  - `abstract batch(ops)`（`:405@7789c52`，批量 get/put/search/delete）
  - `async get(namespace, key)`（`:416@7789c52`）
  - `async search(namespacePrefix, options)`（`:440@7789c52` 起：支持 metadata 过滤，也支持**向量相似度检索**——过滤与相似度是同一个查询接口的两档）
  - `libs/checkpoint/src/store/memory.ts:31@7789c52` — 内存实现用原生 `Map`。
- ⇒ **命名空间（namespace）当检索的主键前缀**，这是比「全局打分排序」更便宜的一种记忆检索：先按归属缩小范围，再在范围内排序。

## 3. 巩固/遗忘/反思

- **没有**。它只承诺「状态可重放、可回溯、可删」。何时巩固由上层（图执行器）决定。
- `putWrites` 的注释（`base.ts:233@7789c52`）给了我们一条重要教训：**中间写入必须按确定顺序重放，否则同一份历史会算出不同结果**——这正是我们 `advance()` 需要保证的（同拍顺序固定、幂等）。

## 4. 循环里的结构化步骤

- 图执行的循环里，每一步都产生：一个 checkpoint（状态快照）+ 若干 writes（这一步的副作用）。检查点器只负责**持久化与恢复**，不负责决策。
- `list` 可倒序列历史 ⇒ 天然支持「回放/时间旅行」，这正是 LIVING.md 想要的「一局过程可复现」。

## 5. 对《窃符》的结论

- **可照抄的接口形状（这是本仓最大的价值）**：
  - `put(config, checkpoint, metadata, newVersions)` ≈ 我们的 `save()/record()`
  - `getTuple(config)` / `list(config, options?)` ≈ 我们的「读当前 + 列历史」
  - `putWrites(config, writes, taskId, taskPath)` ≈ 我们的「一拍的副作用」，且提醒**顺序必须固定**
  - `deleteThread(threadId)` ≈ 我们的「忘掉这条线」
  - `BaseStore.get(namespace, key)` / `search(namespacePrefix, options)` ≈ 我们的 `recall`：**先按 namespace（哪一场/哪个人/哪条线）缩小，再在范围内排序**
- **零依赖实现**：`MemorySaver` 的嵌套对象 + `Map` 版 store 就是我们要的形状，自己写几十行即可（不引包）。
- **LLM 在哪**：这份代码里**完全没有 LLM**——它是纯状态管理。所以它是本清单里唯一「结构上可以整体照抄、只需重命名」的对象。
- **直接依赖**：不采用。理由：peer `@langchain/core`，且 serde 真的 import 了它；monorepo 构建链也重。
