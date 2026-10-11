import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

type View = {
  x: number;
  z: number;
  exposure: number;
  obtained: boolean;
  detected: boolean;
  hiding: boolean;
  finished: boolean;
  noise: number;
  pebbles: number;
  grab: number;
  inReach: boolean;
  grabbing: boolean;
  crouching: boolean;
  sprinting: boolean;
  spotted: boolean;
  guards: { x: number; z: number; angle: number; alert: number; state: 'patrol' | 'investigate' | 'return' }[];
};

async function nightView(page: import('@playwright/test').Page): Promise<View | undefined> {
  return page.evaluate(() => (window as any).__DIGITAL_WORLD__.getNight());
}

async function hold(page: import('@playwright/test').Page, key: string, direction: string, mobile: boolean, down: boolean) {
  if (!mobile) {
    if (down) await page.keyboard.down(key); else await page.keyboard.up(key);
    return;
  }
  if (!down) { await page.mouse.up(); return; }
  const box = (await page.getByRole('button', { name: direction, exact: true }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

// Drive real input until the condition holds. A leg also ends when the run is
// already finished, so an unexpected detection surfaces as a state assertion
// rather than a confusing locator timeout.
async function move(page: import('@playwright/test').Page, key: string, direction: string, condition: (v: View) => boolean, mobile: boolean) {
  await hold(page, key, direction, mobile, true);
  try {
    await expect.poll(async () => {
      const v = await nightView(page);
      return !!v && (v.finished || condition(v));
    }, { timeout: 25000, intervals: [100] }).toBe(true);
  } finally {
    await hold(page, key, direction, mobile, false);
  }
}

// Stand still until a guard is where the route needs him. This is the read the scene is
// built on, so the acceptance run does the same thing a player does rather than memorising
// timings: both guards patrol as a fixed function of elapsed time.
async function watch(page: import('@playwright/test').Page, label: string, condition: (v: View) => boolean) {
  await expect.poll(async () => {
    const v = await nightView(page);
    return !!v && (v.finished || condition(v));
  }, { timeout: 45000, intervals: [100] }).toBe(true).catch(() => { throw new Error(`等不到时机：${label}`); });
}
// Facing is 0 for +z and PI for -z, so angle < 1 means he is walking away from the far lane.
const A_WALKING_NORTH = (v: View) => v.guards[0].z > -2.2 && v.guards[0].angle < 1;
const B_WALKING_NORTH = (v: View) => v.guards[1].z > -0.6 && v.guards[1].angle < 1;

async function setCrouch(page: import('@playwright/test').Page, mobile: boolean) {
  if (mobile) { await page.getByRole('button', { name: /放轻脚步/ }).click(); return; }
  // Holding Shift turns 'd' into 'D' on the wire; the app lowercases the key, and this run
  // is what proves it does.
  await page.keyboard.down('Shift');
}
async function setGrab(page: import('@playwright/test').Page, mobile: boolean, on: boolean) {
  const button = page.locator('.grab-button');
  if (mobile) { await button.dispatchEvent(on ? 'pointerdown' : 'pointerup'); return; }
  await page.keyboard[on ? 'down' : 'up']('e');
}

for (const ending of ['historical', 'counterfactual'] as const) test(`real movement takes seal, survives pause and return, then writes a ${ending} ending`, async ({ page }, info) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const mobile = info.project.name === 'mobile';
  await page.goto('/?qa=1');
  await page.getByRole('button', { name: /进入这段历史/ }).click();
  await page.getByRole('button', { name: '跳过开场' }).click();
  await page.getByRole('button', { name: /写进笔记，开始/ }).click();
  await page.getByRole('button', { name: /递上赵使竹简/ }).click();
  await page.getByRole('button', { name: /劝公子回头/ }).click();

  // Creep from here on: crouching is quieter and is noticed far later, which is the whole
  // reason to give up the speed.
  await setCrouch(page, mobile);
  await move(page, 'd', '向右', v => v.x >= -3.5, mobile);
  // A pause / home / return round trip that must restore the exact spot and the stance.
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const stopped = await nightView(page);
  await page.getByRole('button', { name: '回到作品墙', exact: true }).click();
  await page.getByRole('button', { name: /接着演/ }).click();
  await expect.poll(async () => !!(await nightView(page))).toBe(true);
  const resumed = await nightView(page);
  expect(resumed!.x).toBeCloseTo(stopped!.x, 2);
  expect(resumed!.z).toBeCloseTo(stopped!.z, 2);
  expect(resumed!.crouching).toBe(true);

  // Both guards walk their beat as a fixed function of elapsed time. The south lane is
  // outside both cones, but A crosses it, so every crossing waits until he is walking away.
  await move(page, 'a', '向左', v => v.x <= -5.4, mobile);
  await move(page, 'w', '向前', v => v.z <= -4.3, mobile);
  await watch(page, '甲转身向北', A_WALKING_NORTH);
  await move(page, 'd', '向右', v => v.x >= 2.5, mobile);
  // Outside B's reach is the only place this floor lets you stop and think.
  await watch(page, '乙转身向北', B_WALKING_NORTH);
  await move(page, 'd', '向右', v => v.x >= 5.2, mobile);
  await move(page, 's', '向后', v => v.inReach, mobile);
  // The hold is the action the work is named for: stationary, committed, and the seal only
  // leaves the pedestal when the progress completes.
  await setGrab(page, mobile, true);
  await expect.poll(async () => (await nightView(page))?.obtained, { timeout: 10000 }).toBe(true);
  await setGrab(page, mobile, false);
  await expect(page.getByText(/兵符在手/)).toBeVisible();
  await mkdir('artifacts/captures', { recursive: true });
  await page.screenshot({ path: `artifacts/captures/${info.project.name}-seal-obtained.png` });
  await move(page, 'w', '向前', v => v.z <= -4.3, mobile);
  await move(page, 'a', '向左', v => v.x <= 2.5, mobile);
  await watch(page, '甲再次转身向北', A_WALKING_NORTH);
  await move(page, 'a', '向左', v => v.x <= -5.4, mobile);
  await move(page, 's', '向后', v => v.finished, mobile);

  const escaped = await nightView(page);
  expect(escaped!.detected).toBe(false);
  expect(escaped!.spotted).toBe(false);
  expect(escaped!.finished).toBe(true);
  expect(escaped!.pebbles).toBe(2);

  await expect(page.getByRole('heading', { name: /半块兵符/ })).toBeVisible();
  await page.getByRole('button', { name: '去邺城' }).click();
  await page.getByRole('button', { name: ending === 'historical' ? /让朱亥上前/ : /让晋鄙再核一次/ }).click();
  await expect(page.getByRole('heading', { name: ending === 'historical' ? '邯郸，解围了。' : '城得救了，有人活了下来。' })).toBeVisible();
  const s = await page.evaluate(() => (window as any).__DIGITAL_WORLD__.getState());
  expect(s.story.ending).toBe(ending); expect(s.resources.xinling.soldiers).toBe(80000); expect(s.resources.wei.soldiers).toBe(20000);
  expect(s.nightRun.frames.length).toBeGreaterThan(3);
  expect((await (await page.request.get('/api/checks')).json()).consistency.ok).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `artifacts/captures/${info.project.name}-${ending}-ending.png`, fullPage: true });
});

// An informational overlay must never be able to eat a tap meant for the controls. This is not
// hypothetical: the status toast sits low and full width, which on a phone is exactly where the
// movement pad is, so for its five seconds the pad was unclickable and a player met a dead arrow
// button. The assertion is the consequence, not the CSS - whoever a finger at the pad's centre
// would actually reach - so it still holds if the toast is restyled or moved, as long as it keeps
// out of the way. The test above only catches this when a toast happens to be on screen; this one
// puts one there on purpose.
test('a status toast never swallows a tap meant for the movement pad', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?qa=1');
  await page.getByRole('button', { name: /进入这段历史/ }).click();
  await page.getByRole('button', { name: '跳过开场' }).click();
  await page.getByRole('button', { name: /写进笔记，开始/ }).click();
  await page.getByRole('button', { name: /递上赵使竹简/ }).click();
  await page.getByRole('button', { name: /劝公子回头/ }).click();
  await expect(page.getByRole('heading', { name: '取符之夜', exact: true })).toBeVisible();

  const reach = await page.locator('.touch-pad button[data-key="arrowright"]').evaluate(node => {
    // A real toast, at the size and place the app gives it, long enough to fill its line.
    const toast = document.createElement('div');
    toast.className = 'toast'; toast.setAttribute('role', 'status');
    toast.textContent = '这是一条状态提示，长度足够让它铺满手机上的整整一行。';
    document.body.append(toast);
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const result = {
      pointerEvents: getComputedStyle(toast).pointerEvents,
      reached: !!hit && (hit === node || node.contains(hit)),
      padWidth: Math.round(box.width)
    };
    toast.remove();
    return result;
  });
  // The pad must be a real target on both viewports, or the check below proves nothing.
  expect(reach.padWidth).toBeGreaterThan(0);
  expect(reach.pointerEvents).toBe('none');
  expect(reach.reached).toBe(true);
  expect(errors).toEqual([]);
  await mkdir('artifacts/captures', { recursive: true });
  await page.screenshot({ path: `artifacts/captures/${info.project.name}-toast-over-pad.png` });
});

test('export import, brief detail and actual audio unlock retain their stated behavior', async ({ page }) => {
  await page.goto('/?qa=1');
  await page.getByRole('button', { name: '开启声音', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭声音', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭声音', exact: true }).click();
  const initial = await (await page.request.get('/api/export')).json();
  await page.getByRole('button', { name: '导师的笔记', exact: true }).click();
  await page.locator('input[name="detail"][value="brief"]').check();
  await page.getByRole('button', { name: /更正这几句话/ }).click();
  await expect(page.getByRole('status')).toHaveText('导师已把更正写进笔记。');
  await expect(page.locator('body')).not.toHaveClass(/busy/);
  await expect(page.locator('input[name="detail"][value="brief"]')).toBeChecked();
  await page.locator('#world-import').setInputFiles({ name: 'world.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(initial)) });
  await expect(page.locator('input[name="detail"][value="normal"]')).toBeChecked();
  expect((await (await page.request.get('/api/checks')).json()).consistency.ok).toBe(true);
});
