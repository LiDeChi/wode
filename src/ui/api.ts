import type { WorldState } from '../core/types';
export interface ApiResult { state: WorldState; message?: string; error?: string; [key: string]: unknown }
export class WorldApi {
  state!: WorldState;
  async load() {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('剧场暂时没有接通。请重试。');
    const data = await response.json();
    this.state = data.state;
    return data;
  }
  async post(path: string, data: Record<string, unknown> = {}): Promise<ApiResult> {
    const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, baseVersion: this.state.version }) });
    const result = await response.json();
    if (result.state) this.state = result.state;
    if (!response.ok) throw new Error(result.error || result.message || '这一步还未写进世界。');
    return result;
  }
}
