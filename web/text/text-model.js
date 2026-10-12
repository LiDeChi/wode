// 只读语义模型。不读世界、时钟、存档，不执行 HTML 或 Markdown。
const text = (value) => value == null ? '' : String(value);
const copyRef = (r = {}) => Object.freeze({
  scope: text(r.scope), recordId: text(r.recordId), seq: r.seq ?? null,
  captureId: text(r.captureId), revision: text(r.revision), field: text(r.field), label: text(r.label),
});
export function normalizeBlocks(blocks = [], inheritedRefs = []) {
  return Object.freeze(blocks.map((b, i) => Object.freeze({
    id: text(b.id || `block-${i}`),
    type: ['paragraph', 'quote', 'heading', 'list'].includes(b.type) ? b.type : 'paragraph',
    text: text(b.text), speaker: text(b.speaker), level: b.level === 2 ? 2 : 1,
    items: Object.freeze((b.items || []).map(text)),
    refs: Object.freeze((b.refs || inheritedRefs).map(copyRef)),
  })));
}
export function entryKey(scope, entry) { return JSON.stringify([scope, entry.subjectId, entry.id]); }
export function createTextModel({ scope, revision, capturedAt = '', entries = [], locale = 'zh-CN' }) {
  if (!scope || revision == null) throw new TypeError('文本模型需要 scope 与 revision');
  const ids = new Set();
  return Object.freeze({ scope: text(scope), revision: text(revision), capturedAt: text(capturedAt), locale,
    entries: Object.freeze(entries.map((e) => {
      if (!e.id || ids.has(e.id)) throw new TypeError('条目 id 必须唯一且非空');
      ids.add(e.id);
      const refs = Object.freeze((e.refs || []).map((r) => copyRef({scope, revision, ...r})));
      return Object.freeze({ id: text(e.id), subjectId: text(e.subjectId || e.id), title: text(e.title),
        short: text(e.short), summary: text(e.summary), refs,
        availability: ['complete', 'partial', 'missing'].includes(e.availability) ? e.availability : 'missing',
        blocks: normalizeBlocks(e.blocks, refs),
      });
    })),
  });
}
