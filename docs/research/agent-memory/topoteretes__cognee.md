# topoteretes/cognee

- 克隆与版本：`/tmp/oss-audit/topoteretes_cognee` @ `0ec7a9f`（cognee 1.6.3）
  （注：第一次 `git clone --depth 1` 报 `fatal: early EOF / invalid index-pack output`，重试成功，171M）
- 许可：Apache-2.0（`LICENSE` 头）✅ 可用
- 技术栈：Python；`pyproject.toml:22-31` 一带 dependencies 里有 `openai>=1.80.1`、`python-dotenv`、`pydantic`、`pydantic-settings` 等，还要向量库/图库
- 测试/CI：tests 4 处、**CI 63 个 workflow**（是清单里 CI 最重的之一）
- 形态：一个「记忆引擎」框架，主打给 agent 加记忆的装饰器 + 知识图谱式的分层摘要

## 1. 记忆结构（存什么字段）

- 记忆本体是图谱 + 向量（实体、关系、摘要、会话轨迹），字段细节分散在 `cognee/modules/**`。
- **会话记忆**：`cognee/modules/agent_memory/runtime.py:28@0ec7a9f` — `AgentMemoryConfig`：`with_session_memory`（`:32@0ec7a9f`）、`save_session_traces`（`:33@0ec7a9f`）、**`session_memory_last_n=5`**（`:39@0ec7a9f`，会话记忆只取最近 5 条）、`session_id`（`:40@0ec7a9f`）、`session_trace_summary`（`:43@0ec7a9f`）、`persist_session_trace_after`（`:44@0ec7a9f`）、`persist_session_trace_raw_content`（`:45@0ec7a9f`）。
  ⇒ **长期记忆与会话记忆是两套**：长期靠检索，会话靠「最近 N 条」。
- 同文件 `:50@0ec7a9f` `AgentScope`、`:59@0ec7a9f` `AgentMemoryContext`、`:79-94@0ec7a9f` get/set/reset。

## 2. 检索与打分

- `cognee/modules/agent_memory/decorator.py:34-47@0ec7a9f` — `def agent_memory(*, agent_session_name=None, with_memory=True, with_session_memory=False, save_session_traces=False, memory_query_fixed=None, memory_query_from_method=None, memory_system_prompt=None, **memory_top_k=5**, memory_only_context=False, **session_memory_last_n=5**, ...)`。
  ⇒ 用法是**装饰器**：给一个方法挂上记忆，调用前自动召回 top_k=5 并注入参数。默认值本身有参考意义（长期 5 条 + 会话 5 条）。
- 打分细节在它的检索模块里（多路 + 图），没有像 graphiti 那样一个独立的小而清晰的融合函数。

## 3. 巩固/遗忘/反思（分层摘要是它的特色）

- `cognee/tasks/memify/global_context_index/build.py:26@0ec7a9f` — `BuildOptions`：`max_bucket_size`（`:29@0ec7a9f` 每个桶最大条目数）、`bucketing_strategy`（`:31@0ec7a9f`）、`entities_by_summary_id`（`:33@0ec7a9f`）。
- 同文件 `:38@0ec7a9f` — `group_buckets_by_level`：**按 level 分组**（分层的层）；`:47@0ec7a9f` `apply_bucket_assignments`（把子桶挂到父桶）；`:57@0ec7a9f` `source_collection_for_level`；`:63@0ec7a9f `place_graph_items`。
- 同目录还有 `summarize.py` / `persist.py` / `update.py`、`bucketing/{graph,vector}/placement`。
- **实体描述巩固**：`cognee/tasks/memify/consolidate_entity_descriptions/{read_neighborhood, generate_type_description, rewrite_entities, describe_types}.py` —— 读邻居、生成类型描述、重写实体。
- 摘要条目模型：`cognee.tasks.summarization.models.GlobalContextSummary`（在 `build.py:8@0ec7a9f` 被 import）。
- ⇒ 「巩固」在这里 = **把一批条目按大小分桶、按层挂父子、每桶写一条摘要，越往上越抽象**；遗忘没有显式机制（靠重建索引）。

## 4. 循环里的结构化步骤

- 装饰器模式决定了它的循环位置：**方法调用前召回、调用后写回**（`save_session_traces`）。结构化的是「什么时候召回/写回」「取多少条」，语义理解全交给 LLM。

## 5. 对《窃符》的结论

- **可零依赖复刻的设计**：① **分层桶摘要**：条目按 `max_bucket_size` 分桶、桶按 level 挂父子，每桶一条摘要——这正好是「一局的几十拍 → 一局的摘要 → 一位角色对整件事的结论」的现成结构，且分桶与挂父子**纯粹是数组操作，零依赖**；② 长期记忆（top-k 检索）与会话记忆（最近 N 条）分开配置（`memory_top_k=5`、`session_memory_last_n=5`）；③ 会话轨迹的落库策略可配（每次之后/事后、存原文或只存摘要）。
- **LLM 在哪、为什么不采用**：装饰器内部「用哪句话去检索」「摘要写成什么」都靠 LLM（`memory_query_from_method`、`memory_system_prompt`）；巩固时 `read_neighborhood`/`rewrite_entities` 也让 LLM 重写描述。按 m01618：**检索的 query 由结构生成**（当前场景 + 在场人物 + 正在动的诉求），摘要只在翻译层出现。
- **直接依赖**：不采用。理由：要 openai + 向量/图库，依赖重；可取的是它的分桶分层与装饰器式时机。
