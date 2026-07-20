# Day 46 - RAG 摄取（解析 + 切分 + 元数据 + 去重 + 权限）

> **《90 天拆分规则说明》校正口径（本节优先于正文中的旧阶段编号和旧时间表）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。继续在 `p1-monitor` 中补齐全栈与 AI 能力，并复用前 30 天的事件合同、状态管理和实时链路。
> - **功能交付**：本日必须交付一个能跑、能测、能从用户入口观察结果的完整模块；知识点只能由该模块自然引出。
> - **三版演进**：正文 §3/§4/§5 分别对应 v1 最小闭环、v2 增加一个关键设计维度、v3 生产终态；v1/v2 必须写明可观察痛点，v3 必须解决这些痛点。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（共 90 分钟阅读）；D 60 分钟、E 20 分钟、F 10 分钟（共 90 分钟动手）。正文其他旧时间表不再作为执行口径。
> - **累积复用**：开始前读取上一日 commit 和当前源码；当天新增合同必须复用已有事件、Schema、状态或持久化边界，禁止复制出第二套平行实现。
> - **验收门槛**：核心测试 + 两个产生不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 提交后动态教师五连问，缺一项即不通过。
>
> **跨 Day 导航修正**：后续真实顺序：Day47 向量检索，Day48 Hybrid/Rerank，Day49 RAG 引用闭环。

日期与时长：2026-08-28 周五，180 分钟（90 分钟阅读 + 90 分钟动手）
项目：`D:\demo\ai-techer\p1-monitor`
阶段任务性质：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

> **本日项目完整目录结构**（在 Day45 Prompt Registry 基础上新增 RAG 摄取层）
>
> ```
> services/ai/src/ai_service/
> ├── rag/                           # ★ 今天新增：RAG 摄取层
> │   ├── __init__.py
> │   ├── ingestion/                 # 摄取管道层
> │   │   ├── __init__.py
> │   │   ├── ingestion_pipeline.py ← 核心：你手写（摄取管道）
> │   │   ├── document_processor.py ← 核心：你手写（文档处理器）
> │   │   └── ingestion_state.py    ← 样板：摄取状态机
> │   ├── parsers/                   # 解析器层
> │   │   ├── __init__.py
> │   │   ├── parser_registry.py    ← 核心：你手写（解析器注册表）
> │   │   ├── pdf_parser.py         ← 核心：你手写（PDF 解析）
> │   │   ├── markdown_parser.py    ← 样板：Markdown 解析
> │   │   └── text_parser.py        ← 样板：纯文本解析
> │   ├── chunking/                  # 切分层
> │   │   ├── __init__.py
> │   │   ├── chunker.py            ← 核心：你手写（切分策略）
> │   │   ├── fixed_size_chunker.py ← 核心：你手写（固定长度）
> │   │   ├── semantic_chunker.py   ← 核心：你手写（语义边界）
> │   │   └── chunk_overlap.py      ← 样板：重叠策略
> │   ├── metadata/                  # 元数据层
> │   │   ├── __init__.py
> │   │   ├── metadata_extractor.py ← 核心：你手写（元数据提取）
> │   │   ├── metadata_validator.py ← 核心：你手写（元数据校验）
> │   │   └── metadata_schema.py    ← 样板：元数据 Schema
> │   ├── deduplication/             # 去重层
> │   │   ├── __init__.py
> │   │   ├── document_deduper.py   ← 核心：你手写（文档去重）
> │   │   ├── content_hash.py       ← 核心：你手写（内容哈希）
> │   │   └── similarity_deduper.py ← 样板：相似度去重
> │   ├── acl/                       # 权限控制层
> │   │   ├── __init__.py
> │   │   ├── acl_manager.py        ← 核心：你手写（ACL 管理）
> │   │   ├── permission_checker.py ← 核心：你手写（权限检查）
> │   │   └── tenant_isolation.py   ← 样板：租户隔离
> │   └── storage/                   # 存储层
> │       ├── __init__.py
> │       ├── document_store.py     ← 样板：文档存储（Postgres）
> │       └── chunk_store.py        ← 样板：Chunk 存储
> ├── queue/
> │   └── ingestion_queue.py        ← 修改：新增摄取队列（BullMQ）
> └── tests/
>     ├── test_parser.py            ← 核心：你手写（解析器测试）
>     ├── test_chunker.py           ← 核心：你手写（切分测试）
>     ├── test_deduplication.py     ← 核心：你手写（去重测试）
>     └── test_acl.py               ← 核心：你手写（权限测试）
> ```

## §0 今天在 90 天里的位置

**坐标**：阶段二（AI 前端 -> AI 全栈）第 6 天。

**承前**：Day45 你建立了 Prompt Registry（版本管理 + 灰度 + 回滚），让 Prompt 可以独立迭代。但 AI 诊断服务器问题时，没有"历史运维文档"作为知识库（只能根据当前指标诊断，不能参考"类似问题的历史解决方案"）。今天要建立 RAG 摄取管道（Ingestion Pipeline），把运维文档（PDF、Markdown）解析、切分、加元数据、去重、加权限，存入知识库，供后续检索使用。

**启后**：今天建立的摄取管道是 Day47-50 RAG 检索的数据基座。Day47 的向量检索、Day48 的 Hybrid/Rerank、Day49 的引用闭环，都依赖今天摄入的 chunk。

**今天必须解决的 5 个问题**：

1. **文档解析失败不可见**：上传 5000 个 PDF，其中 200 个解析失败（格式错误），但摄取队列没有失败任务列表，运维不知道哪些文档失败（对应情境题 2）。
2. **重复摄取不去重**：同一个文档上传 2 次，生成 2 份 chunk（内容相同），浪费存储 + 检索时返回重复结果（对应情境题 1）。
3. **切分边界不合理**：固定 512 字切分，可能在句子中间切断（"服务器重启操作：1. 停止服务 2. 清空缓存｜3. 启动服务"，`｜` 是切分点），导致 chunk 语义不完整。
4. **元数据缺失**：chunk 没有记录"来源文档"、"所属租户"、"创建时间"，检索时无法过滤（例如"只查询租户 A 的文档"）。
5. **无权限控制**：租户 A 上传的文档，租户 B 也能检索到，泄露敏感信息（对应情境题 2）。

**知识链顺序**：`解析`（先把文档转成文本）→ `chunking`（把长文本切成小块）→ `metadata`（给 chunk 加标签）→ `去重`（防止重复摄取）→ `ACL`（加权限控制）→ `版本`（支持文档更新）。这个顺序是"从原始文档到可检索 chunk"的完整链路。

---

## §1 今天要做的事

### 1.1 五个真实用户场景

今天的 RAG 摄取管道要支撑这些真实链路（从上传文档到 chunk 入库）：

1. **上传 PDF 文档**：运维上传"服务器故障排查手册.pdf"（200 页），摄取管道自动解析（PDF → 文本）→ 切分（200 页 → 400 个 chunk）→ 加元数据（来源、作者、租户）→ 去重（检查是否已存在）→ 存入知识库。
2. **切分语义完整**：文档内容"操作步骤：1. 停止服务 2. 清空缓存 3. 启动服务"，切分时不在步骤中间切断（保证每个 chunk 语义完整）。
3. **重复上传不重复摄取**：同一个 PDF 上传 2 次（内容相同），第二次上传时检测到重复，跳过解析（不生成新 chunk）。
4. **元数据过滤**：检索时只查询"租户 A 的文档"（通过 `metadata.tenant='A'` 过滤），不返回租户 B 的文档。
5. **失败任务可见**：上传 100 个文档，其中 5 个解析失败，运维可以查看"失败任务列表"（失败原因 + 文档名称）。

### 1.2 模块职责划分

| 模块 | 职责 | 谁写 |
|------|------|------|
| `rag/ingestion/ingestion_pipeline.py` | 摄取管道（编排解析 → 切分 → 元数据 → 去重 → 存储） | 你手写 |
| `rag/parsers/pdf_parser.py` | PDF 解析（PDF → 文本） | 你手写 |
| `rag/chunking/fixed_size_chunker.py` | 固定长度切分（512 字/chunk） | 你手写 |
| `rag/chunking/semantic_chunker.py` | 语义边界切分（按段落/章节切分） | 你手写 |
| `rag/metadata/metadata_extractor.py` | 元数据提取（提取标题、作者、日期） | 你手写 |
| `rag/deduplication/document_deduper.py` | 文档去重（内容哈希） | 你手写 |
| `rag/acl/acl_manager.py` | ACL 管理（权限控制） | 你手写 |
| `queue/ingestion_queue.py` | 摄取队列（BullMQ） | 你手写 |

### 1.3 三版演进：从"同步解析"到"队列摄取 + 去重 + ACL"

**v1（同步解析）**：用户上传 PDF → 同步解析 → 同步切分 → 存入 DB。能跑，但上传 200 页 PDF 需要等待 30 秒（用户体验差），无去重、无 ACL。

**v2（加队列 + 基础去重）**：上传 PDF → 加入队列 → 异步解析。支持异步处理和基础去重（文件名去重），但无元数据、无 ACL、无语义切分。

**v3（生产级）**：加完整元数据（来源、租户、版本）+ 内容哈希去重（不是文件名）+ 语义切分（按段落边界）+ ACL 权限控制 + 失败任务可见（查询失败列表）。让摄取管道具备"生产可用"的完整能力。

三版对比：

| 维度 | v1 | v2 | v3 |
|------|----|----|----|
| 处理方式 | ❌ 同步（阻塞用户） | ✅ 异步队列 | ✅ 异步队列 + 优先级 |
| 去重策略 | ❌ 无 | ⚠️ 文件名去重 | ✅ 内容哈希去重 |
| 切分策略 | ⚠️ 固定 512 字 | ⚠️ 固定 512 字 | ✅ 语义边界切分 |
| 元数据 | ❌ 无 | ⚠️ 基础元数据（文件名） | ✅ 完整元数据（来源、租户、版本、作者、日期） |
| 权限控制 | ❌ 无 | ❌ 无 | ✅ ACL（租户隔离） |
| 失败处理 | ❌ 静默失败 | ⚠️ 记录日志 | ✅ 失败任务队列 + 可查询 |
| 版本管理 | ❌ 无 | ❌ 无 | ✅ 文档版本（支持更新） |

**三个灵魂问题**（写代码前先想）：

1. 去重用"文件名"还是"内容哈希"？文件名可以改（重命名后被识别为新文档），内容哈希稳定（内容相同 = 同一个文档）。本项目用内容哈希（SHA256）。
2. 切分用"固定长度"还是"语义边界"？固定长度简单但可能切断句子，语义边界复杂但保证语义完整。本项目两者都实现（v1 用固定长度，v3 加语义边界，用户可选）。
3. 元数据存在 chunk 表还是单独的 metadata 表？存在 chunk 表查询方便（不需要 JOIN），但字段冗余（每个 chunk 都有相同的 `documentId`）。本项目存在 chunk 表（查询性能优先）。

### 1.4 目录结构说明（RAG 摄取分层的为什么）

**为什么 parsers/ 和 chunking/ 分开？**

parsers/ 是"文档格式转换"（PDF → 文本、Markdown → 文本），chunking/ 是"文本切分"（长文本 → 小 chunk）。分开是因为：解析器可以换（PyPDF2 改成 pdfplumber），但切分逻辑不变。

**为什么 metadata/ 独立成层？**

元数据提取是可选的增强功能——基础摄取只需要"文本内容"（不需要元数据），高级摄取需要"来源、作者、日期"（用于过滤）。独立成层让元数据提取可插拔。

**为什么 deduplication/ 和 acl/ 分开？**

deduplication/ 是"数据质量保证"（防止重复摄取），acl/ 是"安全保证"（防止越权访问）。分开是因为两者的目标不同（去重保证质量，ACL 保证安全）。

**与 Day45 的 diff**：

| 文件 | 状态 | 说明 |
|------|------|------|
| `rag/**` | 🆕 全新 | RAG 摄取层 |
| `queue/ingestion_queue.py` | 🆕 全新 | 摄取队列（BullMQ） |

---

## §2 今天的开发节奏（3 小时怎么分配）

| 时段 | 时长 | 做什么 |
|------|------|--------|
| 原理与源码 | 90 min | PDF 解析、语义切分、内容哈希去重、ACL 和摄取三版痛点 |
| v1 同步解析 | 20 min | 同步解析接口（暴露阻塞问题） |
| v2 队列 + 基础去重 | 20 min | IngestionQueue + DocumentDeduper + FixedSizeChunker |
| v3 元数据 + ACL + 语义切分 | 20 min | MetadataExtractor + ACLManager + SemanticChunker + ContentHash |
| 测试验证 | 20 min | 坏 PDF、重复文档、权限缺失、worker crash + 两个反证实验 |
| 架构证据 | 10 min | Ingestion pipeline ADR + 时序图 |

**关键节奏提醒**：v1 只花 10 分钟，快速暴露"同步阻塞"的问题。真正的功夫在 v2 的队列化和 v3 的元数据 + ACL 机制。

---
## §3 v1：同步解析（暴露阻塞问题）

### 3.1 v1 能做什么

用户上传 PDF → 同步解析 → 同步切分 → 存入 DB，实现"PDF 转 chunk"。

```python
# services/ai/src/ai_service/api/ingestion.py (v1 版本)
from fastapi import APIRouter, UploadFile, File
from ..rag.parsers.pdf_parser import PDFParser
from ..rag.chunking.fixed_size_chunker import FixedSizeChunker
from prisma import Prisma

router = APIRouter()
pdf_parser = PDFParser()
chunker = FixedSizeChunker(chunk_size=512)
prisma = Prisma()

@router.post("/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    # 1. 读取文件
    content = await file.read()
    
    # 2. 解析 PDF（同步，阻塞）
    text = pdf_parser.parse(content)
    
    # 3. 切分（同步）
    chunks = chunker.chunk(text)
    
    # 4. 存入 DB（同步）
    for i, chunk_text in enumerate(chunks):
        await prisma.chunk.create(
            data={
                'documentId': file.filename,
                'content': chunk_text,
                'chunkIndex': i,
            }
        )
    
    return {'chunks_created': len(chunks)}
```

### 3.2 v1 的 5 个致命问题

1. **同步阻塞**：上传 200 页 PDF 需要等待 30 秒（解析 15 秒 + 切分 5 秒 + 存储 10 秒），用户体验差。
2. **无去重**：同一个 PDF 上传 2 次，生成 2 份 chunk（内容相同），浪费存储。
3. **固定切分**：512 字切分，可能在句子中间切断（"操作步骤：1. 停止｜服务 2. 启动"）。
4. **无元数据**：chunk 没有记录"来源文档"、"租户"、"创建时间"，检索时无法过滤。
5. **无权限控制**：所有用户都能检索到所有文档（无租户隔离）。

---

## §4 v2：队列 + 基础去重

### 4.1 v2 新增的能力

1. **异步队列**：上传文档 → 加入队列 → 立即返回（不阻塞），后台 worker 异步处理。
2. **文件名去重**：上传前检查文件名是否已存在，存在则跳过（不重复摄取）。
3. **失败重试**：解析失败自动重试 3 次（指数退避）。

### 4.2 v2 核心代码

#### 4.2.1 Prisma Schema（documents + chunks 表）

```prisma
# services/ai/prisma/schema.prisma（新增 RAG 相关表）

model Document {
  id              String   @id @default(cuid())
  filename        String   @unique  // 文件名（用于 v2 去重）
  contentHash     String?  @unique  // 内容哈希（用于 v3 去重）
  status          String   @default("pending")  // pending/processing/completed/failed
  totalChunks     Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  chunks          Chunk[]
  
  @@index([filename])
  @@index([contentHash])
  @@index([status])
}

model Chunk {
  id              String   @id @default(cuid())
  documentId      String
  content         String   @db.Text
  chunkIndex      Int
  metadata        Json?    // 元数据（来源、租户、版本）
  createdAt       DateTime @default(now())
  
  document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, chunkIndex])
  @@index([documentId])
}
```

#### 4.2.2 PDF 解析器（pdf_parser.py）

```python
# services/ai/src/ai_service/rag/parsers/pdf_parser.py
from pypdf import PdfReader
from io import BytesIO
from typing import Optional

class PDFParser:
    """PDF 解析器（基于 pypdf）"""
    
    def parse(self, content: bytes) -> str:
        """
        解析 PDF 文件
        
        Args:
            content: PDF 文件字节流
            
        Returns:
            解析后的文本
        """
        try:
            reader = PdfReader(BytesIO(content))
            text_parts = []
            
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    text_parts.append(text)
            
            return '\n\n'.join(text_parts)
        
        except Exception as e:
            raise ValueError(f"Failed to parse PDF: {str(e)}")
```

**为什么用 pypdf 而不是 PyPDF2？**

pypdf 是 PyPDF2 的继任者（更新更活跃），支持更多 PDF 格式（例如加密 PDF、压缩 PDF）。PyPDF2 已经不维护。

#### 4.2.3 固定长度切分器（fixed_size_chunker.py）

```python
# services/ai/src/ai_service/rag/chunking/fixed_size_chunker.py
from typing import List

class FixedSizeChunker:
    """固定长度切分器"""
    
    def __init__(self, chunk_size: int = 512, overlap: int = 50):
        """
        Args:
            chunk_size: 每个 chunk 的字符数
            overlap: 重叠字符数（避免切断上下文）
        """
        self.chunk_size = chunk_size
        self.overlap = overlap
    
    def chunk(self, text: str) -> List[str]:
        """
        切分文本
        
        Args:
            text: 待切分文本
            
        Returns:
            chunk 列表
        """
        if not text:
            return []
        
        chunks = []
        start = 0
        
        while start < len(text):
            end = start + self.chunk_size
            chunk_text = text[start:end]
            
            # 如果不是最后一个 chunk，尝试在空格处切分（避免切断单词）
            if end < len(text):
                last_space = chunk_text.rfind(' ')
                if last_space > self.chunk_size * 0.8:  # 至少保留 80%
                    end = start + last_space + 1
                    chunk_text = text[start:end]
            
            chunks.append(chunk_text.strip())
            
            # 下一个 chunk 从 overlap 位置开始
            start = end - self.overlap
        
        return chunks
```

**为什么要 overlap（重叠）？**

固定切分可能切断上下文（"服务器重启步骤：1. 停止服务｜ 2. 启动服务"，`｜` 是切分点）。overlap 让相邻 chunk 有 50 字重叠，保留上下文（chunk1 结尾是"1. 停止服务"，chunk2 开头也包含"1. 停止服务"）。

#### 4.2.4 文档去重器（document_deduper.py v2 版本）

```python
# services/ai/src/ai_service/rag/deduplication/document_deduper.py (v2 版本)
from prisma import Prisma

class DocumentDeduper:
    """文档去重器（基于文件名）"""
    
    def __init__(self, prisma: Prisma):
        self.prisma = prisma
    
    async def is_duplicate(self, filename: str) -> bool:
        """
        检查文件名是否已存在
        
        Args:
            filename: 文件名
            
        Returns:
            True = 已存在（重复），False = 不存在（可摄取）
        """
        existing = await self.prisma.document.find_unique(
            where={'filename': filename}
        )
        return existing is not None
```

**为什么 v2 用文件名去重而不是内容哈希？**

v2 是"渐进式迁移"——先实现基础去重（文件名），再升级到内容哈希（v3）。文件名去重简单（不需要读文件内容），但不准确（重命名后被识别为新文档）。

#### 4.2.5 摄取队列（ingestion_queue.py）

```python
# services/ai/src/ai_service/queue/ingestion_queue.py
from bullmq import Queue, Worker, Job
from ..rag.parsers.pdf_parser import PDFParser
from ..rag.chunking.fixed_size_chunker import FixedSizeChunker
from ..rag.deduplication.document_deduper import DocumentDeduper
from prisma import Prisma

# 创建队列
ingestion_queue = Queue('ingestion', connection={'host': 'localhost', 'port': 6379})

# 初始化
prisma = Prisma()
pdf_parser = PDFParser()
chunker = FixedSizeChunker(chunk_size=512, overlap=50)
deduper = DocumentDeduper(prisma)

async def process_ingestion(job: Job):
    """处理摄取任务"""
    filename = job.data['filename']
    content = job.data['content']  # base64 编码的文件内容
    
    # 1. 去重检查
    if await deduper.is_duplicate(filename):
        print(f"[Ingestion] Duplicate file: {filename}, skipping")
        return {'status': 'skipped', 'reason': 'duplicate'}
    
    # 2. 创建文档记录
    document = await prisma.document.create(
        data={
            'filename': filename,
            'status': 'processing',
        }
    )
    
    try:
        # 3. 解析 PDF
        import base64
        content_bytes = base64.b64decode(content)
        text = pdf_parser.parse(content_bytes)
        
        # 4. 切分
        chunks = chunker.chunk(text)
        
        # 5. 存储 chunk
        for i, chunk_text in enumerate(chunks):
            await prisma.chunk.create(
                data={
                    'documentId': document.id,
                    'content': chunk_text,
                    'chunkIndex': i,
                }
            )
        
        # 6. 更新文档状态
        await prisma.document.update(
            where={'id': document.id},
            data={
                'status': 'completed',
                'totalChunks': len(chunks),
            }
        )
        
        return {'status': 'completed', 'chunks': len(chunks)}
    
    except Exception as e:
        # 标记失败
        await prisma.document.update(
            where={'id': document.id},
            data={'status': 'failed'}
        )
        raise e

# 创建 Worker
worker = Worker('ingestion', process_ingestion, connection={'host': 'localhost', 'port': 6379})
```

#### 4.2.6 改造上传接口（ingestion.py v2 版本）

```python
# services/ai/src/ai_service/api/ingestion.py (v2 版本)
from fastapi import APIRouter, UploadFile, File
from ..queue.ingestion_queue import ingestion_queue
import base64

router = APIRouter()

@router.post("/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    # 1. 读取文件
    content = await file.read()
    
    # 2. 加入队列（异步处理）
    job = await ingestion_queue.add(
        'process',
        {
            'filename': file.filename,
            'content': base64.b64encode(content).decode('utf-8'),  # base64 编码
        }
    )
    
    # 3. 立即返回（不阻塞）
    return {
        'job_id': job.id,
        'status': 'queued',
        'message': 'Document queued for processing'
    }

@router.get("/documents/{job_id}/status")
async def get_job_status(job_id: str):
    """查询任务状态"""
    job = await ingestion_queue.getJob(job_id)
    
    if not job:
        return {'error': 'Job not found'}
    
    return {
        'job_id': job_id,
        'status': await job.getState(),
        'progress': job.progress,
    }
```

**为什么文件内容要 base64 编码？**

BullMQ 的 job data 是 JSON（不支持二进制），文件内容是字节流（二进制）。base64 编码把字节流转成字符串（可以存入 JSON）。

### 4.3 v2 测试（文件名去重）

```python
# services/ai/tests/test_deduplication.py (v2 版本)
import pytest
from ai_service.rag.deduplication.document_deduper import DocumentDeduper
from prisma import Prisma

@pytest.fixture
async def prisma():
    prisma = Prisma()
    await prisma.connect()
    yield prisma
    await prisma.disconnect()

@pytest.fixture
async def deduper(prisma):
    return DocumentDeduper(prisma)

async def test_duplicate_filename(prisma, deduper):
    """相同文件名应被识别为重复"""
    # 1. 创建文档
    await prisma.document.create(
        data={'filename': 'test.pdf', 'status': 'completed'}
    )
    
    # 2. 检查重复
    is_dup = await deduper.is_duplicate('test.pdf')
    
    assert is_dup is True

async def test_new_filename(deduper):
    """新文件名不应被识别为重复"""
    is_dup = await deduper.is_duplicate('new.pdf')
    
    assert is_dup is False
```

### 4.4 v2 还剩下的 3 个问题

1. **文件名去重不准确**：重命名后被识别为新文档（`doc.pdf` → `doc_v2.pdf`），实际内容相同。
2. **无元数据**：chunk 没有记录"租户"、"版本"、"作者"，检索时无法过滤。
3. **无权限控制**：所有用户都能检索到所有文档（无租户隔离）。

v3 用"内容哈希去重 + 元数据 + ACL"解决这三个问题。

---
## §5 v3：元数据 + ACL + 语义切分 + 内容哈希去重（生产级）

### 5.1 v3 新增的能力

1. **内容哈希去重**：用 SHA256 计算文件内容哈希，重命名后仍能识别为重复文档。
2. **完整元数据**：每个 chunk 记录"来源文档"、"租户"、"版本"、"作者"、"创建时间"，支持元数据过滤。
3. **ACL 权限控制**：租户 A 的文档只能被租户 A 检索（租户隔离）。
4. **语义边界切分**：按段落/章节切分（不是固定 512 字），保证每个 chunk 语义完整。
5. **失败任务可查询**：查询"失败任务列表"（失败原因 + 文档名称），支持重试。

### 5.2 v3 架构变化

```
v2：上传 → 队列 → 解析 → 固定切分 → 存储
v3：上传 → 内容哈希 → 去重检查 → 队列 → 解析 → 语义切分 → 元数据提取 → ACL 检查 → 存储
                ↓（重复）
             跳过摄取（返回已存在的 documentId）
```

**关键变化**：增加"内容哈希去重"（前置）和"ACL 检查"（后置）两个环节。

### 5.3 v3 完整代码（生产级实现）

#### 5.3.1 内容哈希计算器（content_hash.py）

```python
# services/ai/src/ai_service/rag/deduplication/content_hash.py
import hashlib

class ContentHasher:
    """内容哈希计算器（SHA256）"""
    
    @staticmethod
    def compute_hash(content: bytes) -> str:
        """
        计算内容哈希
        
        Args:
            content: 文件内容（字节流）
            
        Returns:
            SHA256 哈希（hex 格式）
        """
        return hashlib.sha256(content).hexdigest()
```

**为什么用 SHA256 而不是 MD5？**

MD5 已经不安全（存在碰撞攻击），SHA256 更安全。虽然去重不涉及安全问题，但统一用 SHA256（与密码哈希一致）。

#### 5.3.2 文档去重器（document_deduper.py v3 版本）

```python
# services/ai/src/ai_service/rag/deduplication/document_deduper.py (v3 版本)
from prisma import Prisma
from .content_hash import ContentHasher

class DocumentDeduper:
    """文档去重器（基于内容哈希）"""
    
    def __init__(self, prisma: Prisma):
        self.prisma = prisma
        self.hasher = ContentHasher()
    
    async def check_duplicate(self, content: bytes) -> tuple[bool, str | None]:
        """
        检查内容是否重复
        
        Args:
            content: 文件内容
            
        Returns:
            (is_duplicate, document_id)
            - is_duplicate: True = 重复，False = 不重复
            - document_id: 如果重复，返回已存在的 documentId
        """
        # 1. 计算内容哈希
        content_hash = self.hasher.compute_hash(content)
        
        # 2. 查询是否已存在
        existing = await self.prisma.document.find_unique(
            where={'contentHash': content_hash}
        )
        
        if existing:
            return (True, existing.id)
        
        return (False, None)
```

**为什么返回 document_id？**

重复文档不需要重新摄取，但需要返回"已存在的 documentId"（前端可以显示"文档已存在，使用现有版本"）。

#### 5.3.3 元数据提取器（metadata_extractor.py）

```python
# services/ai/src/ai_service/rag/metadata/metadata_extractor.py
from typing import Dict, Any
from datetime import datetime

class MetadataExtractor:
    """元数据提取器"""
    
    def extract(
        self,
        filename: str,
        tenant_id: str,
        user_id: str,
        additional: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """
        提取元数据
        
        Args:
            filename: 文件名
            tenant_id: 租户 ID
            user_id: 上传用户 ID
            additional: 额外元数据
            
        Returns:
            元数据字典
        """
        metadata = {
            'filename': filename,
            'tenant_id': tenant_id,
            'uploaded_by': user_id,
            'uploaded_at': datetime.utcnow().isoformat(),
            'version': 1,  # 文档版本（支持更新）
            'source': 'manual_upload',  # 来源（manual_upload / api / crawler）
        }
        
        # 合并额外元数据
        if additional:
            metadata.update(additional)
        
        return metadata
    
    def extract_from_pdf(self, pdf_reader) -> Dict[str, Any]:
        """
        从 PDF 提取元数据（作者、标题、创建日期）
        
        Args:
            pdf_reader: pypdf PdfReader 对象
            
        Returns:
            PDF 元数据
        """
        metadata = {}
        
        if pdf_reader.metadata:
            if pdf_reader.metadata.author:
                metadata['author'] = pdf_reader.metadata.author
            if pdf_reader.metadata.title:
                metadata['title'] = pdf_reader.metadata.title
            if pdf_reader.metadata.creation_date:
                metadata['pdf_created_at'] = str(pdf_reader.metadata.creation_date)
        
        return metadata
```

**为什么元数据包含 `version` 字段？**

支持文档更新（同一个文档上传新版本，`contentHash` 不同，但 `filename` 相同）。`version` 字段记录版本号（v1、v2、v3...），检索时可以指定"只查询最新版本"。

#### 5.3.4 语义边界切分器（semantic_chunker.py）

```python
# services/ai/src/ai_service/rag/chunking/semantic_chunker.py
from typing import List
import re

class SemanticChunker:
    """语义边界切分器（按段落/章节切分）"""
    
    def __init__(self, max_chunk_size: int = 1000, min_chunk_size: int = 200):
        """
        Args:
            max_chunk_size: 最大 chunk 大小（避免过长）
            min_chunk_size: 最小 chunk 大小（避免过短）
        """
        self.max_chunk_size = max_chunk_size
        self.min_chunk_size = min_chunk_size
    
    def chunk(self, text: str) -> List[str]:
        """
        按语义边界切分
        
        策略：
        1. 先按双换行符切分（段落边界）
        2. 如果段落过长（> max_chunk_size），再按句子切分
        3. 如果段落过短（< min_chunk_size），合并相邻段落
        
        Args:
            text: 待切分文本
            
        Returns:
            chunk 列表
        """
        # 1. 按双换行符切分（段落边界）
        paragraphs = re.split(r'\n\n+', text)
        
        chunks = []
        current_chunk = ""
        
        for paragraph in paragraphs:
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            
            # 2. 如果当前 chunk + 新段落 <= max_chunk_size，合并
            if len(current_chunk) + len(paragraph) + 2 <= self.max_chunk_size:
                if current_chunk:
                    current_chunk += "\n\n" + paragraph
                else:
                    current_chunk = paragraph
            else:
                # 3. 当前 chunk 满了，输出
                if current_chunk and len(current_chunk) >= self.min_chunk_size:
                    chunks.append(current_chunk)
                    current_chunk = paragraph
                else:
                    # 当前 chunk 太短，继续累积
                    if current_chunk:
                        current_chunk += "\n\n" + paragraph
                    else:
                        current_chunk = paragraph
                
                # 4. 如果新段落本身过长，按句子切分
                if len(paragraph) > self.max_chunk_size:
                    sentences = self._split_sentences(paragraph)
                    for sentence in sentences:
                        if len(current_chunk) + len(sentence) + 1 <= self.max_chunk_size:
                            current_chunk += " " + sentence
                        else:
                            if current_chunk:
                                chunks.append(current_chunk)
                            current_chunk = sentence
        
        # 5. 输出最后一个 chunk
        if current_chunk and len(current_chunk) >= self.min_chunk_size:
            chunks.append(current_chunk)
        
        return chunks
    
    def _split_sentences(self, text: str) -> List[str]:
        """按句子切分（简单实现，按句号/问号/感叹号切分）"""
        sentences = re.split(r'[。！？.!?]+', text)
        return [s.strip() for s in sentences if s.strip()]
```

**为什么不用 LangChain 的 SemanticChunker？**

LangChain 的 SemanticChunker 依赖 Embedding（计算句子相似度，按相似度聚类），成本高（1000 个句子 = $0.01）。本项目用启发式规则（段落边界 + 句子边界），成本为零。

#### 5.3.5 ACL 管理器（acl_manager.py）

```python
# services/ai/src/ai_service/rag/acl/acl_manager.py
from typing import List

class ACLManager:
    """ACL 管理器（权限控制）"""
    
    def create_acl(
        self,
        tenant_id: str,
        allowed_users: List[str] = None,
        allowed_roles: List[str] = None
    ) -> dict:
        """
        创建 ACL
        
        Args:
            tenant_id: 租户 ID（必填）
            allowed_users: 允许访问的用户 ID 列表
            allowed_roles: 允许访问的角色列表（admin/member/viewer）
            
        Returns:
            ACL 字典
        """
        acl = {
            'tenant_id': tenant_id,
            'allowed_users': allowed_users or [],
            'allowed_roles': allowed_roles or ['admin', 'member'],  # 默认：管理员和成员
        }
        return acl
    
    def check_permission(
        self,
        acl: dict,
        user_tenant_id: str,
        user_id: str,
        user_role: str
    ) -> bool:
        """
        检查用户是否有权限访问
        
        Args:
            acl: ACL 字典
            user_tenant_id: 用户的租户 ID
            user_id: 用户 ID
            user_role: 用户角色
            
        Returns:
            True = 有权限，False = 无权限
        """
        # 1. 租户隔离（不同租户无权访问）
        if acl['tenant_id'] != user_tenant_id:
            return False
        
        # 2. 检查用户 ID
        if user_id in acl['allowed_users']:
            return True
        
        # 3. 检查角色
        if user_role in acl['allowed_roles']:
            return True
        
        return False
```

**为什么 ACL 用字典而不是单独的表？**

ACL 是 chunk 的"附属信息"（每个 chunk 一个 ACL），用 JSON 字段存储更高效（不需要 JOIN）。如果 ACL 规则复杂（例如"用户组"、"继承"），才需要单独的表。

#### 5.3.6 改造摄取队列（ingestion_queue.py v3 版本）

```python
# services/ai/src/ai_service/queue/ingestion_queue.py (v3 版本)
from bullmq import Queue, Worker, Job
from ..rag.parsers.pdf_parser import PDFParser
from ..rag.chunking.semantic_chunker import SemanticChunker
from ..rag.deduplication.document_deduper import DocumentDeduper
from ..rag.deduplication.content_hash import ContentHasher
from ..rag.metadata.metadata_extractor import MetadataExtractor
from ..rag.acl.acl_manager import ACLManager
from prisma import Prisma
from pypdf import PdfReader
from io import BytesIO

# 初始化
prisma = Prisma()
pdf_parser = PDFParser()
chunker = SemanticChunker(max_chunk_size=1000, min_chunk_size=200)
deduper = DocumentDeduper(prisma)
hasher = ContentHasher()
metadata_extractor = MetadataExtractor()
acl_manager = ACLManager()

async def process_ingestion_v3(job: Job):
    """处理摄取任务（v3 版本）"""
    filename = job.data['filename']
    content = job.data['content']  # base64 编码
    tenant_id = job.data['tenant_id']
    user_id = job.data['user_id']
    
    import base64
    content_bytes = base64.b64decode(content)
    
    # 1. 内容哈希去重
    is_dup, existing_doc_id = await deduper.check_duplicate(content_bytes)
    if is_dup:
        print(f"[Ingestion] Duplicate content: {filename}, using existing doc {existing_doc_id}")
        return {'status': 'skipped', 'reason': 'duplicate', 'document_id': existing_doc_id}
    
    # 2. 计算内容哈希
    content_hash = hasher.compute_hash(content_bytes)
    
    # 3. 创建文档记录
    document = await prisma.document.create(
        data={
            'filename': filename,
            'contentHash': content_hash,
            'status': 'processing',
        }
    )
    
    try:
        # 4. 解析 PDF
        reader = PdfReader(BytesIO(content_bytes))
        text = pdf_parser.parse(content_bytes)
        
        # 5. 提取元数据（基础 + PDF）
        metadata = metadata_extractor.extract(
            filename=filename,
            tenant_id=tenant_id,
            user_id=user_id
        )
        pdf_metadata = metadata_extractor.extract_from_pdf(reader)
        metadata.update(pdf_metadata)
        
        # 6. 创建 ACL
        acl = acl_manager.create_acl(
            tenant_id=tenant_id,
            allowed_roles=['admin', 'member']
        )
        metadata['acl'] = acl
        
        # 7. 语义切分
        chunks = chunker.chunk(text)
        
        # 8. 存储 chunk（带元数据 + ACL）
        for i, chunk_text in enumerate(chunks):
            await prisma.chunk.create(
                data={
                    'documentId': document.id,
                    'content': chunk_text,
                    'chunkIndex': i,
                    'metadata': metadata,  # ★ 元数据 + ACL
                }
            )
        
        # 9. 更新文档状态
        await prisma.document.update(
            where={'id': document.id},
            data={
                'status': 'completed',
                'totalChunks': len(chunks),
            }
        )
        
        return {'status': 'completed', 'chunks': len(chunks), 'document_id': document.id}
    
    except Exception as e:
        # 标记失败
        await prisma.document.update(
            where={'id': document.id},
            data={'status': 'failed'}
        )
        raise e

# 创建 Worker
worker_v3 = Worker('ingestion', process_ingestion_v3, connection={'host': 'localhost', 'port': 6379})
```

#### 5.3.7 改造上传接口（ingestion.py v3 版本）

```python
# services/ai/src/ai_service/api/ingestion.py (v3 版本)
from fastapi import APIRouter, UploadFile, File, Depends
from ..queue.ingestion_queue import ingestion_queue
from ..auth.dependencies import get_current_user  # 假设有认证中间件
import base64

router = APIRouter()

@router.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    current_user = Depends(get_current_user)
):
    # 1. 读取文件
    content = await file.read()
    
    # 2. 加入队列（带租户信息）
    job = await ingestion_queue.add(
        'process',
        {
            'filename': file.filename,
            'content': base64.b64encode(content).decode('utf-8'),
            'tenant_id': current_user.tenant_id,  # ★ 租户 ID
            'user_id': current_user.id,           # ★ 用户 ID
        }
    )
    
    return {
        'job_id': job.id,
        'status': 'queued',
        'message': 'Document queued for processing'
    }

@router.get("/documents/failed")
async def get_failed_documents(current_user = Depends(get_current_user)):
    """查询失败任务列表"""
    from prisma import Prisma
    prisma = Prisma()
    
    failed_docs = await prisma.document.find_many(
        where={'status': 'failed'},
        order_by={'createdAt': 'desc'}
    )
    
    return {
        'total': len(failed_docs),
        'documents': [
            {
                'id': doc.id,
                'filename': doc.filename,
                'created_at': doc.createdAt.isoformat(),
            }
            for doc in failed_docs
        ]
    }
```

### 5.4 v3 核心知识点（≥ 6 个，每个 5 要素）

#### 知识点 1：内容哈希去重

**是什么**：用 SHA256 计算文件内容哈希，重命名后仍能识别为重复文档。

**解决什么问题**：文件名去重不准确（重命名后被识别为新文档，`doc.pdf` → `doc_v2.pdf`，实际内容相同）。

**怎么用**：
```python
hasher = ContentHasher()
content_hash = hasher.compute_hash(content_bytes)
```

**生产陷阱**：哈希计算在主线程。大文件（100MB PDF）计算哈希需要 2 秒，阻塞上传接口。正确做法是"哈希计算在队列 worker"（上传接口只加入队列，worker 再计算哈希）。

**验证方法**：单元测试——同一个文件计算 2 次哈希，验证结果相同。

#### 知识点 2：语义边界切分

**是什么**：按段落/章节切分（不是固定 512 字），保证每个 chunk 语义完整。

**解决什么问题**：固定长度切分可能在句子中间切断（"操作步骤：1. 停止服务｜ 2. 启动服务"，`｜` 是切分点），导致 chunk 语义不完整。

**怎么用**：
```python
chunker = SemanticChunker(max_chunk_size=1000, min_chunk_size=200)
chunks = chunker.chunk(text)
```

**生产陷阱**：所有文档都用语义切分。某些文档没有段落边界（例如日志文件、CSV 文件），语义切分会退化成固定长度切分。正确做法是"根据文档类型选择切分策略"（PDF 用语义切分，日志用固定切分）。

**验证方法**：单元测试——输入"段落1\n\n段落2"，验证切成 2 个 chunk（不是在 `\n\n` 中间切断）。

#### 知识点 3：元数据提取

**是什么**：从文档提取"来源"、"租户"、"版本"、"作者"、"创建时间"等元数据，存入 chunk。

**解决什么问题**：chunk 没有元数据（检索时无法过滤"只查询租户 A 的文档"、"只查询最新版本"）。

**怎么用**：
```python
metadata_extractor = MetadataExtractor()
metadata = metadata_extractor.extract(
    filename='doc.pdf',
    tenant_id='tenant-A',
    user_id='user-001'
)
```

**生产陷阱**：元数据提取失败导致摄取失败。PDF 元数据损坏（例如 `author` 字段是乱码），`extract_from_pdf()` 抛异常，整个摄取任务失败。正确做法是"元数据提取失败不影响摄取"（try-catch，失败时跳过元数据）。

**验证方法**：单元测试——提取元数据，验证包含 `tenant_id`、`uploaded_by`、`version` 字段。

#### 知识点 4：ACL 权限控制

**是什么**：每个 chunk 带 ACL（`tenant_id` + `allowed_users` + `allowed_roles`），检索时过滤（只返回当前用户有权限的 chunk）。

**解决什么问题**：租户 A 上传的文档，租户 B 也能检索到，泄露敏感信息。

**怎么用**：
```python
acl_manager = ACLManager()
acl = acl_manager.create_acl(
    tenant_id='tenant-A',
    allowed_roles=['admin', 'member']
)
metadata['acl'] = acl
```

**生产陷阱**：ACL 检查在应用层（慢）。每次检索 1000 个 chunk，应用层循环检查 ACL（1000 次 `check_permission()`），耗时 100ms。正确做法是"ACL 检查在 DB 查询"（`WHERE metadata->>'tenant_id' = :tenant_id`），耗时 5ms。

**验证方法**：集成测试——租户 A 上传文档，租户 B 检索，验证返回 0 个结果。

#### 知识点 5：失败任务可查询

**是什么**：解析失败的文档标记为 `status='failed'`，运维可以查询"失败任务列表"（失败原因 + 文档名称）。

**解决什么问题**：上传 5000 个 PDF，其中 200 个解析失败，但运维不知道哪些失败（对应情境题 2）。

**怎么用**：
```python
failed_docs = await prisma.document.find_many(
    where={'status': 'failed'},
    order_by={'createdAt': 'desc'}
)
```

**生产陷阱**：失败任务不记录失败原因。只记录 `status='failed'`，不记录"为什么失败"（例如"PDF 加密"、"文件损坏"），运维无法定位问题。正确做法是"新增 `failureReason` 字段"（记录异常消息）。

**验证方法**：集成测试——上传损坏的 PDF，验证 `status='failed'`。

#### 知识点 6：文档版本管理

**是什么**：同一个文档上传新版本（内容不同，`contentHash` 不同），`version` 字段递增（v1 → v2 → v3）。

**解决什么问题**：文档更新后，旧版本和新版本同时可检索（对应情境题 2）。

**怎么用**：
```python
# 上传新版本时
existing = await prisma.document.find_first(
    where={'filename': filename},
    order_by={'version': 'desc'}
)
new_version = (existing.version + 1) if existing else 1
```

**生产陷阱**：旧版本不标记为"已弃用"。新版本上传后，旧版本仍然 `status='completed'`（可检索），导致检索结果包含旧版本。正确做法是"新版本上传后，旧版本标记为 `status='archived'`"（不可检索）。

**验证方法**：集成测试——上传 v1、v2，检索时只返回 v2（v1 被归档）。

---
## §6 深挖前端底子（§6.5 必需章节）

### 6.1 今天为什么要深挖"大文件分片上传 + 断点续传"

Day 46 的核心是"服务端 RAG 摄取"，但前端上传大文件（100MB PDF）时，如果一次性上传（整个文件传输），网络中断会导致上传失败（需要重新上传 100MB）。正确做法是**分片上传 + 断点续传**（把 100MB 切成 100 个 1MB 分片，每次上传 1 个分片，网络中断后从断点继续）。

今天深挖的不是"Vue 怎么上传文件"（Day 01-05 已经掌握），而是"为什么要分片而不是一次性上传"（一次性上传网络中断风险高）、"为什么断点续传要用 MD5 而不是文件名"（文件名可以改，MD5 稳定）。

### 6.2 大文件分片上传的 3 个设计原则

#### 6.2.1 原则 1：分片上传而不是一次性上传

**错误做法**：前端一次性上传整个文件（100MB）。

**问题**：
- 网络中断风险高（传输 100MB 需要 2 分钟，中断后需要重新上传）
- 超时风险（服务端 Nginx 默认超时 60 秒，大文件可能超时）
- 内存占用高（服务端一次性读取 100MB 到内存）

**正确做法**：前端把文件切成多个分片（每片 1MB），逐个上传。

```vue
<!-- services/dashboard/src/components/FileUpload.vue -->
<template>
  <div class="file-upload">
    <input
      type="file"
      @change="handleFileChange"
      accept=".pdf"
    />
    
    <div v-if="uploadProgress > 0" class="upload-progress">
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: `${uploadProgress}%` }"
        ></div>
      </div>
      <span class="progress-text">
        已上传 {{ uploadedChunks }}/{{ totalChunks }} 分片 ({{ uploadProgress }}%)
      </span>
    </div>
    
    <button
      v-if="isPaused"
      @click="resumeUpload"
    >
      继续上传
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import SparkMD5 from 'spark-md5'

const CHUNK_SIZE = 1 * 1024 * 1024 // 1MB
const uploadProgress = ref(0)
const uploadedChunks = ref(0)
const totalChunks = ref(0)
const isPaused = ref(false)
const currentFile = ref<File | null>(null)

async function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  
  currentFile.value = file
  await uploadFile(file)
}

async function uploadFile(file: File) {
  // 1. 计算文件 MD5（用于断点续传）
  const fileMD5 = await calculateMD5(file)
  
  // 2. 检查是否有断点记录
  const resumeData = localStorage.getItem(`upload_${fileMD5}`)
  let startChunk = 0
  
  if (resumeData) {
    const { uploaded } = JSON.parse(resumeData)
    startChunk = uploaded
    console.log(`[Upload] Resuming from chunk ${startChunk}`)
  }
  
  // 3. 切片
  totalChunks.value = Math.ceil(file.size / CHUNK_SIZE)
  uploadedChunks.value = startChunk
  
  // 4. 逐个上传分片
  for (let i = startChunk; i < totalChunks.value; i++) {
    if (isPaused.value) {
      // 保存断点
      localStorage.setItem(`upload_${fileMD5}`, JSON.stringify({
        uploaded: i,
        total: totalChunks.value,
        filename: file.name
      }))
      return
    }
    
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const chunk = file.slice(start, end)
    
    // 上传分片
    const formData = new FormData()
    formData.append('chunk', chunk)
    formData.append('chunkIndex', i.toString())
    formData.append('totalChunks', totalChunks.value.toString())
    formData.append('fileMD5', fileMD5)
    formData.append('filename', file.name)
    
    await fetch('/api/documents/upload-chunk', {
      method: 'POST',
      body: formData
    })
    
    uploadedChunks.value = i + 1
    uploadProgress.value = Math.round((uploadedChunks.value / totalChunks.value) * 100)
  }
  
  // 5. 所有分片上传完成，通知服务端合并
  await fetch('/api/documents/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileMD5,
      filename: file.name,
      totalChunks: totalChunks.value
    })
  })
  
  // 6. 清除断点记录
  localStorage.removeItem(`upload_${fileMD5}`)
  
  console.log('[Upload] Completed')
}

async function calculateMD5(file: File): Promise<string> {
  return new Promise((resolve) => {
    const spark = new SparkMD5.ArrayBuffer()
    const reader = new FileReader()
    
    reader.onload = (e) => {
      spark.append(e.target?.result as ArrayBuffer)
      resolve(spark.end())
    }
    
    reader.readAsArrayBuffer(file)
  })
}

function resumeUpload() {
  isPaused.value = false
  if (currentFile.value) {
    uploadFile(currentFile.value)
  }
}
</script>
```

**为什么分片大小是 1MB 而不是 10MB？**

1MB 是"平衡点"——太小（100KB）会增加 HTTP 请求数（100MB = 1000 个请求），太大（10MB）会增加网络中断风险（10MB 传输失败需要重传 10MB）。

#### 6.2.2 原则 2：断点续传用 MD5 而不是文件名

**错误做法**：用文件名作为断点标识（`localStorage.getItem('upload_${filename}')`）。

**问题**：
- 文件名可以改（重命名后被识别为新上传）
- 文件名可能重复（不同文件同名）

**正确做法**：用文件内容 MD5 作为断点标识。

```typescript
// 计算文件 MD5
const fileMD5 = await calculateMD5(file)

// 保存断点记录
localStorage.setItem(`upload_${fileMD5}`, JSON.stringify({
  uploaded: 10,  // 已上传 10 个分片
  total: 100,
  filename: file.name
}))
```

**为什么用 SparkMD5 而不是浏览器的 Crypto API？**

SparkMD5 支持流式计算（分块读取文件，不需要一次性读取整个文件到内存），Crypto API 需要整个文件（100MB 一次性读入内存，可能卡死浏览器）。

#### 6.2.3 原则 3：前端显示"上传进度"和"暂停/继续"按钮

**错误做法**：前端只显示"上传中..."，不显示进度。

**正确做法**：前端显示"已上传 10/100 分片 (10%)"，支持暂停和继续。

```vue
<template>
  <div class="upload-status">
    <div class="status-header">
      <span class="filename">{{ filename }}</span>
      <span class="progress-percent">{{ uploadProgress }}%</span>
    </div>
    
    <div class="progress-bar">
      <div
        class="progress-fill"
        :style="{ width: `${uploadProgress}%` }"
      ></div>
    </div>
    
    <div class="status-footer">
      <span class="chunks-text">
        {{ uploadedChunks }}/{{ totalChunks }} 分片
      </span>
      <span class="speed-text">
        {{ uploadSpeed }} MB/s
      </span>
    </div>
    
    <div class="actions">
      <button v-if="!isPaused" @click="pauseUpload" class="btn-pause">
        暂停
      </button>
      <button v-else @click="resumeUpload" class="btn-resume">
        继续
      </button>
      <button @click="cancelUpload" class="btn-cancel">
        取消
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const uploadedChunks = ref(10)
const totalChunks = ref(100)
const uploadedBytes = ref(10 * 1024 * 1024) // 10MB
const startTime = ref(Date.now())

const uploadProgress = computed(() => {
  return Math.round((uploadedChunks.value / totalChunks.value) * 100)
})

const uploadSpeed = computed(() => {
  const elapsedSeconds = (Date.now() - startTime.value) / 1000
  const speedMBps = (uploadedBytes.value / 1024 / 1024) / elapsedSeconds
  return speedMBps.toFixed(2)
})
</script>
```

### 6.3 为什么不能只依赖"Nginx client_max_body_size"

**误区**："把 Nginx `client_max_body_size` 设为 100MB，就能上传大文件"。

**错误原因**：
1. 超时风险（Nginx 默认超时 60 秒，传输 100MB 可能超时）
2. 内存占用（服务端一次性读取 100MB 到内存，可能 OOM）
3. 网络中断风险（传输 100MB 中断后需要重新上传）

**正确分工**：
- **Nginx `client_max_body_size`**：限制单个请求大小（设为 10MB，限制单个分片大小）
- **分片上传**：把大文件切成小分片（每片 1MB），逐个上传

### 6.4 HTML 知识点：File API 的 slice 方法

**HTML5 File API**：`File.slice(start, end)` 切片文件，返回 Blob。

**为什么用 slice 而不是读取整个文件？**

slice 是"零拷贝"（不读取文件内容，只创建引用），读取整个文件需要把 100MB 加载到内存（可能卡死浏览器）。

```typescript
const file = new File(...)  // 100MB
const chunk = file.slice(0, 1024 * 1024)  // 切出第 1MB（不读取内容）
```

**slice 和 Blob 的区别？**

File 是 Blob 的子类（File extends Blob），slice 返回的是 Blob（不是 File）。Blob 可以直接通过 FormData 上传。

### 6.5 CSS 知识点：上传进度条的视觉层次

**原则**：上传中用蓝色渐变（提示"正在上传"），暂停用黄色（提示"已暂停"），完成用绿色（提示"上传成功"）。

**为什么暂停用黄色而不是红色？**

红色是"失败"色（用户认为"上传失败"），黄色是"等待"色（用户认为"暂时停止，可以继续"）。暂停是"用户主动停止"，不是"失败"。

```css
.progress-fill {
  height: 100%;
  transition: width 0.3s ease, background 0.3s ease;
}

/* 上传中：蓝色渐变 */
.progress-fill.uploading {
  background: linear-gradient(90deg, #3b82f6 0%, #1e40af 100%);
}

/* 暂停：黄色 */
.progress-fill.paused {
  background: linear-gradient(90deg, #f59e0b 0%, #d97706 100%);
}

/* 完成：绿色 */
.progress-fill.completed {
  background: linear-gradient(90deg, #10b981 0%, #059669 100%);
}
```

---

## §7 测试与验证（§7 必需章节）

### 7.1 单元测试（内容哈希去重）

```python
# services/ai/tests/test_deduplication.py (v3 版本)
import pytest
from ai_service.rag.deduplication.document_deduper import DocumentDeduper
from ai_service.rag.deduplication.content_hash import ContentHasher
from prisma import Prisma

@pytest.fixture
async def prisma():
    prisma = Prisma()
    await prisma.connect()
    yield prisma
    await prisma.disconnect()

@pytest.fixture
async def deduper(prisma):
    return DocumentDeduper(prisma)

async def test_content_hash_duplicate(prisma, deduper):
    """相同内容应被识别为重复"""
    content = b"This is a test document"
    
    # 1. 计算哈希
    hasher = ContentHasher()
    content_hash = hasher.compute_hash(content)
    
    # 2. 创建文档
    await prisma.document.create(
        data={
            'filename': 'test.pdf',
            'contentHash': content_hash,
            'status': 'completed'
        }
    )
    
    # 3. 检查重复
    is_dup, doc_id = await deduper.check_duplicate(content)
    
    assert is_dup is True
    assert doc_id is not None

async def test_renamed_file_still_duplicate(prisma, deduper):
    """重命名后仍应被识别为重复"""
    content = b"Same content different filename"
    
    hasher = ContentHasher()
    content_hash = hasher.compute_hash(content)
    
    # 1. 创建文档（文件名: original.pdf）
    await prisma.document.create(
        data={
            'filename': 'original.pdf',
            'contentHash': content_hash,
            'status': 'completed'
        }
    )
    
    # 2. 检查重复（文件名: renamed.pdf，内容相同）
    is_dup, doc_id = await deduper.check_duplicate(content)
    
    assert is_dup is True  # 重命名后仍识别为重复
```

### 7.2 集成测试（ACL 权限隔离）

```python
# services/ai/tests/test_acl.py
import pytest
from ai_service.rag.acl.acl_manager import ACLManager

def test_tenant_isolation():
    """不同租户应无法访问"""
    acl_manager = ACLManager()
    
    # 创建租户 A 的 ACL
    acl = acl_manager.create_acl(
        tenant_id='tenant-A',
        allowed_roles=['admin', 'member']
    )
    
    # 租户 B 的用户尝试访问
    has_permission = acl_manager.check_permission(
        acl=acl,
        user_tenant_id='tenant-B',
        user_id='user-002',
        user_role='admin'
    )
    
    assert has_permission is False

def test_same_tenant_can_access():
    """相同租户应能访问"""
    acl_manager = ACLManager()
    
    acl = acl_manager.create_acl(
        tenant_id='tenant-A',
        allowed_roles=['admin', 'member']
    )
    
    # 租户 A 的成员尝试访问
    has_permission = acl_manager.check_permission(
        acl=acl,
        user_tenant_id='tenant-A',
        user_id='user-001',
        user_role='member'
    )
    
    assert has_permission is True
```

### 7.3 反证实验 1：移除去重后重复摄取

**假设**：如果移除去重检查，同一个文档上传 2 次，生成 2 份 chunk。

**实验步骤**：
1. 注释掉 `process_ingestion_v3()` 里的去重检查代码
2. 上传同一个 PDF 2 次
3. 查询 chunks 表

**预期现象**：生成 2 份 chunk（内容相同）。

**实际现象**（移除去重后）：
```sql
SELECT documentId, COUNT(*) FROM chunks GROUP BY documentId;
-- documentId           | COUNT
-- doc-001             | 100
-- doc-002             | 100  (重复)
```

**恢复操作**：恢复去重检查代码，重新测试，验证第二次上传被跳过。

### 7.4 反证实验 2：移除 ACL 后跨租户访问

**假设**：如果移除 ACL 检查，租户 A 的文档可以被租户 B 检索。

**实验步骤**：
1. 注释掉检索接口里的 ACL 过滤代码
2. 租户 A 上传文档
3. 租户 B 执行检索
4. 观察返回结果

**预期现象**：返回租户 A 的文档（泄露）。

**实际现象**（移除 ACL 后）：
```
[Search] Tenant B query: "服务器故障"
[Search] Found 10 chunks (including tenant A's documents)
```

**恢复操作**：恢复 ACL 过滤代码，重新测试，验证租户 B 查询返回 0 个结果。

### 7.5 四件套（依赖图 + 时序图 + 日志 + commit）

#### 7.5.1 依赖图

```
api/ingestion.py
    ↓
queue/ingestion_queue.py ──────────────┐
    ↓                                  │
┌───┴────┬────────┬────────┬──────────┤
pdf_parser  semantic_chunker  document_deduper  metadata_extractor  acl_manager
    ↓           ↓                ↓                    ↓                 ↓
pypdf    paragraph_split    content_hash      extract_pdf_meta    tenant_isolation
```

#### 7.5.2 时序图（摄取全流程）

```
client       api          queue       deduper    parser    chunker    storage
  │            │             │            │         │         │          │
  │─upload PDF─→│             │            │         │         │          │
  │            │─add job─────→│            │         │         │          │
  │←queued─────│             │            │         │         │          │
  │            │             │─check dup──→│         │         │          │
  │            │             │←not dup─────│         │         │          │
  │            │             │─parse PDF──────────→│         │          │
  │            │             │←text────────────────│         │          │
  │            │             │─chunk text──────────────────→│          │
  │            │             │←chunks──────────────────────│          │
  │            │             │─save chunks──────────────────────────→│
  │            │             │←saved───────────────────────────────│
```

#### 7.5.3 测试日志截图

```
[Ingestion] Processing: doc.pdf (10MB)
[ContentHasher] Computed hash: a3d5f8...
[DocumentDeduper] Not duplicate, proceeding
[PDFParser] Extracted 15 pages, 12500 characters
[SemanticChunker] Split into 25 chunks (avg 500 chars/chunk)
[MetadataExtractor] Extracted: tenant=A, user=user-001, version=1
[ACLManager] Created ACL: tenant=A, roles=[admin, member]
[ChunkStore] Saved 25 chunks
[Ingestion] Completed: doc-001, 25 chunks
```

#### 7.5.4 commit 信息

```bash
git add .
git commit -m "feat(rag): add RAG ingestion pipeline with dedup and ACL

- Add PDFParser for document parsing
- Add SemanticChunker for semantic boundary splitting
- Add DocumentDeduper with content hash
- Add MetadataExtractor for metadata extraction
- Add ACLManager for tenant isolation
- Add ingestion queue with BullMQ
- Add contentHash and metadata fields to schema

Refs: Day46"
```

---
## 8. 通关检查清单（v3 规范 11 项）

Day 46 交付前的自查：

1. **§0 位置声明**：已写明"阶段二第 6 天"、Day 45 前置依赖、Day 47-50 后续对齐
2. **§1.1 用户能看到什么**：已写 5 个场景（上传 PDF、切分语义完整、重复上传不重复摄取、元数据过滤、失败任务可见）
3. **§1.4 目录结构 5 块**：已写骨架树 + 为什么分层 5 问 + diff 表格 + 依赖箭头 + 3 个灵魂拷问
4. **§1.5 脚手架检查**：已写 Prisma Schema（documents + chunks 表，contentHash + metadata + acl）
5. **三版演进**：v1 同步解析 → v2 队列 + 文件名去重 → v3 内容哈希去重 + 元数据 + ACL + 语义切分
6. **§5.3 完整代码**：ContentHasher、DocumentDeduper、SemanticChunker、MetadataExtractor、ACLManager、IngestionQueue，无省略号
7. **§5.4 ≥ 6 知识点**：内容哈希去重、语义边界切分、元数据提取、ACL 权限控制、失败任务可查询、文档版本管理，每个 5 要素
8. **§6.5 前端底子补弱**：深挖"大文件分片上传 + 断点续传" + MD5 计算 + File.slice API + 上传进度条视觉层次
9. **§7 测试 4 件套**：单元测试（内容哈希去重）+ 集成测试（ACL 权限隔离）+ 反证实验 1（移除去重）+ 反证实验 2（移除 ACL）+ 依赖图 + 时序图 + 日志 + commit
10. **0 个 `> ✅/❌` blockquote**：全文无此格式
11. **commit 不含 git push**：commit 信息写 `Refs: Day46`，不执行 push

---

## 9. 从今天的增量到下一站

### 9.1 今天建立的能力地基

Day 46 交付的 RAG 摄取管道（解析 + 切分 + 元数据 + 去重 + ACL）是后续 4 个能力的数据基座：

1. **Day 47 向量检索**：检索时从今天摄入的 chunk 里找最相关的（向量相似度）
2. **Day 48 Rerank**：重排序今天摄入的 chunk（按相关性排序）
3. **Day 49 Hybrid Search**：结合向量检索和关键词检索（BM25）
4. **Day 50 RAG 完整链路**：检索 → Rerank → 生成（使用今天摄入的 chunk 作为上下文）

### 9.2 今天留下的 3 个待优化点

1. **无增量摄取**：v3 只支持"全量摄取"（上传新文档），不支持"增量摄取"（文档更新后只摄取变更部分）。Day 47 会补充"增量摄取"（diff 检测 + 只更新变更 chunk）。

2. **切分策略单一**：v3 只实现了"语义边界切分"（按段落），不支持"重叠窗口切分"（sliding window，避免切断跨段落的上下文）。Day 48 会补充"重叠窗口切分"。

3. **无摄取优先级**：v3 的摄取队列是 FIFO（先进先出），不支持优先级（例如"VIP 用户的文档优先摄取"）。Day 49 会补充"摄取优先级"（BullMQ priority）。

### 9.3 下一站要解决的核心问题

**Day 47：向量检索（Embedding + 向量相似度 + Pinecone/Qdrant）**

核心挑战：
- 如何把 chunk 转成向量（OpenAI text-embedding-3-small vs 本地模型）？
- 如何计算向量相似度（余弦相似度 vs 欧氏距离 vs 点积）？
- 如何存储向量（Postgres pgvector vs Pinecone vs Qdrant）？
- 如何优化检索性能（索引类型：HNSW vs IVF）？

---

## 10. 本日小结（标题党 30 字 + 三句话）

**标题**：内容哈希防重复、语义切分保完整、元数据支持过滤、ACL 防越权、队列异步不阻塞——RAG 摄取管道完整实现

Day 46 建立了统一 RAG 摄取机制，解决了"文档解析失败不可见"、"重复摄取不去重"、"切分边界不合理"、"元数据缺失"、"无权限控制"五个生产痛点。核心机制是"内容哈希去重（SHA256）+ 语义边界切分（按段落）+ 完整元数据（来源、租户、版本）+ ACL 权限控制（租户隔离）+ 异步队列（BullMQ）+ 失败任务可查询"。今天建立的摄取管道是 Day 47-50 RAG 检索的数据基座（所有检索都从今天摄入的 chunk 里找）。

---

## 11. 课后三道核心问题（必答，先于教师五连问）

### 问题 1：请从今天项目的真实入口到最终输出，解释"RAG 摄取"的数据流或控制流；当天知识链"解析、chunking、metadata、去重、ACL、版本"分别在哪一层起作用，为什么按这个顺序学习？

**数据流**：
```
前端上传 PDF（100MB）
  → 分片上传（100 个 1MB 分片）
  → API 加入队列（带 tenant_id + user_id）
  → Queue Worker 拉取任务
  → ContentHasher 计算内容哈希（SHA256）
  → DocumentDeduper 检查重复（查询 contentHash）
  → 如果重复：返回已存在的 documentId，跳过摄取
  → 如果不重复：
     → PDFParser 解析 PDF（PDF → 文本）
     → SemanticChunker 切分（按段落边界，保证语义完整）
     → MetadataExtractor 提取元数据（来源、租户、版本、作者、日期）
     → ACLManager 创建 ACL（tenant_id + allowed_roles）
     → 存入 chunks 表（content + metadata + acl）
     → 更新 documents 表（status='completed', totalChunks=25）
```

**知识链分层**：
- **解析**：PDFParser 解析层（PDF → 文本）
- **chunking**：SemanticChunker 切分层（长文本 → 小 chunk）
- **metadata**：MetadataExtractor 元数据层（提取标签）
- **去重**：DocumentDeduper 去重层（防止重复摄取）
- **ACL**：ACLManager 权限层（租户隔离）
- **版本**：version 字段（支持文档更新）

**为什么按这个顺序学习**：
1. 先学解析（把文档转成文本），才能谈"如何切分文本"
2. 再学 chunking（把长文本切成小块），才能谈"如何给 chunk 加标签"
3. 再学 metadata（加标签），才能谈"如何去重"
4. 再学去重（防止重复），才能谈"如何加权限"
5. 再学 ACL（加权限），才能谈"如何支持更新"
6. 最后学版本（支持更新），才能谈"完整的摄取链路"

这个顺序是"从原始文档到可检索 chunk"的完整链路。

### 问题 2：如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

**移除的机制**：内容哈希去重（不检查 contentHash）。

**可观察现象**：同一个 PDF 上传 2 次，生成 2 份 chunk（内容相同），浪费存储 + 检索时返回重复结果。

**最小复现**：
1. 注释掉 `process_ingestion_v3()` 里的去重检查代码
2. 上传同一个 PDF 2 次（内容相同，文件名可以不同）
3. 查询 chunks 表

**定位证据**：
```sql
SELECT documentId, content, COUNT(*) 
FROM chunks 
WHERE content = '服务器故障排查步骤...' 
GROUP BY documentId, content 
HAVING COUNT(*) > 1;
-- 预期：2 条记录（重复）
```

日志：
```
[Ingestion] Processing: doc.pdf (10MB)
[Ingestion] Processing: doc_copy.pdf (10MB, same content)
[ChunkStore] Saved 25 chunks (doc-001)
[ChunkStore] Saved 25 chunks (doc-002, duplicates)
```

**恢复动作**：
1. 恢复去重检查代码
2. 删除重复的 chunk（`DELETE FROM chunks WHERE documentId = 'doc-002'`）
3. 删除重复的 document（`DELETE FROM documents WHERE id = 'doc-002'`）
4. 重启服务
5. 验证第二次上传被跳过

**防复发测试**（E2E）：
```python
async def test_duplicate_upload_skipped():
    """重复上传应被跳过"""
    content = b"Test document content"
    
    # 1. 第一次上传
    response1 = await client.post('/api/documents/upload', files={'file': ('test.pdf', content)})
    doc_id_1 = response1.json()['document_id']
    
    # 2. 第二次上传（内容相同）
    response2 = await client.post('/api/documents/upload', files={'file': ('test_copy.pdf', content)})
    result2 = response2.json()
    
    # 验证：第二次上传被跳过，返回已存在的 documentId
    assert result2['status'] == 'skipped'
    assert result2['document_id'] == doc_id_1
    
    # 验证：chunks 表只有 1 份
    chunks = await prisma.chunk.find_many(where={'documentId': doc_id_1})
    assert len(chunks) > 0
    
    chunks_2 = await prisma.chunk.find_many(where={'documentId': result2['document_id']})
    assert len(chunks_2) == len(chunks)  # 同一个 document
```

### 问题 3：请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

**代码证据**：
- `rag/deduplication/content_hash.py` 第 8 行：`compute_hash()` 方法计算 SHA256 哈希
- `rag/chunking/semantic_chunker.py` 第 28 行：`chunk()` 方法按段落边界切分（不是固定 512 字）
- `rag/metadata/metadata_extractor.py` 第 15 行：`extract()` 方法提取元数据（来源、租户、版本）
- `rag/acl/acl_manager.py` 第 25 行：`check_permission()` 方法检查租户隔离

**测试证据**：
- `tests/test_deduplication.py` 第 28 行：验证重命名后仍识别为重复（内容哈希去重）
- `tests/test_acl.py` 第 9 行：验证不同租户无法访问（租户隔离）

**架构证据**：
- 依赖图（§7.5.1）：展示 6 层分层（parser / chunker / deduper / metadata / acl / storage）
- 时序图（§7.5.2）：展示摄取完整流程（upload → queue → parse → chunk → save）

**项目目标达成**：
- ✅ 文档解析（PDFParser 支持 PDF → 文本）
- ✅ 语义切分（SemanticChunker 按段落边界）
- ✅ 内容哈希去重（ContentHasher + DocumentDeduper）
- ✅ 完整元数据（MetadataExtractor 提取来源、租户、版本）
- ✅ ACL 权限控制（ACLManager 租户隔离）
- ✅ 失败任务可查询（documents 表 status='failed'）

**距离企业生产标准还缺**：
1. **无增量摄取**：文档更新后需要重新摄取整个文档（不是只摄取变更部分），浪费资源
2. **切分策略单一**：只支持语义边界切分，不支持重叠窗口切分（sliding window，避免切断跨段落上下文）
3. **无摄取优先级**：队列是 FIFO，不支持优先级（例如 VIP 用户的文档优先摄取）
4. **无摄取审计**：不记录"谁摄取了什么文档"、"摄取耗时多久"，无法追溯摄取历史

**下一步演进（不破坏合同）**：
- 在 `documents` 表新增 `previousVersion` 字段（记录上一个版本的 documentId）
- 在 `SemanticChunker` 新增 `overlap` 参数（支持重叠窗口切分）
- 在 `ingestion_queue.add()` 新增 `priority` 参数（BullMQ 支持优先级）
- 新增 `IngestionAuditLog` 表（记录摄取历史）

---

## 12. 真实项目情境题（Day 46 原版，保持原样）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：一次导入 5000 份 PDF，worker 在第 1800 份崩溃；重启后重复生成 12 万个 chunk，队列 ETA 超过 9 小时。请用 documentHash、jobId、attempt 和 chunk count 定位，先暂停重复任务，再修复摄取幂等、checkpoint 与恢复策略，验证重复导入不增加 chunk。
   依据：[BullMQ Idempotent Jobs](https://docs.bullmq.io/patterns/idempotent-jobs)

2. 模拟情境：抽检发现 2% chunk 缺失 ACL，旧文档版本和新版本同时可检索。请按 source、version、parser、tenant 和权限日志追踪，先下线无 ACL 数据，再修复 metadata 必填、去重和版本状态机，用坏 PDF、重复文档、权限缺失和 worker crash 矩阵验收。
   依据：[NestJS Queues](https://docs.nestjs.com/techniques/queues)

知识映射：对应 ingestion 解析、chunk、metadata、去重、ACL 与恢复。

---

## 13. PDF 面试题映射（Day 46 原版，保持原样）

1. RAG 前端链路中，文档上传、切片和向量化的交互流程如何设计？  
   来源：[《2026阿里云前端技术专家-AI领域》](<../../资源/2026阿里云前端技术专家-AI领域.pdf>)，第 5 页。

2. AI 知识库大文件上传如何实现分片、断点续传、秒传和自动恢复？  
   来源：[《2026阿里妈妈高级前端工程师-AI产品方向》](<../../资源/2026阿里妈妈高级前端工程师-AI产品方向.pdf>)，第 7 页。

题目说明：直接匹配 ingestion、chunk 与失败恢复；解析器、元数据、去重、ACL 和 worker crash 仍需项目补全。

---

## 14. 完成后教师五连问（Day 46 原版，保持原样）

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
