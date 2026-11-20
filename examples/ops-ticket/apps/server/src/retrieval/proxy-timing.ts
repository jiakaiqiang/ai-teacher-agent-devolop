// 只比较完整 SSE 帧到达的相对时间；块数量不等于事件数量。
export function assessProxy(firstMs: number, totalMs: number, frames: number) {
  if (![firstMs,totalMs].every(Number.isFinite) || firstMs<0 || firstMs>totalMs) throw Error('BAD_CLOCK');
  if (frames!==6) throw Error('INCOMPLETE_STREAM');
  if (firstMs>=1500) throw Error('BUFFERED_FIRST_EVENT');
  if (totalMs<3000) throw Error('EARLY_END');
  return { firstMs,totalMs,frames };
}
