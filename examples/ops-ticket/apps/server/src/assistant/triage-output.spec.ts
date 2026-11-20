import { appendFileSync } from 'node:fs';
import { parseTriageOutput,triageResponseFormat } from './triage-output.js';
import { TriageService } from './triage.service.js';
import { ModelGateway } from './model-gateway.js';
const suggestion={intent:'网络超时',steps:['检查已配置的超时'],evidenceIds:['manual-1'],missingInformation:[]};
const response=(content=JSON.stringify(suggestion),finish_reason='stop',refusal:string|null=null)=>({choices:[{index:0,finish_reason,message:{content,refusal}}]});
function configured(){vi.stubEnv('LLM_BASE_URL','https://example.test/v1');vi.stubEnv('LLM_API_KEY','fake-only');vi.stubEnv('LLM_MODEL','fixture');vi.stubEnv('LLM_MODEL_ROUTES','');}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();vi.useRealTimers();});
describe('结构化分诊（D60）',()=>{
 it('接受合法字段且schema禁止额外属性',()=>{expect(parseTriageOutput(response())).toEqual(suggestion);expect(triageResponseFormat.json_schema.schema.additionalProperties).toBe(false);});
 it('拒绝越权字段与额外优先级',()=>{expect(()=>parseTriageOutput(response(JSON.stringify({...suggestion,groupId:'other'})))).toThrow('MODEL_INVALID_OUTPUT');expect(()=>parseTriageOutput(response(JSON.stringify({...suggestion,priority:'P0'})))).toThrow('MODEL_INVALID_OUTPUT');});
 it('拒绝Markdown包装与坏JSON',()=>{expect(()=>parseTriageOutput(response('```json\n{}\n```'))).toThrow('MODEL_INVALID_OUTPUT');expect(()=>parseTriageOutput(response('{'))).toThrow('MODEL_INVALID_OUTPUT');});
 it('拒绝和截断不会伪装成成功',()=>{expect(()=>parseTriageOutput(response('{}','stop','refused'))).toThrow('MODEL_REFUSED');expect(()=>parseTriageOutput(response(JSON.stringify(suggestion),'length'))).toThrow('MODEL_TRUNCATED');});
 it('多候选与非stop终止为协议错误',()=>{expect(()=>parseTriageOutput({choices:[...response().choices,...response().choices]})).toThrow('MODEL_PROTOCOL_ERROR');expect(()=>parseTriageOutput(response('{}','tool_calls'))).toThrow('MODEL_PROTOCOL_ERROR');});
 it('一次校验失败后修复成功',async()=>{
  configured();const gateway=new ModelGateway();const spy=vi.spyOn(gateway,'complete').mockResolvedValueOnce(response('{}')).mockResolvedValueOnce(response());
  const result=await new TriageService(gateway).suggest({description:'设备离线'});expect(result.validationAttempts).toBe(2);expect(spy).toHaveBeenCalledTimes(2);
  expect(spy.mock.calls[1]?.[0].at(-1)?.content).toContain('未通过JSON字段校验');
  if(process.env.D60_EVIDENCE_FILE)appendFileSync(process.env.D60_EVIDENCE_FILE,JSON.stringify({case:'structured-repair',mode:result.mode,fixture:true,validationAttempts:result.validationAttempts,suggestion:result.suggestion})+'\n');
 });
 it('两次无效后不再修复',async()=>{configured();const gateway=new ModelGateway();const spy=vi.spyOn(gateway,'complete').mockResolvedValue(response('{}'));await expect(new TriageService(gateway).suggest({description:'故障'})).rejects.toThrow('MODEL_INVALID_OUTPUT');expect(spy).toHaveBeenCalledTimes(2);});
 it('截断只调用一次',async()=>{configured();const gateway=new ModelGateway();const spy=vi.spyOn(gateway,'complete').mockResolvedValue(response('{}','length'));await expect(new TriageService(gateway).suggest({description:'故障'})).rejects.toThrow('MODEL_TRUNCATED');expect(spy).toHaveBeenCalledTimes(1);});
 it('模拟模式显式标记且不调用网关',async()=>{vi.stubEnv('LLM_BASE_URL','');vi.stubEnv('LLM_API_KEY','');vi.stubEnv('LLM_MODEL','');vi.stubEnv('LLM_MODEL_ROUTES','');const gateway=new ModelGateway();const spy=vi.spyOn(gateway,'complete');const r=await new TriageService(gateway).suggest({description:'故障'});expect(r.mode).toBe('mock');expect(r.suggestion.steps).toEqual([]);expect(spy).not.toHaveBeenCalled();});
 it('共享总预算在不合作网关处结束',async()=>{configured();vi.useFakeTimers();const gateway=new ModelGateway();vi.spyOn(gateway,'complete').mockImplementation(()=>new Promise(()=>{}));const p=new TriageService(gateway).suggest({description:'故障'});const check=expect(p).rejects.toThrow('MODEL_TIMEOUT');await vi.advanceTimersByTimeAsync(5000);await check;expect(vi.getTimerCount()).toBe(0);});
 it('预先取消不触发生成',async()=>{const gateway=new ModelGateway();const spy=vi.spyOn(gateway,'complete');const c=new AbortController();c.abort();await expect(new TriageService(gateway).suggest({description:'故障'},c.signal)).rejects.toThrow('MODEL_CANCELLED');expect(spy).not.toHaveBeenCalled();});
});
