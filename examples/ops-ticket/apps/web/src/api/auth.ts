import { postJson } from './http'
import { sessionSchema, setSession } from './session'

// 登录成功后保存令牌和用户信息（D15）
export async function login(username: string, password: string): Promise<void> {
  setSession(await postJson('/api/auth/login', { username, password }, sessionSchema))
}

export function logout() {
  // 令牌是无状态的，后端不记录会话，退出只要前端丢掉令牌；令牌本身要到过期才失效
  setSession(null)
}
