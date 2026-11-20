import { Inject, Injectable, type MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AgentJournalService } from './agent-journal.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const RUN_STREAM_OPTIONS = 'run-stream-options';
export interface RunStreamOptions { heartbeatMs: number; pollMs: number; }
export const DEFAULT_RUN_STREAM_OPTIONS: RunStreamOptions = { heartbeatMs: 15_000, pollMs: 3_000 };
export const runCursor = (seq: number) => 'r-' + seq;

import { RunLiveHub } from './run-live.hub.js';

@Injectable()
export class RunStreamService {
  private readonly connections = new Set<symbol>();
  private readonly closers = new Set<() => void>();
  private stopping = false;
  get activeConnections() { return this.connections.size; }

  constructor(private readonly journal: AgentJournalService, private readonly live: RunLiveHub,
    private readonly db: PrismaService,
    @Inject(RUN_STREAM_OPTIONS) private readonly options: RunStreamOptions) {}

  // 关闭前主动通知客户端重连，不是悄悄断开（沿用 D33 的做法）。
  beginShutdown() {
    this.stopping = true;
    for (const close of this.closers) close();
  }

  open(runId: string, after: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>(observer => {
      if (this.stopping) { observer.complete(); return; }
      const connection = Symbol();
      this.connections.add(connection);
      let disposed = false;
      let running = false;
      let dirty = true;
      let cursor = after;
      const close = () => {
        observer.next({ id: runCursor(cursor), type: 'reauth', data: { reason: 'server-shutdown' } });
        observer.complete();
      };
      this.closers.add(close);

      const drain = async () => {
        dirty = true;
        if (running || disposed) return;
        running = true;
        try {
          while (dirty && !disposed) {
            dirty = false;
            // 按 seq 续传：客户端带着已收到的最大序号，不会重复也不会漏。
            const events = await this.journal.events(runId, cursor, 100);
            for (const event of events) {
              if (disposed) return;
              cursor = event.seq;
              observer.next({ id: runCursor(cursor), type: event.type,
                data: { seq: event.seq, type: event.type, payload: event.payload ?? {},
                  createdAt: event.createdAt.toISOString() } });
            }
            if (events.length === 100) dirty = true;
            // 运行已结束且事件全部发完，主动结束这条流，不让客户端一直挂着。
            if (!dirty) {
              const run = await this.db.agentRun.findUnique({ where: { id: runId }, select: { status: true, eventSeq: true } });
              if (!run) { observer.complete(); return; }
              const terminal = run.status !== 'queued' && run.status !== 'running';
              if (terminal && cursor >= run.eventSeq) {
                observer.next({ id: runCursor(cursor), type: 'closed', data: { status: run.status } });
                observer.complete();
                return;
              }
            }
          }
        } catch (error) {
          observer.error(error);
        } finally {
          running = false;
        }
      };

      const unsubscribe = this.live.subscribe(runId, () => { void drain(); });
      const poll = setInterval(() => { void drain(); }, this.options.pollMs);
      const heartbeat = setInterval(() => {
        // 心跳是命名事件，不推进业务游标。
        observer.next({ type: 'heartbeat', data: { at: new Date().toISOString() } });
      }, this.options.heartbeatMs);
      void drain();

      return () => {
        disposed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        unsubscribe();
        this.closers.delete(close);
        this.connections.delete(connection);
      };
    });
  }
}
