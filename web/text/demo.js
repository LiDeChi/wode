import { createTextModel } from './text-model.js';
import { createTextReader, createDialogue } from './text-reader.js';
const scope = 'demo:qiefu:night:branch-one';
const ref = (recordId, field, label, revision = '1') => ({scope,recordId,captureId:`sample-${recordId}`,revision,field,label});
const refs = {
 thought:ref('sample-react-ruji','reaction.stop','如姬当时的心思（演示反应记录）'),
 act:ref('sample-act-ruji','action.give','如姬递符（演示动作记录）'),
 director:ref('sample-director','plan','导演手稿（演示留存）'),
 mentor:ref('sample-mentor','allocation.summary','导师纸页（演示摘要）'),
 long:ref('sample-page','visibleText','取符之夜的留存正文（演示文章）'),
 missing:ref('sample-v1-film','trace','旧片段（演示缺证据）'),
};
const paragraph = (id,text,r) => ({id,type:'paragraph',text,refs:[r]});
const quote = (id,speaker,text,r) => ({id,type:'quote',speaker,text,refs:[r]});
const longBlocks = [
 {id:'opening',type:'heading',text:'门口的一段停留',refs:[refs.long]},
 paragraph('p1','宫门以内，巡灯沿着回廊慢慢移过去。你在卧内门口停住，没有再往前走。此刻的一页文字，可以记下看见的事，也可以留住没有说出口的心思；两者的来处不同，读的时候也应分清。',refs.long),
 quote('q1','如姬的台词（演示原文）','“公子曾替我报父仇。我记得这件事。可兵符在这里，魏王也在这里——你让我把它递出去，就要让我知道，你到底准备带它到哪里去。”',refs.long),
 paragraph('p2','话说到这里，她没有立刻伸手。袖边掠过案角，铜符仍留在灯下。如果留下的只是一条反应，读页能说的便是她在犹豫、在想问清楚；它还不能替这一刻添上一句“她已经交出了兵符”。',refs.long),
 {id:'act-heading',type:'heading',text:'心思如何成为行动',refs:[refs.long]},
 paragraph('p3','另一份演示材料记录了她的动作：如姬把兵符递给了来人。动作有自己的记录，指向使它发生的那次反应。于是心思和行动可以并排看，却不必互相冒充。读到这里，再追看出处，查到的仍是这页所绑定的材料。',refs.long),
 paragraph('p4','你可以先合上短题签，只留一句准确的译述；也可以把整段台词读完。省下的是眼前的字，不是故事里已经发生的事。展开读页不会让灯多走一格，不会使如姬重新感知一次，也不替导演暂停这一夜。',refs.long),
 quote('q2','导演手稿（演示引文）','“这一拍让她自己决定。你还在读字，我不把新的一页盖到你手上。”',refs.long),
 {id:'later-heading',type:'heading',text:'新的一页，不盖住旧的一页',refs:[refs.long]},
 paragraph('p5','如果留存材料有了后续，页边只添一道墨记和“有后续”这几个字。正在读的段落还在原处，选中的句子也还在。等你明确点“读后续”，才把那份材料放到眼前；旧页尚在，就还能回去看。',refs.long),
 paragraph('p6','当原文没有保存下来，读页会把缺口说清楚。“保留了摘要，原话未留存”，比补上一段像真的一样的对白更可靠。没有当时的铜槽，就不能拿今天的记忆亮度倒算昨天的心思。',refs.long),
 {id:'reading-heading',type:'heading',text:'留下可辨认的来处',refs:[refs.long]},
 paragraph('p7','来处不必把全部字段摆成一张表。它可以是一句人话：这一段来自如姬当时的反应，这一段来自她真正递符的动作，这一页来自导演留存的手稿。需要更细时，再打开同一份出处。',refs.long),
 paragraph('p8','正文的任务，是让这些不同的材料读起来清楚。中文标点与引号保留原样，长段落沿着单列向下走；短题签只是入口，不能把完整的故事压成一张难以辨认的纹理。手机上也是同一页，字会自然换行，而不会为了塞下全文不断缩小。',refs.long),
 {id:'boundary',type:'heading',text:'演示的边界',refs:[refs.long]},
 paragraph('p9','本页的角色、记录身份和后续版本都是静态样例，用来观察文字排版与阅读状态。它没有连接正在运行的世界，不展示真实资源消耗，也没有运行一段游戏来证明如姬此刻真的递过兵符。',refs.long),
];
function model(revision = '1') {
 const directorRef = ref('sample-director','plan','导演手稿（演示留存）',revision);
 return createTextModel({scope,revision,capturedAt:revision==='1'?'取符之夜，门边留存':'取符之夜，后续留存',entries:[
  {id:'ruji-thought',subjectId:'ruji',title:'如姬在想什么',short:'她想先问清楚，却还没有递符。',summary:'当时的反应只支持一个倾向：先问清楚会不会被发现。此处没有动作记录，不能说她已经交出了兵符。',availability:'complete',refs:[refs.thought],blocks:[paragraph('thought','当时发生：如姬停在想问清楚的心思上。',refs.thought),quote('thought-quote','当时的心思（演示译述）','先问清楚会不会被发现。',refs.thought),paragraph('thought-boundary','心思不是行动。只有另一条动作记录，才支持“她已经动手”。',refs.thought)]},
  {id:'ruji-act',subjectId:'ruji',title:'如姬已经做了什么',short:'另一份样例里，她把兵符递了出去。',summary:'这是另一份动作样例。递符有独立来处，不从上一条心思推断出来。',availability:'complete',refs:[refs.act],blocks:[paragraph('act','当时发生：如姬把兵符递给来人。这份演示动作材料指向她自己的那次反应。',refs.act),quote('act-quote','动作说明（演示留存）','答应为公子窃符，不说二话。',refs.act)]},
  {id:'director',subjectId:'director',title:'导演的手稿',short:revision==='1'?'这一拍让人自己决定。':'后续：灯走远了，这一拍留给你。',summary:revision==='1'?'演示安排：人物可以自己行动。已有手稿被固定在这一版，后续不替换正在读的页。':'演示后续：这一次安排改为等你。只有点“读后续”，才翻到新手稿。',availability:'complete',refs:[directorRef],blocks:[quote('plan','导演手稿（演示文字）',revision==='1'?'“这一拍让她自己决定。你可以站着，看这一夜怎样往前走。”':'“灯已经走远。这一拍留给你，等你读完再决定。”',directorRef),paragraph('plan-note','这是手稿版本变化的样例，不是正在运行的导演安排。',directorRef)]},
  {id:'mentor',subjectId:'mentor',title:'导师的纸页',short:'只留了分配摘要，原话没有留存。',summary:'演示摘要：这一场细演，另一场一笔带过。没有保存分配时的原话，也没有真实灯油或资源消耗。',availability:'partial',refs:[refs.mentor],blocks:[paragraph('mentor-summary','演示摘要：取符之夜细演，旁枝一笔带过。',refs.mentor),paragraph('mentor-gap','保留了摘要，原话未留存。本例不能用来判断真实资源如何调度。',refs.mentor)]},
  {id:'long-page',subjectId:'night',title:'取符之夜，一页留存',short:'把一段长对话、引文与叙述连起来读。',summary:'门边停留的一篇演示文章。长文是连续单列正文，保留原段落与标点，可以滚到中段，选中一句，再合上重读。',availability:'complete',refs:[refs.long],blocks:longBlocks},
  {id:'old-film',subjectId:'film',title:'旧片段的缺口',short:'只留了动作，没有留铜槽。',summary:'这个样例没有当时的心思与原话，不能用当前记忆补出一段旧对白。',availability:'missing',refs:[refs.missing],blocks:[paragraph('missing','只留了动作，没有留铜槽。保留的摘要能读，缺失的感知与对白无法追看。',refs.missing)]},
 ]});
}
const root = document.querySelector('#reader');
const reader = createTextReader({root,resolveSource:async (r,{signal}) => {
 await new Promise((resolve,reject) => { const id=setTimeout(resolve,180); signal.addEventListener('abort',()=>{clearTimeout(id);reject(new DOMException('cancelled','AbortError'));},{once:true}); });
 if (r.recordId === refs.mentor.recordId) return {status:'partial',ref:r,blocks:[paragraph('source-summary','留存摘要：这一场细演，旁枝一笔带过。',r)],missing:['保留了摘要，原话未留存。','没有真实资源调度或灯油读数。']};
 if (r.recordId === refs.missing.recordId) return {status:'missing',ref:r,blocks:[],missing:['只留了动作，没有留铜槽。']};
 return {status:'ok',ref:r,blocks:[paragraph('source-record',`${r.label}；留存身份 ${r.recordId}，对应第 ${r.revision} 版。这是固定的演示材料，读取不运行世界。`,r)]};
},onReadingChange:({open})=>{document.body.classList.toggle('reading-open',open);}});
reader.update(model());
const sampleUpdate=document.createElement('button'); sampleUpdate.type='button'; sampleUpdate.className='text-button sample-update'; sampleUpdate.textContent='送入后续（样例控制）'; sampleUpdate.addEventListener('click',()=>reader.update(model('2'))); root.querySelector('.text-dialog-header').append(sampleUpdate);
const storageKey='dw.text-demo.reading.v1';
try { const saved=JSON.parse(localStorage.getItem(storageKey)); if(saved) reader.restoreReadingState({...saved,open:false}); } catch {}
window.addEventListener('pagehide',()=>{ try {localStorage.setItem(storageKey,JSON.stringify({...reader.exportReadingState(),open:false}));} catch {} });
document.querySelector('#read-long').addEventListener('click',()=>reader.open('long-page'));
document.querySelector('#read-director').addEventListener('click',()=>reader.open('director'));
document.querySelector('#next-version').addEventListener('click',()=>{reader.update(model('2')); document.querySelector('#demo-status').textContent='第二版演示手稿已送入。旧页仍在，点“读后续”才翻页。';});
document.querySelector('#notifications').addEventListener('change',(e)=>reader.setNotifications(e.target.checked));
const words='“公子曾替我报父仇，我记得这件事。可兵符在这里，魏王也在这里——你让我把它递出去，就要让我知道，你到底准备带它到哪里去。”';
createDialogue({root:document.querySelector('#dialogue'),speaker:'如姬的台词 · 演示文字',text:words,animate:true,onContinue:()=>{document.querySelector('#dialogue-status').textContent='这一句读完了。这里只改变演示文字，没有推进世界。';}});
// 仅为该样页的读者提供接口观察；无世界对象或运行时结果。
window.textDemo={reader,model};
