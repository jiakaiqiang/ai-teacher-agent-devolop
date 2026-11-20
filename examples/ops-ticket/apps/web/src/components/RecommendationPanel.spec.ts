import { createSSRApp, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import RecommendationPanel from './RecommendationPanel.vue'
vi.mock('../composables/useRecommendations', () => ({ useRecommendations: () => ({
  state: ref('ready'), items: ref([{ sourceKey:'manual:demo', version:'a'.repeat(64), title:'核对', quote:'<em>待复核</em>', start:0, end:12 }]),
  clear: vi.fn(), load: vi.fn(),
}) }))
describe('引用正文的渲染边界', () => {
  it('标记按文字显示', async () => {
    const app=createSSRApp(RecommendationPanel,{ticketNo:'demo'})
    app.component('RouterLink',{template:'<span />'})
    const html=await renderToString(app)
    expect(html).toContain('&lt;em&gt;待复核&lt;/em&gt;')
    expect(html).not.toContain('<em>待复核</em>')
  })
})
