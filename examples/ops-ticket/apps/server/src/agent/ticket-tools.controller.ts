import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { definitions } from './tool-catalog.js';
import { batchSchema, TicketToolsService } from './ticket-tools.service.js';

@Controller('agent/runs/:id/tools')
@RequirePermission('ticket:report')
export class TicketToolsController {
  constructor(private readonly tools: TicketToolsService) {}
  @Get()
  async discover(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('topic') input: unknown) {
    await this.tools.owned(user, id);
    const topic = z.enum(['overview', 'history', 'device', 'notes']).safeParse(input ?? 'overview');
    if (!topic.success) throw new BadRequestException('工具主题无效');
    return definitions(topic.data, true);
  }
  @Get('audit')
  history(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('after') after?: string) {
    if (after !== undefined && !z.uuid().safeParse(after).success) throw new BadRequestException('审计游标无效');
    return this.tools.history(user, id, after);
  }
  @Post() @HttpCode(200)
  execute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: unknown) {
    const batch = batchSchema.safeParse(input);
    if (!batch.success) throw new BadRequestException('每批工具调用限 1 至 3 项');
    return this.tools.batch(user, id, batch.data.calls, AbortSignal.timeout(3500), true);
  }
}
