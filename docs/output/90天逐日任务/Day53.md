# Day 53 - LangChain 适用边界（框架抽象 vs 自研 + Build-vs-Buy 决策）

> **《90 天拆分规则说明》校正口径（本节为本 Day 的权威执行口径）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。本日继续在 `p1-monitor` 真实链路中累积，不创建平行 Demo。
> - **功能交付**：必须交付一个能跑、能测、能从真实用户入口观察结果的完整模块，知识点由该模块自然引出。
> - **三版演进**：本日以项目门禁/评测为主：v1 是当前基线与最小可运行链路；v2 是加入一个关键质量维度后的可测版本；v3 是加入失败可见、回归阻断和架构证据后的生产终态。三版必须分别产生可观察差异，不能只保留考核题目。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（90 分钟阅读），D 60 分钟、E 20 分钟、F 10 分钟（90 分钟动手）。
> - **累积复用**：开始前读取上一日 commit 和当前源码；复用已有 Schema、RAG、租户、评测、Docker 或 Trace 合同，禁止另建第二套接口。
> - **验收门槛**：核心测试 + 两个不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 动态教师五连问；任何“完整执行版/执行版补全要求”只可作为背景，不能替代本日交付。
> - **跨 Day 导航**：Day54 多租户权限，Day55 Docker Compose，Day56 CI/CD。
>
> **补强要求**：若正文使用“完整执行版”或“执行版补全要求”，领取任务时必须把省略部分展开为当天可执行的测试/反证/情境题，并记录真实项目 diff。

**日期与时长**：2026-09-04 周五，180 分钟（90 分钟阅读 + 90 分钟动手）
**项目**：`D:\demo\ai-techer\p1-monitor`  
**阶段任务性质**：评估 LangChain 适用边界

---

## §0 Day 53 在 90 天路线图里的位置

### 0.1 前情提要（Day 01-52 已建立的能力）

Day 01-52 建立了完整的 RAG 全链路（自研实现）：
- **Day 41-48**：RAG 全链路（文档摄取 → 分块 → 向量化 → 检索）
- **Day 49**：引用闭环（Citation）
- **Day 50**：五十日门禁（现场 Bug 定位）
- **Day 51**：检索评测（Precision@k、Recall@k、MRR）
- **Day 52**：生成质量评测（LLM Judge + 偏差分析）

### 0.2 今天的核心任务

Day 53 评估**LangChain 适用边界**，回答"什么时候用框架、什么时候自研"：

1. **用框架复现现有 RAG**：用 LangChain 重写 Day 48 混合检索
2. **对比收益与成本**：抽象收益 vs 调试成本 vs 版本风险
3. **同基线评测**：用 Day 51 的 Eval 集对比性能
4. **Build-vs-Buy 决策**：若收益不能覆盖成本，回滚到自研

### 0.3 今天要解决的 5 个问题

| 问题 | 现象 | 根因 | 解决方案 |
|---|---|---|---|
| 1. 框架抽象收益未量化 | 不知道用框架是否更好 | 没有对比评测 | 同一 Eval 集对比 MRR |
| 2. 调试成本增加 | 异常堆栈只剩框架内部调用 | 框架抽象层太厚 | 增加 instrumentation |
| 3. Trace 丢失 | 升级 LangChain 后 30% Trace 丢失 | 框架版本不兼容 | 版本锁定 + 回归测试 |
| 4. 性能退化 | 检索 P95 翻倍 | 框架初始化开销 | 冷启动优化 |
| 5. 沉没成本陷阱 | 收益不足但继续投入 | 没有退出标准 | Build-vs-Buy ADR + 回滚机制 |

### 0.4 今天的前置依赖

- **Day 48**：混合检索（Hybrid Search）
- **Day 51**：检索评测（Eval 集）

### 0.5 今天留给下一站的伏笔

- **Day 54-55**：成本优化（Embedding 缓存、Rerank 选择性调用）
- **Day 56-60**：在线评测（A/B Test、实时监控）

---

## §1 今天建立的完整能力

### §1.1 用户能看到什么（5 个场景）

#### 场景 1：用 LangChain 复现现有 RAG

**操作**：用 LangChain 重写 Day 48 混合检索。

**对比**：

| 维度 | 自研实现（Day 48） | LangChain 实现（Day 53） |
|---|---|---|
| 代码行数 | 300 行 | 150 行 |
| 初始化时间 | 0.3s | 1.5s（冷启动慢） |
| MRR | 0.68 | 0.68（相同） |
| 异常堆栈可读性 | 高（直接定位到业务代码） | 低（框架内部调用） |
| Trace 完整性 | 100% | 70%（升级后丢失 30%） |

**结论**：代码量减少 50%，但性能退化（冷启动 5 倍慢）、调试成本增加、Trace 丢失。

#### 场景 2：升级 LangChain 导致性能退化

**现象**：升级 LangChain 0.1.x → 0.2.x 后，检索 P95 从 200ms 升至 400ms（翻倍）。

**根因定位**：
```python
# 升级前（0.1.x）
from langchain.retrievers import BM25Retriever
retriever = BM25Retriever.from_documents(docs)  # 初始化快

# 升级后（0.2.x）
from langchain_community.retrievers import BM25Retriever
retriever = BM25Retriever.from_documents(docs)  # 初始化慢（内部实现变化）
```

**修复**：回滚到 0.1.x + 锁定版本。

#### 场景 3：异常堆栈只剩框架内部调用

**自研实现（Day 48）异常堆栈**：
```
Traceback (most recent call last):
  File "hybrid_search_service.py", line 42, in search
    bm25_results = self.bm25_search(query)
  File "bm25_searcher.py", line 18, in bm25_search
    scores = self.bm25.get_scores(query_tokens)
IndexError: list index out of range
```

**LangChain 实现异常堆栈**：
```
Traceback (most recent call last):
  File "langchain/retrievers/base.py", line 89, in _get_relevant_documents
    return self._retrieve(query)
  File "langchain_community/retrievers/bm25.py", line 123, in _retrieve
    return self._run_query(query)
  File "langchain_community/retrievers/bm25.py", line 156, in _run_query
    scores = self.bm25_model.get_scores(tokens)
IndexError: list index out of range
```

**对比**：LangChain 堆栈多了 3 层框架调用，定位问题更难。

#### 场景 4：Trace 丢失 30%

**现象**：升级 LangChain 后，OpenTelemetry Trace 只覆盖 70% 的请求。

**根因**：LangChain 0.2.x 内部使用异步上下文，导致 Trace Context 传播失败。

**修复**：增加 LangChain 专用的 instrumentation。

```python
# services/ai/src/ai_service/observability/langchain_instrumentation.py
from opentelemetry import trace
from langchain.callbacks.base import BaseCallbackHandler

class TracingCallbackHandler(BaseCallbackHandler):
    def on_chain_start(self, serialized, inputs, **kwargs):
        tracer = trace.get_tracer(__name__)
        span = tracer.start_span(f"langchain.{serialized['name']}")
        span.set_attribute("inputs", str(inputs))
    
    def on_chain_end(self, outputs, **kwargs):
        span = trace.get_current_span()
        span.set_attribute("outputs", str(outputs))
        span.end()
```

#### 场景 5：Build-vs-Buy 决策

**决策框架**：

| 维度 | 自研 | LangChain |
|---|---|---|
| 代码维护成本 | 高（300 行自己维护） | 低（150 行 + 依赖框架） |
| 调试成本 | 低（堆栈清晰） | 高（框架抽象层厚） |
| 性能 | 高（冷启动 0.3s） | 低（冷启动 1.5s） |
| Trace 完整性 | 高（100%） | 低（70%） |
| 版本风险 | 低（自己控制） | 高（框架升级风险） |
| **综合评分** | 7/10 | 5/10 |

**结论**：本项目场景下，自研收益 > LangChain，回滚到自研实现。

### §1.2 各模块职责分工

```
┌─────────────────────────────────────────────────────────────────┐
│                         自研实现（Day 48）                         │
│  - 300 行自研代码                                                 │
│  - 完全可控、堆栈清晰、Trace 100%                                  │
└─────────────────────────────────────────────────────────────────┘
                                  vs
┌─────────────────────────────────────────────────────────────────┐
│                         LangChain 实现（Day 53）                  │
│  - 150 行业务代码 + 框架抽象                                       │
│  - 代码量减少、但调试成本增加、Trace 70%                            │
└─────────────────────────────────────────────────────────────────┘
```

### §1.3 三版演进

#### v1：自研实现（Day 01-52）

- 完全自研（300 行）
- 优点：可控、性能高、Trace 完整
- 缺点：维护成本高

#### v2：LangChain 适配（今天）

- 用 LangChain 复现（150 行）
- 对比收益与成本
- **结论**：本项目场景不适合 LangChain，回滚到 v1

#### v3：混合策略（Day 54-60）

- 核心链路自研（检索、生成）
- 边缘工具用框架（文档加载、格式转换）

### §1.4 今天的完整目录结构

```
services/ai/
├── src/
│   └── ai_service/
│       ├── rag/
│       │   ├── hybrid_search/
│       │   │   ├── hybrid_search_service.py        # 自研实现（Day 48）
│       │   │   └── hybrid_search_langchain.py      # LangChain 实现（Day 53）
│       │   └── retriever_adapter.py                # 统一接口（支持切换）
│       ├── observability/
│       │   └── langchain_instrumentation.py        # LangChain Trace 适配
│       └── evaluation/
│           └── framework_comparison.py             # 框架对比评测

docs/
└── decisions/
    └── 0003-build-vs-buy-rag-retriever.md          # Build-vs-Buy ADR

scripts/
└── compare-frameworks.sh                           # 对比脚本
```

**为什么需要 retriever_adapter.py？**

统一接口支持快速切换（自研 ↔ LangChain），方便 A/B Test。

```python
# services/ai/src/ai_service/rag/retriever_adapter.py
class RetrieverAdapter:
    def __init__(self, impl: str = 'self-built'):
        if impl == 'self-built':
            self.retriever = HybridSearchService()  # 自研
        elif impl == 'langchain':
            self.retriever = HybridSearchLangChain()  # LangChain
    
    async def search(self, query: str, top_k: int) -> List[Document]:
        return await self.retriever.search(query, top_k)
```

---

## §2 今天的开发节奏（3 小时：90 阅读 / 90 动手）

| 阶段 | 时长 | 任务 | 输出 |
|---|---|---|---|
| **阶段 1** | 40 min | 理解 LangChain 抽象（Retriever、Chain、Callback） | 笔记：LangChain 架构 |
| **阶段 2** | 100 min | 用 LangChain 复现 Day 48 + 对比评测 | LangChain 实现 + 对比报告 |
| **阶段 3** | 25 min | Build-vs-Buy 决策 + 回滚 | ADR + commit |
| **阶段 4** | 15 min | 架构证据 + 复盘 | 依赖图 + commit |

---

## §3 v1：自研实现（Day 48 基线）

### 3.1 v1 代码（自研混合检索）

```python
# services/ai/src/ai_service/rag/hybrid_search/hybrid_search_service.py（Day 48）
class HybridSearchService:
    def __init__(self, db, bm25_index):
        self.db = db
        self.bm25_index = bm25_index
    
    async def search(self, query: str, top_k: int = 5) -> List[Document]:
        # 1. 向量检索
        vector_results = await self.vector_search(query, top_k * 2)
        
        # 2. BM25 检索
        bm25_results = self.bm25_search(query, top_k * 2)
        
        # 3. RRF 融合
        merged = self.rrf_merge(vector_results, bm25_results, top_k)
        
        return merged
```

**优点**：
- 代码清晰（300 行）
- 异常堆栈直接定位业务代码
- Trace 100% 覆盖
- 冷启动快（0.3s）

**缺点**：
- 维护成本高（自己维护 300 行）

---

## §4 v2：LangChain 实现（今天）

### 4.1 用 LangChain 复现

```python
# services/ai/src/ai_service/rag/hybrid_search/hybrid_search_langchain.py
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever
from langchain_community.vectorstores import PGVector

class HybridSearchLangChain:
    def __init__(self, db_url: str, documents: List[Document]):
        # 1. 向量检索
        self.vector_store = PGVector.from_documents(
            documents,
            embedding=OpenAIEmbeddings(),
            connection_string=db_url
        )
        self.vector_retriever = self.vector_store.as_retriever(search_kwargs={'k': 10})
        
        # 2. BM25 检索
        self.bm25_retriever = BM25Retriever.from_documents(documents)
        self.bm25_retriever.k = 10
        
        # 3. 混合检索（Ensemble）
        self.ensemble = EnsembleRetriever(
            retrievers=[self.vector_retriever, self.bm25_retriever],
            weights=[0.5, 0.5]
        )
    
    async def search(self, query: str, top_k: int = 5) -> List[Document]:
        results = self.ensemble.get_relevant_documents(query)
        return results[:top_k]
```

**对比**：
- 代码量：300 行 → 150 行（减少 50%）
- 初始化时间：0.3s → 1.5s（慢 5 倍）

### 4.2 同基线评测（Day 51 Eval 集）

```python
# services/ai/src/ai_service/evaluation/framework_comparison.py
import time

async def compare_frameworks():
    eval_set = load_eval_set('data/eval_sets/eval_set_v3.json')
    
    # 1. 自研实现
    self_built = HybridSearchService(db, bm25_index)
    start = time.time()
    self_built_results = []
    for query in eval_set:
        results = await self_built.search(query['query'], top_k=5)
        self_built_results.append(results)
    self_built_time = time.time() - start
    
    # 2. LangChain 实现
    langchain = HybridSearchLangChain(db_url, documents)
    start = time.time()
    langchain_results = []
    for query in eval_set:
        results = await langchain.search(query['query'], top_k=5)
        langchain_results.append(results)
    langchain_time = time.time() - start
    
    # 3. 计算 MRR
    self_built_mrr = calculate_mrr(self_built_results, eval_set)
    langchain_mrr = calculate_mrr(langchain_results, eval_set)
    
    print(f"自研实现: MRR={self_built_mrr:.2f}, Time={self_built_time:.2f}s")
    print(f"LangChain: MRR={langchain_mrr:.2f}, Time={langchain_time:.2f}s")
```

**结果**：
```
自研实现: MRR=0.68, Time=2.5s
LangChain: MRR=0.68, Time=3.2s
```

**结论**：MRR 相同，但 LangChain 慢 28%。

### 4.3 Build-vs-Buy ADR

```markdown
# ADR 0003: Build vs Buy - RAG Retriever

## Status
Accepted（回滚到自研）

## Context
Day 48 自研了混合检索（300 行），Day 53 用 LangChain 复现（150 行）。需要决策：继续自研 vs 迁移到 LangChain。

## Decision
**回滚到自研实现**

## Rationale
| 维度 | 自研 | LangChain |
|---|---|---|
| 代码维护成本 | 300 行 | 150 行 |
| 调试成本 | 低（堆栈清晰） | 高（框架抽象厚） |
| 性能 | MRR=0.68, 2.5s | MRR=0.68, 3.2s（慢 28%） |
| Trace 完整性 | 100% | 70% |
| 版本风险 | 低 | 高（升级风险） |

**综合评分**：自研 7/10，LangChain 5/10。

## Consequences
- 保留自研实现（Day 48 代码）
- LangChain 代码保留在 `hybrid_search_langchain.py`（供 Day 56-60 A/B Test）
- 定期（每季度）重新评估

## Alternatives Considered
1. **全量迁移到 LangChain**：代码量减少，但性能退化 + 调试成本增加
2. **混合策略**：核心自研 + 边缘用框架（Day 54-60 采用此策略）
```

---

## §5 v2 深挖知识点（完整执行版）

### 5.1 LangChain 抽象的收益与成本

**收益**：
- 代码量减少 50%
- 社区生态（预置 Retriever、Loader）

**成本**：
- 冷启动慢 5 倍（框架初始化开销）
- 异常堆栈复杂（框架抽象层厚）
- Trace 丢失 30%（框架版本不兼容）
- 版本升级风险（0.1.x → 0.2.x 破坏性变更）

### 5.2 版本锁定的重要性

```json
// package.json（错误示例）
{
  "dependencies": {
    "langchain": "^0.1.0"  // ❌ 允许 0.1.x → 0.2.x 自动升级
  }
}

// package.json（正确示例）
{
  "dependencies": {
    "langchain": "0.1.35"  // ✅ 锁定具体版本
  }
}
```

**为什么需要锁定版本？**

LangChain 0.1.x → 0.2.x 有破坏性变更（API 变化、性能退化），不锁定版本会导致自动升级后线上故障。

---

## §6 深挖前端底子（完整执行版）

### 6.1 为什么框架抽象层厚会增加调试成本？

自研实现异常堆栈：`业务代码 → 底层库`（2 层）
LangChain 异常堆栈：`业务代码 → LangChain Retriever → LangChain Base → 底层库`（4 层）

每多一层抽象，定位问题多花 30% 时间。

---

## §7 测试与验证（完整执行版）

### 7.1 对比测试（同一 Eval 集）

```bash
# 测试自研 vs LangChain
bash scripts/compare-frameworks.sh
# 预期：MRR 相同，自研性能更好
```

### 7.2 回滚验证

```bash
# 回滚到自研实现
git checkout hybrid_search_service.py
# 验证：MRR 不变、性能恢复
```

---

## 8. 必做测试与两个反证

1. **反证 1：取消 LangChain 版本锁定**。临时把精确版本改成范围版本，在隔离分支重新安装并运行同一 Eval 集、类型检查和 Trace 合同测试；预期任一 API/事件字段漂移都使门禁失败。恢复 lockfile 和精确版本后重新通过。
2. **反证 2：跳过 Build-vs-Buy 门禁**。临时把 100% 流量路由到 LangChain 实现，按相同语料、并发和预算比较 MRR、P95、Trace 完整率与错误堆栈；只要任一预设阈值失败就必须回滚自研实现，不能用代码量更少替代证据。

执行 `bash scripts/compare-frameworks.sh` 和回滚回归测试，把命令、原始输出、版本、数据集 hash 和结论写入 `docs/evidence/day53/`。文中的 28%/30% 是演练阈值或待实测指标，不得写成生产事实。

## 9. 课后三道核心问题

1. 自研 Retriever 与 LangChain Retriever 从入口到引用输出的数据流分别经过哪些层？抽象层带来的收益和可观察成本是什么？
2. 如果框架升级后 MRR 不变但 P95、Trace 完整率和故障定位时间变差，应该如何用权重、阈值和回滚成本做 Build-vs-Buy 决策？
3. 引用本日真实 diff、Eval 输出、Trace 和 ADR 证明最终选择；哪些数字仍只是演练约束，下一步如何获得更强证据？

## 10. 真实项目情境题

1. 团队准备在两周内把自研检索全部迁移到 LangChain，但同一 50 条 Eval 集显示质量持平、P95 上升且 Trace 缺字段。请给出灰度比例、停止条件、回滚步骤和 ADR，说明什么证据足以继续迁移。
2. 依赖自动升级后，生产预演出现 retriever 参数失效和空引用。请从 lockfile、运行时版本、事件合同和 Trace 定位，先冻结发布，再修复版本策略并用离线重放证明恢复。

## 11. PDF 面试题映射

- 框架选型题必须回答业务目标、替代方案、量化指标、迁移/回滚成本和版本风险，不能只比较代码行数。
- PDF 题仅用于口述迁移；本日结论以仓库中的 Eval、Trace、ADR 和真实命令输出为准。

## 12. 完成后教师五连问

提交真实 diff、测试、反证和 ADR 后，教师按“局部机制 -> 边界一致性 -> 线上事故 -> 工程权衡 -> 架构演进”现场提出 5 道问题。每一问必须打开证据文件回答，不能用预设话术替代。

## 13. 跨 Day 导航

- 前置复用：Day48 的自研混合检索与 Day51-52 的 Eval/Trace。
- 本日交付：同数据集框架对比、版本锁定、Build-vs-Buy ADR 和可执行回滚。
- 后续消费：Day54 的租户隔离与 Day55 的成本优化继续使用本日的阈值和证据格式。
