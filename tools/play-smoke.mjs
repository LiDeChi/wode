// 自动玩一整局的冒烟测试：陆导一局、单导一局，每幕截图到 /tmp/play-shots/，控制台不许有错。
// 用法：node tools/play-smoke.mjs [--dir lu|shan] [--head] [--debug] [--tag=v8] [--night=none|clean]
//
// 两个坑记在这里：
//   1. 场景里的签每帧跟着镜头动，Playwright 的 click() 会因为「元素不稳定」一直等到超时；
//      所以这里一律用页面内的 .click()——等于玩家真的按了一下，走的是同一条处理函数。
//   2. #tags 容器是 pointer-events:none（让点击穿过画布），只有 .tag 自己是 auto。
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');

const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = process.env.PLAY_BASE || 'http://127.0.0.1:4320';
const SHOTS = '/tmp/play-shots';

const argv = process.argv.slice(2);
const argOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const DIRS = argOf('--dir') ? [argOf('--dir')] : ['lu', 'shan'];
// --night=none（默认）：夜里只是贴墙看，符没带出来 → 邺城案上只有一卷没递出去的军令
// --night=clean：照着 fixtures 那条正路把符摸出来（token_b → rush）→ 案上摆两半铜符
const NIGHT = argOf('--night') || 'none';
const HEAD = argv.includes('--head');
const DEBUG = argv.includes('--debug');

// 走 tests/fixtures/play-scripts.mjs 里那条 canonical 脚本：A/yi/back/clean/yi，再进粮仓 seal→report。
// 单导那局到结局就收束（不进粮仓），两局把分支都过一遍。
const PLAN = {
  daliang: ['yi'],
  yimen: ['back'],
  // 摸符那张签挂在场景里那件令牌实物上，只有令牌进画面时签才在；所以每走一步都先伸一次手，
  // 够不着才往前走（tapTag 自己会判断签在不在屏上，够不着就不会被记账）
  night: NIGHT === 'clean' ? ['token_a', 'token_b', 'step', 'rush', 'wait'] : ['step', 'step'],
  ye: ['yi'],
  inspect: ['seal', 'note', 'pledge'],
  decide: ['report', 'witness', 'hide'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function visible(page, sel) {
  if (page.isClosed()) return false;
  return page.evaluate((s) => {
    const n = document.querySelector(s);
    if (!n || n.hidden) return false;
    const st = getComputedStyle(n);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, sel).catch(() => false);
}

/** 页面内点击（不受「元素每帧在动」影响） */
async function tap(page, sel) {
  return page.evaluate((s) => {
    const n = document.querySelector(s);
    if (!n) return false;
    n.click();
    return true;
  }, sel).catch(() => false);
}

/** 点场景里那张可见、可用的签（签在淡入的一瞬间量不到，所以试几遍） */
async function tapTag(page, intent, tries = 4) {
  for (let i = 0; i < tries; i += 1) {
    const ok = await page.evaluate((id) => {
      const onScreen = (n) => {
        const st = getComputedStyle(n);
        if (st.visibility === 'hidden' || st.display === 'none') return false;
        const r = n.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
      };
      const hit = [...document.querySelectorAll('#tags .tag')]
        .find((n) => n.dataset.intent === id && n.dataset.disabled !== '1' && onScreen(n));
      if (!hit) return false;
      hit.click();
      return true;
    }, intent).catch(() => false);
    if (ok) return true;
    await sleep(220);
  }
  return false;
}

/** 打开还没打开的人物签（幂等：已经展开的人不要再点一次，否则会收起来）
 *  skip 里的人点下去是「换个人说话」而不是展开诉求签，自动玩的时候要躲开；
 *  keepers 里不是当前那一位的守仓人也要躲开（点了他话头会退回上一轮）。
 *  「摊开没摊开」直接问 dev 挂出来的 __play.opened，比从 DOM 里猜可靠。 */
async function openPeople(page, skip = [], keepers = [], current = null) {
  const keeperKeys = keepers.map((id) => `person:${id}`);
  const currentKey = current ? `person:${current}` : null;
  const skipKeys = skip.map((k) => (k.includes(':') ? k : `person:${k}`));
  // 签是分帧挂出来的（台词一放，签就清空），所以走两遍：第一遍摊开，第二遍补上迟到的那些人
  for (let pass = 0; pass < 2; pass += 1) {
    const state = await page.evaluate(() => ({
      keys: [...document.querySelectorAll('#tags .tag-person')].map((n) => n.dataset.key),
      opened: window.__play?.opened ?? [],
    })).catch(() => ({ keys: [], opened: [] }));
    for (const key of state.keys) {
      if (skipKeys.includes(key)) continue;
      // 粮仓里点别的守仓人是「换个人说话」，会把话头退回上一轮，自动玩的时候要躲开
      if (keeperKeys.includes(key) && key !== currentKey) continue;
      if (state.opened.includes(key.slice('person:'.length))) continue;
      await page.evaluate((k) => {
        const n = [...document.querySelectorAll('#tags .tag-person')].find((x) => x.dataset.key === k);
        if (n) n.click();
      }, key).catch(() => {});
      await sleep(160);
    }
    await sleep(120);
  }
}

async function tapText(page, text) {
  return page.evaluate((t) => {
    const n = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(t) && x.offsetParent !== null);
    if (!n) return false;
    n.click();
    return true;
  }, text).catch(() => false);
}

const DEV_UI = process.argv.includes('--dev');
// 每一版截图都留档，不覆盖旧的：--tag=v5 → /tmp/play-shots/v5-lu-daliang.png
const TAG = process.argv.find((a) => a.startsWith('--tag='))?.slice(6) || 'v4';   // 截图要不要带调试叠层（给用户看的图别带）
const MAXTICKS = Number(process.argv.find((a) => a.startsWith('--ticks='))?.slice(8) || 150);

async function playRun(browser, dir, { granary }) {
  const errors = [];
  const shots = [];
  const acts = [];
  const trace = [];
  const used = new Set();
  let lastWhere = '';
  let filmTried = false;
  let filmShot = false;
  let ye = null;
  const ctx = await browser.newContext({ viewport: { width: 1292, height: 761 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // 浏览器自己取消的导航（ERR_ABORTED）不算毛病；真的加载不到由下面那条 200 检查来管
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    if (why.includes('ERR_ABORTED')) return;
    errors.push(`requestfailed: ${r.url()} ${why}`);
  });
  page.on('crash', () => errors.push('page crash'));

  const shot = async (name) => {
    const file = `${SHOTS}/${TAG}-${dir}-${name}.png`;
    await page.evaluate(() => { const d = document.querySelector('#dev'); if (d) { d.dataset.prevHidden = d.hidden ? '1' : '0'; d.hidden = true; } }).catch(() => {});
    await page.screenshot({ path: file });
    await page.evaluate(() => { const d = document.querySelector('#dev'); if (d && d.dataset.prevHidden === '0') d.hidden = false; }).catch(() => {});
    shots.push(file);
  };

  // 必须带 ?dev=1：只有 dev=1 时 main.js 才暴露 window.__play，冒烟脚本才读得到 stage/act/options。
  // 给人看的截图在 shot() 里临时把调试叠层藏掉，所以图上还是干净的。
  const res = await page.goto(`${BASE}/play.html?dev=1`, { waitUntil: 'load' });
  if (!res || res.status() !== 200) errors.push(`play.html 没打开：HTTP ${res ? res.status() : '无响应'}`);
  await sleep(700);
  await tap(page, `#pick-${dir}`);
  await sleep(500);
  if (!(await visible(page, '#film'))) throw new Error('开场没有出现电影段');
  await tap(page, '#enter-film');
  await sleep(2400);
  await shot('film');

  let lastAct = null;
  let ticks = 0;
  let codaDone = false;
  let gizmoTried = false;
  while (ticks < MAXTICKS) {
    ticks += 1;
    if (page.isClosed()) { errors.push('页面没了'); break; }
    if (await visible(page, '#fatal')) {
      const detail = await page.textContent('#fatal-detail').catch(() => '');
      errors.push(`fatal: ${detail}`);
      break;
    }
    let st;
    try {
      st = await page.evaluate(() => ({
        stage: window.__play?.view?.stage ?? null,
        act: window.__play?.view?.act ?? null,
        phase: window.__play?.view?.granary?.phase ?? null,
        done: !!window.__play?.view?.done,
        night: window.__play?.view?.flags?.night ?? null,
        anchors: window.__play?.stage?.anchors ?? [],
        options: (window.__play?.view?.options ?? []).map((o) => `${o.id}:${o.allowed ? 1 : 0}`),
      }));
    } catch (e) {
      errors.push(`读不到页面状态：${e.message}`);
      break;
    }
    if (DEBUG) console.error('tick', ticks, JSON.stringify(st), page.isClosed() ? 'CLOSED' : '');

    if (st.act && st.act !== lastAct) {
      lastAct = st.act;
      acts.push(st.act);
      if (st.act === 'ye') {
        // 邺城的案上有没有兵符，必须和取符之夜的结果一致（否则画面和正文打架）
        ye = { night: st.night, hasTally: (st.anchors ?? []).includes('prop:tally'), hasOrder: (st.anchors ?? []).includes('prop:order') };
        if (st.night === 'clean' && !ye.hasTally) errors.push('夜里把兵符带出宫了，邺城案上却没有兵符');
        if (st.night !== 'clean' && (ye.hasTally || !ye.hasOrder)) errors.push(`夜里没带出兵符（night=${st.night}），邺城案上不该有兵符`);
      }
      await sleep(2000);
      await shot(st.act);
    }

    if (await visible(page, '#advance')) {
      await tap(page, '#advance');
      await sleep(240);
      continue;
    }
    if (await visible(page, '#ending')) {
      await sleep(2600);
      await shot(codaDone ? 'final' : 'coda');
      if (!codaDone && granary) {
        codaDone = true;
        if (await tapText(page, '再去粮仓')) { await sleep(2400); continue; }
      }
      if (await tapText(page, '就此收束')) { await sleep(2000); continue; }
      // 收束页上点一次「把这一局拍成电影」：要写出录制、并跳到 /film.html
      if (codaDone && !filmTried) {
        filmTried = true;
        // 真正的收束页（一案竹简 + 封泥 + 卷轴）——桌面一版、手机一版
        await sleep(3600);
        await shot('epilogue');
        await page.setViewportSize({ width: 390, height: 844 });
        await sleep(1000);
        await shot('epilogue-mobile');
        await page.setViewportSize({ width: 1292, height: 761 });
        await sleep(400);
        const hit = await page.evaluate(() => {
          const b = document.getElementById('film-btn');
          if (!b) return false;
          b.click();
          return true;
        }).catch(() => false);
        if (!hit) errors.push('收束页没有「把这一局拍成电影」入口');
        else {
          await sleep(3000);
          const film = await page.evaluate(() => ({
            path: location.pathname,
            stored: (() => { try { const v = localStorage.getItem('dw.lastFilm'); return v ? v.length : 0; } catch { return -1; } })(),
            drawn: !!document.querySelector('canvas'),
          })).catch(() => null);
          if (!film || film.path !== '/film.html') errors.push(`电影页没跳过去：${film ? film.path : '读不到'}`);
          else {
            filmShot = true;
            await shot('film-page');
            if (!film.stored) errors.push('没写出 dw.lastFilm 录制');
          }
        }
        continue;
      }
      if (await tapText(page, '再做一次')) break;
      break;
    }
    if (await visible(page, '#mind')) { await tap(page, '#mind-close'); await sleep(200); continue; }

    // 第一幕顺手试一次「看」这个小机关
    if (!gizmoTried && st.act === 'daliang') {
      gizmoTried = true;
      await openPeople(page);
      const hit = await page.evaluate(() => {
        const n = document.querySelector('.gizmos .gizmo[data-role="watch"]');
        if (!n) return false;
        n.click();
        return true;
      });
      if (hit) {
        await sleep(900);
        if (await visible(page, '#mind')) { await shot('mind'); await tap(page, '#mind-close'); await sleep(400); }
        else errors.push('点了「看」却没开出心思');
      } else errors.push('没找到「看」的小机关');
    }

    const where = `${st.stage}:${st.act}:${st.phase ?? '-'}`;
    if (where !== lastWhere) { lastWhere = where; used.clear(); }
    const plan = st.stage === 'granary' ? (PLAN[st.phase] ?? PLAN.decide) : (PLAN[st.act] ?? []);
    // 先按计划走；计划里的招在这幕使不出来时，挑第一个允许的（引擎会因为夜里的动静改戏）
    const info = await page.evaluate(() => {
      const v = window.__play?.view ?? {};
      return {
        allowed: (v.options ?? []).filter((o) => o.allowed).map((o) => o.id),
        keepers: (v.granary?.keepers ?? []).map((k) => k.id),
        current: v.granary?.keeper ?? null,
      };
    }).catch(() => ({ allowed: [], keepers: [], current: null }));
    const allowed = info.allowed;
    const all = [...plan, ...allowed.filter((a) => !plan.includes(a))];
    // 同一幕里试过的招不再重复试（粮仓要看满两件东西才能找导演批）
    const ids = all.filter((id) => !used.has(id));
    const tryIds = ids.length ? ids : all;
    let picked = null;
    // 有些诉求签挂在人物身上（如姬身上的「摸符」），先把该摊开的签摊开，计划里的招才点得到
    await openPeople(page, [], info.keepers, info.current);
    for (const id of tryIds) { if (await tapTag(page, id)) { picked = id; break; } }
    if (!picked) {
      await openPeople(page, [], info.keepers, info.current);
      for (const id of tryIds) { if (await tapTag(page, id)) { picked = id; break; } }
    }
    if (picked) used.add(picked);
    trace.push(`${ticks} ${st.stage}/${st.act ?? '-'}/${st.phase ?? '-'}${st.done ? ' done' : ''} → ${picked ?? '∅'} [${st.options.join(' ')}]`);
    if (!picked && !st.done) {
      const dump = await page.evaluate(() => [...document.querySelectorAll('#tags .tag')].map((n) => {
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        return `${n.dataset.intent || n.dataset.key}:${n.dataset.disabled === '1' ? 'X' : 'o'}:${cs.visibility}/${cs.display}/${cs.opacity}:${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      })).catch(() => []);
      trace.push(`   dump ${JSON.stringify(dump)}`);
      await sleep(400);
    }
    // 取符之夜有漏刻在走（真·时间压力）：夜里出手快一点，不然脚本会被时间推着走
    await sleep(st.act === 'night' ? 280 : 760);
  }
  if (ticks >= MAXTICKS) errors.push('一整局没走完（步数用尽）');
  await page.close().catch(() => {});
  await ctx.close().catch(() => {});
  return { dir, acts, ye, shots, errors, trace };
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const runs = [];
  for (const dir of DIRS) {
    // 一局一开浏览器：headless shell 连跑两局会在中间自己倒下（Target ... has been closed）
    const browser = await chromium.launch({ executablePath: EXE, headless: !HEAD });
    try {
      runs.push(await playRun(browser, dir, { granary: dir === DIRS[0] }));
    } finally {
      await browser.close().catch(() => {});
    }
  }
  if (DEBUG) for (const r of runs) for (const line of r.trace) console.error('trace', r.dir, line);
  const bad = runs.filter((r) => r.errors.length);
  const trim = (list) => [...new Set(list.map((e) => String(e).split('\n')[0]))].slice(0, 8);
  console.log(JSON.stringify({
    ok: bad.length === 0,
    runs: runs.map((r) => ({ dir: r.dir, acts: r.acts, ye: r.ye, shots: r.shots, errorCount: r.errors.length, errors: trim(r.errors) })),
  }, null, 1));
  if (bad.length) process.exit(1);
}

main().catch((e) => {
  console.error('smoke 自己挂了:', e.message);
  process.exit(1);
});
