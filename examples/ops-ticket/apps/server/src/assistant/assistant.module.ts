import { ToolSessionsController } from './tool-sessions.controller.js';
import { ToolSessionService } from './tool-session.service.js';
import { ConversationsService } from './conversations.service.js';
import { ReadToolsService } from './read-tools.service.js';
import { AiQuotaService } from './ai-quota.service.js';
import { TriageService } from './triage.service.js';
import { AssistantStreams } from './stream-lifecycle.js';
import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { ModelSource } from './model.source.js';
import { ModelGateway } from './model-gateway.js';

@Module({ controllers: [ToolSessionsController, AssistantController], providers: [ToolSessionService, ConversationsService, ReadToolsService, AiQuotaService, TriageService, AssistantService, ModelSource, ModelGateway, AssistantStreams], exports: [ToolSessionService, ConversationsService, ReadToolsService, AiQuotaService, TriageService, AssistantStreams, ModelGateway] })
export class AssistantModule {}
