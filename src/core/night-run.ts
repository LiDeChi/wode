import type { ActionResult, NightStep, WorldState } from './types';
import type { NightView } from '../presentation/contracts';
import { NightGame } from '../game/night';
import { copyWorld, failAction, finishOperation, systemIntent } from '../data/audit';
import { applyIntent } from './world';

export interface NightOutcome { choice: 'detected' | 'spotted' | 'escape'; amount: 0 | 1 }
// What a replayed night physically amounts to. This lives in one place on purpose: when
// the rule was written out twice, the copy inside the validator knew only detected/escape
// and so rejected every run that ended seen-but-escaped — the third outcome could be
// played but never recorded. Both callers now ask this function.
export function deriveNightOutcome(view: NightView): NightOutcome {
  if (view.detected) return { choice: 'detected', amount: 0 };
  if (view.finished && view.obtained) return { choice: view.spotted ? 'spotted' : 'escape', amount: 1 };
  return { choice: 'escape', amount: 0 };
}

export function replayNight(frames: unknown): NightGame {
  // Every frame covers at least one tick and the run itself is capped at 7201 ticks, so
  // this cap can never reject a recording the tick cap would accept. The two bounds are
  // written from the same number on purpose: 7201 ticks is the 240s the scene stops at.
  if (!Array.isArray(frames) || frames.length > 7201) throw new Error('潜行录制过长或缺失。');
  let ticks = 0;
  for (const step of frames) {
    if (!step || typeof step !== 'object' || Object.keys(step).some(k => !['dx', 'dz', 'crouching', 'sprint', 'action', 'ticks'].includes(k)) || typeof step.dx !== 'number' || typeof step.dz !== 'number' || !Number.isFinite(step.dx) || !Number.isFinite(step.dz) || Math.abs(step.dx) > 1 || Math.abs(step.dz) > 1 || typeof step.crouching !== 'boolean' || typeof step.sprint !== 'boolean' || !['none', 'grab', 'throw'].includes(step.action) || !Number.isSafeInteger(step.ticks) || step.ticks < 1) throw new Error('潜行输入不是有限方向、步数与动作。');
    // A throw is a single event, never a state held across ticks; accepting a longer run
    // would let one recorded pebble be spent many times on replay.
    if (step.action === 'throw' && step.ticks !== 1) throw new Error('掷石必须只占一步。');
    const length = Math.hypot(step.dx, step.dz);
    if (length !== 0 && Math.abs(length - 1) > .001) throw new Error('潜行方向未归一化。');
    ticks += step.ticks;
    if (ticks > 7201) throw new Error('这一夜最多四分钟，录制超过范围。');
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
  // Being seen clearly and getting away is not the same as never being seen: the seal
  // still leaves the palace, but the secret does not, so it is its own outcome.
  const { choice, amount } = deriveNightOutcome(physical);
  return applyIntent(recorded.state, { verb: 'escort', actorId: 'player', targetId: 'ruji', itemId: 'seal', choice, amount, sceneId: 'night', workId });
}
