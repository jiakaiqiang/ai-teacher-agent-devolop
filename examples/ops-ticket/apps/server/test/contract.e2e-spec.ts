import { bearer } from './login-fixtures.js';
import { ticketPageSchema, ticketDetailSchema } from '@ops-ticket/shared';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

let app: INestApplication;
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  configureApp(app);
  await app.init();
});
afterAll(async () => { await app?.close(); });

it('列表和详情符合共享契约', async () => {
  const list = await request(app.getHttpServer()).get('/api/tickets').set('Authorization',await bearer(app)).expect(200);
  expect(ticketPageSchema.parse(list.body.data).items).toHaveLength(1);
  const detail = await request(app.getHttpServer()).get('/api/tickets/T-001').set('Authorization',await bearer(app)).expect(200);
  expect(ticketDetailSchema.parse(detail.body.data).company.name).toBe('甲公司');
  expect(ticketPageSchema.safeParse({items:[{status:'closed'}],nextCursor:null}).success).toBe(false);
});
