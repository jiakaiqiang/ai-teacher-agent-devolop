import { describe, it, expect, vi } from 'vitest'
import { useRecommendations } from './useRecommendations'
const citation = { sourceKey: 'manual:demo', title: '手册', version: 'v', quote: '核对口令', start: 0, end: 4, score: 0.7 }
describe('相似案例面板', () => {
  it('新工单忽略旧请求的迟到正文', async () => {
    let finish!: (rows: typeof citation[]) => void
    const first = new Promise<typeof citation[]>(resolve => { finish = resolve })
    const fetcher = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce([])
    const panel = useRecommendations(fetcher)
    const pending = panel.load('A')
    await panel.load('B')
    finish([citation])
    await pending
    expect(panel.items.value).toEqual([])
    expect(panel.state.value).toBe('ready')
  })
  it('依赖异常显式报告失败', async () => {
    const panel = useRecommendations(vi.fn().mockRejectedValue(new Error('不可用')))
    await panel.load('A')
    expect(panel.state.value).toBe('failed')
    expect(panel.items.value).toEqual([])
  })
  it('退出后清空已展示引用', async () => {
    const panel = useRecommendations(vi.fn().mockResolvedValue([citation]))
    await panel.load('A')
    expect(panel.items.value[0]?.title).toBe('手册')
    panel.clear()
    expect(panel.items.value).toEqual([])
    expect(panel.state.value).toBe('idle')
  })
})
