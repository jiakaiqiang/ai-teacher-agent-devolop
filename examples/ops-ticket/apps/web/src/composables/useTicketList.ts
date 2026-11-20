import type { TicketListItem } from '@ops-ticket/shared'
import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { ApiError } from '../api/http'
import { listTickets } from '../api/tickets'

// 工单列表的游标分页状态：切换筛选条件时清空重来，触底时加载下一页
export function useTicketList(company: Ref<string | undefined>, pageSize = 20) {
  const items = shallowRef<TicketListItem[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const started = ref(false)

  // 还没加载过，或者上一页给出了游标，才有下一页
  const hasMore = computed(() => !started.value || nextCursor.value !== null)

  let controller: AbortController | null = null

  async function loadMore() {
    // 正在加载或已经到底时不重复请求
    if (loading.value || !hasMore.value) return
    loading.value = true
    error.value = null
    controller = new AbortController()
    const signal = controller.signal
    try {
      const page = await listTickets(
        { company: company.value, cursor: nextCursor.value, limit: pageSize },
        signal,
      )
      if (signal.aborted) return
      items.value = [...items.value, ...page.items]
      nextCursor.value = page.nextCursor
      started.value = true
    } catch (e) {
      // 被 reset 取消的请求不算错误
      if (signal.aborted) return
      error.value = e instanceof ApiError ? e.message : '网络异常，请稍后重试'
    } finally {
      if (!signal.aborted) loading.value = false
    }
  }

  // 筛选条件变了：取消进行中的请求，清空列表和游标，从第一页开始（游标不能跨筛选条件使用）
  function reset() {
    controller?.abort()
    controller = null
    items.value = []
    nextCursor.value = null
    started.value = false
    loading.value = false
    error.value = null
    void loadMore()
  }

  watch(company, reset)

  const stop = () => controller?.abort()
  return { stop, items, loading, error, hasMore, loadMore, reset }
}
