// 導演設計的凍結快照。
//
// 為什麼要凍結：.runtime/world.json 是活的存檔，而且裡面有兩份互相矛盾的設計
// （lu「雕琢好的一段」幾乎不給權力；shan「能真的改變它」全放開）。呈現層如果每次
// 開機去讀，就會被別的會話改到一半、或是自己偷偷挑一份。所以這裡把它固定下來，
// 並且明確標示來源與時間，讓「你能做什麼」是可追溯的。
//
// 授權詞彙（grants）是契約的一部分，只有四個：
//   say   說一句話        → 裝置：選一種訴求（義／利／懼／恩），交給心智核心判定
//   watch 看               → 裝置：看這個人的心思（不消耗時間）
//   go    去               → 裝置：移動到另一個場景
//   give  給               → 裝置：把糧食給出去（會真的少掉）
//
// 資料來源：.runtime/world.json（slot b / director shan / design qiefu / seq 39），
// 由 shared/data/seed.js 的 SCENES 與 PEOPLE 補齊場景與人物。

export const DESIGN_SOURCE = {
  file: '.runtime/world.json',
  slot: 'b',
  director: 'shan',
  design: 'qiefu',
  seq: 39,
  frozenAt: '2026-10-11T05:19:18.360Z',
};

// 被凍結的那份設計（shan）。呈現層只認這一份，並在畫面上標明來源。
export const DESIGN = {
  director: 'shan',
  emotion: '悲悯',
  slot: 'b',
  beats: [
    { scene: 'daliang', level: 0, grants: [], why: '你说想要能真的改变它，所以这里先不让你动' },
    { scene: 'daliang', level: 2, grants: ['go', 'give', 'say', 'watch'], why: '你说想要能真的改变它，所以这里放开' },
    { scene: 'yimen', level: 2, grants: ['go', 'give', 'say', 'watch'], why: '你说想要能真的改变它，所以这里放开' },
    { scene: 'palace', level: 2, grants: ['go', 'give', 'watch'], why: '你说想要能真的改变它，所以这里放开' },
    { scene: 'ye', level: 2, grants: ['go', 'give', 'say', 'watch'], why: '你说想要能真的改变它，所以这里放开' },
    { scene: 'handan', level: 0, grants: [], why: '你说想要能真的改变它，所以这里先不让你动' },
  ],
};

// 另一個導演 lu 的設計，只留下來當對照——呈現層不採用，但畫面上可以說明差異。
export const DESIGN_LU = {
  director: 'lu',
  slot: 'a',
  beats: [
    { scene: 'daliang', level: 0, grants: [], why: '你更想要雕琢好的一段，所以这里先不让你动' },
    { scene: 'daliang', level: 1, grants: ['say', 'watch'], why: '你更想要雕琢好的一段，所以这里留一句话' },
    { scene: 'yimen', level: 1, grants: ['say', 'watch'], why: '你更想要雕琢好的一段，所以这里留一句话' },
    { scene: 'palace', level: 2, grants: ['go', 'give', 'watch'], why: '你更想要雕琢好的一段，所以这里放开' },
    { scene: 'ye', level: 1, grants: ['say', 'watch'], why: '你更想要雕琢好的一段，所以这里留一句话' },
    { scene: 'handan', level: 0, grants: [], why: '你更想要雕琢好的一段，所以这里先不让你动' },
  ],
};

// 這一場的行走路線。每一幕是一個 beat，對應 DESIGN.beats 的同一 index。
// 這是劇本骨架，不是選單：走進去、走近人、說話，然後局勢自己往前走。
export const EPISODE = [
  {
    id: 'daliang-0',
    scene: 'daliang',
    level: 0,
    grants: [],
    title: '大梁 · 信陵君府',
    objective: '先看著。這裡現在不讓你動。',
    opening: [
      { speaker: '', text: '魏安釐王二十年，秦圍邯鄲。' },
      { speaker: '', text: '魏王使將軍晉鄙將十萬眾救趙，留軍壁鄴，名為救趙，實持兩端以觀望。' },
      { speaker: '', text: '你是信陵君門下新來的門客。' },
    ],
  },
  {
    id: 'daliang-1',
    scene: 'daliang',
    level: 2,
    grants: ['go', 'give', 'say', 'watch'],
    title: '大梁 · 信陵君府',
    objective: '公子在等你開口。走近他。',
    opening: [
      { speaker: 'xinling', text: '我已請了幾次，王不聽。' },
      { speaker: '', text: '院子裡有人在裝車。百餘乘，像是要走。' },
    ],
  },
  {
    id: 'yimen-1',
    scene: 'yimen',
    level: 2,
    grants: ['go', 'give', 'say', 'watch'],
    title: '夷門',
    objective: '城東門。侯嬴在這裡守門。',
    opening: [
      { speaker: '', text: '你往東門走。天開始暗了。' },
      { speaker: 'houying', text: '公子的臉色，我看得清楚。' },
    ],
  },
  {
    id: 'coda',
    scene: 'yimen',
    level: 0,
    grants: [],
    title: '這一場到此',
    objective: '',
    opening: [],
  },
];

export const SCENES = {
  daliang: {
    id: 'daliang',
    name: '大梁 · 信陵君府',
    desc: '信陵君在大梁的宅邸，賓客進出之地。',
    ground: '#6b5b45',
    sky: '#1a1613',
    fog: 0.028,
    bounds: { minX: -22, maxX: 22, minZ: -18, maxZ: 18 },
    // 這一幕的壓力：糧食在掉。這是「圍城」本身，不是裝飾。
    grain: { start: 0.62, drainPerSec: 0.0016 },
    dawn: { start: 0.0, perSec: 0.0022 },
  },
  yimen: {
    id: 'yimen',
    name: '夷門',
    desc: '大梁東門，侯嬴守門之處。',
    ground: '#5d5648',
    sky: '#14181c',
    fog: 0.034,
    bounds: { minX: -20, maxX: 20, minZ: -16, maxZ: 16 },
    grain: { start: 0.62, drainPerSec: 0.0016 },
    dawn: { start: 0.35, perSec: 0.0030 },
  },
};

// 誰站在哪一幕的哪裡。座標是世界座標（X 東西、Z 南北），Y 由地形決定。
export const STAGING = {
  'daliang-0': [
    { person: 'xinling', x: 3.2, z: -2.4, facing: 200 },
    { person: 'zhuhai', x: -4.6, z: 3.1, facing: 40 },
    { person: 'zhaoshi', x: 7.4, z: 4.2, facing: 250 },
  ],
  'daliang-1': [
    { person: 'xinling', x: 2.4, z: -1.6, facing: 195 },
    { person: 'zhuhai', x: -5.2, z: 2.6, facing: 45 },
    { person: 'zhaoshi', x: 8.0, z: 3.4, facing: 255 },
  ],
  'yimen-1': [
    { person: 'houying', x: -1.2, z: 1.8, facing: 120 },
  ],
};

// 玩家從哪裡入場。
export const SPAWN = {
  'daliang-0': { x: -6.0, z: 6.5, facing: 45 },
  'daliang-1': { x: -6.5, z: 6.0, facing: 45 },
  'yimen-1': { x: 6.5, z: -4.0, facing: 210 },
};

export const PLAYER = {
  speed: 3.4,
  accel: 18,
  radius: 0.42,
  height: 1.7,
  interactRadius: 3.0,
};

export const CAMERA = {
  distance: 24,
  elevationDeg: 34,
  azimuthDeg: 42,
  fov: 42,
  lambda: 4.2,       // 追隨的平滑係數（用 1-exp(-λt)，與幀率無關）
  lookAheadY: 1.1,
};
