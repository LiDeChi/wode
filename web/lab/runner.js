import { createPlay, estimateSeconds } from '/shared/engine/play.js';
import { ANSWERS, NEED, PERSONAS } from '/shared/engine/simulate.js';
import { makeRng } from '/shared/core/rng.js';
import { makeWorld } from './world.js';

const APPEALS = ['义','利','惧','恩'];
const appealOf = (o) => ({yi:'义',back:'义',hou:'义',li:'利',ju:'惧',fear:'惧',king:'惧',en:'恩'})[o.id] || null;
export function runOne(settings, director, personaId, seed) {
  const {session,scenes} = makeWorld(settings);
  const answers = ANSWERS[director==='shan'?'B':'A'];
  session.meet(answers, NEED);
  const play = createPlay(session,{scenes});
  const steps = [];
  const call = (op,...args) => { steps.push({op,args}); return play[op](...args); };
  call('begin');
  let v = call('next');
  const memo = {rng:makeRng(seed),lastPos:null,lastChoice:null,nightStalled:false,switchedKeeper:false};
  const attempts = [];
  const trail = [];
  let count = 0;
  while(v.stage!=='done' && count++<80) {
    if(!['act','granary'].includes(v.stage) || v.done) {
      v=call('next');
      if(v.act==='night') {const last=play.state().acts.night?.last;trail.push({act:'night',line:'如姬取符前的反应',text:last?.explain || '',person:'如姬',reason:last?.reason});}
      continue;
    }
    const options = v.options.filter(o=>o.allowed!==false);
    if(!options.length) break;
    const action = PERSONAS[personaId].next(v,options,play,memo);
    const act = v.act;
    if(action.op==='watch' || action.op==='ask') {
      const response=call(action.op,action.person);
      trail.push({act,line:`${action.op==='watch'?'看心思':'问缘由'}：${session.minds[action.person]?.name || action.person}`,text:response.answer || response.last?.explain || response.preview?.explain || '停下来观察人物。'});
      v=play.view();
    } else if(action.op==='keeper') {
      v=call('chooseKeeper',action.id);
      trail.push({act,line:'换一个守仓人',text:session.minds[action.id]?.name || action.id});
    } else {
      const opt=options.find(o=>o.id===action.id);
      const out=call('choose',action.id);
      const r=out.r;
      if(r?.accepted!==null && r?.accepted!==undefined && appealOf(opt)) attempts.push({person:r.person,name:r.name,appeal:appealOf(opt),accepted:r.accepted});
      trail.push({act,line:opt?.line || action.id,text:out.text || r?.heard?.reason || '',person:r?.name,reason:r?.heard?.reason});
      v=out.view;
    }
  }
  return {ending:v.ending || 'stuck',stuck:v.stage!=='done',hesitant:!!play.state().night?.hesitant,seconds:estimateSeconds(play),attempts,trail,
    record:{v:1,director:{id:director,answers,need:NEED},steps,lab:{settings,persona:personaId,seed}}};
}
function probe(settings) {
  const ids=['xinling','houying','ruji','weiwang','jinbi'];
  return APPEALS.map(appeal=>{
    const rows=ids.map(id=>{const {session}=makeWorld(settings);const mind=session.minds[id];return {name:mind.name,accepted:mind.hear({[appeal]:.8},'actor:player').accepted};});
    return {appeal,rows,coverage:rows.filter(r=>r.accepted).length/rows.length};
  });
}
self.onmessage=({data})=>{
  try {
    const runs=[];
    const start=performance.now();
    for(const persona of Object.keys(PERSONAS)) for(let seed=1;seed<=data.n;seed++) runs.push({...runOne(data.settings,data.director,persona,seed),persona,seed});
    self.postMessage({id:data.id,runs,probe:probe(data.settings),elapsed:performance.now()-start});
  } catch(e) {self.postMessage({id:data.id,error:e.message,stack:e.stack});}
};
