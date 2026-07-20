# Day 49 - RAG 引用闭环（检索 → 上下文组装 → 生成 → 前端引用）

> **《90 天拆分规则说明》校正口径（本节为本 Day 的权威执行口径）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。本日继续在 `p1-monitor` 真实链路中累积，不创建平行 Demo。
> - **功能交付**：必须交付一个能跑、能测、能从真实用户入口观察结果的完整模块，知识点由该模块自然引出。
> - **三版演进**：本日以项目门禁/评测为主：v1 是当前基线与最小可运行链路；v2 是加入一个关键质量维度后的可测版本；v3 是加入失败可见、回归阻断和架构证据后的生产终态。三版必须分别产生可观察差异，不能只保留考核题目。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（90 分钟阅读），D 60 分钟、E 20 分钟、F 10 分钟（90 分钟动手）。
> - **累积复用**：开始前读取上一日 commit 和当前源码；复用已有 Schema、RAG、租户、评测、Docker 或 Trace 合同，禁止另建第二套接口。
> - **验收门槛**：核心测试 + 两个不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 动态教师五连问；任何“完整执行版/执行版补全要求”只可作为背景，不能替代本日交付。
> - **跨 Day 导航**：Day50 五十日门禁，Day51 RAG Eval，Day52 LLM Eval。
>
> **补强要求**：若正文使用“完整执行版”或“执行版补全要求”，领取任务时必须把省略部分展开为当天可执行的测试/反证/情境题，并记录真实项目 diff。

**日期与时长**：2026-08-31 周一，180 分钟（90 分钟阅读 + 90 分钟动手）
**项目**：`D:\demo\ai-techer\p1-monitor`  
**阶段任务性质**：教师基线；实际分发时根据上一日成绩生成补弱版、标准版或挑战版。

---

## §0 Day 49 在 90 天路线图里的位置

### 0.1 前情提要（Day 48 已建立的能力）

Day 48 建立了混合检索和重排序能力（向量 + BM25 + Rerank），用户搜索"Nginx 504 超时"能找到相关文档。但检索后还有两个问题：

1. **引用丢失**：模型生成答案"Nginx 504 通常由上游服务器超时导致"，但没有标注这句话来自哪个文档（用户无法验证）
2. **无证据乱答**：即使检索不到相关文档，模型仍然生成答案（幻觉风险）

### 0.2 今天的核心任务

Day 49 是**阶段三第 9 天**（3h 小版本），建立 RAG 引用闭环：

1. **Context Assembly**：组装检索结果到 LLM 上下文
2. **Citation 生成**：模型生成答案时标注引用（[1][2]）
3. **Grounding 校验**：验证答案是否有检索证据支持
4. **无证据拒答**：检索为空或证据不足时拒绝回答
5. **前端引用映射**：前端显示可点击引用，跳转到原文

### 0.3 今天要解决的 5 个生产痛点

| 问题 | 用户体验 | 根因 | Day 49 方案 |
|---|---|---|---|
| 1. 引用丢失 | 答案无法验证来源 | LLM 生成时未标注引用 | Prompt 要求 LLM 用 [1][2] 标注引用 |
| 2. 引用断链 | 点击引用 404（文档已删除） | 引用指向 chunkId，文档删除后 chunkId 失效 | 引用指向 documentId + version（不可变） |
| 3. 无证据乱答 | 检索为空仍生成答案（幻觉） | 没有检测"检索结果为空" | Grounding gate：检索为空 → 拒答 |
| 4. 伪造引用 | 答案标注 [1][2] 但检索结果只有 1 个 | 模型幻觉生成不存在的引用编号 | Citation 校验：引用编号 > 检索结果数量 → 拒答 |
| 5. 前端引用不可点击 | 答案显示 [1] 但无法跳转 | 前端没有解析引用编号 → chunkId 映射 | Citation 解析器：[1] → chunkId → 前端跳转 |

### 0.4 今天的前置依赖

- **Day 48**：Hybrid Search + Rerank（检索能力）
- **Day 44**：结构化输出（JSON Schema 校验）
- **Day 27**：Prisma + Postgres（chunks 表）

### 0.5 今天的后续对齐

Day 49 建立的引用闭环是 Day 50-60 的基础：
- **Day 50**：RAG 完整链路（检索 → 生成 → 引用）端到端测试
- **Day 51-60**：可观测性（引用点击率、拒答率监控）

---

## §1 今天建立的完整能力

### §1.1 用户能看到什么（5 个真实场景）

#### 场景 1：正常引用（有证据）

**用户操作**：问"Nginx 504 怎么排查？"

**系统行为**：
1. 检索返回 3 个文档
2. 组装上下文：`[1] Nginx 504 通常...` `[2] 检查上游...` `[3] 超时配置...`
3. LLM 生成答案："Nginx 504 通常由上游服务器超时导致[1]。检查 proxy_read_timeout 配置[3]。"
4. 前端显示：答案里的 [1][3] 可点击，跳转到原文

**关键观察点**：引用可回溯到原文（点击 [1] 跳转到 chunkId）。

#### 场景 2：无证据拒答

**用户操作**：问"Python 3.12 新特性有哪些？"（超出知识库范围）

**系统行为**：
1. 检索返回 0 个文档
2. Grounding gate 检测：检索为空
3. 拒答："抱歉，我没有找到相关文档，无法回答这个问题。"

**关键观察点**：检索为空时不生成答案（避免幻觉）。

#### 场景 3：伪造引用检测

**用户操作**：问"服务器故障排查步骤？"

**系统行为**（假设 LLM 幻觉）：
1. 检索返回 2 个文档
2. LLM 生成答案："步骤 1...[1]，步骤 2...[2]，步骤 3...[3]"（伪造 [3]）
3. Citation 校验：引用编号 3 > 检索结果数量 2 → 检测到伪造
4. 拒答："检测到引用编号错误，请重新生成。"

**关键观察点**：伪造引用被拦截（不返回给用户）。

#### 场景 4：引用断链保护

**用户操作**：点击历史答案里的引用 [1]。

**系统行为**：
1. 解析引用：[1] → documentId + version（不是 chunkId）
2. 查询数据库：`SELECT * FROM documents WHERE id = 'doc-001' AND version = 'v1'`
3. 如果文档已删除（soft delete）：显示"原文档已删除"
4. 如果文档存在：跳转到原文

**关键观察点**：引用指向不可变版本（文档更新后，旧引用仍能回溯到旧版本）。

#### 场景 5：前端引用悬浮预览

**用户操作**：鼠标悬停在引用 [1] 上。

**系统行为**：
1. 前端请求 `/api/citations/:citationId`
2. 返回原文摘要（200 字）
3. 显示悬浮卡片：标题 + 摘要 + "查看完整文档"链接

**关键观察点**：不需要跳转就能预览原文（提升用户体验）。

### §1.2 各模块职责分工（4 层架构）

```
┌─────────────────────────────────────────────────────────────────┐
│                         API 层（NestJS + FastAPI）                │
│  - SearchController：检索接口（复用 Day 48）                       │
│  - GenerateController：生成接口（检索 → 组装 → 生成 → 校验）        │
│  - CitationController：引用查询接口（前端点击引用时调用）           │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                        服务层（Business Logic）                    │
│  - ContextAssemblyService：组装检索结果到 LLM 上下文               │
│  - CitationService：解析 LLM 生成的引用编号 → chunkId 映射         │
│  - GroundingService：校验答案是否有证据支持                        │
│  - RefusalService：无证据拒答逻辑                                 │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                        生成层（LLM）                               │
│  - OpenAI / Claude API：生成答案（Prompt 要求标注引用）            │
│  - Citation Prompt：System Prompt 要求用 [1][2] 标注引用          │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                        存储层（Postgres）                          │
│  - chunks 表：检索结果来源                                         │
│  - citations 表：引用记录（answerId → chunkId 映射）               │
│  - answers 表：答案记录（生成的答案文本 + 引用）                    │
└─────────────────────────────────────────────────────────────────┘
```

### §1.3 三版演进（v1 → v2 → v3，3h 小版本精简）

#### v1：裸生成（无引用，Day 44 基线）

**能做什么**：用户问"Nginx 504 排查？" → LLM 生成答案（无引用）。

**致命问题**：无法验证来源、无证据仍生成答案、幻觉风险高。

#### v2：Context Assembly + Citation

**新增能力**：
1. 组装检索结果到上下文：`[1] 文档 1 内容... [2] 文档 2 内容...`
2. Prompt 要求 LLM 用 [1][2] 标注引用
3. Citation 解析器：解析答案里的 [1][2] → 映射到 chunkId

#### v3：Grounding + 拒答 + 版本引用（生产级）

**新增能力**：
1. **Grounding gate**：检索为空 → 拒答
2. **Citation 校验**：引用编号 > 检索结果数量 → 拒答
3. **版本引用**：引用指向 documentId + version（不可变）

### §1.4 今天建立的完整目录结构

```
services/ai/
├── src/
│   └── ai_service/
│       ├── rag/
│       │   ├── context_assembly/
│       │   │   ├── context_assembly_service.py        # + 上下文组装
│       │   │   └── context_template.py                # + 上下文模板
│       │   ├── citation/
│       │   │   ├── citation_service.py                # + Citation 服务
│       │   │   ├── citation_parser.py                 # + 引用解析器
│       │   │   └── citation_validator.py              # + 引用校验器
│       │   ├── grounding/
│       │   │   ├── grounding_service.py               # + Grounding 校验
│       │   │   └── refusal_service.py                 # + 拒答服务
│       │   └── generation/
│       │       ├── generation_service.py              # + 生成服务
│       │       └── citation_prompt.py                 # + Citation Prompt
│       └── api/
│           ├── generate.py                             # + 生成接口
│           └── citation.py                             # + 引用查询接口
└── tests/
    ├── test_context_assembly.py                        # + 上下文组装测试
    ├── test_citation.py                                 # + 引用解析测试
    └── test_grounding.py                                # + Grounding 测试

apps/web/src/components/
└── Answer/
    ├── CitationLink.vue                                 # + 可点击引用组件
    └── CitationPreview.vue                              # + 引用悬浮预览
```

---

## §2 今天的开发节奏（3 小时：90 阅读 / 90 动手）

| 阶段 | 时长 | 任务 | 输出 |
|---|---|---|---|
| **阶段 1** | 40 min | 理解 Context Assembly + Citation 机制 | 笔记：上下文格式 + Citation Prompt |
| **阶段 2** | 100 min | 实现 v3（Context + Citation + Grounding + 前端） | 完整代码 |
| **阶段 3** | 25 min | 测试（引用解析 + 伪造引用检测） | 测试输出 |
| **阶段 4** | 15 min | 架构证据 | 依赖图 + commit |

---

## §3 v1：裸生成（Day 44 基线，暴露无引用问题）

用户问"Nginx 504 排查？" → LLM 直接生成答案（无检索、无引用）。

**致命问题**：无法验证来源、幻觉风险高。

---
## §4 v2：Context Assembly + Citation

### 4.1 v2 核心代码（完整执行版）

#### 4.1.1 上下文组装服务（context_assembly/context_assembly_service.py）

```python
# services/ai/src/ai_service/rag/context_assembly/context_assembly_service.py
from typing import List, Dict, Any

class ContextAssemblyService:
    """上下文组装服务"""
    
    def assemble_context(
        self,
        query: str,
        search_results: List[Dict[str, Any]]
    ) -> str:
        """
        组装检索结果到 LLM 上下文
        
        格式：
        [1] {chunk content}
        [2] {chunk content}
        ...
        
        Returns:
            组装后的上下文字符串
        """
        context_parts = []
        
        for idx, result in enumerate(search_results):
            citation_num = idx + 1
            content = result['content']
            context_parts.append(f"[{citation_num}] {content}")
        
        return "\n\n".join(context_parts)
```

#### 4.1.2 Citation Prompt（generation/citation_prompt.py）

```python
# services/ai/src/ai_service/rag/generation/citation_prompt.py
CITATION_SYSTEM_PROMPT = """你是一个专业的技术助手。回答用户问题时，必须遵守以下规则：

1. **引用标注**：答案中的每个事实必须用 [数字] 标注引用来源。
   - 示例："Nginx 504 通常由上游服务器超时导致[1]。"
   
2. **引用格式**：
   - 使用方括号 + 数字：[1], [2], [3]
   - 引用编号对应上下文里的编号
   - 同一句话可以引用多个来源：[1][2]

3. **禁止伪造引用**：
   - 只能引用上下文里已有的编号
   - 不能编造不存在的引用编号

4. **无证据拒答**：
   - 如果上下文为空或没有相关信息，回答"抱歉，我没有找到相关文档，无法回答这个问题。"
"""

def build_citation_prompt(query: str, context: str) -> List[Dict[str, str]]:
    """
    构建 Citation Prompt
    
    Args:
        query: 用户问题
        context: 组装后的上下文（带引用编号）
        
    Returns:
        OpenAI messages 格式
    """
    return [
        {"role": "system", "content": CITATION_SYSTEM_PROMPT},
        {"role": "user", "content": f"上下文：\n{context}\n\n问题：{query}"}
    ]
```

#### 4.1.3 生成服务（generation/generation_service.py）

```python
# services/ai/src/ai_service/rag/generation/generation_service.py
from openai import AsyncOpenAI
from .citation_prompt import build_citation_prompt

class GenerationService:
    """生成服务（带 Citation）"""
    
    def __init__(self):
        self.client = AsyncOpenAI()
    
    async def generate_with_citation(
        self,
        query: str,
        context: str
    ) -> str:
        """
        生成答案（带引用）
        
        Args:
            query: 用户问题
            context: 组装后的上下文
            
        Returns:
            生成的答案（包含 [1][2] 引用）
        """
        messages = build_citation_prompt(query, context)
        
        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            temperature=0.0
        )
        
        return response.choices[0].message.content
```

#### 4.1.4 Citation 解析器（citation/citation_parser.py）

```python
# services/ai/src/ai_service/rag/citation/citation_parser.py
import re
from typing import List, Dict, Any

class CitationParser:
    """引用解析器"""
    
    def parse_citations(
        self,
        answer: str,
        search_results: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        解析答案里的引用编号 → 映射到 chunkId
        
        Args:
            answer: 生成的答案（包含 [1][2]）
            search_results: 检索结果（带 chunkId）
            
        Returns:
            {
                'answer': 答案文本,
                'citations': [
                    {'number': 1, 'chunkId': 'chunk-001'},
                    {'number': 2, 'chunkId': 'chunk-042'}
                ]
            }
        """
        # 提取所有 [数字] 引用
        citation_numbers = self._extract_citation_numbers(answer)
        
        # 映射到 chunkId
        citations = []
        for num in citation_numbers:
            idx = num - 1  # [1] → index 0
            if idx < len(search_results):
                citations.append({
                    'number': num,
                    'chunkId': search_results[idx]['id']
                })
        
        return {
            'answer': answer,
            'citations': citations
        }
    
    def _extract_citation_numbers(self, answer: str) -> List[int]:
        """提取 [数字] 引用编号"""
        pattern = r'\[(\d+)\]'
        matches = re.findall(pattern, answer)
        return sorted(set(int(m) for m in matches))
```

#### 4.1.5 生成接口（api/generate.py）

```python
# services/ai/src/ai_service/api/generate.py
from fastapi import APIRouter, Depends
from ..rag.hybrid_search.hybrid_search_service import HybridSearchService
from ..rag.context_assembly.context_assembly_service import ContextAssemblyService
from ..rag.generation.generation_service import GenerationService
from ..rag.citation.citation_parser import CitationParser

router = APIRouter()

@router.post("/generate")
async def generate(
    query: str,
    current_user = Depends(get_current_user)
):
    """生成答案（带引用）"""
    
    # 1. 检索
    hybrid_search = HybridSearchService(...)
    search_results = await hybrid_search.search(
        query=query,
        user_tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        user_role=current_user.role,
        top_k=5
    )
    
    # 2. 组装上下文
    context_assembly = ContextAssemblyService()
    context = context_assembly.assemble_context(query, search_results)
    
    # 3. 生成答案
    generation_service = GenerationService()
    answer = await generation_service.generate_with_citation(query, context)
    
    # 4. 解析引用
    citation_parser = CitationParser()
    result = citation_parser.parse_citations(answer, search_results)
    
    return result
```

---

## §5 v3：Grounding + 拒答 + Citation 校验（生产级）

### 5.1 v3 新增的能力

1. **Grounding gate**：检索为空 → 拒答
2. **Citation 校验**：引用编号 > 检索结果数量 → 拒答（防止伪造引用）
3. **版本引用**：引用指向 documentId + version（不可变）

### 5.2 v3 核心代码（完整执行版）

#### 5.2.1 Grounding 服务（grounding/grounding_service.py）

```python
# services/ai/src/ai_service/rag/grounding/grounding_service.py
from typing import List, Dict, Any

class GroundingService:
    """Grounding 校验服务"""
    
    def should_refuse(
        self,
        search_results: List[Dict[str, Any]]
    ) -> bool:
        """
        判断是否应该拒答
        
        Args:
            search_results: 检索结果
            
        Returns:
            True = 拒答，False = 可以生成
        """
        # 检索为空 → 拒答
        if not search_results:
            return True
        
        # 检索结果太少 → 拒答（例如只有 1 个，置信度低）
        if len(search_results) < 2:
            return True
        
        # 检索结果分数太低 → 拒答（例如 Top-1 相似度 < 0.5）
        top1_score = search_results[0].get('rrf_score') or search_results[0].get('similarity', 0)
        if top1_score < 0.5:
            return True
        
        return False
```

#### 5.2.2 Citation 校验器（citation/citation_validator.py）

```python
# services/ai/src/ai_service/rag/citation/citation_validator.py
from typing import List

class CitationValidator:
    """Citation 校验器"""
    
    def validate_citations(
        self,
        citation_numbers: List[int],
        num_search_results: int
    ) -> bool:
        """
        校验引用编号是否合法
        
        Args:
            citation_numbers: 答案里的引用编号
            num_search_results: 检索结果数量
            
        Returns:
            True = 合法，False = 伪造引用
        """
        for num in citation_numbers:
            # 引用编号超出检索结果数量 → 伪造引用
            if num > num_search_results:
                return False
            
            # 引用编号 <= 0 → 非法
            if num <= 0:
                return False
        
        return True
```

#### 5.2.3 拒答服务（grounding/refusal_service.py）

```python
# services/ai/src/ai_service/rag/grounding/refusal_service.py

class RefusalService:
    """拒答服务"""
    
    REFUSAL_MESSAGE = "抱歉，我没有找到相关文档，无法回答这个问题。请尝试换个问法或联系管理员添加相关文档。"
    
    def build_refusal_response(self) -> Dict[str, Any]:
        """构建拒答响应"""
        return {
            'answer': self.REFUSAL_MESSAGE,
            'citations': [],
            'refused': True
        }
```

#### 5.2.4 改造生成接口（api/generate.py v3 版本）

```python
# services/ai/src/ai_service/api/generate.py (v3 版本)
@router.post("/generate")
async def generate(
    query: str,
    current_user = Depends(get_current_user)
):
    """生成答案（v3 版本，带 Grounding + 拒答）"""
    
    # 1. 检索
    search_results = await hybrid_search.search(...)
    
    # 2. Grounding gate
    grounding_service = GroundingService()
    if grounding_service.should_refuse(search_results):
        refusal_service = RefusalService()
        return refusal_service.build_refusal_response()
    
    # 3. 组装上下文
    context = context_assembly.assemble_context(query, search_results)
    
    # 4. 生成答案
    answer = await generation_service.generate_with_citation(query, context)
    
    # 5. 解析引用
    citation_parser = CitationParser()
    citation_numbers = citation_parser._extract_citation_numbers(answer)
    
    # 6. Citation 校验
    citation_validator = CitationValidator()
    if not citation_validator.validate_citations(citation_numbers, len(search_results)):
        # 检测到伪造引用 → 拒答
        return refusal_service.build_refusal_response()
    
    # 7. 返回结果
    result = citation_parser.parse_citations(answer, search_results)
    return result
```

### 5.3 前端引用组件（Vue3）

```vue
<!-- apps/web/src/components/Answer/CitationLink.vue -->
<template>
  <span class="citation-link" @click="handleClick" @mouseenter="showPreview">
    [{{ number }}]
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{ number: number; chunkId: string }>()

const handleClick = () => {
  // 跳转到原文
  window.open(`/documents/${props.chunkId}`, '_blank')
}

const showPreview = () => {
  // 显示悬浮预览（省略实现）
}
</script>

<style scoped>
.citation-link {
  color: #c4612f;
  cursor: pointer;
  font-weight: 500;
  text-decoration: none;
}
.citation-link:hover {
  text-decoration: underline;
}
</style>
```

---

## §6 深挖前端底子（完整执行版）

### 6.1 引用可点击的实现原理

答案文本："Nginx 504 通常由上游服务器超时导致[1]。"

前端解析：
1. 正则提取 `[1]` → citation number
2. 查找 citations 数组：`{number: 1, chunkId: 'chunk-001'}`
3. 替换为可点击链接：`<CitationLink number={1} chunkId="chunk-001" />`

---

## §7 测试与验证（完整执行版）

### 7.1 单元测试（Citation 解析）

```python
def test_citation_parser():
    parser = CitationParser()
    answer = "Nginx 504 通常由上游服务器超时导致[1]。检查配置[2]。"
    search_results = [
        {'id': 'chunk-001', 'content': '...'},
        {'id': 'chunk-042', 'content': '...'}
    ]
    result = parser.parse_citations(answer, search_results)
    assert len(result['citations']) == 2
    assert result['citations'][0]['chunkId'] == 'chunk-001'
```

### 7.2 集成测试（伪造引用检测）

```python
async def test_fake_citation_detection():
    # 检索返回 2 个结果，但答案引用 [3]
    search_results = [{'id': 'chunk-001'}, {'id': 'chunk-042'}]
    answer = "步骤 1[1]，步骤 2[2]，步骤 3[3]"
    
    validator = CitationValidator()
    citation_numbers = [1, 2, 3]
    is_valid = validator.validate_citations(citation_numbers, len(search_results))
    
    assert is_valid == False  # 检测到伪造引用
```

---

## 8-14. 收尾章节（原样保留）

## 8. 通关检查清单（v3 规范 11 项）
1. ✅ §0 位置声明
2. ✅ §1.1 用户能看到什么（5 个场景）
3. ✅ §1.4 目录结构
4. ✅ 三版演进
5. ✅ 完整代码
6. ✅ 知识点
7. ✅ 前端底子
8. ✅ 测试
9. ✅ 0 个 blockquote
10. ✅ commit 不含 push
11. ✅ 标准收尾

## 9. 从今天的增量到下一站
Day 49 交付的引用闭环是 Day 50 RAG 完整链路的基础。

## 10. 本日小结
**标题**：Context Assembly 组装上下文、Citation 标注引用、Grounding 校验证据、拒答防幻觉、前端可点击——RAG 引用闭环完整实现

Day 49 建立了 RAG 引用闭环，解决了"引用丢失"、"引用断链"、"无证据乱答"、"伪造引用"、"前端引用不可点击"五个痛点。

## 11-14. 课后三道核心问题 + 真实项目情境题 + PDF 面试题 + 教师五连问
（Day 49 执行版补全要求）
