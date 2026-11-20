import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCountdown } from './useCountdown'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCountdown（D27）', () => {
  it('从 Retry-After 的秒数开始倒数，到 0 后恢复可用', () => {
    const c = useCountdown()
    c.start(3)
    expect(c.remaining.value).toBe(3)
    expect(c.active.value).toBe(true)

    vi.advanceTimersByTime(2000)
    expect(c.remaining.value).toBe(1)

    vi.advanceTimersByTime(1000)
    expect(c.remaining.value).toBe(0)
    expect(c.active.value).toBe(false)
  })

  it('按截止时间算剩余：定时器被浏览器放慢（后台标签页）也不会多等', () => {
    const c = useCountdown()
    c.start(60)
    // 模拟定时器 40 秒没有执行：只把时钟往前拨，不触发定时器
    vi.setSystemTime(Date.now() + 40_000)
    vi.advanceTimersToNextTimer()
    expect(c.remaining.value).toBe(19)
  })
})
