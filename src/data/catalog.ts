import type { Entity, Evidence, WorkId } from '../core/types';

export interface SourceRecord {
  id: string;
  title: string;
  url: string;
  location: string;
  quote: string;
  verified: boolean;
  kind: 'primary' | 'design' | 'ledger';
  note: string;
}

export const SOURCES: Record<string, SourceRecord> = {
  'shiji-wei': {
    id: 'shiji-wei', title: '《史记·魏公子列传》',
    url: 'https://zh.wikisource.org/wiki/史記/卷077', location: '卷七十七，救赵、夷门献计、窃符与夺军段',
    quote: '魏王恐，使人止晉鄙，留軍壁鄴，名為救趙，實持兩端以觀望。晉鄙合符，疑之。得選兵八萬人，進兵擊秦軍。',
    verified: true, kind: 'primary', note: '2026-10-11 已读原典转录；分段短引，未与影印底本校勘。《战国策》另作荡阴，两说保留。',
  },
  'shiji-wei-halt': {
    id: 'shiji-wei-halt', title: '《史记·魏公子列传》：止军',
    url: 'https://zh.wikisource.org/wiki/史記/卷077', location: '卷七十七，秦使威胁与魏王止晋鄙段',
    quote: '魏王恐，使人止晉鄙，留軍壁鄴，名為救趙，實持兩端以觀望。',
    verified: true, kind: 'primary', note: '2026-10-11 已读原典转录。此来源只含当时可得的止军消息，不向演员提供未来结局。',
  },
  'shiji-wei-hou': {
    id: 'shiji-wei-hou', title: '《史记·魏公子列传》：侯嬴',
    url: 'https://zh.wikisource.org/wiki/史記/卷077', location: '卷七十七，公子辞侯生、复引车还段',
    quote: '公子勉之矣，老臣不能從。臣固知公子之還也。公子與侯生決，至軍，侯生果北鄉自剄。',
    verified: true, kind: 'primary', note: '2026-10-11 已读卷077夷门与送别段短引；精确日数未给。信任阈值与内心模型属于本作设计。',
  },
  'shiji-wei-ruji': {
    id: 'shiji-wei-ruji', title: '《史记·魏公子列传》：如姬',
    url: 'https://zh.wikisource.org/wiki/史記/卷077', location: '卷七十七，如姬报父仇与窃符段',
    quote: '如姬之欲為公子死，無所辭，顧未有路耳。如姬果盜晉鄙兵符與公子。',
    verified: true, kind: 'primary', note: '2026-10-11 已读原典。前句是侯嬴对如姬的判断，后句是叙述行为；玩家望风与地图为虚构。',
  },
  'shiji-pingyuan': {
    id: 'shiji-pingyuan', title: '《史记·平原君虞卿列传》',
    url: 'https://zh.wikisource.org/wiki/史記/卷076', location: '卷七十六，邯郸急围、李同劝散家财段',
    quote: '邯鄲傳舍吏子李同説平原君曰。邯鄲之民，炊骨易子而食，可謂急矣。於是平原君從之，得敢死之士三千人。',
    verified: true, kind: 'primary', note: '2026-10-11 已读原典。李同为传舍吏之子；粮仓两袋缺额和两位守仓人为本作虚构。',
  },
  'shiji-baiqi': {
    id: 'shiji-baiqi', title: '《史记·白起王翦列传》',
    url: 'https://zh.wikisource.org/wiki/史記/卷073', location: '卷七十三，秦围邯郸与诸侯救赵段',
    quote: '楚使春申君及魏公子將兵數十萬攻秦軍，秦軍多失亡。',
    verified: true, kind: 'primary', note: '2026-10-11 已读原典转录；起止年份、月次与十七个月待校历，不能当精确字幕。',
  },
  'zhanguoce-location': {
    id: 'zhanguoce-location', title: '《战国策·赵策三》荡阴异文', url: 'https://zh.wikisource.org/wiki/戰國策_(士禮居叢書本)/趙/三', location: '赵策三，秦围赵之邯郸段',
    quote: '魏安釐王使將軍晉鄙救趙。畏秦，止於蕩陰，不進。', verified: true, kind: 'primary', note: '2026-10-11 已读原典；保留与《史记》壁邺的差异，未证明两地同一或中途迁营。'
  },
  'world-design': {
    id: 'world-design', title: '数字世界 v3 与第一版设定', url: '', location: '设计稿第 16、17、19 节',
    quote: '同样的输入换一个人，信息停在不同的层；动作结果必须留下来源。',
    verified: true, kind: 'design', note: '创作设定和有限状态心智的规则，非神经科学或史实结论。',
  },
  'granary-ledger': {
    id: 'granary-ledger', title: '本作仓簿：封仓时的合计', url: '', location: '第零日，仓簿首页与交接副页',
    quote: '首页记有二袋未归，副页注明二袋已交付守城人；首页未扣交接数。',
    verified: true, kind: 'ledger', note: '本作道具证据。可据此解释“欠粮”共识出自重复计数；不是原典内容。',
  },
};

export const sourceEvidence = (id: string, confidence?: number): Evidence => {
  const source = SOURCES[id];
  if (!source) throw new Error(`Unknown source: ${id}`);
  return { sourceId: id, quote: source.quote, location: source.location, confidence: confidence ?? (source.verified ? 0.9 : 0.72) };
};

const appearance = (id: string, color: string, silhouette: string, voice: string): Entity['appearance'] => ({
  assetId: `character-${id}-v1`, color, silhouette, voice,
});

export const CHARACTERS: Entity[] = [
  {
    id: 'player', kind: 'person', name: '新来的门客', location: 'daliang', role: 'actor',
    description: '本作虚构的信陵君门客。你只决定意图，门客仍以亲历和听闻理解事情。',
    temperament: { suspicion: 0.45, patience: 0.62, compassion: 0.75, duty: 0.7, courage: 0.62 },
    skills: ['递话', '识印', '望风'], goals: ['让邯郸的人活过这一夜', '理解眼前的人'],
    appearance: appearance('player', '#91a4ab', 'short-cloak', '轻而迟疑'),
  },
  {
    id: 'xinling', kind: 'person', name: '信陵君', location: 'daliang', role: 'actor',
    description: '魏无忌。求救之路屡被拒绝，牵挂邯郸中的亲人与百姓。',
    temperament: { suspicion: 0.38, patience: 0.8, compassion: 0.94, duty: 0.82, courage: 0.91 },
    skills: ['礼士', '劝说', '领军'], goals: ['救赵', '不负门客'],
    appearance: appearance('xinling', '#d8bd7b', 'noble', '温和而克制'),
  },
  {
    id: 'houying', kind: 'person', name: '侯嬴', location: 'yimen', role: 'actor',
    description: '夷门监者。用沉默试探信陵君是否只是在做表面功夫。',
    temperament: { suspicion: 0.83, patience: 0.94, compassion: 0.7, duty: 0.81, courage: 0.88 },
    skills: ['察人', '谋划'], goals: ['判断来人是否值得托付', '报知遇之恩'],
    appearance: appearance('houying', '#9c9583', 'elder', '低而缓慢'),
  },
  {
    id: 'ruji', kind: 'person', name: '如姬', location: 'palace', role: 'actor',
    description: '因信陵君曾助报父仇而愿意相助；寝宫中的半符是她承担的风险。',
    temperament: { suspicion: 0.56, patience: 0.76, compassion: 0.84, duty: 0.66, courage: 0.91 },
    skills: ['宫中通路', '取符'], goals: ['报答信陵君', '护住同行之人'],
    appearance: appearance('ruji', '#749f91', 'court-robe', '低声而坚定'),
  },
  {
    id: 'zhuhai', kind: 'person', name: '朱亥', location: 'yimen', role: 'actor',
    description: '屠者，有勇力；接受侯嬴的托付，但行动代价仍落在具体的人身上。',
    temperament: { suspicion: 0.32, patience: 0.24, compassion: 0.54, duty: 0.83, courage: 0.97 },
    skills: ['力搏', '护送'], goals: ['护送公子', '不负侯生'],
    appearance: appearance('zhuhai', '#95664c', 'broad', '短促而沉稳'),
  },
  {
    id: 'jinbi', kind: 'person', name: '晋鄙', location: 'ye', role: 'actor',
    description: '受命领军的将领，合符之后仍要核实谁有权替换统帅。',
    temperament: { suspicion: 0.87, patience: 0.73, compassion: 0.62, duty: 0.96, courage: 0.85 },
    skills: ['统军', '核符'], goals: ['守王命', '不把十万人的命交错'],
    appearance: appearance('jinbi', '#6a7a7a', 'general', '厚重而警惕'),
  },
  {
    id: 'weiking', kind: 'person', name: '魏王', location: 'daliang', role: 'actor',
    description: '畏秦之威，掌握王命与半符。此环节在第一版中结构牢固。',
    temperament: { suspicion: 0.8, patience: 0.42, compassion: 0.35, duty: 0.68, courage: 0.19 },
    skills: ['王命', '权衡诸国'], goals: ['避免秦先攻魏'],
    appearance: appearance('weiking', '#b9a06a', 'crown', '缓而生硬'),
  },
  {
    id: 'pingyuan', kind: 'person', name: '平原君', location: 'handan', role: 'actor',
    description: '赵胜，求援并在危急中散财济城。仓房场景只是本作对城中一角的想象。',
    temperament: { suspicion: 0.51, patience: 0.6, compassion: 0.8, duty: 0.77, courage: 0.78 },
    skills: ['招士', '筹粮'], goals: ['守住邯郸'],
    appearance: appearance('pingyuan', '#b29c74', 'noble', '急切而清晰'),
  },
  {
    id: 'maosui', kind: 'person', name: '毛遂', location: 'handan', role: 'actor',
    description: '平原君门客，自荐随使楚国。',
    temperament: { suspicion: 0.32, patience: 0.38, compassion: 0.68, duty: 0.75, courage: 0.95 },
    skills: ['辩说'], goals: ['求楚救赵'], appearance: appearance('maosui', '#a08970', 'scholar', '快而有力'),
  },
  {
    id: 'lichong', kind: 'person', name: '李同', location: 'handan', role: 'actor',
    description: '原典作李同，劝平原君散家财；稳定编号 lichong 仅是内部编号。',
    temperament: { suspicion: 0.44, patience: 0.28, compassion: 0.87, duty: 0.83, courage: 0.92 },
    skills: ['动员'], goals: ['让守城者有粮'], appearance: appearance('lichong', '#8d7966', 'short-cloak', '直截了当'),
  },
  {
    id: 'keeper-suspicious', kind: 'person', name: '审印的守仓人', location: 'granary', role: 'actor',
    description: '本作虚构。多疑且有耐性，先确认凭证，再决定把粮交给谁。',
    temperament: { suspicion: 0.94, patience: 0.91, compassion: 0.62, duty: 0.94, courage: 0.45 },
    skills: ['识印', '记账'], goals: ['粮不能交错', '缺额要有来由'], appearance: appearance('keeper-suspicious', '#749f91', 'keeper', '慢而谨慎'),
  },
  {
    id: 'keeper-impatient', kind: 'person', name: '追人的守仓人', location: 'granary', role: 'actor',
    description: '本作虚构。耐性低，欠额出现时先去找借粮者，把事情推到面前。',
    temperament: { suspicion: 0.2, patience: 0.1, compassion: 0.65, duty: 0.8, courage: 0.82 },
    skills: ['搬运', '追问'], goals: ['马上弄清欠额', '别让队伍一直等'], appearance: appearance('keeper-impatient', '#bd8b62', 'keeper', '急而短促'),
  },
  {
    id: 'borrower', kind: 'person', name: '借粮者', location: 'granary', role: 'actor',
    description: '本作虚构。认为粮已送到守城者手中，不承认自己欠了仓中两袋。',
    temperament: { suspicion: 0.44, patience: 0.32, compassion: 0.88, duty: 0.72, courage: 0.66 },
    skills: ['运粮', '说情'], goals: ['带粮回城', '解释旧账'], appearance: appearance('borrower', '#9f8c74', 'carrier', '圆缓而心急'),
  },
  {
    id: 'director', kind: 'person', name: '沈砚', location: 'studio', role: 'director',
    description: '在片场安排视角与交互，理由是其当时的主张。',
    temperament: { suspicion: 0.54, patience: 0.77, compassion: 0.82, duty: 0.8, courage: 0.7 },
    skills: ['选角', '分镜', '交互授予'], goals: ['让人看懂代价', '让已发生的事被看见'], appearance: appearance('director', '#749f91', 'scholar', '清晰而有留白'),
  },
  {
    id: 'director-lu', kind: 'person', name: '陆微', location: 'studio', role: 'director',
    description: '负责《围城》与《取符之夜》，把目光留在递粮、遮挡和等待这些具体行动上。',
    temperament: { suspicion: 0.7, patience: 0.59, compassion: 0.88, duty: 0.86, courage: 0.8 },
    skills: ['观察', '排场', '动作授予'], goals: ['让小事改变后来', '给同一件事留下别的目光'], appearance: appearance('director-lu', '#bd8b62', 'scholar', '短句而敏锐'),
  },
  {
    id: 'mentor', kind: 'person', name: '导师·衡', location: 'studio', role: 'mentor',
    description: '按你的偏好与实际调用账分配细节，不把省略冒充丰富。',
    temperament: { suspicion: 0.57, patience: 0.88, compassion: 0.8, duty: 0.97, courage: 0.52 },
    skills: ['分配', '记偏好'], goals: ['让这一场完整演完', '把你的更正记住'], appearance: appearance('mentor', '#91a4ab', 'elder', '平稳而直接'),
  },
  { id: 'zhao-envoy', kind: 'person', name: '赵使', location: 'daliang', role: 'actor', description: '带来邯郸求救的消息。', temperament: { suspicion: 0.5, patience: 0.3, compassion: 0.85, duty: 0.92, courage: 0.72 }, skills: ['使节'], goals: ['请魏救赵'] },
  { id: 'qin-envoy', kind: 'person', name: '秦使', location: 'daliang', role: 'actor', description: '传达救赵者将先受秦兵的威胁。', temperament: { suspicion: 0.61, patience: 0.5, compassion: 0.2, duty: 0.87, courage: 0.75 }, skills: ['传令'], goals: ['令魏止步'] },
  { id: 'palace-guard', kind: 'person', name: '宫门守卫', location: 'palace', role: 'actor', description: '本作虚构，巡查夜里的宫门。', temperament: { suspicion: 0.76, patience: 0.61, compassion: 0.5, duty: 0.91, courage: 0.74 }, skills: ['巡夜'], goals: ['守住宫门'] },
  { id: 'soldier', kind: 'person', name: '魏军士卒', location: 'ye', role: 'actor', description: '本作虚构，等待可信的调军命令。', temperament: { suspicion: 0.5, patience: 0.55, compassion: 0.62, duty: 0.85, courage: 0.73 }, skills: ['军阵'], goals: ['随可信的统帅行动'] },
  { id: 'citizen', kind: 'person', name: '邯郸城民', location: 'handan', role: 'actor', description: '本作虚构，等待城中分粮。', temperament: { suspicion: 0.6, patience: 0.25, compassion: 0.82, duty: 0.64, courage: 0.52 }, skills: ['守望'], goals: ['家人活过围城'] },
];

export const PLACES: Entity[] = [
  { id: 'daliang', kind: 'place', name: '大梁', description: '魏都；本作中劝王的一场。', location: 'daliang' },
  { id: 'yimen', kind: 'place', name: '夷门', description: '大梁东门，侯嬴监门之处。', location: 'daliang' },
  { id: 'palace', kind: 'place', name: '魏宫', description: '取符之夜的本作场景。', location: 'daliang' },
  { id: 'ye', kind: 'place', name: '邺', description: '《魏公子列传》所载晋鄙驻军地；具体地理复原待审定。', location: 'ye' },
  { id: 'handan', kind: 'place', name: '邯郸', description: '赵都，诸侯救援所向。', location: 'handan' },
  { id: 'granary', kind: 'place', name: '围城粮仓', description: '本作虚构的城内仓房。', location: 'handan' },
  { id: 'studio', kind: 'place', name: '片场', description: '设计记录和导师笔记的呈现。', location: 'studio' },
];

export const ITEMS: Entity[] = [
  { id: 'seal', kind: 'item', name: '印信', description: '印信装置；取符场景对应半符，仓房以印纹核验交接。', location: 'palace' },
  { id: 'letter', kind: 'item', name: '借条', description: '本作仓房的交接凭证。', location: 'granary' },
  { id: 'pledge', kind: 'item', name: '担保物', description: '本作虚构的担保凭证，背后是人的认可。', location: 'granary' },
  { id: 'grain', kind: 'item', name: '粮袋', description: '粮食资源的装置，不凭显示复制资源。', location: 'granary' },
  { id: 'hammer', kind: 'item', name: '铁椎', description: '朱亥所携器物；原典有此记载，形制待人审定。', location: 'yimen' },
  { id: 'bamboo', kind: 'item', name: '竹简', description: '递给对方的一句话与消息。', location: 'daliang' },
  { id: 'wine', kind: 'item', name: '酒', description: '本作设计的礼物，用于表示愿意停下来听。', location: 'daliang' },
];

export const ORGANIZATIONS: Entity[] = [
  { id: 'wei', kind: 'organization', name: '魏', description: '掌有援赵之军。', location: 'daliang' },
  { id: 'zhao', kind: 'organization', name: '赵', description: '邯郸守城一方。', location: 'handan' },
  { id: 'qin', kind: 'organization', name: '秦', description: '围攻邯郸的一方。', location: 'handan' },
  { id: 'chu', kind: 'organization', name: '楚', description: '诸侯援赵的一方。', location: 'handan' },
];

export interface WorkRecord { id: WorkId; title: string; kind: 'film' | 'game' | 'studio'; duration: string; director: string; description: string; interaction: number }
export function directorFor(workId: WorkId): string { return workId === 'siege' || workId === 'night' ? 'director-lu' : 'director'; }
export const WORKS: WorkRecord[] = [
  { id: 'prologue', title: '长平之后', kind: 'film', duration: '约 1 分钟', director: 'director', description: '诸侯的命令停在城外，城中的粮一天比一天少。', interaction: 0 },
  { id: 'qiefu', title: '窃符', kind: 'game', duration: '约 10 分钟', director: 'director', description: '从大梁到邺，你认识的人承担你选择的代价。', interaction: 2 },
  { id: 'siege', title: '围城', kind: 'game', duration: '约 3 分钟', director: 'director-lu', description: '同样两袋粮，谁欠了谁？换一个守仓人再看。', interaction: 3 },
  { id: 'night', title: '取符之夜', kind: 'game', duration: '约 2 分钟', director: 'director-lu', description: '如姬取符，你负责望风与护送；被发现也进入这段历史。', interaction: 2 },
  { id: 'studio', title: '片场', kind: 'studio', duration: '随时', director: 'director', description: '读当时记下的决定，安排下一场的守仓人。', interaction: 1 },
  { id: 'replay', title: '再看一次', kind: 'film', duration: '来自亲历', director: 'director', description: '从另一位持有者的视角，看你已经做过的事。', interaction: 0 },
];
