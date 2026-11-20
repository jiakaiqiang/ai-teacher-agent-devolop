import { appendFileSync } from 'node:fs';
import { GatewayFailure, ModelPolicy, statusFailure } from './model-policy.js';
import { requestCompletion } from './model-completion.js';
const unavailable = () => new GatewayFailure('MODEL_UNAVAILABLE', true);
function evidence(caseName: string, data: object) { if(process.env.D58_EVIDENCE_FILE) appendFileSync(process.env.D58_EVIDENCE_FILE,JSON.stringify({case:caseName,...data})+'\n'); }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('非流式模型策略（D58）', () => {
  it('429与5xx可重试而401不可重试', () => {
    expect(statusFailure(429)).toMatchObject({code:'MODEL_BUSY',retryable:true});
    expect(statusFailure(524).code).toBe('MODEL_TIMEOUT');expect(statusFailure(503).retryable).toBe(true);
    expect(statusFailure(401)).toMatchObject({code:'MODEL_CONFIG_ERROR',retryable:false});expect(statusFailure(400).retryable).toBe(false);
  });
  it('两次失败后停止重试', async () => {
    vi.useFakeTimers();const work=vi.fn().mockRejectedValue(unavailable());const pending=new ModelPolicy().run(work);
    const check=expect(pending).rejects.toThrow('MODEL_UNAVAILABLE');await vi.runAllTimersAsync();await check;
    expect(work).toHaveBeenCalledTimes(2);evidence('retry-budget',{attempts:work.mock.calls.length});
  });
  it('暂时失败后第二次成功', async () => {
    vi.useFakeTimers();const work=vi.fn().mockRejectedValueOnce(unavailable()).mockResolvedValue('ok');const p=new ModelPolicy().run(work);
    await vi.runAllTimersAsync();expect(await p).toBe('ok');expect(work).toHaveBeenCalledTimes(2);
  });
  it('配置错误不重试', async () => {const work=vi.fn().mockRejectedValue(statusFailure(401));await expect(new ModelPolicy().run(work)).rejects.toThrow('MODEL_CONFIG_ERROR');expect(work).toHaveBeenCalledTimes(1);});
  it('总预算包含不合作请求且不重新开始', async () => {
    vi.useFakeTimers();const work=vi.fn().mockImplementation(()=>new Promise(()=>{}));const p=new ModelPolicy().run(work,undefined,50);
    const check=expect(p).rejects.toThrow('MODEL_TIMEOUT');await vi.advanceTimersByTimeAsync(50);await check;expect(work).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('父取消中止退避并清理定时器', async () => {
    vi.useFakeTimers();const parent=new AbortController();const work=vi.fn().mockRejectedValue(unavailable());const p=new ModelPolicy().run(work,parent.signal);
    const check=expect(p).rejects.toThrow('MODEL_CANCELLED');await vi.advanceTimersByTimeAsync(1);parent.abort();await check;expect(work).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('预先取消不发请求', async () => {const c=new AbortController();c.abort();const work=vi.fn();await expect(new ModelPolicy().run(work,c.signal)).rejects.toThrow('MODEL_CANCELLED');expect(work).not.toHaveBeenCalled();});
  it('三次最终失败开路且仅一个半开探针', async () => {
    vi.useFakeTimers();const policy=new ModelPolicy();const fail=vi.fn().mockRejectedValue(unavailable());
    for(let i=0;i<3;i++){const p=policy.run(fail);const check=expect(p).rejects.toThrow('MODEL_UNAVAILABLE');await vi.runAllTimersAsync();await check;}
    await expect(policy.run(fail)).rejects.toThrow('MODEL_CIRCUIT_OPEN');expect(fail).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(30000);let finish!:(s:string)=>void;const probe=policy.run(()=>new Promise<string>(r=>{finish=r;}));
    await expect(policy.run(fail)).rejects.toThrow('MODEL_CIRCUIT_OPEN');finish('recovered');expect(await probe).toBe('recovered');
    expect(await policy.run(async()=> 'closed')).toBe('closed');evidence('circuit',{failedRequests:3,httpAttempts:6,halfOpenConcurrentRejected:true,recovered:true});
  });
  it('旧并发成功不能关闭后来打开的熔断器', async () => {
    vi.useFakeTimers();const policy=new ModelPolicy();let finish!:(s:string)=>void;const old=policy.run(()=>new Promise<string>(r=>{finish=r;}));await vi.advanceTimersByTimeAsync(0);
    for(let i=0;i<3;i++){const p=policy.run(async()=>{throw unavailable();});const check=expect(p).rejects.toThrow();await vi.advanceTimersByTimeAsync(200);await check;}
    finish('old');await old;await expect(policy.run(async()=> 'bad')).rejects.toThrow('MODEL_CIRCUIT_OPEN');
  });
  it('半开失败不重试并重新打开', async () => {
    vi.useFakeTimers();const policy=new ModelPolicy();const fail=vi.fn().mockRejectedValue(unavailable());
    for(let i=0;i<3;i++){const p=policy.run(fail);const check=expect(p).rejects.toThrow();await vi.runAllTimersAsync();await check;}
    await vi.advanceTimersByTimeAsync(30000);await expect(policy.run(fail)).rejects.toThrow();expect(fail).toHaveBeenCalledTimes(7);
    await expect(policy.run(fail)).rejects.toThrow('MODEL_CIRCUIT_OPEN');
  });
  it('HTTP状态映射不回显供应商正文', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private-upstream',{status:429})));
    await expect(requestCompletion({endpoint:'https://example.test',apiKey:'fake',model:'test'},[],new AbortController().signal)).rejects.toMatchObject({message:'MODEL_BUSY',retryable:true});
  });
  it('有效JSON解析和HTML拒绝', async () => {
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({ok:true})).mockResolvedValueOnce(new Response('<html>bad</html>',{headers:{'content-type':'text/html'}}));vi.stubGlobal('fetch',fetcher);
    const config={endpoint:'https://example.test',apiKey:'fake',model:'test'};const signal=new AbortController().signal;
    expect(await requestCompletion(config,[],signal)).toEqual({ok:true});await expect(requestCompletion(config,[],signal)).rejects.toThrow('MODEL_PROTOCOL_ERROR');
  });
});
