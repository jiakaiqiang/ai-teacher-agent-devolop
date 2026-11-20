// Prisma 7 不再自动读取 .env，必须在第一行显式加载
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // prisma db seed 执行的命令
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // env() 在变量缺失时直接报错，比 process.env 拿到 undefined 更早暴露问题
    url: env('DATABASE_URL'),
  },
});
