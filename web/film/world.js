// 一个设备只留一份主世界。电影持有自己的快照，永远不经这里写回。
export const WORLD_KEY = 'dw.world';
const copy = value => JSON.parse(JSON.stringify(value));
export function loadWorld(storage = globalThis.localStorage) {
  const raw = storage?.getItem(WORLD_KEY) ?? storage?.getItem('dw.livingWorld');
  if (!raw) return null;
  const value = JSON.parse(raw);
  const saved = value.saved ?? value;
  if (!saved?.ledger || !saved?.minds || !saved?.mentor) throw new Error('这份世界存档不能续接。');
  if (!storage.getItem(WORLD_KEY)) {
    storage.setItem(WORLD_KEY, JSON.stringify(value));
    storage.removeItem('dw.livingWorld');
  }
  // 整封存档一起还回去：saved 续世界，recording/paused 让上一段还能放。
  return copy(value.saved ? value : { v: 1, saved: value });
}
export function saveWorld(value, storage = globalThis.localStorage) {
  const envelope = typeof value.save === 'function' ? { v: 1, saved: value.save() } : value;
  storage.setItem(WORLD_KEY, JSON.stringify(envelope));
  storage.removeItem('dw.livingWorld');
  return copy(envelope);
}
export const CLOCK_POLICY = Object.freeze({ tickSeconds: 1, foregroundOnly: true, pauseStops: true, catchUp: false });
export function createRecording({ session, initial, seed = 'life', director = 'B', living = 'director', record: saved } = {}) {
  const record = saved ? copy(saved) : { v: 2, director: copy(director), initial: copy(initial ?? session.save()), seed, living, clock: { ...CLOCK_POLICY }, steps: [], timeline: [] };
  return {
    record,
    step(op, args = [], metadata = {}) {
      const index = record.steps.length;
      record.steps.push(copy({ op, args, ...metadata })); record.timeline.push({ kind: 'step', index });
    },
    advance({ toTick, inputs = [] }) { record.timeline.push(copy({ kind: 'advance', toTick, inputs })); },
    pause(paused, tick) { record.timeline.push({ kind: 'pause', paused: Boolean(paused), tick }); },
    save() { return copy(record); },
  };
}
