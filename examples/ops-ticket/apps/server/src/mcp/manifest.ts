import { isDeepStrictEqual } from 'node:util';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

// 评审后保存的只读 Skill 契约。升级 SDK 或描述时需先检查差异。
export const summaryTool = {
  name: 'ticket_summary', description: '读取工单标题、描述和状态',
  inputSchema: { type: 'object', properties: {}, $schema: 'http://json-schema.org/draft-07/schema#', additionalProperties: false },
  execution: { taskSupport: 'forbidden' },
} as const;
export function checkDirectory(list: ListToolsResult) {
  // 内存传输可能保留 undefined，可比较的协议值以 JSON 编码后的字段为准。
  const wireTools: unknown = JSON.parse(JSON.stringify(list.tools));
  if (list.nextCursor || !isDeepStrictEqual(wireTools, [summaryTool])) {
    throw new Error('工单工具清单需要重新核准');
  }
}
