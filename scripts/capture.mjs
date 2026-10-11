import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

await mkdir('artifacts/captures', { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
for (const [name, size] of [['desktop', {width:1360,height:940}], ['mobile', {width:390,height:844}]]) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4318/?qa=1');
  await page.getByRole('heading', {name:'窃符',exact:true}).waitFor();
  await page.screenshot({path:`artifacts/captures/${name}-home.png`,fullPage:true});
  await page.getByRole('button', {name:/围城.*短游戏/}).click();
  await page.getByRole('button', {name:/请他打开家库/}).click();
  await page.getByRole('button', {name:'递出印信'}).waitFor();
  await page.screenshot({path:`artifacts/captures/${name}-granary.png`});
  const buffer = await page.locator('canvas').screenshot();
  const image = PNG.sync.read(buffer); let min=255,max=0;const buckets=new Set();
  for (let i=0;i<image.data.length;i+=16) {const r=image.data[i],g=image.data[i+1],b=image.data[i+2];const lum=.2126*r+.7152*g+.0722*b;min=Math.min(min,lum);max=Math.max(max,lum);buckets.add(`${r>>4},${g>>4},${b>>4}`);}
  const diagnostics = await page.evaluate(()=>window.__DIGITAL_WORLD__.getDiagnostics());
  results.push({mode:name,state:'granary',pixels:{range:max-min,buckets:buckets.size},diagnostics,errors,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  await context.close();
}
await browser.close();
await writeFile('artifacts/canvas-results.json',JSON.stringify({runId:'acceptance-1',results},null,2));
console.log(JSON.stringify(results,null,2));
