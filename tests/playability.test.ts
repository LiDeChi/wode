// What this file exists to guarantee: 取符之夜 stays a scene you can learn and still lose.
//
// A one-off probe can only show that today's constants happen to work. Probes live in `.runtime/`,
// which is not in the repository, so a probe also cannot stop the next change from quietly
// removing the thing it measured. These seven tests are the difference between "I measured it
// once" and "it cannot silently stop being true".
//
// They are floors, not targets. A designer retuning the guards is free to move every constant:
// the scene may get harder or easier. What it may not do is lose the margin that rewards reading
// the guards, lose the punishment for ignoring them, lose the middle outcome where you are seen
// and still get home, widen the leash until standing in the open in front of a guard on his own
// beat becomes safe, or quietly stop being about 如姬's theft and your escort.
//
// The escort moved what "reading the guards" buys. She walks the path you walked, about a step
// behind, and she cannot crouch - court dress, and she is carrying the tally - so she crosses every
// corridor upright and slightly late, and a window that only just fits you does not fit her.
//
// REGRESSION, recorded rather than hidden. That trade was measured on the one-room act, where
// committing the instant a window opens ended 1/12 clean and 11/12 seen and waiting for her to
// clear it too ended 12/12 clean. The act is two rooms now, and it is four times as long, so the
// trade is gone: every gate's window is longer than the crossing it governs - the shortest is the
// doorway guard's 9.8s against a crossing of about 5s - so she clears whatever the timing. Both
// slop levels now run 12/12 clean and no sampled route has produced the middle outcome in 48
// attempts. The escort itself is intact and still asserted below: she is the one who carries the
// tally out, and she is seen from 3.2m where a crouching player is seen from 2.45m. What is lost
// is the reward for *waiting*. Restoring it needs windows about as long as their crossings, and
// two attempts are recorded in .runtime and in night.ts's plinth-guard comment: sweeping that
// guard's rate over 0.20-0.62 never exposed the theft at all, and scaling all five beats by 2.0
// produced the right shape in the wrong direction (12 clean at slop 0, 5 clean / 7 seen at slop
// 6), i.e. lateness made her more exposed rather than less.
//
// So 望风 is still the mechanic in the rules, and the window still has to be read for two bodies -
// but on this floor the reading is no longer paid for in waiting, and the three tests at the
// bottom of this file say so in their own names rather than pretending otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NightGame } from '../src/game/night.ts';
import type { NightView } from '../src/presentation/contracts.ts';

const DT = 1 / 30;
type Leg = { key?: string; crouch: boolean; sprint?: boolean; grab?: boolean; until: (view: NightView) => boolean };

// The night is two rooms now - the courtyard and the hall behind the palace wall - and five
// guards, so a gate is crossed five times going in and four coming back. Every gate reads the
// same way: the guard must be walking away from the crossing (he looks the way he walks, so
// angle < 1 means his cone is pointed down his own beat and not across the lane) and he must
// have got far enough past it that a body on his line is behind him. What differs per guard is
// the threshold, because the beats differ: A sweeps 3.6m across the courtyard and so has to be
// well clear, while B..E sweep 1.4-2.6m around z=-1.1 where a shallower mark is already behind
// them. That per-gate read is the skill the act is asking for.
const GATE_READ: Array<(view: NightView) => boolean> = [
  view => view.guards[0].z > -2.2 && view.guards[0].angle < 1,
  view => view.guards[1].z > -0.6 && view.guards[1].angle < 1,
  view => view.guards[2].z > -0.6 && view.guards[2].angle < 1,
  view => view.guards[3].z > -0.6 && view.guards[3].angle < 1,
  view => view.guards[4].z > -0.6 && view.guards[4].angle < 1
];
// An already-true condition, for building the same route with the reading taken out.
const HOLD = () => true;
const gate = (waiting: boolean, index: number): Leg => ({ crouch: true, until: waiting ? GATE_READ[index] : HOLD });

// The line a player arrives at after being caught a few times: creep down the lane along the far
// wall, wait at each gate, cross, take the tally, come back the same way. The waits are the whole
// route's cost, which is why removing them is the control rather than a retuning.
const OUT = (waiting: boolean): Leg[] => [
  { key: 'a', crouch: true, until: view => view.x <= -5.4 },
  { key: 'w', crouch: true, until: view => view.z <= -4.3 },
  gate(waiting, 0), { key: 'd', crouch: true, until: view => view.x >= 2.5 },
  gate(waiting, 1), { key: 'd', crouch: true, until: view => view.x >= 7.0 },
  gate(waiting, 2), { key: 'd', crouch: true, until: view => view.x >= 14.5 },
  gate(waiting, 3), { key: 'd', crouch: true, until: view => view.x >= 23.0 },
  gate(waiting, 4),
  // Back onto the plinth's own line before turning. A late player carries a few ticks of
  // overshoot from the lane leg into every `d` leg that follows, so without this nudge they walk
  // east pinned to the far bound and 如姬 - trailing onto that same line - stays just outside her
  // reach of the tally and the theft never starts.
  { key: 's', crouch: true, until: view => view.z >= -4.3 },
  { key: 'd', crouch: true, until: view => view.x >= 28.0 },
  { key: 's', crouch: true, until: view => view.inReach },
  { crouch: true, grab: true, until: view => view.obtained }
];
const BACK = (waiting: boolean): Leg[] => [
  { key: 'w', crouch: true, until: view => view.z <= -4.3 },
  { key: 'a', crouch: true, until: view => view.x <= 23.0 },
  gate(waiting, 3), { key: 'a', crouch: true, until: view => view.x <= 14.5 },
  gate(waiting, 2), { key: 'a', crouch: true, until: view => view.x <= 7.0 },
  gate(waiting, 1), { key: 'a', crouch: true, until: view => view.x <= 2.5 },
  gate(waiting, 0),
  { key: 'a', crouch: true, until: view => view.x <= -5.4 },
  { key: 's', crouch: true, until: view => view.finished }
];
const READ_THE_GUARDS: Leg[] = [...OUT(true), ...BACK(true)];

// The same errand with the reading removed and the escape made loud: no waits going in, and the
// way out run at a sprint instead of creeping. This is the control that proves the waits above
// are load bearing rather than decoration.
const IGNORE_THE_GUARDS: Leg[] = [
  ...OUT(false),
  { key: 'w', crouch: true, until: view => view.z <= -4.3 },
  { key: 'a', crouch: false, sprint: true, until: view => view.x <= -5.4 },
  { key: 's', crouch: false, sprint: true, until: view => view.finished }
];

// slopTicks models a human, not an ideal: the key stays down and the next condition is noticed a
// few ticks after it became true. It doubles as overshoot, because a poll that notices late also
// releases late.
function drive(legs: Leg[], startPhase: number, slopTicks: number): NightView {
  const game = new NightGame(() => {}, () => {});
  game.elapsed = startPhase;
  for (const leg of legs) {
    if (leg.grab !== undefined) game.grab(leg.grab);
    game.crouching = leg.crouch;
    game.sprinting = Boolean(leg.sprint);
    if (leg.key) game.key(leg.key, true);
    let ticks = 0;
    while (!leg.until(game.view) && !game.view.finished && ticks < 30 * 120) { game.tick(DT); ticks++; if (game.view.detected) break; }
    for (let n = 0; n < slopTicks && !game.view.detected && !game.view.finished; n++) game.tick(DT);
    if (leg.grab !== undefined) game.grab(false);
    if (leg.key) game.key(leg.key, false);
    if (game.view.detected || game.view.finished) break;
  }
  return game.view;
}

// Patrol is a pure function of elapsed, so sweeping the guard's start phase is a fair sample of
// the ways a run can line up with the beat rather than one lucky alignment.
function survey(legs: Leg[], slopTicks: number, phases: number) {
  const tally = { clean: 0, spotted: 0, caught: 0, unfinished: 0 };
  for (let index = 0; index < phases; index++) {
    const view = drive(legs, index * (30 / phases), slopTicks);
    if (view.detected) tally.caught++;
    else if (!view.obtained || !view.finished) tally.unfinished++;
    else if (view.spotted) tally.spotted++;
    else tally.clean++;
  }
  return tally;
}

test('reading the guards pays: being a fifth of a second late on every leg still gets you home', () => {
  const late = survey(READ_THE_GUARDS, 6, 12);
  // What the careful line buys is now "home with the tally", not "home unremarked". She is the
  // one carrying it and she cannot crouch, so the narrow window lets her be read on the way out.
  assert.ok(late.caught <= 2, `读守卫、每段都晚 0.2 秒，不应当多数被抓；实测危险 ${late.caught}/12、未结束 ${late.unfinished}/12`);
  assert.ok(late.clean + late.spotted >= 10, `读守卫的一程应当多数带着兵符收场；实测干净 ${late.clean}、被发现但逃脱 ${late.spotted}、被抓 ${late.caught}、未结束 ${late.unfinished}`);
});

test('patience no longer changes the outcome on this floor, and that is recorded rather than assumed', () => {
  // This test used to require patient.clean > hasty.clean. On the one-room act that held, and it
  // was the escort's whole skill claim: a player who steps off the moment the window opens is
  // reading it for one body, and she is still in the corridor. On the two-room map the windows
  // outlast their crossings, so both slops come out clean and the comparison has nothing to bite
  // on. The assertion is inverted deliberately: it now pins the *current* behaviour so that
  // whoever shortens the beats to bring the trade back gets a failure telling them to flip it,
  // instead of a green run that hides the change.
  const hasty = survey(READ_THE_GUARDS, 0, 12);
  const patient = survey(READ_THE_GUARDS, 6, 12);
  assert.ok(patient.clean >= 8, `等她也能过去再走，应当多数干净收场；实测 ${patient.clean}/12`);
  assert.equal(patient.caught + hasty.caught, 0, `这一档不该有人被抓；实测等足被抓 ${patient.caught}、抢窗被抓 ${hasty.caught}`);
  assert.equal(hasty.clean, patient.clean, `窗口长于穿越时，两个 slop 应当同样干净；实测抢窗 ${hasty.clean} 对等足 ${patient.clean}`);
});

test('the tally is hers, and she has to come out with it', () => {
  // The document has 如姬 steal the tally and the player escort her, so the seal must end up in
  // her hands rather than the player's, and it must be hers when the act closes.
  const view = drive(READ_THE_GUARDS, 0, 0);
  assert.equal(view.obtained, true, '这一程应当能拿到兵符');
  assert.equal(view.companion.carrying, true, '兵符应当在如姬手上，而不是玩家手上');
  assert.ok(Math.hypot(view.companion.x - view.x, view.companion.z - view.z) <= 5,
    '结算时两人不应当天各一方');
});

test('ignoring the guards still costs the run', () => {
  const blind = survey(IGNORE_THE_GUARDS, 0, 12);
  assert.ok(blind.caught >= 6, `不看守卫直冲进去应当多数被抓；实测干净 ${blind.clean}、被发现但逃脱 ${blind.spotted}、被抓 ${blind.caught}、未结束 ${blind.unfinished}`);
});

test('the middle outcome is unreachable on this floor, and the routes prove it rather than hide it', () => {
  // Sampled across both routes and a late and a punctual player. On the one-room act this
  // counted at least one "seen, and away with it". Here it counts zero, and the zero is the
  // finding: with every window longer than its crossing, exposure is bimodal - either nobody
  // looks at you for a tick, or a guard has been drawn onto you and it saturates. There is no
  // band where she is read for half a second and walks out. The ending still exists in the rules
  // and is derived in tests/kernel.test.ts; what is gone is its reachability in play. Asserting
  // the zero keeps that on the record: restoring the band flips this test, and the header above
  // carries the measurements of the two attempts so far.
  const attempts = [READ_THE_GUARDS, IGNORE_THE_GUARDS];
  let spotted = 0;
  for (const legs of attempts) for (const slop of [0, 6]) spotted += survey(legs, slop, 12).spotted;
  assert.equal(spotted, 0, `本图 48 次尝试应当测不到「被看见但带着兵符回家」；实测 ${spotted} 次，说明中间那一档又回来了，请把这条断言改回去并更新文件头的记录`);
});

test('rushing the window still costs nothing, which is the same regression seen from the other side', () => {
  // The band just short of the careful line: a player who reads the guard but commits for himself
  // alone. That used to resolve as "seen, and away with it" - the loss moved from the run to the
  // secret. On this floor it resolves as clean, for the reason in the header. What still holds,
  // and is the part worth keeping, is that committing early never *ends* the run: the cost of a
  // rushed window here is zero, but it is not death, so the act still fails soft.
  const hasty = survey(READ_THE_GUARDS, 0, 12);
  assert.ok(hasty.caught <= 2, `抢窗口不该直接结束这一局；实测被抓 ${hasty.caught}/12，未结束 ${hasty.unfinished}/12`);
  assert.equal(hasty.spotted, 0, `本图上抢窗应当测不到「被看见」；实测 ${hasty.spotted}/12，中间那一档若回来了请连同上一条一起改回`);
});

test('a guard on his own beat still catches a motionless figure in the open', () => {
  // The leash is scoped to a guard who has been drawn off his beat, and this is the reason. If
  // giving up were driven by the player going quiet instead, standing still would become a
  // blanket defence everywhere: a guard would stop being able to name a body he is looking at.
  // That would make stillness free and make the drawn cone a lie.
  const witness = new NightGame(() => {}, () => {});
  witness.view.x = 4.9; witness.view.z = 1.6;
  for (let n = 0; n < 60; n++) witness.tick(DT);
  assert.equal(witness.view.noise, 0, '这个位置上的人确实一动没动');
  assert.equal(witness.view.detected, true, '站在本职守卫的正前方不动，仍然会被认出来');
});
