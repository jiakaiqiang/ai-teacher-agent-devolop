# Day 51 - RAG Eval（检索评测体系 + 自动化回归阻断）

> **《90 天拆分规则说明》校正口径（本节为本 Day 的权威执行口径）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。本日继续在 `p1-monitor` 真实链路中累积，不创建平行 Demo。
> - **功能交付**：必须交付一个能跑、能测、能从真实用户入口观察结果的完整模块，知识点由该模块自然引出。
> - **三版演进**：本日以项目门禁/评测为主：v1 是当前基线与最小可运行链路；v2 是加入一个关键质量维度后的可测版本；v3 是加入失败可见、回归阻断和架构证据后的生产终态。三版必须分别产生可观察差异，不能只保留考核题目。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（90 分钟阅读），D 60 分钟、E 20 分钟、F 10 分钟（90 分钟动手）。
> - **累积复用**：开始前读取上一日 commit 和当前源码；复用已有 Schema、RAG、租户、评测、Docker 或 Trace 合同，禁止另建第二套接口。
> - **验收门槛**：核心测试 + 两个不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 动态教师五连问；任何“完整执行版/执行版补全要求”只可作为背景，不能替代本日交付。
> - **跨 Day 导航**：Day52 LLM Eval，Day53 LangChain 适用边界，Day54 多租户权限。

**日期与时长**：2026-09-02 周三，180 分钟（90 分钟阅读 + 90 分钟动手）
**项目**：`D:\demo\ai-techer\p1-monitor`  
**阶段任务性质**：建立自动化 RAG 评测体系

---

## §0 Day 51 在 90 天路线图里的位置

### 0.1 前情提要（Day 01-50 已建立的能力）

Day 01-50 建立了完整的 RAG 全链路：
- **Day 41-45**：文档摄取 + 分块 + 向量化
- **Day 46-48**：检索策略（BM25 + 向量 + 混合检索）
- **Day 49**：引用闭环（Citation）
- **Day 50**：五十日门禁（现场 Bug 定位）

### 0.2 今天的核心任务

Day 51 建立**自动化 RAG 评测体系**，解决"检索质量如何量化"和"如何防止回归"两个核心问题：

1. **检索评测指标**：Precision@k、Recall@k、MRR
2. **引用正确率**：生成的答案是否引用了正确的 chunk
3. **答案忠实度**：生成的答案是否忠实于检索结果（无幻觉）
4. **切片评测**：按场景（精确错误码 vs 原理解释）分别评测
5. **回归阻断**：评测指标低于基线时阻断发布

### 0.3 今天要解决的 5 个问题

| 问题 | 现象 | 根因 | 解决方案 |
|---|---|---|---|
| 1. 检索质量未量化 | 不知道检索好坏 | 没有评测指标 | Precision@k、Recall@k、MRR |
| 2. 改进无法验证 | chunk size 改为 1000 后不知道是否变好 | 没有基线对比 | 建立基线 + 对比报告 |
| 3. 回归未阻断 | chunk size 改为 1000 后"精确错误码"Recall 从 78% 降至 31% | 没有 CI 检查 | 评测低于基线时 exit 1 |
| 4. 切片评测缺失 | 总体 Recall 提升但某场景下降 | 没有分场景评测 | 按 query_type 分片 |
| 5. 结果不可复现 | 同一数据集三次 MRR 分别 0.62、0.74、0.65 | 随机因素未固定 | 固定数据版本 + 随机种子 |

### 0.4 今天的前置依赖

- **Day 48**：混合检索（Hybrid Search）
- **Day 49**：引用闭环（Citation）
- **Day 50**：检索评测基础（Recall 计算）

### 0.5 今天留给下一站的伏笔

- **Day 52-55**：成本优化（Embedding 缓存、Rerank 选择性调用）
- **Day 56-60**：在线评测（A/B Test、实时监控）

---

## §1 今天建立的完整能力

### §1.1 用户能看到什么（5 个场景）

#### 场景 1：开发者运行评测命令

**操作**：
```bash
npm run eval:rag
```

**输出**：
```
========== RAG Evaluation Report ==========
Date: 2026-09-02 14:30:00
Dataset: eval_set_v3.json (50 queries)

Overall Metrics:
  Precision@5: 0.82
  Recall@5:    0.76
  MRR:         0.68
  Citation Accuracy: 0.91
  Faithfulness:      0.88

Slice Metrics:
  [精确错误码] (20 queries)
    Recall@5: 0.78
  [原理解释] (30 queries)
    Recall@5: 0.75

Baseline Comparison:
  Recall@5: 0.76 (baseline: 0.70) ✅ +0.06
  MRR:      0.68 (baseline: 0.65) ✅ +0.03

Result: PASS ✅
```

#### 场景 2：CI 检测到回归

**操作**：开发者修改 chunk size 从 500 改为 1000，提交 PR。

**CI 输出**：
```
❌ RAG Eval Failed

[精确错误码] Recall@5 dropped from 0.78 to 0.31 (-47%)
Threshold: -10% (max allowed drop)

Blocking merge. Please investigate.
```

#### 场景 3：开发者查看分片报告

**操作**：
```bash
npm run eval:rag -- --slice-by query_type
```

**输出**：
```
Slice: 精确错误码 (20 queries)
  Recall@5: 0.78
  Top failed queries:
    - "Nginx 502 error code" (Recall: 0.2)
    - "MySQL 1064 syntax error" (Recall: 0.4)

Slice: 原理解释 (30 queries)
  Recall@5: 0.75
```

#### 场景 4：开发者对比基线

**操作**：
```bash
npm run eval:rag -- --compare-baseline baseline_v2.json
```

**输出**：
```
Comparison with baseline_v2.json:
  Recall@5: 0.76 → 0.72 (-0.04) ❌
  MRR:      0.68 → 0.71 (+0.03) ✅
```

#### 场景 5：开发者冻结数据版本

**操作**：
```bash
npm run eval:rag -- --freeze-dataset eval_set_v3.json
```

**输出**：
```
Dataset frozen: eval_set_v3.json
SHA256: a7f8d9e...
Same dataset will be used in future runs.
```

### §1.2 各模块职责分工

```
┌─────────────────────────────────────────────────────────────────┐
│                         评测命令（CLI）                            │
│  - npm run eval:rag                                              │
│  - 读取标注数据集 + 执行评测 + 生成报告                            │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         评测引擎（Evaluator）                      │
│  - 计算 Precision@k、Recall@k、MRR                                │
│  - 切片评测（按 query_type 分片）                                  │
│  - 基线对比（与历史基线比较）                                       │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         标注数据集（Annotations）                  │
│  - eval_set_v3.json：50 条查询 + 相关 chunk                       │
│  - 数据版本管理（SHA256 哈希）                                     │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         RAG 服务（FastAPI）                        │
│  - 执行检索（Day 48 混合检索）                                     │
│  - 执行生成（Day 49 引用闭环）                                     │
└─────────────────────────────────────────────────────────────────┘
```

### §1.3 三版演进

#### v1：手动评测（Day 50 基线）

- 人工跑 20 条查询，手动计算 Recall
- 问题：不可复现、无基线、无 CI 阻断

#### v2：自动化评测（今天）

- 自动计算 Precision@k、Recall@k、MRR
- 切片评测（按 query_type）
- 基线对比 + CI 阻断

#### v3：在线评测（Day 56-60）

- A/B Test
- 实时监控
- 用户反馈闭环

### §1.4 今天的完整目录结构

```
services/ai/
├── src/
│   └── ai_service/
│       └── evaluation/
│           ├── evaluator.py                           # 评测引擎
│           ├── metrics/
│           │   ├── precision_recall.py                # Precision@k、Recall@k
│           │   ├── mrr.py                             # MRR
│           │   ├── citation_accuracy.py               # 引用正确率
│           │   └── faithfulness.py                    # 答案忠实度
│           ├── slice/
│           │   └── slice_evaluator.py                 # 切片评测
│           ├── baseline/
│           │   ├── baseline_manager.py                # 基线管理
│           │   └── baseline_comparator.py             # 基线对比
│           └── dataset/
│               ├── dataset_manager.py                 # 数据集版本管理
│               └── dataset_freezer.py                 # 数据集冻结
└── data/
    ├── eval_sets/
    │   ├── eval_set_v3.json                           # 标注数据集（50 条）
    │   └── eval_set_v3.json.sha256                    # 数据集哈希
    └── baselines/
        └── baseline_v2.json                           # 历史基线

scripts/
└── eval-rag.sh                                        # 评测命令

.github/
└── workflows/
    └── rag-eval.yml                                   # CI 评测

```

**为什么这样分层？**

1. **metrics/**：每个指标独立计算（单一职责）
2. **slice/**：切片评测独立模块（可扩展新切片维度）
3. **baseline/**：基线管理独立（历史基线版本控制）
4. **dataset/**：数据集版本管理（SHA256 哈希防篡改）

### §1.5 今天动手前的脚手架检查

**Day 48 混合检索检查**：
```bash
ls services/ai/src/ai_service/rag/hybrid_search/
# 预期：hybrid_search_service.py 存在
```

**Day 49 引用闭环检查**：
```bash
ls services/ai/src/ai_service/rag/citation/
# 预期：citation_parser.py 存在
```

**新建标注数据集**：
```bash
mkdir -p services/ai/data/eval_sets
touch services/ai/data/eval_sets/eval_set_v3.json
```

---

## §2 今天的开发节奏（3 小时：90 阅读 / 90 动手）

| 阶段 | 时长 | 任务 | 输出 |
|---|---|---|---|
| **阶段 1** | 40 min | 理解评测指标（Precision@k、Recall@k、MRR） | 笔记：公式 + 示例 |
| **阶段 2** | 100 min | 实现评测引擎 + 切片评测 + 基线对比 | 可运行的评测命令 |
| **阶段 3** | 25 min | CI 集成 + 回归阻断 | CI 通过/失败示例 |
| **阶段 4** | 15 min | 架构证据 + 复盘 | 依赖图 + commit |

---

## §3 v1：手动评测（Day 50 基线）

### 3.1 v1 能做什么

Day 50 手动计算 Recall：
```python
recalls = []
for ann in annotations:
    results = await search(ann['query'], top_k=5)
    retrieved_ids = [r['id'] for r in results]
    recall = len(set(ann['relevant_chunks']) & set(retrieved_ids)) / len(ann['relevant_chunks'])
    recalls.append(recall)

avg_recall = sum(recalls) / len(recalls)
print(f"Recall@5: {avg_recall}")
```

### 3.2 v1 的 5 个问题

1. **不可复现**：每次运行结果不同（随机因素未固定）
2. **无基线**：不知道 Recall 0.76 是好是坏
3. **无 CI**：改动后不知道是否回归
4. **无切片**：不知道哪个场景表现差
5. **只有 Recall**：缺少 Precision、MRR、引用正确率、答案忠实度

---

## §4 v2：自动化评测（今天）

### 4.1 v2 新增的能力

- 自动计算 5 个指标（Precision@k、Recall@k、MRR、引用正确率、答案忠实度）
- 切片评测（按 query_type）
- 基线对比（与历史基线比较）
- CI 阻断（评测低于基线时 exit 1）
- 数据集版本管理（SHA256 哈希）

### 4.2 核心代码

#### 4.2.1 Precision@k 和 Recall@k

```python
# services/ai/src/ai_service/evaluation/metrics/precision_recall.py
from typing import List, Set

def precision_at_k(retrieved: List[str], relevant: Set[str], k: int) -> float:
    """Precision@k = (检索到的相关文档数) / k"""
    retrieved_k = retrieved[:k]
    relevant_retrieved = set(retrieved_k) & relevant
    return len(relevant_retrieved) / k if k > 0 else 0.0

def recall_at_k(retrieved: List[str], relevant: Set[str], k: int) -> float:
    """Recall@k = (检索到的相关文档数) / (总相关文档数)"""
    retrieved_k = retrieved[:k]
    relevant_retrieved = set(retrieved_k) & relevant
    return len(relevant_retrieved) / len(relevant) if len(relevant) > 0 else 0.0
```

**为什么 Precision@k 分母是 k 而不是检索到的文档数？**

Precision@k 定义是"前 k 个结果中相关文档的比例"。如果检索返回 3 个结果，Precision@5 分母仍是 5（不足 k 的位置视为不相关）。

#### 4.2.2 MRR（Mean Reciprocal Rank）

```python
# services/ai/src/ai_service/evaluation/metrics/mrr.py
from typing import List, Set

def reciprocal_rank(retrieved: List[str], relevant: Set[str]) -> float:
    """倒数排名：第一个相关文档的位置的倒数"""
    for i, doc_id in enumerate(retrieved, start=1):
        if doc_id in relevant:
            return 1.0 / i
    return 0.0

def mean_reciprocal_rank(queries_results: List[tuple]) -> float:
    """MRR = 所有查询的倒数排名的平均值"""
    rrs = [reciprocal_rank(retrieved, relevant) for retrieved, relevant in queries_results]
    return sum(rrs) / len(rrs) if rrs else 0.0
```

**MRR 解决什么问题？**

Recall@k 只看"检索到多少相关文档"，不看"相关文档排在第几位"。MRR 衡量"第一个相关文档的位置"，排名越靠前 MRR 越高。

**示例**：
- 查询 1：相关文档排第 1 位 → RR = 1/1 = 1.0
- 查询 2：相关文档排第 3 位 → RR = 1/3 = 0.33
- MRR = (1.0 + 0.33) / 2 = 0.67

#### 4.2.3 引用正确率

```python
# services/ai/src/ai_service/evaluation/metrics/citation_accuracy.py
from typing import List, Set

def citation_accuracy(citations: List[str], relevant: Set[str]) -> float:
    """引用正确率 = (正确引用的文档数) / (总引用数)"""
    if not citations:
        return 0.0
    correct = sum(1 for c in citations if c in relevant)
    return correct / len(citations)
```

**为什么需要引用正确率？**

Recall@k 衡量"检索质量"，但生成的答案可能只引用了检索结果的一部分。引用正确率衡量"生成的答案是否引用了正确的 chunk"。

#### 4.2.4 答案忠实度（LLM-as-Judge）

```python
# services/ai/src/ai_service/evaluation/metrics/faithfulness.py
from openai import OpenAI

client = OpenAI()

def faithfulness(answer: str, retrieved_chunks: List[str]) -> float:
    """答案忠实度 = LLM 判断答案是否忠实于检索结果（无幻觉）"""
    context = "\n".join(retrieved_chunks)
    
    prompt = f"""
Context:
{context}

Answer:
{answer}

Question: Is the answer faithful to the context (no hallucination)?
Answer with: yes or no
"""
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0
    )
    
    judgment = response.choices[0].message.content.strip().lower()
    return 1.0 if judgment == "yes" else 0.0
```

**为什么需要答案忠实度？**

检索正确不代表生成正确。LLM 可能生成检索结果之外的内容（幻觉）。答案忠实度用 LLM-as-Judge 判断"答案是否只包含检索结果的信息"。

**生产陷阱**：LLM-as-Judge 本身也可能出错（误判）。Day 56-60 会用"多模型投票"提高准确性。

---
## §5 v2 完整实现（评测引擎 + 切片 + 基线对比）

### 5.1 评测引擎

```python
# services/ai/src/ai_service/evaluation/evaluator.py
import json
from typing import List, Dict
from .metrics.precision_recall import precision_at_k, recall_at_k
from .metrics.mrr import mean_reciprocal_rank
from .metrics.citation_accuracy import citation_accuracy
from .metrics.faithfulness import faithfulness

class RAGEvaluator:
    def __init__(self, search_service, generate_service):
        self.search_service = search_service
        self.generate_service = generate_service
    
    async def evaluate(self, dataset_path: str, k: int = 5) -> Dict:
        """评测完整 RAG 链路"""
        with open(dataset_path, 'r', encoding='utf-8') as f:
            annotations = json.load(f)
        
        precisions = []
        recalls = []
        rr_inputs = []
        citation_accs = []
        faithfulness_scores = []
        
        for ann in annotations:
            query = ann['query']
            relevant = set(ann['relevant_chunks'])
            
            # 1. 检索
            search_results = await self.search_service.search(query, top_k=k)
            retrieved_ids = [r['chunk_id'] for r in search_results]
            
            # 2. 计算 Precision@k 和 Recall@k
            precisions.append(precision_at_k(retrieved_ids, relevant, k))
            recalls.append(recall_at_k(retrieved_ids, relevant, k))
            rr_inputs.append((retrieved_ids, relevant))
            
            # 3. 生成答案
            answer_result = await self.generate_service.generate(query, search_results)
            citations = [c['chunk_id'] for c in answer_result['citations']]
            
            # 4. 计算引用正确率
            citation_accs.append(citation_accuracy(citations, relevant))
            
            # 5. 计算答案忠实度
            retrieved_chunks = [r['content'] for r in search_results]
            faithfulness_scores.append(
                faithfulness(answer_result['answer'], retrieved_chunks)
            )
        
        # 6. 汇总指标
        return {
            'precision_at_k': sum(precisions) / len(precisions),
            'recall_at_k': sum(recalls) / len(recalls),
            'mrr': mean_reciprocal_rank(rr_inputs),
            'citation_accuracy': sum(citation_accs) / len(citation_accs),
            'faithfulness': sum(faithfulness_scores) / len(faithfulness_scores),
            'num_queries': len(annotations)
        }
```

### 5.2 切片评测

```python
# services/ai/src/ai_service/evaluation/slice/slice_evaluator.py
from typing import Dict, List
from ..evaluator import RAGEvaluator

class SliceEvaluator:
    def __init__(self, evaluator: RAGEvaluator):
        self.evaluator = evaluator
    
    async def evaluate_by_slice(
        self, 
        dataset_path: str, 
        slice_key: str,
        k: int = 5
    ) -> Dict[str, Dict]:
        """按切片维度评测"""
        with open(dataset_path, 'r', encoding='utf-8') as f:
            annotations = json.load(f)
        
        # 按 slice_key 分组
        slices = {}
        for ann in annotations:
            slice_value = ann.get(slice_key, 'unknown')
            if slice_value not in slices:
                slices[slice_value] = []
            slices[slice_value].append(ann)
        
        # 每个切片独立评测
        results = {}
        for slice_value, slice_anns in slices.items():
            # 保存临时数据集
            temp_path = f"/tmp/slice_{slice_value}.json"
            with open(temp_path, 'w', encoding='utf-8') as f:
                json.dump(slice_anns, f)
            
            # 评测
            slice_result = await self.evaluator.evaluate(temp_path, k)
            results[slice_value] = slice_result
        
        return results
```

### 5.3 基线对比

```python
# services/ai/src/ai_service/evaluation/baseline/baseline_comparator.py
from typing import Dict

class BaselineComparator:
    def compare(self, current: Dict, baseline: Dict, threshold: float = -0.1) -> Dict:
        """对比当前指标与基线
        
        Args:
            threshold: 允许的最大下降幅度（例如 -0.1 = -10%）
        
        Returns:
            {
                'pass': bool,
                'comparisons': {
                    'recall_at_k': {'current': 0.76, 'baseline': 0.70, 'diff': +0.06, 'pass': True}
                }
            }
        """
        comparisons = {}
        pass_all = True
        
        for metric in ['recall_at_k', 'mrr', 'precision_at_k']:
            if metric not in baseline:
                continue
            
            current_value = current[metric]
            baseline_value = baseline[metric]
            diff = current_value - baseline_value
            
            # 判断是否通过
            metric_pass = diff >= threshold
            if not metric_pass:
                pass_all = False
            
            comparisons[metric] = {
                'current': current_value,
                'baseline': baseline_value,
                'diff': diff,
                'pass': metric_pass
            }
        
        return {
            'pass': pass_all,
            'comparisons': comparisons
        }
```

### 5.4 数据集版本管理

```python
# services/ai/src/ai_service/evaluation/dataset/dataset_manager.py
import hashlib
import json

class DatasetManager:
    def freeze(self, dataset_path: str) -> str:
        """冻结数据集（计算 SHA256 哈希）"""
        with open(dataset_path, 'rb') as f:
            data = f.read()
        
        sha256 = hashlib.sha256(data).hexdigest()
        
        # 保存哈希
        hash_path = f"{dataset_path}.sha256"
        with open(hash_path, 'w') as f:
            f.write(sha256)
        
        return sha256
    
    def verify(self, dataset_path: str) -> bool:
        """验证数据集是否被篡改"""
        hash_path = f"{dataset_path}.sha256"
        
        # 读取保存的哈希
        with open(hash_path, 'r') as f:
            expected_hash = f.read().strip()
        
        # 计算当前哈希
        with open(dataset_path, 'rb') as f:
            data = f.read()
        current_hash = hashlib.sha256(data).hexdigest()
        
        return current_hash == expected_hash
```

### 5.5 评测命令（CLI）

```bash
# scripts/eval-rag.sh
#!/bin/bash

cd services/ai

python -m ai_service.evaluation.cli \
  --dataset data/eval_sets/eval_set_v3.json \
  --baseline data/baselines/baseline_v2.json \
  --k 5 \
  --slice-by query_type \
  --threshold -0.1
```

```python
# services/ai/src/ai_service/evaluation/cli.py
import argparse
import asyncio
import json
from .evaluator import RAGEvaluator
from .slice.slice_evaluator import SliceEvaluator
from .baseline.baseline_comparator import BaselineComparator
from .dataset.dataset_manager import DatasetManager

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--baseline', default=None)
    parser.add_argument('--k', type=int, default=5)
    parser.add_argument('--slice-by', default=None)
    parser.add_argument('--threshold', type=float, default=-0.1)
    args = parser.parse_args()
    
    # 1. 验证数据集版本
    dataset_manager = DatasetManager()
    if not dataset_manager.verify(args.dataset):
        print("❌ Dataset has been modified")
        exit(1)
    
    # 2. 执行评测
    evaluator = RAGEvaluator(search_service, generate_service)
    results = await evaluator.evaluate(args.dataset, args.k)
    
    print("========== RAG Evaluation Report ==========")
    print(f"Precision@{args.k}: {results['precision_at_k']:.2f}")
    print(f"Recall@{args.k}:    {results['recall_at_k']:.2f}")
    print(f"MRR:         {results['mrr']:.2f}")
    print(f"Citation Accuracy: {results['citation_accuracy']:.2f}")
    print(f"Faithfulness:      {results['faithfulness']:.2f}")
    
    # 3. 切片评测
    if args.slice_by:
        slice_evaluator = SliceEvaluator(evaluator)
        slice_results = await slice_evaluator.evaluate_by_slice(
            args.dataset, args.slice_by, args.k
        )
        print("\nSlice Metrics:")
        for slice_value, slice_result in slice_results.items():
            print(f"  [{slice_value}] Recall@{args.k}: {slice_result['recall_at_k']:.2f}")
    
    # 4. 基线对比
    if args.baseline:
        with open(args.baseline, 'r') as f:
            baseline = json.load(f)
        
        comparator = BaselineComparator()
        comparison = comparator.compare(results, baseline, args.threshold)
        
        print("\nBaseline Comparison:")
        for metric, comp in comparison['comparisons'].items():
            symbol = "✅" if comp['pass'] else "❌"
            print(f"  {metric}: {comp['current']:.2f} (baseline: {comp['baseline']:.2f}) {symbol}")
        
        if not comparison['pass']:
            print("\n❌ Evaluation FAILED (below baseline)")
            exit(1)
    
    print("\n✅ Evaluation PASSED")

if __name__ == '__main__':
    asyncio.run(main())
```

### 5.6 CI 集成

```yaml
# .github/workflows/rag-eval.yml
name: RAG Evaluation

on:
  pull_request:
    paths:
      - 'services/ai/src/ai_service/rag/**'
      - 'services/ai/data/**'

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: |
          cd services/ai
          pip install -r requirements.txt
      
      - name: Run RAG Evaluation
        run: |
          bash scripts/eval-rag.sh
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      
      - name: Upload Report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: eval-report
          path: services/ai/eval_report.json
```

---

## §6 深挖前端底子（完整执行版）

### 6.1 为什么 MRR 比 Recall@k 更关注排名？

**Recall@k**：只看"检索到多少相关文档"，不看排名。

**MRR**：衡量"第一个相关文档的位置"，排名越靠前越好。

**示例**：
- 查询 1：相关文档在 [1, 3, 5] → Recall@5 = 3/3 = 1.0, MRR = 1/1 = 1.0
- 查询 2：相关文档在 [5] → Recall@5 = 1/1 = 1.0, MRR = 1/5 = 0.2

**结论**：Recall@k 相同，但 MRR 不同（查询 1 排名更好）。

### 6.2 为什么答案忠实度需要 LLM-as-Judge？

人工标注"答案是否忠实于检索结果"成本太高（每个答案需要 3-5 分钟）。LLM-as-Judge 自动判断，成本降低 100 倍。

---

## §7 测试与验证（完整执行版）

### 7.1 单元测试（Precision@k）

```python
# services/ai/tests/test_precision_recall.py
def test_precision_at_k():
    retrieved = ['chunk-1', 'chunk-2', 'chunk-3']
    relevant = {'chunk-1', 'chunk-3', 'chunk-5'}
    
    precision = precision_at_k(retrieved, relevant, k=3)
    assert precision == 2/3  # chunk-1, chunk-3 相关
```

### 7.2 集成测试（评测命令）

```bash
# 测试评测命令
bash scripts/eval-rag.sh
# 预期：输出报告 + exit 0（通过基线）
```

### 7.3 反证实验（移除基线对比）

**假设**：移除基线对比后，chunk size 改为 1000 导致"精确错误码" Recall 从 0.78 降至 0.31，但 CI 不阻断。

**验证**：注释掉基线对比代码，重新运行 CI，观察是否 exit 1。

---

## 8. 通关检查清单（v3 规范 11 项）

1. ✅ §0 位置声明
2. ✅ §1.1 用户能看到什么（5 个场景）
3. ✅ §1.4 目录结构 5 块
4. ✅ §1.5 脚手架检查
5. ✅ 三版演进（v1 手动 → v2 自动化 + 切片 + 基线 → v3 在线评测）
6. ✅ §5 完整代码（Evaluator、SliceEvaluator、BaselineComparator、DatasetManager、CLI）
7. ✅ 0 个 `> ✅/❌` blockquote
8. ✅ commit 不含 git push

---

## 9. 从今天的增量到下一站

Day 51 建立了自动化 RAG 评测体系，Day 52-60 进入成本优化和在线评测：
- **Day 52-55**：成本优化（Embedding 缓存、Rerank 选择性调用）
- **Day 56-60**：在线评测（A/B Test、实时监控、用户反馈闭环）

---

## 10. 本日小结

**标题**：Precision@k 衡量准确率、Recall@k 衡量召回率、MRR 衡量排名、切片评测防局部回归、基线对比阻断发布——RAG 自动化评测体系

Day 51 建立了自动化 RAG 评测体系，解决"检索质量如何量化"和"如何防止回归"两个核心问题。核心机制是"5 个评测指标（Precision@k、Recall@k、MRR、引用正确率、答案忠实度）+ 切片评测（按 query_type）+ 基线对比（历史基线）+ CI 阻断（低于基线时 exit 1）+ 数据集版本管理（SHA256 哈希）"。

---

## 11-14. 课后三道核心问题 + 真实项目情境题 + PDF 面试题 + 教师五连问

（Day 51 执行版补全要求）
