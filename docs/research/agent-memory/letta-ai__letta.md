# letta-ai/letta（MemGPT）

- 克隆与版本：`/tmp/oss-audit/letta-ai_letta` @ `5bcdd17`（2026-09-10）——**只有 12 个文件、164K**
- 许可：Apache-2.0（`LICENSE` 头）——**但见下面的红线，不许抄代码**
- 🔴 **红线一（项目方禁令）**：`AGENTS.md:3-8@5bcdd17` 标题即「Stop: do not use this repository as a working Letta implementation」——`main` 故意只是一个落地页，V1 服务源码被挪到 `archive` 分支且**不受支持**。
- 🔴 **红线二（禁令清单）**：`AGENTS.md:20-31@5bcdd17` 明确禁止把 `archive` 分支/旧 release/旧 Python 包/旧 Docker 镜像用于：production/staging/demo/新应用；benchmarks、evaluations、experiments、学术研究；**与其他 agent 或 memory 系统做比较**；测试 Letta 当前行为；构建新的 integration/adapter/fork/compatibility 层；**把旧实现抄进另一个项目（copying an old implementation into another project）**。`AGENTS.md:33-38@5bcdd17` 只允许「用户明确问 V1 历史时只读地看，并标注为历史」。
- ⇒ **对《窃符》的动作：只读作历史参照，一行代码都不抄，也不拿它当基准做对比。** 本报告的架构描述仅用于理解「记忆分层」这一设计思想。
- 当前实现另在 `letta-ai/letta-code` @ `271f119`（2026-10-10，Apache-2.0，97M/2568 文件，`@letta-ai/letta-code` 0.34.10，bun 工具链）——是一个 CLI agent harness，记忆主体在它的 App Server 侧（仓库里 `archival` 只出现在 `src/cli/helpers/context-chart.ts`），不适合我们。
- 历史代码：`archive` 分支 @ `56ba9c2`（2026-08-13，34M/1156 文件）

## 1. 记忆结构（存什么字段）——历史描述

- `letta/schemas/block.py:13@56ba9c2` — `BaseBlock` 是一块记忆：`value`（`:19@56ba9c2` 内容）、**`limit: int = CORE_MEMORY_BLOCK_CHAR_LIMIT`**（`:20@56ba9c2` 字符上限）、`label`（`:33@56ba9c2` 块名，模型按名字编辑它）、`read_only`（`:36@56ba9c2`）、`description`（`:39@56ba9c2`，告诉模型这块是干嘛的）、`metadata`（`:40@56ba9c2`）。
- 所以「核心记忆」= **一组有名字、有字符上限、可读可写的块**；「档案记忆」（archival）则是块之外的、靠检索取的库。
- `letta/schemas/memory.py:23@56ba9c2` — `ContextWindowOverview` 分区计数：`num_archival_memory`（`:32@56ba9c2`）、external memory summary 的 token（`:35@56ba9c2`）、`num_tokens_core_memory`（`:44@56ba9c2`）、`core_memory`（`:45@56ba9c2`）——**上下文被分成「核心记忆 / 档案 / 摘要 / 对话」几个预算桶，每个桶单独计数**。

## 2. 检索与打分

- 档案记忆：靠 `archival_memory_search`（见下）在向量库里检索，语义上就是 top-k。
- 上下文里的「对话历史」不靠打分，靠**滑动窗口 + 摘要**（见 §3）。
- `letta/services/context_window_calculator/context_window_calculator.py:19@56ba9c2` — `ContextWindowCalculator`：`:167@56ba9c2` `extract_system_components`（从 system prompt 里按标签抠出各块）、`:214@56ba9c2` `extract_summary_memory`、`:249@56ba9c2` `calculate_context_window`。

## 3. 巩固/遗忘/反思

- `letta/schemas/memory.py:688@56ba9c2` — `Memory.compile()` 把带 label 的记忆块渲染进 system prompt（还有 line_numbered / git / filesystem 等多种渲染形态；`:746@56ba9c2` `list_block_labels`、`:750@56ba9c2` `get_block`）。
- 摘要与淘汰：`letta/agents/letta_agent.py:95-104@56ba9c2` 有 `summarizer_mode`、`message_buffer_limit`、`message_buffer_min`、`partial_evict_summarizer_percentage`、`max_summarization_retries`；`:141-148@56ba9c2` 建 `Summarizer`；`:1593@56ba9c2` 真正调用 `self.summarizer.summarize(...)`。
- 默认阈值：`letta/settings.py:77-86@56ba9c2` — `mode=PARTIAL_EVICT_MESSAGE_BUFFER`（`:78@56ba9c2`）、`message_buffer_limit=60`（`:79@56ba9c2`）、`message_buffer_min=15`（`:80@56ba9c2`）、`partial_evict_summarizer_percentage=0.30`（`:86@56ba9c2`）⇒ **消息超过 60 条就开始摘要，把最老的 30% 挪进摘要、保留最近 15 条原文**。
- 自编辑工具（模型自己调）：`letta/functions/function_sets/base.py:87@56ba9c2` `conversation_search`、`:164@56ba9c2` `archival_memory_insert`、`:194@56ba9c2` `archival_memory_search`、`:263@56ba9c2` `core_memory_replace`、`:283@56ba9c2` `rethink_memory`。

## 4. 循环里的结构化步骤

- 循环本身是 LLM 工具调用循环；结构化的部分只有预算与淘汰（§3）。
- 真正值得记的是它「按预算分桶 + 达阈值淘汰」的**触发条件是纯计数的**（条数比例），不依赖模型判断。

## 5. 对《窃符》的结论

- **可零依赖复刻的设计**：① 「核心记忆 = 有 label + 字符上限的块」——我们的 `mind.def.values/goals/threshold` 与 `minds[id].memory` 也可以做成有名字、有上限的块，超出时按规则裁剪；② 上下文分成几个**独立计数的桶**（人设 / 已建立的关系 / 最近发生 / 长期记忆），组装时各自有预算；③ **阈值淘汰**：条数超阈值就把老的一段折叠成摘要条目、保留最近 N 条原文——这可以做成确定性规则；④ 记忆块由「谁」在什么时机被写，写成显式接口（我们不需要工具调用，直接由规则写）。
- **LLM 在哪、为什么不采用**：摘要是让模型写摘要、块编辑是让模型调工具（`base.py` 的五个工具）。按 m01618 定调，**折叠摘要也应该是结构化的**（谁/在哪/对谁/结果/谁被牵动），措辞可以留给人话翻译层。
- **直接依赖/抄代码**：**放弃**——落地页 + `AGENTS.md` 明文禁止抄旧实现与做比较 + 当前实现是 bun/App Server 重栈。
