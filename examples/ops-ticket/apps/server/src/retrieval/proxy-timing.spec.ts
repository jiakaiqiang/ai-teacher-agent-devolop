import { assessProxy } from './proxy-timing.js';
describe('代理流式观测',()=>{
  it('完整周期超过空闲超时仍可成功',()=>{
    expect(assessProxy(30,3500,6)).toEqual({firstMs:30,totalMs:3500,frames:6});
  });
  it('首帧堆积到末尾被发现',()=>{
    expect(()=>assessProxy(3500,3500,6)).toThrow('BUFFERED_FIRST_EVENT');
  });
  it('缺失末尾帧不能当作完成',()=>{
    expect(()=>assessProxy(30,3500,5)).toThrow('INCOMPLETE_STREAM');
  });
});
