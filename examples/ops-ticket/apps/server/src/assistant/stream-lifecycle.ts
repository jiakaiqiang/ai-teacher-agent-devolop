import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';
import type { AssistantEvent, ToolSessionEvent } from '@ops-ticket/shared';
import { ModelError } from './chat.client.js';

export interface StreamPolicy { totalMs: number; idleMs: number; }
export class StreamLease {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly total: ReturnType<typeof setTimeout>;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly closed = () => { if (!this.res.writableFinished) this.cancel('MODEL_CANCELLED'); };
  private readonly failed = () => this.cancel('MODEL_CANCELLED');
  constructor(private readonly res: Response, private readonly policy: StreamPolicy, private readonly release: () => void) {
    res.once('close', this.closed); res.once('error', this.failed);
    this.total = setTimeout(() => this.cancel('MODEL_TIMEOUT'), policy.totalMs);
    this.touch();
    if (res.destroyed) this.closed();
  }
  cancel(code: 'MODEL_TIMEOUT' | 'MODEL_CANCELLED') { if (!this.signal.aborted) this.controller.abort(new ModelError(code)); }
  touch() {
    if (this.disposed || this.signal.aborted) return;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.cancel('MODEL_TIMEOUT'), this.policy.idleMs);
  }
  async send(event: AssistantEvent | ToolSessionEvent): Promise<void> {
    this.signal.throwIfAborted();
    if (this.res.destroyed) throw new ModelError('MODEL_CANCELLED');
    const accepted = this.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (!accepted) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { this.res.off('drain', drained); this.signal.removeEventListener('abort', aborted); };
        const drained = () => { cleanup(); resolve(); };
        const aborted = () => { cleanup(); reject(this.signal.reason); };
        this.res.once('drain', drained); this.signal.addEventListener('abort', aborted, { once: true });
        if (this.signal.aborted) aborted();
      });
    }
    this.signal.throwIfAborted();
    this.touch(); // 应用事件进展重置空闲预算，注释心跳不算生成进展。
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; clearTimeout(this.total); clearTimeout(this.idle);
    this.res.off('close', this.closed); this.res.off('error', this.failed);
    this.cancel('MODEL_CANCELLED'); this.release();
  }
}

@Injectable()
export class AssistantStreams implements OnModuleDestroy {
  private readonly leases = new Set<StreamLease>();
  private closing = false;
  policy(): StreamPolicy { return { totalMs: 30_000, idleMs: 10_000 }; }
  get activeCount() { return this.leases.size; }
  open(res: Response): StreamLease {
    if (this.closing) throw new ModelError('MODEL_CANCELLED');
    const lease = new StreamLease(res, this.policy(), () => this.leases.delete(lease));
    this.leases.add(lease); return lease;
  }
  beginShutdown() { this.closing = true; for (const lease of this.leases) lease.cancel('MODEL_CANCELLED'); }
  onModuleDestroy() { this.beginShutdown(); }
}
