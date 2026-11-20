import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

// 整个应用只有一个 PrismaClient 实例：每个实例都有自己的连接池，多建会耗尽数据库连接
export type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      // 启动时就失败，比第一个请求进来才报错更容易定位
      throw new Error('缺少环境变量 DATABASE_URL，请检查 apps/server/.env');
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  // 应用关闭时归还连接；main.ts 里的 enableShutdownHooks 让 Ctrl+C 也会触发这里
  async serializable<T>(run: (tx: TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try { return await this.$transaction(run, {isolationLevel:'Serializable'}); }
      catch (error) {
        if (attempt >= 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
