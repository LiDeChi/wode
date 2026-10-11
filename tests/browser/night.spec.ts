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
  guards: { x: number; z: number; angle: number }[];
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

  // Real input, then a pause / home / return round trip that must restore the exact spot.
  await move(page, 'd', '向右', v => v.x >= -3.5, mobile);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const stopped = await nightView(page);
  await page.getByRole('button', { name: '回到作品墙', exact: true }).click();
  await page.getByRole('button', { name: /接着演/ }).click();
  await expect.poll(async () => !!(await nightView(page))).toBe(true);
  const resumed = await nightView(page);
  expect(resumed!.x).toBeCloseTo(stopped!.x, 2);
  expect(resumed!.z).toBeCloseTo(stopped!.z, 2);

  // Both guards sweep the open floor on a fixed patrol. This way round keeps to
  // the south lane and the lane west of the central hedge, which no cone covers,
  // so the run does not depend on how fast the driver presses the keys.
  await move(page, 'a', '向左', v => v.x <= -5.4, mobile);
  await move(page, 'w', '向前', v => v.z <= -4.4, mobile);
  await move(page, 'd', '向右', v => v.x >= 3.2, mobile);
  await move(page, 's', '向后', v => v.z >= -3.6, mobile);
  await move(page, 'd', '向右', v => v.obtained, mobile);
  await expect(page.getByText(/兵符在手/)).toBeVisible();
  await mkdir('artifacts/captures', { recursive: true });
  await page.screenshot({ path: `artifacts/captures/${info.project.name}-seal-obtained.png` });
  await move(page, 'w', '向前', v => v.z <= -4.4, mobile);
  // Use the outer wall as a stop. Driver delays cannot carry this turn into the
  // crate at x=-4, which would block the northbound leg.
  await move(page, 'a', '向左', v => v.x <= -6.59, mobile);
  await move(page, 's', '向后', v => v.z >= 3.8, mobile);
  await move(page, 'd', '向右', v => v.finished, mobile);

  const escaped = await nightView(page);
  expect(escaped!.detected).toBe(false);
  expect(escaped!.finished).toBe(true);

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
