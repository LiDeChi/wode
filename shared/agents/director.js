// 导演：把“这一段怎么演”定下来，并设想玩家会怎么接。
// 所有设计规则都是确定性的；导演不改导师的规则，只能经 mentor.guard 留下拒绝记录。
import { createMind } from '../core/mind.js';

// 设计稿 §13 情感→交互
export const TEMPLATES = { 责任: ['分配', '决策'], 亲密: ['对话'], 紧张: ['即时动作'], 好奇: ['探索'], 顿悟: ['解谜'], 悲悯: ['观看'] };

const round = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const num = (v, d = 0.5) => (typeof v === 'number' && !Number.isNaN(v) ? v : d);
const causes = (cause) => (cause == null ? [] : Array.isArray(cause) ? cause.slice() : [cause]);

// 模板 → 玩家会在哪个通道上“响”
const CHANNEL_OF = { 对话: '追问', 解谜: '追问', 分配: '追问', 决策: '追问', 观看: '停顿', 悲悯: '停顿', 即时动作: '很快通过', 探索: '重玩' };
const CHANNELS = ['停顿', '追问', '重玩', '很快通过'];

// 设想中的玩家：单元只读自己那一路；停在哪一层决定预测
const PLAYER_UNITS = [
  { id: 'u-look', label: '停顿', module: 'm-look', reads: ['停顿'], capacity: { base: 0.25, by: { 好奇: 0.35 } }, act: '停下来看心思' },
  { id: 'u-ask', label: '追问', module: 'm-think', reads: ['追问'], capacity: { base: 0.25, by: { 好奇: 0.35 } }, act: '追问为什么' },
  { id: 'u-replay', label: '重玩', module: 'm-think', reads: ['重玩'], capacity: { base: 0.2, by: { 冒险: 0.5 } }, act: '重来一次' },
  { id: 'u-pass', label: '很快通过', module: 'm-pass', reads: ['很快通过'], capacity: { base: 0.2, by: { 冒险: 0.3, 雕琢: -0.15 } }, act: '很快通过' },
];
const PLAYER_MODULES = [
  { id: 'm-look', label: '看心思', capacity: { base: 0.05, by: { 好奇: 0.3 } }, act: '停下来看心思' },
  { id: 'm-think', label: '想为什么', capacity: { base: 0.05, by: { 好奇: 0.3, 雕琢: 0.1 } }, act: '追问为什么' },
  { id: 'm-pass', label: '推进', capacity: { base: 0.1, by: { 冒险: 0.3 } }, act: '很快通过' },
];

// imagine 的 stoppedAt → 预测的反应
const STOP_TO_EXPECT = { mind: '停下来看心思', module: '追问为什么', unit: '很快通过' };
const CONF = { unit: 0.8, module: 0.65, mind: 0.5 };
const VERB_TEXT = { go: '走过去', give: '递东西', say: '说一句', watch: '看他的心思' };

function playerDef() {
  return { id: 'player', name: '玩家', temperament: {}, units: PLAYER_UNITS, modules: PLAYER_MODULES, mindAct: '停下来看心思', goals: [] };
}

export function createDirector({ ledger, def, mentor, saved }) {
  // saved 是 director.state() 的原样返回：手艺和 mind（含“他猜你”的记忆）一起读回来，
  // 否则刷新一次，导演就忘了你、也忘了自己上一部戏学到的手法。
  const mind = createMind({ units: [], modules: [], temperament: {}, ...def, id: def.id }, saved?.mind);
  const role = 'director:' + def.id;
  const t = def.temperament || {};
  // 手艺参数：从导演性情起步，learn 会改它
  const craft = {
    lockBias: round(num(t.雕琢, 0.5)),
    tragedyBias: round(num(t.悲剧, 0.5)),
    paceBias: 0,
    freedomBias: round(num(t.放开, 0.5)),
  };
  // 只认已知的手艺字段，坏存档里的杂键进不来
  for (const k of Object.keys(craft)) {
    if (typeof saved?.craft?.[k] === 'number' && Number.isFinite(saved.craft[k])) craft[k] = saved.craft[k];
  }

  const append = (kind, payload, cause, said, saidSource) => {
    const e = ledger.append({
      kind, from: role, to: 'world', payload,
      cause: causes(cause), ...(said !== undefined ? { said, saidSource } : {}),
    });
    return e.seq;
  };

  // 模板：emotions 里与 brief.emotion 相同的优先，否则 emotions[0]，再查 TEMPLATES
  function templateOf(beat, emotion) {
    const emos = beat.emotions || [];
    const emo = emos.includes(emotion) ? emotion : emos[0];
    if (TEMPLATES[emo]) return TEMPLATES[emo][0];
    const hit = Object.keys(TEMPLATES).find((k) => emos.includes(k));
    return hit ? TEMPLATES[hit][0] : '分配';
  }

  function levelOf(beat, polish) {
    const levels = [...(beat.levels || [0])].sort((a, b) => a - b);
    const lo = levels[0];
    const hi = levels[levels.length - 1];
    let level = polish > 0.6 ? lo : polish < 0.4 ? hi : levels[Math.floor((levels.length - 1) / 2)];
    if (craft.freedomBias > 0.6) level = Math.min(level + 1, hi);
    if (craft.paceBias > 0.15) level = Math.max(level - 1, 0);
    return clamp(level, 0, 3);
  }

  function grantsOf(template, level) {
    let g;
    if (level === 0) g = [];
    else if (template === '即时动作') g = ['go', 'give'];
    else if (template === '观看') g = [];
    else if (level >= 2) g = ['go', 'give', 'say'];
    else g = ['say'];
    if (level >= 1 && !g.includes('watch')) g.push('watch');
    return g;
  }

  function design(brief, catalog, cause) {
    const prefs = brief?.prefs || {};
    const pol = num(prefs.polish);
    const wait = num(prefs.wait);
    const emotion = brief?.emotion;
    const slot = wait < 0.4 ? '现在' : pol > 0.6 ? '稍后' : '现在';
    const beats = (catalog?.beats || []).map((beat) => {
      const template = templateOf(beat, emotion);
      const level = levelOf(beat, pol);
      const locked = !!beat.canLock && (pol + craft.lockBias) / 2 > 0.55;
      const prefab = locked ? '高' : level >= 2 ? '低' : '中';
      const grants = grantsOf(template, level);
      const language = level === 0 ? '看不见' : level === 3 ? '自由说' : '选一句';
      const ptext = pol > 0.6 ? '你更想要雕琢好的一段' : pol < 0.4 ? '你说想要能真的改变它' : '你在雕琢和改变之间两可';
      const atext = level >= 2 ? '所以这里放开' : level === 1 ? '所以这里留一句话' : '所以这里先不让你动';
      return { id: beat.id, scene: beat.scene, template, level, prefab, locked, grants, language, why: `${ptext}，${atext}` };
    });
    const d = { presentation: catalog?.id, director: def.id, emotion, slot, beats };
    const first = beats[0];
    const said = first
      ? `这一拍我用「${first.template}」来写。${first.why}。`
      : '这一场我先不排戏。';
    const seq = append('director.design', d, cause, said, 'rule');
    return { design: d, seq };
  }

  function predict(design, notes, cause) {
    // notes 可以是 mentor.notes() 的 {value,source,seq} 形状，也可以是裸数字
    const val = (x, d) => (x && typeof x === 'object' ? num(x.value, d) : num(x, d));
    const n = {
      wait: val(notes?.wait), polish: val(notes?.polish), depth: val(notes?.depth), surprise: val(notes?.surprise),
    };
    // 玩家性情由 notes 推：depth→好奇，surprise→冒险，polish→雕琢
    const temperament = { 好奇: n.depth, 冒险: n.surprise, 雕琢: n.polish };
    const pdef = playerDef();
    const predictions = [];
    for (const beat of (design?.beats || []).filter((b) => b.level >= 1)) {
      const channels = {};
      for (const c of CHANNELS) channels[c] = 0.15;
      channels[CHANNEL_OF[beat.template] || '追问'] = clamp(0.5 + 0.1 * beat.level, 0, 1);
      const event = { kind: 'beat', signature: `beat:${beat.id}:${beat.template}`, channels };
      const r = mind.imagine(pdef, event, temperament);
      predictions.push({
        beat: beat.id,
        scene: beat.scene,
        expect: STOP_TO_EXPECT[r.stoppedAt] || '追问为什么',
        confidence: CONF[r.stoppedAt] ?? 0.5,
      });
    }
    const said = predictions.length
      ? `我猜他会在${predictions.length}处有反应，第一处是「${predictions[0].expect}」。`
      : '这一场我没有可猜的地方。';
    const seq = append('director.predict', { presentation: design?.presentation, predictions }, cause, said, 'rule');
    return { predictions, seq };
  }

  function grant(beat, cause) {
    const verbs = (beat.grants || []).map((v) => VERB_TEXT[v] || v);
    const said = verbs.length
      ? `这一幕我给你的是：${verbs.join('、')}。`
      : '这一幕你只能看着，不能动。';
    return append('director.grant', {
      scene: beat.scene, verbs: beat.grants || [], level: beat.level, language: beat.language,
    }, cause, said, 'rule');
  }

  function schedule(options, cause) {
    const list = options || [];
    let chosen = null;
    for (const o of list) {
      if (!chosen || (o.weight ?? 0) > (chosen.weight ?? 0)) chosen = o;
    }
    const slot = chosen?.slot ?? '现在';
    const said = chosen ? `这一次我先排「${chosen.id ?? chosen.label ?? '这一段'}」，${slot}做。` : '这次没有可排的。';
    const seq = append('director.schedule', {
      input: list.map((o) => o.id ?? o.label ?? null), options: list, chosen, slot,
    }, cause, said, 'rule');
    return { chosen, seq };
  }

  function learn(predictions, reactions, cause) {
    const before = { ...craft };
    const errors = [];
    let hits = 0;
    let pauseMiss = 0;
    let otherMiss = 0;
    for (const rx of reactions || []) {
      const p = (predictions || []).find((x) => x.beat === rx.beat);
      const miss = !p || p.expect !== rx.signal;
      if (!miss) hits += 1;
      else if (rx.signal === '停下来看心思' && p?.expect === '很快通过') pauseMiss += 1;
      else otherMiss += 1;
      errors.push({ beat: rx.beat, expect: p?.expect ?? null, signal: rx.signal, error: miss ? 1 : 0 });
    }
    const total = (reactions || []).length;
    const hitRate = total ? round(hits / total) : 1;
    if (total && hitRate < 0.5) {
      // 玩家多停下来看心思、而导演以为很快通过 → 放慢、多写悲剧余味；否则加快
      if (pauseMiss > otherMiss) {
        craft.paceBias = round(craft.paceBias - 0.1);
        craft.tragedyBias = round(craft.tragedyBias + 0.05);
      } else {
        craft.paceBias = round(craft.paceBias + 0.1);
      }
    }
    const after = { ...craft };
    const said = total
      ? `这次我猜中了${hits}/${total}，${hitRate < 0.5 ? '偏差大，我把节奏调了' : '基本准，手艺不动'}。`
      : '这次没有反应可对照。';
    // 契约形状：beat / expected / actual / error 为并列数组，另附 hitRate 与 errors 明细
    const seq = append('director.learn', {
      beat: errors.map((e) => e.beat),
      expected: errors.map((e) => e.expect),
      actual: errors.map((e) => e.signal),
      error: errors.map((e) => e.error),
      errors, hitRate, craft: { before, after },
    }, cause, said, 'rule');
    return { errors, seq };
  }

  // 演示权限边界：导演不能改导师的规则或笔记，只能请导师的 guard 拒绝并记下
  function tryEditMentor(field) {
    return mentor ? mentor.guard(field, role) : null;
  }

  return {
    id: def.id,
    role,
    def, // 设定原件（name/voice/persona 用），narrate 靠它说“当时那句话”
    design,
    predict,
    grant,
    schedule,
    learn,
    tryEditMentor,
    craft: () => ({ ...craft }),
    state: () => ({ id: def.id, role, craft: { ...craft }, mind: mind.save() }),
  };
}
