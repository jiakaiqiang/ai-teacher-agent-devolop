// 只限制等待时间，不声称取消底层 I/O；驱动仍须配置自己的超时。
export async function boundedProbe(work: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PROBE_TIMEOUT')), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
