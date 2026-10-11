# google-deepmind/concordia

- 克隆与版本：`/tmp/oss-audit/google-deepmind_concordia` @ `7459fc2`（2026-10-08，254M）
- 许可：Apache-2.0（`LICENSE` 头）✅ 可直接用，无附加条款
- 技术栈：纯 Python。`requirements.txt` 是 pip-compile 锁（torch、vllm、langchain、fastapi、uvicorn、pandas、numpy）→ 装起来很重，且真跑起来要一个 embedding 模型
- 测试/CI：有 `*_test.py` 与 pytest 配置，但都要先装重依赖；无轻量单测可白嫖
- 形态：一个「多智能体社会模拟」框架，不是记忆库。它的价值在于**上下文是怎么拼出来的**与**GM/实体怎么分工**

## 1. 记忆结构（存什么字段）

- `concordia/associative_memory/basic_associative_memory.py:53-54@7459fc2` — 记忆银行的底层就是一张表：`pd.DataFrame(columns=['text','embedding'])`。**没有结构化字段**：一条记忆 = 一段文本 + 它的向量。
- 同文件 `:104-113@7459fc2` — 去重：`hash(tuple(contents.values()))`，同一份内容加两次只留一条。
- 同文件 `:74-80@7459fc2` — 写入是先存 pending、`_flush_pending` 批量落盘。
- 同文件 `:63-79@7459fc2` — `get_state/set_state` 把整张表存成 JSON，读档靠它。
- 三层组件：`concordia/components/agent/memory.py:30@7459fc2` `Memory`（只读上下文组件）、`:113@7459fc2` `AssociativeMemory`（可检索的记忆）、`:238@7459fc2` `ListMemory`（一个按序列表）。

## 2. 检索与打分

- `associative_memory/basic_associative_memory.py:133-149@7459fc2` — `_get_top_k_cosine`：`np.dot` 算相似度后 `sort_values(ascending=False)` 取前 k。**打分只有余弦一个维度**，没有新近度、没有重要度。
- 同文件 `:173-196@7459fc2` — `retrieve_associative(query, k)` 返回 top-k 的文本。
- 同文件 `:200-210@7459fc2` — `scan(selector_fn)`：按谓词（不是相似度）筛，等价于「按类型/时间/人物取一批」。
- 同文件 `:218-236@7459fc2` — `retrieve_recent(k)`：纯按时间取最近 k 条。
- `components/agent/observation.py:76@7459fc2` — `LastNObservations` 就是把 `retrieve_recent(limit=self._history_length)` 塞进上下文（`:121@7459fc2`）；`:156@7459fc2` `ObservationsSinceLastPreAct` 用 `retrieve_recent(limit=1_000_000)` 拿「自上次行动以来的全部」。

## 3. 巩固/遗忘/反思

- **没有**。没有巩固、没有遗忘曲线、没有反思。记忆只增不减（除了去重），全靠上层自己控制往上下文里塞多少。
- 这是它作为记忆方案最大的短板：它把「选什么进上下文」交给组件（observation/list），把「记什么」交给调用方。

## 4. 循环里的结构化步骤

- `concordia/environment/engine.py:30@7459fc2` — 抽象 `Engine`；`:34@7459fc2` `make_observation`、`:42@7459fc2` `next_acting`（决定下一个行动者）、`:50@7459fc2` `resolve`（把行动变成结果）、`:58@7459fc2` `terminate`、`:65@7459fc2` `next_game_master`、`:73@7459fc2` `run_loop`。
- 这套「观察 → 谁动 → 结算 → 终止」的四拍循环是**结构化**的，与《窃符》的「场景 → 选项 → 结算 → 下一拍」几乎同构，值得对照。
- `components/agent/concat.py:35-59@7459fc2` — `concat_contexts(contexts, component_order)`：按声明的顺序把各组件产出的文本用换行拼成上下文；`:62@7459fc2` `Concatenate` 组件。**上下文 = 有序组件拼接**，顺序显式可测，这点和我们的 `view()` 组装思路一致。
- LLM 只出现在两处：`components/agent/question_of_recent_memories.py:51@7459fc2` `QuestionOfRecentMemories`（取 25 条记忆 `:74@7459fc2` 后 `prompt.open_question(...)` `:147@7459fc2` 让模型答）与 Game Master 的结算组件（`components/game_master/event_resolution.py` 1309 行等）。

## 5. 对《窃符》的结论

- **可零依赖复刻的设计**：① 记忆银行三种取法并存——相似度 top-k + 谓词 scan + 最近 k（我们的 recall 应该同时有「按人/按场景筛」与「按时间取最近」两条腿，不能只有相似度）；② 写入去重（同一件事不重复记）；③ 上下文 = 按声明顺序拼组件（可测、可 diff）；④ 四拍循环的命名分工（观察/谁动/结算/终止）可以映射到我们的逻辑拍。
- **LLM 在哪、为什么不采用**：`question_of_recent_memories.py:147@7459fc2`（让模型就最近记忆答问）与 `game_master/event_resolution.py`（让模型判结算）——按 m01618 定调，判断必须是结构里的规则，这两处**只作对照不作方案**。
- **直接依赖**：不采用。理由：它是模拟框架不是库，pip 锁里有 torch/vllm/langchain，跑起来需要 embedder；我们要的是零依赖 ES 模块。
