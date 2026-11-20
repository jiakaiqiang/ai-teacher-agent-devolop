import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import pg from 'pg';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class DependencyProbe implements OnApplicationShutdown {
  // 健康探针单独限流到一个连接；驱动超时和数据库 statement_timeout 都有界。
  private readonly database = new pg.Pool({ connectionString: process.env.DATABASE_URL,
    max: 1, connectionTimeoutMillis: 500, query_timeout: 500, statement_timeout: 500 });
  private readonly queue = new Redis(process.env.QUEUE_REDIS_URL!, {
    commandTimeout: 500, connectTimeout: 500, maxRetriesPerRequest: 1, enableOfflineQueue: false,
  });
  constructor(private readonly cache: RedisService) {
    this.database.on('error', () => {});
    this.queue.on('error', () => {});
  }
  async pingDatabase(): Promise<void> { await this.database.query('SELECT 1'); }
  async pingQueue(): Promise<void> {
    if (await this.queue.ping() !== 'PONG') throw new Error('QUEUE_NOT_READY');
  }
  async pingCache(): Promise<void> {
    if (await this.cache.ping() !== 'PONG') throw new Error('CACHE_NOT_READY');
  }
  async onApplicationShutdown() {
    this.queue.disconnect();
    await this.database.end();
  }
}
