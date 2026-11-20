// 每帧只提交最新完整原文；合批不等于把同步解析移出主线程。
export function createFrameBuffer(commit: (text: string) => void, schedule: (fn: () => void) => number, cancel: (id: number) => void) {
  let pending: number | undefined; let latest = ''; let disposed = false
  function flush() { if (disposed) return; if (pending !== undefined) cancel(pending); pending = undefined; commit(latest) }
  return {
    push(text: string, immediate = false) { if (disposed) return; latest = text; if (immediate) flush(); else if (pending === undefined) pending = schedule(() => { pending = undefined; if (!disposed) commit(latest) }) },
    flush,
    dispose() { disposed = true; if (pending !== undefined) cancel(pending); pending = undefined },
  }
}
