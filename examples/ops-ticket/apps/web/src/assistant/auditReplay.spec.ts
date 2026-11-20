import {appendFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
import {auditReplay,type TimedEvent} from './auditReplay'
const event=(seq:number,body:object)=>({version:1,runId:'r',messageId:'m',seq,...body})
const rows=():TimedEvent[]=>[
  {at:10,event:event(1,{type:'start',mode:'mock'})},
  {at:100,event:event(2,{type:'text',text:'中😀文'})},
  {at:200,event:event(3,{type:'finish',reason:'stop'})},
]
const replay=(records:TimedEvent[])=>auditReplay('r','m',0,records)
const report=(data:object)=>{if(process.env.D56_EVIDENCE_FILE)appendFileSync(process.env.D56_EVIDENCE_FILE,JSON.stringify(data)+'\n')}
describe('周日事件回放审计（D56）',()=>{
  it('正常回放同时核对文本终态和指标',()=>{
    const result=replay(rows());expect(result.run.text).toBe('中😀文');expect(result.run.status).toBe('completed');expect(result.metrics).toMatchObject({ttftMs:100,durationMs:200,chars:3,charsPerSecond:30});
    report({case:'replay-audit',counts:result.counts,metrics:result.metrics,status:result.run.status})
  })
  it('重复文本不能重复计量',()=>{
    const input=rows();input.splice(2,0,{...input[1]!,at:150});const result=replay(input)
    expect(result.run.text).toBe('中😀文');expect(result.metrics.chars).toBe(3);expect(result.counts.duplicate).toBe(1)
    report({case:'replay-duplicate',text:result.run.text,chars:result.metrics.chars,duplicates:result.counts.duplicate})
  })
  it('旧身份事件不改变内容或指标',()=>{
    const input=rows();input.splice(2,0,{at:120,event:{...event(3,{type:'text',text:'迟到'}),runId:'old'}});const result=replay(input);expect(result.counts.stale).toBe(1);expect(result.metrics.chars).toBe(3)
  })
  it('同序号不同内容被拒绝',()=>{const input=rows();input.splice(2,0,{at:150,event:event(2,{type:'text',text:'冲突'})});expect(()=>replay(input)).toThrow('EVENT_CONFLICT')})
  it('序号跳跃被拒绝',()=>{const input=rows();input[1]!.event=event(4,{type:'text',text:'跳跃'});expect(()=>replay(input)).toThrow('EVENT_SEQUENCE')})
  it('倒退或非有限时钟被拒绝',()=>{for(const at of [9,NaN,Infinity]){const input=rows();input[1]!.at=at;expect(()=>replay(input)).toThrow('REPLAY_CLOCK')}})
  it('缺少终止保留正文并标记中断',()=>{const result=replay(rows().slice(0,2));expect(result.run.status).toBe('interrupted');expect(result.metrics.outcome).toBe('interrupted');expect(result.run.text).toBe('中😀文')})
  it('空回放是失败而不是完成',()=>{expect(replay([]).run.status).toBe('error')})
  it('截断单独保留',()=>{const input=rows();input[2]!.event=event(3,{type:'finish',reason:'length'});expect(replay(input).metrics.outcome).toBe('truncated')})
  it('终态后迟到文本不延长结束时间',()=>{const input=rows();input.push({at:1000,event:event(4,{type:'text',text:'迟到'})});const result=replay(input);expect(result.metrics.durationMs).toBe(200);expect(result.metrics.chars).toBe(3);expect(result.counts.terminal).toBe(1)})
  it('事件预算与开始时间有界',()=>{expect(()=>replay(Array.from({length:8193},()=>rows()[0]!))).toThrow('REPLAY_BUDGET');expect(()=>auditReplay('r','m',-1,[])).toThrow('REPLAY_BUDGET')})
  it('重复运行确定且不修改输入',()=>{const input=rows();const before=JSON.stringify(input);expect(replay(input)).toEqual(replay(input));expect(JSON.stringify(input)).toBe(before)})
})
