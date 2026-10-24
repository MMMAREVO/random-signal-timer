import type { Clock } from '../../src/engine/timer';

interface Pending {
  id: number;
  at: number;
  fn: () => void;
}

/** Deterministic clock: advance() fires due timers in order; jump() moves time without firing. */
export class FakeClock implements Clock {
  private t = 1000;
  private seq = 0;
  private timers: Pending[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((p) => p.id !== handle);
  }

  get pending(): number {
    return this.timers.length;
  }

  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers
        .filter((p) => p.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((p) => p !== due);
      this.t = Math.max(this.t, due.at);
      due.fn();
    }
    this.t = target;
  }

  /** Browser was busy: time passes, no timer fires. */
  jump(ms: number): void {
    this.t += ms;
  }
}
