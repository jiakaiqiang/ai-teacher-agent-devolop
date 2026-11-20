import { describe,expect,it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { anchorAt,layoutRows,nearBottom,restoreAnchor,rowAt,visibleRange } from './virtual'
const report=(value:object)=>{if(process.env.D53_EVIDENCE_FILE)appendFileSync(process.env.D53_EVIDENCE_FILE,JSON.stringify(value)+'\n')}
describe('动态高度列表模型（D53）',()=>{
  it('估算与测量形成前缀高度',()=>{const l=layoutRows(['a','b','c'],new Map([['b',300]]),100);expect(l.offsets).toEqual([0,100,400,500]);expect(l.total).toBe(500)})
  it('边界位置归属下一行',()=>{const l=layoutRows(['a','b'],new Map(),100);expect(rowAt(l,99.9)).toBe(0);expect(rowAt(l,100)).toBe(1);expect(rowAt(l,999)).toBe(1)})
  it('窗口含可见行和overscan且保持有界',()=>{const l=layoutRows(Array.from({length:200},(_,i)=>String(i)),new Map(),100);const r=visibleRange(l,5000,500);expect(r).toEqual({start:48,end:58});report({case:'bounded-window',totalRows:200,mountedRows:r.end-r.start,range:r})})
  it('空列表无挂载行',()=>{expect(visibleRange(layoutRows([],new Map()),0,500)).toEqual({start:0,end:0})})
  it('上方行增长后保持阅读锚点',()=>{const before=layoutRows(['a','b','c'],new Map(),100);const anchor=anchorAt(before,130);const after=layoutRows(['a','b','c'],new Map([['a',250]]),100);expect(restoreAnchor(after,anchor)).toBe(280);report({case:'reading-anchor',anchor,before:130,after:restoreAnchor(after,anchor)})})
  it('当前行缩短时偏移夹到行内',()=>{const anchor={id:'b',offset:80};expect(restoreAnchor(layoutRows(['a','b'],new Map([['b',30]]),100),anchor)).toBe(129)})
  it('丢失锚点回到起点',()=>{expect(restoreAnchor(layoutRows(['c'],new Map()),{id:'old',offset:20})).toBe(0)})
  it('跟随阈值容纳小数像素但离底暂停',()=>{expect(nearBottom(451.5,500,1000)).toBe(false);expect(nearBottom(452,500,1000)).toBe(true);expect(nearBottom(500.2,500,1000)).toBe(true)})
  it('单行超长仍完整覆盖可视区',()=>{const l=layoutRows(['a','b','c'],new Map([['b',10000]]),100);expect(visibleRange(l,500,500,0)).toEqual({start:1,end:2})})
  it('末尾追加不改变已有阅读锚点',()=>{const anchor=anchorAt(layoutRows(['a','b'],new Map(),100),120);expect(restoreAnchor(layoutRows(['a','b','c'],new Map(),100),anchor)).toBe(120)})
})
