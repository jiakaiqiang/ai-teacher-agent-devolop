import { HttpException } from '@nestjs/common';
import { RateLimitService } from '../redis/rate-limit.service.js';
import { LoginOnly } from '../auth/permissions.decorator.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { BadRequestException, Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { TicketCommands } from './ticket-commands.js';
import { SubmitTicket } from './submit-ticket.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import type { Action } from './workflow.js';

class ReportDto {
  @IsString() title!:string;
  @IsString() description!:string;
  @IsString() category!:string;
  @IsArray() @IsString({each:true}) logs!:string[];
}
class ActDto {
  @IsIn(['request_human','unresolved','assign','handle','approve','return','resolved']) action!:Action;
  @IsInt() @Min(0) version!:number;
  @IsOptional() @IsString() targetId?:string;
  @IsOptional() @IsString() comment?:string;
}
@Controller('tickets')
export class TicketWriteController {
  constructor(private readonly cmd:TicketCommands,
    private readonly limits:RateLimitService, private readonly reports:SubmitTicket) {}
  @RequirePermission('ticket:report')
  @Post()
  async submit(@Req() req:AuthenticatedRequest, @Headers('idempotency-key') key:string, @Body() dto:ReportDto) {
    if (!key) throw new BadRequestException('缺少请求键');
    const admission=await this.limits.consume('report:'+req.user!.id,5,1000);
    if (!admission.allowed) throw new HttpException({code:'RATE_LIMITED',message:'提单过于频繁',retryAfterSeconds:admission.retryAfterSeconds},429);
    const row=await this.reports.submit(req.user!.id,key,dto);
    return {ticketNo:row.ticketNo,status:row.status,version:row.version};
  }
  @LoginOnly()
  @Post(':no/actions')
  async act(@Param('no') no:string,@Req() req:AuthenticatedRequest,@Body() dto:ActDto) {
    return this.cmd.apply(no,{source:'user',id:req.user!.id},dto.action,dto.version,dto.targetId,dto.comment);
  }
}
