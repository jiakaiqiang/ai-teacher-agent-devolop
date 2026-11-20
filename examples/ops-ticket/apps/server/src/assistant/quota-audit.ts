import { z } from 'zod';

// 最多一万行，每项最多一千二百万，累加仍在安全整数范围内。
const nonnegative = z.number().int().min(0).max(12000000);
const scope = { userId: z.string().min(1).max(64), period: z.iso.date() };
const rowSchema = z.object({
  ...scope,
  id: z.string().min(1).max(64),
  reserved: nonnegative.min(1),
  status: z.enum(['pending', 'exact', 'estimated']),
  charged: nonnegative.nullable(),
  inputTokens: nonnegative.nullable(),
  outputTokens: nonnegative.nullable(),
}).strict();
const inputSchema = z.object({
  ...scope,
  initial: nonnegative,
  available: z.number().int().min(-120000000000).max(120000000000),
  rows: z.array(rowSchema).max(10000),
}).strict();

// 离线只读核账：发现差额，不自动退款或修改账本。
export function auditQuota(input: unknown) {
  const data = inputSchema.parse(input);
  const seen = new Set<string>();
  let consumed = 0, pending = 0, estimated = 0, exact = 0;

  for (const row of data.rows) {
    if (row.userId !== data.userId || row.period !== data.period) throw new Error('AUDIT_SCOPE');
    if(seen.has(row.id)) throw new Error('AUDIT_DUPLICATE_ID');
    seen.add(row.id);

    // 未结算不是零消费，已扣除的预留必须纳入余额公式。
    if (row.status === 'pending') {
      if (row.charged !== null || row.inputTokens !== null || row.outputTokens !== null) {
        throw new Error('AUDIT_INVALID_PENDING');
      }
      consumed+=row.reserved;
      pending++;
      continue;
    }
    if (row.charged === null || row.inputTokens === null || row.outputTokens === null) {
      throw new Error('AUDIT_INCOMPLETE_SETTLEMENT');
    }
    const known = row.inputTokens + row.outputTokens * 2;
    if (row.status === 'exact' && row.charged !== known) throw new Error('AUDIT_EXACT_MISMATCH');
    if (row.status === 'estimated' && row.charged < Math.max(row.reserved, known)) {
      throw new Error('AUDIT_ESTIMATE_UNDERCOUNT');
    }
    consumed += row.charged;
    if (row.status === 'exact') exact++;
    else estimated++;
  }
  const expected = data.initial - consumed;
  return {
    expected,
    actual: data.available,
    difference: data.available - expected,
    balanced: data.available === expected,
    pending,
    estimated,
    exact,
    needsReview: pending + estimated,
  };
}
