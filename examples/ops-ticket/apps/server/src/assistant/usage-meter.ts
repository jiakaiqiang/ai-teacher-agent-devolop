// 教学额度单位：输入token=1单位，输出token=2单位；不是供应商人民币价格。
export const RESERVATION_UNITS = 50000;
export const DAILY_UNITS = 200000;
export interface UsageSummary { inputTokens: number; outputTokens: number; exact: boolean; attempts: number; }
export function parseUsage(raw: unknown): { inputTokens: number; outputTokens: number } | null {
  const usage = (raw as {usage?:{prompt_tokens?:unknown;completion_tokens?:unknown;total_tokens?:unknown}} | null)?.usage;
  if(!usage) return null;
  const values=[usage.prompt_tokens,usage.completion_tokens,usage.total_tokens];
  if(values.some(v=>typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>1000000)) return null;
  const input=usage.prompt_tokens as number, output=usage.completion_tokens as number;
  if(input+output!==usage.total_tokens) return null;
  return {inputTokens:input,outputTokens:output};
}
export class UsageMeter {
  private attempts=0;private received=0;private inputTokens=0;private outputTokens=0;
  start(){this.attempts++;}
  record(raw:unknown){const u=parseUsage(raw);if(u){this.received++;this.inputTokens+=u.inputTokens;this.outputTokens+=u.outputTokens;}}
  summary():UsageSummary{return {inputTokens:this.inputTokens,outputTokens:this.outputTokens,exact:this.attempts===this.received,attempts:this.attempts};}
}
export function usageCharge(summary:UsageSummary) {
  if(!Number.isSafeInteger(summary.attempts)||summary.attempts<0||summary.attempts>4||!Number.isSafeInteger(summary.inputTokens)||!Number.isSafeInteger(summary.outputTokens)||summary.inputTokens<0||summary.outputTokens<0||summary.inputTokens>4000000||summary.outputTokens>4000000)throw new Error('USAGE_INVALID');
  const known=summary.inputTokens+summary.outputTokens*2;
  return summary.exact ? known : Math.max(RESERVATION_UNITS,known);
}
