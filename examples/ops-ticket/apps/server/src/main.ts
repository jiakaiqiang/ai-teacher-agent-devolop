// 必须最先加载：后面的模块（例如 PrismaService）在创建时就要读取 DATABASE_URL
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { drainAndClose } from './health/drain-and-close.js';
import { configureApp } from './app.setup.js';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // 收到 Ctrl+C 等退出信号时，让 Nest 走完生命周期钩子再退出（以后关闭数据库连接要用到）
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void drainAndClose(app); });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`后端已启动：http://localhost:${port}/api/health`, 'Bootstrap');
}
await bootstrap();
