# mem0ai/mem0

- 克隆与版本：`/tmp/oss-audit/mem0ai_mem0` @ `b7ad69a`（2026-10-07，55M）；Python 包 `pyproject.toml` version `2.2.1`；TS SDK `mem0-ts/package.json` name `mem0ai` version `3.3.1`
- 许可：Apache-2.0（`LICENSE` 头）✅ 可用（注意：托管版 mem0 是另一回事，这里只看仓库代码）
- 技术栈：Python（`mem0/memory/main.py` 3912 行）+ TS SDK（`mem0-ts/`）；要 LLM + embedding + 一个向量库（可 SQLite，也可别人家的）
- 测试/CI：tests 目录 3 处、CI 34 个 workflow（CI 很重）
- 形态：一个「记忆层」服务/SDK，主打「自动从对话里抽事实、去重合并」。**它是本清单里把「记忆的增删改历史」写得最正式的一份**

## 1. 记忆结构（存什么字段）

- 一条记忆 = 一段事实文本 + 元数据（`metadata`/`user_id`/`agent_id`）+ 向量 + 时间戳；不同实现细节在各 `vector_stores/*` 适配器里。
- **历史是独立的表**：`mem0/memory/main.py:500@b7ad69a` `self.db = SQLiteManager(self.config.history_db_path)`——每次改动都往历史库写一条事件。
- 事件类型只有四种：`ADD` / `UPDATE` / `DELETE` / `NONE`（见 §4）。
- `main.py:136@b7ad69a` — `DELETE_ALL_BATCH_SIZE = 1000`（批量删时分页）。

## 2. 检索与打分

- `main.py:1393@b7ad69a` — `search(...)`；`:1642@b7ad69a` — `_search_vector_store(query, filters, limit, threshold=0.1, explain=False, show_expired=False)`：**向量相似度 + 阈值 0.1 + 元数据过滤**，没有新近度/重要度加权。
- `main.py:1269@b7ad69a` — `get_all(...)` 全量列举（可带过滤）。
- `main.py:1960@b7ad69a` — `history(memory_id)`：按 id 取这条记忆的完整改动史。
- ⇒ 打分维度单一，是它的弱点；我们不要照抄这块。

## 3. 巩固/遗忘/反思

- **巩固 = 抽取 + 融合**：`main.py:881@b7ad69a` `_add_to_vector_store(...)`，`:944@b7ad69a` 用 `ADDITIVE_EXTRACTION_PROMPT` 先从新对话里抽出候选事实，再与库里已有记忆比对，决定每条候选是新增、更新还是扔掉。这是典型的「LLM 当裁判」，也正是我们**不能采用**的部分。
- **遗忘 = 显式删除**：`main.py:2114@b7ad69a` `_delete_memory(...)`；另有按条件批量删（`:1938@b7ad69a` 一带）。
- 每次真实落地都写历史：新增 `main.py:1975@b7ad69a` `_create_memory`（`:1995@b7ad69a` 写历史 `ADD`）、更新 `:2052@b7ad69a` `_update_memory`（`:2094@b7ad69a` 写历史 `UPDATE`）、批量写入时先攒 `history_records` 再 `batch_add_history`（`:1078-1091@b7ad69a`），只把**确认真的存进去的**记进历史（`:1052-1054@b7ad69a` 注释明确说了这点，避免「报成功但没落库」）。
- 没有反思，没有重要度衰减。

## 4. 循环里的结构化步骤

- `add`（`main.py:760@b7ad69a`）→ 抽事实（LLM）→ 对每条候选做 `ADD/UPDATE/DELETE/NONE` 判定（LLM）→ 执行写库 + 写历史（结构化）。
- **结构化的那一半值得学**：每条事实有 id；每次变更是一个带时间戳的事件；`history` 可按 id 回放；事件只在真的写成功后落账。

## 5. TS SDK 的依赖情况（决定能不能直接用）

- `mem0-ts/package.json:86@b7ad69a` license Apache-2.0；`:106-111@b7ad69a` dependencies = `axios ^1.20.0`、`openai ^4.93.0`、`uuid ^11.1.1`、`zod ^3.24.1`；`:112-116@b7ad69a` peerDependencies 一大串（`@anthropic-ai/sdk`、`@aws-sdk/client-neptune-graph`、`@aws-sdk/client-s3vectors`、`@mochow/mochow-sdk-node` 等）。
- ⇒ **不是零依赖**，且 API 面比我们要的大得多。

## 6. 对《窃符》的结论

- **可零依赖复刻的设计**：① **每次记忆变更都写一条带时间戳的历史事件**（ADD/UPDATE/DELETE/NONE 四型），记忆本体只存当前状态——这正好对上 LIVING.md §7 要的「经历索引只指账本 seq」；② 只把**确认写成**的变更记进历史；③ 记忆条目有稳定 id，可按 id 回放；④ 检索带一个最低阈值，低于阈值不返回（避免硬塞无关记忆）。
- **LLM 在哪、为什么不采用**：`main.py:944@b7ad69a` 的抽取提示、以及用 LLM 判定 ADD/UPDATE/DELETE/NONE（`_add_to_vector_store` 全程）。按 m01618：**新事实与旧记忆是同一件事、该覆盖还是并存，必须由结构判定**（同一 signature/同一人同一话题 → 覆盖或提升 consolidation；否则新增）。措辞摘要可以留给人话层。
- **直接依赖**：不采用。理由：Python 主实现要 LLM+向量库；TS SDK 拖 axios/openai/uuid/zod 与一堆 peer。
