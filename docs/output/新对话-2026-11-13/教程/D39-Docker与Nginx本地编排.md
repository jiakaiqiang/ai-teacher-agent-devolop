# D39：Docker 与 Nginx 本地编排

第 6 周 · 2 小时 · 前置 [D38-健康检查与优雅关闭](D38-健康检查与优雅关闭.md)。

## 今天要做出什么

用原容器与代理入口启动新版服务

## 今天的目录结构

- `.dockerignore`
- `Dockerfile.server`
- `Dockerfile.web`
- `infra/docker-compose.local.yml`
- `infra/nginx/local.conf`
- `apps/server/package.json`
- `apps/server/src/app.setup.ts`
- `apps/server/src/app.module.ts`

## 时间安排

回忆 10 分钟、知识点 35 分钟、动手 55 分钟、自检与提交 20 分钟。超时先保留主用例与一个失败反例，扩展实验留到周日。

## 零、闭卷回忆

镜像构建与启动后的数据库迁移分别需要什么？工作台通过代理路由到哪个后端？

## 一、知识点与推导

多阶段构建先生成共享契约和 Prisma 客户端，再产出 Node 运行镜像；Nginx 处理静态资源、API 和 SSE。前端路由刷新的回退和流式代理超时需要分开验证。

## 二、动手开发

先用 compose config --services 查看 postgres、redis、queue、server、web。准备学员项目的 pnpm 锁文件，按 Dockerfile 构建镜像并启动，先迁移测试库再进入工单列表。

## 三、自检与提交

从代理访问 health/ready 和一条已登录工单。提交容器健康状态、SSE 断流或缓冲的复现方法以及恢复记录。

## 四、本章完整源码

**.dockerignore**

```text
# 构建上下文不能带入本机依赖、产物、历史和凭据。
**/node_modules
**/dist
**/.env
**/.env.*
.git
.cache
**/*.log
**/*.tsbuildinfo
apps/server/src/generated
```

**Dockerfile.server**

```text
# 两阶段使用同一个已记录的 Node 镜像，避免原生依赖跨 libc。
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /workspace
RUN npm install --global pnpm@10.28.0
COPY . .
RUN --mount=type=cache,id=ops-ticket-pnpm10,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store --registry=https://registry.npmmirror.com --network-concurrency=4
# generate 只需要语法正确的 URL；构建时不连接数据库，也不传运行密钥。
RUN DATABASE_URL=postgresql://unused:unused@127.0.0.1:5432/unused pnpm --filter @ops-ticket/server exec prisma generate --config prisma7.config.ts
RUN pnpm --filter @ops-ticket/shared build && pnpm --filter @ops-ticket/server build
RUN --mount=type=cache,id=ops-ticket-pnpm10,target=/pnpm/store pnpm --filter @ops-ticket/server deploy --prod --offline --store-dir /pnpm/store /runtime

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /runtime/ ./
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
```

**Dockerfile.web**

```text
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /workspace
RUN npm install --global pnpm@10.28.0
COPY . .
RUN --mount=type=cache,id=ops-ticket-pnpm10,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store --registry=https://registry.npmmirror.com --network-concurrency=4
RUN pnpm --filter @ops-ticket/shared build && pnpm --filter @ops-ticket/web build

FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
COPY --from=build /workspace/apps/web/dist/ /usr/share/nginx/html/
COPY infra/nginx/local.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**infra/docker-compose.local.yml**

```text
# 叠加到依赖 compose；只连接已授权的测试库与 Redis 1，禁止并行运行重建测试库。
services:
  server:
    build:
      context: ..
      dockerfile: Dockerfile.server
    image: ops-ticket-course-v2-server:local
    init: true
    environment:
      DATABASE_URL: postgresql://ops:ops_local_only@postgres:5432/ops_ticket_test?schema=public
      REDIS_URL: redis://redis:6379/1
      QUEUE_REDIS_URL: redis://queue:6379/1
      JWT_SECRET: ${JWT_SECRET:?通过当前进程环境注入，不写入文件}
      SLA_SCAN_INTERVAL_MS: '0'
      OUTBOX_RELAY_INTERVAL_MS: '0'
      PORT: '3000'
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      queue: { condition: service_started }
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 3s
      timeout: 2s
      retries: 15
    stop_grace_period: 30s
  web:
    build:
      context: ..
      dockerfile: Dockerfile.web
    image: ops-ticket-course-v2-web:local
    ports:
      - '127.0.0.1:8088:80'
    # 本机验证方便单点修改并 reload；最终镜像也含同一份默认配置。
    volumes:
      - ./nginx/local.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      server: { condition: service_healthy }
    stop_grace_period: 10s
```

**infra/nginx/local.conf**

```text
# 不记录查询串，SSE 的一次性票据不能进入访问日志。
log_format safe '$request_method $uri $status $request_time';
server {
    listen 80;
    server_name localhost;
    access_log /var/log/nginx/access.log safe;
    root /usr/share/nginx/html;

    location /api/ {
        # 不加尾斜线：保留 /api 前缀交给 Nest。
        proxy_pass http://server:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Request-ID $http_x_request_id;
        proxy_set_header Connection "";
        # 由这里显式控制缓冲，避免上游头让反证中的错误配置被掩盖。
        proxy_ignore_headers X-Accel-Buffering;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 75s;
        proxy_connect_timeout 2s;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
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
    "db:seed": "prisma db seed",
    "worker": "tsx src/queue/start-worker.ts"
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
    "ioredis": "6.0.0",
    "bullmq": "6.7.6",
    "@nestjs/terminus": "12.2.0",
    "prom-client": "15.1.3"
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

**apps/server/src/app.setup.ts**

```ts
import { requestContextMiddleware } from './common/request-context.js';
import { httpLogMiddleware } from './common/http-log.middleware.js';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { ResponseInterceptor } from './common/response.interceptor.js';

// 所有全局配置集中在这里，main.ts 和接口测试调用同一个函数，两边不会不一致
export function configureApp(app: INestApplication): void {
  app.use(requestContextMiddleware);
  app.use(httpLogMiddleware);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // 去掉 DTO 里没声明的字段
      forbidNonWhitelisted: true, // 多传字段直接 400，而不是悄悄忽略
      transform: true, // 把参数转成 DTO 类型，例如字符串 '1' 转成数字 1
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
}
```

**apps/server/src/app.module.ts**

```ts
import { HealthModule } from './health/health.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AuthModule } from './auth/auth.module.js';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TicketsModule } from './tickets/tickets.module.js';

@Module({
  imports: [HealthModule, RedisModule, PrismaModule, TicketsModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

**pnpm-workspace.yaml**

```text
# 声明哪些目录是工作区里的包：apps 放可运行的应用，packages 放被应用共享的库
packages:
  - apps/*
  - packages/*
# pnpm 10 的 deploy 从共享锁文件派生运行包；构建后同步 shared 的注入副本。
injectWorkspacePackages: true
syncInjectedDepsAfterScripts:
  - build
```

## 五、核心面试题

1. 为什么运行镜像无需携带编译器？
2. 代理缓冲影响哪种响应？
3. 容器内 localhost 指向谁？

结合本日业务样例回答后，再核对[配套面试题](D39-面试题.md)。

## 六、个人建议

把一个失败请求讲清楚：输入是什么、哪一层发现了问题、用户最终看见什么。提交时附实际用时、参考过的提示及运行输出。

## 七、拓展练习

换成乙公司的样例再走一遍，指出预期随数据变化的部分及始终应成立的约束。

## 本文验证范围

已用 docker compose config 验证新版两个 Compose 文件及服务依赖。全新镜像构建与新环境启动仍需单独复验。

本地用冻结的 pnpm 锁文件构建了 server 和 web 两个镜像。构建结果见[镜像摘要](../学习记录/新版验收/D39-images.json)。在当前手写工程执行 pnpm install 生成并保存 pnpm-lock.yaml，随 package.json 一起进入构建上下文。
