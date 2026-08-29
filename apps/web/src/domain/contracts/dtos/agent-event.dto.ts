import { z } from 'zod'
import { AgentEventSchema } from '../schemas/agent-event.schema'

export type AgentEventDto = z.infer<typeof AgentEventSchema> 