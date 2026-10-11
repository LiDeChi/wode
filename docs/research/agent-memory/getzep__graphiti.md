# getzep/graphiti

- 克隆与版本：`/tmp/oss-audit/getzep_graphiti` @ `964bb11`（2026-10-10，30M）；包 `graphiti-core` `0.31.0`
- 许可：Apache-2.0（`LICENSE` 头）✅ 可用
- 技术栈：Python；`pyproject.toml:12-21@964bb11` requires-python `>=3.10,<4`，dependencies `pydantic>=2.11.5`、`neo4j>=5.26.0`、`openai>=1.91.0`、`tenacity`、`numpy`、`python-dotenv`、`posthog`；另有 falkordb/kuzu/neptune driver
- 测试/CI：tests 4 处、CI 15 个 workflow、`docker-compose.test.yml`（跑测试要起图库）
- 形态：**时序知识图谱**记忆。它的价值不在「存一段文本」，而在「一条事实什么时候开始为真、什么时候不再为真」以及「多路检索怎么融合」

## 1. 记忆结构（存什么字段）

- `graphiti_core/edges.py:271-283@964bb11` — `EntityEdge` 的时间字段：`expired_at`（`:271@964bb11`）、**`valid_at`**（`:274@964bb11`）、**`invalid_at`**（`:281@964bb11`，注释原文「datetime of when the fact stopped being true; soft deadlines are not invalid_at」）、`created_at`（`:54@964bb11`）。
  ⇒ **事实不是覆盖，而是「作废时间」**：旧事实保留，只是 `invalid_at` 被写上；可以回答「上个月他和谁结盟」。
- `graphiti_core/nodes.py:54@964bb11` — `EpisodeType`（事件的种类）；`:318@964bb11` `EpisodicNode`（原始事件，一次对话/一篇文章）、`:499@964bb11` `EntityNode`（实体，人/物）、`:727@964bb11` `CommunityNode`（**社区：实体的聚类，用于高层摘要**）。
- 三层：episode（原始）→ entity（提炼出的实体）→ community（聚类摘要）。实体还有自己的摘要文本，会随新事件被重写（见 §3）。

## 2. 检索与打分（RRF 是本清单里最值得抄的一个小算法）

- `graphiti_core/search/search_utils.py:1775-1790@964bb11` — `def rrf(results: list[list[str]], rank_const=1, min_score=0)`：对每一路结果，第 i 名得 `1/(i + rank_const)`，同一个 uuid 在多路命中就**累加**，最后按总分降序。
  ⇒ **只看名次不看分数**，所以「余弦 0.9 的第一名」和「关键词命中的第一名」等价——多路融合时不需要把不同量纲的分数对齐。零依赖、十来行。
- 同文件 `:1793@964bb11` — `node_distance_reranker`：按图上距离再排一次。
- `graphiti_core/search/search.py:98@964bb11` — `async def search(...)`：不同对象各自算 `cosine_similarity`（边 `:295@964bb11`、点 `:509@964bb11`），再各自 rrf 重排（边 `:378-383@964bb11`、点 `:588-589@964bb11`、episode `:732-745@964bb11`、community `:838@964bb11`）。
- ⇒ **检索是「多路召回 + RRF 融合 + 可选距离重排」**，不是单一路打分。

## 3. 巩固/遗忘/反思

- 巩固：新 episode 进图后抽实体/边（LLM），重复的实体做合并；社区节点定期聚类重建（LLM 写摘要）。
- **遗忘 = 时序作废**：不删边，写 `invalid_at`（`edges.py:281@964bb11`）。这是最像一个「世界」的记忆语义。
- 反思：没有独立的反思机制，等价物是社区摘要。

## 4. 循环里的结构化步骤

- 摄入：episode → 抽取 → 落图（LLM 占大头）；检索：多路召回 → RRF → 重排（**纯算法**）。

## 5. 对《窃符》的结论

- **可零依赖复刻的设计**：① **RRF**（`1/(rank+1)` 求和）作为多路记忆融合的默认算法——我们有「按人命中」「按场景命中」「按关键词命中」多路时，直接用 RRF，不必设计分数对齐；② **事实的 `valid_at`/`invalid_at` 双向时间**——《窃符》里「他现在信我」这类判断应该记录「从哪一拍开始为真、从哪一拍起不再为真」，而不是布尔覆盖；③ 三层结构（原始事件 → 实体 → 聚类摘要）提示我们的记忆也可以有「一局的原始拍 → 某人对某人的结论 → 一段关系的摘要」三层。
- **LLM 在哪、为什么不采用**：实体/边抽取、社区摘要都靠 LLM。按 m01618，人物与关系我们本来就**已经有结构**（`def.values/resist/goals`、`state.trust`、`claims`），不需要从文本里抽；只有当一台戏的原始拍要压成一条人读的记忆时才需要措辞。
- **直接依赖**：不采用。理由：要 neo4j（或 falkordb/kuzu）+ openai；我们零依赖、内存结构。
