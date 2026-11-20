import {describe,expect,it} from 'vitest'
import {appendFileSync} from 'node:fs'
import {applyConversationEvent as apply,createGeneration} from './generation'
import {mockCards} from './cards'
import {finishMetrics,measureText,metricsView,startMetrics,summarizeMetrics} from './metrics'
const event=(seq:number,extra:object)=>({version:1,runId:'r',messageId:'m',seq,...extra})
const begun=(mode='mock')=>{const run=createGeneration('r','m');apply(run,event(1,{type:'start',mode}));return run}
const report=(value:object)=>{if(process.env.D54_EVIDENCE_FILE)appendFileSync(process.env.D54_EVIDENCE_FILE,JSON.stringify(value)+'\n')}
describe('模拟卡片和生成指标（D54）',()=>{
  it('模拟工具状态引用结果保持身份与顺序',()=>{const run=begun();mockCards(run);expect(run.cards.map(card=>card.type)).toEqual(['tool','citation','result']);expect(run.cards[0]).toMatchObject({state:'completed'});expect(run.lastSeq).toBe(5);report({case:'mock-cards',types:run.cards.map(c=>c.type),toolState:run.cards[0]!.type==='tool'?run.cards[0]!.state:null,lastSeq:run.lastSeq})})
  it('真实模式不能伪造模拟卡片',()=>{const run=begun('model');expect(()=>apply(run,event(2,{type:'tool',cardId:'t',state:'running',label:'模拟'}))).toThrow('MOCK_CARD_ONLY');mockCards(run);expect(run.cards).toHaveLength(0)})
  it('工具必须先running再终态',()=>{const run=begun();expect(()=>apply(run,event(2,{type:'tool',cardId:'t',state:'completed',label:'模拟'}))).toThrow('CARD_ORDER');expect(run.lastSeq).toBe(1)})
  it('工具终态不能重新运行',()=>{const run=begun();mockCards(run);expect(()=>apply(run,event(6,{type:'tool',cardId:'demo-check',state:'running',label:'模拟核对本单日志'}))).toThrow('CARD_ORDER')})
  it('卡片ID不能跨类型复用',()=>{const run=begun();mockCards(run);expect(()=>apply(run,event(6,{type:'result',cardId:'demo-source',title:'错',items:[]}))).toThrow('CARD_ORDER')})
  it('重复卡片事件只登记一次',()=>{const run=begun();const card=event(2,{type:'citation',cardId:'c',title:'模拟',excerpt:'片段'});apply(run,card);expect(apply(run,card)).toBe('duplicate');expect(run.cards).toHaveLength(1)})
  it('卡片数量上限十二',()=>{const run=begun();for(let i=0;i<12;i++)apply(run,event(i+2,{type:'citation',cardId:String(i),title:'模拟',excerpt:''}));expect(()=>apply(run,event(14,{type:'citation',cardId:'extra',title:'模拟',excerpt:''}))).toThrow('CARD_LIMIT')})
  it('停止后卡片不新增',()=>{const run=begun();run.status='stopped';mockCards(run);expect(run.cards).toHaveLength(0)})
  it('首字忽略空文本并按Unicode码点计字符',()=>{const m=startMetrics(100);measureText(m,'',110);measureText(m,'中😀',250);measureText(m,'文',750);finishMetrics(m,'completed',1250);expect(metricsView(m)).toEqual({ttftMs:150,durationMs:1150,chars:3,charsPerSecond:3,outcome:'completed'});report({case:'generation-metrics',...metricsView(m)})})
  it('无正文和零耗时不能伪造速率',()=>{const m=startMetrics(10);finishMetrics(m,'error',20);expect(metricsView(m).ttftMs).toBeNull();expect(metricsView(m).charsPerSecond).toBeNull();const n=startMetrics(0);measureText(n,'x',1);finishMetrics(n,'completed',1);expect(metricsView(n).charsPerSecond).toBeNull()})
  it('终态计量只结算一次',()=>{const m=startMetrics(0);measureText(m,'x',1);finishMetrics(m,'stopped',2);finishMetrics(m,'completed',3);measureText(m,'迟到',4);expect(metricsView(m)).toMatchObject({chars:1,durationMs:2,outcome:'stopped'})})
  it('中断率排除主动停止和进行中',()=>{const rows=['completed','interrupted','error','stopped','truncated'] as const;const ms=rows.map(outcome=>{const m=startMetrics(0);finishMetrics(m,outcome,10);return m});ms.push(startMetrics(0));expect(summarizeMetrics(ms)).toEqual({eligible:4,interrupted:2,interruptionRate:.5});report({case:'interruption-rate',...summarizeMetrics(ms)})})
  it('无可计分母返回null',()=>{expect(summarizeMetrics([]).interruptionRate).toBeNull()})
})
