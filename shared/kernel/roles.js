// 角色标识与记账默认值。单独一个文件，避免 kernel.js ↔ effects.js 互相 import。

/** 玩家在这些作品里用的身份 */
export const PLAYER = 'actor:player';

/** 门客（你）：亲历主张的默认持有者 */
export const HOLDER = '门客（你）';

/** claim 效果的默认呈现；邺城/取符之夜属于《窃符》 */
export const DEFAULT_PRESENTATION = 'qiefu';

/** 亲历：你自己在场时得到的主张 */
export const DEFAULT_CHANNEL = '亲历';
