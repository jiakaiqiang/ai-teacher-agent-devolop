import { createHash } from 'node:crypto';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { redactForLog } from '../common/sensitive.js';

// 对脱敏后的正文按 Unicode 码点分页，引用指向固定版本，翻页不占模型上下文。
export function manualPage(id: string, body: string, offset = 0, expected?: string) {
  const text = redactForLog(body);
  const revision = createHash('sha256').update(text).digest('hex');
  if (expected !== undefined && expected !== revision) throw new ConflictException('MANUAL_VERSION_CHANGED');
  const points = Array.from(text);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > points.length) throw new BadRequestException('MANUAL_OFFSET_INVALID');
  const end = Math.min(offset + 240, points.length);
  return { sourceKey: 'manual:' + id, revision, quote: { text: points.slice(offset, end).join(''), clipped: end < points.length },
    next: end < points.length ? end : null };
}

// 长手册只把引用交给诊断模型。人工打开引用时仍从第一页校验权限和版本。
export function manualForModel(page: ReturnType<typeof manualPage> & { title: { text: string; clipped: boolean } }) {
  if (!page.quote.clipped) return page;
  return { sourceKey: page.sourceKey, revision: page.revision, title: page.title, offset: 0 };
}
