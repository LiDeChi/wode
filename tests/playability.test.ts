// What this file exists to guarantee: 取符之夜 stays a scene you can learn and still lose.
//
// A one-off probe can only show that today's constants happen to work. Probes live in `.runtime/`,
// which is not in the repository, so a probe also cannot stop the next change from quietly
// removing the thing it measured. These five tests are the difference between "I measured it
// once" and "it cannot silently stop being true".
//
// They are floors, not targets. A designer retuning the guards is free to move every constant:
// the scene may get harder or easier. What it may not do is lose the margin that rewards reading
// the guards, lose the punishment for ignoring them, lose the middle outcome where you are seen
// and still get home, or widen the leash until standing in the open in front of a guard on his
// own beat becomes safe. Those are what make it a stealth scene rather than a walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NightGame } from '../src/game/night.ts';
import type { NightView } from '../src/presentation/contracts.ts';

const DT = 1 / 30;
type Leg = { key?: string; crouch: boolean; sprint?: boolean; grab?: boolean; until: (view: NightView) => boolean };

// A is safer to pass once he has walked north, because he looks the way he walks; B owns the
// floor around the seal, so the excursion waits outside his reach and commits while he is
// walking away from it. Both conditions read the guard. That read is the skill.
const A_PAST_LANE = (view: NightView) => view.guards[0].z > -2.2 && view.guards[0].angle < 1;
const B_NORTH = (view: NightView) => view.guards[1].z > -0.6 && view.guards[1].angle < 1;

// The line a player arrives at after being caught a few times: creep, wait for the beat, take the
// seal inside one window, leave the same way.
const READ_THE_GUARDS: Leg[] = [
  { key: 'a', crouch: true, until: view => view.x <= -5.4 },
  { key: 'w', crouch: true, until: view => view.z <= -4.3 },
  { crouch: true, until: A_PAST_LANE },
  { key: 'd', crouch: true, until: view => view.x >= 2.5 },
  { crouch: true, until: B_NORTH },
  { key: 'd', crouch: true, until: view => view.x >= 5.2 },
  { key: 's', crouch: true, until: view => view.inReach },
  { crouch: true, grab: true, until: view => view.obtained },
  { key: 'w', crouch: true, until: view => view.z <= -4.3 },
  { key: 'a', crouch: true, until: view => view.x <= 2.5 },
  { crouch: true, until: A_PAST_LANE },
  { key: 'a', crouch: true, until: view => view.x <= -5.4 },
  { key: 's', crouch: true, until: view => view.finished }
];

// The same errand with the reading removed and the escape made loud: no waits, straight in, run
// home. This is the control that proves the waits above are load bearing rather than decoration.
const IGNORE_THE_GUARDS: Leg[] = [
  { key: 'a', crouch: true, until: view => view.x <= -5.4 },
  { key: 'w', crouch: true, until: view => view.z <= -4.3 },
  { key: 'd', crouch: true, until: view => view.x >= 5.2 },
  { key: 's', crouch: true, until: view => view.inReach },
  { crouch: true, grab: true, until: view => view.obtained },
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
  assert.ok(late.clean >= 8, `读守卫、每段都晚 0.2 秒，仍然应当多数能全身而退；实测干净 ${late.clean}、被发现但逃脱 ${late.spotted}、被抓 ${late.caught}、未结束 ${late.unfinished}`);
});

test('ignoring the guards still costs the run', () => {
  const blind = survey(IGNORE_THE_GUARDS, 0, 12);
  assert.ok(blind.caught >= 6, `不看守卫直冲进去应当多数被抓；实测干净 ${blind.clean}、被发现但逃脱 ${blind.spotted}、被抓 ${blind.caught}、未结束 ${blind.unfinished}`);
});

test('being seen and still getting home is reachable, not a theoretical third outcome', () => {
  // Sampled across both routes and a late and a punctual player, because the middle outcome is
  // meant to belong to whoever is imperfect, not only to whoever is reckless.
  const attempts = [READ_THE_GUARDS, IGNORE_THE_GUARDS];
  let spotted = 0;
  for (const legs of attempts) for (const slop of [0, 6]) spotted += survey(legs, slop, 12).spotted;
  assert.ok(spotted >= 1, `三种结局里的「被看见但带着兵符回家」应当在实战里真实可达；48 次尝试里实测 ${spotted} 次`);
});

test('being glimpsed near the seal costs the clean ending, not the run', () => {
  // The band one notch past what the careful line absorbs, where a run used to be decided by
  // which phase of a guard's beat it happened to land on. A guard drawn off his own beat now
  // gives up rather than running the player down, so the same band should resolve as "seen, and
  // away with it": the loss moves from the run to the secret.
  const late = survey(READ_THE_GUARDS, 15, 12);
  assert.ok(late.caught <= 2, `只晚半秒就该用「被发现但逃出去」付账，而不是直接结束；实测被抓 ${late.caught}/12，未结束 ${late.unfinished}/12`);
  assert.ok(late.spotted >= 5, `这一档应当多数以被看见但仍带着兵符回家收场；实测 ${late.spotted}/12`);
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
