# run-llama/LlamaIndexTS

- 克隆与版本：`/tmp/oss-audit/run-llama_LlamaIndexTS` @ `ba24377`（2026-03-11，93M）
- 许可：MIT（根 `LICENSE` 头「The MIT License Copyright (c) LlamaIndex」）✅ 可用
- 技术栈：TypeScript monorepo（`packages/{core,llamaindex,providers,workflow,readers,...}`）；`packages/core` 自身带一串内部依赖包，**不是零依赖**
- 测试/CI：`packages/core/tests/memory` 有测试（该 glob 未匹配到计数，实际存在），CI 6 个 workflow
- 形态：JS 世界里最干净的「上下文预算」实现——**记忆模块只有 445 行**，是清单里最适合直接读代码的一份

## 1. 记忆结构（存什么字段）

- `packages/core/src/memory/memory.ts:49@ba24377` — `export class Memory<...>`：它不定义「一条记忆」的字段，而是**装两类东西**：可插拔的「记忆块（memory blocks）」+ 短期消息列表。
- 记忆块（结构化长期记忆）是抽象类 + 三种实现：
  - `packages/core/src/memory/block/base.ts:25@ba24377` — `BaseMemoryBlock`（抽象：`get(...)` 产出可注入的 message）
  - `packages/core/src/memory/block/static.ts:111@ba24377` — `StaticMemoryBlock`（静态文本块，比如人设、规则）
  - `packages/core/src/memory/block/fact.ts@ba24377` — `FactExtractionMemoryBlock`（事实库，靠 LLM 抽取）
  - `packages/core/src/memory/block/vector.ts:152@ba24377` — `VectorMemoryBlock`（向量检索块，靠 embedding）
- ⇒ **「长期记忆」被抽象成「块」，每块自己负责产出内容**；组装器不关心块里面是静态文本、事实库还是向量库。这与 letta 的「有 label 的块」异曲同工，但实现是 TS 且接口更小。

## 2. 检索与打分

- 记忆模块本身**不打分**：检索打分被下沉到块实现里（`VectorMemoryBlock` 用向量；`FactExtractionMemoryBlock` 用 LLM 抽取）。
- `memory.ts:151@ba24377` — `async get(`：组装最终上下文；`:200@ba24377` `getLLM(...)`（`:208-210@ba24377` 按模型的上下文窗口决定 tokenLimit）。
- ⇒ 对我们的启发：**检索不该在组装器里做，而该是「块」的能力**；组装器只做预算分配。

## 3. 巩固/遗忘/反思（token 预算分配是重点）

- `memory.ts:12@ba24377` — `DEFAULT_TOKEN_LIMIT = 30000`；`:63/:95@ba24377` `tokenLimit`。
- `memory.ts:295-316@ba24377` — 私有 `getMemoryBlockMessages(..., tokenLimit?)`：`:316@ba24377` `if (tokenLimit && addedTokenCount + messageTokenCount > tokenLimit) break;` —— **按 token 预算逐条加，加不下就停**（不是按条数截断）。
- `memory.ts:67/:96-97@ba24377` — `shortTermTokenLimitRatio`（默认常量 `DEFAULT_SHORT_TERM_TOKEN_LIMIT_RATIO`）；`:240-241@ba24377` `const shortTermTokenLimit = Math.ceil(remainingTokenLimit * this.shortTermTokenLimitRatio)`；`:345@ba24377` 也用 `this.tokenLimit * this.shortTermTokenLimitRatio`。
- ⇒ **两段预算**：先减掉系统提示与记忆块的开销，剩下的按比例切一块给短期消息。`memory.ts:293@ba24377` 的注释也提醒：记忆块自己也有 token 上限。
- 遗忘/反思：没有。只有「加不下就不加」。

## 4. 循环里的结构化步骤

- 记忆模块只做「取」：`get()` 返回一组 message（块的内容 + 短期消息），塞进下一次 LLM 调用。没有写入策略、没有触发时机——**写入完全由调用方决定**。

## 5. 对《窃符》的结论

- **可零依赖复刻的设计**：① **按 token 预算逐条装配、加不下就停**（我们的上下文按「拍/条」装，也应该有一个显式的预算与「装不下就停」的规则，而不是全塞）；② **两段预算**：先给结构化块（人设/规则/关系）留够，再按比例给「最近发生」；③ **块接口**：让「谁提供内容」与「怎么分配预算」解耦（我们可以在内核里做成 `sources: [{id, budget, produce(ctx)}]`）；④ 组装器不负责检索（检索属于块/记忆本身的能力）。
- **LLM 在哪、为什么不采用**：`FactExtractionMemoryBlock`（`block/fact.ts@ba24377`）用 LLM 抽事实、`VectorMemoryBlock`（`block/vector.ts:152@ba24377`）要 embedding。按 m01618：事实我们本来就以结构存在（`claims`/`trust`/`values`），**不需要抽取**；「取哪些进上下文」应由结构规则（在场、相关、刚发生）决定，向量不是必需。
- **直接依赖**：不采用。理由：monorepo 内部依赖链（`@llamaindex/core` 及 providers）；可取的是它的预算算法与块接口，自己写不到一百行。
