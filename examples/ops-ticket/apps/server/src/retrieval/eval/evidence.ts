import { pathToFileURL } from 'node:url';
import { z } from 'zod';

// 输入来自 D75 已经回查原文的引用。显式选择出站字段，正文只在 quote 槽中出现。
const wire = z.object({ sourceKey: z.string().regex(/^(?:manual|ticket):.+$/), title:z.string().max(200),
  version:z.string().regex(/^[0-9a-f]{64}$/), start:z.number().int().nonnegative(), end:z.number().int().positive(),
  quote:z.string().min(1), score:z.number().finite() });
export function publicCitation(input: unknown) {
  const dto = wire.parse(input);
  if (dto.end - dto.start !== Array.from(dto.quote).length) throw Error('QUOTE_RANGE');
  return dto;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const quote = '工单备注：请由主管复核。<样本>';
  const dto=publicCitation({sourceKey:'ticket:demo',title:'复核',version:'a'.repeat(64),start:0,end:Array.from(quote).length,
    quote,score:0.7,annotations:{priority:'仅供研究'}});
  console.log(JSON.stringify({keys:Object.keys(dto),quote:dto.quote}));
}
