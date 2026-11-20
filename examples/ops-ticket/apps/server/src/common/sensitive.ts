// 敏感字段脱敏（D19）
// 规则集中在这里：哪些字段算敏感、怎么遮、日志里要擦掉什么

// 响应里叫这些名字的字段一律视为敏感，不管它出现在哪个接口、嵌套在第几层
const SENSITIVE_KEYS = new Set(['phone']);

// 13800000001 → 138****0001。保留前 3 位和后 4 位，够用户认出“是我的号码”，又不能拿去打电话
export function maskPhone(phone: string | null): string | null {
  if (phone === null) return null;
  if (phone.length < 7) return '*'.repeat(phone.length);
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

// 递归遍历响应数据，把所有敏感字段换成脱敏后的值。返回新对象，不修改原来的
export function maskSensitive<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitive(item)) as T;
  }
  if (value instanceof Date || value === null || typeof value !== 'object') {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    result[key] = SENSITIVE_KEYS.has(key) && (typeof field === 'string' || field === null)
      ? maskPhone(field)
      : maskSensitive(field);
  }
  return result as T;
}

// 写日志前擦掉文本里的敏感内容：手机号、Bearer 令牌、密码哈希
// 异常信息里可能带着请求参数（例如 Prisma 的校验错误会把整个查询参数打印出来）
export function redactForLog(text: string): string {
  return text
    .replace(/\b1\d{10}\b/g, (phone) => maskPhone(phone)!)
    .replace(/Bearer\s+[\w-]+\.[\w-]+\.[\w-]+/g, 'Bearer [已隐藏]')
    .replace(/scrypt\$[^\s"'`]+/g, 'scrypt$[已隐藏]');
}
