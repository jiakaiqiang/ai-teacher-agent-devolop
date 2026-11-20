import { BadRequestException } from '@nestjs/common';

// 游标记录“上一页最后一行”在排序里的位置：按 createdAt 倒序，时间相同按 id 倒序
export interface TicketCursor {
  createdAt: Date;
  id: string;
}

// 编码成 base64url：对前端是不透明的字符串，前端只负责原样传回，不解析也不拼接
export function encodeCursor(cursor: TicketCursor): string {
  const payload = JSON.stringify({ t: cursor.createdAt.toISOString(), id: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

// 解码并校验；游标来自客户端，属于不可信输入，格式不对一律返回 400
export function decodeCursor(raw: string): TicketCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed === 'object' && parsed !== null && 't' in parsed && 'id' in parsed) {
      const { t, id } = parsed as { t: unknown; id: unknown };
      const createdAt = typeof t === 'string' ? new Date(t) : new Date(NaN);
      const isUuid = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (!Number.isNaN(createdAt.getTime()) && isUuid) {
        return { createdAt, id: id as string };
      }
    }
  } catch {
    // JSON 解析失败，落到下面统一报错
  }
  throw new BadRequestException('cursor 无效');
}
