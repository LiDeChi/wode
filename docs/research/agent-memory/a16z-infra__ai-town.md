# a16z-infra/ai-town

- 克隆与版本：`/tmp/oss-audit/a16z-infra_ai-town` @ `8e05997`（2026-08-25，28M）
- 许可：MIT（`LICENSE` 头）✅ 可用
- 技术栈：TypeScript + **Convex**（BaaS：数据库 + 定时任务 + 向量索引一体）+ OpenAI；要跑必须部署 Convex 后端
- 测试/CI：有 vitest `*.test.ts`，但**没有 `.github/workflows`**（CI 数为 0）
- 形态：一个可玩的多人在线小镇（浏览器里看小人走来走去）。它的记忆是「LLM 写摘要 + 向量检索 + 三路打分」，**JS 世界里最贴近我们需求的一份实现**

## 1. 记忆结构（存什么字段）

- `convex/agent/schema.ts:6-@8e05997` — `memoryFields`：`description`（`:8@8e05997`，一条记忆就是一段第一人称描述）、`embeddingId`（`:9@8e05997`，指向向量表）、**`importance`**（`:10@8e05997`，重要度数字）、`data` 联合类型（`:12@8e05997`，带 payload）。
- `convex/agent/schema.ts:32@8e05997` — `memoryTables`：`memories` 表带 `embeddingId`、`playerId_type` 索引（`:33-35@8e05997`）；`memoryEmbeddings` 表（`:37-43@8e05997`）带 `vectorIndex('embedding', {vectorField:'embedding'})`（`:40@8e05997`）——**结构字段与向量分开存，靠 id 关联**。
- 写入：`convex/agent/memory.ts:22-80@8e05997` `rememberConversation` = 拿最近对话 → 让 LLM 总结成第一人称描述 → `calculateImportance(description)`（`:68@8e05997`）→ `fetchEmbedding`（`:69@8e05997`）→ 落库。

## 2. 检索与打分

- `convex/agent/memory.ts:158@8e05997` — `searchMemories(ctx, playerId, searchEmbedding, n=3)`：先 `ctx.vectorSearch('memoryEmbeddings','embedding',{filter, limit: n * MEMORY_OVERFETCH})`，**再重排**。
- `memory.ts:14@8e05997` — `MEMORY_OVERFETCH = 10`：先取 10 倍候选，再从中挑 3 条。这是「先粗召回、再精排」的工程写法，比只看 top-k 稳。
- `memory.ts:205-217@8e05997` — 精排公式 = `normalize(relevance) + normalize(importance) + normalize(recencyScore)`，三项各自归一到 0..1 后相加（等权）。**与 generative_agents 同为三路加权，但这里权重相等，且相关度用向量 `_score`。**
- `memory.ts:11@8e05997` — `MEMORY_ACCESS_THROTTLE = 300_000`（5 分钟）：`lastAccess` 的更新被节流，避免每次检索都写库。

## 3. 巩固/遗忘/反思

- `memory.ts:240-268@8e05997` — `calculateImportance` 让 LLM 打 1-10 分；**解析失败就默认 5**（`:262-266@8e05997`）——「解析不出来给中位数」这个小兜底值得抄。
- `memory.ts:339-348@8e05997` — 反思触发：看**最近 100 条记忆的重要度之和 > 500** 就触发一次反思；`:375@8e05997` 让 LLM 产出 insights 写回记忆。⇒ 与 generative_agents 的「计数器扣到 0」同类，但这里是**窗口求和**，两者都是纯计数规则。
- 遗忘：没有删除/衰减，仍是只增。

## 4. 循环里的结构化步骤

- `convex/aiTown/agent.ts:52@8e05997` — `tick(game, now)`：每个 tick 推进所有 agent。
- `agent.ts:242@8e05997` — `startOperation`，`:246@8e05997` 用 `inProgressOperation` **防重入**（一个 agent 同一时刻只干一件事）；`:251@8e05997` `scheduleOperation`（把下一拍排进调度器）；`:289@8e05997` `runAgentOperation`，`:291@8e05997` 一个大 switch 按活动类型分发。
- ⇒ 「一拍一件事 + 防重入 + 把下一拍排回去」这套是**确定性调度**，可以直接映射到《窃符》的逻辑拍。

## 5. 对《窃符》的结论

- **可零依赖复刻的设计**：① 记忆的存储字段（描述 + 重要度 + 时间 + 指向结构化 payload 的 id）；② **over-fetch 10 倍再精排**；③ 三路归一化加权（我们把「相关度」从向量换成结构化命中，重要度由规则算，新近度用 decay）；④ 反思的**窗口求和阈值**；⑤ 重要度解析失败的默认值兜底；⑥ 检索副作用（lastAccess）加节流；⑦ tick 循环的防重入与「排下一拍」。
- **LLM 在哪、为什么不采用**：`memory.ts:22-80@8e05997` 的对话摘要、`:240-268@8e05997` 的重要度打分、`:375@8e05997` 的 insights 生成。按 m01618：**重要度必须由结构算**（例如「这次牵动了谁、动了多少、有没有命中目标」直接给分），insights 要变成规则抽出的条目。
- **直接依赖**：不采用。理由：靠 Convex 运行时（数据库 + 向量索引 + 调度器都是它的云服务），我们零依赖、浏览器与 Node 共用。
