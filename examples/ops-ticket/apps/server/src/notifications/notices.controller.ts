import { Controller, Get, Param, Post, Req, Res, Query, BadRequestException } from '@nestjs/common';
import { RequirePermission } from '../auth/permissions.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

@RequirePermission('ticket:read')
@Controller('notices')
export class NoticesController {
  constructor(private readonly db:PrismaService) {}
  @Get()
  list(@Req() req:AuthenticatedRequest,@Query('before') raw?:string) {
    const before=raw ? Number(raw):undefined;
    if (before!==undefined && (!Number.isSafeInteger(before)||before<1)) throw new BadRequestException('通知游标无效');
    return this.db.notice.findMany({where:{recipientId:req.user!.id,id:before ? {lt:before}:undefined},orderBy:{id:'desc'},take:20});
  }
  @Post(':id/read')
  read(@Req() req:AuthenticatedRequest,@Param('id') id:string) {
    const key=Number(id);
    if (!Number.isSafeInteger(key)||key<1) throw new BadRequestException('通知编号无效');
    return this.db.notice.updateMany({where:{recipientId:req.user!.id,id:key,readAt:null},data:{readAt:new Date()}});
  }
  @Get('stream')
  async stream(@Req() req:AuthenticatedRequest,@Res() res:Response) {
    const recipientId=req.user!.id;
    let last=Number(req.headers['last-event-id'] ?? 0);
    if (!Number.isSafeInteger(last)||last<0) throw new BadRequestException('事件游标无效');
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    res.flushHeaders();
    let closed=false;
    res.on('close',()=>{closed=true});
    try {
      while (!closed) {
        const batch=await this.db.notice.findMany({where:{recipientId,id:{gt:last}},orderBy:{id:'asc'},take:50});
        for (const item of batch) {
          if (closed) break;
          res.write('id: '+item.id+'\ndata: '+JSON.stringify(item)+'\n\n');
          last=item.id;
        }
        if (batch.length<50 && !closed) await new Promise(resolve=>setTimeout(resolve,1000));
      }
    } finally {res.end()}
  }
}
