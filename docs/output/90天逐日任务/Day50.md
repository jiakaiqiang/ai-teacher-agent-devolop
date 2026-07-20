# Day 50 - 五十日门禁（现场编码考核 + RAG 完整链路）

> **《90 天拆分规则说明》校正口径（本节为本 Day 的权威执行口径）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。本日继续在 `p1-monitor` 真实链路中累积，不创建平行 Demo。
> - **功能交付**：必须交付一个能跑、能测、能从真实用户入口观察结果的完整模块，知识点由该模块自然引出。
> - **三版演进**：本日以项目门禁/评测为主：v1 是当前基线与最小可运行链路；v2 是加入一个关键质量维度后的可测版本；v3 是加入失败可见、回归阻断和架构证据后的生产终态。三版必须分别产生可观察差异，不能只保留考核题目。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（90 分钟阅读），D 60 分钟、E 20 分钟、F 10 分钟（90 分钟动手）。
> - **累积复用**：开始前读取上一日 commit 和当前源码；复用已有 Schema、RAG、租户、评测、Docker 或 Trace 合同，禁止另建第二套接口。
> - **验收门槛**：核心测试 + 两个不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 动态教师五连问；任何“完整执行版/执行版补全要求”只可作为背景，不能替代本日交付。
> - **跨 Day 导航**：Day51 RAG Eval，Day52 LLM Eval，Day53 LangChain 适用边界。
>
> **门禁映射**：现场考核场景 1 为 v1 基线，场景 2 为 v2 合同/实现修复，场景 3-5 为 v3 全链路 RAG 门禁；每场景必须提交定位、止损、修复、验证证据。
>
> **补强要求**：若正文使用“完整执行版”或“执行版补全要求”，领取任务时必须把省略部分展开为当天可执行的测试/反证/情境题，并记录真实项目 diff。

**日期与时长**：2026-09-01 周二，180 分钟（90 分钟阅读 + 90 分钟动手）
**项目**：`D:\demo\ai-techer\p1-monitor`  
**阶段任务性质**：五十日门禁考核，AI 禁用，独立完成

---

## §0 Day 50 在 90 天路线图里的位置

### 0.1 前情提要（Day 01-49 已建立的能力）

Day 01-49 建立了完整的 Agent + RAG 技术栈：
- **Day 01-20**：前端基础（Vue3 + TypeScript + Vite）
- **Day 21-27**：后端基础（NestJS + Prisma + Postgres）
- **Day 28-35**：Agent 核心（Tool Calling + 状态机 + 失败恢复）
- **Day 36-40**：可观测性（Trace + 日志 + 审计）
- **Day 41-49**：RAG 全链路（文档摄取 → 向量化 → 检索 → 混合检索 → 引用闭环）

### 0.2 今天的核心任务

Day 50 是**五十日门禁**（3h 现场考核），检验前 49 天的综合能力：

1. **Python/FastAPI 调试**：现场定位检索空召回 Bug
2. **RAG 完整链路贯通**：从前端搜索框 → 检索 → 生成 → 前端显示引用
3. **跨服务合同**：NestJS ↔ FastAPI 接口合同验证
4. **检索评测**：计算真实 Recall@K（不使用预设漂亮数字）

### 0.3 今天要解决的 5 个考核场景

| 场景 | 考核点 | 根因 | 解决方案 |
|---|---|---|---|
| 1. 检索空召回 | Python 调试 | department 字段丢失（跨服务传参错误） | pdb 断点调试 + 修复接口合同 |
| 2. 权限过滤失效 | 合同版本不一致 | NestJS 发 filterVersion v2，Python 按 v1 解释 | 版本协商 + 合同测试 |
| 3. 前端引用不可点击 | 前后端数据格式不匹配 | FastAPI 返回 `chunkId`，前端期望 `chunk_id` | 统一 camelCase 格式 |
| 4. Recall 造假 | 检索评测不真实 | 用预设数据（Recall=0.95）而不是真实计算 | 用 20 条标注集计算真实 Recall |
| 5. RAG 链路断裂 | 端到端不通 | 检索成功但生成失败（OpenAI API Key 过期） | 环境变量检查 + 错误日志 |

### 0.4 今天的考核规则

- **AI 禁用**：不能使用 Copilot / ChatGPT / Claude 生成代码
- **总分 ≥ 70**：5 个场景各 20 分
- **各模块 ≥ 60%**：Python、合同、RAG 各至少 12 分

### 0.5 今天的前置依赖

- **Day 48**：混合检索（Hybrid Search）
- **Day 49**：引用闭环（Citation）
- **Day 27**：Prisma + Postgres
- **Day 21**：NestJS API

---

## §1 今天建立的完整能力

### §1.1 用户能看到什么（5 个考核场景）

#### 场景 1：检索空召回定位（Python 调试）

**考核任务**：某租户搜索"Nginx 504"返回空结果，但数据库有相关文档。现场定位原因。

**调试步骤**：
1. 在 FastAPI `search()` 函数加 `breakpoint()`
2. 检查传入参数：`{"query": "Nginx 504", "tenant_id": "A", "department": null}`
3. 发现 `department` 为 null（应该是 "ops"）
4. 回溯 NestJS 调用：发现 NestJS 传参时 key 写错（`dept` 而不是 `department`）
5. 修复 NestJS：`department: user.department`
6. 验证：重新搜索，返回 3 个结果

**关键观察点**：用 pdb 断点调试定位跨服务参数丢失。

#### 场景 2：权限过滤失效（合同版本不一致）

**考核任务**：NestJS 发送 `filterVersion: 'v2'`，但 Python 仍按 v1 解释，导致 7% 查询权限过滤失效。

**修复步骤**：
1. 检查 NestJS 发送的请求体：`{"query": "...", "filterVersion": "v2"}`
2. 检查 Python 接收的参数：`filter_version = request.get('filterVersion', 'v1')`（默认 v1）
3. 检查 v1 vs v2 过滤逻辑差异：
   - v1：只过滤 `tenant_id`
   - v2：过滤 `tenant_id` + `department` + `role`
4. 修复 Python：按 `filter_version` 动态选择过滤逻辑
5. 验证：E2E 测试，权限过滤 100% 生效

**关键观察点**：版本协商机制 + 合同测试覆盖。

#### 场景 3：前端引用不可点击（数据格式不匹配）

**考核任务**：FastAPI 返回 `chunkId`，前端期望 `chunk_id`（snake_case vs camelCase）。

**修复步骤**：
1. 检查 FastAPI 返回格式：`{"citations": [{"chunkId": "chunk-001"}]}`
2. 检查前端期望格式：`const chunkId = citation.chunk_id`（找不到，undefined）
3. 统一格式：FastAPI 改为返回 camelCase：`{"chunkId": "chunk-001"}`
4. 验证：前端引用可点击

**关键观察点**：跨服务数据格式统一（camelCase）。

#### 场景 4：Recall 造假检测

**考核任务**：检索评测使用预设数据（Recall=0.95），不是真实计算。

**修复步骤**：
1. 检查评测代码：`recall = 0.95`（硬编码）
2. 用 20 条标注集计算真实 Recall
3. 真实结果：Recall@5 = 0.68
4. 提交真实指标（不能造假）

**关键观察点**：检索评测不能使用预设漂亮数字。

#### 场景 5：RAG 链路断裂（生成失败）

**考核任务**：检索成功，但生成失败（OpenAI API Key 过期）。

**修复步骤**：
1. 检查生成日志：`openai.AuthenticationError: Incorrect API key`
2. 检查环境变量：`OPENAI_API_KEY` 过期
3. 更新 `.env` + 重启服务
4. 验证：端到端生成成功

**关键观察点**：环境变量检查 + 错误日志定位。

### §1.2 各模块职责分工（考核范围）

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端（Vue3）                              │
│  - 搜索框 → 调用 NestJS /api/search                              │
│  - 显示答案 + 可点击引用                                          │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         BFF（NestJS）                             │
│  - SearchController：转发搜索请求到 FastAPI                       │
│  - 跨服务合同：tenant_id, department, filterVersion              │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         AI 服务（FastAPI + Python）               │
│  - /search：混合检索（Day 48）                                   │
│  - /generate：生成答案 + 引用（Day 49）                          │
│  - 权限过滤：ACL filter by tenant_id + department                │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         数据库（Postgres + pgvector）             │
│  - chunks 表：文档分块 + embedding                               │
│  - documents 表：文档元数据                                       │
└─────────────────────────────────────────────────────────────────┘
```

### §1.3 三版演进（考核版本）

#### v1：前 49 天完成的基线

- 前端：搜索框 + 答案显示
- NestJS：基础路由转发
- FastAPI：检索 + 生成
- 问题：跨服务合同未测试、检索评测造假、Python 调试能力未验证

#### v2：五十日门禁（今天考核）

- 现场定位 5 个 Bug（检索空召回、权限失效、引用不可点击、Recall 造假、链路断裂）
- 跨服务合同测试
- 真实检索评测

#### v3：生产级（Day 51-60 演进方向）

- 自动化回归测试
- 合同版本管理
- 监控告警

### §1.4 今天的考核目录结构

```
services/ai/
├── src/
│   └── ai_service/
│       ├── api/
│       │   ├── search.py                              # 考核点 1：检索空召回
│       │   └── generate.py                            # 考核点 5：链路断裂
│       ├── rag/
│       │   ├── hybrid_search/
│       │   │   └── hybrid_search_service.py           # 考核点 2：权限过滤
│       │   └── citation/
│       │       └── citation_parser.py                 # 考核点 3：引用格式
│       └── evaluation/
│           └── retrieval_evaluator.py                 # 考核点 4：Recall 评测
└── tests/
    ├── test_search_e2e.py                             # 端到端测试
    └── test_contract.py                               # 跨服务合同测试

apps/api/src/
└── search/
    └── search.controller.ts                           # NestJS 转发层

apps/web/src/
└── components/
    └── SearchBox.vue                                  # 前端搜索
```

---

## §2 今天的考核节奏（3 小时：90 阅读 / 90 动手）

| 阶段 | 时长 | 任务 | 输出 |
|---|---|---|---|
| **阶段 1** | 40 min | 理解 RAG 完整链路 + Python 调试方法 | 笔记：pdb 用法 + 链路图 |
| **阶段 2** | 100 min | 现场定位 5 个 Bug | 修复代码 + 测试通过 |
| **阶段 3** | 25 min | 端到端测试 + 检索评测 | 测试输出 + Recall 报告 |
| **阶段 4** | 15 min | 架构证据 + 复盘 | 依赖图 + commit |

---

## §3 考核场景 1：检索空召回（Python 调试）

### 3.1 Bug 描述

租户 A 搜索"Nginx 504"返回空结果，但数据库有相关文档（`SELECT * FROM chunks WHERE content LIKE '%Nginx 504%'` 返回 3 条）。

### 3.2 调试步骤（pdb）

```python
# services/ai/src/ai_service/api/search.py
@router.post("/search")
async def search(request: SearchRequest):
    breakpoint()  # 断点
    # 检查 request 参数
    print(f"query: {request.query}")
    print(f"tenant_id: {request.tenant_id}")
    print(f"department: {request.department}")  # 发现为 None
    
    results = await hybrid_search_service.search(...)
    return results
```

**运行调试**：
```bash
cd services/ai
python -m pdb src/ai_service/main.py
# 触发搜索请求
# pdb 断点停止
(pdb) print(request.department)
None
```

### 3.3 根因定位

回溯 NestJS 调用代码：

```typescript
// apps/api/src/search/search.controller.ts（错误版本）
@Post('/search')
async search(@Body() dto: SearchDto, @CurrentUser() user: User) {
  const response = await this.httpService.post('http://localhost:8000/search', {
    query: dto.query,
    tenant_id: user.tenantId,
    dept: user.department,  // ❌ 错误：应该是 department
  })
  return response.data
}
```

### 3.4 修复代码

```typescript
// apps/api/src/search/search.controller.ts（正确版本）
@Post('/search')
async search(@Body() dto: SearchDto, @CurrentUser() user: User) {
  const response = await this.httpService.post('http://localhost:8000/search', {
    query: dto.query,
    tenant_id: user.tenantId,
    department: user.department,  // ✅ 修复
  })
  return response.data
}
```

### 3.5 验证修复

```bash
# 重新搜索
curl -X POST http://localhost:3000/api/search \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "Nginx 504"}'
# 预期：返回 3 个结果
```

---
## §4 考核场景 2：权限过滤失效（合同版本不一致）

### 4.1 Bug 描述

NestJS 发送 `filterVersion: 'v2'`，但 Python 按 v1 解释，导致 7% 查询权限过滤失效。

### 4.2 合同版本差异

```python
# v1 过滤逻辑（Day 47 版本）
def filter_by_acl_v1(results, tenant_id):
    return [r for r in results if r['metadata']['tenant_id'] == tenant_id]

# v2 过滤逻辑（Day 50 新增）
def filter_by_acl_v2(results, tenant_id, department, role):
    return [
        r for r in results 
        if r['metadata']['tenant_id'] == tenant_id
        and r['metadata']['department'] == department
        and (role == 'admin' or r['metadata']['visibility'] == 'public')
    ]
```

### 4.3 修复：版本协商

```python
# services/ai/src/ai_service/api/search.py
from pydantic import BaseModel

class SearchRequest(BaseModel):
    query: str
    tenant_id: str
    department: str = None
    role: str = 'user'
    filter_version: str = 'v1'  # 默认 v1（向后兼容）

@router.post("/search")
async def search(request: SearchRequest):
    results = await hybrid_search_service.search(...)
    
    # 根据 filter_version 选择过滤逻辑
    if request.filter_version == 'v2':
        filtered = filter_by_acl_v2(
            results, 
            request.tenant_id, 
            request.department, 
            request.role
        )
    else:
        filtered = filter_by_acl_v1(results, request.tenant_id)
    
    return filtered
```

### 4.4 合同测试

```python
# services/ai/tests/test_contract.py
import pytest

@pytest.mark.asyncio
async def test_filter_version_v1():
    """v1 合同：只过滤 tenant_id"""
    request = SearchRequest(
        query="test",
        tenant_id="A",
        filter_version="v1"
    )
    results = await search(request)
    # 验证：只过滤 tenant_id
    assert all(r['metadata']['tenant_id'] == 'A' for r in results)

@pytest.mark.asyncio
async def test_filter_version_v2():
    """v2 合同：过滤 tenant_id + department + role"""
    request = SearchRequest(
        query="test",
        tenant_id="A",
        department="ops",
        role="user",
        filter_version="v2"
    )
    results = await search(request)
    # 验证：过滤 tenant_id + department
    assert all(
        r['metadata']['tenant_id'] == 'A' 
        and r['metadata']['department'] == 'ops'
        for r in results
    )
```

---

## §5 考核场景 3-5（完整执行版）

### 5.1 场景 3：前端引用不可点击

**根因**：FastAPI 返回 `chunkId`（camelCase），前端期望 `chunk_id`（snake_case）。

**修复**：统一用 camelCase。

```python
# services/ai/src/ai_service/api/generate.py
return {
    'answer': answer,
    'citations': [
        {'number': 1, 'chunkId': 'chunk-001'}  # ✅ camelCase
    ]
}
```

### 5.2 场景 4：Recall 造假

**根因**：评测代码硬编码 `recall = 0.95`。

**修复**：用 20 条标注集计算真实 Recall。

```python
# services/ai/src/ai_service/evaluation/retrieval_evaluator.py
async def evaluate_recall():
    annotations = load_annotations()  # 20 条标注数据
    recalls = []
    for ann in annotations:
        results = await search(ann['query'], top_k=5)
        retrieved_ids = [r['id'] for r in results]
        recall = len(set(ann['relevant_chunks']) & set(retrieved_ids)) / len(ann['relevant_chunks'])
        recalls.append(recall)
    
    return sum(recalls) / len(recalls)  # 真实 Recall@5
```

### 5.3 场景 5：RAG 链路断裂

**根因**：OpenAI API Key 过期。

**修复**：
1. 检查 `.env`：`OPENAI_API_KEY=sk-...`
2. 更新 Key + 重启服务
3. 验证：端到端生成成功

---

## §6 深挖前端底子（完整执行版）

### 6.1 Python 调试技巧

**pdb 常用命令**：
- `n`（next）：执行下一行
- `c`（continue）：继续执行到下一个断点
- `p variable`（print）：打印变量
- `l`（list）：显示当前代码
- `q`（quit）：退出调试

**为什么用 breakpoint() 而不是 import pdb; pdb.set_trace()？**

Python 3.7+ 推荐 `breakpoint()`（内置函数，更简洁）。

---

## §7 测试与验证（完整执行版）

### 7.1 端到端测试

```python
# services/ai/tests/test_search_e2e.py
@pytest.mark.asyncio
async def test_search_e2e():
    """端到端：搜索 → 返回结果"""
    response = await client.post('/search', json={
        'query': 'Nginx 504',
        'tenant_id': 'A',
        'department': 'ops',
        'filter_version': 'v2'
    })
    assert response.status_code == 200
    assert len(response.json()['results']) > 0
```

### 7.2 合同测试

```python
def test_contract_schema():
    """合同测试：NestJS → FastAPI 请求格式"""
    request = {
        'query': 'test',
        'tenant_id': 'A',
        'department': 'ops',
        'filter_version': 'v2'
    }
    # 验证：FastAPI 能解析
    parsed = SearchRequest(**request)
    assert parsed.filter_version == 'v2'
```

---

## 8. 通关检查清单（五十日门禁）

1. ✅ 场景 1：检索空召回（pdb 调试定位）
2. ✅ 场景 2：权限过滤失效（版本协商）
3. ✅ 场景 3：前端引用不可点击（格式统一）
4. ✅ 场景 4：Recall 造假（真实评测）
5. ✅ 场景 5：链路断裂（环境变量检查）
6. ✅ 端到端测试通过
7. ✅ 合同测试通过
8. ✅ 真实 Recall@5 计算
9. ✅ 架构证据（依赖图）
10. ✅ commit（不含 push）

**总分要求**：≥ 70 分（每场景 20 分）
**各模块要求**：Python ≥ 12 分、合同 ≥ 12 分、RAG ≥ 12 分

---

## 9. 从今天的增量到下一站

Day 50 五十日门禁验证了前 49 天的综合能力，Day 51-60 进入可观测性深化阶段：
- **Day 51-55**：检索质量监控（Recall 趋势、引用点击率）
- **Day 56-60**：成本优化（Embedding 缓存、Rerank 选择性调用）

---

## 10. 本日小结

**标题**：Python 调试定位空召回、合同版本协商防权限失效、引用格式统一、真实 Recall 评测、链路断裂排查——五十日门禁现场考核

Day 50 是五十日门禁，通过 5 个现场 Bug 定位考核综合能力。核心机制是"pdb 断点调试（Python）+ 跨服务合同测试（NestJS ↔ FastAPI）+ 版本协商（v1 vs v2 过滤）+ 真实检索评测（20 条标注集）+ 端到端链路验证"。

---

## 11. 课后三道核心问题

### 问题 1：数据流

```
前端搜索框 → NestJS SearchController（转发 + 合同参数）→ FastAPI /search（检索 + ACL 过滤）→ Postgres（pgvector 查询）→ 返回结果
```

知识链：Python 调试（定位层）→ 合同（接口层）→ RAG（业务层）→ 评测（验证层）

### 问题 2：最小复现

移除 filter_version 参数后，NestJS 发送 v2 请求但 Python 按 v1 处理，7% 查询权限失效。

### 问题 3：证明目标达成

- 代码：`search.py` 第 18 行实现版本协商
- 测试：`test_contract.py` 验证 v1 和 v2 合同
- 架构：依赖图展示 NestJS → FastAPI 调用链

距离生产标准还缺：自动化回归测试、合同版本管理平台、监控告警。

---

## 12-14. 真实项目情境题 + PDF 面试题 + 教师五连问

（Day 50 执行版补全要求）

**门禁考核评分标准**：
- 场景 1（Python 调试）：20 分
- 场景 2（合同版本）：20 分
- 场景 3（引用格式）：20 分
- 场景 4（Recall 评测）：20 分
- 场景 5（链路断裂）：20 分
- 总分 ≥ 70 分通过
- Python、合同、RAG 各模块 ≥ 60%（12 分）
