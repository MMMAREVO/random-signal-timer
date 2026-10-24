import { vi } from 'vitest';
import { mulberry32 } from '../../src/domain/rng';
import { defaultSettings, type Settings } from '../../src/domain/settings';
import type { SoundId } from '../../src/domain/signals';
import type { AudioPlayer } from '../../src/platform/audio';
import type { SettingsStorage } from '../../src/platform/storage';
import type { TelegramBridge } from '../../src/platform/telegram';
import type { WakeLockController } from '../../src/platform/wakeLock';
import { createApp } from '../../src/ui/app';
import { FakeClock } from './fakeClock';

export interface Harness {
  root: HTMLElement;
  clock: FakeClock;
  played: SoundId[];
  audio: AudioPlayer & {
    unlock: ReturnType<typeof vi.fn>;
    failNext: boolean;
    blockedListeners: Array<(e: unknown) => void>;
  };
  telegram: TelegramBridge & { calls: string[]; setActive(active: boolean): void };
  wake: WakeLockController & { log: string[] };
  saved: Settings[];
  app: Awaited<ReturnType<typeof createApp>>;
  /** Advance the engine clock and the UI's own timers (flash) together. */
  advance(ms: number): void;
}

export async function mountApp(initial: Partial<Settings> = {}): Promise<Harness> {
  document.body.innerHTML = '<main id="app"></main>';
  const root = document.getElementById('app') as HTMLElement;
  const clock = new FakeClock();
  const played: SoundId[] = [];
  const blockedListeners: Array<(e: unknown) => void> = [];
  const audio = {
    failNext: false,
    blockedListeners,
    unlock: vi.fn(),
    play(id: SoundId) {
      played.push(id);
      if (audio.failNext) {
        audio.failNext = false;
        const err = new DOMException('blocked', 'NotAllowedError');
        blockedListeners.forEach((l) => l(err));
        return Promise.reject(err);
      }
      return Promise.resolve();
    },
    onBlocked: (l: (e: unknown) => void) => void blockedListeners.push(l),
  };
  let activeCb: ((a: boolean) => void) | null = null;
  const calls: string[] = [];
  const telegram = {
    isTelegram: true,
    cloudStorage: null,
    calls,
    init: () => void calls.push('init'),
    setClosingConfirmation: (on: boolean) => void calls.push(`closing:${on}`),
    haptic: (k: string) => void calls.push(`haptic:${k}`),
    onActiveChange: (cb: (a: boolean) => void) => void (activeCb = cb),
    setActive: (a: boolean) => activeCb?.(a),
  };
  const log: string[] = [];
  const wake = {
    supported: true,
    log,
    acquire: async () => void log.push('acquire'),
    release: async () => void log.push('release'),
  };
  const saved: Settings[] = [];
  const storage: SettingsStorage = {
    load: async () => ({ ...defaultSettings(), ...initial }),
    save: async (s) => void saved.push(s),
  };
  const app = await createApp({
    root,
    audio,
    telegram,
    storage,
    wakeLock: wake,
    clock,
    rng: mulberry32(99),
    version: 'v-test',
  });
  return {
    root,
    clock,
    played,
    audio,
    telegram,
    wake,
    saved,
    app,
    advance(ms) {
      clock.advance(ms);
      vi.advanceTimersByTime(ms);
    },
  };
}
