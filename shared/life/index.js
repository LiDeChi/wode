// 生活循环这一层的门面（docs/design/LIVING.md §9）。
//
//   createMemoryStore  记忆存储的小接口（remember/recall/consolidate/forget/tick/save/restore）
//   designLife         纯函数：导演手艺 + 品味 → 每场每一拍的 lifePolicy
//   createLife         一秒一个逻辑拍的循环：推进、幂等、种子、暂停、存档
//   createLifeView     读镜：结构化片段 + 可替换的人话翻译层（say）
//
// 记忆的实现在 shared/core/memory.js（DECISION.md §2.1/§3）：它是结构层，不属于生活循环。
// 这一层不碰 shared/scenes/**，也不改旧路径：只有 createPlay({living:...}) 显式打开时才实例化。

export { createMemoryStore, MEMORY_DEFAULTS, sigOf, impactOf } from '../core/memory.js';
export { designLife, CADENCE_BY_PACE, ENVIRONMENT_CADENCE } from './plan.js';
export { createLife } from './life.js';
export { createLifeView, say } from './view.js';
