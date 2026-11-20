import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { appendFileSync } from 'node:fs';
import request from 'supertest';
import { SseParser } from '@ops-ticket/shared';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ChatClient } from '../src/assistant/chat.client.js';
import { ModelSource } from '../src/assistant/model.source.js';
import { AssistantStreams } from '../src/assistant/stream-lifecycle.js';
import { drainAndClose } from '../src/health/drain-and-close.js';
import { bearer } from './login-fixtures.js';
const report = (data: object) => { if (process.env.D46_EVIDENCE_FILE) appendFileSync(process.env.D46_EVIDENCE_FILE, JSON.stringify(data) + '\n'); };
const delta = 'data: {"choices":[{"index":0,"delta":{"content":"部分建议"},"finish_reason":null}]}\n\n';
describe('真实HTTP取消传播（D46）', () => {
  let app: INestApplication; let upstream: Server; let token: string; let url: string;
  let handle: (res: ServerResponse) => void; let closed: number; let appClosed: boolean;
  beforeEach(async () => {
    closed = 0; appClosed = false;
    upstream = createServer((req, res) => { req.resume(); res.once('close', () => { closed++; }); handle(res); });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1/chat/completions`;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); configureApp(app); await app.listen(0, '127.0.0.1');
    token = await bearer(app); url = `${await app.getUrl()}/api/tickets/T-001/assistant`;
    vi.spyOn(app.get(ModelSource), 'open').mockImplementation(async (messages, signal) => ({ mode: 'model', body: (await new ChatClient({ endpoint, apiKey: 'fake', model: 'mock-model' }).open(messages, true, signal)).body! }));
  });
  afterEach(async () => { vi.restoreAllMocks(); upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve())); if (!appClosed) await app.close(); });
  const begin = (signal?: AbortSignal) => fetch(url, { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: '模拟' }), signal });
  const policy = (totalMs: number, idleMs: number) => vi.spyOn(app.get(AssistantStreams), 'policy').mockReturnValue({ totalMs, idleMs });
  it('响应头之前悬挂超时会取消上游并返回503', async () => {
    policy(300, 150); handle = () => {};
    const res = await request(app.getHttpServer()).post('/api/tickets/T-001/assistant').set('authorization', token).send({ question: '模拟' }).expect(503);
    expect(res.body.error.code).toBe('MODEL_TIMEOUT'); await vi.waitFor(() => expect(closed).toBe(1)); expect(app.get(AssistantStreams).activeCount).toBe(0);
    report({ case: 'header-timeout', status: res.status, code: res.body.error.code, upstreamClosed: closed });
  });
  it('已有正文后空闲超时保留部分并发error', async () => {
    policy(1000, 150); handle = (res) => { res.setHeader('Content-Type', 'text/event-stream'); res.write(delta); };
    const res = await begin(); const events = new SseParser().push(await res.text());
    expect(events.map((event) => event.event)).toEqual(['meta', 'delta', 'error']); expect(JSON.parse(events.at(-1)!.data).code).toBe('MODEL_TIMEOUT');
    await vi.waitFor(() => expect(closed).toBe(1)); report({ case: 'idle-timeout', eventTypes: events.map((event) => event.event), upstreamClosed: closed });
  });
  it('持续增量不能无限延长总期限', async () => {
    policy(240, 150); handle = (res) => { res.setHeader('Content-Type', 'text/event-stream'); res.write(delta); const timer = setInterval(() => res.write(delta), 35); res.once('close', () => clearInterval(timer)); };
    const res = await begin(); const events = new SseParser().push(await res.text());
    expect(events.filter((event) => event.event === 'delta').length).toBeGreaterThan(2); expect(JSON.parse(events.at(-1)!.data).code).toBe('MODEL_TIMEOUT');
    await vi.waitFor(() => expect(closed).toBe(1)); report({ case: 'total-timeout', terminal: 'MODEL_TIMEOUT', upstreamClosed: closed });
  });
  it('客户端断开立即取消悬挂上游，不等预算到期', async () => {
    policy(10_000, 10_000); handle = (res) => { res.setHeader('Content-Type', 'text/event-stream'); res.write(delta); };
    const abort = new AbortController(); const res = await begin(abort.signal); const reader = res.body!.getReader();
    await reader.read(); abort.abort(); await reader.cancel().catch(() => {}); reader.releaseLock();
    await vi.waitFor(() => expect(closed).toBe(1), { timeout: 700 }); await vi.waitFor(() => expect(app.get(AssistantStreams).activeCount).toBe(0));
    report({ case: 'client-cancel', upstreamClosed: closed, active: app.get(AssistantStreams).activeCount });
  });
  it('应用排空先取消助手流再等待HTTP结束', async () => {
    policy(10_000, 10_000); handle = (res) => { res.setHeader('Content-Type', 'text/event-stream'); res.write(delta); };
    const res = await begin(); const text = res.text(); const closing = drainAndClose(app);
    const events = new SseParser().push(await text); await closing; appClosed = true;
    expect(JSON.parse(events.at(-1)!.data).code).toBe('MODEL_CANCELLED'); expect(app.get(AssistantStreams).activeCount).toBe(0);
    await vi.waitFor(() => expect(closed).toBe(1)); report({ case: 'shutdown-cancel', upstreamClosed: closed, active: 0, terminal: 'MODEL_CANCELLED' });
  });
});
