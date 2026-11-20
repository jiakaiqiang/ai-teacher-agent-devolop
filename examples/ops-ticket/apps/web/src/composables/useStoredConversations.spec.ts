import { describe,it,expect,vi } from 'vitest'
import { effectScope,ref } from 'vue'
import type { SessionDetail,ToolSessionEvent } from '@ops-ticket/shared'
import type { streamToolSession } from '../api/toolSessions'
import { useStoredConversations } from './useStoredConversations'
const id = '00000000-0000-4000-8000-000000000001', second = '00000000-0000-4000-8000-000000000002'
const blank = (key = id): SessionDetail => ({ conversation:{id:key,title:'合成会话',version:0,activeTurnId:null,updatedAt:'2026-11-17T00:00:00Z'},turns:[] })
const meta: ToolSessionEvent = { protocol:1,runId:id,seq:1,type:'meta',mode:'mock',replay:false }
function deferred<T>() { let resolve!: (value:T)=>void; const promise = new Promise<T>(r=>{resolve=r}); return {promise,resolve} }
function fixture(stream: typeof streamToolSession = async()=>{}) {
  const scope=effectScope(), token=ref<string|undefined>('fixture-user-a')
  const api={list:vi.fn(async()=>[blank().conversation]),create:vi.fn(async()=>blank().conversation),get:vi.fn(async(key:string)=>blank(key)),stream:vi.fn(stream),key:()=>second}
  const model=scope.run(()=>useStoredConversations(()=>token.value,api))!
  return {scope,token,api,model}
}
describe('持久会话异步归属（D69）',()=>{
  it('创建后加载服务端详情和会话列表',async()=>{
    const f=fixture();try{expect(await f.model.create('新会话')).toBe(true);expect(f.model.detail.value?.conversation.id).toBe(id);expect(f.model.items.value).toHaveLength(1)}finally{f.scope.stop()}
  })
  it('完成后从数据库回读而非只信本地正文',async()=>{
    const f=fixture(async(_id,_input,_token,_signal,receive)=>{receive(meta);receive({protocol:1,runId:id,seq:2,type:'answer',text:'事件正文'});receive({protocol:1,runId:id,seq:3,type:'done',conversationVersion:2,billing:{status:'exact',units:0}})})
    try{await f.model.select(id); f.api.get.mockResolvedValueOnce({...blank(),conversation:{...blank().conversation,version:2}});expect(await f.model.send('问题')).toBe(true);expect(f.model.detail.value?.conversation.version).toBe(2);expect(f.model.live.value).toBeNull();expect(f.model.notice.value).toContain('已保存')}finally{f.scope.stop()}
  })
  it('快速切换会话忽略旧详情迟到',async()=>{
    const f=fixture(),old=deferred<SessionDetail>();f.api.get.mockImplementationOnce(()=>old.promise)
    try{const pending=f.model.select(id);await f.model.select(second);old.resolve(blank(id));await pending;expect(f.model.detail.value?.conversation.id).toBe(second)}finally{f.scope.stop()}
  })
  it('停止保留工具片段且忽略迟到事件',async()=>{
    let receive!: (event:ToolSessionEvent)=>void;const end=deferred<void>()
    const f=fixture(async(_id,_input,_token,_signal,callback)=>{receive=callback;callback(meta);callback({protocol:1,runId:id,seq:2,type:'tool-start',callId:'c',name:'find_ticket',arguments:'{}'});await end.promise})
    try{await f.model.select(id);const pending=f.model.send('查询');f.model.stop();receive({protocol:1,runId:id,seq:3,type:'tool-result',callId:'c',name:'find_ticket',content:'迟到'});expect(f.model.live.value?.tools[0]?.content).toBeNull();expect(f.model.live.value?.status).toBe('stopped');expect(await f.model.send('再来')).toBe(false);end.resolve();await pending;expect(f.model.live.value?.tools).toHaveLength(1)}finally{end.resolve();f.scope.stop()}
  })
  it('身份变化清空列表详情和流状态',async()=>{
    const end=deferred<void>();let signal!:AbortSignal
    const f=fixture(async(_id,_input,_token,current,receive)=>{signal=current;receive(meta);await end.promise})
    try{await f.model.create('会话');const pending=f.model.send('问题');f.token.value='fixture-user-b';expect(signal.aborted).toBe(true);expect(f.model.detail.value).toBeNull();expect(f.model.live.value).toBeNull();expect(f.model.items.value).toEqual([]);end.resolve();await pending;expect(f.model.detail.value).toBeNull()}finally{f.scope.stop()}
  })
  it('卸载取消请求且不接收后续状态',async()=>{
    const end=deferred<void>();let signal!:AbortSignal
    const f=fixture(async(_id,_input,_token,current,receive)=>{signal=current;receive(meta);await end.promise})
    await f.model.select(id);const pending=f.model.send('问题');f.scope.stop();expect(signal.aborted).toBe(true);end.resolve();await pending;expect(f.model.live.value).toBeNull()
  })
  it('同页双击只发一次请求',async()=>{
    const end=deferred<void>(),f=fixture(async()=>{await end.promise})
    try{await f.model.select(id);const pending=f.model.send('一次');expect(await f.model.send('二次')).toBe(false);expect(f.api.stream).toHaveBeenCalledTimes(1);end.resolve();await pending}finally{f.scope.stop()}
  })
  it('网络中断保留片段且刷新不重新发POST',async()=>{
    const f=fixture(async(_id,_input,_token,_signal,receive)=>{receive(meta);receive({protocol:1,runId:id,seq:2,type:'answer',text:'本页片段'});throw new Error('STREAM_INTERRUPTED')})
    try{await f.model.select(id);expect(await f.model.send('问题')).toBe(false);expect(f.model.live.value?.text).toBe('本页片段');expect(f.model.error.value).toContain('不会自动重复执行');await f.model.refresh();expect(f.api.stream).toHaveBeenCalledTimes(1);expect(f.model.live.value).toBeNull()}finally{f.scope.stop()}
  })
  it('服务端仍running时阻止新一轮并保留可刷新状态',async()=>{
    const f=fixture();f.api.get.mockResolvedValueOnce({...blank(),conversation:{...blank().conversation,activeTurnId:second}})
    try{await f.model.select(id);expect(await f.model.send('继续')).toBe(false);expect(f.api.stream).not.toHaveBeenCalled()}finally{f.scope.stop()}
  })
})
