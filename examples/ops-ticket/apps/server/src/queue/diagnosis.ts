import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { ModelGateway } from '../assistant/model-gateway.js';
import { TriageService } from '../assistant/triage.service.js';
import { diagnoseTicket } from './diagnose-ticket.js';
import { queueRootOptions } from './queue.config.js';

export interface DiagnosisTask { ticketNo:string; version:number }
export function diagnosisQueue() {
  return new Queue<DiagnosisTask>('diagnosis', queueRootOptions());
}
export function diagnosisWorker(db:PrismaService) {
  const triage = new TriageService(new ModelGateway());
  return new Worker<DiagnosisTask>('diagnosis',async job=>{
    await diagnoseTicket(db,triage,job.data.ticketNo,job.data.version);
  },queueRootOptions());
}
