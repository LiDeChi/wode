import { BASE, VARIABLES } from './world.js';
import { PERSONAS } from '/shared/engine/simulate.js';
const $ = (id)=>document.getElementById(id);
const pct=(v)=>`${Math.round(v*100)}%`;
const esc=(s)=>String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ENDINGS={history:{label:'史书的走法',color:'#698aa0'},'jinbi-lives':{label:'晋鄙活下来',color:'#469487'},broken:{label:'兵符没出宫',color:'#ba825b'},stuck:{label:'半路走不下去',color:'#896b94'}};
const ACTS={daliang:'信陵君府',yimen:'夷门',night:'取符之夜',ye:'邺城',granary:'暮色粮仓'};
let settings={...BASE}, baseline=null, changed=null, active=null, busy=false;
const dev=new URLSearchParams(location.search).get('dev')==='1';
$('debug').hidden=!dev;
const worker=new Worker('/lab/runner.js',{type:'module'});
let request=0;const pending=new Map();
worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data);};
worker.onerror=(e)=>{for(const p of pending.values())p.reject(new Error(e.message));pending.clear();};
function measure(config) {return new Promise((resolve,reject)=>{const id=++request;pending.set(id,{resolve,reject});worker.postMessage({id,...config});});}
$('knobs').innerHTML=VARIABLES.map(v=>`<div class="knob"><div class="knob-head"><label for="${v.id}">${v.label}</label><output for="${v.id}" id="${v.id}-value">${v.base.toFixed(2)}</output></div><div class="dial"><i aria-hidden="true"></i><input type="range" id="${v.id}" min="${v.min}" max="${v.max}" step="${v.step}" value="${v.base}"></div><small>${v.why}</small></div>`).join('');
function refreshKnobs() {for(const v of VARIABLES){const input=$(v.id);input.value=settings[v.id];$(`${v.id}-value`).value=settings[v.id].toFixed(2);input.previousElementSibling.style.setProperty('--angle',`${-120+240*(settings[v.id]-v.min)/(v.max-v.min)}deg`);input.disabled=busy;} }
for(const v of VARIABLES) $(v.id).addEventListener('input',()=>{
  settings={...(baseline?.settings || BASE),[v.id]:Number($(v.id).value)};
  changed=null;refreshKnobs();render();
  $('status').textContent=`只改变「${v.label}」，其他旋钮回到改前设定。点重跑验证。`;
});
function distribution(result){const counts=Object.fromEntries(Object.keys(ENDINGS).map(k=>[k,0]));for(const r of result.runs)counts[r.stuck?'stuck':r.ending]++;return counts;}
function renderColumn(id,result,title){
  const el=$(id);
  if(!result){el.innerHTML=`<div class="result-title"><span class="dot"></span>${title}</div><div class="placeholder">拧一个旋钮，再点「重跑」。<br>这盏灯会显示改变后的世界。</div>`;return;}
  const counts=distribution(result),total=result.runs.length;
  const avg=result.runs.reduce((a,r)=>a+r.seconds,0)/total;
  const attempts=result.runs.flatMap(r=>r.attempts);
  const people=[...new Set(attempts.map(r=>r.name))];
  const coverage=Math.max(...result.probe.map(p=>p.coverage));
  el.innerHTML=`<div class="result-title"><span class="dot"></span>${title}</div><div class="config">${result.director==='lu'?'陆导':'单导'}，四种玩家各 ${result.n} 局<br>${VARIABLES.filter(v=>result.settings[v.id]!==BASE[v.id]).map(v=>`${v.label} ${result.settings[v.id].toFixed(2)}`).join('；') || '原世界的设定'}</div>
    <div class="stack" aria-label="结局分布">${Object.entries(counts).map(([k,n])=>`<span style="width:${n/total*100}%;--color:${ENDINGS[k].color}" title="${ENDINGS[k].label} ${pct(n/total)}"></span>`).join('')}</div>
    ${Object.entries(counts).map(([k,n])=>`<button class="ending" data-column="${id}" data-ending="${k}" ${!n?'disabled':''} style="--color:${ENDINGS[k].color}"><i></i>${ENDINGS[k].label}<b>${pct(n/total)}</b><em>${n} 局</em></button>`).join('')}
    <div class="stats"><div>平均戏内时长<strong>${(avg/60).toFixed(1)} 分</strong></div><div>同手段最高覆盖<strong>${pct(coverage)}</strong></div></div>
    <h3>四种玩家走成什么</h3>${Object.entries(PERSONAS).map(([k,p])=>{const rs=result.runs.filter(r=>r.persona===k);const wins=rs.filter(r=>r.ending==='jinbi-lives'&&!r.stuck).length;return `<div class="persona-row"><span>${p.label}</span><span>晋鄙生还 ${pct(wins/rs.length)}</span></div>`;}).join('')}
    <h3>戏里谁被说动</h3><p>百分比 = 点头次数 / 对该人物使用该诉求次数。— 表示这批走法没试过。</p>
    <table><thead><tr><th>人物</th>${['义','利','惧','恩'].map(a=>`<th>${a}</th>`).join('')}</tr></thead><tbody>${people.map(name=>`<tr><td>${esc(name)}</td>${['义','利','惧','恩'].map(a=>{const rs=attempts.filter(r=>r.name===name&&r.appeal===a);return `<td title="${rs.filter(r=>r.accepted).length} / ${rs.length}">${rs.length?pct(rs.filter(r=>r.accepted).length/rs.length):'—'}</td>`;}).join('')}</tr>`).join('')}</tbody></table>
    <h3>同一句话，能摆平所有人吗</h3><p>独立试探：在开场初值下，向公子、侯嬴、如姬、魏王、晋鄙各讲一次强度 0.8 的同种诉求。不写入演出。</p>
    ${result.probe.map(p=>`<div class="probe-row"><strong>${p.appeal} ${pct(p.coverage)}</strong><span>${p.rows.filter(r=>r.accepted).map(r=>esc(r.name)).join('、') || '无人点头'}</span></div>`).join('')}<p>五人全点头的手段：${result.probe.filter(p=>p.coverage===1).map(p=>p.appeal).join('、') || '没有'}。</p>`;
}
function render(){renderColumn('before',baseline,'改前');renderColumn('after',changed,'改后');$('representative').hidden=true;
  if(!baseline)return;
  $('sample-note').textContent=`每列 ${baseline.runs.length} 局 / 相同种子`;
  const diff=VARIABLES.find(v=>settings[v.id]!==baseline.settings[v.id]);
  if(!changed){$('difference').textContent=diff?`${diff.label}：${baseline.settings[diff.id].toFixed(2)} → ${settings[diff.id].toFixed(2)}。结果尚未重跑。`:'原设定已测好。选一个旋钮，看看结局是否改变。';return;}
  const a=distribution(baseline),b=distribution(changed),keys=Object.keys(a).sort((x,y)=>Math.abs(b[y]-a[y])-Math.abs(b[x]-a[x]));const k=keys[0];
  const intro=diff?`${diff.label} ${baseline.settings[diff.id].toFixed(2)} → ${settings[diff.id].toFixed(2)}`:'同一设定再测一次';
  const acceptance=r=>r.runs.flatMap(x=>x.attempts).filter(x=>x.accepted).length;
  const hesitates=r=>r.runs.filter(x=>x.hesitant).length;
  const detail=hesitates(baseline)!==hesitates(changed)?`结局分布没变，如姬犹豫从 ${pct(hesitates(baseline)/baseline.runs.length)} 变为 ${pct(hesitates(changed)/changed.runs.length)}`:`结局分布没变，戏里点头次数 ${acceptance(baseline)} → ${acceptance(changed)}`;
  $('difference').textContent=`${intro}：${a[k]!==b[k]?`${ENDINGS[k].label}从 ${pct(a[k]/baseline.runs.length)} 变为 ${pct(b[k]/changed.runs.length)}`:detail}。`;
}
async function run(){if(busy)return;busy=true;refreshKnobs();$('run').disabled=true;$('director').disabled=true;$('samples').disabled=true;$('reset').disabled=true;$('status').textContent='四种玩家正在各走一遍…';
  try{const director=$('director').value,n=Number($('samples').value);
    if(!baseline || baseline.director!==director || baseline.n!==n){settings={...BASE};refreshKnobs();baseline={...await measure({director,n,settings:{...BASE}}),director,n,settings:{...BASE}};changed=null;}
    else changed={...await measure({director,n,settings:{...settings}}),director,n,settings:{...settings}};
    render();const latest=changed || baseline;$('status').textContent=`已跑完 ${latest.runs.length} 局，用时 ${(latest.elapsed/1000).toFixed(2)} 秒。点一个结局查看代表走法。`;
    if(dev)$('debug').querySelector('pre').textContent=JSON.stringify({settings,elapsed:latest.elapsed,stuck:latest.runs.filter(r=>r.stuck).length},null,2);
  }catch(e){$('status').textContent=`这批实验没跑完：${e.message}。刷新页面后再试。`;console.error(e);}
  finally{busy=false;refreshKnobs();for(const id of ['run','director','samples','reset'])$(id).disabled=false;}
}
$('run').addEventListener('click',run);
for(const id of ['director','samples'])$(id).addEventListener('change',()=>{baseline=null;changed=null;settings={...BASE};refreshKnobs();render();$('status').textContent='实验条件已换。点重跑建立新的对照组。';});
$('reset').addEventListener('click',()=>{settings={...(baseline?.settings || BASE)};changed=null;refreshKnobs();render();});
document.addEventListener('click',e=>{const button=e.target.closest('[data-ending]');if(!button)return;const result=button.dataset.column==='before'?baseline:changed;const r=result.runs.find(r=>(r.stuck?'stuck':r.ending)===button.dataset.ending);if(!r)return;
  active=r;$('representative').hidden=false;
  $('representative').innerHTML=`<h2>${button.dataset.column==='before'?'改前':'改后'}的一局：${ENDINGS[r.stuck?'stuck':r.ending].label}</h2><p>${PERSONAS[r.persona].label}，种子 ${r.seed}。同一条件、同一种子可重跑复验。</p><ol>${r.trail.map(t=>`<li><strong>${ACTS[t.act] || esc(t.act)}：${esc(t.line)}</strong><p>${esc(t.text)}${t.reason?` ${esc(t.person)}：${esc(t.reason)}`:''}</p></li>`).join('')}</ol><a href="#" id="to-film">把这局看成电影</a><p>电影按原世界回放动作；实验旋钮仅在科研台生效，改后反应可能不同。</p>`;
  $('to-film').addEventListener('click',ev=>{ev.preventDefault();localStorage.setItem('dw.lastFilm',JSON.stringify(active.record));location.href=`/film.html?film=${encodeURIComponent(JSON.stringify(active.record))}`;});
  $('representative').scrollIntoView({block:'start',behavior:'auto'});
});
refreshKnobs();render();run();
