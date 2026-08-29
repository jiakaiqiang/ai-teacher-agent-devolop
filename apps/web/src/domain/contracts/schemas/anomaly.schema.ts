import { z } from 'zod'

export const AnomalySchema = z.object({
  id: z.string().regex(/^ano-[a-z0-9]+$/),
  serverId: z.string().regex(/^srv-[a-z0-9]+$/),
  metricName: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  detectedAt: z.string().datetime(),
  message: z.string(),
})