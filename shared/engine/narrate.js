// 旁注：把角色“当时的说法”从规则模板换成更像人说的一句。
// 三条硬约束：
// 1) 只读账本。已经写进账本的记录一个字都不改——账本只追加，改了 cause 链和指纹都会坏。
// 2) 只写旁注表 session.voices[seq]。规则 said 永远留着做兜底，模型失败就不静默。
// 3) 模型调用本身由 speaker 记 gateway.call，cause 指回产生这句话的那条决定。
// 所以这是“说法的旁注”，不是“决定的改写”：决定、cause、hash 全都不变。

import { roleKind, roleId } from '../core/ledger.js';

// 一句话怎么说，也由账本里的记录指向用户
export const PERSONA_OF = {
  mentor: '给你排戏的制片人：你说了想要什么，你负责按你的口味排戏、分预算，说话像一个替你把戏排好的人',
  lu: '陆导，排这一场戏的导演：偏爱把戏锁死、慢慢雕琢，喜欢悲剧留下的余味',
  shan: '单导，排这一场戏的导演：偏爱放开、快节奏，先让人玩起来，错了再改',
};

// 兜底：本文件允许独立使用，不需要调用方先填好发言人的名字
const LABEL_OF = { mentor: '导师', lu: '陆导', shan: '单导', gateway: '网关', world: '世界' };

/** 「他当时被谁的话说动了」：把 payload 里最像人话的字段挑出来。 */
export function factsOf(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const out = [];
  if (typeof payload.need === 'string' && payload.need) out.push(`用户的原话：“${payload.need}”`);
  if (typeof payload.emotion === 'string' && payload.emotion) out.push(`这一段要的是「${payload.emotion}」`);
  if (typeof payload.signal === 'string' && payload.signal) out.push(`他看到的是「${payload.signal}」`);
  if (typeof payload.field === 'string' && payload.field) {
    const v = payload.value ?? payload.after;
    out.push(`他的「${payload.field}」${v !== undefined ? `现在是 ${v}` : '被改了'}`);
  }
  // 分配结果与预算，说成一句但别把整张表塞进提示词
  if (payload.chosen && typeof payload.chosen === 'object') {
    const tier = Object.values(payload.chosen)[0];
    if (tier) out.push(`他把分量定成「${tier}」`);
  }
  if (typeof payload.spent === 'number' && typeof payload.budget === 'number') {
    out.push(`预算 ${payload.spent}/${payload.budget}`);
  }
  if (Array.isArray(payload.verbs) && payload.verbs.length) out.push(`他放开的动手方式：${payload.verbs.join('、')}`);
  if (Array.isArray(payload.predictions) && payload.predictions.length) {
    out.push(`他猜玩家会在「${payload.predictions[0]?.expect}」上停一下`);
  }
  if (typeof payload.hitRate === 'number') out.push(`他这次猜中 ${payload.hitRate}`);
  if (typeof payload.reason === 'string' && payload.reason) out.push(`他不肯改的理由：${payload.reason}`);
  // 短标量补一句，保证提示词里一定有可读的东西
  if (out.length === 0) {
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v === 'number') out.push(`${k} = ${v}`);
      else if (typeof v === 'string' && v) out.push(`${k}：${v}`);
      if (out.length >= 3) break;
    }
  }
  return out;
}

/** 一条记录自己知道的事情：给模型的 view 用小字条，不塞原始 payload。 */
function factsForEntry(e) {
  const base = `${LABEL_OF[roleKind(e.from)] || e.from}说：「${e.said}」`;
  return [base, ...factsOf(e.payload)];
}

/**
 * 挑出该配旁注的记录：导师/导演写的、有规则台词的。
 * 排序按账本顺序；要不要跳过已旁注的由 narrate 看 voices 决定。
 */
export function narratableRecords(ledger) {
  return (ledger?.entries || []).filter(
    (e) => (roleKind(e.from) === 'mentor' || roleKind(e.from) === 'director') && typeof e.said === 'string' && e.said,
  );
}

/**
 * 给指定的账本记录配一句“当时的说法”。
 * @param {{ledger:object, directors?:object, state?:object, voices?:object}} session 必须已有 voices 表
 * @param {{seqs?:number[], speaker:{say:Function}}} deps
 *        speaker 的 call 由宿主注入：浏览器里 POST /api/speak，测试里可传假的。
 * @returns {Promise<Array<{seq:number, text:string, source:'model'|'rule'}>>} 本次真正写下的旁注
 */
export async function narrate(session, { seqs, speaker } = {}) {
  const ledger = session?.ledger;
  if (!ledger || typeof ledger.get !== 'function') throw new Error('narrate 需要带 ledger 的 session');
  // 最小改动：会话自带 voices 表；旧存档没有就补一个
  session.voices ||= {};
  const voices = session.voices;

  const list = Array.isArray(seqs) && seqs.length
    ? seqs.map((seq) => ledger.get(seq)).filter(Boolean)
    : narratableRecords(ledger);
  // 已经旁注过的全部跳过：没有活要干就不需要 speaker
  const todo = list.filter((e) => !voices[e.seq]);
  if (todo.length && (!speaker || typeof speaker.say !== 'function')) {
    throw new Error('narrate 需要会说话的 speaker');
  }

  const out = [];
  for (const e of todo) {
    const kind = roleKind(e.from);
    const id = roleId(e.from) || kind;
    const role = e.from;
    const def = session.directors?.[id]?.def || session.state?.staff?.[id];
    const name = def?.name || e.payload?.name || LABEL_OF[id] || id;

    // 这句话该说什么意思：规则 said 就是意思本身，模型只换说法
    const line = `你是${name}。用你的口吻把这句话说出来（意思不变）：「${e.said}」`;
    // view 只给这个角色当时真的知道的：自己说过的话 + 存进账本的事实 + 沿 cause 的用户记录
    const view = [...factsForEntry(e)];
    const sec = e.cause?.[0];
    if (sec && typeof ledger.get(sec) === 'function') {
      const p = ledger.get(sec);
      if (p && typeof p.said === 'string' && p.said) view.push(`${LABEL_OF[roleKind(p.from)] || p.from}说：「${p.said}」`);
    }
    for (const c of e.cause || []) {
      const a = ledger.get(c);
      if (!a || a.seq === sec) continue;
      if (roleKind(a.from) === 'user' && typeof a.payload?.need === 'string' && a.payload.need) {
        view.push(`用户说过：“${a.payload.need}”`);
      }
    }

    const res = await speaker.say({
      purpose: '对白',
      role,
      persona: PERSONA_OF[id] || `${name}：${def?.bio || def?.voice || '这个人物的说法'}`,
      view,
      line,
      fallback: e.said, // 超额/抛错/超时/出戏词 → 一字不改回到规则台词
      maxChars: 40,
      cause: [e.seq], // 模型调用本身也挂在产生这句话的那条决定上
    }).catch(() => null); // speaker 自己的兜底已经很全，这里只防它整个坏掉

    const text = res?.text ?? e.said;
    const source = res?.source === 'model' ? 'model' : 'rule';
    voices[e.seq] = { text, source };
    out.push({ seq: e.seq, text, source });
  }
  return out;
}

export default narrate;
