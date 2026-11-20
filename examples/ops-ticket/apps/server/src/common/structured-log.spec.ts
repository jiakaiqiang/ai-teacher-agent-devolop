import { runWithRequestId } from './request-context.js';
import { eventRecord, logEvent, safeErrorCode } from './structured-log.js';

describe('结构化日志（D37）', () => {
  it('白名单拒绝密码、票据、任意 body 和错误文本', () => {
    const record = eventRecord('probe', { statusCode: 200, password: 'fake-pass', ticket: 'fake-ticket', body: 'private-body', message: 'raw-secret', arbitrary: 'hidden' });
    expect(record).toEqual({ event: 'probe', requestId: null, statusCode: 200 });
  });

  it('并发请求的上下文在 await 后仍各自独立，结束后不残留', async () => {
    const rows = await Promise.all(['trace-aaaa', 'trace-bbbb'].map((id) => runWithRequestId(id, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return eventRecord('probe');
    })));
    expect(rows.map((row) => row.requestId)).toEqual(['trace-aaaa', 'trace-bbbb']);
    expect(eventRecord('outside').requestId).toBeNull();
  });

  it('内置 logger 每条输出可独立解析，换行不会伪造新日志', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      runWithRequestId('trace-json-37', () => logEvent('probe', { route: 'one\ntwo' }));
      expect(spy).toHaveBeenCalledOnce();
      const line = String(spy.mock.calls[0]![0]);
      expect(line.split('\n')).toHaveLength(1);
      expect(JSON.parse(line).message).toMatchObject({ event: 'probe', requestId: 'trace-json-37', route: 'one\ntwo' });
    } finally { spy.mockRestore(); }
  });

  it('错误只暴露代码，不读取带秘密的 message 或 stack', () => {
    expect(safeErrorCode({ code: 'P2002', message: 'fake-secret' })).toBe('P2002');
    expect(safeErrorCode(new Error('fake-secret'))).toBe('UNCLASSIFIED');
    expect(safeErrorCode({ code: 'bad code with data' })).toBe('UNCLASSIFIED');
  });
});
