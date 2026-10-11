const paths: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  sound: '<path d="M3 9h4l5-5v16l-5-5H3zM16 8q5 4 0 8M19 4q9 8 0 16"/>',
  mute: '<path d="M3 9h4l5-5v16l-5-5H3zM16 9l6 6M16 15l6-6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  book: '<path d="M3 4q5-2 9 1 4-3 9-1v15q-5-2-9 1-4-3-9-1zM12 5v15"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
  seal: '<path d="M7 3h10v7H7zM4 10h16v10H4zM9 14h6v3H9z"/>',
  letter: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>',
  pledge: '<path d="m12 3 8 5v8l-8 5-8-5V8zM12 3v18M4 8l8 5 8-5"/>',
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  mind: '<circle cx="12" cy="5" r="2"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/><path d="M12 7v5M6 15v-3h12v3"/>',
  moon: '<path d="M19 15A8 8 0 0 1 9 5a8 8 0 1 0 10 10z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  hammer: '<path d="m9 3 8 6-5 7-8-6zM11 12l-7 9M16 4l4 3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>'
};
export function icon(name: string, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.mind}</svg>`; }
export function escapeHtml(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
