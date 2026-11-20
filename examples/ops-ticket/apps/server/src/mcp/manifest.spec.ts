import { checkDirectory, summaryTool } from './manifest.js';

describe('已评审的只读工具清单', () => {
  it('识别仅修改说明文字的版本差异', () => {
    expect(() => checkDirectory({ tools: [summaryTool] })).not.toThrow();
    expect(() => checkDirectory({ tools: [{ ...summaryTool, description: '新版工单说明' }] })).toThrow('重新核准');
  });

  it('发现后续分页时暂停调用', () => {
    expect(() => checkDirectory({ tools: [summaryTool], nextCursor: 'second' })).toThrow('重新核准');
  });
});
