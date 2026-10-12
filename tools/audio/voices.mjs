import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { VOICE_TABLE } from '../../shared/agents/stagecraft.js';
import { AudioError, readJSON, writeJSON, assertNoSecrets } from './errors.mjs';
export class VoiceRegistry {
  constructor(home, now = Date.now) {
    this.file = path.join(home,'voices.json'); this.now = now;
    const data = readJSON(this.file,null);
    if (!data) writeJSON(this.file,{voices:Object.fromEntries(Object.values(VOICE_TABLE).map(v=>[v.id,{id:v.id,tier:v.id,name:v.id,providers:{local:v.say},license:'system voice'}])),speakers:{},tiers:{}});
  }
  data() { return readJSON(this.file,{voices:{},speakers:{},tiers:{}}); }
  list() { return Object.values(this.data().voices); }
  resolve({speaker,voice_id,voice}, provider) {
    const d = this.data(), tier = typeof voice === 'object' ? voice.id : voice;
    const id = voice_id || d.speakers[speaker] || d.tiers[tier] || tier || 'zh-mid-male';
    const row = d.voices[id];
    if (voice_id && !row) throw new AudioError('config','Voice ID 未注册','用 list_voices 选择本地 Voice ID 或先克隆');
    if (voice_id && !row.providers[provider]) throw new AudioError('config','此声线尚未映射到该 Provider','为该声线配置 providers 映射');
    return {voice_id:row?.id || id, provider_voice_id:row?.providers[provider]};
  }
  add(fields) { assertNoSecrets(fields); const d = this.data(), id = fields.id || `voice-${randomUUID()}`; d.voices[id] = {...fields,id,createdAt:new Date(this.now()).toISOString()}; writeJSON(this.file,d); return d.voices[id]; }
  bind({speaker,tier,id}) { const d = this.data(); if (!d.voices[id]) throw new AudioError('config','声线未注册','先添加声线'); if (speaker) d.speakers[speaker] = id; if (tier) d.tiers[tier] = id; writeJSON(this.file,d); }
  remove(id) { const d = this.data(), voice = d.voices[id]; delete d.voices[id]; for (const m of [d.speakers,d.tiers]) for (const k of Object.keys(m)) if (m[k] === id) delete m[k]; writeJSON(this.file,d); return {id,removed:Boolean(voice),action:'还需到各供应商的控制台删除远端 Voice ID 和参考录音',providers:voice?.providers || {}}; }
}
