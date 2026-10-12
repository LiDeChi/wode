# 中文文本渲染器：题签、台词与一页能读的字

> 独立的文本设计与实现契约，尚未实现。用户另要求好看的文本渲染器；本契约与 `docs/notes/note1.md` 没有派生关系。
> 只写本文，不改页面、用户笔记或核心，不 build／test／typecheck。全媒介抽象另见 `docs/design/PRESENTATION-ABSTRACTION.md`。

## 1. 要做成什么样

字在器物上有短题签，角色说话有清楚的台词，长内容有一页安静的阅读空间。题签、对话、正文、出处各有层级，现场不会变成一组报表卡片。文本渲染器负责文字的美观与可读性，不接管世界怎样被抽象，也不负责导师如何调资源。

保留现有实物语言：导师纸页、导演手稿、铜槽说明、史简和木签（`docs/design/LIVING.md:58-71`）；总稿要求不做监控面板、记录如实呈现（`docs/数字世界 设计总稿 v3（草案） (2).md:228-260`）。正文不是把开发 JSON 换一个字体，来源层也不必默认暴露字段。

## 2. 现有接缝与可共用的部分

| 当前代码 | 可保留 | 文本接入要补的事 |
| --- | --- | --- |
| `web/play/ui.js:28-43,86-111` | 台词条、玩家明确继续 | 句子完整可读、打字可跳过、减少动态直接全显；阅读 Enter／空格不能误触世界继续 |
| `web/play/living.js:23-28,105-115` | 原生 details、人物细节入口 | 主体 id 固定开合，不能依数组下标把下一人的字换进旧展开项 |
| `web/play/living.js:87-101,117-130` | 铜槽固定打开时感知，关闭回焦点 | 导演案不每拍 replaceChildren；阅读页固定版本，新材料只提示“有后续” |
| `web/hub/text.js:41-83` | Canvas 薄板短字、现有字体栈 | maxWidth 不是自动中文换行；长文用 DOM，不缩窄字形或把全文塞纹理 |
| `web/hub/records.js:19-44,66-79` | 笔记、灯油、手稿器物与来源 | 题签留在器物，正文用共用读页；翻页不重建世界状态 |

共用模块只做语义块排版、阅读 UI 状态与已有材料的展示。页面适配器负责从自己已有的可见记录读数据。文字可承载在机关或阅读浮层上，但模块不导入 Three、不改机关几何或替换四个场景。

## 3. 中文版式与样式 Token

视觉方向是“器物旁的一页”：现场的铜、木和光保持个性，正文单列、左对齐、足够留白。显著变化只在页边留一道有意义的墨记；不使用重复圆角卡片、渐变标题、数字徽章或每段一条装饰线。

| Token | 具体选择 |
| --- | --- |
| 纸／墨／轻墨 | `#F8F7F2`／`#242A29`／`#52605C`；正文与注记对比度需实测，不能用极低透明度淡掉来源 |
| 页边／选中／变化墨记 | `#CFD5CC`／`#315F56`／`#85432F`；颜色配文字含义，不独立表达告警 |
| 正文 | `"Songti SC","STSong","Noto Serif CJK SC",serif`，桌面 18px、手机 17px，行高 1.85，字距 0 |
| 控件／题签／短注 | `"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`，16px；来源注 14px／1.6 |
| 标题 | 页题 26px／1.4，段题 20px／1.5；不下载字体，不假定每个环境安装同一字体 |
| 正文列与间距 | 最大 34em，左对齐；桌面内边距 32px、段间 0.9em；手机 20px、段间 0.8em |
| 阅读浮层 | 桌面最大宽 720px、最大高 85dvh；手机全高扣除 safe-area；只一条正文滚动轴 |

正文横排。竖排只用于 2–8 字短题签；完整标题在阅读页与无障碍名称里保留。正文使用段落、引用、列表与至多两级段题，字下无纹理噪点。标题不强制全大写，不把某一个词单独涂色制造层级；字重、尺寸与间距就能说明关系。

容器 `lang="zh-CN"`，正文 `line-break:strict; word-break:normal; overflow-wrap:anywhere`。浏览器负责中文禁则，不逐字拆 span；配对引号与括号不人工插换行。很短的时间／出处标记可作为不换行单元，长英文与地址允许换行；不空格对齐、不按屏幕宽度向原文写换行符。

保留引文原来的繁简与标点。模板的省略号用“……”、破折号用“——”，不要拼出“。。”；结构化块保持原段落，`quote` 保留引用身份，原文省略必须明示。动态文字走 textContent，不把用户原文当 HTML／Markdown 执行。

## 4. 对话、细读与出处的角色

台词条保留说话者、完整句子、显示整句／继续按钮。短句自然断行，一次通常 1–3 行；超过现场高度就给“读完整这段”的页入口，不裁掉后半句、不缩小到难读。现场不能用字符截断当摘要；简短译述由宿主按已知内容提供，渲染器不擅自改写原话。

打字效果只是一种可选表现：使用 Unicode code point／grapheme 处理，不切坏字符；标点停顿有上限，用户可立即显示全文。辅助技术一次读取完整句子，不能随着每个字反复 live 朗读。reduced-motion 下直接显全文，取消纸页滑动与自动镜头。点“显示整句”只完成文字表现；必须另有明确继续操作才执行原宿主命令。

细读是连续文章，不是长列表卡片。复杂过程的说明可以跟在对应机关旁，长篇正文进单列读页；读页有固定可见的返回／关闭、可选目录、原生滚动。不能让正文与目录各自滚成两层套筒，也不把数千字横向拉成卷轴。

“当时发生”“若此刻问他”“他当时的说法”“史料／本作可能”各有准确标题。停层与动作来处分别呈现；actor.react 只支持心思倾向，actor.act 才支持发生的行动（`docs/design/LIVING.md:62,111-113`）。不能靠文案把低层推断变成确定事实。

出处默认用人话和可识别的记录身份；开发模式才加 seq、path、派生量。动态文字可查同一份来处，查出处不意味着文本模块要执行重放或重新感知。

## 5. 内容与只读来源契约

宿主提供四类文本材料：现场短句、准确的简短译述、细读语义块、来源说明。每个有意义的段落绑定 refs；控件文案无需假来源。refs 至少带 scope（世界／episode／分支／视角／录制）、recordId／seq 或 captureId、revision、字段定位。裸 seq 不能跨电影与实验当缓存键。

事件文本引用已有记录；状态派生注明当时输入／留存快照与派生规则版本，没有 seq 就不编一个。现有读镜 `shared/life/view.js:183-250` 可给 policy 与 trace，但其有限经历窗口不是完整历史。无法定位当时版本时显示“当前读数”；trace 没存时说“只留了动作，没有留铜槽”，不是用现在记忆倒算。

严格版角色记忆不放 line／appeal 原文。原文读取仍走现有可见呈现记录；渲染模型、阅读缓存、排版与开合不回填 minds／life.store，不为展示扩大视野。此约束不授权本文修改旧存档或记忆格式。正文是呈现材料而非新的角色事实，索引保留来源引用（`docs/design/LIVING.md:98`）。

来源返回 partial 时展示仍有的部分和具体缺口；原文未留存则写“保留了摘要，原话未留存”。旧 v1 电影不因文本页展开就变成有真实 trace 的生活录制（`web/film/format.js:1-3,24-42`）。不生成兜底原话、缺失对白或 LLM 摘要。

## 6. 阅读状态与动态更新

条目稳定键为 scope＋subjectId＋entryId，正文块也有稳定 blockId。开合、阅读版本、焦点、滚动锚点、选中属于本地呈现状态；update 不自动打开、不全量 innerHTML／replaceChildren 替换正在读的页。

打开时 pin capture／revision。新文字到来只在页边显示“有后续”；点后才换版本，材料仍保留时可回旧页。结论未变化不重复通知；已聚焦或正在选中的题签也不偷偷换字。切场后原页标“上一场”，不把旧打开项套给下一人；换 scope 使用独立状态。

滚动恢复使用 blockId＋段内位置与偏移；不自动滚到底，不在 resize 或字体替换时回页首。close 回到原入口，入口消失则回其稳定父入口。迟到的来源读取按 scope／revision 检查，旧请求取消或丢弃，不能覆盖后来打开的页。

一个 polite live-region 只朗读合并后的“有后续／缺来源”等状态，不每拍读整页；用户可关声音与提示。文字更新不是逻辑拍，不调用 advance／watch／ask／perceive／dress／meet，也不默默暂停世界。既有暂停控制由宿主保留。

## 7. 键盘、手机与无障碍

短块用原生 details／summary；复杂页用 button＋aria-expanded／aria-controls，不强制单开。触控目标至少 44×44px，入口不依赖 hover 或细小纸边；Canvas 题签有同名 DOM 按钮，内容也在 DOM 阅读页可达。

浮层用 dialog 或等价语义，设标题、关闭按钮、合适的开页焦点；模态内 Tab 循序，退出回入口。Enter／空格只操作聚焦控件，Escape 关闭最内层读页；世界快捷键在阅读、输入、选中文字时让路。现有 ui.advance 的 document 监听需由 play 接入者隔离（`web/play/ui.js:105-111`）。模块只发阅读状态回调，不直接执行玩法。

滚轮、触控拖动在阅读页里不穿透给背景相机；PageUp／PageDown／Home／End 遵循浏览器阅读行为。320px 窄屏、200% 放大不出现正文横滚；软键盘与 safe-area 下关闭可见。焦点环清晰，文字对比达可读标准，减少动态不损失全文与来源入口。

## 8. 最小 API（拟新增，零依赖）

纯内容模块＋浏览器 DOM 模块＋作用域 CSS，首版不解析任意 Markdown／HTML，不导入框架、Three 或 LLM。

```js
// web/presentation/text-model.js：只读输入，返回语义树
createTextModel({ scope, revision, capturedAt, entries, locale:'zh-CN' })
// -> {scope,revision,entries:TextEntry[]}
// TextEntry = {id,subjectId,title,short,summary,blocks,refs,availability}
// blocks = [{id,type:'paragraph'|'quote'|'heading'|'list',text|items,refs}]
// availability = 'complete'|'partial'|'missing'，仅指声明的覆盖范围

// web/presentation/text-reader.js：只管 DOM 与本地阅读状态
createTextReader({root,resolveSource,onReadingChange,dev:false})
// -> {update(model),open(entryId,{part}),close(),
//     exportReadingState(),restoreReadingState(state),destroy()}
// part = 'text'|'source'；update 不隐式 open
// resolveSource(ref,{signal}) -> Promise<{status,ref,blocks,missing,capturedAt}>
// status = 'ok'|'partial'|'missing'|'unavailable'
// onReadingChange({open,modal}) 供宿主隔离快捷键，不是玩法事件
```

原文可由 resolver 延迟读取可见记录；不返回 DOM 或任意 HTML。模型不查询世界、不随机、不读时钟、不写存档。renderer 不持有 session／play，依赖的是纯读解析器；所有世界操作留在宿主。readingState 只含条目键、pin revision、开合与滚动锚点，不复制原文或世界存档。刷新后旧 capture 不存在则显示缺口，不拿当前版冒充。

## 9. 首个原型与分开接入

| 任务 | 唯一写入范围 | 交付 |
| --- | --- | --- |
| 文本首个原型 | `web/presentation/**` | 两模块、CSS、独立 demo.html，明确标“演示文字”；题签、短／长对话、细读引用、partial 来源、异步后续、reduced-motion |
| play 接入 | `web/play/**` | ui／living 使用共用语义树；保留原命令与暂停入口；隔离键盘，固定真实铜槽文本来源 |
| film 接入 | `web/film/**` | 从其录制分支读材料，v1 缺口可读；开页不执行重放步骤或写主世界 |
| hub 接入 | `web/hub/**` | Canvas 保留短题签，records 长文进读页；不重建器物、不再次见面／分配 |
| lab 接入 | `web/lab/**` | 各次试验分开 scope；比较正文来源准确，查来源不重新跑试验 |
| QA／整合 | 主 Agent 另分配测试目录 | 原型视觉与只读验收后再接四页；公共目录单一实现者维护，页面成员不复制另一套 reader |

首个原型只验证文本品质和阅读状态；不做全媒介折叠原型，不实现资源调度。宿主缺可见记录读取器时先接 partial，不为凑完整改 shared 或制造感知。

主 Agent 后续打开 demo：读一句长对话、显示整句、展开引用与来源，滚到中段并选中文字；输入后续版本，原页和焦点保留，点“读后续”才换页；缺原文样例显示缺口。手机、键盘、320px、200% 与 reduced-motion 可读；读屏不逐字抢读。

真实页在既有暂停下比较打开／关闭／查来源前后的 session.save 与账本，必须无新增记录。运行中世界自己变动不算阅读写入，不能用自动暂停掩盖副作用。电影阅读不增加重放命令，hub 阅读不改 chosen／spent，lab 查来源不再拉杆。上述是后续验收方案，本轮只交设计，未运行测试。

当前支持的设计范围是中文排版、语义层级、对话与长文、移动／键盘阅读、稳定更新及真实来源显示。没有已运行阅读器；暂不支持任意 Markdown／HTML、自动 LLM 改写、恢复已丢原文、重演缺失感知、全媒介调度或真实算力计费。
