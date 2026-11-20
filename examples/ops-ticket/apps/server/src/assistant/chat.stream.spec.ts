import { parseChatStream } from './chat.stream.js';
const wire = (content: string, reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: reason }] })}\n\n`;
async function collect(text: string) { const output = []; for await (const event of parseChatStream(new Response(text).body!)) output.push(event); return output; }
describe('模型事件转换（D45）', () => {
  it('正文增量不回退，stop和DONE后才完成', async () => {
    expect(await collect(wire('中文') + wire('', 'stop') + 'data: [DONE]\n\n')).toEqual([{ type: 'delta', text: '中文' }, { type: 'done', finishReason: 'stop' }]);
  });
  it('length与空choices的usage尾块均保留语义', async () => {
    expect(await collect(wire('部分', 'length') + 'data: {"choices":[],"usage":{}}\n\ndata: [DONE]\n\n')).toEqual([{ type: 'delta', text: '部分' }, { type: 'done', finishReason: 'length' }]);
  });
  it('缺少DONE不能把EOF当完成', async () => { await expect(collect(wire('partial', 'stop'))).rejects.toThrow('MODEL_PROTOCOL_ERROR'); });
  it('没有finish_reason先DONE应拒绝', async () => { await expect(collect(wire('partial') + 'data: [DONE]\n\n')).rejects.toThrow('MODEL_PROTOCOL_ERROR'); });
  it('未知结束原因拒绝', async () => { await expect(collect(wire('', 'tool_calls') + 'data: [DONE]\n\n')).rejects.toThrow('MODEL_PROTOCOL_ERROR'); });
  it('拒绝非法JSON和非零choice', async () => {
    await expect(collect('data: broken\n\n')).rejects.toThrow('MODEL_PROTOCOL_ERROR');
    await expect(collect('data: {"choices":[{"index":1,"delta":{},"finish_reason":null}]}\n\n')).rejects.toThrow('MODEL_PROTOCOL_ERROR');
  });
  it('结束原因之后不接受更多正文', async () => { await expect(collect(wire('', 'stop') + wire('late'))).rejects.toThrow('MODEL_PROTOCOL_ERROR'); });
  it('单增量超限拒绝', async () => { await expect(collect(wire('x'.repeat(16_385)))).rejects.toThrow('MODEL_OUTPUT_LIMIT'); });
});
