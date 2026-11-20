import { checkVector, collectionSchema } from './vector-index.js';

describe('向量空间契约', () => {
  it('拒绝错误维度', () => {
    expect(() => checkVector([1], 2)).toThrow('VECTOR_DIMENSION');
  });
  it('余弦方向必须有限且非零', () => {
    expect(() => checkVector([0, 0], 2)).toThrow('VECTOR_DIRECTION');
    expect(() => checkVector([0, NaN], 2)).toThrow('VECTOR_DIRECTION');
    expect(checkVector([0, -2], 2)).toEqual([0, -2]);
  });
  it('用精确余弦索引做排名基线', () => {
    const schema = collectionSchema('example', 2);
    expect(schema.indexParams[0]).toMatchObject({ metricType: 'COSINE', indexType: 'FLAT' });
    expect(schema.schema.fields[1]?.elementTypeParams.dim).toBe('2');
    expect(schema.params.consistencyLevel).toBe('Strong');
  });
});
