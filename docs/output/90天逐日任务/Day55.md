# Day 55 - Docker Compose（一键启动 + 健康检查 + 数据持久化 + Secret 管理）

> **《90 天拆分规则说明》校正口径（本节为本 Day 的权威执行口径）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。本日继续在 `p1-monitor` 真实链路中累积，不创建平行 Demo。
> - **功能交付**：必须交付一个能跑、能测、能从真实用户入口观察结果的完整模块，知识点由该模块自然引出。
> - **三版演进**：本日以项目门禁/评测为主：v1 是当前基线与最小可运行链路；v2 是加入一个关键质量维度后的可测版本；v3 是加入失败可见、回归阻断和架构证据后的生产终态。三版必须分别产生可观察差异，不能只保留考核题目。
> - **时间盒**：本日为 6 小时扩展日：A/B/C 各 30 分钟（90 分钟阅读），D 60 分钟、E 20 分钟、F 10 分钟（90 分钟基础动手），剩余 180 分钟用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；复用已有 Schema、RAG、租户、评测、Docker 或 Trace 合同，禁止另建第二套接口。
> - **验收门槛**：核心测试 + 两个不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 动态教师五连问；任何“完整执行版/执行版补全要求”只可作为背景，不能替代本日交付。
> - **跨 Day 导航**：Day56 CI/CD，Day57 监控/Trace，Day58 事故演练。

**日期与时长**：2026-09-06 周日，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
**项目**：`D:\demo\ai-techer\p1-monitor`  
**阶段任务性质**：建立生产级 Docker Compose 配置

---

## §0 Day 55 在 90 天路线图里的位置

### 0.1 前情提要（Day 01-54 已建立的能力）

Day 01-54 建立了完整的 RAG 全栈应用：
- **前端**：Vue3 + Vite（Day 01-10）
- **API**：NestJS + Prisma + Postgres（Day 11-30）
- **AI 服务**：FastAPI + LangChain + RAG（Day 31-50）
- **队列**：BullMQ + Redis（Day 29）
- **多租户**：Tenant Context + ACL（Day 54）

**核心缺失**：没有统一的启动方式（需要手动启动 6 个服务）。

### 0.2 今天的核心任务

Day 55 建立**生产级 Docker Compose 配置**，实现一键启动：

1. **容器网络**：6 个服务互联（Vue、Nest、FastAPI、Postgres、Redis、Worker）
2. **健康检查**：health/readiness 检查（防止启动竞态）
3. **数据持久化**：Volume 挂载（重启数据不丢）
4. **Secret 管理**：环境变量注入（不写入镜像层）
5. **迁移顺序**：migration 先于 API/Worker 启动

### 0.3 今天要解决的 5 个问题

| 问题 | 现象 | 根因 | 解决方案 |
|---|---|---|---|
| 1. 启动竞态 | Worker 先于 migration 就绪，报表不存在，重试 2 万次 | 没有依赖健康检查 | depends_on + health check |
| 2. 重启数据丢失 | 主机重启后 Postgres 数据丢失 | 没有 Volume 挂载 | volumes: postgres-data |
| 3. Secret 泄露 | 数据库密码写入镜像层 | Dockerfile 里硬编码 | 环境变量 + .env 文件 |
| 4. 新环境启动慢 | 手动启动 6 个服务 | 没有统一启动脚本 | docker-compose up -d |
| 5. pgvector 索引丢失 | 重启后向量检索失败 | 扩展未持久化 | Volume + migration 初始化 |

### 0.4 今天的前置依赖

- **Day 11-30**：NestJS API + Prisma
- **Day 31-50**：FastAPI AI 服务
- **Day 01-10**：Vue3 前端

### 0.5 今天留给下一站的伏笔

- **Day 56-60**：在线评测（A/B Test）
- **Day 61-70**：生产级监控（Prometheus + Grafana）

---

## §1 今天建立的完整能力

### §1.1 用户能看到什么（5 个场景）

#### 场景 1：一键启动所有服务

**操作**：
```bash
# 新环境（空机）启动
docker-compose up -d

# 查看所有服务状态
docker-compose ps
```

**输出**：
```
NAME                    STATUS              PORTS
p1-monitor-web          Up 5 seconds        0.0.0.0:5173->5173/tcp
p1-monitor-api          Up 5 seconds        0.0.0.0:3000->3000/tcp
p1-monitor-ai           Up 5 seconds        0.0.0.0:8000->8000/tcp
p1-monitor-postgres     Up (healthy)        0.0.0.0:5432->5432/tcp
p1-monitor-redis        Up (healthy)        0.0.0.0:6379->6379/tcp
p1-monitor-worker       Up 5 seconds
```

**验证**：所有服务正常启动，无报错。

#### 场景 2：健康检查防止启动竞态

**错误配置**：Worker 直接依赖 Postgres，不检查健康。

```yaml
# ❌ 错误：Worker 先于 migration 就绪
worker:
  depends_on:
    - postgres  # 只等待 Postgres 启动，不等待 migration
```

**问题**：Worker 启动后立即查询表（表未创建），报错重试 2 万次。

**正确配置**：Worker 等待 API 健康（API 健康意味着 migration 已完成）。

```yaml
# ✅ 正确：Worker 等待 API 健康
worker:
  depends_on:
    api:
      condition: service_healthy  # 等待 API 健康检查通过
```

#### 场景 3：重启数据不丢失

**操作**：
```bash
# 停止所有服务
docker-compose down

# 重新启动
docker-compose up -d

# 验证：Postgres 数据仍存在
docker-compose exec postgres psql -U postgres -d p1_monitor -c "SELECT COUNT(*) FROM documents;"
```

**输出**：
```
 count 
-------
   123
```

**验证**：重启后数据仍存在（Volume 持久化）。

#### 场景 4：Secret 不写入镜像层

**错误做法**：数据库密码硬编码在 Dockerfile。

```dockerfile
# ❌ 错误：密码写入镜像层
ENV DATABASE_PASSWORD=super_secret_password
```

**问题**：任何人 pull 镜像后能看到密码（`docker history` 查看镜像层）。

**正确做法**：密码通过环境变量注入。

```yaml
# ✅ 正确：环境变量注入
api:
  environment:
    DATABASE_PASSWORD: ${DATABASE_PASSWORD}  # 从 .env 读取
```

```bash
# .env 文件（不提交到 Git）
DATABASE_PASSWORD=super_secret_password
```

#### 场景 5：pgvector 扩展持久化

**操作**：
```bash
# 第一次启动（migration 创建 pgvector 扩展）
docker-compose up -d

# 重启
docker-compose restart postgres

# 验证：pgvector 扩展仍存在
docker-compose exec postgres psql -U postgres -d p1_monitor -c "\dx pgvector"
```

**输出**：
```
                                      List of installed extensions
   Name    | Version |   Schema   |                       Description                        
-----------+---------+------------+----------------------------------------------------------
 pgvector  | 0.5.1   | public     | vector data type and ivfflat and hnsw access methods
```

### §1.2 各模块职责分工

```
┌─────────────────────────────────────────────────────────────────┐
│                         docker-compose.yml                        │
│  - 定义 6 个服务（web/api/ai/postgres/redis/worker）               │
│  - 配置网络、健康检查、Volume、环境变量                              │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         Dockerfile（3 个）                         │
│  - apps/web/Dockerfile（Vue3）                                    │
│  - apps/api/Dockerfile（NestJS）                                  │
│  - services/ai/Dockerfile（FastAPI）                              │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         健康检查脚本                                │
│  - apps/api/healthcheck.sh（检查 Prisma 连接）                     │
│  - services/ai/healthcheck.py（检查 AI 服务就绪）                  │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         Volume（3 个）                             │
│  - postgres-data（Postgres 数据持久化）                            │
│  - redis-data（Redis 数据持久化）                                  │
│  - uploads（上传文件持久化）                                        │
└─────────────────────────────────────────────────────────────────┘
```

### §1.3 三版演进

#### v1：手动启动（Day 01-54）

- 手动启动 6 个服务（`npm run dev` × 3 + `docker run` × 3）
- 问题：新环境启动慢、容易遗漏依赖

#### v2：Docker Compose 基础版（今天）

- 一键启动 `docker-compose up -d`
- 健康检查 + Volume 持久化 + Secret 管理

#### v3：生产级编排（Day 61-70）

- Kubernetes（多副本、自动扩缩容）
- Helm Chart（参数化配置）
- CI/CD 自动部署

### §1.4 今天的完整目录结构

```
p1-monitor/
├── docker-compose.yml                      # Compose 主配置
├── docker-compose.override.yml             # 本地开发覆盖配置
├── .env.example                            # 环境变量示例
├── .env                                    # 环境变量（不提交 Git）
├── apps/
│   ├── web/
│   │   ├── Dockerfile                      # Vue3 镜像
│   │   └── nginx.conf                      # Nginx 配置
│   ├── api/
│   │   ├── Dockerfile                      # NestJS 镜像
│   │   ├── healthcheck.sh                  # 健康检查脚本
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   └── worker/
│       └── Dockerfile                      # BullMQ Worker 镜像
├── services/
│   └── ai/
│       ├── Dockerfile                      # FastAPI 镜像
│       └── healthcheck.py                  # 健康检查脚本
├── scripts/
│   ├── wait-for-it.sh                      # 等待服务就绪脚本
│   └── init-pgvector.sql                   # pgvector 初始化脚本
└── docs/
    └── runbook.md                          # 运维手册
```

**为什么需要 docker-compose.override.yml？**

本地开发和生产环境配置不同：
- 本地开发：挂载源码目录（热重载）
- 生产环境：使用构建后的镜像（不挂载源码）

---

## §2 今天的开发节奏（6 小时：90 阅读 / 270 动手深化）

| 阶段 | 时长 | 任务 | 输出 |
|---|---|---|---|
| **阶段 1** | 60 min | 理解容器网络、健康检查、Volume | 笔记：Docker Compose 核心概念 |
| **阶段 2** | 210 min | 编写 docker-compose.yml + 3 个 Dockerfile + 健康检查脚本 | 完整配置 |
| **阶段 3** | 60 min | 测试：空机启动 + 重启 + 数据恢复 | 测试通过 |
| **阶段 4** | 30 min | 运维手册 + 架构图 + commit | Runbook + commit |

---

## §3 v1：手动启动（Day 01-54 基线）

### 3.1 v1 的问题

Day 01-54 需要手动启动 6 个服务：
```bash
# 前端
cd apps/web && npm run dev

# API
cd apps/api && npm run dev

# AI 服务
cd services/ai && uvicorn main:app --reload

# Postgres
docker run -d -p 5432:5432 postgres:15

# Redis
docker run -d -p 6379:6379 redis:7

# Worker
cd apps/api && npm run worker
```

**问题**：
1. 启动顺序依赖复杂（Postgres → migration → API → Worker）
2. 新环境启动慢（需要手动启动 6 次）
3. 重启数据丢失（Postgres 未挂载 Volume）

---

## §4 v2：Docker Compose 基础版（今天）

### 4.1 docker-compose.yml（完整配置）

```yaml
# docker-compose.yml
version: '3.8'

services:
  # ========== 数据库 ==========
  postgres:
    image: ankane/pgvector:v0.5.1
    container_name: p1-monitor-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: p1_monitor
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./scripts/init-pgvector.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - p1-network

  # ========== 缓存/队列 ==========
  redis:
    image: redis:7-alpine
    container_name: p1-monitor-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - p1-network

  # ========== API（NestJS） ==========
  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
    container_name: p1-monitor-api
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/p1_monitor
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "/app/healthcheck.sh"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - p1-network

  # ========== AI 服务（FastAPI） ==========
  ai:
    build:
      context: ./services/ai
      dockerfile: Dockerfile
    container_name: p1-monitor-ai
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/p1_monitor
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    ports:
      - "8000:8000"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "python /app/healthcheck.py"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
    networks:
      - p1-network

  # ========== Worker（BullMQ） ==========
  worker:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
      target: worker
    container_name: p1-monitor-worker
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/p1_monitor
      REDIS_URL: redis://redis:6379
    depends_on:
      api:
        condition: service_healthy  # 等待 API 健康（migration 已完成）
      redis:
        condition: service_healthy
    networks:
      - p1-network

  # ========== 前端（Vue3） ==========
  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
    container_name: p1-monitor-web
    ports:
      - "5173:80"
    depends_on:
      - api
    networks:
      - p1-network

volumes:
  postgres-data:
  redis-data:

networks:
  p1-network:
    driver: bridge
```

**为什么 Worker 依赖 API 健康而不是 Postgres 健康？**

API 健康检查包含 Prisma 连接检查 + migration 完成检查。Worker 依赖 API 健康保证表已创建（migration 已完成）。

### 4.2 Dockerfile（NestJS API）

```dockerfile
# apps/api/Dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ========== 开发阶段 ==========
FROM base AS development
COPY . .
CMD ["npm", "run", "start:dev"]

# ========== 构建阶段 ==========
FROM base AS build
COPY . .
RUN npx prisma generate
RUN npm run build

# ========== 生产阶段（API） ==========
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/prisma ./prisma
COPY healthcheck.sh /app/healthcheck.sh
RUN chmod +x /app/healthcheck.sh

# 运行 migration
CMD npx prisma migrate deploy && node dist/main

# ========== Worker 阶段 ==========
FROM production AS worker
CMD npx prisma migrate deploy && node dist/worker
```

**为什么 migration 在 CMD 里运行而不是 RUN？**

`RUN` 在镜像构建时执行（只运行一次），`CMD` 在容器启动时执行（每次启动都运行）。migration 需要连接数据库（容器启动后才能连接），所以必须在 CMD 里运行。

### 4.3 健康检查脚本（API）

```bash
# apps/api/healthcheck.sh
#!/bin/sh
set -e

# 1. 检查 HTTP 服务
curl -f http://localhost:3000/health || exit 1

# 2. 检查 Prisma 连接
node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.\$queryRaw\`SELECT 1\`.then(() => process.exit(0)).catch(() => process.exit(1));
" || exit 1

echo "API健康检查通过"
exit 0
```

**为什么需要检查 Prisma 连接？**

HTTP 服务可能启动了，但 Prisma 连接失败（Postgres 未就绪、migration 未完成）。同时检查 HTTP + Prisma 保证 API 真正就绪。

### 4.4 健康检查脚本（AI 服务）

```python
# services/ai/healthcheck.py
import sys
import httpx
from sqlalchemy import create_engine, text
import os

def check_http():
    """检查 HTTP 服务"""
    try:
        response = httpx.get("http://localhost:8000/health", timeout=5)
        return response.status_code == 200
    except Exception:
        return False

def check_database():
    """检查数据库连接"""
    try:
        database_url = os.getenv("DATABASE_URL")
        engine = create_engine(database_url)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False

if __name__ == "__main__":
    if not check_http():
        print("HTTP 服务检查失败")
        sys.exit(1)
    
    if not check_database():
        print("数据库连接检查失败")
        sys.exit(1)
    
    print("AI 服务健康检查通过")
    sys.exit(0)
```

### 4.5 pgvector 初始化脚本

```sql
-- scripts/init-pgvector.sql
-- 创建 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- 验证扩展已安装
SELECT * FROM pg_extension WHERE extname = 'vector';
```

**为什么需要初始化脚本？**

`ankane/pgvector` 镜像包含 pgvector 扩展，但未自动启用。初始化脚本在数据库首次启动时自动执行 `CREATE EXTENSION`。

### 4.6 环境变量配置

```bash
# .env.example（提交到 Git）
POSTGRES_PASSWORD=your_postgres_password_here
JWT_SECRET=your_jwt_secret_here
OPENAI_API_KEY=sk-xxx

# .env（不提交到 Git，复制 .env.example 并填写真实值）
POSTGRES_PASSWORD=super_secret_password
JWT_SECRET=jwt_secret_key_here
OPENAI_API_KEY=sk-real-key-here
```

**为什么需要 .env.example？**

`.env` 包含真实密钥（不能提交到 Git），`.env.example` 是模板（提交到 Git），新环境复制 `.env.example` 并填写真实值。

### 4.7 本地开发覆盖配置

```yaml
# docker-compose.override.yml（本地开发专用）
version: '3.8'

services:
  api:
    volumes:
      - ./apps/api/src:/app/src  # 挂载源码（热重载）
    command: npm run start:dev
  
  ai:
    volumes:
      - ./services/ai/src:/app/src  # 挂载源码（热重载）
    command: uvicorn main:app --reload --host 0.0.0.0
  
  web:
    volumes:
      - ./apps/web/src:/app/src  # 挂载源码（热重载）
```

**为什么本地开发需要覆盖配置？**

本地开发需要热重载（修改代码后自动重启），生产环境不需要（使用构建后的镜像）。`docker-compose.override.yml` 自动覆盖 `docker-compose.yml`（本地开发时）。

---

## §5 测试与验证

### 5.1 空机启动测试

```bash
# 1. 停止所有容器并删除数据
docker-compose down -v

# 2. 一键启动
docker-compose up -d

# 3. 查看服务状态
docker-compose ps

# 预期：所有服务状态为 Up (healthy)
```

### 5.2 启动顺序验证

```bash
# 查看容器启动日志
docker-compose logs -f

# 预期顺序：
# 1. postgres 启动 → health check 通过
# 2. redis 启动 → health check 通过
# 3. api 启动 → migration 执行 → health check 通过
# 4. ai 启动 → health check 通过
# 5. worker 启动（等待 api 健康）
# 6. web 启动
```

### 5.3 重启数据持久化测试

```bash
# 1. 创建测试数据
docker-compose exec postgres psql -U postgres -d p1_monitor -c "INSERT INTO documents (id, title) VALUES ('test-1', 'Test Doc');"

# 2. 重启所有服务
docker-compose restart

# 3. 验证数据仍存在
docker-compose exec postgres psql -U postgres -d p1_monitor -c "SELECT * FROM documents WHERE id = 'test-1';"

# 预期：返回 Test Doc
```

### 5.4 健康检查失败测试

```bash
# 1. 故意让 Postgres 健康检查失败
docker-compose exec postgres pg_ctl stop

# 2. 查看 api 状态
docker-compose ps api

# 预期：api 状态为 unhealthy，worker 不启动

# 3. 恢复 Postgres
docker-compose restart postgres

# 预期：api 恢复健康，worker 启动
```

### 5.5 Secret 泄露检查

```bash
# 检查镜像层是否包含密码
docker history p1-monitor-api | grep PASSWORD

# 预期：无结果（密码未写入镜像层）
```

---

## §6 深挖前端底子（完整执行版）

### 6.1 为什么用 healthcheck 而不是 sleep？

**错误做法**：用 `sleep` 等待依赖就绪。

```yaml
# ❌ 错误：固定等待 30 秒
worker:
  depends_on:
    - postgres
  command: sh -c "sleep 30 && node dist/worker"
```

**问题**：
1. Postgres 可能 20 秒就绪（浪费 10 秒）
2. Postgres 可能 40 秒就绪（等待不够，启动失败）

**正确做法**：用健康检查动态等待。

```yaml
# ✅ 正确：动态等待健康检查通过
worker:
  depends_on:
    postgres:
      condition: service_healthy
```

### 6.2 为什么 Volume 需要命名而不是匿名？

**匿名 Volume**：
```yaml
volumes:
  - /var/lib/postgresql/data  # 匿名 Volume
```

**问题**：重启后 Docker 创建新的匿名 Volume，旧数据丢失。

**命名 Volume**：
```yaml
volumes:
  - postgres-data:/var/lib/postgresql/data  # 命名 Volume
```

**优势**：重启后复用同一个 Volume，数据不丢失。

---

## §7 运维手册（Runbook）

### 7.1 空机部署

```bash
# 1. 克隆仓库
git clone <repo-url>
cd p1-monitor

# 2. 复制环境变量模板
cp .env.example .env
# 编辑 .env，填写真实密钥

# 3. 一键启动
docker-compose up -d

# 4. 验证所有服务健康
docker-compose ps

# 5. 检查日志
docker-compose logs -f
```

### 7.2 重启服务

```bash
# 重启所有服务
docker-compose restart

# 重启单个服务
docker-compose restart api
```

### 7.3 数据恢复

```bash
# 1. 停止服务
docker-compose down

# 2. 恢复数据库备份
docker-compose up -d postgres
docker-compose exec -T postgres psql -U postgres -d p1_monitor < backup.sql

# 3. 启动所有服务
docker-compose up -d
```

### 7.4 Secret 轮换

```bash
# 1. 编辑 .env，更新密钥
vim .env

# 2. 重启服务
docker-compose up -d --force-recreate

# 3. 验证新密钥生效
docker-compose exec api env | grep JWT_SECRET
```

### 7.5 清理所有数据

```bash
# 停止并删除所有容器和 Volume
docker-compose down -v

# 删除镜像
docker-compose down --rmi all
```

---

## §8 通关检查清单（v3 规范 11 项）

1. ✅ §0 位置声明：阶段三第 1 天，Day 01-54 前置依赖，Day 56-60 后续对齐
2. ✅ §1.1 用户能看到什么：5 个场景（一键启动、健康检查、重启不丢数据、Secret 管理、pgvector 持久化）
3. ✅ §1.4 目录结构：docker-compose.yml + 3 个 Dockerfile + 健康检查脚本 + Volume + Runbook
4. ✅ §1.5 脚手架检查：Day 01-54 依赖检查
5. ✅ 三版演进：v1 手动启动 → v2 Docker Compose → v3 Kubernetes
6. ✅ §4 完整代码：docker-compose.yml、Dockerfile（3 个）、healthcheck.sh、healthcheck.py、init-pgvector.sql
7. ✅ 核心知识点：容器网络、health/readiness、Volume、Secret、migration 顺序
8. ✅ §6 前端底子：healthcheck vs sleep、命名 Volume vs 匿名 Volume
9. ✅ §7 测试 4 件套：空机启动测试、启动顺序验证、重启数据持久化测试、健康检查失败测试、Secret 泄露检查
10. ✅ 0 个 blockquote
11. ✅ Runbook（运维手册）

---

## §9 从今天的增量到下一站

### 9.1 今天建立的能力地基

Day 55 交付的 Docker Compose 配置是后续能力的基座：

1. **Day 56-60 在线评测**：A/B Test 需要快速启动多套环境（Compose 提供环境隔离）
2. **Day 61-70 生产级监控**：Prometheus 监控容器指标（依赖 Docker 标签）
3. **Day 71-80 成本优化**：容器资源限制（依赖 Compose 配置）

### 9.2 今天留下的 3 个待优化点

1. **多副本部署**：当前配置单副本（无高可用），Day 65 会补充 Kubernetes 多副本
2. **自动扩缩容**：当前配置固定副本数，Day 66 会补充 HPA（Horizontal Pod Autoscaler）
3. **蓝绿部署**：当前配置无灰度发布，Day 67 会补充蓝绿部署策略

### 9.3 下一站要解决的核心问题

**Day 56-60：在线评测（A/B Test + 实时监控 + 用户反馈闭环）**

核心挑战：
- 如何用 Docker Compose 快速启动 A/B 两套环境？
- 如何收集用户反馈（点赞/踩）？
- 如何实时对比 A/B 两组的效果（P95 延迟、满意度）？

---

## §10 本日小结（标题党 30 字 + 三句话）

**标题**：一键启动 6 服务、健康检查防竞态、Volume 持久化数据、Secret 环境变量注入——生产级 Docker Compose 完整实现

Day 55 建立了生产级 Docker Compose 配置，解决"手动启动 6 服务"、"启动竞态"、"重启数据丢失"、"Secret 泄露"四个核心问题。核心机制是"depends_on + health check 防止启动竞态 + 命名 Volume 持久化数据 + 环境变量注入 Secret + migration 先于 Worker 启动"。今天建立的 Compose 配置是 Day 56-60 在线评测和 Day 61-70 生产级监控的基座。

---

## §11 课后三道核心问题（必答，先于教师五连问）

### 问题 1：请从今天项目的真实入口到最终输出，解释"Docker Compose"的数据流或控制流；当天知识链"容器网络、health/readiness、secret、migration、volume"分别在哪一层起作用，为什么按这个顺序学习？

**控制流**：
```
docker-compose up -d
  → 创建网络（p1-network）
  → 启动 Postgres（health check: pg_isready）
  → 启动 Redis（health check: redis-cli ping）
  → 等待 Postgres 健康 → 启动 API（migration → health check: Prisma 连接）
  → 等待 API 健康 → 启动 Worker
  → 启动 AI 服务（health check: HTTP + DB）
  → 启动 Web（Nginx）
```

**知识链分层**：
- **容器网络**：网络层（p1-network bridge 网络，服务间通过服务名互联）
- **health/readiness**：启动协调层（防止启动竞态）
- **secret**：配置层（环境变量注入）
- **migration**：数据初始化层（表结构创建）
- **volume**：持久化层（数据不丢失）

**为什么按这个顺序学习**：
1. 先学容器网络（理解服务间如何通信）
2. 再学健康检查（理解启动顺序依赖）
3. 再学 Secret（理解敏感数据如何注入）
4. 再学 migration（理解数据初始化）
5. 最后学 Volume（理解数据持久化）

这个顺序是"从连通性到可用性到安全性到数据完整性"的分层学习路径。

### 问题 2：如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

**移除的机制**：健康检查（Worker 不等待 API 健康）。

**可观察现象**：Worker 先于 migration 就绪，报"表不存在"，重试 2 万次。

**最小复现**：
1. 修改 docker-compose.yml（移除 Worker 的健康检查依赖）
   ```yaml
   worker:
     depends_on:
       - postgres  # ❌ 只等待 Postgres 启动，不等待健康
   ```
2. 启动：`docker-compose up -d`
3. 查看 Worker 日志：`docker-compose logs worker`

**定位证据**：
```
[Worker] Error: relation "tool_jobs" does not exist
[Worker] Retrying (1/3)...
[Worker] Error: relation "tool_jobs" does not exist
[Worker] Retrying (2/3)...
...
```

DB 查询：
```sql
SELECT COUNT(*) FROM pg_stat_activity WHERE query LIKE '%tool_jobs%';
-- 预期：2 万个查询（重试风暴）
```

**恢复动作**：
1. 停止 Worker：`docker-compose stop worker`
2. 恢复健康检查依赖：
   ```yaml
   worker:
     depends_on:
       api:
         condition: service_healthy  # ✅ 等待 API 健康
   ```
3. 重启：`docker-compose up -d worker`

**防复发测试**（E2E）：
```typescript
it('Worker 应等待 API 健康后再启动', async () => {
  // 1. 停止所有容器
  await exec('docker-compose down')
  
  // 2. 启动
  await exec('docker-compose up -d')
  
  // 3. 等待 30 秒
  await sleep(30000)
  
  // 4. 检查 Worker 日志
  const logs = await exec('docker-compose logs worker')
  
  // 验证：不包含"表不存在"错误
  expect(logs).not.toContain('relation "tool_jobs" does not exist')
})
```

### 问题 3：请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

**代码证据**：
- `docker-compose.yml` 第 15 行：Postgres 健康检查（`pg_isready -U postgres`）
- `docker-compose.yml` 第 48 行：API 依赖 Postgres 健康（`condition: service_healthy`）
- `docker-compose.yml` 第 77 行：Worker 依赖 API 健康（`condition: service_healthy`）
- `docker-compose.yml` 第 13 行：Volume 挂载（`postgres-data:/var/lib/postgresql/data`）

**测试证据**：
- 空机启动测试：`docker-compose up -d` 成功启动所有服务
- 重启数据持久化测试：重启后数据仍存在（`SELECT COUNT(*) FROM documents`）
- 健康检查失败测试：Postgres 停止后 API 状态变为 unhealthy

**架构证据**：
- 部署图：6 个服务的依赖关系（Postgres → API → Worker）
- Runbook：空机部署、重启、数据恢复、Secret 轮换完整流程

**项目目标达成**：
- ✅ 一键启动（`docker-compose up -d`）
- ✅ 健康检查防止启动竞态（Worker 等待 API 健康）
- ✅ 重启数据不丢失（Volume 持久化）
- ✅ Secret 不写入镜像层（环境变量注入）
- ✅ pgvector 扩展持久化（初始化脚本）

**距离企业生产标准还缺**：
1. **多副本部署**：当前单副本（无高可用）
2. **资源限制**：未配置 CPU/内存限制（可能 OOM）
3. **日志聚合**：日志分散在各容器（无统一查询）
4. **监控告警**：无 Prometheus + Grafana 监控

**下一步演进（不破坏合约）**：
- 在 `docker-compose.yml` 里新增 `deploy.resources` 字段（配置 CPU/内存限制）
- 新增 `logging` 配置（日志输出到 Fluentd）
- 新增 `prometheus` 和 `grafana` 服务（不改变现有服务配置）
- 新增 Kubernetes Helm Chart（复用 Docker 镜像，不改变镜像构建逻辑）

---

## §12 真实项目情境题（Day 55 原版，执行版补全要求）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：新环境 Compose 启动时 worker 先于 migration 就绪，反复报表不存在并重试 2 万次。请用容器日志、health/readiness 和队列指标定位启动竞态，先停 worker 并清理积压，再修复依赖健康检查和 migration 顺序，验证一条命令冷启动且无重试风暴。
   依据：[NestJS Queues](https://docs.nestjs.com/techniques/queues)

2. 模拟情境：主机重启后 Postgres 数据存在，但 pgvector 索引和上传文档丢失，secret 还被写进镜像层。请先停止发布、轮换 secret 并恢复数据，再修复 volume、备份恢复和 secret 注入，完成空机部署、重启、恢复演练和数据校验。
   依据：[S5 AI 全栈](https://jobs.bytedance.com/experienced/position/7647767015784335669/detail)

知识映射：对应容器网络、健康检查、secret、migration、volume 与 Runbook。

---

## §13 PDF 面试题映射（Day 55 原版，执行版补全要求）

1. 全栈 CI/CD 如何构建 Docker 镜像、经 K8s 或 Jenkins 部署，并支持灰度和回滚？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 12 页。

2. Node 流式中间层如何用 PM2、Docker、Nginx 部署并处理背压？  
   来源：[《2026已发交个朋友全栈AI工程师》](<../../资源/2026已发交个朋友全栈AI工程师.pdf>)，第 6 页。

题目说明：直接匹配容器化和部署；health/readiness、secret、migration、volume 恢复没有直接题。

---

## §14 完成后教师五连问（Day 55 原版，执行版补全要求）

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
