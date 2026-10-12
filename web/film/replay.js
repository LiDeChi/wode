import { createSession } from '../../shared/engine/session.js';
import { createPlay } from '../../shared/engine/play.js';
import { decode, directorInput } from './format.js';
import { experienceOf } from '../hub/experience.js';

const copy = value => JSON.parse(JSON.stringify(value));
export const PERSPECTIVES = { xinling: '主角', ruji: '如姬', houying: '侯嬴' };

/** Watch a detached world: perspective must never change the recorded choices or ledger. */
function thoughtsOf(session, view) {
  const result = {};
  if (!view.act) return result;
  const saved = copy(session.save());
  for (const id of Object.keys(PERSPECTIVES)) {
    if (!view.people?.some(p => p.id === id)) continue;
    const observer = createPlay(createSession({ saved: copy(saved) }));
    const thought = observer.watch(id);
    result[id] = thought.last?.explain || thought.preview?.explain || thought.wants || '';
  }
  return result;
}

/** Re-run once, cache the film's frames; animation never calls the engine. */
export function makeReplay(input) {
  const record = decode(input);
  if (record.v === 2) return replayLiving(record);
  const { answers, need } = directorInput(record.director);
  const session = createSession();
  session.meet(answers, need);
  const play = createPlay(session);
  const frames = [];
  let previousScene = 'daliang';
  const capture = (text, { choice = '', focus = null, ending = false, view = play.view() } = {}) => {
    if (view.act) previousScene = view.act;
    frames.push({ view: copy(view), scene: previousScene, text: String(text || ''), choice, focus,
      thoughts: thoughtsOf(session, view), ending });
  };
  const transition = () => {
    const view = play.next();
    if (view.stage === 'film') capture(view.film);
    else if (view.stage === 'coda') capture(view.coda.lived, { ending: true, view });
    else if (view.stage === 'done') capture(view.acts?.at(-1)?.text || '这一局，走到了这里。', { ending: true, view });
    else if (view.act) capture(view.scene || view.goal, { view });
  };
  const begin = () => { const v = play.begin(); capture(v.film, { view: v }); };
  // Supports both exact method traces and runScript-style action-only traces.
  const explicit = record.steps.some(s => s.op === 'next');
  if (record.steps[0]?.op !== 'begin') begin();
  if (!explicit && play.view().stage === 'film') transition();
  const advance = () => {
    let v = play.view();
    while (['act', 'granary'].includes(v.stage) && v.done) { transition(); v = play.view(); }
    if (v.stage === 'coda') transition();
  };
  for (let i = 0; i < record.steps.length; i++) {
    const { op, args } = record.steps[i];
    const before = play.view();
    const option = before.options?.find(o => o.id === args[0]);
    try {
      if (op === 'begin') { begin(); if (!explicit) transition(); }
      else if (op === 'next') transition();
      else {
        const out = play[op](...args);
        const view = play.view();
        const last = view.log?.at(-1);
        const text = op === 'choose' ? out.text || last?.text :
          op === 'watch' ? out.last?.explain || out.preview?.explain || out.wants :
          op === 'ask' ? out.answer : `换成${view.granary?.keepers?.find(k => k.id === args[0])?.name || args[0]}守仓。`;
        capture(text, { view, choice: op === 'choose' ? option?.line || args[0] : '',
          focus: out.r?.person || out.person || option?.to || (op === 'chooseKeeper' ? args[0] : last?.person) });
        if (!explicit) advance();
      }
    } catch (error) {
      throw new Error(`第 ${i + 1} 个动作无法回放：${error.message}`);
    }
  }
  const state = copy(play.state());
  if (!frames.at(-1)?.ending) capture(state.coda?.lived || '录制到这里。你可以回游戏页继续这一局。', { ending: true });
  // Expose immutable readbacks for dev-only diagnostics and independent verification.
  return { frames, state, record, ledger: copy(session.ledger.toJSON()),
    director: session.state.directorId, mentorNotes: session.mentor.notes() };
}

// v2 不补 begin/next、不猜等待：严格按保存的调用与逻辑拍，演在独立会话里。
function replayLiving(record) {
  const session = createSession({ saved: copy(record.initial) });
  const play = createPlay(session, { living: 'director', seed: record.seed });
  const frames = [];
  let previousScene = record.initial.play?.life?.sceneId || 'daliang';
  function capture(text, choice = '', focus = null) {
    const view = play.view();
    previousScene = view.act || previousScene;
    const life = play.lifeRead(view.act || previousScene);
    const thoughts = Object.fromEntries((life?.actors ?? []).filter(a => a.last?.action).map(a => [a.id, a.last.action]));
    frames.push({ view: copy(view), scene: previousScene, text: String(text || view.coda?.lived || view.goal || view.film || '这一拍，人物留在此处。'), choice, focus,
      thoughts, ending: view.stage === 'done', tick: play.life.tick(), life: copy(life), experience: experienceOf(session) });
  }
  capture(play.view().film || '从这一卷的开场存档继续。');
  for (const [i, event] of record.timeline.entries()) {
    try {
      if (event.kind === 'pause') {
        if (event.paused) play.life.pause(); else play.life.resume();
        continue;
      }
      if (event.kind === 'step') {
        const { op, args, tick } = record.steps[event.index];
        if (tick !== play.life.tick()) throw new Error('动作不在记录的那一拍。');
        const before = play.view();
        const option = before.options?.find(o => o.id === args[0]);
        // 空 args 是「看」这类不带参数的调用：照原样调用，不补一个猜出来的参数。
        const out = play[op](...args);
        capture(out?.answer || out?.text || out?.film || out?.last?.explain || out?.preview?.explain || play.view().log?.at(-1)?.text,
          op === 'choose' ? option?.line || args[0] : '', out?.person || option?.to);
      } else {
        const result = play.advance({ toTick: event.toTick, inputs: copy(event.inputs) });
        const outcome = result?.processed?.at(-1)?.outcome;
        const view = play.view();
        const actors = play.lifeRead(view.act || previousScene)?.actors ?? [];
        const words = actors.filter(a => a.last?.at === play.life.tick()).map(a => `${a.name}：${a.last.action || '停下来想了一想'}`).join('。');
        capture(outcome?.answer || outcome?.text || words || view.log?.at(-1)?.text);
      }
    } catch (error) { throw new Error(`第 ${i + 1} 段拍序无法回放：${error.message}`); }
  }
  if (!frames.at(-1).ending) frames.push({ ...copy(frames.at(-1)), ending: true, text: '录制到这里。回到戏台，仍是你原来的世界。' });
  return { frames, state: copy(play.state()), record, ledger: copy(session.ledger.toJSON()), saved: copy(session.save()), director: session.state.directorId, mentorNotes: session.mentor.notes() };
}
