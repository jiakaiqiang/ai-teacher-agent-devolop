# D33：SSE 与通知实时推送

第 5 周 · 2 小时 · 前置 [D32-定时任务与SLA升级](D32-定时任务与SLA升级.md)。

## 今天要做出什么

按接收人推送工单通知，重连使用 Last-Event-ID 从已持久化记录继续。

## 今天的目录结构

- `apps/server/src/notifications/notices.controller.ts`
- `apps/server/src/tickets/tickets.module.ts`

## 时间安排

回忆 10 分钟、知识点 35 分钟、动手 55 分钟、自检与提交 20 分钟。超时先保留主用例与一个失败反例，扩展实验留到周日。

## 零、闭卷回忆

通知收件人由谁确定？SSE 同一个连接内事件如何分隔？能用编号指定另一个用户吗？

## 一、知识点与推导

游标和收件人必须同时生效。HTTP 请求经登录和权限校验，服务端从受信身份取 recipientId，逐批读取并输出 id、data 和空行。持久表是断线后恢复的依据。

## 二、动手开发

先准备两名用户的通知，再用带 Bearer 的流式请求读取。记录最后一个事件号，重连携带 Last-Event-ID，检查已读游标边界。

## 三、自检与提交

对同一张单分别验证读自己的通知与请求其他人的通知；断开客户端后检查循环结束。

## 四、本章完整源码

**apps/server/src/notifications/notices.controller.ts**

```ts
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
```

**apps/server/src/tickets/tickets.module.ts**

```ts
import { NoticesController } from '../notifications/notices.controller.js';
import { WorklistStats } from './worklist-stats.js';
import { TicketWriteController } from './ticket-write.controller.js';
import { TicketCommands } from './ticket-commands.js';
import { SubmitTicket } from './submit-ticket.js';
import { CategoriesController } from './categories.controller.js';
import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

@Module({
  controllers: [NoticesController, TicketsController, CategoriesController, TicketWriteController],
  providers: [WorklistStats, TicketsService, TicketCommands, SubmitTicket],
})
export class TicketsModule {}
```


## 五、核心面试题

1. 接收人和游标各防止什么问题？
2. 为什么恢复不能只依赖内存广播？
3. 什么时候应关闭流？

结合本日业务样例回答后，再核对[配套面试题](D33-面试题.md)。

## 六、个人建议

把一个失败请求讲清楚：输入是什么、哪一层发现了问题、用户最终看见什么。提交时附实际用时、参考过的提示及运行输出。

## 七、拓展练习

换成乙公司的样例再走一遍，指出预期随数据变化的部分及始终应成立的约束。

## 本文验证范围

收件人列表与更新接口通过真实 Nest/数据库用例；长时间 SSE 重连待浏览器专项演练。

本机 Chromium 使用提单人、部门负责人和处理人三个登录会话，从页面报障走完人工接入、派单、处理、两次复核、回原人和用户确认。通知流按事件编号断开再连，下一条通知正确送达。 [浏览器记录](../学习记录/新版验收/D169-browser.json)。
