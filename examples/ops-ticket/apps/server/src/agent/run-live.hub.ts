import { Injectable } from '@nestjs/common';

// 进程内广播：同实例产生的事件立刻唤醒对应的流，不用等轮询。
@Injectable()
export class RunLiveHub {
  private readonly listeners = new Map<string, Set<() => void>>();

  subscribe(runId: string, wake: () => void) {
    const set = this.listeners.get(runId) ?? new Set();
    set.add(wake);
    this.listeners.set(runId, set);
    return () => {
      set.delete(wake);
      if (!set.size) this.listeners.delete(runId);
    };
  }

  publish(runId: string) {
    for (const wake of this.listeners.get(runId) ?? []) wake();
  }

  get watched() { return this.listeners.size; }
}
