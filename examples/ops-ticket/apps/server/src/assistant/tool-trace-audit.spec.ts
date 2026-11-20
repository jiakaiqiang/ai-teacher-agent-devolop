import { appendFileSync } from 'node:fs';
import { auditToolTrace } from './tool-trace-audit.js';
const id = '00000000-0000-4000-8000-000000000070';
const tool = { callId: 'call', name: 'find_ticket', arguments: '{"ticketNo":"D70-T"}', content: '{"title":"合成"}' };
const turn = { id, requestKey: id, ordinal: 1, question: '合成问题', status: 'completed', mode: 'mock', answer: '合成回答', errorCode: null, tools: [tool] };
const receipt = { status: 'exact', units: 0 };
const event = (seq: number, value: object) => ({ protocol: 1, runId: id, seq, ...value });
const meta = event(1, { type: 'meta', mode: 'mock', replay: false });
const answer = (seq: number) => event(seq, { type: 'answer', text: '合成回答' });
const done = (seq: number) => event(seq, { type: 'done', conversationVersion: 2, billing: receipt });
const trace = () => [meta,event(2,{type:'tool-start',callId:tool.callId,name:tool.name,arguments:tool.arguments}),event(3,{type:'tool-result',callId:tool.callId,name:tool.name,content:tool.content}),answer(4),done(5)];
describe('工具轨迹与持久结果离线核验（D70）', () => {
  it('完整轨迹与保存结果及计量收据一致', () => {
    const result = auditToolTrace(trace(), turn, receipt);
    expect(result).toMatchObject({ delivery:'matched',observedTools:1,units:0,replay:false });
    if (process.env.D70_EVIDENCE_FILE) appendFileSync(process.env.D70_EVIDENCE_FILE,JSON.stringify({case:'trace-audit',fixture:true,...result})+'\n');
  });
  it('事件正文与持久回答不一致拒绝', () => { expect(() => auditToolTrace(trace(),{...turn,answer:'不同答案'},receipt)).toThrow('TRACE_MISMATCH'); });
  it('事件费用与账本收据不一致拒绝', () => { expect(() => auditToolTrace(trace(),turn,{status:'exact',units:99})).toThrow('TRACE_MISMATCH'); });
  it('缺少done即使数据库已完成仍是传输不完整', () => { expect(auditToolTrace(trace().slice(0,-1),turn)).toMatchObject({delivery:'incomplete',recoverable:true,units:null}); });
  it('错误终态与失败记录对应但不虚构费用', () => { expect(auditToolTrace([meta,event(2,{type:'error',code:'TOOL_TIMEOUT'})],{...turn,status:'failed',answer:'',tools:[],errorCode:'TOOL_TIMEOUT'})).toMatchObject({delivery:'error',recoverable:false,units:null}); });
  it('已完成重放不要求重新执行原工具', () => { expect(auditToolTrace([{...meta,replay:true},answer(2),done(3)],turn,receipt)).toMatchObject({delivery:'matched',observedTools:0,replay:true}); });
  it('工具返回与持久卡片不同拒绝', () => { expect(() => auditToolTrace(trace(),{...turn,tools:[{...tool,content:'{}'}]},receipt)).toThrow('TRACE_MISMATCH'); });
  it('跨run或跳号拒绝', () => {
    expect(() => auditToolTrace([{...meta,runId:'00000000-0000-4000-8000-000000000071'}],turn)).toThrow('TRACE_INVALID');
    expect(() => auditToolTrace([meta,answer(3)],turn)).toThrow('TRACE_INVALID');
  });
  it('终态之后的附加消息拒绝', () => { expect(() => auditToolTrace([...trace(),answer(6)],turn,receipt)).toThrow('TRACE_INVALID'); });
  it('孤立工具结果不能被核验成成功', () => { expect(() => auditToolTrace([meta,event(2,{type:'tool-result',callId:tool.callId,name:tool.name,content:'{}'}),answer(3),done(4)],turn,receipt)).toThrow('TRACE_INVALID'); });
});
