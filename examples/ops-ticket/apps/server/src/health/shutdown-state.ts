import { Injectable } from '@nestjs/common';

@Injectable()
export class ShutdownState {
  private stopping = false;
  private active = 0;
  private readonly waiters = new Set<() => void>();
  get draining() { return this.stopping; }
  begin() { this.stopping = true; }
  trackResponse(): () => void {
    this.active++;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.active--;
      if (this.active === 0) {
        for (const resolve of this.waiters) resolve();
        this.waiters.clear();
      }
    };
  }
  waitForResponses(): Promise<void> {
    if (this.active === 0) return Promise.resolve();
    return new Promise((resolve) => { this.waiters.add(resolve); });
  }
}
