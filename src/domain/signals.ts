export type SignalType = 'whistle1' | 'whistle2' | 'horn1' | 'quack' | 'scream';
export type SoundId = SignalType | 'finish';

export interface SignalInfo {
  code: SoundId;
  name: string;
  file: string;
  /** Exact length of the WAV file. The schedule relies on it. */
  durationMs: number;
}

/** Order used on the settings screen. */
export const SIGNAL_TYPES: readonly SignalType[] = [
  'whistle1',
  'whistle2',
  'horn1',
  'quack',
  'scream',
];

export const SOUND_IDS: readonly SoundId[] = [...SIGNAL_TYPES, 'finish'];

export const SIGNALS: Readonly<Record<SoundId, SignalInfo>> = {
  whistle1: { code: 'whistle1', name: '1 свисток', file: 'whistle1.wav', durationMs: 280 },
  whistle2: { code: 'whistle2', name: '2 свистка', file: 'whistle2.wav', durationMs: 370 },
  horn1: { code: 'horn1', name: 'Гудок', file: 'horn1.wav', durationMs: 350 },
  quack: { code: 'quack', name: 'Кря', file: 'quack.wav', durationMs: 200 },
  scream: { code: 'scream', name: 'Крик', file: 'scream.wav', durationMs: 450 },
  finish: { code: 'finish', name: 'Финиш', file: 'finish.wav', durationMs: 1500 },
};

export function isSignalType(value: unknown): value is SignalType {
  return typeof value === 'string' && (SIGNAL_TYPES as readonly string[]).includes(value);
}
