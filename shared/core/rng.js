// 种子随机：同一个种子永远长出同一个世界。shared/ 里不许用 Math.random。
import { hashHex } from './ledger.js';

export function makeRng(seed) {
  let a = parseInt(hashHex(String(seed)).slice(0, 8), 16) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
