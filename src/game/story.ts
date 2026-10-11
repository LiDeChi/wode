import type { SceneKind } from '../presentation/contracts';
export interface Act { id: string; name: string; place: string; scene: SceneKind; cast: string[]; line: string; speaker: string; choices: Array<{ id: string; item: string; label: string; hint: string; verb: string; target: string }> }
export const ACTS: Act[] = [
  { id: 'court', name: '一 · 正路已尽', place: '大梁 · 信陵君府', scene: 'court', cast: ['xinling', 'weiking', 'player'], speaker: '信陵君', line: '我已劝了王上万端。邯郸的人，等不起了。', choices: [
    { id: 'petition', item: 'letter', label: '递上赵使竹简', hint: '让他看见城里的人', verb: 'persuade', target: 'xinling' },
    { id: 'gift', item: 'wine', label: '递酒，再请王上', hint: '把一次人情押上', verb: 'give', target: 'xinling' },
    { id: 'wait', item: 'moon', label: '再等一道王命', hint: '也许正路还有余地', verb: 'wait', target: 'weiking' }
  ] },
  { id: 'gate', name: '二 · 夷门不送', place: '大梁 · 夷门', scene: 'gate', cast: ['houying', 'xinling', 'player'], speaker: '侯嬴', line: '公子去吧。老朽不能相送。', choices: [
    { id: 'return', item: 'letter', label: '劝公子回头', hint: '他没有说完的话，比送别更重', verb: 'say', target: 'houying' },
    { id: 'listen', item: 'wine', label: '留一杯酒，等他开口', hint: '先听清这场试探', verb: 'say', target: 'houying' },
    { id: 'rush', item: 'hammer', label: '随公子赴死', hint: '把勇气当作最后的办法', verb: 'say', target: 'houying' }
  ] },
  { id: 'night', name: '三 · 取符之夜', place: '大梁 · 魏宫', scene: 'night', cast: ['ruji', 'player'], speaker: '如姬', line: '父仇是公子报的。这一次，换我送他一程。', choices: [] },
  { id: 'camp', name: '四 · 合符而疑', place: '邺 · 晋鄙军营', scene: 'camp', cast: ['jinbi', 'zhuhai', 'xinling', 'player'], speaker: '晋鄙', line: '十万人的命，不能只交给半块合上的符。', choices: [
    { id: 'verify', item: 'seal', label: '让晋鄙再核一次', hint: '以凭据换一条活路', verb: 'verify', target: 'jinbi' },
    { id: 'appeal', item: 'letter', label: '递上邯郸的求援', hint: '问他愿意守住什么', verb: 'persuade', target: 'jinbi' },
    { id: 'force', item: 'hammer', label: '让朱亥上前', hint: '兵权可以夺，人不能回来', verb: 'command', target: 'zhuhai' }
  ] }
];
export const PROLOGUE = [
  { title: '长平之后', caption: '公元前 258 年前后', line: '长平的烟尘散去，秦军来到邯郸。' },
  { title: '一座城', caption: '赵都 · 邯郸', line: '柴与粮一天天少了。城里的人，还在等。' },
  { title: '一道王命', caption: '魏都 · 大梁', line: '魏王派出救兵，又让晋鄙止步于邺。' },
  { title: '一个人', caption: '信陵君门下', line: '正路已经走尽。你是他门下一个新来的士。' },
  { title: '一块兵符', caption: '这一次，由你在场', line: '有人守住王命，有人想守住人。你的一句话，会留在他们心里。' }
];
export const WORKS = [
  { id: 'prologue', title: '长平之后', type: '电影', duration: '1 分钟', director: '沈砚', note: '一座城，漫长的围困，一道没有抵达的命令。', style: 'city' },
  { id: 'qiefu', title: '窃符', type: '叙事游戏', duration: '约 10 分钟', director: '沈砚', note: '你的一句话，可能改变一个人的结局。', style: 'seal' },
  { id: 'siege', title: '围城', type: '短游戏', duration: '约 3 分钟', director: '陆微', note: '城外的人决定救不救，城里的人决定给不给。', style: 'grain' },
  { id: 'night', title: '取符之夜', type: '潜行', duration: '2–3 分钟', director: '陆微', note: '月色能照亮路，也能照见你。', style: 'moon' }
] as const;
