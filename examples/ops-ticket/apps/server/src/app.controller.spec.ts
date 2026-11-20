import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    // 用测试模块装配控制器和服务，和真实运行时的依赖注入方式一致
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('返回 ok 状态和服务名', () => {
      const health = appController.getHealth();
      expect(health.status).toBe('ok');
      expect(health.service).toBe('ops-ticket-server');
      // 时间必须是合法的 ISO 字符串
      expect(new Date(health.time).toISOString()).toBe(health.time);
    });
  });
});
