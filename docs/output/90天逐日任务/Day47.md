# Day 47 - 向量检索（Embedding + 向量相似度 + pgvector 索引）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日为 6 小时扩展日：先执行 A/B/C 各 30 分钟（共 90 分钟阅读），再执行 D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟基础动手），剩余 180 分钟只用于真实项目深化、故障注入和回归证据。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **完整性修正**：正文中的 `TODO`、`...`、伪代码或“核心代码你手写”只表示实施任务，不属于交付结果；在本日通过前，必须在真实项目中替换为可运行实现，并提交对应测试输出和 diff 证据。任何仍含占位实现的项目提交均判定为未完成。
>
> **跨 Day 导航修正**：后续真实顺序：Day48 Hybrid/Rerank，Day49 RAG 引用闭环，Day50 五十日 RAG 门禁。

**日期与时长**：2026-08-29 周六，360 分钟（90 分钟阅读 + 270 分钟动手/项目深化）
**项目**：`D:\demo\ai-techer\p1-monitor`  
**阶段任务性质**：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

---

## §0 Day 47 在 90 天路线图里的位置

### 0.1 前情提要（Day 46 已建立的能力）

Day 46 建立了完整的 RAG 摄取管道（解析 + 切分 + 元数据 + 去重 + ACL），20-50 份运维文档已经摄入 chunks 表（每个 chunk 是 200-1000 字的文本片段）。但检索时如果只用关键词匹配（例如 `WHERE content LIKE '%服务器故障%'`），无法理解语义（"服务器宕机" vs "服务器故障"是同义词，但关键词匹配不到）。

**Day 46 留下的问题**：
- 如何理解语义相似（"服务器宕机" vs "服务器故障" vs "服务器崩溃"应该返回相同结果）？
- 如何从 1000 个 chunk 里找最相关的 5 个（不是返回所有包含关键词的 chunk）？
- 如何优化检索性能（1000 万个 chunk 的向量检索 P95 < 100ms）？

### 0.2 今天的核心任务

Day 47 是**阶段二第 7 天**，建立向量检索能力：

1. **Embedding 生成**：把 chunk 文本转成向量（1536 维或 3072 维浮点数数组）
2. **向量相似度计算**：计算查询向量和 chunk 向量的距离（余弦相似度 vs 欧氏距离）
3. **pgvector 索引**：用 HNSW 或 IVFFlat 索引优化检索性能（百万级向量检索 < 100ms）
4. **Top-K 检索**：返回最相似的 K 个 chunk（K=5 或 K=10）
5. **ACL 过滤**：检索时过滤（只返回当前用户有权限的 chunk）

### 0.3 今天要解决的 5 个生产痛点

| 问题 | 用户体验 | 根因 | Day 47 方案 |
|---|---|---|---|
| 1. 语义不理解 | 搜索"服务器宕机"，找不到"服务器故障"文档 | 关键词匹配，不理解同义词 | Embedding 向量化（语义相似的文本向量接近） |
| 2. 结果不排序 | 返回 100 个匹配结果，不知道哪个最相关 | 没有相似度排序 | 向量相似度计算（余弦相似度排序） |
| 3. 检索慢 | 100 万个 chunk 检索需要 3 秒 | 全表扫描（没有索引） | pgvector HNSW 索引（< 100ms） |
| 4. 维度不匹配 | Embedding 模型升级（1536 维 → 3072 维），批任务报错 | 没有维度校验 | 维度前置校验 + 原子切换 |
| 5. 跨租户泄露 | 租户 A 搜索，返回租户 B 的结果 | 向量检索没有过滤 | ACL 后置过滤（先向量检索，再过滤权限） |

### 0.4 今天的前置依赖

- **Day 46**：RAG 摄取（chunks 表已有 20-50 份文档的 chunk）
- **Day 27**：Prisma + Postgres（pgvector 扩展依赖 Postgres）
- **Day 29**：BullMQ 队列（批量 Embedding 用队列异步处理）

**检查方法**：
```sql
-- 检查 chunks 表是否有数据
SELECT COUNT(*) FROM chunks;
-- 预期：> 100（20-50 份文档，每份 5-25 个 chunk）

-- 检查 pgvector 扩展是否已安装
SELECT * FROM pg_extension WHERE extname = 'vector';
-- 如果未安装，执行：CREATE EXTENSION vector;
```

### 0.5 今天的后续对齐

Day 47 建立的向量检索能力是后续 3 天的基础：

- **Day 48**：Rerank（重排序检索结果，提升精度）
- **Day 49**：Hybrid Search（向量检索 + 关键词检索，互补）
- **Day 50**：RAG 完整链路（检索 → Rerank → 生成答案）

---

## §1 今天建立的完整能力（从用户视角到实现架构）

### §1.1 用户能看到什么（5 个真实场景）

#### 场景 1：语义搜索（理解同义词）

**用户操作**：在 Dashboard 搜索框输入"服务器宕机"。

**系统行为**：
1. 前端调用 `/api/search?q=服务器宕机`
2. 服务端把查询转成向量（1536 维）
3. 向量检索找最相似的 5 个 chunk（包含"服务器故障"、"服务器崩溃"、"服务挂了"的 chunk）
4. 返回结果（按相似度排序）

**关键观察点**：返回的结果不只是包含"宕机"关键词的 chunk，还包含语义相似的 chunk（"故障"、"崩溃"）。

#### 场景 2：相似度排序（最相关的排前面）

**用户操作**：搜索"Nginx 504 错误"。

**系统行为**：
1. 向量检索返回 10 个相关 chunk
2. 按相似度排序（相似度 0.95 的排第一，相似度 0.70 的排最后）
3. 前端显示相似度分数（"相关度：95%"）

**关键观察点**：结果有明确排序（不是随机顺序），用户可以快速找到最相关的文档。

#### 场景 3：快速检索（百万级向量 < 100ms）

**用户操作**：系统已摄入 100 万个 chunk，用户搜索"数据库连接池满"。

**系统行为**：
1. pgvector HNSW 索引（近似最近邻搜索）
2. 检索耗时：85ms（P95）
3. 返回 Top-5 结果

**关键观察点**：检索速度快（用户感觉"秒出结果"），不需要等待 3 秒。

#### 场景 4：维度不匹配告警（Embedding 模型升级）

**运维操作**：Embedding 模型从 text-embedding-3-small（1536 维）升级为 text-embedding-3-large（3072 维）。

**系统行为**：
1. 批量 Embedding 任务执行到 40% 时报错
2. 检测到维度不匹配（已有 chunk 是 1536 维，新 chunk 是 3072 维）
3. 停止写入，发送告警
4. 运维介入：回滚模型 or 重新摄入所有 chunk

**关键观察点**：维度不匹配不会导致数据库损坏（前置校验拦截），运维可以看到明确的错误提示。

#### 场景 5：ACL 过滤（租户隔离）

**用户操作**：租户 A 的用户搜索"服务器配置"。

**系统行为**：
1. 向量检索返回 20 个相关 chunk（包含租户 A 和租户 B 的 chunk）
2. ACL 后置过滤（只保留租户 A 的 chunk）
3. 返回 5 个结果（都是租户 A 的 chunk）

**关键观察点**：租户 A 看不到租户 B 的结果（即使向量相似度很高）。

### §1.2 各模块职责分工（3 层架构）

```
┌─────────────────────────────────────────────────────────────────┐
│                         API 层（NestJS）                         │
│  SearchController：接收查询，调用 EmbeddingService + VectorSearch │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                        服务层（Business Logic）                    │
│  - EmbeddingService：生成查询向量（OpenAI API / 本地模型）          │
│  - VectorSearchService：向量检索 + ACL 过滤 + Top-K 排序          │
│  - BatchEmbeddingService：批量 Embedding（队列异步处理）           │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                        存储层（Postgres + pgvector）               │
│  - chunks 表：新增 embedding 字段（vector(1536) 类型）             │
│  - pgvector 索引：HNSW 索引（m=16, ef_construction=64）            │
└─────────────────────────────────────────────────────────────────┘
```

**职责边界**：
- **API 层**：只负责"接收请求、返回结果"，不实现业务逻辑
- **服务层**：实现核心逻辑（Embedding 生成、向量检索、ACL 过滤）
- **存储层**：只负责"存储向量、执行检索"，不实现业务逻辑

**为什么按这个顺序学习？**
1. 先学 Embedding（把文本转成向量），才能谈"如何存储向量"
2. 再学向量相似度（计算距离），才能谈"如何优化检索"
3. 再学 pgvector 索引（优化性能），才能谈"如何过滤权限"
4. 最后学 ACL 过滤（租户隔离），才能谈"完整的检索链路"

### §1.3 三版演进（v1 → v2 → v3，按技术栈和用户量递进）

#### v1：精确搜索（无向量，只有关键词匹配）

**能做什么**：
- 用户搜索"服务器故障"
- 数据库执行：`SELECT * FROM chunks WHERE content LIKE '%服务器故障%'`
- 返回所有包含关键词的 chunk（不排序）

**核心代码**（伪代码）：
```typescript
const results = await prisma.chunk.findMany({
  where: {
    content: { contains: query }
  }
})
```

**致命问题**：
- 不理解语义（搜索"宕机"找不到"故障"）
- 不排序（100 个结果随机顺序）
- 性能差（全表扫描）

#### v2：向量检索（OpenAI Embedding + 精确距离计算）

**新增能力**：
1. 生成向量：用 OpenAI text-embedding-3-small API 生成 1536 维向量
2. 向量检索：计算查询向量和所有 chunk 向量的余弦相似度（精确计算，不用索引）
3. Top-K 排序：返回相似度最高的 5 个 chunk

**核心代码**（伪代码）：
```typescript
// 1. 生成查询向量
const queryEmbedding = await openai.embeddings.create({
  input: query,
  model: 'text-embedding-3-small'
})

// 2. 向量检索（精确距离计算）
const results = await prisma.$queryRaw`
  SELECT id, content, 1 - (embedding <=> ${queryEmbedding.data[0].embedding}) AS similarity
  FROM chunks
  ORDER BY similarity DESC
  LIMIT 5
`
```

**还剩的问题**：
- 性能差（100 万个 chunk 的精确距离计算需要 3 秒）
- 无索引（全表扫描）
- 无 ACL 过滤（跨租户泄露）

#### v3：HNSW 索引 + ACL 过滤（生产级）

**新增能力**：
1. **HNSW 索引**：近似最近邻搜索（ANN），100 万向量检索 < 100ms
2. **ACL 后置过滤**：先向量检索（返回 Top-20），再过滤权限（只保留 Top-5）
3. **维度校验**：Embedding 前检查维度（防止维度不匹配）
4. **批量 Embedding**：异步队列批量处理（不阻塞摄取）

**架构变化**：
```
v2：查询 → Embedding → 精确距离计算（全表扫描）→ Top-K
v3：查询 → Embedding → HNSW 索引检索（近似）→ Top-20 → ACL 过滤 → Top-5
                 ↓（维度校验）
            维度不匹配 → 拦截 + 告警
```

**关键指标对比**：

| 指标 | v1 关键词 | v2 精确向量 | v3 HNSW + ACL |
|---|---|---|---|
| 检索延迟（100 万 chunk） | 5s（全表扫描） | 3s（精确计算） | 85ms（近似搜索） |
| Recall@5 | 60%（语义不准） | 100%（精确） | 95%（近似，可接受） |
| 是否理解语义 | ❌ | ✅ | ✅ |
| 是否租户隔离 | ❌ | ❌ | ✅ |
| 是否有维度校验 | ❌ | ❌ | ✅ |

### §1.4 今天建立的完整目录结构（5 块骨架）

#### 1. 骨架树（新增文件用 `+` 标注）

```
services/ai/
├── prisma/
│   └── schema.prisma                    # 新增 embedding 字段 + vector 索引
├── src/
│   └── ai_service/
│       ├── rag/
│       │   ├── embedding/
│       │   │   ├── embedding_service.py         # + Embedding 生成服务
│       │   │   ├── openai_embedder.py          # + OpenAI Embedding 客户端
│       │   │   ├── embedding_dimension.py      # + 维度配置（1536 / 3072）
│       │   │   └── batch_embedding_queue.py    # + 批量 Embedding 队列
│       │   ├── vector_search/
│       │   │   ├── vector_search_service.py    # + 向量检索服务
│       │   │   ├── similarity_calculator.py    # + 相似度计算（余弦 / 欧氏距离）
│       │   │   ├── acl_filter.py               # + ACL 后置过滤
│       │   │   └── vector_index_manager.py     # + 索引管理（创建 / 重建）
│       │   └── parsers/
│       │       └── pdf_parser.py               # Day 46 已有
│       └── api/
│           ├── ingestion.py                    # Day 46 已有
│           └── search.py                        # + 搜索接口
└── tests/
    ├── test_embedding.py                        # + Embedding 测试
    ├── test_vector_search.py                    # + 向量检索测试
    └── test_acl_filter.py                       # + ACL 过滤测试
```

#### 2. 为什么这样分层（5 个设计问）

**问 1**：为什么 embedding/ 和 vector_search/ 分开？

**答**：embedding 是"生成向量"（计算密集型，可能调用外部 API），vector_search 是"检索向量"（IO 密集型，查询数据库）。分开后可以独立优化（例如 embedding 用队列异步处理，vector_search 用缓存）。

**问 2**：为什么 ACL 过滤在 vector_search/ 里而不是单独一层？

**答**：ACL 过滤是"检索的后置步骤"（先检索 Top-20，再过滤 → Top-5），和检索紧耦合。如果单独一层，会增加一次网络调用（检索服务 → ACL 服务）。

**问 3**：为什么需要 batch_embedding_queue.py（批量队列）？

**答**：摄取时需要给每个 chunk 生成 Embedding（1000 个 chunk = 1000 次 API 调用），同步生成会阻塞摄取（耗时 30 秒）。批量队列异步处理（摄取立即返回，后台慢慢生成 Embedding）。

**问 4**：为什么需要 embedding_dimension.py（维度配置）？

**答**：不同 Embedding 模型维度不同（text-embedding-3-small 是 1536 维，text-embedding-3-large 是 3072 维）。维度配置集中管理（切换模型时只改一个配置文件）。

**问 5**：为什么需要 vector_index_manager.py（索引管理）？

**答**：pgvector 索引需要手动创建（`CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops)`）。索引管理器封装"创建索引"、"重建索引"、"删除索引"操作。

#### 3. 今天 vs Day 46 的 diff 表格

| 文件 | Day 46 状态 | Day 47 变化 |
|---|---|---|
| `prisma/schema.prisma` | chunks 表有 content、metadata | 新增 embedding 字段（vector(1536)）+ HNSW 索引 |
| `rag/embedding/` | 不存在 | 新增目录（4 个文件） |
| `rag/vector_search/` | 不存在 | 新增目录（4 个文件） |
| `api/search.py` | 不存在 | 新增搜索接口 |
| `queue/ingestion_queue.py` | 摄取队列（Day 46） | 新增"摄取后生成 Embedding"步骤 |

#### 4. 依赖箭头（上下游调用）

```
api/search.py
    ↓
embedding/embedding_service.py ──→ openai_embedder.py（调用 OpenAI API）
    ↓
vector_search/vector_search_service.py ──→ similarity_calculator.py（计算相似度）
    ↓
vector_search/acl_filter.py ──→ 过滤租户
    ↓
返回 Top-5 结果
```

#### 5. 三个灵魂拷问

**拷问 1**：Embedding 是在摄取时生成还是检索时生成？

**答案**：摄取时生成（批量队列异步处理）。检索时只生成"查询向量"（1 次 Embedding），不重新生成 chunk 向量（否则 1000 个 chunk = 1000 次 Embedding，耗时 30 秒）。

**拷问 2**：为什么 ACL 过滤在检索后而不是检索前？

**答案**：pgvector 不支持"带过滤条件的向量检索"（`WHERE tenant_id = 'A' ORDER BY embedding <=> query LIMIT 5` 无法用 HNSW 索引）。必须先检索 Top-20（用 HNSW 索引），再过滤租户（应用层过滤）。

**拷问 3**：维度不匹配为什么不能自动转换（例如 1536 维补零到 3072 维）？

**答案**：补零会改变向量语义（1536 维的"服务器故障"向量补零到 3072 维，语义已经不是"服务器故障"）。正确做法是"重新摄入"（用新模型重新生成 Embedding）。

---
## §1.5 今天动手前的脚手架检查

**为什么放在 §1 里**：Day 47 依赖 Day 46（chunks 表）、Day 27（Prisma + Postgres）的代码。如果这些依赖缺失，今天的改造无法进行。先检查脚手架完整性，缺什么补什么，再开始动手。

### 1.5.1 Day 46 chunks 表检查

```bash
# 检查 chunks 表是否有数据
psql -U postgres -d p1_monitor -c "SELECT COUNT(*) FROM chunks;"
# 预期：> 100（20-50 份文档，每份 5-25 个 chunk）

# 检查 chunks 表结构
psql -U postgres -d p1_monitor -c "\d chunks"
# 预期：有 id、documentId、content、chunkIndex、metadata、createdAt 字段
```

**如果缺失**：先完成 Day 46（RAG 摄取），再回来做 Day 47。

### 1.5.2 pgvector 扩展检查

```bash
# 检查 pgvector 扩展是否已安装
psql -U postgres -d p1_monitor -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

**如果未安装**：
```bash
# 安装 pgvector 扩展（需要管理员权限）
psql -U postgres -d p1_monitor -c "CREATE EXTENSION vector;"
```

**验证安装成功**：
```sql
-- 测试创建 vector 类型
CREATE TABLE test_vector (
  id SERIAL PRIMARY KEY,
  embedding vector(1536)
);
DROP TABLE test_vector;
-- 如果没有报错，说明 pgvector 安装成功
```

### 1.5.3 今天需要新增的 Prisma Schema

在 `services/ai/prisma/schema.prisma` 里给 chunks 表新增 embedding 字段：

```prisma
model Chunk {
  id              String   @id @default(cuid())
  documentId      String
  content         String   @db.Text
  chunkIndex      Int
  metadata        Json?
  embedding       Unsupported("vector(1536)")?  // ★ 新增：向量字段
  createdAt       DateTime @default(now())
  
  document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, chunkIndex])
  @@index([documentId])
  
  // ★ 新增：HNSW 向量索引（Prisma 不支持 vector 索引，需要手动创建）
}
```

**为什么用 Unsupported("vector(1536)") 而不是 String？**

Prisma 不原生支持 pgvector 的 `vector` 类型，需要用 `Unsupported` 声明。迁移后需要手动创建索引（Prisma 不支持 vector 索引的 DSL）。

### 1.5.4 迁移脚本

```bash
cd services/ai
npx prisma migrate dev --name add_embedding_to_chunks
```

**手动创建 HNSW 索引**（Prisma 迁移后执行）：

```sql
-- 创建 HNSW 索引（近似最近邻搜索）
CREATE INDEX chunks_embedding_hnsw_idx 
ON chunks 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 参数说明：
-- m = 16：HNSW 图的最大度数（越大检索越精确，但索引越大）
-- ef_construction = 64：构建索引时的动态候选列表大小（越大构建越慢，但检索越精确）
```

**为什么用 HNSW 而不是 IVFFlat？**

HNSW（Hierarchical Navigable Small World）比 IVFFlat（Inverted File with Flat compression）检索更快（HNSW 是图索引，IVFFlat 是聚类索引）。HNSW 适合"高维向量 + 需要高精度"的场景（Recall@5 > 95%）。

**验证索引创建成功**：
```sql
-- 查询索引列表
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'chunks' AND indexname LIKE '%embedding%';
-- 预期输出：chunks_embedding_hnsw_idx
```

### 1.5.5 OpenAI API Key 配置

Day 47 需要调用 OpenAI Embedding API，需要配置 API Key。

```bash
# services/ai/.env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1  # 可选（国内用户可以配置代理）
```

**验证 API Key 可用**：
```bash
curl https://api.openai.com/v1/embeddings \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Test embedding",
    "model": "text-embedding-3-small"
  }'
# 预期：返回 1536 维向量
```

---

## §2 今天的开发节奏（6 小时怎么分配）

**总计 360 分钟**，按"90 分钟阅读 → v1/v2/v3 实现 → 测试验证 → 架构证据"推进。

| 阶段 | 时长 | 任务 | 输出 | 为什么这样安排 |
|---|---|---|---|---|
| **阶段 1** | 90 min | 阅读 OpenAI Embedding、pgvector、向量相似度与三版痛点 | 机制笔记 + HNSW 配置理解 | 前 90 分钟只读 |
| **阶段 2** | 30 min | 实现 v1/v2（Embedding + 精确距离计算） | EmbeddingService + VectorSearchService + 单测 | 先建立文本到检索的闭环 |
| **阶段 3** | 60 min | 实现 v3（HNSW 索引 + ACL 过滤 + 批量 Embedding） | VectorIndexManager + ACLFilter + BatchEmbeddingQueue | 补齐性能与权限痛点 |
| **阶段 4** | 60 min | 故障注入测试：维度不匹配 + 跨租户泄露 + HNSW 对比 | 测试输出（截图 + 日志） | 两个反证实验必须产生不同失败现象 |
| **阶段 5** | 30 min | 架构证据：依赖图 + 时序图 + commit | 四件套 | 完成可追踪验收 |

**关键里程碑检查点**：
- 90 分钟：v2 Embedding 代码能跑通（生成向量 + 精确检索）
- 210 分钟：v3 HNSW 索引代码能跑通（近似检索 < 100ms）
- 270 分钟：集成测试通过（ACL 过滤 + 维度校验）
- 300 分钟：故障注入测试完成（截图 + 日志）

**如果卡住了怎么办**：
- 卡在 Embedding 理解（阶段 1）→ 先读 OpenAI Embedding 文档的"模型选择"章节
- 卡在 HNSW 索引实现（阶段 3）→ 回顾 pgvector 官方示例（GitHub README）
- 卡在测试验证（阶段 4）→ 先跑单元测试，再跑集成测试，最后跑故障注入

---

## §3 v1：关键词匹配（无向量，暴露语义不准问题）

### 3.1 v1 能做什么

用户搜索"服务器故障" → 数据库执行关键词匹配（`LIKE '%服务器故障%'`）→ 返回所有包含关键词的 chunk（不排序）。

```python
# services/ai/src/ai_service/api/search.py (v1 版本，伪代码)
from fastapi import APIRouter
from prisma import Prisma

router = APIRouter()
prisma = Prisma()

@router.get("/search")
async def search(q: str):
    # 关键词匹配（全表扫描）
    results = await prisma.chunk.find_many(
        where={
            'content': {'contains': q}
        }
    )
    
    return {
        'total': len(results),
        'results': [
            {
                'id': chunk.id,
                'content': chunk.content,
                'metadata': chunk.metadata
            }
            for chunk in results
        ]
    }
```

### 3.2 v1 的 5 个致命问题

1. **不理解语义**：搜索"服务器宕机"，找不到"服务器故障"文档（关键词不匹配）。
2. **不排序**：返回 100 个结果，随机顺序（不知道哪个最相关）。
3. **性能差**：全表扫描（`LIKE` 无法用索引），100 万个 chunk 需要 5 秒。
4. **无 ACL**：返回所有租户的结果（跨租户泄露）。
5. **无 Top-K**：返回所有匹配结果（可能有 1000 个），前端分页复杂。

---
## §4 v2：OpenAI Embedding + 精确距离计算

### 4.1 v2 新增的能力

1. **Embedding 生成**：用 OpenAI text-embedding-3-small API 把文本转成 1536 维向量
2. **向量检索**：计算查询向量和所有 chunk 向量的余弦相似度（精确计算，全表扫描）
3. **Top-K 排序**：返回相似度最高的 5 个 chunk

### 4.2 v2 核心代码

#### 4.2.1 Embedding 维度配置（embedding/embedding_dimension.py）

```python
# services/ai/src/ai_service/rag/embedding/embedding_dimension.py
from enum import Enum

class EmbeddingModel(str, Enum):
    """Embedding 模型枚举"""
    TEXT_EMBEDDING_3_SMALL = "text-embedding-3-small"  # 1536 维
    TEXT_EMBEDDING_3_LARGE = "text-embedding-3-large"  # 3072 维

class EmbeddingDimension:
    """Embedding 维度配置"""
    
    DIMENSIONS = {
        EmbeddingModel.TEXT_EMBEDDING_3_SMALL: 1536,
        EmbeddingModel.TEXT_EMBEDDING_3_LARGE: 3072,
    }
    
    @classmethod
    def get_dimension(cls, model: EmbeddingModel) -> int:
        """获取模型维度"""
        return cls.DIMENSIONS[model]
    
    @classmethod
    def validate_dimension(cls, model: EmbeddingModel, embedding: list[float]) -> bool:
        """校验向量维度是否匹配"""
        expected_dim = cls.get_dimension(model)
        actual_dim = len(embedding)
        return expected_dim == actual_dim
```

**为什么需要维度配置而不是硬编码 1536？**

模型升级时只需要改配置（`EmbeddingModel.TEXT_EMBEDDING_3_LARGE`），不需要改代码。硬编码 1536 会导致"改了模型忘了改维度"的 Bug。

#### 4.2.2 OpenAI Embedder（embedding/openai_embedder.py）

```python
# services/ai/src/ai_service/rag/embedding/openai_embedder.py
from openai import AsyncOpenAI
from typing import List
import os

class OpenAIEmbedder:
    """OpenAI Embedding 客户端"""
    
    def __init__(self, model: str = "text-embedding-3-small"):
        """
        Args:
            model: Embedding 模型名称
        """
        self.client = AsyncOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        )
        self.model = model
    
    async def embed_text(self, text: str) -> List[float]:
        """
        生成单个文本的 Embedding
        
        Args:
            text: 待向量化文本
            
        Returns:
            1536 维向量（浮点数列表）
        """
        response = await self.client.embeddings.create(
            input=text,
            model=self.model
        )
        
        return response.data[0].embedding
    
    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """
        批量生成 Embedding（最多 2048 个文本）
        
        Args:
            texts: 待向量化文本列表
            
        Returns:
            向量列表
        """
        if len(texts) > 2048:
            raise ValueError("OpenAI Embedding API 最多支持 2048 个文本")
        
        response = await self.client.embeddings.create(
            input=texts,
            model=self.model
        )
        
        # 按原始顺序返回
        return [item.embedding for item in response.data]
```

**为什么批量接口限制 2048 个文本？**

OpenAI API 的硬性限制（`Batching requests (max 2048 inputs per request)`）。超过 2048 需要分批调用。

#### 4.2.3 Embedding 服务（embedding/embedding_service.py）

```python
# services/ai/src/ai_service/rag/embedding/embedding_service.py
from .openai_embedder import OpenAIEmbedder
from .embedding_dimension import EmbeddingModel, EmbeddingDimension
from typing import List

class EmbeddingService:
    """Embedding 生成服务"""
    
    def __init__(self, model: EmbeddingModel = EmbeddingModel.TEXT_EMBEDDING_3_SMALL):
        """
        Args:
            model: Embedding 模型
        """
        self.model = model
        self.embedder = OpenAIEmbedder(model=model.value)
        self.expected_dimension = EmbeddingDimension.get_dimension(model)
    
    async def generate_embedding(self, text: str) -> List[float]:
        """
        生成 Embedding（带维度校验）
        
        Args:
            text: 待向量化文本
            
        Returns:
            向量
            
        Raises:
            ValueError: 维度不匹配
        """
        # 1. 生成 Embedding
        embedding = await self.embedder.embed_text(text)
        
        # 2. 维度校验
        if not EmbeddingDimension.validate_dimension(self.model, embedding):
            raise ValueError(
                f"Embedding dimension mismatch: expected {self.expected_dimension}, "
                f"got {len(embedding)}"
            )
        
        return embedding
    
    async def generate_embeddings_batch(self, texts: List[str], batch_size: int = 100) -> List[List[float]]:
        """
        批量生成 Embedding（自动分批）
        
        Args:
            texts: 待向量化文本列表
            batch_size: 每批数量（默认 100，避免超时）
            
        Returns:
            向量列表
        """
        all_embeddings = []
        
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            embeddings = await self.embedder.embed_batch(batch)
            all_embeddings.extend(embeddings)
        
        return all_embeddings
```

**为什么需要维度校验？**

防止"模型配置错了但代码没报错"的隐藏 Bug。例如配置文件写 `TEXT_EMBEDDING_3_SMALL`，但实际调用了 `text-embedding-3-large`，返回 3072 维向量，存入 1536 维字段会截断（丢失信息）。

#### 4.2.4 相似度计算器（vector_search/similarity_calculator.py）

```python
# services/ai/src/ai_service/rag/vector_search/similarity_calculator.py
import numpy as np
from typing import List

class SimilarityCalculator:
    """向量相似度计算器"""
    
    @staticmethod
    def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
        """
        余弦相似度（推荐）
        
        公式：cos(θ) = (A · B) / (||A|| * ||B||)
        返回值：[-1, 1]，越接近 1 越相似
        
        Args:
            vec1: 向量 1
            vec2: 向量 2
            
        Returns:
            相似度分数
        """
        a = np.array(vec1)
        b = np.array(vec2)
        
        dot_product = np.dot(a, b)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
        
        return dot_product / (norm_a * norm_b)
    
    @staticmethod
    def euclidean_distance(vec1: List[float], vec2: List[float]) -> float:
        """
        欧氏距离
        
        公式：||A - B|| = sqrt(Σ(ai - bi)^2)
        返回值：[0, ∞)，越小越相似
        
        Args:
            vec1: 向量 1
            vec2: 向量 2
            
        Returns:
            距离（注意：不是相似度，需要转换）
        """
        a = np.array(vec1)
        b = np.array(vec2)
        
        return np.linalg.norm(a - b)
    
    @staticmethod
    def dot_product(vec1: List[float], vec2: List[float]) -> float:
        """
        点积（内积）
        
        公式：A · B = Σ(ai * bi)
        返回值：[-∞, ∞)，越大越相似
        
        Args:
            vec1: 向量 1
            vec2: 向量 2
            
        Returns:
            点积
        """
        a = np.array(vec1)
        b = np.array(vec2)
        
        return np.dot(a, b)
```

**为什么推荐余弦相似度而不是欧氏距离？**

余弦相似度只关注方向（不关注长度），适合文本向量（文本长度不影响相似度）。欧氏距离关注长度和方向，适合物理向量（例如坐标）。

#### 4.2.5 向量检索服务（vector_search/vector_search_service.py v2 版本）

```python
# services/ai/src/ai_service/rag/vector_search/vector_search_service.py (v2 版本)
from prisma import Prisma
from ..embedding.embedding_service import EmbeddingService
from .similarity_calculator import SimilarityCalculator
from typing import List, Dict, Any

class VectorSearchService:
    """向量检索服务（v2 精确检索）"""
    
    def __init__(self, embedding_service: EmbeddingService, prisma: Prisma):
        self.embedding_service = embedding_service
        self.prisma = prisma
        self.similarity_calculator = SimilarityCalculator()
    
    async def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        向量检索（精确距离计算，全表扫描）
        
        Args:
            query: 查询文本
            top_k: 返回 Top-K 结果
            
        Returns:
            检索结果列表（按相似度排序）
        """
        # 1. 生成查询向量
        query_embedding = await self.embedding_service.generate_embedding(query)
        
        # 2. 从数据库读取所有 chunk 的向量（精确检索，全表扫描）
        chunks = await self.prisma.chunk.find_many(
            where={'embedding': {'not': None}}  # 只查有 embedding 的 chunk
        )
        
        # 3. 计算相似度（内存计算）
        results = []
        for chunk in chunks:
            # pgvector 的 vector 类型需要解析（字符串 → 列表）
            chunk_embedding = self._parse_vector(chunk.embedding)
            
            similarity = self.similarity_calculator.cosine_similarity(
                query_embedding,
                chunk_embedding
            )
            
            results.append({
                'id': chunk.id,
                'content': chunk.content,
                'metadata': chunk.metadata,
                'similarity': similarity
            })
        
        # 4. 排序 + Top-K
        results.sort(key=lambda x: x['similarity'], reverse=True)
        return results[:top_k]
    
    def _parse_vector(self, vector_str: str) -> List[float]:
        """
        解析 pgvector 的 vector 类型（字符串 → 列表）
        
        pgvector 存储格式：'[0.1, 0.2, 0.3, ...]'
        """
        # 去掉首尾的 [ ]
        vector_str = vector_str.strip('[]')
        # 按逗号分割
        return [float(x) for x in vector_str.split(',')]
```

**为什么 v2 要全表扫描（不用索引）？**

v2 的目标是"建立完整链路"（文本 → 向量 → 检索），先保证功能正确，再优化性能。v3 会用 HNSW 索引优化。

#### 4.2.6 改造搜索接口（api/search.py v2 版本）

```python
# services/ai/src/ai_service/api/search.py (v2 版本)
from fastapi import APIRouter, Depends
from ..rag.embedding.embedding_service import EmbeddingService
from ..rag.embedding.embedding_dimension import EmbeddingModel
from ..rag.vector_search.vector_search_service import VectorSearchService
from prisma import Prisma

router = APIRouter()

# 初始化
prisma = Prisma()
embedding_service = EmbeddingService(model=EmbeddingModel.TEXT_EMBEDDING_3_SMALL)
vector_search_service = VectorSearchService(embedding_service, prisma)

@router.get("/search")
async def search(q: str, top_k: int = 5):
    """
    向量检索接口
    
    Args:
        q: 查询文本
        top_k: 返回 Top-K 结果（默认 5）
        
    Returns:
        检索结果（按相似度排序）
    """
    results = await vector_search_service.search(query=q, top_k=top_k)
    
    return {
        'query': q,
        'total': len(results),
        'results': [
            {
                'id': r['id'],
                'content': r['content'][:200] + '...',  # 截取前 200 字
                'similarity': round(r['similarity'], 4),
                'metadata': r['metadata']
            }
            for r in results
        ]
    }
```

### 4.3 v2 测试（Embedding 生成 + 精确检索）

```python
# services/ai/tests/test_embedding.py
import pytest
from ai_service.rag.embedding.embedding_service import EmbeddingService
from ai_service.rag.embedding.embedding_dimension import EmbeddingModel, EmbeddingDimension

@pytest.mark.asyncio
async def test_generate_embedding():
    """生成 Embedding 并校验维度"""
    service = EmbeddingService(model=EmbeddingModel.TEXT_EMBEDDING_3_SMALL)
    
    embedding = await service.generate_embedding("服务器故障排查步骤")
    
    # 验证维度
    expected_dim = EmbeddingDimension.get_dimension(EmbeddingModel.TEXT_EMBEDDING_3_SMALL)
    assert len(embedding) == expected_dim
    
    # 验证值域（Embedding 通常在 [-1, 1] 之间）
    assert all(-1 <= x <= 1 for x in embedding)

@pytest.mark.asyncio
async def test_dimension_mismatch_error():
    """维度不匹配应抛异常"""
    service = EmbeddingService(model=EmbeddingModel.TEXT_EMBEDDING_3_SMALL)
    
    # 模拟维度不匹配（实际 API 不会返回错误维度，这里只是测试校验逻辑）
    # 真实场景：配置文件写 3-small，但调用了 3-large API
    with pytest.raises(ValueError, match="dimension mismatch"):
        # 这里需要 mock OpenAI API 返回错误维度的向量
        pass
```

```python
# services/ai/tests/test_vector_search.py
import pytest
from ai_service.rag.vector_search.similarity_calculator import SimilarityCalculator

def test_cosine_similarity():
    """余弦相似度测试"""
    calc = SimilarityCalculator()
    
    # 相同向量：相似度 = 1
    vec1 = [1.0, 0.0, 0.0]
    vec2 = [1.0, 0.0, 0.0]
    assert calc.cosine_similarity(vec1, vec2) == 1.0
    
    # 正交向量：相似度 = 0
    vec1 = [1.0, 0.0]
    vec2 = [0.0, 1.0]
    assert abs(calc.cosine_similarity(vec1, vec2) - 0.0) < 0.001
    
    # 相反向量：相似度 = -1
    vec1 = [1.0, 0.0]
    vec2 = [-1.0, 0.0]
    assert abs(calc.cosine_similarity(vec1, vec2) - (-1.0)) < 0.001
```

### 4.4 v2 还剩下的 3 个问题

1. **性能差**：100 万个 chunk 的精确距离计算需要 3 秒（全表扫描 + 内存计算）。
2. **无索引**：没有用 pgvector 索引（HNSW），所有计算在应用层。
3. **无 ACL 过滤**：返回所有租户的结果（跨租户泄露）。

v3 用"HNSW 索引 + ACL 后置过滤"解决这三个问题。

---
## §5 v3：HNSW 索引 + ACL 过滤 + 批量 Embedding（生产级）

### 5.1 v3 新增的能力

1. **HNSW 索引**：近似最近邻搜索（ANN），100 万向量检索 < 100ms
2. **ACL 后置过滤**：先向量检索（Top-20），再过滤权限（只保留 Top-5）
3. **维度前置校验**：Embedding 前检查维度配置（防止维度不匹配）
4. **批量 Embedding 队列**：摄取后异步生成 Embedding（不阻塞摄取）

### 5.2 v3 架构变化

```
v2：查询 → Embedding → 精确距离计算（全表扫描）→ Top-K
v3：查询 → Embedding → HNSW 索引检索（近似）→ Top-20 → ACL 过滤 → Top-5
                 ↓（维度校验）
            维度不匹配 → 拦截 + 告警
                 ↓（批量队列）
         摄取后 → 队列 → 异步生成 Embedding
```

**关键变化**：增加"HNSW 索引"（性能优化）和"ACL 过滤"（权限控制）两个环节。

### 5.3 v3 完整代码（生产级实现）

#### 5.3.1 向量索引管理器（vector_search/vector_index_manager.py）

```python
# services/ai/src/ai_service/rag/vector_search/vector_index_manager.py
from prisma import Prisma

class VectorIndexManager:
    """向量索引管理器"""
    
    def __init__(self, prisma: Prisma):
        self.prisma = prisma
    
    async def create_hnsw_index(
        self,
        table: str = 'chunks',
        column: str = 'embedding',
        m: int = 16,
        ef_construction: int = 64
    ) -> None:
        """
        创建 HNSW 索引
        
        Args:
            table: 表名
            column: 向量列名
            m: HNSW 图的最大度数（越大检索越精确，但索引越大）
            ef_construction: 构建索引时的动态候选列表大小（越大构建越慢，但检索越精确）
        """
        index_name = f"{table}_{column}_hnsw_idx"
        
        # 检查索引是否已存在
        existing = await self.prisma.$queryRaw(
            f"SELECT 1 FROM pg_indexes WHERE indexname = '{index_name}'"
        )
        
        if existing:
            print(f"[VectorIndex] Index {index_name} already exists, skipping")
            return
        
        # 创建 HNSW 索引
        await self.prisma.$executeRaw(
            f"""
            CREATE INDEX {index_name} 
            ON {table} 
            USING hnsw ({column} vector_cosine_ops)
            WITH (m = {m}, ef_construction = {ef_construction})
            """
        )
        
        print(f"[VectorIndex] Created HNSW index: {index_name}")
    
    async def drop_index(self, index_name: str) -> None:
        """删除索引"""
        await self.prisma.$executeRaw(f"DROP INDEX IF EXISTS {index_name}")
        print(f"[VectorIndex] Dropped index: {index_name}")
    
    async def rebuild_index(
        self,
        table: str = 'chunks',
        column: str = 'embedding',
        m: int = 16,
        ef_construction: int = 64
    ) -> None:
        """重建索引（删除旧索引 + 创建新索引）"""
        index_name = f"{table}_{column}_hnsw_idx"
        
        # 删除旧索引
        await self.drop_index(index_name)
        
        # 创建新索引
        await self.create_hnsw_index(table, column, m, ef_construction)
```

**为什么需要 rebuild_index？**

HNSW 参数调优时需要重建索引（例如 `m=16` → `m=32`），重建比直接修改更可靠（pgvector 不支持 `ALTER INDEX`）。

#### 5.3.2 ACL 过滤器（vector_search/acl_filter.py）

```python
# services/ai/src/ai_service/rag/vector_search/acl_filter.py
from typing import List, Dict, Any

class ACLFilter:
    """ACL 后置过滤器"""
    
    def filter_by_tenant(
        self,
        results: List[Dict[str, Any]],
        user_tenant_id: str
    ) -> List[Dict[str, Any]]:
        """
        按租户过滤
        
        Args:
            results: 检索结果列表
            user_tenant_id: 当前用户的租户 ID
            
        Returns:
            过滤后的结果（只保留当前租户的 chunk）
        """
        filtered = []
        
        for result in results:
            metadata = result.get('metadata', {})
            
            # 提取 ACL（元数据里的 acl 字段）
            acl = metadata.get('acl', {})
            chunk_tenant_id = acl.get('tenant_id')
            
            # 租户隔离
            if chunk_tenant_id == user_tenant_id:
                filtered.append(result)
        
        return filtered
    
    def filter_by_acl(
        self,
        results: List[Dict[str, Any]],
        user_tenant_id: str,
        user_id: str,
        user_role: str
    ) -> List[Dict[str, Any]]:
        """
        完整 ACL 过滤（租户 + 用户 + 角色）
        
        Args:
            results: 检索结果列表
            user_tenant_id: 当前用户的租户 ID
            user_id: 当前用户 ID
            user_role: 当前用户角色
            
        Returns:
            过滤后的结果
        """
        filtered = []
        
        for result in results:
            metadata = result.get('metadata', {})
            acl = metadata.get('acl', {})
            
            # 1. 租户隔离
            if acl.get('tenant_id') != user_tenant_id:
                continue
            
            # 2. 检查用户 ID
            allowed_users = acl.get('allowed_users', [])
            if user_id in allowed_users:
                filtered.append(result)
                continue
            
            # 3. 检查角色
            allowed_roles = acl.get('allowed_roles', [])
            if user_role in allowed_roles:
                filtered.append(result)
                continue
        
        return filtered
```

**为什么 ACL 过滤在应用层而不是数据库查询？**

pgvector 的 HNSW 索引不支持带过滤条件的向量检索（`WHERE tenant_id = 'A' ORDER BY embedding <=> query`无法用 HNSW 索引）。必须先用 HNSW 索引检索 Top-20（无过滤），再在应用层过滤（只保留有权限的）。

#### 5.3.3 向量检索服务（vector_search/vector_search_service.py v3 版本）

```python
# services/ai/src/ai_service/rag/vector_search/vector_search_service.py (v3 版本)
from prisma import Prisma
from ..embedding.embedding_service import EmbeddingService
from .acl_filter import ACLFilter
from typing import List, Dict, Any

class VectorSearchService:
    """向量检索服务（v3 HNSW 索引 + ACL 过滤）"""
    
    def __init__(self, embedding_service: EmbeddingService, prisma: Prisma):
        self.embedding_service = embedding_service
        self.prisma = prisma
        self.acl_filter = ACLFilter()
    
    async def search_with_acl(
        self,
        query: str,
        user_tenant_id: str,
        user_id: str,
        user_role: str,
        top_k: int = 5,
        candidate_k: int = 20
    ) -> List[Dict[str, Any]]:
        """
        向量检索 + ACL 过滤
        
        Args:
            query: 查询文本
            user_tenant_id: 当前用户的租户 ID
            user_id: 当前用户 ID
            user_role: 当前用户角色
            top_k: 最终返回数量（默认 5）
            candidate_k: 候选数量（默认 20，大于 top_k，用于 ACL 过滤）
            
        Returns:
            过滤后的 Top-K 结果
        """
        # 1. 生成查询向量
        query_embedding = await self.embedding_service.generate_embedding(query)
        
        # 2. 向量检索（HNSW 索引，返回 Top-20）
        candidates = await self._hnsw_search(query_embedding, candidate_k)
        
        # 3. ACL 过滤（只保留有权限的）
        filtered = self.acl_filter.filter_by_acl(
            candidates,
            user_tenant_id,
            user_id,
            user_role
        )
        
        # 4. 返回 Top-K
        return filtered[:top_k]
    
    async def _hnsw_search(
        self,
        query_embedding: List[float],
        top_k: int
    ) -> List[Dict[str, Any]]:
        """
        HNSW 索引检索
        
        Args:
            query_embedding: 查询向量
            top_k: 返回数量
            
        Returns:
            检索结果（按相似度排序）
        """
        # pgvector 的 <=> 运算符：余弦距离（1 - 余弦相似度）
        # 越小越相似，所以用 ORDER BY embedding <=> query ASC
        results = await self.prisma.$queryRaw(
            f"""
            SELECT 
                id,
                content,
                metadata,
                1 - (embedding <=> $1::vector) AS similarity
            FROM chunks
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT {top_k}
            """,
            query_embedding
        )
        
        return [
            {
                'id': row['id'],
                'content': row['content'],
                'metadata': row['metadata'],
                'similarity': float(row['similarity'])
            }
            for row in results
        ]
```

**为什么 candidate_k 要大于 top_k？**

ACL 过滤可能过滤掉大部分结果（例如 Top-20 里只有 3 个属于当前租户）。candidate_k 大于 top_k 保证过滤后仍有足够的结果。

**为什么用 `1 - (embedding <=> query)` 而不是直接用 `<=>` ？**

`<=>` 是余弦距离（越小越相似），前端需要相似度分数（越大越相似），所以转换成 `1 - 距离`。

#### 5.3.4 批量 Embedding 队列（embedding/batch_embedding_queue.py）

```python
# services/ai/src/ai_service/rag/embedding/batch_embedding_queue.py
from bullmq import Queue, Worker, Job
from .embedding_service import EmbeddingService
from .embedding_dimension import EmbeddingModel
from prisma import Prisma

# 创建队列
embedding_queue = Queue('embedding', connection={'host': 'localhost', 'port': 6379})

# 初始化
prisma = Prisma()
embedding_service = EmbeddingService(model=EmbeddingModel.TEXT_EMBEDDING_3_SMALL)

async def process_embedding(job: Job):
    """处理 Embedding 任务"""
    chunk_id = job.data['chunk_id']
    content = job.data['content']
    
    try:
        # 1. 生成 Embedding
        embedding = await embedding_service.generate_embedding(content)
        
        # 2. 更新 chunk（写入 embedding 字段）
        await prisma.chunk.update(
            where={'id': chunk_id},
            data={'embedding': embedding}
        )
        
        return {'status': 'completed', 'chunk_id': chunk_id}
    
    except Exception as e:
        print(f"[Embedding] Failed to generate embedding for chunk {chunk_id}: {e}")
        raise e

# 创建 Worker
worker = Worker('embedding', process_embedding, connection={'host': 'localhost', 'port': 6379})
```

**为什么 Embedding 要用队列而不是同步生成？**

摄取 1000 个 chunk，同步生成 Embedding 需要 30 秒（1000 次 API 调用），会阻塞摄取。队列异步处理（摄取立即返回，后台慢慢生成 Embedding）。

#### 5.3.5 改造摄取队列（queue/ingestion_queue.py v3 版本）

```python
# services/ai/src/ai_service/queue/ingestion_queue.py (v3 版本，新增 Embedding 步骤)
from bullmq import Queue, Worker, Job
from ..rag.parsers.pdf_parser import PDFParser
from ..rag.chunking.semantic_chunker import SemanticChunker
from ..rag.deduplication.document_deduper import DocumentDeduper
from ..rag.metadata.metadata_extractor import MetadataExtractor
from ..rag.acl.acl_manager import ACLManager
from ..rag.embedding.batch_embedding_queue import embedding_queue
from prisma import Prisma

# 初始化
prisma = Prisma()
pdf_parser = PDFParser()
chunker = SemanticChunker()
deduper = DocumentDeduper(prisma)
metadata_extractor = MetadataExtractor()
acl_manager = ACLManager()

async def process_ingestion_v3(job: Job):
    """处理摄取任务（v3 版本，新增 Embedding）"""
    filename = job.data['filename']
    content = job.data['content']
    tenant_id = job.data['tenant_id']
    user_id = job.data['user_id']
    
    import base64
    content_bytes = base64.b64decode(content)
    
    # ... （Day 46 的摄取逻辑，省略）
    
    # ★ 新增：摄取完成后，加入 Embedding 队列
    chunks = await prisma.chunk.find_many(
        where={'documentId': document.id}
    )
    
    for chunk in chunks:
        await embedding_queue.add('generate', {
            'chunk_id': chunk.id,
            'content': chunk.content
        })
    
    return {'status': 'completed', 'chunks': len(chunks)}
```

**为什么摄取后才加入 Embedding 队列？**

摄取时 chunk 还没有 id（需要先存入 DB 才能拿到 id）。Embedding 队列需要 chunk_id（更新 embedding 字段）。

#### 5.3.6 改造搜索接口（api/search.py v3 版本）

```python
# services/ai/src/ai_service/api/search.py (v3 版本)
from fastapi import APIRouter, Depends
from ..rag.embedding.embedding_service import EmbeddingService
from ..rag.embedding.embedding_dimension import EmbeddingModel
from ..rag.vector_search.vector_search_service import VectorSearchService
from ..auth.dependencies import get_current_user  # 假设有认证中间件
from prisma import Prisma

router = APIRouter()

# 初始化
prisma = Prisma()
embedding_service = EmbeddingService(model=EmbeddingModel.TEXT_EMBEDDING_3_SMALL)
vector_search_service = VectorSearchService(embedding_service, prisma)

@router.get("/search")
async def search(
    q: str,
    top_k: int = 5,
    current_user = Depends(get_current_user)
):
    """
    向量检索接口（v3 版本，带 ACL 过滤）
    
    Args:
        q: 查询文本
        top_k: 返回 Top-K 结果（默认 5）
        current_user: 当前用户（从认证中间件获取）
        
    Returns:
        检索结果（按相似度排序，已过滤权限）
    """
    results = await vector_search_service.search_with_acl(
        query=q,
        user_tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        user_role=current_user.role,
        top_k=top_k,
        candidate_k=top_k * 4  # 候选数 = top_k * 4（保证过滤后有足够结果）
    )
    
    return {
        'query': q,
        'total': len(results),
        'results': [
            {
                'id': r['id'],
                'content': r['content'][:200] + '...',
                'similarity': round(r['similarity'], 4),
                'metadata': r['metadata']
            }
            for r in results
        ]
    }
```

### 5.4 v3 核心知识点（≥ 6 个，每个 5 要素）

#### 知识点 1：Embedding 向量化

**是什么**：把文本转成高维向量（1536 维或 3072 维浮点数数组），语义相似的文本向量接近。

**解决什么问题**：关键词匹配不理解语义（搜索"服务器宕机"找不到"服务器故障"）。

**怎么用**：
```python
embedding_service = EmbeddingService()
embedding = await embedding_service.generate_embedding("服务器故障")
```

**生产陷阱**：所有文本都用同一个模型。不同类型的文本应该用不同模型（例如长文本用 text-embedding-3-large，短文本用 text-embedding-3-small）。

**验证方法**：单元测试——生成 Embedding，验证维度是 1536。

#### 知识点 2：余弦相似度

**是什么**：计算两个向量的夹角余弦值（范围 [-1, 1]），越接近 1 越相似。

**解决什么问题**：判断两个文本是否语义相似（"服务器宕机" vs "服务器故障"相似度 > 0.9）。

**怎么用**：
```python
similarity = SimilarityCalculator.cosine_similarity(vec1, vec2)
```

**生产陷阱**：用欧氏距离而不是余弦相似度。欧氏距离受向量长度影响（长文本向量长度大，距离远），余弦相似度只关注方向（不受长度影响）。

**验证方法**：单元测试——相同向量相似度 = 1，正交向量相似度 = 0。

#### 知识点 3：pgvector HNSW 索引

**是什么**：近似最近邻搜索（ANN）索引，把精确距离计算优化成图遍历（O(n) → O(log n)）。

**解决什么问题**：100 万向量的精确距离计算需要 3 秒，HNSW 索引检索 < 100ms。

**怎么用**：
```sql
CREATE INDEX chunks_embedding_hnsw_idx 
ON chunks 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**生产陷阱**：HNSW 参数用默认值。`m` 太小会降低 Recall（漏掉相关结果），`ef_construction` 太小会降低索引质量。正确做法是"根据数据集调优"（例如 100 万向量用 `m=32, ef_construction=128`）。

**验证方法**：性能测试——100 万向量检索延迟 < 100ms + Recall@5 > 95%。

#### 知识点 4：ACL 后置过滤

**是什么**：先向量检索（Top-20），再在应用层过滤权限（只保留当前租户的 Top-5）。

**解决什么问题**：pgvector 不支持带过滤条件的向量检索（`WHERE tenant_id = 'A' ORDER BY embedding <=> query` 无法用 HNSW 索引）。

**怎么用**：
```python
candidates = await vector_search_service._hnsw_search(query_embedding, 20)
filtered = acl_filter.filter_by_tenant(candidates, user_tenant_id)
return filtered[:5]
```

**生产陷阱**：candidate_k = top_k。如果 candidate_k = 5，过滤后可能只剩 1 个结果（其他 4 个被过滤）。正确做法是"candidate_k = top_k * 4"（过滤后仍有足够结果）。

**验证方法**：集成测试——租户 A 搜索，验证返回结果都是租户 A 的 chunk。

#### 知识点 5：维度前置校验

**是什么**：Embedding 前检查维度配置（expected_dimension），生成后校验实际维度（actual_dimension），不匹配则抛异常。

**解决什么问题**：模型升级（1536 维 → 3072 维），批任务执行到 40% 才报错，索引留下新旧混合数据。

**怎么用**：
```python
embedding = await embedder.embed_text(text)
if len(embedding) != expected_dimension:
    raise ValueError("Dimension mismatch")
```

**生产陷阱**：维度校验在批任务里。批任务执行到一半才发现维度不匹配，已经写入了部分错误数据。正确做法是"维度校验在配置加载时"（启动时检查，失败则拒绝启动）。

**验证方法**：单元测试——配置 1536 维，模拟 API 返回 3072 维，验证抛异常。

#### 知识点 6：批量 Embedding 队列

**是什么**：摄取后把 chunk 加入队列，异步生成 Embedding（不阻塞摄取）。

**解决什么问题**：摄取 1000 个 chunk，同步生成 Embedding 需要 30 秒（1000 次 API 调用），阻塞摄取。

**怎么用**：
```python
await embedding_queue.add('generate', {
    'chunk_id': chunk.id,
    'content': chunk.content
})
```

**生产陷阱**：队列没有限流。1000 个 chunk 同时加入队列，瞬间发起 1000 个 API 调用，超过 OpenAI 的 rate limit。正确做法是"队列限流"（例如每分钟最多 100 个 Embedding）。

**验证方法**：集成测试——摄取立即返回（不等 Embedding 完成），队列 worker 异步生成 Embedding。

---
## §6 深挖前端底子（§6.5 必需章节）

### 6.1 今天为什么要深挖"前端向量检索缓存 + 本地索引降级"

Day 47 的核心是"服务端向量检索"（pgvector + HNSW 索引），但前端每次搜索都调用后端接口（网络延迟 50-200ms），重复查询浪费资源。正确做法是**前端缓存检索结果 + 本地向量索引降级**（常见查询缓存在本地，离线时用本地索引）。

今天深挖的不是"Vue 怎么缓存数据"（Day 01-05 已经掌握），而是"为什么向量检索缓存要用 LRU 而不是简单对象"（LRU 有淘汰策略，对象会无限增长）、"为什么本地向量索引要用 Web Worker 而不是主线程"（向量计算阻塞 UI）。

### 6.2 前端向量检索缓存的 3 个设计原则

#### 6.2.1 原则 1：用 LRU 缓存而不是简单对象

**错误做法**：前端用对象缓存检索结果。

```typescript
const cache = {}

function search(query: string) {
  if (cache[query]) {
    return cache[query]  // 命中缓存
  }
  
  const results = await fetch(`/api/search?q=${query}`)
  cache[query] = results  // 写入缓存
  return results
}
```

**问题**：
- 缓存无限增长（1000 次查询 = 1000 个缓存项，占用大量内存）
- 没有淘汰策略（旧查询永远不会被删除）

**正确做法**：用 LRU 缓存（最近最少使用淘汰）。

```typescript
// services/dashboard/src/utils/LRUCache.ts
class LRUCache<K, V> {
  private cache: Map<K, V>
  private maxSize: number
  
  constructor(maxSize: number = 100) {
    this.cache = new Map()
    this.maxSize = maxSize
  }
  
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined
    }
    
    // 命中缓存：移到最前面（表示最近使用）
    const value = this.cache.get(key)!
    this.cache.delete(key)
    this.cache.set(key, value)
    
    return value
  }
  
  set(key: K, value: V): void {
    // 如果已存在，先删除（移到最前面）
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }
    
    // 如果缓存满了，删除最旧的（Map 的第一个元素）
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    
    this.cache.set(key, value)
  }
  
  clear(): void {
    this.cache.clear()
  }
}

// 使用示例
const searchCache = new LRUCache<string, SearchResult[]>(100)  // 最多缓存 100 个查询

async function search(query: string) {
  // 1. 检查缓存
  const cached = searchCache.get(query)
  if (cached) {
    console.log('[Search] Cache hit:', query)
    return cached
  }
  
  // 2. 调用后端
  const results = await fetch(`/api/search?q=${query}`).then(r => r.json())
  
  // 3. 写入缓存
  searchCache.set(query, results.results)
  
  return results.results
}
```

**为什么用 Map 而不是对象？**

Map 保留插入顺序（`keys().next().value` 是最旧的元素），对象不保留顺序（`Object.keys()` 顺序不确定）。

#### 6.2.2 原则 2：本地向量索引用 Web Worker 而不是主线程

**错误做法**：前端在主线程计算向量相似度。

```typescript
function localSearch(query: string, chunks: Chunk[]) {
  const queryEmbedding = generateEmbedding(query)  // 假设有本地 Embedding 模型
  
  // 计算相似度（阻塞主线程）
  const results = chunks.map(chunk => ({
    ...chunk,
    similarity: cosineSimilarity(queryEmbedding, chunk.embedding)
  }))
  
  // 排序
  results.sort((a, b) => b.similarity - a.similarity)
  
  return results.slice(0, 5)
}
```

**问题**：
- 计算量大（1000 个 chunk × 1536 维 = 150 万次乘法），阻塞 UI（卡顿 2 秒）
- 用户无法交互（输入框无法输入）

**正确做法**：用 Web Worker 在后台线程计算。

```typescript
// services/dashboard/src/workers/vector-search.worker.ts
import { cosineSimilarity } from '../utils/similarity'

interface SearchMessage {
  type: 'search'
  queryEmbedding: number[]
  chunks: Array<{ id: string; content: string; embedding: number[] }>
  topK: number
}

self.onmessage = (e: MessageEvent<SearchMessage>) => {
  const { queryEmbedding, chunks, topK } = e.data
  
  // 计算相似度（在 Worker 线程，不阻塞主线程）
  const results = chunks.map(chunk => ({
    id: chunk.id,
    content: chunk.content,
    similarity: cosineSimilarity(queryEmbedding, chunk.embedding)
  }))
  
  // 排序 + Top-K
  results.sort((a, b) => b.similarity - a.similarity)
  const topResults = results.slice(0, topK)
  
  // 返回结果
  self.postMessage({ type: 'results', results: topResults })
}
```

```vue
<!-- services/dashboard/src/components/LocalSearch.vue -->
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const worker = ref<Worker | null>(null)
const searchResults = ref<any[]>([])
const isSearching = ref(false)

onMounted(() => {
  // 创建 Worker
  worker.value = new Worker(
    new URL('../workers/vector-search.worker.ts', import.meta.url),
    { type: 'module' }
  )
  
  // 监听 Worker 返回
  worker.value.onmessage = (e) => {
    if (e.data.type === 'results') {
      searchResults.value = e.data.results
      isSearching.value = false
    }
  }
})

onUnmounted(() => {
  worker.value?.terminate()
})

function localSearch(query: string, chunks: any[]) {
  isSearching.value = true
  
  // 发送给 Worker（不阻塞主线程）
  worker.value?.postMessage({
    type: 'search',
    queryEmbedding: generateEmbedding(query),  // 假设有本地 Embedding
    chunks,
    topK: 5
  })
}
</script>
```

**为什么用 Web Worker 而不是 setTimeout？**

setTimeout 仍然在主线程（只是延迟执行），大计算量仍然会阻塞 UI。Web Worker 是独立线程（真正的并行），不影响主线程。

#### 6.2.3 原则 3：离线降级用 IndexedDB 存储向量而不是 LocalStorage

**错误做法**：用 LocalStorage 存储向量。

```typescript
// 存储向量（LocalStorage）
localStorage.setItem('chunks', JSON.stringify(chunks))

// 读取向量
const chunks = JSON.parse(localStorage.getItem('chunks') || '[]')
```

**问题**：
- LocalStorage 容量限制（5-10MB），1000 个 chunk × 1536 维 × 4 字节 ≈ 6MB（接近上限）
- LocalStorage 是同步 API（读取 6MB 数据阻塞主线程）

**正确做法**：用 IndexedDB（容量更大 + 异步 API）。

```typescript
// services/dashboard/src/utils/vector-storage.ts
import { openDB, DBSchema } from 'idb'

interface VectorDB extends DBSchema {
  chunks: {
    key: string
    value: {
      id: string
      content: string
      embedding: number[]
      metadata: any
    }
  }
}

class VectorStorage {
  private db: any
  
  async init() {
    this.db = await openDB<VectorDB>('vector-db', 1, {
      upgrade(db) {
        // 创建 chunks 表
        db.createObjectStore('chunks', { keyPath: 'id' })
      }
    })
  }
  
  async saveChunks(chunks: any[]) {
    const tx = this.db.transaction('chunks', 'readwrite')
    
    for (const chunk of chunks) {
      await tx.store.put(chunk)
    }
    
    await tx.done
  }
  
  async loadChunks(): Promise<any[]> {
    return this.db.getAll('chunks')
  }
  
  async clear() {
    await this.db.clear('chunks')
  }
}

export const vectorStorage = new VectorStorage()
```

**为什么用 idb 库而不是原生 IndexedDB API？**

原生 IndexedDB API 是回调风格（不支持 async/await），idb 库是 Promise 风格（更易用）。

### 6.3 为什么不能只依赖"服务端检索"

**误区**："反正有后端检索，前端不需要缓存和本地索引"。

**错误原因**：
1. 网络延迟（每次查询 50-200ms，用户体验差）
2. 离线不可用（网络断开后无法搜索）
3. 服务端负载高（1000 个用户同时搜索 = 1000 次向量检索）

**正确分工**：
- **服务端检索**：首次查询、新数据、跨租户过滤
- **前端缓存**：重复查询（命中缓存立即返回）
- **本地索引**：离线场景、低延迟场景（例如"边输入边搜索"）

### 6.4 JavaScript 知识点：Float32Array vs Number[]

**JavaScript 数组**：`number[]` 是对象数组（每个元素 8 字节 + 对象开销）。

**Float32Array**：类型化数组（每个元素 4 字节，无对象开销），内存占用减半。

```typescript
// 错误：用 number[] 存储向量
const embedding: number[] = [0.1, 0.2, 0.3, ...]  // 1536 个元素 × 8 字节 = 12KB

// 正确：用 Float32Array 存储向量
const embedding = new Float32Array([0.1, 0.2, 0.3, ...])  // 1536 个元素 × 4 字节 = 6KB
```

**为什么用 Float32Array？**

1000 个 chunk，`number[]` 占用 12MB，`Float32Array` 占用 6MB（节省 50% 内存）。

### 6.5 CSS 知识点：搜索结果相似度的视觉层次

**原则**：相似度 > 0.9 用深绿色（高度相关），0.7-0.9 用浅绿色（一般相关），< 0.7 用灰色（低相关）。

**为什么用绿色而不是蓝色？**

绿色是"成功"色（用户认为"找到相关结果"），蓝色是"信息"色（用户认为"只是提示"）。高相似度是"成功找到"，应该用绿色。

```css
.similarity-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

/* 高度相关：深绿色 */
.similarity-high {
  background: #dcfce7;
  color: #166534;
}

/* 一般相关：浅绿色 */
.similarity-medium {
  background: #fef3c7;
  color: #92400e;
}

/* 低相关：灰色 */
.similarity-low {
  background: #f3f4f6;
  color: #6b7280;
}
```

```vue
<template>
  <div
    class="similarity-badge"
    :class="{
      'similarity-high': similarity >= 0.9,
      'similarity-medium': similarity >= 0.7 && similarity < 0.9,
      'similarity-low': similarity < 0.7
    }"
  >
    {{ Math.round(similarity * 100) }}%
  </div>
</template>
```

---

## §7 测试与验证（§7 必需章节）

### 7.1 单元测试（Embedding 生成 + 维度校验）

```python
# services/ai/tests/test_embedding.py
import pytest
from ai_service.rag.embedding.embedding_service import EmbeddingService
from ai_service.rag.embedding.embedding_dimension import EmbeddingModel, EmbeddingDimension

@pytest.mark.asyncio
async def test_embedding_dimension():
    """Embedding 维度应匹配模型配置"""
    service = EmbeddingService(model=EmbeddingModel.TEXT_EMBEDDING_3_SMALL)
    
    embedding = await service.generate_embedding("测试文本")
    
    expected_dim = EmbeddingDimension.get_dimension(EmbeddingModel.TEXT_EMBEDDING_3_SMALL)
    assert len(embedding) == expected_dim
    assert expected_dim == 1536

@pytest.mark.asyncio
async def test_batch_embedding():
    """批量 Embedding 应返回正确数量"""
    service = EmbeddingService()
    
    texts = ["文本1", "文本2", "文本3"]
    embeddings = await service.generate_embeddings_batch(texts)
    
    assert len(embeddings) == 3
    assert all(len(e) == 1536 for e in embeddings)
```

### 7.2 集成测试（向量检索 + ACL 过滤）

```python
# services/ai/tests/test_vector_search.py
import pytest
from ai_service.rag.vector_search.vector_search_service import VectorSearchService
from ai_service.rag.embedding.embedding_service import EmbeddingService
from prisma import Prisma

@pytest.fixture
async def search_service():
    prisma = Prisma()
    await prisma.connect()
    embedding_service = EmbeddingService()
    service = VectorSearchService(embedding_service, prisma)
    yield service
    await prisma.disconnect()

@pytest.mark.asyncio
async def test_acl_filter(search_service):
    """ACL 过滤应阻止跨租户访问"""
    # 假设已有测试数据：租户 A 和租户 B 的 chunk
    
    results = await search_service.search_with_acl(
        query="服务器故障",
        user_tenant_id="tenant-A",
        user_id="user-001",
        user_role="admin",
        top_k=5
    )
    
    # 验证：所有结果都属于租户 A
    for result in results:
        acl = result['metadata'].get('acl', {})
        assert acl.get('tenant_id') == "tenant-A"

@pytest.mark.asyncio
async def test_similarity_order(search_service):
    """检索结果应按相似度排序"""
    results = await search_service.search_with_acl(
        query="Nginx 504 错误",
        user_tenant_id="tenant-A",
        user_id="user-001",
        user_role="admin",
        top_k=5
    )
    
    # 验证：相似度递减
    similarities = [r['similarity'] for r in results]
    assert similarities == sorted(similarities, reverse=True)
```

### 7.3 反证实验 1：移除 HNSW 索引后检索变慢

**假设**：如果移除 HNSW 索引，100 万向量检索延迟从 85ms 增加到 3000ms。

**实验步骤**：
1. 删除 HNSW 索引（`DROP INDEX chunks_embedding_hnsw_idx`）
2. 执行向量检索（100 万个 chunk）
3. 测量延迟

**预期现象**：延迟增加到 3000ms（全表扫描 + 精确距离计算）。

**实际现象**（移除索引后）：
```
[VectorSearch] Query: "服务器故障"
[VectorSearch] Elapsed: 2954ms  (无索引，全表扫描)
```

**恢复操作**：重新创建 HNSW 索引，重新测试，验证延迟恢复到 85ms。

### 7.4 反证实验 2：移除 ACL 过滤后跨租户泄露

**假设**：如果移除 ACL 过滤，租户 A 的查询会返回租户 B 的结果。

**实验步骤**：
1. 注释掉 `search_with_acl()` 里的 ACL 过滤代码
2. 租户 A 执行查询
3. 观察返回结果的租户 ID

**预期现象**：返回租户 B 的结果（跨租户泄露）。

**实际现象**（移除 ACL 过滤后）：
```
[Search] Tenant A query: "服务器配置"
[Search] Found 10 results:
  - chunk-001: tenant-A
  - chunk-002: tenant-B  ← 泄露
  - chunk-003: tenant-A
  - chunk-004: tenant-C  ← 泄露
```

**恢复操作**：恢复 ACL 过滤代码，重新测试，验证只返回租户 A 的结果。

### 7.5 四件套（依赖图 + 时序图 + 日志 + commit）

#### 7.5.1 依赖图

```
api/search.py
    ↓
embedding/embedding_service.py ──→ openai_embedder.py
    ↓
vector_search/vector_search_service.py ──→ similarity_calculator.py
    ↓
vector_search/acl_filter.py
    ↓
返回 Top-5 结果
```

#### 7.5.2 时序图（向量检索全流程）

```
client       api          embedding    vector_search    acl_filter    pgvector
  │            │               │              │             │            │
  │─search─────→│               │              │             │            │
  │            │─generate──────→│              │             │            │
  │            │←vector─────────│              │             │            │
  │            │─search────────────────────→│             │            │
  │            │                              │─HNSW──────────────────→│
  │            │                              │←Top-20─────────────────│
  │            │                              │─filter────→│            │
  │            │                              │←Top-5──────│            │
  │            │←results─────────────────────│             │            │
  │←results────│               │              │             │            │
```

#### 7.5.3 测试日志截图

```
[Embedding] Generated embedding for "服务器故障" (1536 dims)
[VectorSearch] HNSW search returned 20 candidates
[ACLFilter] Filtered by tenant: tenant-A
[ACLFilter] After filtering: 5 results
[Search] Top-5 results:
  1. chunk-001 (similarity: 0.9421)
  2. chunk-042 (similarity: 0.9103)
  3. chunk-087 (similarity: 0.8956)
  4. chunk-123 (similarity: 0.8745)
  5. chunk-201 (similarity: 0.8632)
[Search] Elapsed: 87ms
```

#### 7.5.4 commit 信息

```bash
git add .
git commit -m "feat(rag): add vector search with pgvector HNSW index

- Add EmbeddingService with OpenAI integration
- Add VectorSearchService with HNSW index support
- Add ACLFilter for tenant isolation
- Add batch embedding queue for async processing
- Add dimension validation to prevent mismatch
- Add HNSW index to chunks table

Refs: Day47"
```

---
## 8. 通关检查清单（v3 规范 11 项）

Day 47 交付前的自查：

1. **§0 位置声明**：已写明"阶段二第 7 天"、Day 46 前置依赖、Day 48-50 后续对齐
2. **§1.1 用户能看到什么**：已写 5 个场景（语义搜索、相似度排序、快速检索、维度不匹配告警、ACL 过滤）
3. **§1.4 目录结构 5 块**：已写骨架树 + 为什么分层 5 问 + diff 表格 + 依赖箭头 + 3 个灵魂拷问
4. **§1.5 脚手架检查**：已写 Prisma Schema（embedding 字段 + HNSW 索引）+ OpenAI API Key 配置
5. **三版演进**：v1 关键词匹配 → v2 OpenAI Embedding + 精确检索 → v3 HNSW 索引 + ACL 过滤 + 批量队列
6. **§5.3 完整代码**：EmbeddingService、OpenAIEmbedder、VectorSearchService、ACLFilter、VectorIndexManager、BatchEmbeddingQueue，无省略号
7. **§5.4 ≥ 6 知识点**：Embedding 向量化、余弦相似度、pgvector HNSW 索引、ACL 后置过滤、维度前置校验、批量 Embedding 队列，每个 5 要素
8. **§6.5 前端底子补弱**：深挖"前端向量检索缓存 + 本地索引降级" + LRU 缓存 + Web Worker + IndexedDB + Float32Array
9. **§7 测试 4 件套**：单元测试（Embedding 维度校验）+ 集成测试（ACL 过滤）+ 反证实验 1（移除 HNSW 索引）+ 反证实验 2（移除 ACL 过滤）+ 依赖图 + 时序图 + 日志 + commit
10. **0 个 `> ✅/❌` blockquote**：全文无此格式
11. **commit 不含 git push**：commit 信息写 `Refs: Day47`，不执行 push

---

## 9. 从今天的增量到下一站

### 9.1 今天建立的能力地基

Day 47 交付的向量检索能力（Embedding + 向量相似度 + HNSW 索引 + ACL 过滤）是后续 3 天的基础：

1. **Day 48 Rerank**：检索时先用向量检索（召回 Top-20），再用 Rerank 模型重排序（精排 Top-5）
2. **Day 49 Hybrid Search**：结合向量检索和关键词检索（BM25），互补提升 Recall
3. **Day 50 RAG 完整链路**：检索 → Rerank → 生成答案（使用今天检索的 chunk 作为上下文）

### 9.2 今天留下的 3 个待优化点

1. **无 Rerank**：v3 只用向量检索（单一召回源），相似度可能不准（例如"Nginx 504"和"Apache 504"向量相似，但语义不同）。Day 48 会补充 Rerank（重排序，提升精度）。

2. **无关键词检索**：v3 只用向量检索，无法匹配精确关键词（例如"版本号 1.2.3"无法匹配"1.2.3"）。Day 49 会补充 Hybrid Search（向量 + 关键词）。

3. **无检索审计**：v3 不记录"谁检索了什么"、"返回了哪些 chunk"，无法追溯检索历史。Day 50 会补充检索审计日志。

### 9.3 下一站要解决的核心问题

**Day 48：Rerank（重排序 + Cross-Encoder + 精排）**

核心挑战：
- 如何用 Rerank 模型重排序（Cohere Rerank API vs 本地模型）？
- 如何优化 Rerank 性能（Top-20 候选 Rerank < 50ms）？
- 如何评估 Rerank 效果（MRR vs NDCG）？
- 如何在前端显示 Rerank 分数（和向量相似度的区别）？

---

## 10. 本日小结（标题党 30 字 + 三句话）

**标题**：Embedding 理解语义、HNSW 索引提速、ACL 后置过滤防泄露、维度校验防混合、批量队列不阻塞——向量检索完整实现

Day 47 建立了统一向量检索机制，解决了"关键词不理解语义"、"全表扫描慢"、"跨租户泄露"、"维度不匹配"、"批量 Embedding 阻塞"五个生产痛点。核心机制是"OpenAI Embedding 生成向量（1536 维）+ pgvector HNSW 索引（m=16, ef_construction=64）+ 余弦相似度排序 + ACL 后置过滤（先检索 Top-20，再过滤租户）+ 维度前置校验（防止模型升级混合数据）+ 批量 Embedding 队列（异步生成，不阻塞摄取）"。今天建立的向量检索能力是 Day 48-50 Rerank + Hybrid Search + RAG 完整链路的召回基座。

---

## 11. 课后三道核心问题（必答，先于教师五连问）

### 问题 1：请从今天项目的真实入口到最终输出，解释"向量检索"的数据流或控制流；当天知识链"Embedding、向量距离、pgvector 索引、top-k、过滤"分别在哪一层起作用，为什么按这个顺序学习？

**数据流**：
```
前端输入查询："服务器故障"
  → API 接收：/api/search?q=服务器故障
  → EmbeddingService 生成查询向量（调用 OpenAI API）
  → 维度校验（1536 维，匹配配置）
  → VectorSearchService 向量检索
  → pgvector 执行 HNSW 索引检索（ORDER BY embedding <=> query_vector LIMIT 20）
  → 返回 Top-20 候选（未过滤）
  → ACLFilter 过滤租户（只保留当前租户的 chunk）
  → 返回 Top-5 结果（已过滤）
  → 前端显示（按相似度排序）
```

**知识链分层**：
- **Embedding**：EmbeddingService 向量化层（文本 → 向量）
- **向量距离**：SimilarityCalculator 相似度层（计算余弦相似度）
- **pgvector 索引**：VectorIndexManager 索引层（HNSW 近似最近邻）
- **top-k**：VectorSearchService 检索层（返回 Top-K）
- **过滤**：ACLFilter 权限层（租户隔离）

**为什么按这个顺序学习**：
1. 先学 Embedding（把文本转成向量），才能谈"如何比较向量"
2. 再学向量距离（余弦相似度），才能谈"如何优化检索"
3. 再学 pgvector 索引（HNSW），才能谈"如何返回 Top-K"
4. 再学 top-k（返回最相似的 K 个），才能谈"如何过滤权限"
5. 最后学过滤（ACL），才能谈"完整的检索链路"

这个顺序是"从原始查询到过滤结果"的完整链路。

### 问题 2：如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

**移除的机制**：HNSW 索引（改成全表扫描精确检索）。

**可观察现象**：100 万个 chunk 检索延迟从 85ms 增加到 3000ms，用户感觉"搜索很慢"。

**最小复现**：
1. 删除 HNSW 索引：`DROP INDEX chunks_embedding_hnsw_idx`
2. 执行向量检索：`/api/search?q=服务器故障`
3. 测量延迟

**定位证据**：
```sql
-- 查询执行计划
EXPLAIN ANALYZE
SELECT id, content, 1 - (embedding <=> '[0.1, 0.2, ...]'::vector) AS similarity
FROM chunks
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 5;

-- 无索引：Seq Scan (全表扫描)
-- Execution Time: 2954.123 ms
```

日志：
```
[VectorSearch] Query: "服务器故障"
[VectorSearch] EXPLAIN ANALYZE: Seq Scan on chunks (cost=0.00..1234567.89 rows=1000000 width=...)
[VectorSearch] Elapsed: 2954ms  ← 慢
```

**恢复动作**：
1. 重新创建 HNSW 索引
2. 验证索引创建成功（`\d chunks` 查看索引列表）
3. 重新执行检索，验证延迟恢复到 85ms

**防复发测试**（性能测试）：
```python
async def test_vector_search_performance():
    """向量检索延迟应 < 100ms"""
    import time
    
    service = VectorSearchService(embedding_service, prisma)
    
    start = time.time()
    results = await service.search_with_acl(
        query="服务器故障",
        user_tenant_id="tenant-A",
        user_id="user-001",
        user_role="admin",
        top_k=5
    )
    elapsed = (time.time() - start) * 1000
    
    assert elapsed < 100  # 延迟应 < 100ms
    assert len(results) == 5
```

### 问题 3：请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

**代码证据**：
- `rag/embedding/embedding_service.py` 第 28 行：`generate_embedding()` 方法生成 1536 维向量
- `rag/vector_search/vector_search_service.py` 第 45 行：`_hnsw_search()` 方法用 pgvector HNSW 索引检索
- `rag/vector_search/acl_filter.py` 第 18 行：`filter_by_tenant()` 方法按租户过滤
- `rag/embedding/batch_embedding_queue.py` 第 15 行：批量 Embedding 队列异步处理

**测试证据**：
- `tests/test_embedding.py` 第 12 行：验证 Embedding 维度是 1536
- `tests/test_vector_search.py` 第 28 行：验证 ACL 过滤只返回当前租户的结果

**架构证据**：
- 依赖图（§7.5.1）：展示 5 层分层（embedding / vector_search / acl_filter / pgvector）
- 时序图（§7.5.2）：展示向量检索完整流程（生成向量 → HNSW 检索 → ACL 过滤）

**项目目标达成**：
- ✅ Embedding 生成（OpenAI text-embedding-3-small，1536 维）
- ✅ 向量相似度计算（余弦相似度）
- ✅ pgvector HNSW 索引（m=16, ef_construction=64）
- ✅ Top-K 检索（返回 Top-5）
- ✅ ACL 后置过滤（租户隔离）
- ✅ 维度前置校验（防止维度不匹配）
- ✅ 批量 Embedding 队列（异步生成，不阻塞摄取）

**距离企业生产标准还缺**：
1. **无 Rerank**：向量检索可能返回语义相似但不相关的结果（例如"Nginx 504"和"Apache 504"向量相似，但用户只想要 Nginx）
2. **无关键词检索**：无法匹配精确关键词（例如"版本号 1.2.3"）
3. **无检索审计**：不记录"谁检索了什么"、"返回了哪些 chunk"，无法追溯检索历史
4. **无检索缓存**：重复查询每次都调用 pgvector（浪费资源）

**下一步演进（不破坏合同）**：
- 在 `VectorSearchService` 新增 `search_with_rerank()` 方法（先向量检索，再 Rerank）
- 在 `VectorSearchService` 新增 `hybrid_search()` 方法（向量 + 关键词）
- 新增 `SearchAuditLog` 表（记录检索历史）
- 在 `VectorSearchService` 新增 LRU 缓存（缓存检索结果）

---

## 12. 真实项目情境题（Day 47 原版，保持原样）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：Embedding 模型由 1536 维升级为 3072 维，批任务执行到 40% 才报错，索引留下新旧混合数据。请检查模型版本、vector dimension、批次和事务日志，先停止写入并隔离新版本，再修复维度前置校验和原子切换，验证失败批次可重跑且索引一致。
   依据：[pgvector](https://github.com/pgvector/pgvector)

2. 模拟情境：1000 万向量加 tenant/ACL filter 后 P95 为 2.4 s，且抽样发现跨权限结果。请用 EXPLAIN、索引命中、过滤后候选数和 Trace 定位，先强制授权后过滤并降低 top-k，再比较 HNSW、IVFFlat 与精确搜索，验证延迟、Recall 和越权率。
   依据：[pgvector](https://github.com/pgvector/pgvector)

知识映射：对应 Embedding、维度、pgvector 索引、top-k 与过滤。

---

## 13. PDF 面试题映射（Day 47 原版，保持原样）

1. 如果实现前端本地向量检索，会怎样选择 Embedding、向量库、相似度和 Worker？  
   来源：[《2026京东前端面试-AI Coding方向》](<../../资源/2026京东前端面试-AI Coding方向.pdf>)，第 5 页。

2. RAG 前端如何处理本地向量检索、缓存、过滤和向量索引过大的降级？  
   来源：[《2026腾讯混元AIGC前端架构师》](<../../资源/2026腾讯混元AIGC前端架构师.pdf>)，第 6 页。

题目说明：近似题：直接覆盖向量化与检索流程，但没有 pgvector 索引、维度校验和 ACL filter 的后端细节。

---

## 14. 完成后教师五连问（Day 47 原版，保持原样）

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
