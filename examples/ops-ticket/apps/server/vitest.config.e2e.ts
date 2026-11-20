import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import { preflightTestResources } from './test/test-resources.js';

const resources = preflightTestResources(process.env);

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // 测试前重建测试库（只执行一次）
    globalSetup: ['./test/global-setup.ts'],
    // 所有测试进程都连测试库，不碰开发库
    env: {
      // 全套回归永远不访问付费模型，真实兼容验证另行运行。
      LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '',
      DATABASE_URL: resources.database,
      // Redis 也和开发环境分开：用 1 号库（D22）
      REDIS_URL: resources.cacheRedis,
      // 队列用的 Redis 也用 1 号库（D29）
      QUEUE_REDIS_URL: resources.queueRedis,
      // D32：空的测试 Redis 里不注册调度，用例自己调用或使用独立队列
      SLA_SCAN_INTERVAL_MS: '0',
      // 用例按专用输入运行 Outbox。
      OUTBOX_RELAY_INTERVAL_MS: '0',
    },
    // 多个测试文件共用一个库，按顺序执行，避免互相干扰
    fileParallelism: false,
  },
});
