import { setTimeout as delay } from 'node:timers/promises';
import type { ToolCall, ToolMessage } from './tool-protocol.js';

// 明确的规则演示，不宣称模拟了真实模型的工具选择能力。
export async function mockToolCompletion(messages: ToolMessage[], signal: AbortSignal, toolsEnabled: boolean) {
  await delay(200, undefined, { signal });
  const answer = (content: string) => ({ choices: [{ index: 0, finish_reason: 'stop', message: { content } }] });
  if (!toolsEnabled) {
    const lastUser = messages.findLastIndex(message => message.role === 'user');
    const results = messages.slice(lastUser + 1).filter(message => message.role === 'tool');
    return answer(('模拟查询结果（规则演示，非真实模型）\n\n' + results.map(message => message.content).join('\n\n')).slice(0, 8192));
  }
  const question = messages.findLast(message => message.role === 'user')?.content ?? '';
  const ticket = /工单[:：\s]+([A-Za-z0-9-]{1,64})(?=\s|$|[，。])/u.exec(question)?.[1];
  const calls: ToolCall[] = [];
  if (ticket) calls.push({ id: 'mock-ticket', type: 'function', function: { name: 'find_ticket', arguments: JSON.stringify({ ticketNo: ticket }) } });
  if (ticket && question.includes('记录')) calls.push({ id: 'mock-history', type: 'function', function: { name: 'list_ticket_history', arguments: JSON.stringify({ ticketNo: ticket, limit: 3 }) } });
  if (ticket && question.includes("日志")) calls.push({ id: 'mock-alerts', type: 'function', function: { name: 'list_ticket_logs', arguments: JSON.stringify({ ticketNo: ticket, limit: 3 }) } });
  if (calls.length) return { choices: [{ index: 0, finish_reason: 'tool_calls', message: { content: null, tool_calls: calls } }] };
  const previous = messages.filter(message => message.role === 'assistant' && !message.tool_calls).length;
  return answer(`模拟模式：当前上下文含${previous}个完整历史回答。可输入“查询工单 编号 的记录”或“查询工单 编号 的日志”。本轮没有执行工具。`);
}
