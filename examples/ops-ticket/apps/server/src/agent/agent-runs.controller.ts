import { TeamDiagnosisService } from './team/team.service.js';
import { Body, Header, Controller, Get, HttpCode, HttpException, Param, Post, Query, Req, Sse, UseGuards,
  type MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { eventPageSchema, eventViewSchema, runDetailSchema, runListSchema, runStartSchema, runVersionSchema,
  runViewSchema, stepViewSchema, tracePageSchema, traceViewSchema } from '@ops-ticket/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import { RequirePermission } from '../auth/permissions.decorator.js';
import { AgentRunsService } from './agent-runs.service.js';
import { AgentJournalService } from './agent-journal.service.js';
import { RunTraceService } from './run-trace.service.js';
import { RunStreamService } from './run-stream.service.js';
import { RunStreamGuard, RunTicketService, type RunStreamRequest } from './run-stream.ticket.js';
import { RawResponse } from '../common/response.interceptor.js';
import { Public } from '../auth/public.decorator.js';
import { DiagnosisService } from './diagnosis.service.js';
import { RunFailure } from './run-errors.js';
import { RunStateError } from './run-state.js';
import { z } from 'zod';

type RunRow = Awaited<ReturnType<AgentRunsService['get']>>;
type StepRow = Awaited<ReturnType<AgentJournalService['steps']>>[number];
type EventRow = Awaited<ReturnType<AgentJournalService['events']>>[number];

export function stepView(step: StepRow) {
  return stepViewSchema.parse({
    id: step.id, ordinal: step.ordinal, phase: step.phase, status: step.status, summary: step.summary,
    errorCode: step.errorCode, startedAt: step.startedAt.toISOString(),
    endedAt: step.endedAt?.toISOString() ?? null,
  });
}

// 事件对外只给序号、类型、所属步序和扁平载荷；不暴露内部主键。
export function eventView(event: EventRow, stepOrdinal: number | null) {
  return eventViewSchema.parse({
    seq: event.seq, type: event.type, stepOrdinal,
    payload: event.payload ?? {}, createdAt: event.createdAt.toISOString(),
  });
}

export function runView(run: RunRow) {
  return runViewSchema.parse({
    id: run.id, ticketNo: run.ticketNo, goal: run.goal, status: run.status, stopReason: run.stopReason,
    version: run.version, stepCount: run.stepCount, createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null, endedAt: run.endedAt?.toISOString() ?? null,
  });
}

// 输入问题是 400，看不到是 404，权限变化是 403；状态类问题（转移不允许或被别人改过）都是 409。
export function runHttpStatus(code: string, stateError = false) {
  if (stateError) return 409;
  if (code.endsWith('NOT_FOUND')) return 404;
  if (code === 'RUN_INPUT_INVALID') return 400;
  if (code === 'RUN_SCOPE_CHANGED') return 403;
  return 409;
}

function httpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  const known = error instanceof RunFailure || error instanceof RunStateError;
  const code = known ? error.code : 'RUN_FAILED';
  throw new HttpException({ code, message: '运行请求未完成，请查看运行状态后再试' },
    known ? runHttpStatus(code, error instanceof RunStateError) : 503);
}

@Controller('agent/runs')
@RequirePermission('ticket:report')
export class AgentRunsController {
  constructor(private readonly team: TeamDiagnosisService, private readonly diagnosis: DiagnosisService, private readonly runs: AgentRunsService, private readonly journal: AgentJournalService,
    private readonly traces: RunTraceService, private readonly streams: RunStreamService,
    private readonly tickets: RunTicketService) {}

  @Post() @HttpCode(201)
  async start(@CurrentUser() user: AuthUser, @Body() input: unknown) {
    try {
      const parsed = runStartSchema.safeParse(input);
      if (!parsed.success) throw new RunFailure('RUN_INPUT_INVALID');
      const { run } = await this.runs.start(user, parsed.data);
      return runView(run);
    } catch (error) { httpError(error); }
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    try { return runListSchema.parse((await this.runs.list(user)).map(runView)); } catch (error) { httpError(error); }
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    try {
      const run = await this.runs.get(user, id);
      return runDetailSchema.parse({ run: runView(run), steps: (await this.journal.steps(run.id)).map(stepView) });
    } catch (error) { httpError(error); }
  }

  // 增量拉取：客户端带上已经看到的最大序号，只取后面的事件。
  @Get(':id/events')
  async events(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('after') after?: string) {
    try {
      const run = await this.runs.get(user, id);
      const parsed = z.coerce.number().int().min(0).max(1_000_000).safeParse(after ?? 0);
      if (!parsed.success) throw new RunFailure('RUN_INPUT_INVALID');
      const steps = await this.journal.steps(run.id);
      const ordinals = new Map(steps.map(step => [step.id, step.ordinal]));
      const events = await this.journal.events(run.id, parsed.data);
      const views = events.map(event => eventView(event, event.stepId ? ordinals.get(event.stepId) ?? null : null));
      return eventPageSchema.parse({ runId: run.id, events: views, lastSeq: views.at(-1)?.seq ?? parsed.data });
    } catch (error) { httpError(error); }
  }

  // Trace 只给运行的发起人；内容已在写入时脱敏并截断。
  @Get(':id/traces')
  async traceList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    try {
      const run = await this.runs.get(user, id);
      const rows = await this.traces.list(run.id);
      return tracePageSchema.parse({
        runId: run.id,
        traces: rows.map(row => traceViewSchema.parse({
          ordinal: row.ordinal, kind: row.kind, input: row.input, output: row.output,
          inputTokens: row.inputTokens, outputTokens: row.outputTokens,
          durationMs: row.durationMs, truncated: row.truncated,
        })),
        usage: await this.traces.usage(run.id),
      });
    } catch (error) { httpError(error); }
  }

  // 先用已登录的接口换一张短期票据：EventSource 不能带 Authorization 头。
  @Post(':id/stream-ticket') @HttpCode(201)
  async streamTicket(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: unknown) {
    try {
      const run = await this.runs.get(user, id);
      const parsed = z.object({ after: z.number().int().min(0).max(1_000_000).default(0) })
        .strict().safeParse(input ?? {});
      if (!parsed.success) throw new RunFailure('RUN_INPUT_INVALID');
      return await this.tickets.issue(user.id, run.id, parsed.data.after);
    } catch (error) { httpError(error); }
  }

  @Post(':id/team-diagnose') @HttpCode(200)
  async teamDiagnose(@CurrentUser() user: AuthUser, @Param('id') id:string, @Body() input:unknown) {
    const choice=z.object({mode:z.enum(['single','team'])}).strict().safeParse(input);
    if(!choice.success) throw new HttpException('模式无效',400);
    try {return runView((await this.team.execute(user,id,choice.data.mode)).run);} catch(error){httpError(error);}
  }

  @Post(':id/diagnose') @HttpCode(200)
  async diagnose(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    try { return runView((await this.diagnosis.execute(user, id)).run); } catch (error) { httpError(error); }
  }

  @Post(':id/cancel') @HttpCode(200)
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: unknown) {
    try {
      const parsed = runVersionSchema.safeParse(input);
      if (!parsed.success) throw new RunFailure('RUN_INPUT_INVALID');
      return runView(await this.runs.cancel(user, id, parsed.data.version));
    } catch (error) { httpError(error); }
  }

  // 票据在守卫里兑换；本路由不走常规登录态，所以标 Public 并单独鉴权。
  @Public()
  @UseGuards(RunStreamGuard)
  @RawResponse()
  @Header('X-Accel-Buffering', 'no')
  @Sse(':id/stream', { maxPendingDataLength: 64 * 1024 })
  stream(@Req() request: RunStreamRequest): Observable<MessageEvent> {
    const { runId, after } = request.runStream;
    return this.streams.open(runId, after);
  }
}
