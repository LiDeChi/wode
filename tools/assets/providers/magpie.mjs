// 图片：本机 Magpie 网关（默认 http://localhost:3425），OpenAI 兼容的两条接口。
//
//   /v1/images/generations  从零画（底版 plate 走这条）
//   /v1/images/edits        带一张参考图重画（背景/人像把同一部戏的 plate 递进去，
//                           保证同一个导演、同一部作品画风是一套）
//
// available() 只探测、不生成：读 /v1/models 的注册表，看网关活着没有、配置的图片模型在不在表里。
// 本机这台 Magpie 只有对话模型，所以它会如实说「不可用」，让 run.mjs 走 litellm 那条备用通道。

import fs from 'node:fs';
import path from 'node:path';
import { fetchWithTimeout, saveB64, downloadTo, scrub } from './util.mjs';

export const name = 'magpie';
export const kinds = ['image'];
export const ext = 'png';

const URL_BASE = () => (process.env.MAGPIE_URL || 'http://localhost:3425').replace(/\/+$/, '');
const MODEL = () => process.env.MAGPIE_IMAGE_MODEL || 'gpt-image-2';
const TIMEOUT = Number(process.env.MAGPIE_TIMEOUT_MS || 180000);
const IMAGEISH = /image|dall-?e|flux|seedream|imagen|banana|sd-|stable-diffusion/i;

/** 只要网关活着就认（跳过模型名检查，给那些不在 /v1/models 里列图片模型的网关用） */
function forceOk() {
  return process.env.MAGPIE_SKIP_MODEL_CHECK === '1';
}

export async function available() {
  const base = URL_BASE();
  const want = MODEL();
  try {
    const r = await fetchWithTimeout(`${base}/v1/models`, {}, 4000);
    const json = await r.json();
    const ids = Array.isArray(json && json.data) ? json.data.map((m) => m && m.id).filter((x) => typeof x === 'string') : [];
    const imageModels = ids.filter((i) => IMAGEISH.test(i));
    const listed = ids.includes(want);
    const ok = forceOk() || listed || imageModels.length > 0;
    const model = listed ? want : imageModels[0] || want;
    return {
      ok,
      name,
      url: base,
      model,
      listed,
      imageModels,
      note: ok
        ? listed
          ? `网关活着，表里有 ${want}`
          : `网关活着，表里没有 ${want}，改用 ${imageModels[0]}`
        : `网关活着但表里没有图片模型（共 ${ids.length} 个，都是对话模型）；要用它得先给 Magpie 配一个，或设 MAGPIE_SKIP_MODEL_CHECK=1 强制试`,
    };
  } catch (err) {
    return { ok: false, name, url: base, model: want, listed: false, imageModels: [], note: `网关没应答：${scrub(err.message)}` };
  }
}

/** 把图片响应落盘：b64_json 直接写，url 下载 */
async function saveFromResponse(json, outPath, auth) {
  const item = (json && json.data && json.data[0]) || json || {};
  if (typeof item.b64_json === 'string' && item.b64_json) return saveB64(item.b64_json, outPath);
  const url = typeof item.url === 'string' ? item.url : null;
  if (!url) throw new Error(`返回里既没有 b64_json 也没有 url：${scrub(JSON.stringify(json)).slice(0, 200)}`);
  return downloadTo(url, outPath, { auth });
}

function authHeaders() {
  const key = process.env.MAGPIE_KEY || process.env.MAGPIE_API_KEY || '';
  return key ? { authorization: `Bearer ${key}` } : {};
}

/**
 * 生成一张图。brief.spec 里 role:'plate' 时就是从零画；
 * 其余图带 spec.plate（底版 key），ctx.platePath 是那张底版已经生成好的本地文件。
 */
export async function make(brief, outPath, ctx = {}) {
  const spec = (brief && brief.spec) || {};
  const base = URL_BASE();
  const model = MODEL();
  const headers = authHeaders();
  const platePath = ctx.platePath && fs.existsSync(ctx.platePath) ? ctx.platePath : null;

  if (platePath) {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', spec.prompt || '');
    fd.append('size', spec.size || '1536x1024');
    const bytes = fs.readFileSync(platePath);
    fd.append('image', new Blob([bytes], { type: 'image/png' }), path.basename(platePath));
    const r = await fetchWithTimeout(`${base}/v1/images/edits`, { method: 'POST', headers, body: fd }, TIMEOUT);
    const json = await r.json();
    const bytes2 = await saveFromResponse(json, outPath, headers);
    return { model: `${model}（带底版 ${path.basename(platePath)}）`, fallback: false, provider: name, bytes: bytes2 };
  }

  // 有的网关不接受 response_format：先带、被拒就摘掉重来一次（契约：不重试超过一次）
  const attempts = [
    { response_format: 'b64_json' },
    {},
  ];
  let lastErr = null;
  for (const extra of attempts) {
    try {
      const r = await fetchWithTimeout(`${base}/v1/images/generations`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: spec.prompt || '', n: 1, size: spec.size || '1536x1024', ...extra }),
      }, TIMEOUT);
      const json = await r.json();
      const bytes = await saveFromResponse(json, outPath, headers);
      return { model, fallback: false, provider: name, bytes };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('生成失败');
}
