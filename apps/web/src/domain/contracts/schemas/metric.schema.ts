import z from 'zod'

export const MetricSchema = z.object({
    id: z.string().regex(/^met-[a-z0-9]+$/),  // 校验 id 格式
    serverId: z.string().regex(/^srv-[a-z0-9]+$/),  // 校验 serverId 格式
    name: z.string().min(1).max(100),
    value: z.number(),
    unit:z.enum(['percent','bytes','count','ms']),
    timestamp:z.string().datetime()
})