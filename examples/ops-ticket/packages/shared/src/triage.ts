import { z } from 'zod';

// 模型建议只描述工单，不携带操作者、班组或自动执行权限。
export const triageSuggestionSchema = z.object({
  intent: z.string().min(1).max(120),
  steps: z.array(z.string().min(1).max(400)).max(6),
  evidenceIds: z.array(z.string().min(1).max(120)).max(4),
  missingInformation: z.array(z.string().min(1).max(120)).max(5),
}).strict();
export type TriageSuggestion = z.infer<typeof triageSuggestionSchema>;
export interface TriageResult {
  suggestion: TriageSuggestion;
  mode: 'mock' | 'model';
  promptVersion: string;
  promptHash: string;
  validationAttempts: number;
}
