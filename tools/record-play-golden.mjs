// 用当前的 createPlay 录一份对照结果：node tools/record-play-golden.mjs
// 只在“行为本来就该变”的时候重录，并在提交说明里写清楚为什么变。
import { writeFileSync } from 'node:fs';
import { createSession } from '../shared/engine/session.js';
import { createPlay } from '../shared/engine/play.js';
import { scripts, runScript } from '../tests/fixtures/play-scripts.mjs';

const golden = {};
for (const sc of scripts()) golden[sc.id] = runScript({ createSession, createPlay }, sc);
writeFileSync(new URL('../tests/fixtures/play-golden.json', import.meta.url), JSON.stringify(golden, null, 1) + '\n');
const endings = {};
for (const g of Object.values(golden)) endings[g.ending] = (endings[g.ending] || 0) + 1;
console.log(Object.keys(golden).length, 'scripts', endings);
