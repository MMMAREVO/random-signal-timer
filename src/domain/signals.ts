export type SignalType = 'beep1' | 'beep2' | 'beep3' | 'horn1' | 'tutu';
export type SoundId = SignalType | 'finish';

export interface SignalInfo {
  code: SoundId;
  name: string;
  file: string;
  /** Exact length of the WAV file. The schedule relies on it. */
  durationMs: number;
}

/** Order used on the settings screen. */
export const SIGNAL_TYPES: readonly SignalType[] = ['beep1', 'beep2', 'beep3', 'horn1', 'tutu'];

export const SOUND_IDS: readonly SoundId[] = [...SIGNAL_TYPES, 'finish'];

export const SIGNALS: Readonly<Record<SoundId, SignalInfo>> = {
  beep1: { code: 'beep1', name: '1 бип', file: 'beep1.wav', durationMs: 100 },
  beep2: { code: 'beep2', name: '2 бипа', file: 'beep2.wav', durationMs: 290 },
  beep3: { code: 'beep3', name: '3 бипа', file: 'beep3.wav', durationMs: 390 },
  horn1: { code: 'horn1', name: '1 гудок', file: 'horn1.wav', durationMs: 350 },
  tutu: { code: 'tutu', name: 'Ту-ту', file: 'tutu.wav', durationMs: 340 },
  finish: { code: 'finish', name: 'Финиш', file: 'finish.wav', durationMs: 1500 },
};

export function isSignalType(value: unknown): value is SignalType {
  return typeof value === 'string' && (SIGNAL_TYPES as readonly string[]).includes(value);
}
