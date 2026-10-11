# AudioEngine：复用决策与后续 PoC

2026-10-11，t22；只交决策，不新增实现。用户已拍板：音频降优先级，当前先打磨玩法；声音离线优先，默认选可商用、≤1GB小模型；云BYOK可选升级；首版不做克隆；先PWA，再Tauri，Electron/Capacitor不选。商用受限/gated模型默认不装、不分发、requireCommercial=true默认禁，用户自装并接受后才作为外部服务选配。captain获准执行一次Monid真验收（短语音/音效/音乐，总≤$0.10），worker不碰key。

## 1. 证据与复用决策

六份固定快照报告：[AA](AIEGOBOT__agent-audio.md) 975d804；[EL](neomorrison__elevenlabs-mcp.md) b966455；[GA](laurentvv__generator-assets.md) 5a400d8；[GK](JimCline__game-audio-kit.md) 97471ab；[OG](EricSun0218__OpenGameAgent.md) 06294f1；[CH](chasmlol__chasm.md) d740b97。完整SHA与实跑边界在报告；下表上游路径:行均对应其快照。AA98测试/MCP2工具、EL28工具/两SDK参数检查、GA59测试、GK听证页/Go测试、OG音频714通过/1环境失败、CH155Rust用例；这些不等于真实模型/云音质已验。e49b124是暂停WIP。

| 能力 | 来源 / 分类 | 理由与证据 | 授权与限制 |
|---|---|---|---|
| TTS默认离线 | Kokoro-js/ONNX，直接依赖候选；系统语音兜底保留 | §3证据；现有 `tools/audio/providers/local.mjs:30` say已接；不重造推理 | JS/权重Apache-2.0；中文JS未支持，详§3 |
| TTS云升级 | Gemini MCP直接依赖；Monid薄壳保留 | GK `internal/server/tools.go:75`、`internal/media/speech.go:63`；`tools/audio/providers/monid.mjs:54-64`发现schema/价 | Gemini代码Apache；云plan另核 |
| 克隆 | EL最小Fork候选，首版放弃暴露 | EL `src/elevenlabs_mcp/server.py:541`缺consent；不扩当前引擎 | MIT代码，主体授权/plan另管 |
| 音乐 | Gemini直接依赖云升级；AA本地条件性外部依赖 | GK `tools.go:83`、`internal/media/music.go:83`；AA `backends.py:43`固定medium | Apache/MIT代码；AA 🔴Community/Gemma默认禁 |
| 音效 | 当前ffmpeg占位保留；AA条件性；GA配方只参考 | `local.mjs:31`；GA `core/music_ai.py:148,284`反静音；AA `mcp_server.py:33` | ffmpeg按构建核；Stability默认禁 |
| STT | OG兼容HTTP片段Fork候选；浏览器Whisper研究 | OG `packages/realtime-local/src/openai-compatible-speech.ts:134`；当前 `engine.mjs:145`尚报config | OG MIT；具体模型/云plan另核 |
| MCP服务端 | 官方SDK入口薄壳 + AA/EL/Gemini外部服务直接依赖 | AA `mcp_server.py:11`、EL `server.py:999`、GK §5；不另造协议/生成器 | SDK MIT；零Node依赖契约例外待captain定 |
| 云BYOK | 自写钥匙闸门保留、Monid薄HTTP壳 | `secrets.mjs:7-21` keychain/env；禁EL dotenv/明文JSON范式 | 不分发key，输出权利非代码MIT |
| 进程管理 | OG最小Fork，GK控制面只参考 | OG `packages/integrations/src/owned-local-model-process.ts`；GK `control.py:1-30`救援不加载模型 | MIT；不引OG全30包、不按端口杀别人的PID |
| 地址准入 | WORKSHOP规则自写保留、OG只参考 | OG `openai-compatible-speech.ts:449,472`；WORKSHOP:36 | loopback默认，LAN显式，公网拒 |
| 预算闸门 | 当前自写保留，Gemini内部保护直接依赖 | `budget.mjs:15-36`跨provider预留；GK `internal/spend/ledger.go:93-94,279-296`仅管自己 | 同job对账不重复计算；未知价确认+预留 |
| 审片/审听 | 当前自写保留；GK局部Fork/GA配方参考 | `review.mjs:299-336`、`run.mjs:565,590`；GK `build_audition.py:38-61`/`tighten.py:24-31` | MIT配方；原生音频库另核 |
| three场景播放 | 内置r185直接依赖 | `web/vendor/three/three.core.js:6,50080,50769,51772` | `web/vendor/three/LICENSE:1` MIT |
| 游戏引擎/mod/整仓CH | 放弃；CH只参考生命周期思路 | GA §9.1、GK `SKILL.md:79-91`、OG/CH §9；因Web方向 | 🔴CH AGPL声明且缺LICENSE，不复制/Fork |

保留 `tools/audio/{budget,secrets,voices,jobs,store,errors,registry}.mjs` 的全局费用/未知价、角色身份/consent、重启记录、资产元数据独有价值；engine/router/CLI降为委托协调薄壳。local say/ffmpeg只算placeholder；mock只验接线。Monid保留独有discover/inspect/矩阵估价；fal默认关；ElevenLabs直连不扩写，若以后确需五能力才Fork EL并停重复代码。e2e有key可能付费，不能当dry-run。`tools/assets/run/review`保留导演权威，Web/MCP都复用同一单/审片/发布；STT另作授权输入任务。store当前全buffer/任意out须改有界staging/目录边界/排他发布；费用超估价只能记录超支阻断后续，无法撤回已扣款。当前 `tools/local/`不存在，WORKSHOP是待实现契约。此次不删除任何代码。

## 2. 最小架构与 Local Only 修正规则

```text
Coding Agents → 官方SDK MCP入口 ─┐
PWA/浏览器/未来Tauri → 同源HTTP ─┤
 → 本机Node：身份/导演单或授权输入任务/商用策略/consent
 → 估价/全局预算预留/job去重（key只在服务端）
 → HTTP薄壳 → 用户Kokoro/Qwen/STT本地服务
 → MCP子服务 → AA本地（条件性）/Gemini或EL云（升级）
 → CLI子进程 → 用户audio.cpp/say/ffmpeg
 → 聚合HTTP → Monid（inspect后run）
 ← 有界staging/remote ID/费用结算 → review → accept才发布
 → asset-ID同源URL → 试听/three空间音/循环
纯PWA离线 → 浏览器小模型Worker；无Node时不能起外部进程
纯PWA云 → 用户认证HTTPS闸门；不能把key放浏览器
```

两坑必须在P0修（本轮仅明确方案）：`router.mjs:6-9`/`engine.mjs:148` 的local/mock ID白名单改可信登记executionScope与协议准入；`engine.mjs:76-79`全拦fetch/`store.mjs:17`全拒URL改共享地址闸门，允许登记loopback与显式allowLan私网，本地结果URL同样检查。local:true自报不算授权；loopback运行的Gemini/EL仍cloud，Local Only在发现前拒。生成/发现/轮询/取消/探活共用规则，禁重定向/凭据/片段，DNS解析与实际连接地址核验防重绑定，LAN仅登记服务，基础query禁止、协议query受控。验收：localsvc成功且**公网HTTP=0/云MCP=0**；公网/跳转/DNS绕过拒；LAN默认拒/显式放行；本地URL可落盘/跨服务拒；旧local/mock不变且placeholder不交production。

用户自装受限模型不进分发包、不代接受条款；外部进程不是AGPL/Community法律豁免，CH默认完全不接。argv无shell、最小env、只终止自有PID、轻量health不自动安装。HTTP固定Origin/Host/会话授权/CSRF、禁任意path/command/tool；用户HTTPS网关供远程PWA，不能假定远程页面能访问桌面localhost。标准SDK独立网关与AUDIO:9零依赖冲突需定例外；WORKSHOP:8-9不装模型保持，模型由用户预装。

## 3. 多端矩阵与离线可行性

| 能力 | 纯PWA本地 / 云升级 | Tauri桌面本地 / 云升级 |
|---|---|---|
| TTS | Kokoro-js英语WASM/WebGPU候选；中文系统Web Speech兜底；云经HTTPS闸门 | Node CPU Kokoro-js英语/用户Kokoro v1.1-zh服务；say兜底；云同闸门 |
| 克隆 | 首版不做 | 首版不做 |
| 音乐 | 无已验≤1GB生产模型；离线程序化占位/用户已有音；云Gemini/Monid | 用户ACE/AA外部服务选配（非默认小模型）；云同左 |
| 音效 | Web Audio程序化轻量声；生成模型无已验≤1GB路径；云EL/Monid | ffmpeg程序化；AA条件性外部选配；云同左 |
| STT | Whisper tiny量化研究；Silero仅VAD；云可选兼容服务 | 用户STT HTTP/浏览器小模型；云可选 |

Electron不选：用户已定Tauri，避免再维护一套Node/Chromium桌面分发；Capacitor不选：先PWA满足移动页面，暂不维护原生移动桥。这是产品取舍，未做包体量化/全许可证审计。手机127.0.0.1不是桌面，纯PWA不能spawn；Tauri须受限sidecar权限，不搬CH打包代码。

补充原始证据：[Kokoro-js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js) 文档/源码支持Node CPU、浏览器WASM/WebGPU，Apache-2.0；`src/kokoro.js`只验a/b英语voice，`src/voices.js`中文voice在TODO，不能承诺中文JS可用。[v1.0 ONNX HF卡](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) Apache-2.0、82M、q8模型92.4MB/fp32 326MB（模型文件，不含voice/JS/缓存总量）；只示英语。[v1.1-zh HF卡](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) Apache-2.0、英中两语103voice，提供Python `kokoro>=0.8.2`/`misaki[zh]>=0.8.2`示例、24kHz；不是已验证中文ONNX/浏览器包。故中文替代是用户自装该宽松服务（桌面）或PWA Web Speech `zh-CN/zh-TW` 系统voice；后者平台可能联网，**只有确认本地可离线voice才作为离线兜底**，无本地voice就明确不可用，不偷偷云升级。

默认目标仍≤1GB可商用小模型，但现在只有英语JS路径有公开体积证据；中文浏览器路径不具交付保证。首版PWA先测英语q8，中文退路如上；固定artifact/voice/phonemizer/JS全量大小与hash、nongated状态在PoC核齐，用户预装后离线缓存运行，不自动HF下载。多慢：本轮无真实设备延迟/RSS，不能给秒数承诺；PoC记录冷/热启动、首音延迟、实时因子和峰值，失败切本地系统voice或报配置错误。[Transformers.js](https://huggingface.co/docs/transformers.js/guides/webgpu)有Whisper tiny.en WebGPU例子，英文不等于中文；OG `silero-voice-activity.ts:149,384,411` WASM/hash代码含宿主文件读取，要改Worker/受控bytes，非原样浏览器实现。

## 4. 授权风险与默认策略

| 模型/依赖 | 谁触发 / 门槛 | requireCommercial=true默认 |
|---|---|---|
| Stable Audio3/Open/AA权重、T5Gemma | 用户下载/使用；Community免费商用须注册，Licensee+Affiliates收入>$1M需Enterprise；NOTICE/归属/输出训练限制，Gemma附使用/下游条款；gated与nongated都非无条件 | 🔴不装/不分发/禁；用户自装自行接受后条件选配，精确pin再核 |
| Kokoro/v1.1-zh/Qwen/Vox/ACE | GA/HF Apache/MIT；具体ONNX/GGUF/voice/服务包独立来源 | 固定包许可/hash/全体量核齐启用；默认不自动下载 |
| Whisper/Silero、Chatterbox/HTDemucs/UniverSR转换包 | 模型/镜像完整许可证未齐，示例不替model card | 未知禁；小模型PoC另核 |
| Fish/Flamingo/RE-USE/Yue2、SAM、MiniMax本地 | 非商用/人工gate/自定义未完整核 | 🔴禁，不默认候选 |
| Parakeet/Pocket | CH核CC-BY署名；Pocket gated，用户接受；体量未验 | 不默认装 |
| CH、GA图像/游戏导出 | AGPL/缺LICENSE；图像含非商用/GPL，非音频Web范围 | 🔴放弃代码依赖/Fork/导出 |
| EL/Monid/fal/Gemini云 | 用户plan/声音权利/输出使用条款，源码MIT不覆盖服务 | 可选升级，plan+预算授权；不默认云兜底 |
| MCP/SDK/three/ONNX/MLX/音频Python依赖 | 审查MIT/Apache/BSD/PSF等，具体锁版/传递SBOM另核 | 最小选配，禁EL dotenv读key |
| ffmpeg/soundfile/libsndfile | ffmpeg构建GPL/LGPL、libsndfile LGPL，用户自装/我们分发义务不同 | 不拉BtbN GPL安装器，记实际构建；分发前核SBOM |

## 5. PoC清单与浏览器播放验收（音频恢复优先级后执行）

| 任务 / 文件范围 / 体量 | 验收（未来命令；captain跑仓库测试） |
|---|---|
| P0共享闸门：`tools/local/{net,license,mcp,process}.mjs`、engine/router/store、独立SDK网关，600–1000行 | `node --test tests/audio-gateway.test.js`（待写）；§2五组local-only、consent/预算/目录/身份。P0独占核心文件避免并行冲突 |
| A本地：localsvc/poc-local、browser Worker，200–400行 | `node tools/audio/poc-local.mjs --mode local-only --backend system --out-dir /tmp/audio-poc-a`（待写），真MCP→say/合成→落盘/重启/非静音/费用0；小模型 `--backend kokoro` 仅用户预装nongated且全文件≤1GB后真跑，记录16GB Mac/Node CPU与PWA WASM/WebGPU英语、中文失败路径。不能跑交零权重替代，明确模型未验 |
| B云：poc-cloud/Monid估价薄壳，200–300行 | worker仅fixtures dry-run，captain先 `node tools/audio/poc-cloud.mjs --dry --capabilities speech,sfx,music --max-total-usd 0.10`（待写）读实时discover/inspect/wallet；再 `--execute --once --max-total-usd 0.10 --confirm` 同单同估价唯一提交，短句+3秒SFX+3秒音乐，超余额/总限/未知价停，失败不重试、不换贵模型。key仅captain持有，不调用现有e2e自动路径 |
| C Windows：audio-poc-windows.yml/poc-windows，100–200行 | windows-latest Node22 `node --test tests/audio-gateway.test.js`、`node tools/audio/poc-windows.mjs --mock --no-key`（待写）；Python3.12锁AA `python -m pytest -q <AA>/tests`；中文/空格路径、stdio、自有PID、重启/env不落key；不say/不GPU/不权重，not_ready明确 |
| D资源：resource-policy/poc-resources，150–250行 | `node tools/audio/poc-resources.mjs --fixture low-memory --no-key`（待写）模拟8/16GB、OOM/低磁盘/坏header/timeout；单重模型并发1、有界队列，缺模型不云升级，不重发付费；只测获准服务RSS |
| E页面/three：http.mjs/assets.html或audio.html/audio-player，400–600行 | `node tools/audio/http.mjs --host 127.0.0.1 --port 0 --mock --no-key`（待写）同源URL；点单→候选试听/选定→review→发布。Chrome/Firefox/Safari+iOS版本记录，A真实免费音与Bcaptain云音均试听；key不进浏览器，Origin/CSRF/路径攻击拒 |

E播放：内置r185 AudioLoader `three.core.js:50063-50085`完整arraybuffer→decode；listener挂camera、mono PositionalAudio挂角色、BGM用全局Audio，refDistance/rolloff/loopStart/End；声源移动验方向与衰减，不承诺自动遮挡。首幕必需音预取decode完再进入声画同步帧，其余有界后台；点击启声时resume，拒绝/后台恢复明确（[MDN autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)）。原WAV保留，派生MP3主用、AAC-LC/m4a可选，ogg注明codec并做Safari/iOS回退，canPlayType后仍真decode（[MDN codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs)）；循环3轮检查接缝，关键循环用PCM裁剪点，setLoop不自动修压缩padding。建议语音-16LUFS、导演lock±3LU，短SFX峰值/试听、true peak≤-1dBTP，缺工具记skipped；此为产品拟定值非浏览器标准。48k双声道float32一分钟约23MB（计算非实测），移动PCM预算32MiB候选、退出释放/LRU；长BGM用media element避免全decode。

## 6. 需要用户拍板的决定

已定的模型隔离、Monid一次≤$0.10、PWA→Tauri、离线优先和首版不克隆不再询问。剩余仅标准MCP SDK独立网关是否作为零Node依赖契约例外、以及未来中文PWA接受系统本地voice退路的产品验收标准；中文JS模型速度/体量必须实测后定，不能承诺。当前音频封存方案，主线转玩法机制打磨，不启动上述PoC。
