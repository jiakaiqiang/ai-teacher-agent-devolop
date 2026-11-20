import { publicCitation } from './evidence.js';
const row = {sourceKey:'manual:test',title:'示例',version:'a'.repeat(64),start:2,end:4,quote:'甲😀',score:0.8};
describe('引用出站契约', () => {
  it('只导出约定字段', () => {
    expect(publicCitation({...row,internalNote:'调试'})).toEqual(row);
  });
  it('引用范围按码点核对', () => {
    expect(publicCitation(row).quote).toBe('甲😀');
    expect(()=>publicCitation({...row,end:5})).toThrow('QUOTE_RANGE');
  });
  it('备注保持普通原文', () => {
    const quote='备注：等待批准';
    expect(publicCitation({...row,quote,start:0,end:Array.from(quote).length}).quote).toBe(quote);
  });
});
