import {describe,expect,it,vi} from 'vitest'
import {createSSRApp,h,ref} from 'vue'
import {renderToString} from 'vue/server-renderer'
import {createGeneration} from '../assistant/generation'
import {startMetrics} from '../assistant/metrics'
const fixture=vi.hoisted(()=>({value:undefined as unknown}))
vi.mock('../composables/useConversation',()=>({useConversation:()=>fixture.value}))
import ConversationPanel from './ConversationPanel.vue'
async function render(mode:'mock'|'model',question='模拟问题') {
  const run=createGeneration('r','m');Object.assign(run,{mode,status:'completed',text:'**建议**\n\n<script>attack()</script>'})
  const turn={id:'m',parentId:null,question,run,metrics:startMetrics(0)}
  fixture.value={turns:ref([turn]),path:ref([turn]),activeLeaf:ref('m'),busy:ref(false),error:ref(''),send:vi.fn(),fork:vi.fn(),select:vi.fn(),stop:vi.fn()}
  return renderToString(createSSRApp(()=>h(ConversationPanel,{ticketNo:'T1'})))
}
describe('会话界面集成（D55）',()=>{
  it('模拟输出标签不能丢失',async()=>{expect(await render('mock')).toContain('模拟输出')})
  it('模型模式不冒充模拟输出',async()=>{const html=await render('model');expect(html).toContain('模型输出');expect(html).not.toContain('模拟输出')})
  it('问题和答案中的HTML保持文本',async()=>{const html=await render('mock','<img src=x onerror=attack()>');expect(html).not.toMatch(/<(img|script)\b/);expect(html).toContain('&lt;script&gt;');expect(html).toContain('<strong>建议</strong>')})
  it('明确当前问题与本页历史边界',async()=>{const html=await render('mock');expect(html).toContain('每次仅发送当前问题');expect(html).toContain('刷新或离开后不保留');expect(html).toContain('字符/秒')})
  it('输入分支与列表有可访问名称',async()=>{const html=await render('mock');expect(html).toContain('for="conversation-question"');expect(html).toContain('aria-label="会话消息"');expect(html).toContain('显示全部消息');expect(html).toContain('重新生成第1轮')})
})
