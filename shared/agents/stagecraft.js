// 导演的眼光：同一场戏，陆导和单导开出来的资产单不一样（docs/ASSETS.md §2、§3）。
//
// 这里只有规则、没有模型：纯函数、确定性——不读时钟、不随机、不做 IO、不 import node 模块，
// 浏览器和 node 跑出同一张单。画什么、配什么声音，全由导演的手艺（craft）和性情决定。
// 文件顶部那几张表就是「口味」，可调；调完 key 跟着变，下次生成的就是新东西（手艺长在资产里）。

import { hashHex } from '../core/ledger.js';

const round = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const num = (v, d = 0.5) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);

/* ===================== 口味表（§2 的映射，可调） ===================== */

/** 风格：雕琢压过放开 → 水墨；放开压过雕琢 → 水粉。score = 雕琢 − 放开 */
export const STYLE_TABLE = [
  { gte: 0.15, style: '水墨、留白、低饱和', palette: '灰青、墨赭、冷调', framing: '静止对称、远景留白' },
  { gte: -0.15, style: '兼工带写、淡彩、层次清楚', palette: '土黄与暗绿，半明半暗', framing: '中景平视、三分法' },
  { gte: -1, style: '粗笔水粉、暖色块面、构图有动势', palette: '米白、赭石、暖调', framing: '手持斜角、贴近人物、前后景交错' },
];

/** 光：悲剧高 → 黄昏冷光；低 → 白天暖光 */
export const LIGHT_TABLE = [
  { gte: 0.65, light: '黄昏侧光、冷' },
  { gte: 0.4, light: '阴天薄光、平' },
  { gte: -1, light: '白天顶光、暖' },
];

/** 情绪：悲剧高 → 苍凉 */
export const MOOD_TABLE = [
  { gte: 0.65, mood: '苍凉、克制' },
  { gte: 0.4, mood: '萧瑟里留一点亮' },
  { gte: -1, mood: '明亮、有推进感' },
];

/** 场景里的情绪词 → 音乐情绪（先按出现次数，次数相同按这张表的顺序） */
export const EMOTION_WORDS = [
  ['猜忌', '紧绷'], ['两难', '徘徊'], ['义', '端正'], ['惧', '发紧'], ['恩', '温'],
  ['困', '困兽'], ['暮色', '薄暮'], ['围城', '围困'], ['不肯', '僵持'], ['急', '催促'],
];

/** 音效：八个控制器各一声（§3） */
export const SFX_TABLE = {
  speech: { prompt: '压低的说话声，短促，背景安静', seconds: 2 },
  handover: { prompt: '竹简与木案推过的摩擦声', seconds: 1.5 },
  space: { prompt: '脚步走过夯土走廊，回声短', seconds: 2 },
  clock: { prompt: '更鼓一响，远处梆子', seconds: 3 },
  attention: { prompt: '衣料摩擦，一个人转头', seconds: 1 },
  standing: { prompt: '殿上众人压低呼吸，一声轻咳', seconds: 2 },
  evidence: { prompt: '竹简展开，纸页翻动', seconds: 1.5 },
  lens: { prompt: '安静的呼吸声，几乎没有动作', seconds: 2 },
};

/** 音色档：老/中/少 × 男/女（§3 的 voiceOf）。say 是 macOS 的候选音色，t8 的替身用它。 */
export const VOICE_TABLE = {
  '老男': { id: 'zh-old-male', say: 'Sinji' },
  '老女': { id: 'zh-old-female', say: 'Ting-Ting' },
  '中男': { id: 'zh-mid-male', say: 'Sinji' },
  '中女': { id: 'zh-mid-female', say: 'Ting-Ting' },
  '少男': { id: 'zh-young-male', say: 'Sinji' },
  '少女': { id: 'zh-young-female', say: 'Ting-Ting' },
};

const NO_TEXT = '画面里不加文字、不加水印。';

/* ===================== 稳定序列化与 key ===================== */

/** 键排序的稳定序列化：同一份 spec 无论键的书写顺序如何，都是同一个字符串 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/** key 只由 spec 算：对 spec 做稳定序列化后取 hash，前缀 kind（spec.kind） */
export function assetKey(spec) {
  const kind = (spec && spec.kind) || 'asset';
  return `${kind}-${hashHex(stableStringify(spec))}`;
}

/* ===================== 音色 ===================== */

/** 从人物信息选一个音色档：title/bio/name 里的字眼决定老中少与男女 */
export function voiceOf(person) {
  const p = person || {};
  const blob = `${p.name || ''}${p.title || ''}${p.bio || ''}`;
  let tier = '中';
  if (/老|监者|叟|翁/.test(blob)) tier = '老';
  else if (/少|幼|之子/.test(blob)) tier = '少';
  let gender = '男';
  if (/姬|女|妇|母|后/.test(blob)) gender = '女';
  if (!p.id && !p.name) return { tier: '中', gender: '男', ...VOICE_TABLE['中男'], why: '人物信息为空，取中间档' };
  // 名字里没有任何线索时，用 id 的稳定 hash 决定（还是确定性的）
  if (!/老|监者|叟|翁|少|幼|之子|姬|女|妇|母|后/.test(blob)) {
    const h = hashHex(String(p.id || p.name));
    tier = ['老', '中', '少'][parseInt(h[0], 16) % 3];
    gender = parseInt(h[1], 16) % 2 ? '女' : '男';
  }
  const key = tier + gender;
  return { tier, gender, ...VOICE_TABLE[key], why: `${p.name || p.id}：从「${p.title || ''}」定到${tier}${gender}` };
}

/* ===================== 口味 ===================== */

function pick(rows, score) {
  for (const r of rows) if (score >= r.gte) return r;
  return rows[rows.length - 1];
}

/** 只读 director.craft() 与 director.def.temperament，返回一份确定的口味 */
export function taste(director) {
  const craft = director.craft();
  const t = (director.def && director.def.temperament) || {};
  const polish = clamp(num(craft.lockBias));
  const freedom = clamp(num(craft.freedomBias));
  const tragedy = clamp(num(craft.tragedyBias));
  const pace = clamp(num(t.节奏, 0.5) + num(craft.paceBias, 0));
  const st = pick(STYLE_TABLE, polish - freedom);
  const li = pick(LIGHT_TABLE, tragedy);
  const mo = pick(MOOD_TABLE, tragedy);
  const stills = polish >= 0.6 ? 'every-beat' : 'key-beats';
  return {
    director: director.id,
    craft: { 雕琢: polish, 放开: freedom, 悲剧: tragedy, 节奏: pace },
    look: { style: st.style, palette: st.palette, light: li.light, framing: st.framing },
    sound: { intensity: round(clamp(0.2 + 0.6 * freedom + 0.2 * pace)), density: round(clamp(0.15 + 0.7 * freedom)) },
    music: { bpm: Math.round(60 + 60 * pace), loopSeconds: round(24 + 24 * polish), mood: mo.mood },
    voice: { rate: round(clamp(1 - 0.3 * polish + 0.3 * pace, 0.85, 1.15)), pause: round(clamp(0.2 + 0.6 * polish, 0.2, 0.9)) },
    stills,
  };
}

const lookText = (t) => `${t.look.style}；${t.look.palette}；${t.look.light}；${t.look.framing}。`;
const say = (t) => `雕琢 ${t.craft.雕琢}、放开 ${t.craft.放开}、悲剧 ${t.craft.悲剧}、节奏 ${t.craft.节奏}`;

/* ===================== 开单 ===================== */

function index(list) {
  const out = {};
  for (const it of list || []) if (it && it.id) out[it.id] = it;
  return out;
}

/** 事实片段去掉句尾标点，拼进 prompt 时不会出现「。。」 */
const clean = (s) => String(s || '').replace(/[。；;、\s]+$/, '');

/** 场景的 place 可能是种子里的 id，也可能是显示名；两种都认 */
function placeOf(scene, places) {
  const want = scene.place;
  if (!want) return null;
  if (places[want]) return places[want];
  for (const p of Object.values(places)) {
    if (p.name === want || (p.name && (p.name.includes(want) || want.includes(p.name)))) return p;
  }
  return { id: want, name: want, desc: '' };
}

function textsOf(scene) {
  const out = [];
  for (const r of scene.rules || []) {
    if (typeof r.text === 'string') out.push(r.text);
    else if (r.text && typeof r.text === 'object') for (const v of Object.values(r.text)) if (typeof v === 'string') out.push(v);
  }
  return out;
}

/** 关键拍：首拍、finish:'on-end'、或规则里带 end 效果的那一拍 */
function isKeyBeat(scene, i) {
  if (i === 0) return true;
  if (scene.finish === 'on-end') return true;
  return (scene.rules || []).some((r) => (r.then || []).some((x) => (Array.isArray(x) ? x[0] === 'end' : x && x.effect && x.effect[0] === 'end')));
}

function moodOf(scene, fallback) {
  const blob = [scene.goal || '', scene.scene || '', ...textsOf(scene)].join(' ');
  let best = null;
  for (const [word, mood] of EMOTION_WORDS) {
    let n = 0;
    for (let i = blob.indexOf(word); i >= 0; i = blob.indexOf(word, i + word.length)) n += 1;
    if (n > 0 && (!best || n > best.n)) best = { word, mood, n };
  }
  return best ? `${best.mood}（场景里「${best.word}」出现了 ${best.n} 次）` : `${fallback}（场景里没有明显的情绪词）`;
}

function quoted(text) {
  const out = [];
  const re = /「([^」]+)」/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

/**
 * 开一张资产单。world = { work, scenes, places, people, items }。
 * 返回 { director, work, taste, plate, counts, assets }，assets 是 Brief[]。
 */
export function dress(director, world = {}) {
  const t = taste(director);
  const work = world.work || (director.def && director.def.name) || 'work';
  const scenes = world.scenes || {};
  const ids = Object.keys(scenes).filter((k) => scenes[k]);
  const places = index(world.places);
  const people = index(world.people);
  const assets = [];
  const seen = new Set();

  function add(kind, spec, forWhom, why) {
    const key = assetKey(spec);
    if (seen.has(key)) return null;
    seen.add(key);
    const brief = { key, kind, for: { work, ...forWhom }, spec, why };
    assets.push(brief);
    return brief;
  }

  // 1) 风格底版：每部作品每位导演一张，最先生成
  const workLine = `${work}：${ids.map((k) => scenes[k].title || k).join('、')}。`;
  const plateSpec = { kind: 'image', prompt: `${workLine}${lookText(t)}${NO_TEXT}`, size: '1536x1024', role: 'plate' };
  const plate = add('image', plateSpec, {}, `${say(t)}：先定这一部戏的底版（${t.look.style}）`);

  // 2) 背景：每个 scene 的 place，按 stills 决定全部还是只关键拍
  ids.forEach((id, i) => {
    const scene = scenes[id];
    if (t.stills !== 'every-beat' && !isKeyBeat(scene, i)) return;
    const place = placeOf(scene, places);
    const fact = [place && place.name, clean(place && place.desc)].filter(Boolean).join('：');
    const prompt = `${fact}。${clean(scene.scene)}${clean(scene.goal)}${lookText(t)}${NO_TEXT}`;
    add('image', { kind: 'image', prompt, size: '1536x1024', plate: plate.key }, { beat: id, place: scene.place }, t.stills === 'every-beat' ? `雕琢 ${t.craft.雕琢}：每一拍都要一张背景` : `雕琢 ${t.craft.雕琢}：只给关键拍，这一拍是关键`);
  });

  // 3) 人像：每个 scene 的 people 里出现的人，一人一张
  const portraitOrder = [];
  for (const id of ids) for (const p of scenes[id].people || []) if (!portraitOrder.includes(p)) portraitOrder.push(p);
  for (const pid of portraitOrder) {
    const p = people[pid] || { id: pid, name: pid };
    const fact = [p.name, p.title].filter(Boolean).join('，');
    const prompt = `${fact}。${clean(p.bio || p.desc)}${lookText(t)}${NO_TEXT}`;
    add('image', { kind: 'image', prompt, size: '1024x1024', plate: plate.key }, { person: pid }, `${p.name || pid}：这一场里有他的戏`);
  }

  // 4) 台词声音：人物的 voice 一句，加上规则文本里引号里的台词
  for (const pid of portraitOrder) {
    const p = people[pid] || { id: pid, name: pid };
    const v = voiceOf(p);
    const lines = [];
    if (typeof p.voice === 'string' && p.voice) lines.push({ text: p.voice, beat: null });
    for (const id of ids) {
      const scene = scenes[id];
      if (!(scene.people || []).includes(pid)) continue;
      for (const txt of textsOf(scene)) for (const q of quoted(txt)) lines.push({ text: q, beat: id });
    }
    for (const line of lines) {
      add('voice', { kind: 'voice', text: line.text, speaker: pid, voice: v.id, rate: t.voice.rate, pause: t.voice.pause },
        { person: pid, beat: line.beat, line: line.text }, `${v.why}；语速 ${t.voice.rate}、句间停顿 ${t.voice.pause}s`);
    }
  }

  // 5) 音效：这一部戏用到的控制器，每种一声
  const used = new Set();
  for (const id of ids) for (const c of scenes[id].controllers || []) if (c && c[0]) used.add(c[0]);
  for (const cid of Object.keys(SFX_TABLE)) {
    if (!used.has(cid)) continue;
    const s = SFX_TABLE[cid];
    add('sfx', { kind: 'sfx', prompt: s.prompt, seconds: round(s.seconds * (0.7 + 0.6 * t.sound.intensity)), intensity: t.sound.intensity },
      { verb: cid }, `放开 ${t.craft.放开}：音效密而响（强度 ${t.sound.intensity}）`);
  }

  // 6) 音乐：每个 scene 一条循环
  for (const id of ids) {
    const scene = scenes[id];
    add('music', { kind: 'music', prompt: `${scene.title || id}：${moodOf(scene, t.music.mood)}`, bpm: t.music.bpm, seconds: t.music.loopSeconds, loop: true },
      { beat: id }, `节奏 ${t.craft.节奏}：bpm ${t.music.bpm}，循环 ${t.music.loopSeconds}s`);
  }

  const counts = { image: 0, voice: 0, sfx: 0, music: 0 };
  for (const a of assets) counts[a.kind] += 1;
  return { director: director.id, work, taste: t, plate: plate.key, counts, assets };
}
