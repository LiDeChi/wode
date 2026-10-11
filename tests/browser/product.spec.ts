import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('work wall, mind, five handoffs, mechanism, reversal, replay and durable reload', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?qa=1');
  await expect(page.getByRole('heading', { name: '窃符', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /围城.*短游戏/ }).click();
  await page.getByRole('button', { name: /请他打开家库/ }).click();
  await expect(page.getByRole('button', { name: '递出印信' })).toBeVisible();
  await page.getByRole('button', { name: /看.*守仓.*心思/ }).first().click();
  await expect(page.getByRole('button', { name: /心 整体取舍/ })).toBeVisible();
  await page.getByRole('button', { name: '合上书页' }).click();
  for (const choice of ['递出印信', '递出借条', '递出印信', '递出借条', '递出印信']) {
    await page.getByRole('button', { name: new RegExp(`^${choice}`) }).click();
    await expect(page.locator('body')).not.toHaveClass(/busy/);
  }
  await expect(page.getByText(/已留下 5 次交接/)).toBeVisible();
  await page.getByRole('button', { name: /同一件事，换个人/ }).click();
  await expect(page.getByText('多疑的守仓人', { exact: true })).toBeVisible();
  await expect(page.getByText('急躁的守仓人', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /让另一位守仓人出场/ }).click();
  await expect(page.getByRole('button', { name: /的目光/ }).nth(1)).toBeVisible();
  await page.getByRole('button', { name: '作品墙', exact: true }).click();
  await page.getByRole('button', { name: '片场', exact: true }).click();
  await page.getByRole('button', { name: /试作核验办法/ }).click();
  await page.getByRole('button', { name: /试作、对照并安装/ }).click();
  await expect(page.locator('body')).not.toHaveClass(/busy/, { timeout: 35000 });
  if (await page.getByRole('button', { name: /用录制办法重新对照并安装/ }).isVisible()) await page.getByRole('button', { name: /用录制办法重新对照并安装/ }).click();
  await expect(page.getByText(/版本 1/)).toBeVisible();
  await page.getByRole('button', { name: '合上书页' }).click();
  await page.getByRole('button', { name: /把交接的原记录摆上桌/ }).click();
  await page.getByRole('button', { name: /核验原账册并提出修订/ }).click();
  if (await page.getByRole('button', { name: /认可证据，安排反转/ }).isVisible()) await page.getByRole('button', { name: /认可证据，安排反转/ }).click();
  await page.getByRole('button', { name: '人物志', exact: true }).click();
  await expect(page.getByRole('heading', { name: '曾经的共识' })).toBeVisible();
  await page.getByRole('button', { name: '作品墙', exact: true }).click();
  await page.getByRole('button', { name: /你刚才做的事.*真实|你刚才做的事.*世界录制/ }).click();
  await expect(page.getByText('真实经历录制', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /这段电影的出处/ }).click();
  await expect(page.getByText(/世界版本/)).toBeVisible();
  await page.getByRole('button', { name: '合上书页' }).click();
  await page.getByRole('button', { name: '回到作品墙' }).click();
  await page.reload();
  const s = await page.evaluate(async () => (await (await fetch('/api/state')).json()).state);
  expect(s.events.filter((e: { intent: { sceneId: string; choice?: string } }) => e.intent.sceneId === 'granary' && e.intent.choice)).toHaveLength(5);
  expect(s.mechanisms.some((m: { installed: boolean }) => m.installed)).toBe(true);
  const dims = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(dims.scroll).toBeLessThanOrEqual(dims.width);
  expect(errors).toEqual([]);
  await mkdir('artifacts/captures', { recursive: true });
  await page.screenshot({ path: `artifacts/captures/${info.project.name}-wall.png`, fullPage: true });
});

// The granary sets one sack out per two measures of stock, so handing grain over has to
// remove something the player can see. The draw count is the honest signal: it is what
// the renderer actually put on screen, not what the builder intended to make.
async function stageTriangles(page: import('@playwright/test').Page): Promise<number> {
  return (await page.evaluate(() => (window as any).__DIGITAL_WORLD__.getDiagnostics())).triangles;
}

test('granary stage sheds grain with the stock the world actually holds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?qa=1');
  await page.getByRole('button', { name: /围城.*短游戏/ }).click();
  await page.getByRole('button', { name: /请他打开家库/ }).click();
  await expect(page.getByRole('button', { name: /^递出印信/ })).toBeVisible();

  const grainOf = async () => (await (await page.request.get('/api/state')).json()).state.resources.granary.grain;
  await expect.poll(() => stageTriangles(page)).toBeGreaterThan(0);
  const before = await stageTriangles(page);
  expect(await grainOf()).toBe(24);

  const handOver = async (expectedGrain: number, baseline: number) => {
    await page.getByRole('button', { name: /^递出印信/ }).click();
    await expect(page.locator('body')).not.toHaveClass(/busy/);
    expect(await grainOf()).toBe(expectedGrain);
    await expect.poll(async () => baseline - await stageTriangles(page), { timeout: 10000, intervals: [100] })
      .toBeGreaterThan(0);
    return stageTriangles(page);
  };

  // Two handovers of two measures each: two sacks should leave the stage, one at a time.
  const afterFirst = await handOver(22, before);
  const afterSecond = await handOver(20, afterFirst);
  expect(afterFirst - afterSecond).toBe(168);

  await page.getByRole('button', { name: '作品墙', exact: true }).click();
  await page.getByRole('button', { name: /你刚才做的事.*世界录制/ }).click();
  await page.getByRole('button', { name: '下一段', exact: false }).click();
  await expect(page.getByRole('heading', { name: '那两袋粮' })).toBeVisible();
  await expect.poll(() => stageTriangles(page)).toBeGreaterThan(0);
  const firstRecorded = await stageTriangles(page);
  await page.getByRole('button', { name: '下一段', exact: false }).click();
  await expect.poll(async () => firstRecorded - await stageTriangles(page)).toBe(168);
  expect(errors).toEqual([]);
});

test('cinematic entry, onboarding, court, gate, night, pause and counterfactual ending', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?qa=1');
  await page.getByRole('button', { name: /进入这段历史/ }).click();
  await expect(page.getByRole('heading', { name: '长平之后', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '跳过开场' }).click();
  await expect(page.getByText('第一次见面', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /写进笔记，开始/ }).click();
  await expect(page.getByRole('heading', { name: /正路已尽/ })).toBeVisible();
  await page.getByRole('button', { name: /递上赵使竹简/ }).click();
  await expect(page.getByRole('heading', { name: /夷门不送/ })).toBeVisible();
  await page.getByRole('button', { name: /劝公子回头/ }).click();
  await expect(page.getByRole('heading', { name: '取符之夜', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByText('这一场，先停在这里。')).toBeVisible();
  // Escape must not dismiss the non-closable pause sheet: doing so would leave the
  // theatre paused with no visible control to resume.
  await page.keyboard.press('Escape');
  await expect(page.getByText('这一场，先停在这里。')).toBeVisible();
  const frozen = await page.evaluate(() => (window as any).__DIGITAL_WORLD__.getNight());
  await page.getByRole('button', { name: /继续这场戏/ }).click();
  await expect(page.getByText('这一场，先停在这里。')).toBeHidden();
  // Resuming must restart the tick: real input has to move the character again.
  const right = page.getByRole('button', { name: '向右', exact: true });
  const rightBox = (await right.boundingBox())!;
  await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
  await page.mouse.down();
  try {
    await expect.poll(async () => {
      const v = await page.evaluate(() => (window as any).__DIGITAL_WORLD__.getNight());
      return !!v && Math.abs(v.x - frozen.x) > 0.3;
    }, { timeout: 15000, intervals: [100] }).toBe(true);
  } finally { await page.mouse.up(); }
  await mkdir('artifacts/captures', { recursive: true });
  await page.screenshot({ path: `artifacts/captures/${info.project.name}-night.png` });
  await page.getByRole('button', { name: '留在门外', exact: true }).click();
  await page.getByRole('button', { name: '去邺城' }).click();
  await expect(page.getByRole('heading', { name: /合符而疑/ })).toBeVisible();
  await page.getByRole('button', { name: /让晋鄙再核一次/ }).click();
  await expect(page.getByText('本作的历史', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /把你做过的事，看成电影/ })).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: `artifacts/captures/${info.project.name}-ending.png`, fullPage: true });
});

test('API protects stale writes and ungranted actor actions', async ({ request }) => {
  const initial = await (await request.get('/api/state')).json();
  const first = await request.post('/api/preferences', { data: { baseVersion: initial.state.version, preferences: { detail: 'brief' } } });
  expect(first.ok()).toBe(true);
  const stale = await request.post('/api/preferences', { data: { baseVersion: initial.state.version, preferences: { detail: 'detailed' } } });
  expect(stale.status()).toBe(409);
  const latest = await first.json();
  const forged = await request.post('/api/intent', { data: { baseVersion: latest.state.version, intent: { verb: 'command', actorId: 'weiking', targetId: 'jinbi', sceneId: 'camp', workId: 'qiefu', amount: 100000 } } });
  expect(forged.status()).toBe(400);
  const imported = await request.post('/api/import', { data: { baseVersion: latest.state.version, bundle: { state: { schemaVersion: 1, entities: {} } } } });
  expect(imported.status()).toBe(422);
  const after = await (await request.get('/api/state')).json();
  expect(after.state.version).toBe(latest.state.version);
});
