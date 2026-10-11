// 生活循环的逐拍计划（docs/design/LIVING.md §3、§9）。
//
// designLife 是纯函数：只读导演的手艺（craft）与品味（stagecraft.taste），
// 算完把「每场每一拍怎么办」交回调用方。它不写账本、不改状态；
// 启用生活的会话拿这份计划统一提交一次 director.life-design。
//
// 一条 lifePolicy 说清五件事：
//   waitForPlayer  等不等你（不等 = 演员自己动身）
//   cadenceTicks   隔几拍检查一次环境（节奏快就查得勤）
//   autonomy       允许哪些演员、自己可以做哪些动词（导演给演员的独立授予，不借玩家的 grants）
//   warning        提前几拍示警（谁在何时知道）
//   historyReveal  代价怎么露出来：slow 慢慢拉开 / after-decision 决定后先露一段
// 外加 why（人话，给人看的一层）与 sourceSeq（提交时的账本位置，纯函数里先留空）。

import { taste } from '../agents/stagecraft.js';

const round = (v) => Math.round(v * 1000) / 1000;

/** 节奏 → 隔几拍检查一次（节奏高 = 推进快 = 间隔小） */
export const CADENCE_BY_PACE = [[0.6, 2], [0.35, 3], [0, 4]];
/** 环境自己的节拍：巡灯这类事每八拍推进一次 */
export const ENVIRONMENT_CADENCE = 8;

const cadenceOf = (pace) => (CADENCE_BY_PACE.find(([min]) => pace >= min) || [0, 4])[1];

/**
 * 给一部作品的每一场算一条 lifePolicy。
 * design 可以是这一场的 design（带 beats），也可以是 designs[work]；scenes 用来读场景声明。
 * 返回 { policies: {beat: policy}, decisions: [...] }，两者都是纯数据。
 */
export function designLife({ director, design, scenes = {}, work, seed = 'life' } = {}) {
  const d = design?.beats ? design : (work ? design?.[work] : design) || {};
  const beats = Array.isArray(d.beats) ? d.beats : [];
  const craft = typeof director?.craft === 'function' ? director.craft() : (director?.craft || {});
  const t = director ? taste(director) : { craft: {} };
  const pace = round(Number(t?.craft?.节奏 ?? craft.paceBias ?? 0.5));
  const freedom = round(Number(craft.freedomBias ?? 0.5));
  const lock = round(Number(craft.lockBias ?? 0.5));
  const tragedy = round(Number(craft.tragedyBias ?? 0.5));
  const cadenceTicks = cadenceOf(pace);
  const autonomous = freedom > lock;
  const policies = {};
  const decisions = [];

  for (const beat of beats) {
    const scene = scenes[beat.scene] || scenes[beat.id] || {};
    const life = scene.life || {};
    const people = Array.isArray(life.actors) ? life.actors.slice() : (Array.isArray(scene.people) ? scene.people.slice() : []);
    const verbs = ['think', ...(autonomous ? (Array.isArray(life.verbs) ? life.verbs.slice() : []) : [])];
    const policy = {
      beat: beat.id ?? beat.scene,
      scene: beat.scene,
      work: scene.work ?? work ?? null,
      waitForPlayer: !autonomous,
      cadenceTicks,
      autonomy: { people, verbs },
      warning: {
        ticks: 1 + Math.round(2 * (1 - pace)),
        why: '更鼓与近灯先响，人还没到跟前。',
      },
      historyReveal: tragedy > 0.6 ? 'slow' : 'after-decision',
      environment: {
        cadenceTicks: Number(life.environment?.cadenceTicks ?? ENVIRONMENT_CADENCE),
        kind: scene.ambient?.kind ?? 'idle',
        channels: scene.ambient?.channels ?? {},
      },
      why: autonomous
        ? `不等你：「${people.join('、') || '场里的人'}」会自己动身，你在不在场都一样。`
        : `「${people.join('、') || '场里的人'}」先等你开口，但心里的事照旧往前走。`,
      sourceSeq: null,
    };
    policies[policy.beat] = policy;
    decisions.push({
      beat: policy.beat,
      scene: policy.scene,
      policy,
      inputs: { lockBias: lock, freedomBias: freedom, paceBias: round(Number(craft.paceBias ?? 0)), 节奏: pace, 悲剧: tragedy },
      why: policy.why,
      seed: `${seed}/${policy.beat}`,
    });
  }

  return { policies, decisions };
}
