// 图片备用通道：本机 LiteLLM（默认 http://127.0.0.1:41401）。
//
// 这条路和 Magpie 一样是 OpenAI 兼容的 /v1/images/generations，但有两处不一样，踩过：
//   1) 只能传 resolution（"1k"/"2k"…），传 size 直接报错；
//   2) 一张要 30–90 秒，返回的是外链 url，要再下载一次。
//
// 密钥从 .env 文件里读（LITELLM_MASTER_KEY）。读文件、只回报「有没有」，不打印、不提交。
// run.mjs 的选择顺序是：Magpie 能用就用 Magpie，不能用才来这里。

import os from 'node:os';
import path from 'node:path';
import { fetchWithTimeout, readKey, saveB64, downloadTo, scrub } from './util.mjs';

export const name = 'litellm';
export const kinds = ['image'];
export const ext = 'png';

const URL_BASE = () => (process.env.LITELLM_URL || 'http://127.0.0.1:41401').replace(/\/+$/, '');
const MODEL = () => process.env.LITELLM_IMAGE_MODEL || 'apimart-gpt-image-2';
const RESOLUTION = () => process.env.LITELLM_IMAGE_RESOLUTION || '1k';
const TIMEOUT = Number(process.env.LITELLM_TIMEOUT_MS || 180000);
const ENV_FILE = () =>
  process.env.LITELLM_ENV_FILE || path.join(os.homedir(), '.local', 'share', 'litellm-sub2api-native', '.env');
const KEY_NAMES = ['LITELLM_MASTER_KEY', 'LITELLM_API_KEY', 'LITELLM_KEY'];

function key() {
  return readKey(KEY_NAMES, ENV_FILE());
}

function hasKey() {
  return key() !== '';
}

export async function available() {
  const base = URL_BASE();
  const want = MODEL();
  if (!hasKey()) {
    return { ok: false, name, url: base, model: want, keyPresent: false, note: `没有密钥（读过 ${ENV_FILE()}）` };
  }
  try {
    const r = await fetchWithTimeout(`${base}/v1/models`, { headers: { authorization: `Bearer ${key()}` } }, 5000);
    const json = await r.json();
    const ids = Array.isArray(json && json.data) ? json.data.map((m) => m && m.id).filter((x) => typeof x === 'string') : [];
    const listed = ids.includes(want);
    return {
      ok: listed,
      name,
      url: base,
      model: want,
      listed,
      keyPresent: true,
      note: listed ? `网关活着，表里有 ${want}（resolution ${RESOLUTION()}，一张 30–90 秒）` : `网关活着，但表里没有 ${want}（共 ${ids.length} 个模型）`,
    };
  } catch (err) {
    return { ok: false, name, url: base, model: want, keyPresent: true, note: `网关没应答：${scrub(err.message)}` };
  }
}

/**
 * 生成一张图。注意：这里不传 size（传了会报错），只传 resolution；
 * 返回多是外链，先不带认证下载，401/403 再带上。
 */
export async function make(brief, outPath) {
  const spec = (brief && brief.spec) || {};
  const base = URL_BASE();
  const model = MODEL();
  const auth = { authorization: `Bearer ${key()}` };
  const body = {
    model,
    prompt: spec.prompt || '',
    n: 1,
    resolution: RESOLUTION(),
    ...(process.env.LITELLM_EXTRA_JSON ? JSON.parse(process.env.LITELLM_EXTRA_JSON) : {}),
  };
  const r = await fetchWithTimeout(`${base}/v1/images/generations`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, TIMEOUT);
  const json = await r.json();
  const item = (json && json.data && json.data[0]) || json || {};
  let bytes;
  if (typeof item.b64_json === 'string' && item.b64_json) bytes = saveB64(item.b64_json, outPath);
  else if (typeof item.url === 'string' && item.url) bytes = await downloadTo(item.url, outPath, { auth, ms: 90000 });
  else throw new Error(`返回里既没有 b64_json 也没有 url：${scrub(JSON.stringify(json)).slice(0, 200)}`);
  return { model: `${model}（resolution ${RESOLUTION()}）`, fallback: false, provider: name, bytes };
}
