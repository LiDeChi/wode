// 新组合之一（docs/KERNEL.md §7）：大梁宫墙外，被偷听。
//
// 这一场没有新的控制器、没有新的效果、内核一行没动：speech（你说什么）+ attention（墙那边谁在听），
// 加一张有序规则表，就是全部。「有没有被听见」不是新系统——它就是守卫乙的注意力本身
// （规则表直接读 ctrl.attention.looking.guard_b），而「等换班」就是把这份注意力关掉
// （attention 效果），跟守卫甲的灯是同一个东西。
//
// 魏王的耳目用的是 seed 里已有的人：宫中当值的守卫乙（guard_b，place: palace，宫墙外就是他的岗）。
// seed 里没有专门的密探角色，所以没有新造人物，也没有给心智加东西。
//
// 这一场声明 gate:false：它不在导演的分镜拍子里（没有对应的 beat），也不该由导演授权决定能不能说话。
//
// 三条路，一眼看得懂：
//   大声说 + 有人听   → 话传进宫里，魏王更猜忌信陵君（flag kingSuspicious + claim），还耽误两天
//   等换班 + 大声说   → 墙那边空着，赵使听清了（claim + flag wordCarried），只耽误一天
//   压低声音（耳语）  → 宫里听不真，赵使也只抓住半句（弱一档的 claim），不耽误天数
// 拖过五步：天亮了，赵使自己回邯郸。

export const OVERHEARD_SCENES = {
  daliang_overheard: {
    work: 'qiefu', beat: 'overheard', title: '宫墙外', place: '大梁', lead: 'zhaoshi',
    people: ['zhaoshi', 'guard_b'],
    goal: '把「公子决意救赵」这句话递到赵使耳里，别让墙那边的人听去。',
    scene: '宫墙外的廊下，赵使握着竹简等回话；当值的守卫乙提着灯，在门那边来回踱步。',
    ambient: { kind: 'eavesdrop', channels: { 人: 0.5, 义: 0.3 } },
    // 不受导演授权闸门约束（与暮色粮仓同一个口子，见 docs/KERNEL.md §2）
    gate: false,
    controllers: [
      ['speech', { order: 100, options: [
        { id: 'say-justice', verb: 'say', to: 'zhaoshi', appeal: { 义: 0.7 }, channels: { 义: 0.5, 人: 0.4 }, line: '大声说：「救赵是大义。魏王按兵不动，天下士人都要寒心。」' },
        { id: 'say-qin', verb: 'say', to: 'zhaoshi', appeal: { 惧: 0.6 }, channels: { 秦: 0.5, 人: 0.3 }, line: '大声说：「秦军不足畏。公子若得了兵，邯郸还有救。」' },
        { id: 'whisper', verb: 'say', to: 'zhaoshi', appeal: { 人: 0.7 }, channels: { 人: 0.6 }, line: '压低声音，只说给赵使一个人听' },
      ] }],
      // 墙那边的耳朵：开局是睁着的（on）；「等换班」这一支会把它关掉（off）
      ['attention', { order: 500, people: ['guard_b'], start: { guard_b: 'on' } }],
      // 五步之内把话递出去：一个动作算一步（看心思、追问不占时间）
      ['clock', { order: 900, limit: 5, pause: ['watch', 'ask'], end: 'too-late', endText: '天亮了。赵使等不下去，自己上车回邯郸了。' }],
    ],
    wait: { id: 'wait', line: '不出声，等守卫乙换班' },
    finish: 'on-end',
    rules: [
      // 拖过五步：天亮了，话没递出去
      { when: { ctrl: { clock: { step: 5 } } },
        then: [['end', 'too-late']],
        text: '天亮了。赵使等不下去，自己上车回邯郸了。' },
      // 等换班：把墙那边的注意力关掉，代价是一天
      { when: { intent: 'wait' },
        then: [['attention', 'guard_b', 'off'], ['clock', -1]],
        text: '你不出声，等到换班。守卫乙提着灯往门房里去了——这会儿墙那边没人听。',
        cost: '耽误了一天' },
      // 大声说，墙那边有人：话传进宫里
      { when: { intent: ['say-justice', 'say-qin'], ctrl: { attention: { looking: { guard_b: 'on' } } } },
        then: [
          ['claim', { subject: '魏王', predicate: '对信陵君', object: '更加猜忌，闭门不见', holder: '魏王', note: '门客在宫墙外把话喊了出去' }],
          ['flag', 'kingSuspicious', true],
          ['clock', -2],
        ],
        text: '门那边的脚步停了一下。第二天，宫里传出话来：公子不必再进宫了。',
        cost: '魏王更猜忌信陵君；邺城的晋鄙会更难说动' },
      // 大声说，墙那边没人：赵使听清了，话递到了
      { when: { intent: ['say-justice', 'say-qin'], ctrl: { attention: { looking: { guard_b: 'off' } } } },
        then: [
          ['claim', { subject: '赵使', predicate: '听到的话', object: '公子决意救赵', holder: '赵使' }],
          ['flag', 'wordCarried', true],
          ['end', 'carried'],
        ],
        text: '门那边空着。{name}听你把话说完，脸上松了一下：「我这就回邯郸，等公子的信。」' },
      // 耳语：宫里听不真，赵使也只抓住半句
      { when: { intent: 'whisper' },
        then: [
          ['claim', { subject: '赵使', predicate: '听到的话', object: '公子已在想办法', holder: '赵使' }],
          ['flag', 'wordCarried', 'half'],
          ['end', 'half'],
        ],
        text: '你把声音压到最低。{name}凑过来，只抓住半句：「公子已经在想办法了？」门那边的守卫乙没听清。' },
    ],
  },
};

/** 与 qiefu.js / weicheng.js 同形（资产生成管线按 work 读这个导出） */
export const SCENES = OVERHEARD_SCENES;

/** 这一场只用共用控制器（shared/kernel/controllers 里的 speech / attention / clock） */
export const OVERHEARD_CONTROLLERS = {};
