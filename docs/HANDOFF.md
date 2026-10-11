# 接手说明（captain 交接给 GPT-6.1-sol）

写于 2026-10-11 22:20（Asia/Taipei）。这份文件写给接手 captain 位置的模型看，读完就能继续干。
仓库：/Users/lidechi/orca/workspaces/wode/ling，分支 LiDeChi/ling，零依赖。

## 0. 先读这三样，再动手

1. 本文件。
2. docs/KERNEL.md：交互内核契约（场景数据、控制器、规则表、效果、对照组）。
3. 设计总稿 `docs/数字世界 设计总稿 v3（草案） (2).md`：§5 角色模型、§6 呈现、§8 导师与算力、§15 Agent、§17 心智与可玩性。

## 1. 用户是谁，要什么（每一条都是硬要求）

- 用户是产品经理兼游戏策划，交流要用产品和策划的语言。
- 每次汇报都用费曼式写法：以前卡在哪 → 现在能做什么 → 点哪里验证 → 哪些情况还不支持，并附一个可以复验的小例子。
- **captain 只负责整体架构**：契约、拆任务、集成和验收（跑测试、看截图）。实现和设计一律派给成员。GPT-6.1-sol 的设计能力用户认可，可以多派活。
- **不要网页、报表、卡片风格**：数据和文字多的页面也要做成 three.js 里的装置机关。界面上不出现数字、JSON 和术语，这些只在 `?dev=1` 时出现。
- **界面有新增或大改，就把截图直接贴进回复**（用 `![说明](</tmp/...png>)`），不要只给路径。截图按版本号另存新文件名，不覆盖旧图。
- 平台：先做 Web，再扩展到多端；尽量不上游戏引擎；善用 three.js（已内置 web/vendor/three r185 + importmap，不加 npm 包，不走 CDN）。
- 音频优先级低（自建 AudioEngine 已暂停，WIP 在 e49b124），先打磨玩法。Monid 的 key 存在 macOS 钥匙串（service `digital-world-audio`，account `MONID_API_KEY`），只有 captain 能真跑，单次不超过 $0.10，key 不许写进任何文件。
- **当前主线（用户 m01206 / m01234）**：导师、导演、演员各自和自己的环境持续交互，心智机制让角色有血有肉，并且要在产品里看得见。补充三点：
  ①「世界等不等你」由**导演**设计，是导演手里的选择，不是全局开关；
  ② 要看得见角色的经验不断增长，一局之内和跨局都要；
  ③ 心智对历史进程的影响，由**导演**设计成一种呈现。

## 2. 跑起来与验收

- 服务：`node server/index.mjs` → http://127.0.0.1:4320（要用后台受管任务起，或者 nohup）。
  页面：/play.html（可玩）、/hub.html（排片表戏台）、/film.html（放映厅）、/lab.html（推演机）、/game.html（第一阶段 3D）、/world.html（世界图）。
- 全量测试：`npm test`。最近一次结果：107 项，96 通过，0 失败，11 跳过。
- 对照组：`node --test tests/kernel-parity.test.js`，新基线 692 条在 tests/fixtures/play-mechanics-v2-golden.json，旧基线 play-golden.json 保留不动。只改玩家能看到的文字时，logHash 可能会变，必须写清原因并重录 v2。结局、账本、天数、旗标都不许变。
- 机制探针：`node tools/mechanics-probe.mjs`（17 节，`--section N` 可单独跑）；`node --test tests/mechanics-polish.test.js`（6 个闸门）。
- 可玩页冒烟：`node tools/play-smoke.mjs --tag=vN`（会带 ?dev=1 读 window.__play）。
- 截图：Playwright 在 /opt/homebrew/lib/node_modules/playwright，executablePath 指向 ~/Library/Caches/ms-playwright/chromium_headless_shell-1248/…；用户视口 1292×761，手机按 390×844。
- AGENT.md 规定：成员不跑仓库测试，由 captain 跑；成员要尽早提交，而且只提交自己负责的文件。

## 3. AgentTeams 团队「digital-world-kernel」

可用的成员路由（会话白名单里实际能用的）：
- `magpie/opencode-go/deepseek-v4.1-flash`：主力。偶尔会 EOF 断线，这时用 reassign_task 让原成员重试即可。
- `magpie-responses/codex/gpt-6.1-sol`：设计主力，有额度窗口；10-11 用完过一次，21:59 恢复。
- `magpie-responses/grok/*`：额度已用完，不要用。

成员（截至交接）：kernel2（内核/心智）、sim2（模拟玩家/探针）、qa2（写测试不运行）、scenes2（场景数据 shared/scenes/**、play.js）、ui2（web/play/**）、lab3（web/lab/**）、film3（web/hub/**、web/film/**）、sol2（设计）。

写入范围的约定：各人只写自己负责的目录。shared/kernel/** 不随便改，要改得先改 docs/KERNEL.md。

进行中的任务：
- t39 ui2：可玩页第二轮。邺城没拿到兵符时桌上不放兵符；收束页改成竹简加封泥的装置；旁白加淡底。截图存 /tmp/play-shots/v8-*。
- t40 lab3：推演机打磨。岔路刻出槽道并留走痕；去掉浮动说明框；调试入口只在 dev 出现；导师灯牌接真话；手机上把机器放大。截图存 /tmp/lab-shots4/。
- t41 film3：放映厅手机竖屏香炉挡人；拿起时木签缩小、和物件同框；底部黑卡改成台沿刻字。截图存 /tmp/film-shots/v3-*。
- t42 sol2 已完成 docs/design/LIVING.md，已经按其中 §10 拆成实现任务：
  - t43 sim2 已完成（abca103）：docs/research/agent-memory/DECISION.md。结论：十个仓库都不能直接依赖，只借结构自己实现；letta 有项目方禁令一行不抄，mastra ee/ 不碰。记忆接口按其 §3（createMemoryStore）做。用户定调（m01618）：LLM 只当代码助手和翻译，感知决策都沉淀在结构里。
  - t44 kernel2：核心生活循环（已授权写 shared/core、shared/agents、session、play，以及新增 shared/life）。opt-in 开关，默认关闭时逐字节不变；记忆放在 store/recall/consolidate/forget 接口后面。
  - t45 scenes2（依赖 t44）：取符之夜的生活配方。t46 ui2、t47 film3、t48 lab3 分别做三个页面（依赖 t44、t45 和各自的打磨任务）。t49 qa2：tests/living.test.js。
- 额度接力（2026-10-11 设好）：Magpie 里有一个按顺序路由的分组 `group/captain`（anthropic/claude-opus-5-5 → opencode-zen/claude-opus-5-5 → codex/gpt-6.1-sol → opencode-go/deepseek-v4.1-flash），配置在 ~/.config/magpie/providers.json 的 groups 里，routing 是 "order"，备份在 /tmp/magpie-providers.before-captain.json。captain 会话选这个模型，前一个额度用完（402/429）就自动换下一个。同一段对话有粘性：换过去以后会一直留在接手的模型上。

交回时 captain 要做的：看截图（贴给用户）→ 跑 npm test 和对照组 → 用费曼格式汇报 → 不合格的地方另开一个跟进任务（不要自己动手改）。

## 4. 已完成的主线（查证用）

- 交互内核：shared/kernel/**；四幕和粮仓都已改成场景数据（shared/scenes/qiefu.js、weicheng.js）；两个新组合 daliang-overheard.js、weicheng-escort.js 没有改内核。
- 玩法调校：docs/design/MECHANICS.md → e30209a；证据在 docs/design/mechanics-polish-evidence.md（§11 线索表，§12 邺城有符和无符两种开场）。
- 导师档位影响戏的细致程度：t27（createPlay 的 tiers/tierOf/budget 参数）。
- 呈现：play（51cb6a5）、hub/film（1b91f8a、04e4262、d1534c3）、lab（3f0e9c5）。
- 资产管线：tools/assets/run.mjs（导演出单子，生成器只是画笔），审片在 tools/assets/review.mjs。音频审查结论在 docs/research/audio-oss/DECISION.md。

## 5. 还没定、要盯的

- LIVING 设计落地以后，所有「有后果的自发行动」都要通过 opt-in 开关，并由导演设计决定在哪里生效；默认关闭时旧对照组不能变。
- 打开开关后的新对照组，要说明原因并单独录制。
- 收束页还缺「你错过了什么」的对照；表现时间压力的装置目前只有漏刻。
