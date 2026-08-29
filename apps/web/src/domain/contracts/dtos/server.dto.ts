import { z } from 'zod'
import { ServerSchema } from '../schemas/server.schema'

export type ServerDto = z.infer<typeof ServerSchema>