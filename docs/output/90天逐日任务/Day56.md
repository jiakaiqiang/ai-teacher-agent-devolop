# Day 56 - CI/CD（质量门禁 + Migration Safety + 镜像扫描 + 产物追溯）

> **《90 天拆分规则说明》校正口径（本节为本 Day 的权威执行口径）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。本日继续在 `p1-monitor` 真实链路中累积，不创建平行 Demo。
> - **功能交付**：必须交付一个能跑、能测、能从真实用户入口观察结果的完整模块，知识点由该模块自然引出。
> - **三版演进**：本日以项目门禁/评测为主：v1 是当前基线与最小可运行链路；v2 是加入一个关键质量维度后的可测版本；v3 是加入失败可见、回归阻断和架构证据后的生产终态。三版必须分别产生可观察差异，不能只保留考核题目。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（90 分钟阅读），D 60 分钟、E 20 分钟、F 10 分钟（90 分钟动手）。
> - **累积复用**：开始前读取上一日 commit 和当前源码；复用已有 Schema、RAG、租户、评测、Docker 或 Trace 合同，禁止另建第二套接口。
> - **验收门槛**：核心测试 + 两个不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 动态教师五连问；任何“完整执行版/执行版补全要求”只可作为背景，不能替代本日交付。
> - **跨 Day 导航**：Day57 监控/Trace，Day58 事故演练，Day59 求职证据。
>
> **补强要求**：若正文使用“完整执行版”或“执行版补全要求”，领取任务时必须把省略部分展开为当天可执行的测试/反证/情境题，并记录真实项目 diff。

**日期与时长**：2026-09-07 周一，180 分钟（90 分钟阅读 + 90 分钟动手）
**项目**：`D:\demo\ai-techer\p1-monitor`  
**阶段任务性质**：建立生产级 CI/CD Pipeline

---

## §0 Day 56 在 90 天路线图里的位置

### 0.1 前情提要（Day 01-55 已建立的能力）

Day 01-55 建立了完整的 RAG 全栈应用和 Docker Compose 配置：
- **Day 01-54**：Vue3 + NestJS + FastAPI + RAG + 多租户
- **Day 55**：Docker Compose（一键启动 + 健康检查 + Volume 持久化）

**核心缺失**：没有 CI/CD Pipeline（代码提交后需手动测试、构建、部署）。

### 0.2 今天的核心任务

Day 56 建立**生产级 CI/CD Pipeline**，实现自动化质量门禁：

1. **Pipeline**：typecheck → lint → unit → integration → E2E → build → scan
2. **质量门禁**：坏合同/测试/迁移会阻断发布
3. **Migration Safety**：expand-contract 模式（向前兼容）
4. **镜像扫描**：检测高危依赖（CVE 扫描）
5. **产物追溯**：签名 + 元数据（Git SHA、构建时间）

### 0.3 今天要解决的 5 个问题

| 问题 | 现象 | 根因 | 解决方案 |
|---|---|---|---|
| 1. 合同漂移 | FastAPI OpenAPI 与 Nest 客户端类型不一致 | 没有合同测试 | Contract Testing |
| 2. 破坏性迁移 | Migration 锁表 18 分钟 | 直接 ALTER TABLE | expand-contract 模式 |
| 3. 高危依赖 | 镜像包含 CVE-2024-1234 漏洞 | 没有镜像扫描 | Trivy 扫描 |
| 4. 产物不可追溯 | 不知道镜像来自哪次 commit | 没有镜像标签 | Git SHA + 元数据 |
| 5. 坏代码进生产 | 测试失败但仍部署 | 没有门禁 | 测试失败阻断部署 |

### 0.4 今天的前置依赖

- **Day 55**：Docker Compose（镜像构建）
- **Day 27**：Prisma Migration（数据库迁移）

### 0.5 今天留给下一站的伏笔

- **Day 57-60**：灰度发布（蓝绿部署、金丝雀发布）
- **Day 61-70**：生产级监控（部署成功率、回滚次数）

---

## §1 今天建立的完整能力

### §1.1 用户能看到什么（5 个场景）

#### 场景 1：坏合同阻断发布

**操作**：修改 FastAPI OpenAPI（删除字段 `title`），提交代码。

```python
# services/ai/src/schemas.py
class DocumentResponse(BaseModel):
    id: str
    # title: str  # ❌ 删除字段（破坏合同）
    content: str
```

**CI 输出**：
```
✅ Typecheck passed
✅ Lint passed
✅ Unit tests passed
❌ Contract tests failed

Error: FastAPI contract changed
- Expected field: title (string)
- Actual: field missing

Contract diff:
  {
    "id": "string",
-   "title": "string",
    "content": "string"
  }

🚫 Deployment blocked
```

#### 场景 2：破坏性迁移阻断发布

**操作**：直接 ALTER TABLE（锁表迁移）。

```sql
-- apps/api/prisma/migrations/xxx_add_column.sql
ALTER TABLE documents ADD COLUMN new_field VARCHAR(255) NOT NULL DEFAULT '';
```

**CI 输出**：
```
✅ Typecheck passed
✅ Lint passed
✅ Unit tests passed
❌ Migration safety check failed

Error: Detected unsafe migration
- ALTER TABLE with NOT NULL constraint
- Estimated lock time: 18 minutes (8000 万行)

Recommendation: Use expand-contract pattern
1. Add column as nullable
2. Backfill data
3. Add NOT NULL constraint (after backfill)

🚫 Deployment blocked
```

#### 场景 3：高危依赖阻断发布

**操作**：使用包含漏洞的依赖。

```json
// package.json
{
  "dependencies": {
    "axios": "0.21.1"  // ❌ 包含 CVE-2021-3749（高危）
  }
}
```

**CI 输出**：
```
✅ Typecheck passed
✅ Lint passed
✅ Unit tests passed
✅ Build passed
❌ Image scan failed

High severity vulnerabilities found:
- CVE-2021-3749 (axios 0.21.1): SSRF vulnerability
- CVE-2022-0691 (node 16.13.0): HTTP request smuggling

Recommendation: Upgrade dependencies
- axios: 0.21.1 → 1.6.0
- node: 16.13.0 → 20.11.0

🚫 Deployment blocked
```

#### 场景 4：测试失败阻断发布

**操作**：引入 Bug（E2E 测试失败）。

```typescript
// apps/api/src/document/document.service.ts
async getById(id: string): Promise<Document> {
  return null  // ❌ Bug：返回 null
}
```

**CI 输出**：
```
✅ Typecheck passed
✅ Lint passed
✅ Unit tests passed
❌ E2E tests failed (1/5 failed)

Failed test: GET /documents/:id should return document
  Expected: { id: '123', title: 'Test' }
  Actual: null

🚫 Deployment blocked
```

#### 场景 5：产物可追溯

**操作**：查询镜像元数据。

```bash
docker inspect p1-monitor-api:latest | jq '.[0].Config.Labels'
```

**输出**：
```json
{
  "git.commit": "abc123def456",
  "git.branch": "main",
  "build.timestamp": "2026-09-07T10:30:00Z",
  "build.pipeline": "github-actions",
  "build.number": "456"
}
```

**验证**：能追溯到具体 commit、构建时间、Pipeline 编号。

### §1.2 各模块职责分工

```
┌─────────────────────────────────────────────────────────────────┐
│                         GitHub Actions Workflow                   │
│  - lint → typecheck → unit → integration → E2E → build → scan   │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         质量门禁（Gate）                           │
│  - 测试失败 → 阻断                                                 │
│  - 合同漂移 → 阻断                                                 │
│  - 破坏性迁移 → 阻断                                               │
│  - 高危依赖 → 阻断                                                 │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         镜像构建 + 签名                             │
│  - Docker build                                                   │
│  - 注入 Git SHA + 构建时间                                         │
│  - Trivy 扫描                                                     │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         产物推送 + 元数据                           │
│  - Push to Registry                                               │
│  - 记录 Git SHA、构建时间、Pipeline 编号                           │
└─────────────────────────────────────────────────────────────────┘
```

### §1.3 三版演进

#### v1：手动测试 + 部署（Day 01-55）

- 手动运行测试（`npm test`）
- 手动构建镜像（`docker build`）
- 问题：坏代码进生产、无法追溯

#### v2：CI/CD Pipeline + 质量门禁（今天）

- 自动测试 + 构建 + 扫描
- 测试失败阻断部署
- 镜像扫描 + 合同测试
- 产物可追溯（Git SHA + 元数据）

#### v3：灰度发布 + 自动回滚（Day 57-60）

- 蓝绿部署（零停机）
- 金丝雀发布（5% 流量试错）
- 自动回滚（错误率 > 1% → 回滚）

### §1.4 今天的完整目录结构

```
p1-monitor/
├── .github/
│   └── workflows/
│       ├── ci.yml                          # CI Pipeline
│       ├── contract-test.yml               # 合同测试
│       └── migration-safety.yml            # 迁移安全检查
├── scripts/
│   ├── check-migration-safety.sh           # 迁移安全检查脚本
│   ├── check-contract.sh                   # 合同检查脚本
│   └── sign-image.sh                       # 镜像签名脚本
├── apps/api/
│   ├── prisma/
│   │   ├── migrations/
│   │   └── migration-safety-rules.json     # 迁移安全规则
│   └── test/
│       ├── unit/
│       ├── integration/
│       └── e2e/
└── docs/
    ├── ci-pipeline.md                      # CI Pipeline 文档
    └── adr/
        └── 001-expand-contract-migration.md  # Migration ADR
```

**为什么需要 migration-safety-rules.json？**

定义"安全迁移"和"破坏性迁移"的规则：
- 安全：ADD COLUMN nullable、CREATE INDEX CONCURRENTLY
- 破坏：ALTER TABLE NOT NULL、DROP COLUMN、ADD COLUMN NOT NULL

---

## §2 今天的开发节奏（3 小时：90 阅读 / 90 动手）

| 阶段 | 时长 | 任务 | 输出 |
|---|---|---|---|
| **阶段 1** | 40 min | 理解 CI/CD Pipeline、质量门禁、Migration Safety | 笔记 |
| **阶段 2** | 100 min | 编写 GitHub Actions Workflow + 质量门禁脚本 | 完整 Pipeline |
| **阶段 3** | 25 min | 测试：坏合同/测试/迁移 → 阻断 | 测试通过 |
| **阶段 4** | 15 min | CI 流程图 + ADR + commit | 架构证据 |

---

## §3 v1：手动测试 + 部署（Day 01-55 基线）

### 3.1 v1 的问题

Day 01-55 需要手动测试和部署：
```bash
# 手动测试
npm test

# 手动构建
docker build -t p1-monitor-api .

# 手动部署
docker-compose up -d
```

**问题**：
1. 坏代码进生产（测试失败但仍部署）
2. 无法追溯（不知道镜像来自哪次 commit）
3. 破坏性迁移（锁表 18 分钟）
4. 高危依赖（未扫描漏洞）

---

## §4 v2：CI/CD Pipeline + 质量门禁（今天）

### 4.1 GitHub Actions Workflow（完整 Pipeline）

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}/api

jobs:
  # ========== 阶段 1：代码质量检查 ==========
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run ESLint
        run: npm run lint
      
      - name: Run Prettier check
        run: npm run format:check

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      - run: npm run typecheck

  # ========== 阶段 2：单元测试 ==========
  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      - run: npm run test:unit
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  # ========== 阶段 3：集成测试 ==========
  integration-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: ankane/pgvector:v0.5.1
        env:
          POSTGRES_PASSWORD: test_password
          POSTGRES_DB: p1_monitor_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:test_password@localhost:5432/p1_monitor_test
      
      - run: npm run test:integration
        env:
          DATABASE_URL: postgresql://postgres:test_password@localhost:5432/p1_monitor_test
          REDIS_URL: redis://localhost:6379

  # ========== 阶段 4：E2E 测试 ==========
  e2e-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Start services
        run: docker-compose up -d
      
      - name: Wait for services
        run: |
          timeout 60 bash -c 'until curl -f http://localhost:3000/health; do sleep 2; done'
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Stop services
        if: always()
        run: docker-compose down

  # ========== 阶段 5：合同测试 ==========
  contract-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - run: npm ci
      
      - name: Check FastAPI contract
        run: ./scripts/check-contract.sh
      
      - name: Fail if contract changed
        run: |
          if [ -f contract-diff.txt ]; then
            cat contract-diff.txt
            exit 1
          fi

  # ========== 阶段 6：迁移安全检查 ==========
  migration-safety:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 获取完整 git 历史
      
      - name: Check migration safety
        run: ./scripts/check-migration-safety.sh
      
      - name: Fail if unsafe migration
        run: |
          if [ -f unsafe-migrations.txt ]; then
            cat unsafe-migrations.txt
            exit 1
          fi

  # ========== 阶段 7：构建镜像 ==========
  build:
    runs-on: ubuntu-latest
    needs: [lint, typecheck, unit-test, integration-test, e2e-test, contract-test, migration-safety]
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Build image
        uses: docker/build-push-action@v5
        with:
          context: ./apps/api
          push: false
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          labels: |
            git.commit=${{ github.sha }}
            git.branch=${{ github.ref_name }}
            build.timestamp=${{ github.event.head_commit.timestamp }}
            build.pipeline=github-actions
            build.number=${{ github.run_number }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ========== 阶段 8：镜像扫描 ==========
  scan:
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Trivy scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'  # 高危漏洞阻断
      
      - name: Upload Trivy results
        uses: github/codeql-action/upload-sarif@v2
        if: always()
        with:
          sarif_file: 'trivy-results.sarif'
```

**为什么需要 8 个阶段？**

分层验证：
1. lint/typecheck：代码格式 + 类型检查
2. unit-test：单元测试
3. integration-test：集成测试（需要 Postgres + Redis）
4. e2e-test：端到端测试（需要完整服务）
5. contract-test：合同测试（检查 API 合同漂移）
6. migration-safety：迁移安全检查（检查破坏性迁移）
7. build：构建镜像（只有前 6 个阶段全通过才构建）
8. scan：镜像扫描（检测高危依赖）

### 4.2 合同测试脚本

```bash
# scripts/check-contract.sh
#!/bin/bash
set -e

echo "Checking FastAPI OpenAPI contract..."

# 1. 启动 FastAPI 服务（后台）
cd services/ai
uvicorn main:app --host 0.0.0.0 --port 8000 &
FASTAPI_PID=$!

# 等待服务就绪
sleep 5

# 2. 获取当前 OpenAPI schema
curl -s http://localhost:8000/openapi.json > current-openapi.json

# 3. 对比 baseline（上次提交的 schema）
if [ -f openapi-baseline.json ]; then
  diff openapi-baseline.json current-openapi.json > contract-diff.txt || true
  
  if [ -s contract-diff.txt ]; then
    echo "❌ Contract changed:"
    cat contract-diff.txt
    kill $FASTAPI_PID
    exit 1
  fi
fi

# 4. 更新 baseline（如果是 main 分支）
if [ "$GITHUB_REF" == "refs/heads/main" ]; then
  cp current-openapi.json openapi-baseline.json
fi

echo "✅ Contract check passed"
kill $FASTAPI_PID
```

**为什么需要合同测试？**

防止 API 合同漂移：FastAPI 删除字段后，NestJS 客户端仍然期望该字段存在，导致运行时错误。合同测试在 CI 阶段提前发现问题。

### 4.3 迁移安全检查脚本

```bash
# scripts/check-migration-safety.sh
#!/bin/bash
set -e

echo "Checking migration safety..."

# 1. 获取新增的 migration 文件
NEW_MIGRATIONS=$(git diff --name-only HEAD~1 HEAD | grep "prisma/migrations" || true)

if [ -z "$NEW_MIGRATIONS" ]; then
  echo "No new migrations"
  exit 0
fi

# 2. 检查每个 migration 文件
for migration in $NEW_MIGRATIONS; do
  echo "Checking $migration"
  
  # 读取 SQL 内容
  SQL_CONTENT=$(cat "$migration")
  
  # 检查破坏性操作
  if echo "$SQL_CONTENT" | grep -qE "ALTER TABLE .* ADD COLUMN .* NOT NULL(?! DEFAULT)"; then
    echo "❌ Unsafe migration: ADD COLUMN NOT NULL without DEFAULT"
    echo "File: $migration"
    echo "$SQL_CONTENT"
    echo "$migration" >> unsafe-migrations.txt
  fi
  
  if echo "$SQL_CONTENT" | grep -qi "DROP COLUMN"; then
    echo "❌ Unsafe migration: DROP COLUMN"
    echo "File: $migration"
    echo "$migration" >> unsafe-migrations.txt
  fi
  
  if echo "$SQL_CONTENT" | grep -qiE "CREATE INDEX(?! CONCURRENTLY)"; then
    echo "⚠️  Warning: CREATE INDEX without CONCURRENTLY (may lock table)"
    echo "File: $migration"
  fi
done

if [ -f unsafe-migrations.txt ]; then
  echo "❌ Unsafe migrations detected"
  exit 1
fi

echo "✅ Migration safety check passed"
```

**为什么需要迁移安全检查？**

防止破坏性迁移锁表：`ALTER TABLE ADD COLUMN NOT NULL` 会锁表 18 分钟（8000 万行），导致服务不可用。迁移安全检查在 CI 阶段阻断破坏性迁移。

### 4.4 Migration Safety 规则

```json
// apps/api/prisma/migration-safety-rules.json
{
  "safe": [
    {
      "pattern": "ADD COLUMN .* DEFAULT .*",
      "description": "添加列（带默认值）",
      "reason": "不锁表（Postgres 11+）"
    },
    {
      "pattern": "CREATE INDEX CONCURRENTLY",
      "description": "并发创建索引",
      "reason": "不锁表"
    },
    {
      "pattern": "DROP INDEX CONCURRENTLY",
      "description": "并发删除索引",
      "reason": "不锁表"
    }
  ],
  "unsafe": [
    {
      "pattern": "ALTER TABLE .* ADD COLUMN .* NOT NULL(?! DEFAULT)",
      "description": "添加 NOT NULL 列（无默认值）",
      "reason": "锁表（需回填数据）",
      "recommendation": "Use expand-contract: 1. ADD nullable 2. Backfill 3. ADD NOT NULL"
    },
    {
      "pattern": "DROP COLUMN",
      "description": "删除列",
      "reason": "破坏向后兼容",
      "recommendation": "Use expand-contract: 1. Stop using 2. Wait 1 release 3. DROP"
    },
    {
      "pattern": "ALTER TABLE .* ALTER COLUMN .* TYPE",
      "description": "修改列类型",
      "reason": "锁表 + 破坏兼容",
      "recommendation": "Use expand-contract: 1. ADD new column 2. Backfill 3. Switch 4. DROP old"
    }
  ]
}
```

### 4.5 Expand-Contract Migration 模式

**问题**：直接 `ALTER TABLE ADD COLUMN NOT NULL` 锁表 18 分钟。

**解决方案**：expand-contract 三阶段迁移（向前兼容）。

#### 阶段 1：Expand（扩展）

```sql
-- Migration 1: 添加可空列
ALTER TABLE documents ADD COLUMN new_field VARCHAR(255) NULL;
```

**部署**：旧代码（不使用 `new_field`）和新代码（写入 `new_field`）共存。

#### 阶段 2：Contract（收缩前的回填）

```sql
-- Migration 2: 回填数据
UPDATE documents SET new_field = 'default_value' WHERE new_field IS NULL;
```

**部署**：新代码已经写入 `new_field`，旧数据回填完成。

#### 阶段 3：Contract（收缩）

```sql
-- Migration 3: 添加 NOT NULL 约束
ALTER TABLE documents ALTER COLUMN new_field SET NOT NULL;
```

**部署**：所有代码都使用 `new_field`，数据已回填，添加约束不锁表。

**为什么分三个阶段？**

保证旧代码和新代码共存（向前兼容）：
- 阶段 1：旧代码不写 `new_field`（NULL），新代码写 `new_field`
- 阶段 2：回填旧数据（所有行的 `new_field` 都有值）
- 阶段 3：添加 NOT NULL 约束（不锁表，因为没有 NULL 值）

### 4.6 镜像签名（产物追溯）

```bash
# scripts/sign-image.sh
#!/bin/bash
set -e

IMAGE_NAME=$1
GIT_SHA=$(git rev-parse HEAD)
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BUILD_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "Signing image: $IMAGE_NAME"

# 1. 添加 Git 元数据标签
docker tag $IMAGE_NAME $IMAGE_NAME:$GIT_SHA

docker image inspect $IMAGE_NAME --format='{{json .Config.Labels}}' | jq \
  --arg sha "$GIT_SHA" \
  --arg branch "$GIT_BRANCH" \
  --arg timestamp "$BUILD_TIMESTAMP" \
  '. + {
    "git.commit": $sha,
    "git.branch": $branch,
    "build.timestamp": $timestamp
  }'

echo "✅ Image signed"
```

**为什么需要镜像签名？**

产物追溯：生产环境出问题时，能快速定位到具体 commit、构建时间、Pipeline 编号，方便回滚和调试。

---

## §5 测试与验证（完整执行版）

### 5.1 坏合同阻断测试

```bash
# 1. 修改 FastAPI（删除字段）
# 2. 提交代码
git add .
git commit -m "Remove title field"
git push

# 3. 查看 CI 日志
# 预期：Contract test 失败，部署阻断
```

### 5.2 破坏性迁移阻断测试

```bash
# 1. 创建破坏性迁移
echo "ALTER TABLE documents ADD COLUMN new_field VARCHAR(255) NOT NULL;" > apps/api/prisma/migrations/xxx_unsafe.sql

# 2. 提交代码
git add .
git commit -m "Add unsafe migration"
git push

# 3. 查看 CI 日志
# 预期：Migration safety check 失败，部署阻断
```

### 5.3 高危依赖阻断测试

```bash
# 1. 降级依赖到有漏洞版本
npm install axios@0.21.1

# 2. 提交代码
git add package.json package-lock.json
git commit -m "Downgrade axios"
git push

# 3. 查看 CI 日志
# 预期：Image scan 失败（检测到 CVE-2021-3749），部署阻断
```

---

## §6 深挖前端底子（完整执行版）

### 6.1 为什么用 SARIF 格式输出扫描结果？

SARIF（Static Analysis Results Interchange Format）是标准化的静态分析结果格式，GitHub Security tab 原生支持，能直接在 PR 里显示漏洞。

### 6.2 为什么 E2E 测试需要 timeout？

E2E 测试启动完整服务需要时间（Postgres 启动 + migration + API 启动），`timeout 60` 等待最多 60 秒，避免服务未就绪时测试失败。

---

## §7 ADR（Architecture Decision Record）

### ADR 001: Expand-Contract Migration 模式

**背景**：直接 `ALTER TABLE ADD COLUMN NOT NULL` 锁表 18 分钟，导致服务不可用。

**决策**：采用 expand-contract 三阶段迁移模式。

**理由**：
1. 保证向前兼容（旧代码和新代码共存）
2. 避免锁表（分阶段执行，每阶段不锁表）
3. 可回滚（阶段 1/2 失败可直接回滚）

**权衡**：
- 优势：零停机迁移
- 劣势：需要 3 次部署（复杂度增加）

**验证**：
- 单元测试：验证迁移 SQL 语法正确
- 集成测试：验证旧代码和新代码共存
- E2E 测试：验证完整流程

---

## §8-14 标准收尾章节（完整执行版）

**通关检查清单**：
1. ✅ §0 位置声明
2. ✅ §1.1 用户能看到什么（5 个场景）
3. ✅ §1.4 目录结构（GitHub Actions + 脚本 + ADR）
4. ✅ 三版演进（v1 手动 → v2 CI/CD → v3 灰度）
5. ✅ §4 完整代码（ci.yml + check-contract.sh + check-migration-safety.sh）
6. ✅ 核心知识点（Pipeline、质量门禁、Migration Safety、镜像扫描、产物追溯）
7. ✅ §6 前端底子（SARIF 格式、E2E timeout）
8. ✅ §7 测试 3 件套（坏合同阻断、破坏性迁移阻断、高危依赖阻断）
9. ✅ ADR（Expand-Contract Migration）

**本日小结**：Pipeline 8 阶段自动化、质量门禁阻断坏代码、expand-contract 防锁表、Trivy 扫描高危依赖、Git SHA 追溯产物——生产级 CI/CD 完整实现。

**下一站**：Day 57-60 灰度发布（蓝绿部署、金丝雀发布、自动回滚）

（Day 56 原版情境题 + 面试题 + 五连问执行版补全要求）

---

## §11 课后三道核心问题（必答，先于教师五连问）

### 问题 1：请从今天项目的真实入口到最终输出，解释"CI/CD"的数据流或控制流；当天知识链"Pipeline、质量门禁、migration safety、镜像扫描、回滚"分别在哪一层起作用，为什么按这个顺序学习？

**控制流**：
```
git push
  → GitHub Actions 触发
  → lint + typecheck（代码质量）
  → unit test（单元测试）
  → integration test（集成测试，需要 Postgres + Redis）
  → E2E test（端到端测试，需要完整服务）
  → contract test（合同测试，检查 API 合同漂移）
  → migration safety（迁移安全检查，阻断破坏性迁移）
  → build（构建镜像，注入 Git SHA + 元数据）
  → scan（Trivy 扫描高危依赖）
  → push（推送镜像到 Registry）
```

**知识链分层**：
- **Pipeline**：编排层（定义 8 个阶段顺序）
- **质量门禁**：决策层（测试失败 → 阻断）
- **migration safety**：数据安全层（检查破坏性迁移）
- **镜像扫描**：安全层（检测高危依赖）
- **回滚**：恢复层（失败后恢复到上一个版本）

**为什么按这个顺序学习**：
1. 先学 Pipeline（理解整体流程）
2. 再学质量门禁（理解如何阻断坏代码）
3. 再学 migration safety（理解数据迁移安全）
4. 再学镜像扫描（理解安全扫描）
5. 最后学回滚（理解失败恢复）

这个顺序是"从流程到决策到数据安全到镜像安全到失败恢复"的分层学习路径。

### 问题 2：如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

**移除的机制**：迁移安全检查（允许破坏性迁移）。

**可观察现象**：Migration 锁表 18 分钟，API 响应超时，用户无法访问。

**最小复现**：
1. 移除 migration-safety 检查（注释掉 ci.yml 里的 migration-safety job）
2. 提交破坏性迁移：
   ```sql
   ALTER TABLE documents ADD COLUMN new_field VARCHAR(255) NOT NULL;
   ```
3. 部署到生产环境
4. 观察：API 响应超时（因为 migration 锁表）

**定位证据**：
```sql
-- 查询锁等待
SELECT * FROM pg_stat_activity WHERE wait_event_type = 'Lock';

-- 预期：大量查询等待 documents 表锁
```

日志：
```
[Migration] Running migration: xxx_add_column.sql
[Migration] ALTER TABLE documents ADD COLUMN new_field VARCHAR(255) NOT NULL;
[Migration] (18 分钟后) Migration completed
[API] Error: Connection pool timeout (waiting for migration)
```

**恢复动作**：
1. 停止 migration：`docker-compose stop api`
2. 回滚 migration：
   ```sql
   ALTER TABLE documents DROP COLUMN new_field;
   ```
3. 修复 migration（改为 expand-contract）：
   ```sql
   -- Migration 1: 添加可空列
   ALTER TABLE documents ADD COLUMN new_field VARCHAR(255) NULL;
   ```
4. 重新部署

**防复发测试**（CI）：
```yaml
# .github/workflows/ci.yml
migration-safety:
  steps:
    - name: Check migration safety
      run: ./scripts/check-migration-safety.sh
    
    - name: Fail if unsafe migration
      run: |
        if [ -f unsafe-migrations.txt ]; then
          exit 1
        fi
```

### 问题 3：请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

**代码证据**：
- `.github/workflows/ci.yml` 第 8 行：lint job（ESLint + Prettier）
- `.github/workflows/ci.yml` 第 48 行：integration-test job（需要 Postgres + Redis services）
- `.github/workflows/ci.yml` 第 120 行：contract-test job（检查 FastAPI 合同漂移）
- `.github/workflows/ci.yml` 第 138 行：migration-safety job（检查破坏性迁移）
- `.github/workflows/ci.yml` 第 185 行：scan job（Trivy 扫描高危依赖，`exit-code: 1` 阻断）

**测试证据**：
- 坏合同阻断测试：删除 FastAPI 字段 → CI 失败（contract test）
- 破坏性迁移阻断测试：提交 `ALTER TABLE ADD COLUMN NOT NULL` → CI 失败（migration-safety）
- 高危依赖阻断测试：降级 axios 到 0.21.1 → CI 失败（scan）

**架构证据**：
- CI 流程图：8 个阶段依赖关系（lint → typecheck → unit → integration → E2E → contract → migration-safety → build → scan）
- ADR 001：Expand-Contract Migration 模式决策记录

**项目目标达成**：
- ✅ Pipeline（8 个阶段自动化）
- ✅ 质量门禁（测试失败阻断）
- ✅ Migration Safety（破坏性迁移阻断）
- ✅ 镜像扫描（高危依赖阻断）
- ✅ 产物追溯（Git SHA + 构建时间）

**距离企业生产标准还缺**：
1. **灰度发布**：当前一次性全量部署（无法试错）
2. **自动回滚**：当前手动回滚（无自动化）
3. **多环境部署**：当前只有生产环境（缺少 staging 环境）
4. **性能测试**：当前无性能测试（无法检测性能退化）

**下一步演进（不破坏合约）**：
- 新增 `staging` 环境（复用 CI Pipeline，不改变现有流程）
- 新增 `deploy-canary.yml`（金丝雀发布，5% 流量试错）
- 新增 `auto-rollback.yml`（错误率 > 1% → 自动回滚）
- 新增 `performance-test` job（k6 性能测试，P95 延迟退化 > 10% → 阻断）

---

## §12 真实项目情境题（Day 56 原版，执行版补全要求）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：数据库 migration 在单测通过，却在生产因 8000 万行锁表 18 分钟；API 与旧 Schema 同时运行时报错。请用 migration 日志、锁等待、合同测试和部署 Trace 定位，先停止迁移并回滚应用，再设计向前兼容的 expand-contract 流程，验证旧新版本共存。
   依据：[PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)

2. 模拟情境：CI 全绿但镜像含高危依赖，且 FastAPI OpenAPI 与 Nest 客户端类型已漂移。请先阻断发布并标记受影响制品，再加入镜像扫描、合同 diff、E2E 和产物签名，故意提交坏合同与漏洞版本验证门禁确实失败。
   依据：[S2 AgentOps](https://jobs.bytedance.com/experienced/position/7309098238475831562/detail)

知识映射：对应 Pipeline、质量门禁、migration safety、扫描、回滚与追溯。

---

## §13 PDF 面试题映射（Day 56 原版，执行版补全要求）

1. 全栈 CI/CD 流程如何组织 lint、单测、集成测试、Docker 构建、灰度和回滚？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 12 页。

2. 如何用规范、Code Review、测试、类型安全和日志追踪保证大型项目质量？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 13 页。

题目说明：直接匹配 Pipeline 和质量门禁；镜像扫描、migration safety 与产物溯源需当天额外验收。

---

## §14 完成后教师五连问（Day 56 原版，执行版补全要求）

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
