import { z } from 'zod';

// 后端统一的响应外壳：成功是 { data }，失败是 { error }（D1 的拦截器和异常过滤器）
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export function successSchema<T extends z.ZodType>(data: T) {
  return z.object({ data });
}
