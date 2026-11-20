import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

describe('全局配置 (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // 和 main.ts 调用同一个函数，前缀、管道、拦截器、过滤器与线上一致
    configureApp(app);
    await app.init();
  });

  it('GET /api/health 成功响应包在 data 里', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.data.status).toBe('ok');
      });
  });

  it('不存在的路径返回统一的错误结构', () => {
    return request(app.getHttpServer())
      .get('/api/not-exist')
      .expect(404)
      .expect((res) => {
        expect(res.body.error.code).toBe('NOT_FOUND');
        expect(typeof res.body.error.message).toBe('string');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
