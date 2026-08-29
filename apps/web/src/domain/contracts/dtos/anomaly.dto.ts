import { z } from 'zod'
import { AnomalySchema } from '../schemas/anomaly.schema'

export type AnomalyDto = z.infer<typeof AnomalySchema>