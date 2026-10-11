# joonspk-research/generative_agents

- 克隆与版本：`/tmp/oss-audit/joonspk-research_generative_agents` @ `fe05a71`（2023-08-11，1.2G）
- 许可：Apache-2.0（`LICENSE` 头）✅ 可用
- 技术栈：Python + Django 2.2 + gensim 3.8 + openai（`requirements.txt`），外加一个前端；**2023-08 后再没更新**
- 测试/CI：无 CI（`.github/workflows` 不存在），测试只有 `reverie/backend_server/test.py` 一个冒烟脚本
- 形态：Smallville 那篇论文的参考实现。「记忆流 + 检索打分 + 反思 + 计划」这四件套是**最接近我们要做的事**的一份公开实现

## 1. 记忆结构（存什么字段）

- `reverie/backend_server/persona/memory_structures/associative_memory.py:19-43@fe05a71` — `ConceptNode` 一条记忆的字段：`node_id`、`node_count`、`type`（`thought|event|chat` 三型）、`depth`、`created`、`expiration`、`last_accessed`、`subject/predicate/object`（`:35-37@fe05a71`，就是「谁 对谁 做了什么」的三元组）、`description`、`embedding_key`、**`poignancy`**（重要度）、`keywords`、`filling`。
- 同文件 `:50@fe05a71` — `AssociativeMemory` 内存索引：`id_to_node`、`seq_event`/`seq_thought`/`seq_chat`（`:54-56@fe05a71`，**按类型各一条时间链**，新条目插队首 `:177/:221/:260@fe05a71`）、`kw_to_event`/`kw_to_thought` 倒排（`:58-60@fe05a71`）、`kw_strength_event`/`kw_strength_thought` **关键词强度计数**（`:62-63@fe05a71`，命中就 +1 `:189-192/:233-236@fe05a71`）。
- 同文件 `:65@fe05a71` — 向量存在 `embeddings.json`，`embedding_key` 是它的键；`:112@fe05a71` `save`。
- 三种写入：`:153@fe05a71` `add_event`、`:199@fe05a71` `add_thought`（`:210@fe05a71` `depth = filling 里最大 depth + 1`，即「反思的反思」有层级）、`:243@fe05a71` `add_chat`。
- 三种取法：`:274@fe05a71` `get_summarized_latest_events(retention)`、`:305/:317@fe05a71` 按关键词取相关想法/事件、`:331@fe05a71` `get_last_chat`。

## 2. 检索与打分（这一段是全文最值钱的部分）

- `persona/cognitive_modules/retrieve.py:132@fe05a71` — `extract_recency`：`:145-146@fe05a71` `recency_vals = [persona.scratch.recency_decay ** i for i in range(1, len(nodes)+1)]`，**指数衰减、按队列位置算**。
- 同文件 `:154@fe05a71` — `extract_importance`：直接返回 `node.poignancy`。
- 同文件 `:175@fe05a71` — `extract_relevance`：`:194@fe05a71` `cos_sim(node_embedding, focal_embedding)`，焦点是当前关注点。
- 同文件 `:232-238@fe05a71` — 三个分量各自 `normalize_dict_floats(..., 0, 1)` **先归一化再加权**（量纲不同，必须先归一到同区间）。
- 同文件 `:199@fe05a71` — `new_retrieve(persona, focal_points, n_count=30)`；`:243-247@fe05a71` 主分 = `recency_w*recency*gw[0] + relevance_w*relevance*gw[1] + importance_w*importance*gw[2]`，其中 `gw = [0.5, 3, 2]` ——**相关度权重最高（3），重要度次之（2），新近度最低（0.5）**；`:265-266@fe05a71` 取中的节点把 `last_accessed` 更新为当前时间。
- 权重默认值：`persona/memory_structures/scratch.py:57-61@fe05a71` `recency_w=1`、`relevance_w=1`、`importance_w=1`、`recency_decay=0.99`、`importance_trigger_max=150`（存读档 `:194-199/:272-277@fe05a71`）。

## 3. 巩固/遗忘/反思

- **反思阈值**：`cognitive_modules/reflect.py:135-152@fe05a71` `reflection_trigger` = `importance_trigger_curr <= 0 且（有事件或有想法）`。
- **怎么扣到 0**：`cognitive_modules/perceive.py:178@fe05a71` 每次感知到一件事就 `importance_trigger_curr -= event_poignancy`；换句话说「攒够 150 点重要度就反思一次」，这是个**纯计数器，完全确定性**。
- 反思流程：`reflect.py:99-131@fe05a71` `run_reflect` = 生成 3 个焦点（`:21@fe05a71` LLM）→ `new_retrieve` 取相关记忆 → 产出洞见（`:38@fe05a71` LLM）→ `add_thought` 写回记忆流（带 depth）。
- 遗忘：只有 `expiration` 字段（`:19-43@fe05a71`）与 `recency` 的指数衰减，**没有删除**。记忆是只增的。
- 感知入口：`perceive.py:25@fe05a71`，按 `vision_r` 半径收集（`:47@fe05a71`）、取最近 retention 条事件（`:119@fe05a71`）、`add_event`（`:175@fe05a71`）；重要度由 LLM 打分 `generate_poig_score`（`:15@fe05a71`，1-10 分）。

## 4. 循环里的结构化步骤

- `cognitive_modules/plan.py:23@fe05a71` `generate_wake_up_hour` → `:41@fe05a71` `generate_first_daily_plan` → `:71@fe05a71` `generate_hourly_schedule`（`:134-136@fe05a71` 压成 `[task, duration*60]`）→ `:141@fe05a71` `generate_task_decomp` → 具身定位（`:167/:185/:203@fe05a71` sector/arena/game_object）→ `:252@fe05a71` `generate_action_event_triple`。
- 对话与决策：`:277@fe05a71`、`:301/:311@fe05a71`。`new_retrieve` 也被 plan 用（`plan.py:413@fe05a71`）——**检索不在「回答时」才做，而是在「定计划时」就要**。
- 这套「日计划 → 小时表 → 任务分解 → 具体动作」的逐层细化是结构化的，RNG 之外不依赖 LLM 的地方很多。

## 5. 对《窃符》的结论

- **可直接照抄的确定性设计**：① 一条记忆的字段清单（三元组 + 类型 + 深度 + 关键词 + 重要度 + 上次访问 + 过期时间），我们的 `minds[id].memory` 现在只有 `{trace, activation, consolidation}`，缺「类型/深度/关键词/上次访问」；② 三路分量的**归一化后加权**打分（相关度 3 : 重要度 2 : 新近度 0.5），把 `cos_sim` 换成我们的结构化命中（signature/关键词/价值通道）就能零依赖落地；③ 指数衰减的新近度 `decay^i`（`decay=0.99`）；④ **反思计数器**：感知累加重要度，攒够阈值就巩固成一条带 `depth` 的新记忆——这正好补上我们缺的「巩固」；⑤ 按类型分链（event/thought/chat）与倒排关键词索引，纯内存结构。
- **LLM 在哪、为什么不采用**：`retrieve.py` 的 relevance 用嵌入（要 embedder，不是 LLM 裁判，但同样不该引入）；`perceive.py:15@fe05a71` 的 `poignancy`（LLM 打 1-10 分）、`reflect.py:21/:38@fe05a71` 的焦点与洞见生成（LLM）。按 m01618 定调，**重要度必须由结构算**（例如：谁被牵动、动了多少、是否命中 goals），洞见必须是「从记忆里按规则抽出的结构化条目」，而不是让模型写一段散文。
- **直接依赖**：不采用。理由：Django + gensim + openai + 前端，2023 年后停更；我们要的是零依赖 ES 模块，只需照抄它的数据结构与打分公式。
