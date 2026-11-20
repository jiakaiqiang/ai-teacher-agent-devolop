import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getJson, postJson } from './http'
import { session, setSession, setUnauthorizedHandler } from './session'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const bob = { accessToken: 'token-of-bob', user: { username: 'bob', displayName: '李四' } }

afterEach(() => {
  vi.unstubAllGlobals()
  setSession(null)
  setUnauthorizedHandler(() => {})
})

describe('请求层的登录令牌（D15）', () => {
  it('登录后每个请求都带 Authorization；没登录时不带', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(200, { data: { ok: true } })))
    vi.stubGlobal('fetch', fetchMock)
    const schema = z.object({ ok: z.boolean() })

    await getJson('/api/a', schema)
    setSession(bob)
    await getJson('/api/b', schema)
    await postJson('/api/c', {}, schema)

    const auth = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>)
    expect(auth.map((h) => h.Authorization)).toEqual([undefined, 'Bearer token-of-bob', 'Bearer token-of-bob'])
  })

  it('令牌失效（401 UNAUTHENTICATED）时清掉登录状态并通知页面；密码错误的 401 不算', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    setSession(bob)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(401, { error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } }))
        .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录' } })),
    )
    const schema = z.unknown()

    await expect(postJson('/api/auth/login', {}, schema)).rejects.toBeInstanceOf(ApiError)
    expect(session.value).not.toBeNull()
    expect(onUnauthorized).not.toHaveBeenCalled()

    await expect(getJson('/api/tickets', schema)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(session.value).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
