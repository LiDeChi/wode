import { createSession } from '../../shared/engine/session.js';
import { decode, directorInput, STORAGE_KEY } from './format.js';

let last = null;
try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) last = decode(raw); }
catch { /* A damaged or unavailable local recording must not hide the programme. */ }
document.getElementById('last-film').hidden = !last;

try {
  const session = createSession();
  const { answers, need } = directorInput(last?.director || 'B');
  session.meet(answers, need);
  const notes = session.mentor.notes();
  const wait = session.ledger.entries.find(e => e.kind === 'mentor.note' && e.payload.field === 'wait');
  document.getElementById('mentor-line').textContent = `${wait.said} 录好的现在就能看，其余作品备好再排。`;
  document.getElementById('mentor-source').textContent = last ? '按上一局开场的口味，重读导师笔记' : '先按不让你等的口味排片；玩过后跟着你调整';
  if (new URLSearchParams(location.search).get('dev') === '1') {
    const detail = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = '导师笔记（调试）';
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify(notes, null, 2);
    detail.append(summary, pre); document.querySelector('main').append(detail);
  }
} catch {
  document.getElementById('mentor-line').textContent = '先把能玩的、录好的排在眼前，其余作品备好再来。';
  document.getElementById('mentor-source').textContent = '临时排片说明；导师笔记尚未读取';
}
