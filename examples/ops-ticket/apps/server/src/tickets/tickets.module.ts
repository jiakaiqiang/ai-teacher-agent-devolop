import { StaffActionsController } from './staff-actions.controller.js';
import { SolutionController } from '../knowledge/solution.controller.js';
import { SolutionService } from '../knowledge/solution.service.js';
import { RecommendationController } from '../retrieval/recommendation.controller.js';
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
  controllers: [StaffActionsController, SolutionController, RecommendationController, NoticesController, TicketsController, CategoriesController, TicketWriteController],
  providers: [SolutionService, WorklistStats, TicketsService, TicketCommands, SubmitTicket],
})
export class TicketsModule {}
