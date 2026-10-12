import path from 'node:path';
import { AudioError, readJSON, writeJSON } from './errors.mjs';
export class AudioBudgetManager {
  constructor(home, { perCall = 1, daily = 5, monthly = 20, unknownPriceCeiling = null } = {}, now = Date.now) {
    this.file = path.join(home,'usage.json'); this.now = now; this.limits = {perCall,daily,monthly}; this.unknownPriceCeiling = unknownPriceCeiling;
    for (const n of Object.values(this.limits)) if (!Number.isFinite(n) || n < 0) throw new AudioError('config','预算必须是非负美元数值','检查 budget.perCall/daily/monthly');
  }
  rows() { return readJSON(this.file,[]); }
  amount(row) { return row.state === 'released' ? 0 : row.actual ?? row.reserved; }
  get_usage() {
    const entries = this.rows(), today = new Date(this.now()).toISOString().slice(0,10), month = today.slice(0,7);
    const sum = filter => entries.filter(filter).reduce((n,r) => n + this.amount(r),0);
    return {currency:'USD', daily:sum(r=>r.at.startsWith(today)), monthly:sum(r=>r.at.startsWith(month)), total:sum(()=>true), limits:this.limits, entries};
  }
  check(amount) {
    if (!Number.isFinite(amount) || amount < 0) throw new AudioError('price_unknown','没有可靠的价格或预留上限','配置 priceOverride 或 unknownPriceCeiling 并明确授权');
    const u = this.get_usage();
    if (amount > this.limits.perCall || amount + u.daily > this.limits.daily || amount + u.monthly > this.limits.monthly) throw new AudioError('budget','音频调用超过预算，已停止','提高预算或选择本地服务；不会执行或重试');
    return amount;
  }
  async authorize(estimate, hook) {
    const unknown = estimate.estimated === null || estimate.estimated === undefined;
    if (!unknown && (!Number.isFinite(estimate.estimated) || estimate.estimated < 0)) throw new AudioError('config','Provider 价格无效','提供非负 estimated 或 null');
    if (estimate.currency && estimate.currency !== 'USD') throw new AudioError('config','当前预算只支持美元','配置美元计价');
    if (unknown && !hook) throw new AudioError('price_unknown','价格未知，需要明确确认','配置可靠 priceOverride 或 authorize 钩子');
    const amount = this.check(unknown ? this.unknownPriceCeiling : estimate.estimated);
    if (hook && !(await hook({...estimate,reserved:amount}))) throw new AudioError('auth','用户没有授权本次调用','确认估算后再次调用');
    return {amount, source:hook ? 'authorize-hook' : 'known-price-within-budget'};
  }
  reserve(job_id, amount, estimate, authorization) {
    this.check(amount); const rows = this.rows(); rows.push({job_id,at:new Date(this.now()).toISOString(),estimated:estimate.estimated ?? null,reserved:amount,actual:null,currency:'USD',priceSource:estimate.priceSource || 'unknown',authorization,state:'reserved'}); writeJSON(this.file,rows);
  }
  settle(job_id, actual, { release = false } = {}) {
    const rows = this.rows(), row = rows.find(r=>r.job_id===job_id); if (!row) return;
    if (actual !== null && actual !== undefined && (!Number.isFinite(actual) || actual < 0)) throw new AudioError('provider','Provider 实际费用无效','检查返回的美元费用');
    row.actual = actual ?? null; row.state = release ? 'released' : 'settled'; writeJSON(this.file,rows);
  }
}
