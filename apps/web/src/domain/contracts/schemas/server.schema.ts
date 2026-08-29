import  {z} from 'zod'

export const ServerSchema = z.object({
  id: z.string().regex(/^srv-[a-z0-9]+$/),  // 校验 id 格式
  name: z.string().min(1).max(100),
  ip: z.string(),
  status:z.enum(['online','offline','maintenance']),
  tags: z.array(z.string().min(1).max(50)).optional(),

})