export type SignalType = 'whistle1' | 'whistle2' | 'shortLong' | 'train' | 'tutu';
/** Signals plus service sounds: countdown tick and the start / finish gong. */
export type SoundId = SignalType | 'tick' | 'gong';

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
  'shortLong',
  'train',
  'tutu',
];

export const SOUND_IDS: readonly SoundId[] = [...SIGNAL_TYPES, 'tick', 'gong'];

export const SIGNALS: Readonly<Record<SoundId, SignalInfo>> = {
  whistle1: { code: 'whistle1', name: 'Короткий свисток', file: 'whistle1.wav', durationMs: 200 },
  whistle2: { code: 'whistle2', name: '2 свистка', file: 'whistle2.wav', durationMs: 370 },
  shortLong: {
    code: 'shortLong',
    name: 'Короткий-длинный',
    file: 'shortLong.wav',
    durationMs: 590,
  },
  tutu: { code: 'tutu', name: 'Ту-ту', file: 'tutu.wav', durationMs: 430 },
  train: { code: 'train', name: 'Ту', file: 'train.wav', durationMs: 450 },
  tick: { code: 'tick', name: 'Тик', file: 'tick.wav', durationMs: 40 },
  gong: { code: 'gong', name: 'Гонг', file: 'gong.wav', durationMs: 2500 },
};

export function isSignalType(value: unknown): value is SignalType {
  return typeof value === 'string' && (SIGNAL_TYPES as readonly string[]).includes(value);
}
