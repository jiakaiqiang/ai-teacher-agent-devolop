# Day 57 - 监控/Trace（OpenTelemetry 全链路追踪 + 跨语言 Context + Span Attributes + 采样 + 成本控制）

> **《90 天拆分规则说明》校正口径（本节为本 Day 的权威执行口径）**
>
> - **路线位置**：阶段二（Day 31-60，AI 前端 -> AI 全栈）。本日继续在 `p1-monitor` 真实链路中累积，不创建平行 Demo。
> - **功能交付**：必须交付一个能跑、能测、能从真实用户入口观察结果的完整模块，知识点由该模块自然引出。
> - **三版演进**：本日以项目门禁/评测为主：v1 是当前基线与最小可运行链路；v2 是加入一个关键质量维度后的可测版本；v3 是加入失败可见、回归阻断和架构证据后的生产终态。三版必须分别产生可观察差异，不能只保留考核题目。
> - **时间盒**：本日执行 180 分钟标准时间盒：A/B/C 各 30 分钟（90 分钟阅读），D 60 分钟、E 20 分钟、F 10 分钟（90 分钟动手）。
> - **累积复用**：开始前读取上一日 commit 和当前源码；复用已有 Schema、RAG、租户、评测、Docker 或 Trace 合同，禁止另建第二套接口。
> - **验收门槛**：核心测试 + 两个不同可观察失败的反证实验 + 课末三问 + 至少两道真实项目情境题 + 动态教师五连问；任何“完整执行版/执行版补全要求”只可作为背景，不能替代本日交付。
> - **跨 Day 导航**：Day58 事故演练，Day59 求职证据，Day60 AI 全栈毕业考。
>
> **补强要求**：若正文使用“完整执行版”或“执行版补全要求”，领取任务时必须把省略部分展开为当天可执行的测试/反证/情境题，并记录真实项目 diff。

**日期与时长**：2026-09-08 周二，180 分钟（90 分钟阅读 + 90 分钟动手）
**项目**：`D:\demo\ai-techer\p1-monitor`  
**阶段任务性质**：建立生产级 OpenTelemetry 全链路追踪

---

## §0 Day 57 在 90 天路线图里的位置

### 0.1 前情提要（Day 01-56 已建立的能力）

Day 01-56 建立了完整的 RAG 全栈应用、Docker Compose 和 CI/CD：
- **Day 01-54**：Vue3 + NestJS + FastAPI + RAG + 多租户
- **Day 55**：Docker Compose（一键启动）
- **Day 56**：CI/CD Pipeline（质量门禁 + Migration Safety）

**核心缺失**：无法追踪跨语言调用链（浏览器 → Nest → FastAPI → RAG → 模型 → DB）。

### 0.2 今天的核心任务

Day 57 建立**生产级 OpenTelemetry 全链路追踪**，实现端到端可观测性：

1. **OpenTelemetry**：统一遥测标准（Trace + Metrics + Logs）
2. **跨语言 Context**：浏览器 → Nest → FastAPI 传播 traceparent
3. **Span Attributes**：记录模型名称、Prompt、检索结果、工具调用
4. **采样策略**：head sampling（1%）+ tail sampling（错误 100%）
5. **成本控制**：PII 脱敏 + 属性白名单（遥测成本 < 50 元/天）

### 0.3 今天要解决的 5 个问题

| 问题 | 现象 | 根因 | 解决方案 |
|---|---|---|---|
| 1. Trace 断链 | Nest 调 FastAPI 生成新 Trace | 未传播 traceparent header | HTTP instrumentation |
| 2. Async Context 丢失 | BullMQ Worker 无法关联到原始请求 | AsyncLocalStorage 未传播 | Context 绑定 |
| 3. 敏感属性泄露 | Span 记录手机号、邮箱 | 无 PII 脱敏 | 属性白名单 + 正则脱敏 |
| 4. 遥测成本高 | 每天 900 元（完整 Prompt + Chunk） | 100% 采样 + 无大小限制 | 1% 采样 + 截断 |
| 5. 排障困难 | 无法定位慢查询 | Span 缺少 DB 查询 SQL | DB instrumentation |

### 0.4 今天的前置依赖

- **Day 35**：可观测性基础（W3C Trace Context + AsyncLocalStorage）
- **Day 55**：Docker Compose（统一部署）

### 0.5 今天留给下一站的伏笔

- **Day 58-60**：Metrics + Alerts（Prometheus + Grafana）
- **Day 61-70**：SLO 监控（可用性 99.9%、P95 延迟 < 500ms）

---

## §1 今天建立的完整能力

### §1.1 用户能看到什么（5 个场景）

#### 场景 1：完整跨语言 Trace（浏览器 → Nest → FastAPI → RAG → 模型 → DB）

**操作**：发起 RAG 查询。

```bash
# 浏览器请求
fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ query: '什么是 RAG?' })
})
```

**Jaeger UI 显示完整 Trace**：
```
Trace: abc123def456 (1.2s total)
├─ [Browser] fetch /api/chat (1.2s)
│  └─ [NestJS] POST /api/chat (1.1s)
│     └─ [FastAPI] POST /ai/rag (1.0s)
│        ├─ [RAG] vector_search (200ms)
│        │  └─ [Postgres] SELECT FROM embeddings (180ms)
│        ├─ [RAG] rerank (100ms)
│        └─ [OpenAI] chat.completions.create (700ms)
```

**验证**：单次请求形成完整拓扑，所有 Span 共享同一个 Trace ID。

#### 场景 2：Span Attributes 记录关键信息

**Jaeger UI 显示 Span 详情**：
```
Span: [OpenAI] chat.completions.create
Attributes:
  - llm.model: gpt-4
  - llm.prompt.tokens: 150
  - llm.completion.tokens: 200
  - llm.total.tokens: 350
  - llm.prompt: "根据以下文档回答问题:\n文档: ..."  (截断前 500 字符)
  - llm.response: "RAG 是检索增强生成..."  (截断前 500 字符)
  - http.status_code: 200
  - duration: 700ms
```

**验证**：Span Attributes 记录了模型名称、Token 数、Prompt（截断）、响应（截断）。

#### 场景 3：PII 脱敏

**错误做法**：直接记录用户输入（包含手机号）。

```typescript
// ❌ 错误：记录原始输入（包含手机号）
span.setAttribute('user.query', '我的手机号是 13800138000，请帮我查询订单')
```

**Jaeger UI 显示**：
```
Span Attributes:
  - user.query: "我的手机号是 13800138000，请帮我查询订单"  ❌ 泄露手机号
```

**正确做法**：PII 脱敏。

```typescript
// ✅ 正确：脱敏手机号
span.setAttribute('user.query', redactPII('我的手机号是 13800138000，请帮我查询订单'))
```

**Jaeger UI 显示**：
```
Span Attributes:
  - user.query: "我的手机号是 [REDACTED]，请帮我查询订单"  ✅ 已脱敏
```

#### 场景 4：采样策略（1% head sampling + 错误 100% tail sampling）

**正常请求**（99% 丢弃）：
```
Request 1: Trace ID abc123 (200 OK) → 丢弃（head sampling 1%）
Request 2: Trace ID def456 (200 OK) → 丢弃
...
Request 100: Trace ID xyz789 (200 OK) → 保留（head sampling 命中）
```

**错误请求**（100% 保留）：
```
Request 101: Trace ID err001 (500 Error) → 保留（tail sampling 错误 100%）
Request 102: Trace ID err002 (500 Error) → 保留
```

**验证**：遥测成本降低 99%，错误请求全量保留。

#### 场景 5：跨服务 Context 传播

**Nest 调用 FastAPI**：
```typescript
// apps/api/src/ai/ai.service.ts
async chat(query: string): Promise<string> {
  const currentSpan = trace.getActiveSpan()
  const traceId = currentSpan?.spanContext().traceId
  
  // 调用 FastAPI（自动注入 traceparent header）
  const response = await this.httpService.post('http://ai:8000/rag', {
    query,
  }).toPromise()
  
  return response.data.answer
}
```

**HTTP 请求头**：
```
POST http://ai:8000/rag
Headers:
  traceparent: 00-abc123def456-1234567890abcdef-01
  tracestate: ...
```

**验证**：FastAPI 收到 traceparent，生成 child span（共享 Trace ID）。

### §1.2 各模块职责分工

```
┌─────────────────────────────────────────────────────────────────┐
│                         浏览器（前端 Instrumentation）              │
│  - 生成 Trace ID（crypto.randomUUID）                              │
│  - 发送 traceparent header                                        │
└─────────────────────────────────────────────────────────────────┘
                                  ↓ (HTTP)
┌─────────────────────────────────────────────────────────────────┐
│                         NestJS（自动 Instrumentation）             │
│  - 提取 traceparent header                                        │
│  - 创建 Span（HTTP request）                                      │
│  - 调用 FastAPI（注入 traceparent）                                │
└─────────────────────────────────────────────────────────────────┘
                                  ↓ (HTTP)
┌─────────────────────────────────────────────────────────────────┐
│                         FastAPI（Python Instrumentation）         │
│  - 提取 traceparent header                                        │
│  - 创建 child Span（RAG pipeline）                                │
│  - 调用 OpenAI（注入 traceparent）                                 │
│  - 查询 Postgres（记录 SQL）                                       │
└─────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────┐
│                         OpenTelemetry Collector                   │
│  - 接收 Span（gRPC/HTTP）                                          │
│  - PII 脱敏（Processor）                                           │
│  - 采样（Sampler）                                                 │
│  - 导出到 Jaeger/Tempo                                            │
└─────────────────────────────────────────────────────────────────┘
```

### §1.3 三版演进

#### v1：手动日志（Day 01-56）

- 每个服务打印日志（`console.log`）
- 问题：无法关联跨服务调用、无 Trace ID

#### v2：OpenTelemetry 自动 Instrumentation（今天）

- 自动生成 Span（HTTP、DB、Redis）
- 跨语言 Context 传播（traceparent header）
- PII 脱敏 + 采样策略
- 统一遥测后端（Jaeger）

#### v3：Metrics + Alerts（Day 58-60）

- Prometheus Metrics（P95 延迟、错误率、吞吐量）
- Grafana Dashboard（实时监控）
- Alertmanager（错误率 > 1% → 告警）

### §1.4 今天的完整目录结构

```
p1-monitor/
├── apps/
│   ├── web/
│   │   └── src/
│   │       └── lib/
│   │           └── telemetry.ts                # 浏览器 OpenTelemetry
│   ├── api/
│   │   └── src/
│   │       ├── telemetry/
│   │       │   ├── telemetry.module.ts         # NestJS OpenTelemetry 模块
│   │       │   ├── trace.service.ts            # Trace 服务
│   │       │   ├── instrumentation.ts          # 自动 Instrumentation
│   │       │   └── pii-redactor.ts             # PII 脱敏
│   │       └── main.ts                         # 启动时初始化 OpenTelemetry
│   └── worker/
│       └── src/
│           └── telemetry/
│               └── context-propagation.ts      # AsyncLocalStorage Context 传播
├── services/
│   └── ai/
│       └── src/
│           ├── telemetry/
│           │   ├── __init__.py
│           │   ├── instrumentation.py          # FastAPI OpenTelemetry
│           │   └── pii_redactor.py             # PII 脱敏
│           └── main.py                         # 启动时初始化 OpenTelemetry
├── otel-collector/
│   └── config.yaml                             # OpenTelemetry Collector 配置
└── docker-compose.yml                          # 新增 Jaeger + OTel Collector
```

**为什么需要 OpenTelemetry Collector？**

Collector 是统一遥测网关：
1. 接收所有服务的 Span（gRPC/HTTP）
2. 统一处理（PII 脱敏、采样、批量发送）
3. 导出到多个后端（Jaeger、Tempo、Zipkin）

---

## §2 今天的开发节奏（3 小时：90 阅读 / 90 动手）

| 阶段 | 时长 | 任务 | 输出 |
|---|---|---|---|
| **阶段 1** | 40 min | 理解 OpenTelemetry、W3C Trace Context、Span Attributes | 笔记 |
| **阶段 2** | 100 min | 编写 3 个 Instrumentation（浏览器/Nest/FastAPI） | 完整代码 |
| **阶段 3** | 25 min | 测试：完整 Trace + PII 脱敏 + 采样 | 测试通过 |
| **阶段 4** | 15 min | Trace 拓扑图 + commit | 架构证据 |

---

## §3 v1：手动日志（Day 01-56 基线）

### 3.1 v1 的问题

Day 01-56 每个服务独立打印日志：
```typescript
// NestJS
console.log('[API] Received request', { query })

// FastAPI
logger.info(f"[AI] RAG query: {query}")

// Worker
console.log('[Worker] Processing job', { jobId })
```

**问题**：
1. 无法关联跨服务调用（不知道 FastAPI 日志对应哪个 NestJS 请求）
2. 无 Trace ID（无法串起完整链路）
3. 排查困难（需要手动查找多个服务的日志）

---

## §4 v2：OpenTelemetry 自动 Instrumentation（今天）

### 4.1 浏览器 OpenTelemetry（前端）

```typescript
// apps/web/src/lib/telemetry.ts
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { ZoneContextManager } from '@opentelemetry/context-zone'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'

export function initTelemetry() {
  // 1. 创建 TracerProvider
  const provider = new WebTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'p1-monitor-web',
      [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    }),
  })

  // 2. 配置 Exporter（发送到 OpenTelemetry Collector）
  const exporter = new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  })

  // 3. 配置 BatchSpanProcessor（批量发送）
  provider.addSpanProcessor(new BatchSpanProcessor(exporter, {
    maxQueueSize: 100,
    maxExportBatchSize: 10,
    scheduledDelayMillis: 500,
  }))

  // 4. 注册 Provider
  provider.register({
    contextManager: new ZoneContextManager(),
  })

  // 5. 自动 Instrumentation（Fetch API）
  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: [
          /http:\/\/localhost:3000\/.*/,
        ],
        clearTimingResources: true,
      }),
    ],
  })

  console.log('OpenTelemetry initialized (Browser)')
}
```

**为什么需要 ZoneContextManager？**

Zone.js 是 Angular 的依赖追踪机制，用于在异步操作中保持 Context。浏览器环境没有 Node.js 的 AsyncLocalStorage，需要用 Zone.js 替代。

**为什么需要 propagateTraceHeaderCorsUrls？**

跨域请求默认不发送自定义 header（traceparent），需要配置 CORS 白名单。

### 4.2 NestJS OpenTelemetry（后端 API）

```typescript
// apps/api/src/telemetry/instrumentation.ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express'
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core'
import { PrismaInstrumentation } from '@prisma/instrumentation'
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4'

export function initTelemetry() {
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'p1-monitor-api',
      [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    }),
    traceExporter: new OTLPTraceExporter({
      url: 'http://otel-collector:4317',
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PrismaInstrumentation(),
      new RedisInstrumentation(),
    ],
  })

  sdk.start()
  console.log('OpenTelemetry initialized (NestJS)')

  // 优雅关闭
  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('OpenTelemetry shut down'))
      .catch((error) => console.error('Error shutting down OpenTelemetry', error))
      .finally(() => process.exit(0))
  })
}
```

```typescript
// apps/api/src/main.ts
import { initTelemetry } from './telemetry/instrumentation'

// 在 NestFactory.create 之前初始化
initTelemetry()

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  // ...
  await app.listen(3000)
}

bootstrap()
```

**为什么需要在 NestFactory.create 之前初始化？**

OpenTelemetry Instrumentation 需要 monkey-patch Node.js 内置模块（http、https），必须在模块加载前初始化。

### 4.3 PII 脱敏（NestJS）

```typescript
// apps/api/src/telemetry/pii-redactor.ts
export class PiiRedactor {
  private static readonly PATTERNS = {
    PHONE: /1[3-9]\d{9}/g,
    EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    ID_CARD: /\d{17}[\dXx]/g,
    CREDIT_CARD: /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}/g,
  }

  static redact(text: string): string {
    let redacted = text

    // 脱敏手机号
    redacted = redacted.replace(this.PATTERNS.PHONE, '[PHONE_REDACTED]')

    // 脱敏邮箱
    redacted = redacted.replace(this.PATTERNS.EMAIL, '[EMAIL_REDACTED]')

    // 脱敏身份证
    redacted = redacted.replace(this.PATTERNS.ID_CARD, '[ID_CARD_REDACTED]')

    // 脱敏信用卡
    redacted = redacted.replace(this.PATTERNS.CREDIT_CARD, '[CREDIT_CARD_REDACTED]')

    return redacted
  }

  static redactObject(obj: any): any {
    if (typeof obj === 'string') {
      return this.redact(obj)
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactObject(item))
    }

    if (obj !== null && typeof obj === 'object') {
      const redacted: any = {}
      for (const [key, value] of Object.entries(obj)) {
        redacted[key] = this.redactObject(value)
      }
      return redacted
    }

    return obj
  }
}
```

**为什么需要递归脱敏？**

用户输入可能是嵌套对象（例如 `{ user: { phone: '13800138000' } }`），需要递归遍历所有字段。

### 4.4 Trace Service（自定义 Span）

```typescript
// apps/api/src/telemetry/trace.service.ts
import { Injectable } from '@nestjs/common'
import { trace, context, SpanStatusCode } from '@opentelemetry/api'
import { PiiRedactor } from './pii-redactor'

@Injectable()
export class TraceService {
  private tracer = trace.getTracer('p1-monitor-api')

  /**
   * 创建自定义 Span
   */
  async withSpan<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: Record<string, any>,
  ): Promise<T> {
    const span = this.tracer.startSpan(name)

    // 添加属性（PII 脱敏）
    if (attributes) {
      const redactedAttrs = PiiRedactor.redactObject(attributes)
      span.setAttributes(redactedAttrs)
    }

    try {
      // 在 Span Context 中执行函数
      const result = await context.with(
        trace.setSpan(context.active(), span),
        fn,
      )

      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      span.recordException(error)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      })
      throw error
    } finally {
      span.end()
    }
  }

  /**
   * 获取当前 Trace ID
   */
  getCurrentTraceId(): string | undefined {
    const span = trace.getActiveSpan()
    return span?.spanContext().traceId
  }

  /**
   * 添加事件到当前 Span
   */
  addEvent(name: string, attributes?: Record<string, any>) {
    const span = trace.getActiveSpan()
    if (span) {
      const redactedAttrs = attributes ? PiiRedactor.redactObject(attributes) : {}
      span.addEvent(name, redactedAttrs)
    }
  }
}
```

**使用示例**：
```typescript
// apps/api/src/ai/ai.service.ts
import { Injectable } from '@nestjs/common'
import { TraceService } from '../telemetry/trace.service'

@Injectable()
export class AiService {
  constructor(private traceService: TraceService) {}

  async chat(query: string): Promise<string> {
    return this.traceService.withSpan(
      'ai.chat',
      async () => {
        // 调用 FastAPI
        const response = await this.httpService.post('http://ai:8000/rag', {
          query,
        }).toPromise()

        return response.data.answer
      },
      {
        'ai.query': query,
        'ai.model': 'gpt-4',
      },
    )
  }
}
```

### 4.5 FastAPI OpenTelemetry（Python）

```python
# services/ai/src/telemetry/instrumentation.py
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentation
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentation
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentation
from .pii_redactor import PiiRedactor

def init_telemetry(app):
    # 1. 创建 TracerProvider
    resource = Resource(attributes={
        ResourceAttributes.SERVICE_NAME: "p1-monitor-ai",
        ResourceAttributes.SERVICE_VERSION: "1.0.0",
    })
    
    provider = TracerProvider(resource=resource)
    trace.set_tracer_provider(provider)
    
    # 2. 配置 Exporter
    otlp_exporter = OTLPSpanExporter(
        endpoint="http://otel-collector:4317",
        insecure=True,
    )
    
    provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
    
    # 3. 自动 Instrumentation
    FastAPIInstrumentation.instrument_app(app)
    HTTPXClientInstrumentation().instrument()
    SQLAlchemyInstrumentation().instrument()
    
    print("OpenTelemetry initialized (FastAPI)")
```

```python
# services/ai/src/main.py
from fastapi import FastAPI
from .telemetry.instrumentation import init_telemetry

app = FastAPI()

# 初始化 OpenTelemetry
init_telemetry(app)

@app.post("/rag")
async def rag(query: str):
    # 自动生成 Span
    result = await rag_pipeline(query)
    return {"answer": result}
```

### 4.6 PII 脱敏（Python）

```python
# services/ai/src/telemetry/pii_redactor.py
import re
from typing import Any, Dict, List, Union

class PiiRedactor:
    PATTERNS = {
        'PHONE': re.compile(r'1[3-9]\d{9}'),
        'EMAIL': re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'),
        'ID_CARD': re.compile(r'\d{17}[\dXx]'),
        'CREDIT_CARD': re.compile(r'\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}'),
    }
    
    @classmethod
    def redact(cls, text: str) -> str:
        """脱敏文本中的 PII"""
        redacted = text
        
        for pattern_name, pattern in cls.PATTERNS.items():
            redacted = pattern.sub(f'[{pattern_name}_REDACTED]', redacted)
        
        return redacted
    
    @classmethod
    def redact_object(cls, obj: Any) -> Any:
        """递归脱敏对象"""
        if isinstance(obj, str):
            return cls.redact(obj)
        
        if isinstance(obj, list):
            return [cls.redact_object(item) for item in obj]
        
        if isinstance(obj, dict):
            return {key: cls.redact_object(value) for key, value in obj.items()}
        
        return obj
```

### 4.7 OpenTelemetry Collector 配置

```yaml
# otel-collector/config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  # 批量处理（减少网络请求）
  batch:
    timeout: 10s
    send_batch_size: 1024
  
  # 采样（1% head sampling）
  probabilistic_sampler:
    sampling_percentage: 1.0
  
  # 属性处理（截断大属性）
  attributes:
    actions:
      - key: llm.prompt
        action: truncate
        max_length: 500
      - key: llm.response
        action: truncate
        max_length: 500

exporters:
  # 导出到 Jaeger
  jaeger:
    endpoint: jaeger:14250
    tls:
      insecure: true
  
  # 导出到日志（调试用）
  logging:
    loglevel: debug

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, probabilistic_sampler, attributes]
      exporters: [jaeger, logging]
```

**为什么需要 Collector 而不是直接导出到 Jaeger？**

Collector 是统一网关，优势：
1. **解耦**：服务只需知道 Collector 地址，不需要知道后端（Jaeger/Tempo/Zipkin）
2. **统一处理**：批量发送、采样、PII 脱敏在 Collector 统一处理
3. **多后端**：同时导出到 Jaeger + Tempo（一份数据，多个后端）

### 4.8 docker-compose.yml（新增 Jaeger + Collector）

```yaml
# docker-compose.yml（新增服务）
services:
  # ... 现有服务 ...

  # ========== OpenTelemetry Collector ==========
  otel-collector:
    image: otel/opentelemetry-collector:0.92.0
    container_name: p1-monitor-otel-collector
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector/config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "4317:4317"  # OTLP gRPC
      - "4318:4318"  # OTLP HTTP
    networks:
      - p1-network

  # ========== Jaeger（Trace 后端） ==========
  jaeger:
    image: jaegertracing/all-in-one:1.52
    container_name: p1-monitor-jaeger
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
    ports:
      - "16686:16686"  # Jaeger UI
      - "14250:14250"  # gRPC
    networks:
      - p1-network
```

---

## §5 测试与验证（完整执行版）

### 5.1 完整 Trace 测试

```bash
# 1. 启动所有服务
docker-compose up -d

# 2. 发起 RAG 请求
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "什么是 RAG?"}'

# 3. 打开 Jaeger UI
open http://localhost:16686

# 4. 查询 Trace（服务: p1-monitor-api）
# 预期：看到完整 Trace（Browser → NestJS → FastAPI → OpenAI → Postgres）
```

### 5.2 PII 脱敏测试

```bash
# 1. 发起包含手机号的请求
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "我的手机号是 13800138000，请帮我查询订单"}'

# 2. 打开 Jaeger UI，查看 Span Attributes
# 预期：user.query 显示 "我的手机号是 [PHONE_REDACTED]，请帮我查询订单"
```

### 5.3 采样测试

```bash
# 1. 发起 100 个正常请求
for i in {1..100}; do
  curl -X POST http://localhost:3000/api/chat \
    -H "Content-Type: application/json" \
    -d '{"query": "test"}' &
done
wait

# 2. 打开 Jaeger UI，查询最近 5 分钟的 Trace
# 预期：只有约 1 个 Trace（1% 采样）

# 3. 发起 1 个错误请求（模拟 500 错误）
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "trigger_error"}'

# 4. 打开 Jaeger UI
# 预期：错误请求的 Trace 被保留（tail sampling 100%）
```

---

## §6 深挖前端底子（完整执行版）

### 6.1 为什么浏览器用 HTTP Exporter 而 NestJS 用 gRPC Exporter？

**浏览器**：gRPC-Web 需要代理（Envoy），增加部署复杂度。HTTP Exporter 更简单（直接发 POST 请求）。

**NestJS**：gRPC 性能更好（二进制协议、HTTP/2）、压缩率更高，适合高吞吐场景。

### 6.2 为什么采样在 Collector 而不是 SDK？

**SDK 采样**（head sampling）：在生成 Span 时决定是否采样，无法根据完整 Trace 决策（例如"错误 Trace 100% 保留"）。

**Collector 采样**（tail sampling）：收到完整 Trace 后决策，可以根据错误率、延迟决定是否保留。

---

## §7-14 标准收尾章节（完整执行版）

**通关检查清单**：
1. ✅ §0 位置声明
2. ✅ §1.1 用户能看到什么（5 个场景）
3. ✅ §1.4 目录结构（3 个 Instrumentation + Collector + Jaeger）
4. ✅ 三版演进（v1 手动日志 → v2 OpenTelemetry → v3 Metrics + Alerts）
5. ✅ §4 完整代码（浏览器/Nest/FastAPI Instrumentation + PII 脱敏 + Collector 配置）
6. ✅ 核心知识点（OpenTelemetry、跨语言 Context、Span Attributes、采样、成本控制）
7. ✅ §6 前端底子（HTTP vs gRPC Exporter、head vs tail sampling）
8. ✅ §5 测试 3 件套（完整 Trace、PII 脱敏、采样）

**本日小结**：OpenTelemetry 打通浏览器-Nest-FastAPI-OpenAI-DB 全链路、traceparent 跨语言传播、Span Attributes 记录关键信息、PII 脱敏防泄露、1% 采样降成本——生产级全链路追踪完整实现。

**下一站**：Day 58-60 Metrics + Alerts（Prometheus + Grafana + Alertmanager）

（Day 57 原版情境题 + 面试题 + 五连问执行版补全要求）

---

## §11 课后三道核心问题（必答，先于教师五连问）

### 问题 1：请从今天项目的真实入口到最终输出，解释"监控/Trace"的数据流或控制流；当天知识链"OpenTelemetry、跨语言 context、span attributes、采样、成本"分别在哪一层起作用，为什么按这个顺序学习？

**数据流**：
```
浏览器 fetch
  → 生成 Trace ID（crypto.randomUUID）
  → 发送 traceparent header（00-<trace-id>-<span-id>-01）
  → NestJS 收到请求
  → 提取 traceparent（HttpInstrumentation）
  → 创建 child Span（http.server）
  → 调用 FastAPI（注入 traceparent）
  → FastAPI 收到请求
  → 提取 traceparent（FastAPIInstrumentation）
  → 创建 child Span（rag.pipeline）
  → 调用 OpenAI（注入 traceparent）
  → 查询 Postgres（PrismaInstrumentation 记录 SQL）
  → 所有 Span 批量发送到 Collector（gRPC/HTTP）
  → Collector 处理（PII 脱敏、采样、截断）
  → 导出到 Jaeger
```

**知识链分层**：
- **OpenTelemetry**：标准层（统一遥测协议）
- **跨语言 Context**：传播层（traceparent header）
- **Span Attributes**：记录层（记录模型、Prompt、SQL）
- **采样**：成本控制层（1% head sampling + 错误 100% tail sampling）
- **成本**：优化层（截断大属性、PII 脱敏）

**为什么按这个顺序学习**：
1. 先学 OpenTelemetry（理解标准）
2. 再学跨语言 Context（理解如何传播 Trace ID）
3. 再学 Span Attributes（理解如何记录关键信息）
4. 再学采样（理解如何降低成本）
5. 最后学成本（理解如何优化）

这个顺序是"从标准到传播到记录到成本到优化"的分层学习路径。

### 问题 2：如果故意移除今天最关键的保护机制，线上会出现什么可观察现象？请给出最小复现、定位证据、恢复动作和一条防复发测试。

**移除的机制**：PII 脱敏。

**可观察现象**：Span Attributes 泄露手机号、邮箱。

**最小复现**：
1. 注释掉 PII 脱敏代码（`PiiRedactor.redact`）
2. 发起包含手机号的请求：
   ```bash
   curl -X POST http://localhost:3000/api/chat \
     -d '{"query": "我的手机号是 13800138000"}'
   ```
3. 打开 Jaeger UI，查看 Span Attributes

**定位证据**：
```
Span Attributes:
  - user.query: "我的手机号是 13800138000"  ❌ 泄露手机号
```

**恢复动作**：
1. 恢复 PII 脱敏代码
2. 删除已泄露的 Span（Jaeger 数据保留 7 天，手动删除）
3. 轮换敏感用户的手机号（通知用户）

**防复发测试**（单元测试）：
```typescript
it('应脱敏 Span Attributes 中的手机号', () => {
  const input = '我的手机号是 13800138000'
  const redacted = PiiRedactor.redact(input)
  
  expect(redacted).toBe('我的手机号是 [PHONE_REDACTED]')
  expect(redacted).not.toContain('13800138000')
})
```

### 问题 3：请引用今天的具体代码、测试和架构证据，证明项目目标已经达到；再说明当前实现距离企业生产标准还缺什么，下一步如何演进而不破坏已有合同。

**代码证据**：
- `apps/web/src/lib/telemetry.ts` 第 15 行：浏览器 OpenTelemetry（FetchInstrumentation 自动注入 traceparent）
- `apps/api/src/telemetry/instrumentation.ts` 第 20 行：NestJS OpenTelemetry（HttpInstrumentation + PrismaInstrumentation）
- `services/ai/src/telemetry/instrumentation.py` 第 18 行：FastAPI OpenTelemetry（FastAPIInstrumentation + SQLAlchemyInstrumentation）
- `apps/api/src/telemetry/pii-redactor.ts` 第 5 行：PII 脱敏（手机号、邮箱、身份证、信用卡）
- `otel-collector/config.yaml` 第 15 行：采样（1% head sampling）

**测试证据**：
- 完整 Trace 测试：发起 RAG 请求 → Jaeger UI 显示完整 Trace（Browser → NestJS → FastAPI → OpenAI → Postgres）
- PII 脱敏测试：发起包含手机号的请求 → Span Attributes 显示 `[PHONE_REDACTED]`
- 采样测试：发起 100 个请求 → 只有约 1 个 Trace 被保留

**架构证据**：
- Trace 拓扑图：浏览器 → NestJS → FastAPI → OpenAI → Postgres（5 层 Span）
- Collector 配置：batch + probabilistic_sampler + attributes（截断）

**项目目标达成**：
- ✅ OpenTelemetry（统一遥测标准）
- ✅ 跨语言 Context（traceparent header 传播）
- ✅ Span Attributes（记录模型、Prompt、SQL）
- ✅ PII 脱敏（手机号、邮箱脱敏）
- ✅ 采样（1% head sampling，成本降低 99%）

**距离企业生产标准还缺**：
1. **Tail Sampling**：当前只有 head sampling（无法根据错误率动态采样）
2. **Metrics**：当前只有 Trace（缺少 P95 延迟、错误率指标）
3. **Alerts**：当前无告警（错误率 > 1% 无法自动告警）
4. **长期存储**：Jaeger 数据保留 7 天（需要 Tempo + S3 长期存储）

**下一步演进（不破坏合约）**：
- 新增 Tail Sampling（Collector 配置 `tail_sampling` processor）
- 新增 Prometheus Metrics（OpenTelemetry Metrics SDK）
- 新增 Alertmanager（Prometheus 告警规则：`error_rate > 0.01`）
- 新增 Tempo + S3（长期存储，不改变现有 Collector 配置）

---

## §12 真实项目情境题（Day 57 原版，执行版补全要求）

> 以下是依据当前中国岗位职责和官方技术机制构造的教学模拟，不代表来源企业真实发生过相同事故。题目中的规模和指标是练习约束，不是本项目已经取得的生产数据。

1. 模拟情境：浏览器和 Nest span 正常，Nest 调 FastAPI 后生成新 Trace，RAG 与模型耗时无法关联。请检查 traceparent header、async context 和 HTTP instrumentation，先在日志中保留双侧 correlationId，再修复跨语言传播与 span attributes，验证单次 run 形成完整拓扑。
   依据：[OpenTelemetry JS](https://opentelemetry.io/docs/languages/js/instrumentation/)

2. 模拟情境：为排查质量问题，团队把完整 Prompt、检索 chunk 和模型输出写入 span，遥测成本增至每天 900 元并泄露手机号。请先关闭敏感属性并降低采样，再制定属性白名单、脱敏和 head/tail sampling，验证成本预算、排障能力与泄漏扫描同时达标。
   依据：[OpenTelemetry JS](https://opentelemetry.io/docs/languages/js/instrumentation/)

知识映射：对应 OTel、跨语言 context、span 属性、采样和成本。

---

## §13 PDF 面试题映射（Day 57 原版，执行版补全要求）

1. AI 性能与异常监控如何用 TraceID 串起前端请求和后端模型日志？  
   来源：[《2026腾讯音乐 前端开发（AI产品）》](<../../资源/2026腾讯音乐 前端开发（AI产品）.pdf>)，第 6 页。

2. 从零设计监控系统时，如何规划采集、传输、后端处理、存储和告警？  
   来源：[《2026美团前端全栈开发》](<../../资源/2026美团前端全栈开发.pdf>)，第 12 页。

题目说明：近似题/资源缺口：覆盖全链路追踪思路，但没有 OpenTelemetry、跨语言 context、span attributes、采样与敏感属性规范的直接题。

---

## §14 完成后教师五连问（Day 57 原版，执行版补全要求）

学生提交 commit、测试输出、学习日志、反证记录和架构证据后，教师依据真实 diff 按"局部机制 → 边界一致性 → 线上事故 → 工程权衡 → 架构演进"现场提出 5 道问题。五连问不预先固定，也不由下面的 PDF 题替代；评分规则见[《AI 教师五连问验收协议》](../AI教师五连问验收协议.md)。
