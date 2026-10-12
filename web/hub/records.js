// 台边三件真器物。几何厚度与刻痕来自记录，火焰仅表示灯火。
import * as THREE from 'three';
import { MAT, box, cyl, sph } from './mats.js';
import { textPlate } from './text.js';
const TIER = { '细演': 3, '普通': 2, '一笔带过': 1 };
function text(group, words, x, y, height = .19, color = '#302316') {
  const plate = textPlate(words, { size: 64, color, worldHeight: height, maxWidth: 680 });
  plate.position.set(x, y, .065); group.add(plate); return plate;
}
function stack(group, count, width = 1.8) {
  group.add(box(width + .12, .1, .13, MAT.woodDark, 0, -.1, 0));
  // 一张厚纸可代表多条旧记录；对应数量仍留在来源对象里。
  for (let i = 0; i < Math.min(24, count); i++) group.add(box(width, .9, .012, MAT.paperDim, 0, -.45 + i * .008, -.02 - i * .015));
  group.add(box(width, 1.2, .03, MAT.paper, 0, -.6, .03));
}
// scene.js 只在 render.add 那一刻给已有网格挂 userData.node；之后往组里添的纸、火苗、
// 壶都要自己补挂一次，否则点上去会穿过这一件落到别处（器物只剩底板一条细边能点）。
function mark(node) { node.group.traverse(o => { if (o.isMesh) o.userData.node = node; }); }
export function createRecords(render, data) {
  const root = new THREE.Group(); render.scene.add(root);
  const nodes = new Map(); let page = 0; let paper;
  const specs = [
    { id: 'notebook', name: '导师的笔记本', kind: 'record', x: -1.8, detail: '点纸边翻页。压条留着你亲手改过的话，轻墨是导师观察到的事。' },
    { id: 'oil', name: '这一场的灯油', kind: 'record', x: 0, detail: '每幕一盏灯。已分配的油与尚未分配的油分开；这里记安排，不随播放消耗。' },
    { id: 'manuscript', name: '导演的手稿', kind: 'record', x: 1.8, detail: '左边是预测牌，旧批注夹在下边；当场等不等你，留在案上。' },
  ];
  for (const spec of specs) {
    const g = new THREE.Group(); root.add(g); g.position.set(spec.x, .95, 4.5);
    g.add(box(1.65, .12, .9, MAT.wood, 0, -.85, 0));
    const node = render.add({ ...spec, row: 1, act: 'record', group: g, explicit: new THREE.Vector3(spec.x, 1, 4.5), radius: .9, tagline: '点开读这一件的来处' });
    nodes.set(spec.id, node);
  }
  const notebook = nodes.get('notebook').group;
  function turn() {
    if (paper) { notebook.remove(paper); dispose(paper); }
    paper = new THREE.Group(); stack(paper, data.pages.length);
    const note = data.notes[page % Math.max(1, data.notes.length)];
    text(paper, note?.label || '笔记尚未开页', 0, .43, .18);
    text(paper, note?.text || '先去见一面，再来读。', 0, .03, .19, note?.source === '观察' ? '#736550' : '#302316');
    text(paper, note?.source === '你改的' ? '你的原话 · 压条留住' : note?.source === '观察' ? '观察留墨 · 可读缘由' : '见面留下的原话', 0, -.42, .13);
    if (note?.source === '你改的') paper.add(box(1.7, .06, .05, MAT.bronze, 0, -.52, .06));
    paper.userData.source = note; notebook.add(paper);
    mark(nodes.get('notebook'));
    return note?.text || '这页还没有留下记录。';
  }
  turn();
  const oil = nodes.get('oil').group;
  const chosen = Object.entries(data.oil.chosen);
  for (const [i, [beat, tier]] of chosen.entries()) {
    const x = (i - (chosen.length - 1) / 2) * .3;
    oil.add(cyl(.1, .12, .25, MAT.bronze, x, -.3, .05));
    oil.add(cyl(.009 * (TIER[tier] ?? 1), .009 * (TIER[tier] ?? 1), .15, MAT.rope, x, -.05, .05));
    const flame = sph(.055, MAT.flame, x, .15, .05); flame.scale.y = 1.8; oil.add(flame);
    flame.userData.source = { beat, tier, ...data.oil };
  }
  const spent = Math.max(0, Number(data.oil.spent) || 0), budget = Math.max(1, Number(data.oil.budget) || 1);
  for (const [x, amount, label] of [[-.46, spent, '已分配'], [.46, Math.max(0, budget - spent), '待分配']]) {
    oil.add(cyl(.17, .23, .48, MAT.bronze, x, -.8, .02));
    const fill = cyl(.145, .19, Math.max(.005, .42 * Math.min(1, amount / budget)), MAT.gold, x, -.77, .03); oil.add(fill);
    text(oil, label, x, -.28, .14, '#efdfb4');
  }
  text(oil, '灯芯是细密程度', 0, .49, .16, '#efdfb4');
  text(oil, '油量记分配，不随放映消耗', 0, -.64, .13, '#efdfb4');
  oil.userData.source = data.oil;
  mark(nodes.get('oil'));
  const manuscript = nodes.get('manuscript').group; stack(manuscript, data.director.learns.length);
  const prediction = Object.values(data.director.predictions).flatMap(p => p.list || []).at(-1);
  const learn = data.director.learns.at(-1);
  const decision = data.director.decisions.at(-1);
  text(manuscript, '预测牌与当场决定', 0, .43, .17);
  text(manuscript, prediction ? `曾料你会：${prediction.expect}` : '预测牌尚未放下', 0, .14, .15);
  text(manuscript, decision?.said || (decision?.payload?.policy?.waitForPlayer ? '我留给你等她' : decision ? '这一拍，世界继续' : '这场尚未定生活节奏'), 0, -.12, .16);
  text(manuscript, learn ? (learn.payload.errors?.some(e => e.error) ? '猜错过，旧批注留在这里' : '对照落过笔，手稿留着') : '尚未有真实对照批注', 0, -.43, .14);
  manuscript.userData.source = data.director;
  mark(nodes.get('manuscript'));
  return { root, nodes, data, turn() { page++; return turn(); }, read(id) {
    if (id === 'notebook') return data.notes[page % Math.max(1, data.notes.length)]?.text || '还没有笔记。';
    if (id === 'oil') return '这是一场的分配账。灯芯粗细随细密程度；油壶留着未分配的一份。';
    return decision?.said || learn?.said || '导演尚未留下一次真实对照。';
  }, update(camera) {
    const portrait = innerHeight > innerWidth;
    root.scale.setScalar(portrait ? .7 : 1);
    for (const node of nodes.values()) {
      node.group.lookAt(camera.position);
      node.group.getWorldPosition(node.center);
    }
  } };
}
function dispose(obj) { obj.traverse(o => { o.geometry?.dispose(); if (o.material?.map) { o.material.map.dispose(); o.material.dispose(); } }); }
