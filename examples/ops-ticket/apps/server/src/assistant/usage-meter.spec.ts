import { appendFileSync } from 'node:fs';
import {parseUsage,UsageMeter,usageCharge,RESERVATION_UNITS} from './usage-meter.js';
import {ModelGateway} from './model-gateway.js';
import {TriageService} from './triage.service.js';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
function configured(){vi.stubEnv('LLM_BASE_URL','https://example.test/v1');vi.stubEnv('LLM_API_KEY','fake-only');vi.stubEnv('LLM_MODEL','fixture');vi.stubEnv('LLM_MODEL_ROUTES','');}
describe('模型用量口径（D61）',()=>{
 it('接受一致的整数usage',()=>{expect(parseUsage({usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}})).toEqual({inputTokens:10,outputTokens:3});});
 it('缺失负数小数和总数不一致均不当精确值',()=>{for(const usage of [undefined,{prompt_tokens:-1,completion_tokens:1,total_tokens:0},{prompt_tokens:1.2,completion_tokens:1,total_tokens:2.2},{prompt_tokens:1,completion_tokens:2,total_tokens:4}])expect(parseUsage({usage})).toBeNull();});
 it('修复前后两次输出都计量',()=>{const meter=new UsageMeter();for(let i=0;i<2;i++){meter.start();meter.record({usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});}expect(meter.summary()).toEqual({inputTokens:20,outputTokens:10,exact:true,attempts:2});expect(usageCharge(meter.summary())).toBe(40);if(process.env.D61_EVIDENCE_FILE)appendFileSync(process.env.D61_EVIDENCE_FILE,JSON.stringify({case:'usage-meter',...meter.summary(),units:usageCharge(meter.summary()),currency:false})+'\n');});
 it('未知失败消耗不能当零退还',()=>{const meter=new UsageMeter();meter.start();expect(meter.summary().exact).toBe(false);expect(usageCharge(meter.summary())).toBe(RESERVATION_UNITS);});
 it('已知消耗超过预留仍如实计量',()=>{expect(usageCharge({inputTokens:60000,outputTokens:2,exact:false,attempts:1})).toBe(60004);});
 it('模拟零请求为精确零',()=>{expect(usageCharge(new UsageMeter().summary())).toBe(0);});
 it('不接受无界和负数汇总',()=>{expect(()=>usageCharge({inputTokens:-1,outputTokens:0,exact:true,attempts:1})).toThrow('USAGE_INVALID');expect(()=>usageCharge({inputTokens:0,outputTokens:0,exact:true,attempts:5})).toThrow('USAGE_INVALID');});
 it('网关每次HTTP尝试都进入计量',async()=>{configured();vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('fail',{status:503})).mockResolvedValueOnce(Response.json({usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})));const meter=new UsageMeter();const pending=new ModelGateway().complete([],undefined,'default',5000,undefined,meter);await vi.runAllTimersAsync();await pending;expect(meter.summary()).toEqual({inputTokens:10,outputTokens:5,exact:false,attempts:2});});
 it('分诊修复的坏输出也累计usage',async()=>{configured();const answer=(text:string)=>Response.json({choices:[{index:0,finish_reason:'stop',message:{content:text}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});const valid={intent:'超时',steps:[],evidenceIds:[],missingInformation:['服务端日志']};vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(answer('{}')).mockResolvedValueOnce(answer(JSON.stringify(valid))));const meter=new UsageMeter();await new TriageService(new ModelGateway()).suggest({description:'故障'},undefined,'default',meter);expect(meter.summary()).toEqual({inputTokens:20,outputTokens:10,exact:true,attempts:2});});
});
