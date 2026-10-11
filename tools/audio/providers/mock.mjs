import { createHash } from 'node:crypto';
import { AudioError } from '../errors.mjs';
export class MockProvider {
  constructor({id = 'mock', price = 0, failures = [], delay = 0, actual, available = true} = {}) { Object.assign(this,{id,local:id==='mock',price,failures:[...failures],delay,actual,enabled:available,calls:0}); }
  async capabilities() { return ['speech','music','sfx','clone'].map(capability=>({capability,model:`${this.id}/${capability}`,quality:'mock',license:'test-only'})); }
  async available() { return {ok:this.enabled,action:'启用 MockProvider'}; }
  async estimate() { return {estimated:this.price,currency:'USD',priceSource:this.price === null ? 'unknown' : 'mock-config'}; }
  async run(req) {
    this.calls++;
    if (this.delay) await new Promise(resolve=>setTimeout(resolve,this.delay));
    const fail = this.failures.shift();
    if (fail) { const code = typeof fail === 'string' ? fail : fail.code; throw new AudioError(code,'模拟服务失败','检查 mock failures 配置', typeof fail === 'string' ? ['network','rate_limit'].includes(code) : Boolean(fail.retryable)); }
    const actual = this.actual === undefined ? this.price : this.actual;
    if (req.capability === 'clone') return {voice_id:`mock-${createHash('sha256').update(req.name).digest('hex').slice(0,12)}`,actual,quality:'mock',license:'consented-test'};
    const rate = 8000, seconds = 0.25, count = rate*seconds, wav = Buffer.alloc(44+count*2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(rate,24); wav.writeUInt32LE(rate*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(count*2,40);
    const frequency = 180+createHash('sha256').update(req.text || req.prompt || req.capability).digest()[0];
    for (let i=0;i<count;i++) wav.writeInt16LE(Math.round(3000*Math.sin(i*2*Math.PI*frequency/rate)),44+i*2);
    return {buffer:wav,format:'wav',seconds,actual,quality:'mock',license:'test-only'};
  }
}
export default MockProvider;
