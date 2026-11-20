import type {INestApplication} from '@nestjs/common';
import {Test} from '@nestjs/testing';
import {randomUUID} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {AppModule} from '../src/app.module.js';
import {configureApp} from '../src/app.setup.js';
import {PrismaService} from '../src/prisma/prisma.service.js';
import {AiQuotaService} from '../src/assistant/ai-quota.service.js';
import {DAILY_UNITS,RESERVATION_UNITS} from '../src/assistant/usage-meter.js';
describe('数据库AI额度（D61）',()=>{
 let app:INestApplication,db:PrismaService,service:AiQuotaService;
 const now=new Date('2026-11-17T12:00:00Z'),period='2026-11-17';
 const exact={inputTokens:10,outputTokens:5,exact:true,attempts:1};
 beforeAll(async()=>{const m=await Test.createTestingModule({imports:[AppModule]}).compile();app=m.createNestApplication();configureApp(app);await app.init();db=app.get(PrismaService);service=app.get(AiQuotaService);});
 afterAll(async()=>{await app.close();});
 async function user(){return (await db.user.create({data:{username:'quota-'+randomUUID(),displayName:'隔离额度测试',role:'reporter',companyId:(await db.company.findFirstOrThrow()).id}})).id;}
 const balance=(userId:string,p=period)=>db.aiQuota.findUniqueOrThrow({where:{userId_period:{userId,period:p}}});
 it('20个并发预留最多4个成功',async()=>{const id=await user();const result=await Promise.allSettled(Array.from({length:20},()=>service.reserve(id,randomUUID(),now)));const successful=result.filter(r=>r.status==='fulfilled').length;expect(successful).toBe(4);expect((await balance(id)).available).toBe(0);expect(await db.aiUsage.count({where:{userId:id}})).toBe(4);if(process.env.D61_EVIDENCE_FILE)appendFileSync(process.env.D61_EVIDENCE_FILE,JSON.stringify({case:'atomic-quota',requests:20,successful,rejected:20-successful,remaining:0})+'\n');});
 it('同请求标识只预留一次',async()=>{const id=await user(),key=randomUUID();const result=await Promise.allSettled([service.reserve(id,key,now),service.reserve(id,key,now)]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await balance(id)).available).toBe(DAILY_UNITS-RESERVATION_UNITS);});
 it('并发重复结算不会重复退款',async()=>{const id=await user(),reservation=await service.reserve(id,randomUUID(),now);await Promise.all([service.settle(reservation,exact),service.settle(reservation,exact)]);expect((await balance(id)).available).toBe(DAILY_UNITS-20);expect((await db.aiUsage.findUniqueOrThrow({where:{id:reservation}})).status).toBe('exact');});
 it('不同金额重结算拒绝',async()=>{const id=await user(),reservation=await service.reserve(id,randomUUID(),now);await service.settle(reservation,exact);await expect(service.settle(reservation,{...exact,inputTokens:11})).rejects.toThrow('AI_SETTLEMENT_CONFLICT');expect((await balance(id)).available).toBe(DAILY_UNITS-20);});
 it('未知usage保留预留量并标estimated',async()=>{const id=await user(),reservation=await service.reserve(id,randomUUID(),now);const row=await service.settle(reservation,{inputTokens:0,outputTokens:0,exact:false,attempts:1});expect(row.status).toBe('estimated');expect((await balance(id)).available).toBe(DAILY_UNITS-RESERVATION_UNITS);});
 it('超出预留真实记账并阻止后续生成',async()=>{const id=await user(),reservation=await service.reserve(id,randomUUID(),now);await service.settle(reservation,{inputTokens:250000,outputTokens:0,exact:true,attempts:1});expect((await balance(id)).available).toBe(-50000);await expect(service.reserve(id,randomUUID(),now)).rejects.toThrow('今日AI额度不足');});
 it('UTC换日创建独立额度且历史保留',async()=>{const id=await user();await service.reserve(id,randomUUID(),now);await service.reserve(id,randomUUID(),new Date('2026-11-18T00:00:00Z'));expect(await db.aiQuota.count({where:{userId:id}})).toBe(2);expect(await db.aiUsage.count({where:{userId:id}})).toBe(2);});
 it('未结算预留不会自动退还',async()=>{const id=await user(),reservation=await service.reserve(id,randomUUID(),now);expect((await db.aiUsage.findUniqueOrThrow({where:{id:reservation}})).status).toBe('pending');expect((await balance(id)).available).toBe(DAILY_UNITS-RESERVATION_UNITS);});
});
