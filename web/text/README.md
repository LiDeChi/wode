# 中文文本阅读器

独立样页：`/text.html`。本地现有服务入口为 http://127.0.0.1:4320/text.html 。样页使用明确标示的静态演示文字，没有 session/play，也没有真实导师资源调度。

加载 `web/text/style.css`，再从两个零依赖模块导入：

```js
import { createTextModel } from '/text/text-model.js';
import { createTextReader, createDialogue } from '/text/text-reader.js';
const model = createTextModel({
  scope: 'world:episode:branch:view', revision: '1', capturedAt: '门边留存',
  entries: [{ id:'ruji', subjectId:'ruji', title:'如姬当时的心思',
    short:'准确短句', summary:'宿主提供的摘要', availability:'partial',
    refs:[{scope:'world:episode:branch:view',recordId:'retained-record',revision:'1',field:'reaction.stop',label:'如姬当时的反应'}],
    blocks:[{id:'thought',type:'paragraph',text:'已有记录的译述'}] }],
});
const reader = createTextReader({
  root: document.querySelector('#reader'),
  resolveSource: async (ref, {signal}) => ({status:'partial',ref,blocks:[],missing:['保留了摘要，原话未留存。']}),
  onReadingChange: ({open,modal}) => { /* 宿主隔离快捷键与背景相机；不自动暂停世界 */ },
});
reader.update(model); // 不自动打开；打开后 pin revision
reader.open('ruji'); // 或 open('ruji', {part:'source'})
```

模型支持 paragraph、quote（可带 speaker）、heading（level 1/2）、list（items）。各块可覆盖 refs，否则继承条目 refs；availability 为 complete/partial/missing。渲染使用 textContent，不执行 HTML/Markdown，不擅自生成摘要、原文或来源序号。

reader API：`update(model)`、`open(entryId,{part:'text'|'source'})`、`close()`、`exportReadingState()`、`restoreReadingState(state)`、`setNotifications(enabled)`、`destroy()`。导出的阅读状态仅含稳定键、版本、开合、滚动锚点和提示偏好；原文与世界存档不进入状态。宿主负责持久化及提供旧版本，旧版本没有留存时显示缺口。版本缓存是本 reader 实例的留存材料，不是角色记忆。

来源 resolver 接收 `{signal}`，返回 `{status:'ok'|'partial'|'missing'|'unavailable',ref,blocks,missing}`。返回 ref 必须与请求的 scope、revision、recordId、seq、captureId、field 相同；换页与关闭会取消旧请求。宿主必须只提供已有可见材料，不在 resolver 里 advance/watch/ask/perceive/meet/dress/replay。

`createDialogue({root,speaker,text,animate,onContinue})` 返回 `{finish,destroy}`。打字时“继续”禁用，“显示整句”只结束打字；全文后明确继续才调用宿主回调。reduced-motion 直接显示全文，辅助技术一次读取完整句子。

样页复验：打开长页→滚到中段并选字→“送入后续”→正文、选区与焦点仍在；打开导演手稿→送入后续→点“读后续”才换版本；导师纸页与旧片段→追看出处，检查缺口；Escape 关闭→焦点回入口；手机与 320px 窄屏关闭始终可见。示例的阅读 UI 状态仅保存到 `dw.text-demo.reading.v1`，与世界存档无关。

自查截图（新命名，未覆盖历史图）：`/tmp/t64-v2-desktop-home-1292x761.png`、`/tmp/t64-v2-desktop-long-1292x761.png`、`/tmp/t64-v2-mobile-home-390x844.png`、`/tmp/t64-v2-mobile-long-390x844.png`。Playwright 使用现有 Chrome，没有安装依赖。1292/390/320 与等效 200% 布局（646×380）无正文横向溢出；无控制台错误；pin 更新、选区与滚动、焦点返回、explicit 后续、partial/missing、取消来源、安全文本、减少动态均作浏览器自查。实际系统读屏、软键盘和真实浏览器 200% 缩放未人工验证。

四个真实页面尚未接入。真实暂停下的 session.save/账本前后相等、电影命令数、导师分配与科研拉杆次数须由接入者验证；此静态样页不能证明这些运行时结果。没有全媒介折叠、资源调度、LLM 改写或丢失原文恢复功能。未运行仓库测试、build 或 typecheck。
