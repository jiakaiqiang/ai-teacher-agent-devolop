# D22：Redis 接入与旁路缓存——先读缓存，没有再读数据库

第 4 周 · 2 小时 · 前置 [D21-第三周复盘](D21-第三周复盘.md)。

## 今天要做出什么

把工单数量缓存到 Redis，缓存键与 D17 的查询范围一致。相同的业务数值也要有可区分的客户来源。

## 今天的目录结构

- `infra/docker-compose.yml`
- `apps/server/.env.example`
- `apps/server/package.json`
- `apps/server/src/redis/redis.service.ts`
- `apps/server/src/redis/cache.service.ts`
- `apps/server/src/redis/redis.module.ts`
- `apps/server/src/tickets/worklist-stats.ts`
- `apps/server/src/tickets/tickets.controller.ts`
- `apps/server/src/tickets/tickets.module.ts`
- `apps/server/src/app.module.ts`
- `apps/server/prisma/scripts/scoped-cache.ts`

## 时间安排

回忆 10 分钟、知识点 35 分钟、动手 55 分钟、自检与提交 20 分钟。超时先保留主用例与一个失败反例，扩展实验留到周日。

## 零、闭卷回忆

hit 和 miss 分别去哪里读取？为什么不能只用一个 worklist 键？ Redis 故障可否绕开数据范围？

## 一、知识点与推导

先在数据库查询前计算操作者范围，再用它构造键。首次读落到数据库并设 TTL，再读复用缓存。公司管理员按公司，提单人按公司和本人，运维主管按部门，处理人还需包含自己的标识。

## 二、动手开发

启动 Compose 的 Redis，把 REDIS_URL 写入本地环境，然后运行 scoped-cache.ts。故意把键替换为常量，检查两种身份各自的键是否消失；恢复按 scope 生成的键。

## 三、自检与提交

检查同一个用户第二次读取命中缓存，两个用户即使值都是 1 也使用不同键；停用独立实验 Redis 时验证正常数据源仍受范围限制。

## 四、本章完整源码

**infra/docker-compose.yml**

```text
# 本机开发用的依赖服务。今天只有 PostgreSQL，W4 加 Redis，W11 加 Milvus
name: ops-ticket-course-v2

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ops
      # 只用于本机开发的密码，真实环境的密码不能写进仓库
      POSTGRES_PASSWORD: ops_local_only
      POSTGRES_DB: ops_ticket
    ports:
      # 宿主机用 55433：5432 常被本机其他项目的 PostgreSQL 占用
      - "127.0.0.1:55433:5432"
    volumes:
      # 数据存在命名卷里，容器删除后数据仍在；docker compose down -v 才会删除
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ops -d ops_ticket"]
      interval: 2s
      timeout: 3s
      retries: 15

  redis:
    image: redis:7-alpine
    # 只做缓存和限流，丢了可以重建，不开持久化；--maxmemory 防止缓存把内存吃满
    command: ["redis-server", "--save", "", "--appendonly", "no", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    ports:
      # 宿主机用 56379：6379 常被本机其他项目的 Redis 占用
      - "127.0.0.1:56379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 3s
      retries: 15

volumes:
  pgdata:
```

**apps/server/.env.example**

```text
# 复制为 .env 后使用；.env 不提交到 Git
# 端口 55433 对应 infra/docker-compose.yml 里映射的端口
DATABASE_URL="postgresql://ops:ops_local_only@localhost:55433/ops_ticket?schema=public"

REDIS_URL=redis://127.0.0.1:56379/0
# 在本地 .env 中生成至少 32 字符的随机值
JWT_SECRET=
```

**apps/server/package.json**

```json
{
  "name": "@ops-ticket/server",
  "version": "0.0.1",
  "description": "",
  "author": "",
  "private": true,
  "license": "UNLICENSED",
  "type": "module",
  "scripts": {
    "build": "nest build",
    "deploy": "nest deploy",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "oxlint --type-aware src/ test/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:debug": "vitest --inspect-brk --no-file-parallelism",
    "test:e2e": "vitest run --config ./vitest.config.e2e.ts",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:status": "prisma migrate status",
    "db:seed": "prisma db seed"
  },
  "dependencies": {
    "@nestjs/common": "^12.0.1",
    "@nestjs/core": "^12.0.1",
    "@nestjs/platform-express": "^12.0.1",
    "@prisma/adapter-pg": "7.10.1",
    "@prisma/client": "7.10.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.15.1",
    "dotenv": "^18.0.10",
    "pg": "^8.23.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "@ops-ticket/shared": "workspace:*",
    "@nestjs/jwt": "12.0.5",
    "ioredis": "6.0.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^12.0.0",
    "@nestjs/mau": "^0.2.6",
    "@nestjs/schematics": "^12.0.0",
    "@nestjs/testing": "^12.0.1",
    "@types/express": "^5.0.0",
    "@types/node": "^24.0.0",
    "@types/pg": "^8.23.1",
    "@types/supertest": "^7.0.0",
    "@vitest/coverage-v8": "^4.1.2",
    "oxlint": "^1.58.0",
    "oxlint-tsgolint": "^7.0.2001",
    "prettier": "^3.4.2",
    "prisma": "7.10.1",
    "source-map-support": "^0.5.21",
    "supertest": "^7.0.0",
    "tsx": "^4.23.15",
    "typescript": "^6.0.2",
    "vite": "^8.0.0",
    "vitest": "^4.1.2"
  }
}
```

**apps/server/src/redis/redis.service.ts**

```ts
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
```

**apps/server/src/redis/cache.service.ts**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service.js';

// 旁路缓存（Cache-Aside）的读路径（D22）：先读缓存，没有再读数据库，并把结果写回缓存
// 缓存只是加速，任何缓存错误都不能让请求失败：出错就当没命中，直接走数据库
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  // 命中和未命中的次数，D27 用来算命中率
  readonly stats = { hits: 0, misses: 0, errors: 0 };

  constructor(private readonly redis: RedisService) {}

  async getOrLoad<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        this.stats.hits++;
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      // Redis 不可用、超时、缓存里的内容不是合法的 JSON：都按未命中处理
      this.stats.errors++;
      this.logger.warn(`读缓存失败，回退到数据库：${key}，${(error as Error).message}`);
    }

    this.stats.misses++;
    const value = await loader();
    // 数据库里没有（null）就不写缓存：防穿透的空值缓存留到 D24
    if (value !== null && value !== undefined) {
      try {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      } catch (error) {
        this.stats.errors++;
        this.logger.warn(`写缓存失败：${key}，${(error as Error).message}`);
      }
    }
    return value;
  }
}
```

**apps/server/src/redis/redis.module.ts**

```ts
import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';

// 全局模块（D22）：设备、权限、统计、限流都会用到
@Global()
@Module({
  providers: [RedisService, CacheService],
  exports: [RedisService, CacheService],
})
export class RedisModule {}
```

**apps/server/src/tickets/worklist-stats.ts**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../redis/cache.service.js';
import { visibleTickets } from './scope.js';
@Injectable()
export class WorklistStats {
  constructor(private db:PrismaService,private cache:CacheService) {}
  async count(userId:string) {
    const user=await this.db.user.findUniqueOrThrow({where:{id:userId}});
    const scope=visibleTickets(user);
    const key='worklist:'+JSON.stringify(scope);
    return this.cache.getOrLoad(key,20,()=>this.db.ticket.count({where:scope}));
  }
}
```

**apps/server/src/tickets/tickets.controller.ts**

```ts
import { WorklistStats } from './worklist-stats.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { ListTicketsQuery } from './dto/list-tickets.query.js';
import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { TicketsService, type TicketDetail } from './tickets.service.js';

@RequirePermission('ticket:read')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService, private readonly stats:WorklistStats) {}

  @Get()
  list(@Req() req:AuthenticatedRequest, @Query() query: ListTicketsQuery) {
    return this.ticketsService.list(req.user!.id,query);
  }

  // 用给人看的工单编号查询，不在 URL 里暴露内部主键
  @Get('stats/count')
  total(@Req() req:AuthenticatedRequest) {return this.stats.count(req.user!.id);}

  @Get(':ticketNo')
  findDetail(@Req() req:AuthenticatedRequest, @Param('ticketNo') ticketNo: string): Promise<TicketDetail> {
    return this.ticketsService.findDetail(req.user!.id,ticketNo);
  }
}
```

**apps/server/src/tickets/tickets.module.ts**

```ts
import { WorklistStats } from './worklist-stats.js';
import { TicketWriteController } from './ticket-write.controller.js';
import { TicketCommands } from './ticket-commands.js';
import { SubmitTicket } from './submit-ticket.js';
import { CategoriesController } from './categories.controller.js';
import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

@Module({
  controllers: [TicketsController, CategoriesController, TicketWriteController],
  providers: [WorklistStats, TicketsService, TicketCommands, SubmitTicket],
})
export class TicketsModule {}
```

**apps/server/src/app.module.ts**

```ts
import { RedisModule } from './redis/redis.module.js';
import { AuthModule } from './auth/auth.module.js';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TicketsModule } from './tickets/tickets.module.js';

@Module({
  imports: [RedisModule, PrismaModule, TicketsModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

**apps/server/prisma/scripts/scoped-cache.ts**

```ts
import assert from 'node:assert/strict';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { RedisService } from '../../src/redis/redis.service.js';
import { CacheService } from '../../src/redis/cache.service.js';
import { WorklistStats } from '../../src/tickets/worklist-stats.js';
const db=new PrismaService(), redis=new RedisService();
try {
  await redis.onModuleInit();
  const api=new WorklistStats(db,new CacheService(redis));
  const lin=await db.user.findUniqueOrThrow({where:{username:'lin'}});
  const wu=await db.user.findUniqueOrThrow({where:{username:'wu'}});
  assert.equal(await api.count(lin.id),1);
  assert.equal(await api.count(wu.id),1);
  const keys=await redis.keys('ops:worklist:*');
  assert.ok(keys.some(k=>k.includes(lin.id)) && keys.some(k=>k.includes(wu.id)));
  console.log('甲乙的统计值分别写入独立范围键');
} finally { await db.$disconnect(); await redis.quit(); }
```


## 五、核心面试题

1. 统计值相同为什么不能合并缓存？
2. TTL 能解决什么问题？
3. Redis 不可用时能否退回全公司统计？

结合本日业务样例回答后，再核对[配套面试题](D22-面试题.md)。

## 六、个人建议

把一个失败请求讲清楚：输入是什么、哪一层发现了问题、用户最终看见什么。提交时附实际用时、参考过的提示及运行输出。

## 七、拓展练习

换成乙公司的样例再走一遍，指出预期随数据变化的部分及始终应成立的约束。

## 本文验证范围

隔离 Redis 和真实数据库运行 scoped-cache.ts，两名提单人的统计写入独立范围键。
