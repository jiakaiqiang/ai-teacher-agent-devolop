import { ConflictException, HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DAILY_UNITS, RESERVATION_UNITS, usageCharge, type UsageSummary } from './usage-meter.js';

@Injectable()
export class AiQuotaService {
  constructor(private readonly prisma:PrismaService){}
  async receipt(userId: string, requestKey: string): Promise<{ status: 'exact' | 'estimated'; units: number }> {
    const row = await this.prisma.aiUsage.findUnique({ where: { userId_requestKey: { userId, requestKey } } });
    if (!row || row.charged === null || !['exact','estimated'].includes(row.status)) throw new ConflictException({ code: 'AI_SETTLEMENT_PENDING', message: '用量结算待核对' });
    return { status: row.status === 'exact' ? 'exact' : 'estimated', units: row.charged };
  }
  async reserve(userId:string,requestKey:string,now=new Date()) {
    const period=now.toISOString().slice(0,10); // 明确使用UTC自然日，不随浏览器时区变化。
    return this.prisma.$transaction(async tx=>{
      await tx.aiQuota.createMany({data:[{userId,period,available:DAILY_UNITS}],skipDuplicates:true});
      const [reservation]=await tx.aiUsage.createManyAndReturn({data:[{userId,period,requestKey,reserved:RESERVATION_UNITS}],skipDuplicates:true,select:{id:true}});
      if(!reservation)throw new ConflictException({code:'AI_REQUEST_ALREADY_USED',message:'请求标识已使用，请勿重复生成'});
      const changed=await tx.aiQuota.updateMany({where:{userId,period,available:{gte:RESERVATION_UNITS}},data:{available:{decrement:RESERVATION_UNITS}}});
      if(changed.count!==1)throw new HttpException({code:'AI_QUOTA_EXCEEDED',message:'今日AI额度不足'},429);
      return reservation.id;
    });
  }
  async settle(id:string,summary:UsageSummary) {
    const charged=usageCharge(summary),status=summary.exact?'exact':'estimated';
    return this.prisma.$transaction(async tx=>{
      const row=await tx.aiUsage.findUniqueOrThrow({where:{id}});
      const changed=await tx.aiUsage.updateMany({where:{id,status:'pending'},data:{charged,status,inputTokens:summary.inputTokens,outputTokens:summary.outputTokens,settledAt:new Date()}});
      if(changed.count===0){
        const existing=await tx.aiUsage.findUniqueOrThrow({where:{id}});
        if(existing.charged!==charged||existing.status!==status||existing.inputTokens!==summary.inputTokens||existing.outputTokens!==summary.outputTokens)throw new ConflictException('AI_SETTLEMENT_CONFLICT');
        return existing;
      }
      // 实际消耗超过预留时允许余额为负，忠实记账并阻止新预留；不是供应商硬限额。
      await tx.aiQuota.update({where:{userId_period:{userId:row.userId,period:row.period}},data:{available:{increment:row.reserved-charged}}});
      return tx.aiUsage.findUniqueOrThrow({where:{id}});
    });
  }
}
