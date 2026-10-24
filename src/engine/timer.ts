import type { Rng } from '../domain/rng';
import { generateSchedule, type ScheduleEvent } from '../domain/schedule';
import type { Settings } from '../domain/settings';
import type { SoundId } from '../domain/signals';

export type TimerState = 'settings' | 'countdown' | 'running' | 'paused' | 'finished';

export interface Clock {
  /** Monotonic milliseconds (performance.now in the browser). */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Player {
  play(id: SoundId): void | Promise<unknown>;
}

export interface TickInfo {
  state: TimerState;
  /** Whole countdown seconds left (5…1) while in countdown. */
  countdownLeftMs: number;
  elapsedMs: number;
  remainingMs: number;
  durationMs: number;
  played: number;
  total: number;
}

export interface TimerEvents {
  onState?(state: TimerState, prev: TimerState): void;
  onTick?(info: TickInfo): void;
  onSignal?(event: ScheduleEvent, index: number): void;
  onFinish?(log: ScheduleEvent[]): void;
  onAudioError?(error: unknown): void;
}

export interface TimerDeps {
  clock: Clock;
  player: Player;
  rng: Rng;
  events?: TimerEvents;
  /** UI refresh period. Scheduling itself does not depend on ticks. */
  tickMs?: number;
}

/**
 * State machine: settings → countdown → running ⇄ paused → finished → (repeat → countdown).
 * Time is measured against clock.now() rather than counted from ticks, so it does not drift;
 * a late wake-up plays every overdue signal exactly once.
 */
export class Timer {
  private _state: TimerState = 'settings';
  private settings: Settings | null = null;
  private schedule: ScheduleEvent[] = [];
  private next = 0;
  private log: ScheduleEvent[] = [];
  private handle: unknown = null;
  private countdownStart = 0;
  private segmentStart = 0;
  private runOffset = 0;
  private pausedFrom: 'countdown' | 'running' = 'running';
  private readonly tickMs: number;

  constructor(private readonly deps: TimerDeps) {
    this.tickMs = deps.tickMs ?? 200;
  }

  get state(): TimerState {
    return this._state;
  }

  /** Current schedule; exposed for tests and the e2e harness only — the UI never shows it. */
  get currentSchedule(): readonly ScheduleEvent[] {
    return this.schedule;
  }

  get playedLog(): readonly ScheduleEvent[] {
    return this.log;
  }

  start(settings: Settings): void {
    if (this._state !== 'settings' && this._state !== 'finished') return;
    this.settings = settings;
    this.begin();
  }

  /** Finish → countdown with a brand-new random schedule. */
  repeat(): void {
    if (this._state !== 'finished' || !this.settings) return;
    this.begin();
  }

  pause(): void {
    if (this._state === 'running') {
      this.runOffset = this.elapsed();
      this.pausedFrom = 'running';
    } else if (this._state === 'countdown') {
      this.pausedFrom = 'countdown';
    } else {
      return;
    }
    this.cancel();
    this.setState('paused');
    this.emitTick();
  }

  resume(): void {
    if (this._state !== 'paused') return;
    if (this.pausedFrom === 'countdown') {
      this.enterCountdown();
    } else {
      this.segmentStart = this.deps.clock.now();
      this.setState('running');
      this.step();
    }
  }

  /** Stop from any state → settings. Nothing plays afterwards. */
  stop(): void {
    this.cancel();
    if (this._state !== 'settings') this.setState('settings');
  }

  /** Page hidden / Telegram deactivated → auto-pause. Coming back does not resume by itself. */
  setHidden(hidden: boolean): void {
    if (hidden) this.pause();
  }

  snapshot(): TickInfo {
    const durationMs = this.durationMs();
    const elapsedMs =
      this._state === 'running'
        ? Math.min(this.elapsed(), durationMs)
        : this._state === 'finished'
          ? durationMs
          : this._state === 'paused' && this.pausedFrom === 'running'
            ? this.runOffset
            : 0;
    return {
      state: this._state,
      countdownLeftMs:
        this._state === 'countdown'
          ? Math.max(0, this.countdownMs() - (this.deps.clock.now() - this.countdownStart))
          : 0,
      elapsedMs,
      remainingMs: Math.max(0, durationMs - elapsedMs),
      durationMs,
      played: this.next,
      total: this.schedule.length,
    };
  }

  private begin(): void {
    const settings = this.settings as Settings;
    this.cancel();
    this.schedule = generateSchedule(settings, this.deps.rng);
    this.next = 0;
    this.log = [];
    this.runOffset = 0;
    this.enterCountdown();
  }

  private enterCountdown(): void {
    if (this.countdownMs() <= 0) {
      this.enterRunning();
      return;
    }
    this.countdownStart = this.deps.clock.now();
    this.setState('countdown');
    this.step();
  }

  private enterRunning(): void {
    this.runOffset = 0;
    this.segmentStart = this.deps.clock.now();
    this.setState('running');
    this.step();
  }

  private step = (): void => {
    this.handle = null;
    const clock = this.deps.clock;
    if (this._state === 'countdown') {
      const left = this.countdownMs() - (clock.now() - this.countdownStart);
      if (left <= 0) {
        this.enterRunning();
        return;
      }
      this.emitTick();
      this.arm(Math.min(this.tickMs, left));
      return;
    }
    if (this._state !== 'running') return;

    const elapsed = this.elapsed();
    while (
      this.next < this.schedule.length &&
      (this.schedule[this.next] as ScheduleEvent).atMs <= elapsed
    ) {
      const ev = this.schedule[this.next] as ScheduleEvent;
      const index = this.next;
      this.next++;
      this.log.push(ev);
      this.play(ev.type);
      this.deps.events?.onSignal?.(ev, index);
      if (this._state !== 'running') return; // a listener stopped or paused us
    }

    const T = this.durationMs();
    if (elapsed >= T) {
      this.play('finish');
      this.setState('finished');
      this.emitTick();
      this.deps.events?.onFinish?.([...this.log]);
      return;
    }

    this.emitTick();
    const nextAt = this.schedule[this.next]?.atMs ?? T;
    this.arm(Math.min(this.tickMs, nextAt - elapsed, T - elapsed));
  };

  private play(id: SoundId): void {
    try {
      const r = this.deps.player.play(id);
      if (r && typeof (r as Promise<unknown>).catch === 'function') {
        (r as Promise<unknown>).catch((e: unknown) => this.deps.events?.onAudioError?.(e));
      }
    } catch (e) {
      this.deps.events?.onAudioError?.(e);
    }
  }

  private arm(ms: number): void {
    this.handle = this.deps.clock.setTimeout(this.step, Math.max(0, Math.ceil(ms)));
  }

  private cancel(): void {
    if (this.handle !== null) {
      this.deps.clock.clearTimeout(this.handle);
      this.handle = null;
    }
  }

  private elapsed(): number {
    return this.runOffset + (this.deps.clock.now() - this.segmentStart);
  }

  private durationMs(): number {
    return Math.round((this.settings?.durationSec ?? 0) * 1000);
  }

  private countdownMs(): number {
    return (this.settings?.countdownSec ?? 0) * 1000;
  }

  private setState(next: TimerState): void {
    const prev = this._state;
    this._state = next;
    this.deps.events?.onState?.(next, prev);
  }

  private emitTick(): void {
    this.deps.events?.onTick?.(this.snapshot());
  }
}
