import { z } from 'zod';
import { triageSuggestionSchema, type TriageSuggestion } from '@ops-ticket/shared';
import { GatewayFailure } from './model-policy.js';

export const triageResponseFormat = {
  type: 'json_schema',
  json_schema: { name: 'ticket_triage', strict: true, schema: z.toJSONSchema(triageSuggestionSchema) },
};
const envelope = z.object({ choices: z.array(z.object({
  index: z.literal(0), finish_reason: z.string(),
  message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
})).length(1) });
export function parseTriageOutput(raw: unknown): TriageSuggestion {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) throw new GatewayFailure('MODEL_PROTOCOL_ERROR');
  const choice = parsed.data.choices[0]!;
  if (choice.message.refusal) throw new GatewayFailure('MODEL_REFUSED');
  if (choice.finish_reason === 'length') throw new GatewayFailure('MODEL_TRUNCATED');
  if (choice.finish_reason !== 'stop' || choice.message.content === null) throw new GatewayFailure('MODEL_PROTOCOL_ERROR');
  let value: unknown;
  try { value = JSON.parse(choice.message.content) as unknown; }
  catch { throw new GatewayFailure('MODEL_INVALID_OUTPUT'); }
  const result = triageSuggestionSchema.safeParse(value);
  if (!result.success) throw new GatewayFailure('MODEL_INVALID_OUTPUT');
  return result.data;
}
