// 呈现目录：每个作品有哪些节拍（beat），每个节拍适合什么情绪、能放到哪一档交互。
// 导演只读这里来排设计；作品墙读 WORKS 来看每部作品碰了哪些主张。
// 数据纯静态，不含随机和时间，保证每次加载结果一致。

/** 节拍的情绪只从这几个里取，和导演的 TEMPLATES 对齐 */
// 责任 / 亲密 / 紧张 / 好奇 / 顿悟 / 悲悯

export const CATALOG = {
  changping: {
    id: 'changping',
    title: '长平之后',
    kind: 'film',
    beats: [
      {
        id: 'film',
        scene: 'handan',
        title: '邯郸城下',
        desc: '长平败后，秦军围住邯郸，城里的人只能看着。',
        emotions: ['悲悯'],
        levels: [0],
        centrality: 0.5,
        canLock: false,
      },
    ],
  },

  weicheng: {
    id: 'weicheng',
    title: '围城',
    kind: 'game',
    beats: [
      {
        id: 'dusk',
        scene: 'granary',
        title: '暮色粮仓',
        desc: '粮仓对不上账，守仓人要决定先瞒住还是先去找人。',
        emotions: ['责任'],
        levels: [1, 2],
        centrality: 0.6,
        canLock: true,
      },
      {
        id: 'morning',
        scene: 'granary',
        title: '第二天·守仓人视角',
        desc: '天亮了，守仓人看见借粮的人排成长队，才明白昨晚的账意味着什么。',
        emotions: ['顿悟'],
        levels: [0, 1],
        centrality: 0.4,
        canLock: true,
      },
    ],
  },

  qiefu: {
    id: 'qiefu',
    title: '窃符',
    kind: 'game',
    beats: [
      {
        id: 'open',
        scene: 'daliang',
        title: '大梁的开场',
        desc: '魏王止步，信陵君的正路走不通，门客们开始各自想办法。',
        emotions: ['悲悯'],
        levels: [0],
        centrality: 0.5,
        canLock: false,
      },
      {
        id: 'daliang',
        scene: 'daliang',
        title: '信陵君府',
        desc: '信陵君请门客出主意，你可以递一样东西，替他说一句话。',
        emotions: ['责任', '亲密'],
        levels: [1, 2],
        centrality: 0.6,
        canLock: true,
      },
      {
        id: 'yimen',
        scene: 'yimen',
        title: '夷门',
        desc: '侯嬴献计，如姬的名字第一次被提起。',
        emotions: ['亲密', '顿悟'],
        levels: [1, 2],
        centrality: 0.7,
        canLock: false,
      },
      {
        id: 'night',
        scene: 'palace',
        title: '取符之夜',
        desc: '如姬在卧内偷出兵符，你要决定在哪一刻出手。',
        emotions: ['紧张'],
        levels: [2],
        centrality: 0.9,
        canLock: false,
      },
      {
        id: 'ye',
        scene: 'ye',
        title: '邺城',
        desc: '晋鄙不肯交兵，朱亥的铁椎落下，邺城的军队换了主人。',
        emotions: ['责任', '悲悯'],
        levels: [1, 2],
        centrality: 0.95,
        canLock: true,
      },
      {
        id: 'coda',
        scene: 'handan',
        title: '拉远与史',
        desc: '镜头拉远，告诉你这一晚之后，历史又怎样接着走。',
        emotions: ['悲悯'],
        levels: [0],
        centrality: 0.4,
        canLock: false,
      },
    ],
  },

  night: {
    id: 'night',
    title: '取符之夜',
    kind: 'action',
    beats: [
      {
        id: 'run',
        scene: 'palace',
        title: '一路狂奔',
        desc: '符在怀里，追兵在后，你只有一条路可以跑。',
        emotions: ['紧张'],
        levels: [2],
        centrality: 0.8,
        canLock: false,
      },
    ],
  },

  studio: {
    id: 'studio',
    title: '片场',
    kind: 'game',
    beats: [],
  },
};

export const WORKS = [
  {
    id: 'changping',
    title: '长平之后',
    kind: 'film',
    length: '约1分钟',
    viewpoint: '旁观的史官',
    summary: '长平败后，秦军围邯郸，城外的人只能看着。',
    reads: [],
    writes: ['邯郸|被围'],
  },
  {
    id: 'weicheng',
    title: '围城',
    kind: 'game',
    length: '约1分钟',
    viewpoint: '守仓人',
    summary: '邯郸粮仓对不上账，守仓人夜里瞒，天亮后才知道瞒不住。',
    reads: ['邯郸|被围'],
    writes: ['邯郸粮仓|欠粮', '平原君|散财'],
  },
  {
    id: 'qiefu',
    title: '窃符',
    kind: 'game',
    length: '约1分钟',
    viewpoint: '门客',
    summary: '魏王止步，门客们各出主意，如姬偷符，晋鄙落下，邺城易主。',
    reads: ['魏王|止步'],
    writes: ['侯嬴|献计', '如姬|窃符', '晋鄙|下场'],
  },
  {
    id: 'night',
    title: '取符之夜',
    kind: 'action',
    length: '约1分钟',
    viewpoint: '门客',
    summary: '符在手里的那一夜，从卧内逃出来，身后有人发现了。',
    reads: ['如姬|窃符'],
    writes: ['兵符|去向', '门客|被发现'],
  },
  {
    id: 'studio',
    title: '片场',
    kind: 'studio',
    length: '约1分钟',
    viewpoint: '片场（作者）',
    summary: '把上面几部作品的节拍和主张放在一起排练的地方。',
    reads: [],
    writes: [],
  },
];
