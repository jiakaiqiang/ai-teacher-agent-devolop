import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { appendFileSync } from 'node:fs';
import request from 'supertest';
import { assistantEventSchema, SseParser } from '@ops-ticket/shared';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ModelSource } from '../src/assistant/model.source.js';
import { ChatClient } from '../src/assistant/chat.client.js';
import { bearer } from './login-fixtures.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
const report = (data: object) => { if (process.env.D45_EVIDENCE_FILE) appendFileSync(process.env.D45_EVIDENCE_FILE, JSON.stringify(data) + '\n'); };
const wire = (content: string, reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: reason }] })}\n\n`;
describe('工单AI助手出口（D45）', () => {
  let app: INestApplication; let auth: (username: string) => string;
  let upstream: Server; let endpoint: string; let answer = ''; let calls = 0; let body: Record<string, unknown> = {};
  beforeAll(async () => {
    upstream = createServer((req, res) => {
      calls++; let text = ''; req.on('data', (chunk: Buffer) => { text += chunk.toString(); });
      req.on('end', () => { body = JSON.parse(text) as Record<string, unknown>; res.setHeader('Content-Type', 'text/event-stream'); res.end(answer); });
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1/chat/completions`;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); configureApp(app); await app.init(); const tokens = new Map<string,string>();
    for (const name of ['lin','wu']) tokens.set(name,await bearer(app,name));
    auth = name => tokens.get(name)!;
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve())); await app.close(); });
  const post = (user = 'lin') => request(app.getHttpServer()).post('/api/tickets/T-001/assistant').set('authorization', auth(user));
  function local() {
    return vi.spyOn(app.get(ModelSource), 'open').mockImplementation(async (messages, signal) => {
      const response = await new ChatClient({ endpoint, apiKey: 'fake-local-key', model: 'mock-model' }).open(messages, true, signal);
      return { body: response.body!, mode: 'model' };
    });
  }
  const events = (text: string) => new SseParser().push(text).map((frame) => { const event = assistantEventSchema.parse(JSON.parse(frame.data)); expect(frame.event).toBe(event.type); return event; });
  it('未登录返回401且不调用上游', async () => {
    const spy = local();
    await request(app.getHttpServer()).post('/api/tickets/T-001/assistant').send({ question: '模拟问题' }).expect(401);
    expect(spy).not.toHaveBeenCalled();
  });
  it('跨客户不可见工单404且不调用模型', async () => {
    const spy = local(); await post('wu').send({ question: '模拟问题' }).expect(404); expect(spy).not.toHaveBeenCalled();
    report({ case: 'scope-before-model', status: 404, upstreamCalls: spy.mock.calls.length });
  });
  it('拒绝空白、过长问题及客户端模型配置', async () => {
    const spy = local();
    for (const input of [{ question: '   ' }, { question: 'x'.repeat(1001) }, { question: '模拟', model: 'override' }, { question: '模拟', role: 'system' }]) await post().send(input).expect(400);
    expect(spy).not.toHaveBeenCalled();
  });
  it('默认演示明确标mock，正文和done遵守共享契约', async () => {
    const db = app.get(PrismaService);
    const before = await db.ticket.findUniqueOrThrow({where:{ticketNo:'T-001'}});
    const res = await post().send({ question: '模拟问题' }).expect(200);
    expect(await db.ticket.findUniqueOrThrow({where:{id:before.id}})).toMatchObject({version:before.version,status:before.status});
    expect(res.headers['content-type']).toContain('text/event-stream'); expect(res.headers['cache-control']).toBe('no-store');
    const output = events(res.text); expect(output[0]).toEqual({ type: 'meta', mode: 'mock' }); expect(output.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
    report({ case: 'mock-stream', eventTypes: output.map((event) => event.type), mode: 'mock' });
  });
  it('真实回环上游只收到最小工单材料，正文逐事件转发', async () => {
    local(); const before = calls; answer = wire('建议一') + wire('建议二', 'stop') + 'data: [DONE]\n\n';
    const res = await post().send({ question: '模拟问题' }).expect(200);
    const messages = body.messages as { role: string; content: string }[];
    const context = JSON.parse(JSON.parse(messages[1].content).ticket) as Record<string, unknown>;
    expect(Object.keys(context).sort()).toEqual(['category', 'description', 'logs', 'ticketNo']); expect(context.logs).toContain('client timeout after 5s'); expect(body.stream).toBe(true); expect(calls - before).toBe(1);
    expect(events(res.text)).toEqual([{ type: 'meta', mode: 'model' }, { type: 'delta', text: '建议一' }, { type: 'delta', text: '建议二' }, { type: 'done', finishReason: 'stop' }]);
    report({ case: 'loopback-stream', contextFields: Object.keys(context).sort(), upstreamCalls: calls - before, eventTypes: events(res.text).map((event) => event.type) });
  });
  it('上游EOF中断后只发error，不能伪造done', async () => {
    local(); answer = wire('部分建议', 'stop');
    const output = events((await post().send({ question: '模拟' }).expect(200)).text);
    expect(output.at(-1)).toEqual({ type: 'error', code: 'MODEL_PROTOCOL_ERROR' }); expect(output.some((event) => event.type === 'done')).toBe(false);
    report({ case: 'interrupted-stream', eventTypes: output.map((event) => event.type), last: output.at(-1) });
  });
  it('上游在发头之前失败则JSON503不泄漏文本', async () => {
    vi.spyOn(app.get(ModelSource), 'open').mockRejectedValue(new Error('fake-private-body'));
    const res = await post().send({ question: '模拟' }).expect(503); expect(res.text).not.toContain('fake-private-body'); expect(res.headers['content-type']).toContain('application/json');
  });
});
