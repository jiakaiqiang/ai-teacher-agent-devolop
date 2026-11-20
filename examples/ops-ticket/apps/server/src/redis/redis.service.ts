import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';

// 整个应用一个 Redis 连接（D22）。和 PrismaService 一样直接继承客户端，业务里注入后就能调用命令
@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error('缺少环境变量 REDIS_URL，请检查 apps/server/.env');
    }
    super(url, {
      // 所有键自动加上前缀：和别的应用共用一个 Redis 时不会撞键，排查时也一眼能认出
      keyPrefix: 'ops:',
      // 缓存不能拖慢业务：单条命令最多等 300ms，Redis 有问题时尽快失败、回退到数据库
      commandTimeout: 300,
      // 连不上时不要无限重试排队，失败一次就把错误交给调用方
      maxRetriesPerRequest: 1,
      // 断开期间不把命令放进离线队列等重连，立即失败：缓存挂了，请求马上回退到数据库，而不是每次都等到超时
      enableOfflineQueue: false,
    });
    // 不监听 error 事件的话，Redis 断开时 ioredis 会把错误当成未处理的异常抛出，进程可能退出
    this.on('error', () => {});
  }

  // 关掉离线队列后，连接建立之前发的命令会直接失败。启动时最多等 2 秒连上；
  // 等不到也照常启动：Redis 挂着时应用仍然能用，只是没有缓存
  async onModuleInit() {
    if (this.status === 'ready') return;
    await Promise.race([
      new Promise((resolve) => this.once('ready', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }

  async onModuleDestroy() {
    this.disconnect();
  }
}
