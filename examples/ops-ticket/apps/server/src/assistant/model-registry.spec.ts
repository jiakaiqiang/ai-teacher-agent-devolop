import { appendFileSync } from 'node:fs';
import { ModelRegistry, readModelRegistry } from './model-registry.js';
import { ModelGateway } from './model-gateway.js';
const base = { endpoint: 'https://example.test/v1/chat/completions', apiKey: 'fake-only', model: 'model-a' };
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('模型白名单（D57）', () => {
  it('兼容缺省模拟模式', () => { expect(readModelRegistry({}).resolve()).toBeNull(); });
  it('别名只映射受信任模型', () => {
    const registry = new ModelRegistry(base, [{ alias: 'default', model: 'model-a' }, { alias: 'fast', model: 'model-b' }]);
    expect(registry.resolve('fast')).toEqual({ ...base, model: 'model-b' });
    if (process.env.D57_EVIDENCE_FILE) appendFileSync(process.env.D57_EVIDENCE_FILE, JSON.stringify({ case:'model-routes', aliases:registry.aliases(), selectedModel:registry.resolve('fast')?.model, sameEndpoint:true })+'\n');
  });
  it('未知别名不能悄悄回退', () => { expect(() => new ModelRegistry(base).resolve('untrusted')).toThrow('MODEL_NOT_ALLOWED'); });
  it('返回副本不能污染后续解析', () => { const r=new ModelRegistry({...base}); r.resolve()!.endpoint='https://changed.test';expect(r.resolve()?.endpoint).toBe(base.endpoint); });
  it('重复别名与缺省别名缺失拒绝', () => {
    expect(() => new ModelRegistry(base,[{alias:'a',model:'x'}])).toThrow('MODEL_DEFAULT_MISSING');
    expect(() => new ModelRegistry(base,[{alias:'default',model:'x'},{alias:'default',model:'y'}])).toThrow('MODEL_ROUTES_INVALID');
  });
  it('配置大小和模型名称有界', () => {
    expect(() => new ModelRegistry(base,Array.from({length:9},(_,i)=>({alias:'m'+i,model:'x'})))).toThrow('MODEL_ROUTES_INVALID');
    expect(() => new ModelRegistry(base,[{alias:'default',model:'x\ny'}])).toThrow('MODEL_ROUTES_INVALID');
  });
  it('映射不接受URL或凭据字段', () => {
    const env={LLM_BASE_URL:'https://example.test/v1',LLM_API_KEY:'fake',LLM_MODEL:'a',LLM_MODEL_ROUTES:JSON.stringify([{alias:'default',model:'a',endpoint:'http://evil.test'}])};
    expect(() => readModelRegistry(env)).toThrow('MODEL_ROUTES_INVALID');
  });
  it('只有映射时不能冒充已配模型', () => { expect(() => readModelRegistry({LLM_MODEL_ROUTES:'[{"alias":"default","model":"x"}]'})).toThrow('MODEL_ROUTES_INVALID'); });
  it('真实配置仍兼容三个变量', () => {expect(readModelRegistry({LLM_BASE_URL:'https://example.test/v1',LLM_API_KEY:'fake',LLM_MODEL:'m'}).resolve()?.model).toBe('m');});
  it('网关取消后不发起fetch', async () => {
    const spy=vi.spyOn(globalThis,'fetch');const abort=new AbortController();abort.abort(new Error('cancelled'));
    await expect(new ModelGateway().stream([],abort.signal)).rejects.toThrow('cancelled');expect(spy).not.toHaveBeenCalled();
  });
});
