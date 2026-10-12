# 资产生成管线：导演的工具

> 用户原话（2026-10-11）：「你去接资产生成的管线，管线是导演的工具」。
> 所以：**画什么、配什么声音、配什么乐，是导演按自己的手艺决定的**；生成器只是导演手里的笔。
> 陆导和单导拿同一场戏，开出来的资产单不一样，生出来的东西也不一样。

## 0. 硬约束

1. **不碰对照组**：`createPlay` 的任何路径都不调用这里的东西。导演开单只在显式调用 `session.dress(work)` 时发生（这次会写账）。680 个脚本的账本 hash 一笔不变。
2. **开单是确定性的、纯函数**：同一个导演（同一份手艺）+ 同一份场景数据 → 同一张资产单、同一批 key。不读时钟、不随机、不做 IO，浏览器和 node 都能跑。
3. **生成只在 node 工具里**：花钱、写文件、调外部服务都在 `tools/assets/`，不进 `shared/`。
4. **每个资产追得回导演**：账本 `director.dress` 记下 key 列表 → `web/assets/manifest.json` 按 key 记下谁开的单、为哪一场哪一句、哪个服务哪个模型、是不是替身。
5. **缺 key 不卡**：服务不可用时生成替身（`fallback:true`），游戏照常跑；之后有了 key，再跑一次只补替身。

## 1. 文件与归属

| 文件 | 归属 | 内容 |
|---|---|---|
| `shared/agents/stagecraft.js` | t7 | 导演的眼光：`taste(director)`、`dress(director, world)` 开资产单、`assetKey(spec)` |
| `shared/agents/director.js` | t7（只加一个方法） | `director.dress(world, cause)`：调 stagecraft，写一笔 `director.dress` 账 |
| `shared/engine/session.js` | t7（只加一个方法） | `session.dress(work)`：拿 seed + 场景数据组 world，交给当前导演 |
| `tools/assets/run.mjs` | t8 | 命令行：开单 → 查清单 → 只生成缺的/替身 → 写清单 |
| `tools/assets/providers/*.mjs` | t8 | 每个服务一个适配器（见 §4） |
| `web/assets/manifest.json`、`web/assets/gen/**` | t8 生成 | 产物与出处 |
| `web/assets.html` | t8 | 资产预览页：按导演、按场景列出图/听声音，标出替身 |
| `tests/assets.test.js` | t9 | 按本契约写测试（不运行） |

## 2. 导演的眼光：`taste(director)`

只读 `director.craft()` 与 `director.def.temperament`，返回一份确定的口味（数值保留三位小数）：

```js
{
  director: 'lu',
  look:  { style, palette, light, framing },   // 文字，进图片 prompt
  sound: { intensity, density },               // 0–1：音效多响、多密
  music: { bpm, loopSeconds, mood },           // bpm = round(60 + 60×节奏)；loopSeconds = 雕琢高则长
  voice: { rate, pause },                      // 语速倍数（0.85–1.15）与句间停顿秒数
  stills: 'every-beat' | 'key-beats',          // 雕琢 ≥ 0.6 每一拍一张背景；否则只给关键拍
}
```

映射（写成表，放在 stagecraft.js 顶部，可调）：
- **雕琢**高（陆导 0.8）→ 水墨、留白、低饱和；每一拍都有背景；音乐循环长；语速慢、停顿长。
- **放开**高（单导 0.8）→ 粗笔水粉、暖色、构图有动势；只给关键拍；音效密而响。
- **悲剧** = `craft.tragedyBias` 高 → 黄昏、冷光；低 → 白天、暖光。
- **节奏**决定 bpm 和语速。
- learn 改了手艺 → 口味跟着变 → key 跟着变 → 下次生成的是新东西（导演的手艺长在资产里）。

## 3. 开单：`dress(director, world)`

`world = { work, scenes, places, people, items }`：`scenes` 是 KERNEL.md §2 的 SCENES，其余来自 `shared/data/seed.js`。

返回 `{ director, work, taste, plate, assets: Brief[] }`。`Brief`：

```js
{
  key,                 // assetKey(spec)：对 spec 做稳定序列化（键排序）后取 hash，前缀 kind，如 'image-3f9a…'
  kind: 'image' | 'voice' | 'sfx' | 'music',
  for: { work, beat?, place?, person?, line?, verb? },   // 为谁、为哪一句
  spec: { … },         // 生成所需的全部参数，见下；key 只由 spec 算
  why,                 // 一句话：导演为什么开这一张（来自口味表，例如「雕琢 0.8：每一拍都要一张背景」）
}
```

各类怎么从数据里长出来（**不写死任何一幕的名字**，新组合自动有资产）：

| kind | 来源 | spec |
|---|---|---|
| `image`（风格底版 plate） | 每部作品每位导演一张，最先生成 | `{ prompt, size:'1536x1024', role:'plate' }` |
| `image`（背景） | 每个 scene 的 `place`（按 `stills` 决定全部或只关键拍：有 `finish:'on-end'` 或规则里有 `end` 效果的算关键拍，加首拍） | `{ prompt, size:'1536x1024', plate: plateKey }` |
| `image`（人像） | 每个 scene 的 `people` 里出现的人，一人一张 | `{ prompt, size:'1024x1024', plate: plateKey }` |
| `voice` | 每个人的 `voice` 台词 + 场景规则里的 `text`（字符串或 {id:文本}）里的引号台词「…」 | `{ text, speaker, voice: voiceOf(person), rate, pause }` |
| `sfx` | 场景用到的每个控制器的动作（speech/handover/space/clock/attention/standing/evidence），每种一个 | `{ prompt, seconds, intensity }` |
| `music` | 每个 scene 一条循环，情绪取场景的 `goal`/规则文本里最常见的情绪词，没有就用口味的 mood | `{ prompt, bpm, seconds: loopSeconds, loop:true }` |

- 图片 prompt = 场景/人物的事实描述（来自 seed 的 `desc`/`bio`/`title`）+ 口味的 look。**不加文字、不加水印**写死在 prompt 尾。
- `voiceOf(person)`：确定性地从人物信息选一个音色档（老/中/少 × 男/女），写成表；`speaker` 是人物 id。
- 同一个 spec 只出现一次（按 key 去重）。
- `director.dress` 写账：`kind:'director.dress'`，payload `{ work, taste, keys:[…], counts:{image,voice,sfx,music} }`，cause 为传入的 cause（session.dress 用最近一笔 user.* 的 seq）。

## 4. 生成：`node tools/assets/run.mjs`

```
node tools/assets/run.mjs --work qiefu --director lu [--kinds image,voice] [--max 20] [--dry] [--only-missing]
```

1. 建 session → `session.dress(work)`（换导演用 `--director`）→ 拿到资产单。
2. 读 `web/assets/manifest.json`；已有且不是替身的 key 跳过；`--dry` 只打印要生成什么、走哪个服务、几张。
3. 先生成 plate，再生成其余；`--max` 是这一轮最多生成几个（防止一次烧钱）。
4. 每生成一个，立即写回 manifest（中途断了不丢）：

```json
{ "assets": { "image-3f9a…": { "kind":"image", "file":"gen/image-3f9a….png", "director":"lu", "work":"qiefu",
  "for":{…}, "spec":{…}, "why":"…", "provider":"magpie", "model":"…", "fallback":false, "bytes":123 } } }
```

（2026-10-11 修订：manifest 外层包一层 `assets`，给以后的版本号/统计留位；以 t8 的实现 536e7b7 为准。`planRun(manifest, briefs, available)` 的 `available` 是 `{ magpie:{ok}, litellm:{ok}, audio:{ok,cloud,note} }` 形状的对象；计划里每个 brief 都有一条，已有正式版本的条目 `action:'skip'`，不是从计划里删掉。）

适配器（`providers/<name>.mjs`，都导出 `available()` 与 `make(brief, outPath)` → `{ model, fallback }`）：

| kind | 正式服务 | 替身 |
|---|---|---|
| image | `magpie`：本机网关 `MAGPIE_URL`（默认 `http://localhost:3425`）的 `/v1/images/generations`；有 plate 时走 `/v1/images/edits` 把 plate 当参考图，保证同一导演同一画风 | 无（图片没有替身就跳过并报告） |
| voice | `elevenlabs`（`ELEVENLABS_API_KEY`） | `say`：macOS `say` + `ffmpeg` 转 m4a，按 voiceOf 选系统中文音色，按 rate 调语速 |
| sfx | `elevenlabs` sound-generation | `synth`：ffmpeg 合成（正弦/噪声 + 包络），按 intensity 调响度 |
| music | `elevenlabs` music | `synth`：ffmpeg 合成的 bpm 节拍循环 |

- 正式服务可用时，manifest 里 `fallback:true` 的条目会被重新生成。
- 网络错误：该条记 `error`，继续下一条，最后汇总报告。不重试超过一次。

## 5. 预览：`web/assets.html`

读 `manifest.json`：按 导演 → 作品 → 场景 分组；图显示缩略图，声音给播放按钮；每条显示 `why` 与 provider；替身标「替身」。顶部一行统计：几张图、几条声音、几个替身。

## 6. 不做的

- 不改 `createPlay`、内核、场景数据；页面接资产是 t5 之后的事。
- 不做视频、3D。
- stagecraft 不调用 LLM：口味和开单都是规则，可以复验。
