import { TeamDiagnosisService } from './team/team.service.js';
import { PreferencesService } from './preferences.service.js';
import { PreferencesController } from './preferences.controller.js';
import { AuditService as CourseAudit } from '../audit/audit.service.js';
import { TicketToolsController } from './ticket-tools.controller.js';
import { TicketToolsService } from './ticket-tools.service.js';
import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { DiagnosisService } from './diagnosis.service.js';
import { AgentRunsController } from './agent-runs.controller.js';
import { AgentRunsService } from './agent-runs.service.js';
import { AgentJournalService } from './agent-journal.service.js';
import { RunExecutorService } from './run-executor.service.js';
import { RunTraceService } from './run-trace.service.js';
import { DEFAULT_RUN_STREAM_OPTIONS, RUN_STREAM_OPTIONS, RunStreamService } from './run-stream.service.js';
import { RunStreamGuard, RunTicketService } from './run-stream.ticket.js';
import { RunLiveHub } from './run-live.hub.js';
import { RedisModule } from '../redis/redis.module.js';


// 复用 AssistantModule 导出的只读工具与权限指纹，不重复实现数据权限。
@Module({ imports: [AssistantModule, RedisModule], controllers: [PreferencesController, AgentRunsController, TicketToolsController],
  providers: [TeamDiagnosisService, PreferencesService, CourseAudit, TicketToolsService, DiagnosisService, AgentRunsService, AgentJournalService, RunExecutorService, RunTraceService,
    RunLiveHub, RunStreamService, RunTicketService, RunStreamGuard,
    { provide: RUN_STREAM_OPTIONS, useValue: DEFAULT_RUN_STREAM_OPTIONS }],
  exports: [AgentRunsService, AgentJournalService, RunExecutorService, RunTraceService,
    RunLiveHub, RunStreamService] })
export class AgentModule {}
