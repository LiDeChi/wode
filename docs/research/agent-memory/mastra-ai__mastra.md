# mastra-ai/mastra

- 克隆与版本：`/tmp/oss-audit/mastra-ai_mastra` @ `3014f061`（2026-10-11，321M）
- 许可：**分块**。`LICENSE.md:1-15@3014f061` 原文：「Portions of this software are licensed as follows:」——**任何叫 `ee/` 的目录下的内容（如 `@mastra/core/auth/ee`、`@mastra/core/agent-builder/ee`、`@mastra/editor/ee`）适用 `ee/LICENSE`**；`ee/LICENSE:1-5@3014f061` 是 **MASTRA ENTERPRISE EDITION LICENSE Version 2.0（专有，Kepler Software Inc.，2026-09-22 生效）**；其余内容 Apache-2.0。
- 🔴 **红线**：`ee/` 下的任何代码都不能抄进我们的项目（专有许可）。好在我们关心的记忆包在 `ee/` 之外：`packages/memory`（`@mastra/memory` `1.37.0-alpha.2`，`package.json` license `Apache-2.0`）✅
- 技术栈：TypeScript monorepo（turbo）；记忆包 dependencies = `@mastra/schema-compat`、`async-mutex`、`diff`、`json-schema`、`lru-cache`、`probe-image-size`、`xxhash-wasm`、`zod` + peer `@mastra/core` ⇒ **非零依赖**
- 测试/CI：大量 vitest `.test.ts`（含 `token-limited-history.test.ts`、`merge-working-memory.test.ts`、`semantic-recall-embedder.test.ts`）、CI 36 个 workflow
- 形态：JS 世界里最完整的 agent 记忆包之一。**它的「观察记忆」是一套 21517 行的 LLM 子系统**——我们要的只是它的阈值设计与工作记忆形状

## 1. 记忆结构（存什么字段）

- `packages/memory/src/index.ts:451@3014f061` — `export class Memory extends MastraMemory`（该文件 4187 行）。
- 三类记忆并存：**工作记忆（working memory）**、**语义回忆（semantic recall）**、**消息历史（token 限额）**。
- 工作记忆：`index.ts:581-613@3014f061`（配置与合并）、`:1071@3014f061` `workingMemory: string`；它是一个 **模板化的 markdown 块**（可有 schema 也可纯模板）。
- 消息历史：`index.ts:806@3014f061` 起按 `lastMessages` / `messageHistory` 归一化；`:846@3014f061` 的注释点出一个坑：「Without this fix, `lastMessages: 64` returns the OLDEST 64 messages, not the last 64」——**「取最近 N 条」很容易写成「取前 N 条」**，这是我们要小心的地方。
- 语义回忆：`index.ts:805@3014f061`、`:899-943@3014f061`（`topK`、`messageRange`、`scope: thread|resource`）。
- 观察记忆（observation memory）：`processors/observational-memory/**`（共 21517 行；`observer-agent.ts`、`reflector-agent.ts`、`thresholds.ts`、`token-counter.ts`、`summarize.ts`、`activation-ttl.ts`、`temporal-markers.ts`、`subconscious/`、`extractor.ts`、`observation-groups.ts`）。它是**两级压缩**：消息 → 观察（observations）→ 反思（reflection）。

## 2. 检索与打分

- `index.ts:772@3014f061` — `async recall(`：把历史消息 + 语义回忆 + 工作记忆组装成给模型的上下文。
- 语义回忆靠向量检索（`semanticRecall.topK` + `messageRange` 把命中消息的上下文一起带上）。
- 观察记忆里的检索是**分页游标**式的：`tools/om-observations.ts:132@3014f061` `pageObservationGroups(options)`，游标由 `groupCursor(groupId, recordId?)`（`:79@3014f061`）生成；召回工具支持两种模式（`:96@3014f061` 附近拼出 `recall({"mode": "observations"|"messages", ...})`），并提供时间线回溯 `findGroupTimeline`（`:58@3014f061`）。
- ⇒ **记忆不是「一次 top-k」，而是「可翻页的组」**：一组观察 = 一段被压缩的历史，能按组往前后翻。

## 3. 巩固/遗忘/反思（阈值设计是重点）

- `processors/observational-memory/constants.ts:4-38@3014f061` — `OBSERVATIONAL_MEMORY_DEFAULTS`：
  - 观察层：`observation.messageTokens = 30_000`（消息攒到 3 万 token 触发观察）、`maxTokensPerBatch = 10_000`（一批最多 1 万 token）、`bufferTokens = 0.2`（到 20% 就开始异步缓冲）、`bufferActivation = 0.8`（到 80% 才真正启用缓冲）。
  - 反思层：`reflection.observationTokens = 40_000`（**观察再攒到 4 万 token 触发反思**）、`bufferActivation = 0.5`。
  - ⇒ **两级阈值 + 提前异步缓冲**：压缩不是等到爆了才做，而是到 20%/50% 就开始在后台准备。遗忘：观察有 `activation-ttl.ts`（激活度与存活时间），过期即被丢弃。
- 工作记忆的更新有**防丢数据**逻辑：`tools/working-memory.ts:317-338@3014f061`，如果模型返回的内容基本等于空模板且已有真实数据，就**跳过这次更新**并记一条警告（「Attempted to replace existing working memory with empty template. Update skipped to prevent data loss.」）。这个兜底很值得抄。
- 反思与观察都由 LLM agent 完成（`observer-agent.ts`、`reflector-agent.ts`）。

## 4. 循环里的结构化步骤

- 记忆包自身是「processor（在生成前注入/生成后收割）」的模式；观察记忆有一套独立的批次/阈值状态机（token-counter + thresholds + buffering-coordinator）。
- 结构化的部分：**什么时候压缩、压缩多少、保留多少**（全是 token 计数与比例），以及工作记忆的替换语义。

## 5. 对《窃符》的结论

- **可零依赖复刻的设计**：① **两级压缩阈值**（原始 → 摘要 → 再摘要），并且阈值用「预算的比例」（20%/50%/80%）而不是绝对拍数；② **提前缓冲**：到 20% 就开始准备压缩，不等爆；③ 工作记忆 = 有模板的 markdown/结构化块，且**空模板不许覆盖真实数据**；④ 「取最近 N 条」要显式测（`index.ts:846@3014f061` 那个坑）；⑤ 记忆按「组」组织并可前后翻页（对应我们的「一局 = 若干组拍」）。
- **LLM 在哪、为什么不采用**：观察与反思整个 21517 行子系统都是 LLM agent（观察者、反思者、潜意识、抽取器）。按 m01618：**压缩后的条目必须由规则生成**（谁在场/谁被牵动/做了什么/结果），措辞交给翻译层；我们不可能也不应该引入这套。
- **直接依赖**：不采用。理由：非零依赖（zod/lru-cache/xxhash-wasm…）+ peer `@mastra/core`；且整仓 `ee/` 专有，划界成本高。
