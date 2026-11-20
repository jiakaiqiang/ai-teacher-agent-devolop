import { z } from 'zod'
import { ref } from 'vue'

// 登录状态（D15，替换 D13 的 current-user.ts）
// 令牌放在 sessionStorage：关掉标签页就失效，刷新页面还在。
// 代价：页面上任何脚本都能读到它，一旦有 XSS 就会被偷走。生产环境更常见的做法是
// 由后端写 HttpOnly Cookie（脚本读不到），代价是要处理 CSRF，见讲义 1.3
const STORAGE_KEY = 'ops-ticket.session'

export const sessionUserSchema = z.object({ username: z.string(), displayName: z.string(), role: z.string().optional() })
export const sessionSchema = z.object({ accessToken: z.string(), user: sessionUserSchema })
export type Session = z.infer<typeof sessionSchema>

// sessionStorage 在单元测试（Node 环境）里不存在，隐私模式下也可能不可用，读写都包在 try 里
function readStored(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const parsed = sessionSchema.safeParse(raw ? JSON.parse(raw) : null)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const session = ref<Session | null>(readStored())

export function setSession(value: Session | null) {
  session.value = value
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 存不下就只在本次打开的页面里生效
  }
}

// 任何请求收到 401 时调用：清掉登录状态，再交给页面决定怎么跳转（main.ts 里注册）
let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}
export function handleUnauthorized() {
  setSession(null)
  onUnauthorized()
}
