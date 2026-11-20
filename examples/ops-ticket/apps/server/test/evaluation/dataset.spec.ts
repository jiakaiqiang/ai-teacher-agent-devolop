import { cases } from '../diagnosis-eval.js';
import { dataset, indexCases, modelInput } from './dataset.js';

describe('固定分层工单', () => {
  it('保留历史标签并覆盖五个切片', () => {
    const index = indexCases(dataset);
    expect([...index.keys()]).toEqual([...cases.map(row => row[0]), 'B1', 'R1']);
    expect(cases.map(([id]) => index.get(id)?.expected)).toEqual(cases.map(row => row[2]));
    expect(dataset.filter(row => row.slice === 'ambiguous').map(x => x.id)).toEqual(['N3', 'S3']);
    expect(new Set(dataset.map(row => row.slice)).size).toBe(5);
    expect(() => indexCases([...dataset, dataset[0]])).toThrow('重复');
  });

  it('给模型的输入没有评测答案和切片', () => {
    for (const item of dataset) {
      expect(modelInput(item)).toEqual({ description: item.description });
    }
  });
});
