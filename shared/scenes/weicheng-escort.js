// 新组合之二（docs/KERNEL.md §7）：围城·押粮穿城。
//
// 同样是零内核改动：space（走到哪儿、什么挡着）+ clock（天黑前）+ handover（递一袋粮换路）。
// 十字口被饥民堵住这件事不是新的阻挡系统——它就是一条规则：车到了十字口，如果「路口松开了」
// 还没立起来，就把车推回东市（move 效果）。递出一袋粮，路口就松开（handover 的那一条规则
// 把 flag crowdCleared 立起来），跟粮仓里递借条是同一种动作。
//
// 两个出口：
//   天黑前出南门        → claim 粮车穿过邯郸 + flag escortDone + end 'delivered'
//   六步之内没出去      → clock 的 end 'dark'：城门落锁，粮还压在车上
//
// 这一场声明 gate:false：它不是导演的分镜拍子（没有对应的 beat），押粮也不该由导演授权决定。

const TILES = ['仓门', '东市', '十字口', '南门'];

export const ESCORT_SCENES = {
  escort: {
    work: 'weicheng', beat: 'escort', title: '押粮穿城', place: '邯郸城内', lead: null,
    people: ['borrower'],
    goal: '天黑前把粮车从仓门推过城，出南门。',
    scene: '粮车压在石板路上。饥民围在十字口，谁的眼睛都盯着车上的麻袋。',
    ambient: { kind: 'crowd', channels: { 人: 0.6, 粮: 0.5 } },
    // 不受导演授权闸门约束（与暮色粮仓同一个口子，见 docs/KERNEL.md §2）
    gate: false,
    controllers: [
      // 车上的一袋粮：递出去，路就松开
      ['handover', { order: 200, items: [
        { id: 'grain', verb: 'give', to: 'borrower', label: '一袋粮', channels: { 粮: 0.6, 人: 0.4 }, appeal: { 粮: 0.7, 恩: 0.3 }, line: '从车上卸一袋粮，递过去' },
      ] }],
      // 只能一格一格挪（free:false）：仓门→东市→十字口→南门
      ['space', { order: 400, tiles: TILES, start: '仓门', free: false }],
      // 六步之内出城：一个动作算一步（看心思、追问不占时间）
      ['clock', { order: 900, limit: 6, pause: ['watch', 'ask'], end: 'dark', endText: '天黑，城门落锁。粮还压在车上，没能出城。' }],
    ],
    wait: { id: 'wait', to: 'borrower', line: '停下车，等一等' },
    finish: 'on-end',
    rules: [
      // 出南门：粮送到了（这一条写在最前，所以最后一步正好用尽六步也算送到了）
      { when: { at: '南门' },
        then: [
          ['claim', { presentation: 'weicheng', subject: '粮车', predicate: '穿过邯郸', object: '天黑前出了南门', holder: '门客（你）' }],
          ['flag', 'escortDone', true],
          ['end', 'delivered'],
        ],
        text: '车出了南门。守门的军士看了一眼路引，没有拦。' },
      // 递粮：路口松开一条缝
      { when: { intent: 'give-grain' },
        then: [
          ['flag', 'crowdCleared', true],
          ['claim', { presentation: 'weicheng', subject: '粮车', predicate: '过十字口', object: '用一袋粮换开一条路', holder: '门客（你）' }],
        ],
        text: '{name}接过粮袋，往路边一让，路口松开一条缝。' },
      // 十字口还没松开：车被饥民挤回东市
      { when: { at: '十字口', not: { flag: { crowdCleared: true } } },
        then: [['move', 'player', '东市']],
        text: '饥民的脊背把路口堵死了。车过不去，你被挤回东市。',
        cost: '又耽误了一步' },
      // 等一等：只是把饥民等得更多
      { when: { intent: 'wait' },
        text: '你停下车。围过来的饥民更多了，都盯着车上的麻袋。' },
      // 六步走完：天黑落锁
      { when: { ctrl: { clock: { step: 6 } } },
        then: [['end', 'dark']],
        text: '天黑，城门落锁。粮还压在车上，没能出城。' },
    ],
  },
};

/** 与 qiefu.js / weicheng.js 同形（资产生成管线按 work 读这个导出） */
export const SCENES = ESCORT_SCENES;

/** 这一场只用共用控制器（shared/kernel/controllers 里的 handover / space / clock） */
export const ESCORT_CONTROLLERS = {};
