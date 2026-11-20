import { ref } from 'vue'
import { z } from 'zod'
import { getJson } from '../api/http'

export const citationSchema = z.object({ sourceKey: z.string(), title: z.string(), version: z.string(),
  start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: z.string(), score: z.number() })
type Citation = z.infer<typeof citationSchema>
const fetchSources = (ticketNo: string, signal: AbortSignal) =>
  getJson('/api/tickets/' + encodeURIComponent(ticketNo) + '/recommendations', z.array(citationSchema), signal)

export function useRecommendations(fetcher = fetchSources) {
  const items = ref<Citation[]>([])
  const state = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  let active: AbortController | undefined
  function clear() {
    active?.abort()
    active = undefined
    items.value = []
    state.value = 'idle'
  }
  async function load(ticketNo: string) {
    clear()
    const owner = new AbortController()
    active = owner
    state.value = 'loading'
    try {
      const next = await fetcher(ticketNo, owner.signal)
      if (active !== owner) return
      items.value = next
      state.value = 'ready'
    } catch {
      if (active === owner) state.value = 'failed'
    }
  }
  return { items, state, load, clear }
}
