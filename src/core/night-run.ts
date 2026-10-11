import type { ActionResult, NightStep, WorldState } from './types';
import { NightGame } from '../game/night';
import { copyWorld, failAction, finishOperation, systemIntent } from '../data/audit';
import { applyIntent } from './world';

export function replayNight(frames: unknown): NightGame {
  if (!Array.isArray(frames) || frames.length > 5400) throw new Error('潜行录制过长或缺失。');
  let ticks = 0;
  for (const step of frames) {
    if (!step || typeof step !== 'object' || Object.keys(step).some(k => !['dx', 'dz', 'crouching', 'ticks'].includes(k)) || typeof step.dx !== 'number' || typeof step.dz !== 'number' || !Number.isFinite(step.dx) || !Number.isFinite(step.dz) || Math.abs(step.dx) > 1 || Math.abs(step.dz) > 1 || typeof step.crouching !== 'boolean' || !Number.isSafeInteger(step.ticks) || step.ticks < 1) throw new Error('潜行输入不是有限方向与步数。');
    const length = Math.hypot(step.dx, step.dz);
    if (length !== 0 && Math.abs(length - 1) > .001) throw new Error('潜行方向未归一化。');
    ticks += step.ticks;
    if (ticks > 5401) throw new Error('这一夜最多三分钟，录制超过范围。');
  }
  const game = new NightGame(() => {}, () => {});
  game.restore(frames as NightStep[]);
  if (game.frames().reduce((n, f) => n + f.ticks, 0) !== ticks) throw new Error('已经结束的潜行后仍有输入。');
  return game;
}
export function recordNightRun(state: WorldState, workId: 'qiefu' | 'night', frames: unknown, finished = false, abandoned = false): ActionResult {
  if (!['qiefu', 'night'].includes(workId) || (workId === 'qiefu' && (state.story.completed || ![3, 4].includes(state.story.act)))) return failAction(state, '这一幕还没有授予潜行。');
  try {
    const game = replayNight(frames);
    if (finished && !game.view.finished && !abandoned) throw new Error('尚未被发现或带符走到出口，不能写成完成。');
    const draft = copyWorld(state);
    draft.nightRun = { workId, frames: game.frames(), finished, abandoned };
    return finishOperation(state, draft, systemIntent('night-run', { workId, frames, finished, abandoned }), finished ? '这一夜的实际移动与等待已封存。' : '灯影与脚步已记下，回到这一场可从原处接续。');
  } catch (error) { return failAction(state, error); }
}
export function resolveNight(state: WorldState, workId: 'qiefu' | 'night', frames: unknown, abandoned = false): ActionResult {
  const recorded = recordNightRun(state, workId, frames, true, abandoned);
  if (!recorded.ok) return recorded;
  const physical = replayNight(recorded.state.nightRun!.frames).view;
  return applyIntent(recorded.state, { verb: 'escort', actorId: 'player', targetId: 'ruji', itemId: 'seal', choice: physical.detected ? 'detected' : 'escape', amount: physical.finished && physical.obtained && !physical.detected ? 1 : 0, sceneId: 'night', workId });
}
