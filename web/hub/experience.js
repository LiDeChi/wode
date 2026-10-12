// 原账投影：看纸、油壶与手稿不调用 meet/watch/ask/learn。
const copy = value => JSON.parse(JSON.stringify(value));
const fields = { wait: '等候', polish: '雕琢', depth: '人心', surprise: '意外', emotion: '心愿', need: '原话', pause: '停留' };
export function experienceOf(session) {
  const entries = session.ledger.entries;
  const mentor = session.mentor.state();
  const id = session.state.directorId;
  const notes = Object.entries(mentor.notes ?? {}).map(([field, note]) => {
    const entry = entries.find(e => e.seq === note.seq);
    // 手改过的那页读你留下的字；底下仍挂着那一次见面的 seq（为什么会有这页）。
    const edited = note.source === '你改的';
    const text = edited ? String(note.value ?? '') : (entry?.said ?? (typeof note.value === 'string' ? note.value : '这页还在，等下一次真正了解再添墨。'));
    return { field, label: fields[field] ?? field, ...copy(note), edited, text, entry: entry ? copy(entry) : null, path: `mentor.notes.${field}` };
  });
  const pages = entries.filter(e => ['mentor.note', 'mentor.learn'].includes(e.kind));
  const learns = entries.filter(e => e.kind === 'director.learn' && e.from === `director:${id}`);
  const decisions = entries.filter(e => e.kind === 'director.life-design' && e.from === `director:${id}`);
  return { notes, pages: copy(pages), oil: { chosen: copy(mentor.chosen ?? {}), spent: mentor.spent, budget: mentor.budget, seq: mentor.allotSeq, path: 'mentor.chosen / spent / budget' },
    director: { id, learns: copy(learns), decisions: copy(decisions), predictions: copy(session.state.predictions ?? {}), path: `directors.${id}` } };
}
