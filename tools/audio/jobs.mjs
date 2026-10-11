import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AudioError, readJSON, writeJSON, assertNoSecrets } from './errors.mjs';
const NEXT = {queued:['running','cancelled'],running:['succeeded','failed','cancelled'],succeeded:[],failed:[],cancelled:[]};
export class AudioJobManager {
  constructor(home, now = Date.now) { this.file = path.join(home,'jobs.json'); this.now = now; }
  create(fields) { assertNoSecrets(fields); const jobs = readJSON(this.file,{}); const id = randomUUID(); jobs[id] = {job_id:id,status:'queued',attempts:0,createdAt:new Date(this.now()).toISOString(),...fields}; writeJSON(this.file,jobs); return jobs[id]; }
  get(id) { return readJSON(this.file,{})[id] || null; }
  update(id, patch) {
    assertNoSecrets(patch); const jobs = readJSON(this.file,{}), job = jobs[id];
    if (!job) throw new AudioError('config','找不到音频任务','用 job_id 查询现有任务');
    if (patch.status && patch.status !== job.status && !NEXT[job.status].includes(patch.status)) throw new AudioError('config','任务状态转换无效','查询当前任务状态');
    Object.assign(job,patch,{updatedAt:new Date(this.now()).toISOString()}); writeJSON(this.file,jobs); return job;
  }
}
