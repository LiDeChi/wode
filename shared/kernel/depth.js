// 档位：导师手里的算力分到哪一场，那一场的人就演得多细（docs/KERNEL.md §6）。
//
// 三档只改「文字厚薄」与「能看多深」，不改胜负规则：
//   细演   —— 反应后面再补一句他心里真实的盘算（来自 mind 的 candidates / stress / trust，不是编的），
//             看心思给得更细，追问也答得更细。
//   普通   —— 与没有档位时一模一样（对照组 680 个脚本走的就是这一档）。
//   一笔带过 —— 一件事最多两句话，追问只给一句，画面标出「这里被省略了」。
//
// 预算用完时从细演往下一档一档降，降到底也照常演完，不抛错、不中断。
//
// 这个文件是纯函数：没有随机、没有时间、没有外部依赖，同样的输入永远同样的输出。

/** 三档，从最细到最省 */
export const TIERS = ['细演', '普通', '一笔带过'];
/** 没有档位时的默认档：与旧行为完全一致 */
export const DEFAULT_TIER = '普通';
/** 每档的算力单价（与 mentor 的 TIER_NUM 是同一套刻度） */
export const TIER_NUM = { 细演: 3, 普通: 2, 一笔带过: 1 };
export const TIER_COST = TIER_NUM;
/** 被省掉时画面上那句话 */
export const ELIDED_NOTE = '这里被省略了';

const round = (v) => Math.round(v * 1000) / 1000;

/** 档位可以写成中文档名、数字（3/2/1）或英文别名；认不出来就是没有档位 */
const ALIAS = {
  细演: '细演', 深: '细演', deep: '细演', 3: '细演',
  普通: '普通', normal: '普通', 2: '普通',
  一笔带过: '一笔带过', 带过: '一笔带过', brief: '一笔带过', 1: '一笔带过',
};

export function normalizeTier(v) {
  if (v == null) return null;
  const key = typeof v === 'string' ? v.trim() : v;
  return ALIAS[key] || null;
}

export function tierNum(t) {
  return TIER_NUM[normalizeTier(t)] ?? TIER_NUM[DEFAULT_TIER];
}

/** 降一档；已经是最省的一档就停在原地（预算再紧也不抛错） */
export function downgrade(t) {
  const cur = normalizeTier(t) || DEFAULT_TIER;
  return cur === '细演' ? '普通' : cur === '普通' ? '一笔带过' : '一笔带过';
}

/** 引号配对（防止「一句话」被截成半个引号） */
function balanced(s) {
  return (s.match(/「/g) || []).length === (s.match(/」/g) || []).length;
}

/**
 * 一笔带过：一件事最多两句话。截断了就回 cut:true，让调用方标出「这里被省略了」。
 * 只在句子边界切；切完引号不配对就不切（宁可长一点，不要半句话）。
 */
export function briefText(text) {
  const s = String(text ?? '');
  const parts = s.match(/[^。]*。|[^。]+$/g) || [];
  if (parts.length <= 2) return { text: s, cut: false };
  const head = parts.slice(0, 2).join('').trimEnd();
  if (!balanced(head)) return { text: s, cut: false };
  return { text: head, cut: true };
}

/** 一笔带过：追问只给一句（去掉括号里的细节，只留第一句） */
export function oneLine(answer) {
  const s = String(answer ?? '');
  const i = s.indexOf('（');
  const head = i > 0 ? s.slice(0, i).trimEnd() : s;
  const first = (head.match(/[^。]*。/) || [head])[0].trim();
  return first || head;
}

/**
 * 细演的那一句「他心里在盘算」。
 * 每一个分句都来自真实的心智状态：感知的候选（哪几路先吃下、各占多少）、
 * 他自己的目标、hear() 的打动/反弹与信任前后、压力。
 * 没有可用的真实状态时返回 null（宁可不说，也不编）。
 */
export function depthLine({ name: n, mind, perception, heard, trust } = {}) {
  const p = perception || null;
  const labelOf = (c) => (p?.trace || []).find((x) => x.layer === c.layer && x.id === c.id)?.label || c.id;
  const bits = [];
  const pulls = (p?.candidates || []).filter((c) => c.layer !== 'mind');
  if (pulls.length) {
    const [a, b] = pulls;
    bits.push(`${labelOf(a)}先吃下（${round(a.weight)}）`);
    if (b) bits.push(`${labelOf(b)}压在下面（${round(b.weight)}）`);
  }
  if (p?.action?.act && (mind?.def?.goals || []).includes(p.action.act)) bits.push(`他要的正是「${p.action.act}」`);
  if (heard) {
    bits.push(heard.fit > 0.3 ? `你这话落到了他在乎的地方（打动 ${round(heard.moved)}）`
      : heard.backlash > 0.2 ? `你这话反倒激起了他的火（反弹 ${round(heard.backlash)}）`
        : '这话没落到他在乎的地方');
    const d = round((heard.trustAfter ?? 0) - (heard.trustBefore ?? 0));
    bits.push(d >= 0.08 ? `他对你的信多了一点（${heard.trustBefore}→${heard.trustAfter}）`
      : d <= -0.04 ? `他对你退了一步（${heard.trustBefore}→${heard.trustAfter}）`
        : `他对你的信没动（${heard.trustBefore}）`);
  } else if (typeof trust === 'number') {
    bits.push(trust >= 0.45 ? `他本来就信你（信任 ${trust}）`
      : trust <= 0.25 ? `他本来就不太信你（信任 ${trust}）`
        : `他对你半信半疑（信任 ${trust}）`);
  }
  const stress = round(mind?.state?.stress ?? 0);
  if (stress >= 0.5) bits.push(`他心里正绷着（压力 ${stress}）`);
  if (!bits.length) return null;
  return `${n}心里在盘算：${bits.join('；')}。`;
}

/** 细演时「看心思」多给的东西：几路拉扯各占多少、停在哪一层、压力与信任 */
export function watchDepth({ name, mind, perception, trust } = {}) {
  const p = perception || null;
  const labelOf = (c) => (p?.trace || []).find((x) => x.layer === c.layer && x.id === c.id)?.label || c.id;
  return {
    pulls: (p?.candidates || []).map((c) => ({ layer: c.layer, label: labelOf(c), act: c.act, weight: round(c.weight) })),
    stoppedAt: p?.stoppedAt ?? null,
    action: p?.action?.act ?? null,
    stress: round(mind?.state?.stress ?? 0),
    trust: typeof trust === 'number' ? trust : null,
    line: depthLine({ name, mind, perception: p, trust }),
  };
}
