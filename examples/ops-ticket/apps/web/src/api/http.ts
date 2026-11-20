import { apiErrorSchema } from '@ops-ticket/shared'
import { z } from 'zod'
import { handleUnauthorized, session } from './session'

// 前端统一的请求错误：code 用来判断，message 用来展示
export class ApiError extends Error {
  // 前端开启了 erasableSyntaxOnly，不能用构造函数参数属性的写法，字段要单独声明
  readonly status: number
  retryAfterSeconds = 0
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const envelopeSchema = z.object({ data: z.unknown() })

// 所有请求都带上登录令牌（D15）
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = session.value?.accessToken
  return { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }
}

// 解析响应并按契约校验。后端返回的结构和 shared 里的 schema 对不上时，
// 在这里就报 CONTRACT_MISMATCH，而不是让页面拿着错误的数据渲染到一半出错
async function parseResponse<T extends z.ZodType>(response: Response, path: string, schema: T): Promise<z.infer<T>> {
  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body)
    // 未登录或令牌失效：清掉登录状态，回到登录页。登录接口本身的 401（密码错误）不算
    if (response.status === 401 && parsed.success && parsed.data.error.code === 'UNAUTHENTICATED') {
      handleUnauthorized()
    }
    if (parsed.success) {
      const failure = new ApiError(response.status, parsed.data.error.code, parsed.data.error.message)
      if (response.status === 429) failure.retryAfterSeconds = Number(response.headers?.get('Retry-After')) || 0
      throw failure
    }
    // 代理或网关返回的错误（例如后端没启动时的 502）没有统一结构
    throw new ApiError(response.status, 'HTTP_ERROR', `请求失败（HTTP ${response.status}）`)
  }

  // 先拆出 { data } 外壳，再按具体接口的 schema 校验 data
  const envelope = envelopeSchema.safeParse(body)
  const parsed = schema.safeParse(envelope.success ? envelope.data.data : undefined)
  if (!parsed.success) {
    // 开发时在控制台打印具体是哪个字段不符合契约
    console.error('接口响应不符合契约', path, parsed.error.issues)
    throw new ApiError(response.status, 'CONTRACT_MISMATCH', '接口返回的数据格式不正确')
  }
  return parsed.data
}

export async function getJson<T extends z.ZodType>(
  path: string,
  schema: T,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  const response = await fetch(path, { signal, headers: headers() })
  return parseResponse(response, path, schema)
}

export async function postJson<T extends z.ZodType>(path: string, body: unknown, schema: T, signal?: AbortSignal, extra:Record<string,string> = {}): Promise<z.infer<T>> {
  const response = await fetch(path, {
    method: 'POST', signal,
    headers: headers({ ...extra, 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  return parseResponse(response, path, schema)
}
