// Re-collect the eight named canvas states with the app's own QA surface.
//
// Why this file exists: artifacts/final-evidence.md used to say "重新采集：…运行
// threejs-qa-release/scripts/inspect-threejs-canvas.mjs". That tool is not installed on this
// machine, so the table in that report could not be re-collected by anyone reading the repo - it
// had become a number nobody could check. This script reproduces the part of that report that is
// actually a scene property (draw calls, triangles, geometries, textures, a non-blank canvas, and
// zero console/page errors) using only what is in this repository: the `?qa=1` test hooks that
// main.ts already exposes, plus Playwright and pngjs, both already devDependencies.
//
// What it deliberately does NOT reproduce: the older report's image-quality metrics (colour
// entropy, edge density, luminance percentiles, dominant-colour share) and its GPU string come
// from that tool's own analysis. Rather than invent a different algorithm and print numbers that
// look comparable but are not, this script records the raw pixel statistics it can stand behind
// (luminance range, colour bucket count) and leaves the quality metrics to the older run, where
// the report says so.
//
// Run against a server already listening (the same precondition as scripts/capture.mjs):
//   npm start            # or: npm run dev
//   node scripts/canvas-states.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

const ORIGIN = process.env.CANVAS_ORIGIN ?? 'http://127.0.0.1:4318';
const RUN_ID = process.env.CANVAS_RUN_ID ?? 'recapture-1';
const SEED = 42;

// The same two viewports the browser acceptance suite uses, so a state is measured at the size a
// person actually meets it. Budget rows are per tier, matching the limits the older report used.
const MODES = {
  desktop: { viewport: { width: 1360, height: 940 }, deviceScaleFactor: 1, budget: { calls: 300, triangles: 750_000, geometries: 300, textures: 60 } },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, budget: { calls: 150, triangles: 300_000, geometries: 200, textures: 40 } }
};

// The eight states the evidence table names. `state` is a hook name; `slug` names the files.
const STATES = [
  ['desktop', 'home'], ['mobile', 'home'],
  ['desktop', 'granary'], ['mobile', 'granary'],
  ['desktop', 'active-play'], ['mobile', 'active-play'],
  ['mobile', 'pause'], ['desktop', 'fail-or-retry']
];

// A canvas that is genuinely blank has no luminance range and almost no colour variety; a drawn
// theatre has plenty of both. These are deliberately loose - the exact figures are recorded
// alongside, so a reader can judge them rather than trust a threshold.
const BLANK_RANGE = 8, BLANK_BUCKETS = 4;

const dir = `artifacts/captures/${RUN_ID}`;
await mkdir(dir, { recursive: true });
// Ask for the real GPU. Plain headless Chromium on macOS silently falls back to the SwiftShader
// software rasteriser - measured on this machine, the default launch reports "SwiftShader
// Device" and softwareRendered:true, while these flags report "ANGLE Metal Renderer: Apple M4",
// which is the renderer the evidence report claims. A canvas check that quietly swapped hardware
// for software would not be describing the machine it says it describes.
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const captures = [];

for (const [mode, state] of STATES) {
  const { viewport, deviceScaleFactor, budget } = MODES[mode];
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await context.newPage();
  const consoleErrors = [], pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto(`${ORIGIN}/?qa=1`);
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  // Seed first: the hooks refuse any world but the seeded one, which keeps these captures
  // comparable with each other and with the rest of the acceptance evidence.
  await page.evaluate(async seed => { await window.__THREE_GAME_TEST_HOOKS__.seed(seed); }, SEED);
  await page.evaluate(async name => { await window.__THREE_GAME_TEST_HOOKS__.setState(name); }, state);
  // Let the renderer draw the new state before anything is read from it.
  await page.waitForFunction(() => (window.__DIGITAL_WORLD__.getDiagnostics()?.calls ?? 0) > 0);
  await page.waitForTimeout(400);

  const diagnostics = await page.evaluate(() => window.__DIGITAL_WORLD__.getDiagnostics());
  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, drawingBuffer: { width: canvas.width, height: canvas.height } };
  });
  const gpu = await page.evaluate(() => {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      softwareRendered: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '').toLowerCase().includes('swiftshader')
    };
  });

  // Pixel statistics from a real screenshot of the canvas, sampled every 4th pixel, the same way
  // scripts/capture.mjs reads them.
  const shot = await page.locator('canvas').screenshot();
  const image = PNG.sync.read(shot);
  let min = 255, max = 0; const buckets = new Set();
  for (let i = 0; i < image.data.length; i += 16) {
    const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    min = Math.min(min, lum); max = Math.max(max, lum);
    buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }
  const range = Math.round(max - min);

  const slug = `${mode}-${state === 'active-play' ? 'active' : state === 'fail-or-retry' ? 'failure' : state}`;
  await page.screenshot({ path: `${dir}/${slug}.png` });
  await writeFile(`${dir}/${slug}-canvas.png`, shot);

  const rows = ['calls', 'triangles', 'geometries', 'textures'].map(metric => ({ metric, actual: diagnostics?.[metric] ?? 0, limit: budget[metric], ok: (diagnostics?.[metric] ?? 0) <= budget[metric] }));
  captures.push({
    mode, state, slug,
    // The state is confirmed by the measurements themselves rather than by a read-back: a hook
    // that silently failed to change the scene would leave every row showing the home scene's
    // counts (21 calls / 2688 triangles), and the summary below would show one distinct signature
    // instead of several. There is no getter for the current hook state, so nothing is recorded
    // here that pretends to be one.
    requestedState: state,
    url: `${ORIGIN}/?qa=1`, runId: RUN_ID, seed: SEED,
    screenshotPath: `${dir}/${slug}.png`,
    diagnostics, gpu, geometry,
    pixels: { luminanceRange: range, colourBuckets: buckets.size, blank: range < BLANK_RANGE || buckets.size < BLANK_BUCKETS },
    renderBudget: { tier: mode, rows, withinBudget: rows.every(r => r.ok) },
    consoleErrors, pageErrors, consoleErrorCount: consoleErrors.length, pageErrorCount: pageErrors.length
  });
  await writeFile(`${dir}/${slug}.json`, JSON.stringify(captures[captures.length - 1], null, 2));
  console.log(`${slug.padEnd(18)} calls=${String(diagnostics?.calls).padStart(4)} tris=${String(diagnostics?.triangles).padStart(6)} geom=${String(diagnostics?.geometries).padStart(3)} tex=${String(diagnostics?.textures).padStart(3)}  pixels range=${String(range).padStart(3)} buckets=${String(buckets.size).padStart(3)}  budget=${rows.every(r => r.ok) ? 'ok' : 'OVER'}  errors=${pageErrors.length + consoleErrors.length}`);
  await context.close();
}

await browser.close();
// This script owns its own summary file and deliberately does not touch artifacts/evidence.json,
// which belongs to the capture + motion pipeline that check_evidence.py validates.
await writeFile('artifacts/canvas-states.json', JSON.stringify({ runId: RUN_ID, seed: SEED, captures }, null, 2));
const blank = captures.filter(c => c.pixels.blank).map(c => c.slug);
const over = captures.filter(c => !c.renderBudget.withinBudget).map(c => c.slug);
const errored = captures.filter(c => c.pageErrorCount + c.consoleErrorCount > 0).map(c => c.slug);
// A setState that silently did nothing would leave every state showing the same scene, so the
// number of distinct signatures is the cheapest proof that the eight captures are eight scenes.
const signatures = new Set(captures.map(c => `${c.diagnostics?.calls}/${c.diagnostics?.triangles}`));
console.log(`\n${captures.length} states captured into ${dir}`);
console.log(`  distinct scene signatures: ${signatures.size} (${[...signatures].sort().join(', ')})`);
console.log(`  blank canvas: ${blank.length ? blank.join(', ') : 'none'}`);
console.log(`  over budget:  ${over.length ? over.join(', ') : 'none'}`);
console.log(`  page/console errors: ${errored.length ? errored.join(', ') : 'none'}`);
