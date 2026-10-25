export type SignalType = 'whistle1' | 'whistle2' | 'whistleLong' | 'bibeep' | 'train';
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
  'whistleLong',
  'bibeep',
  'train',
];

export const SOUND_IDS: readonly SoundId[] = [...SIGNAL_TYPES, 'finish'];

export const SIGNALS: Readonly<Record<SoundId, SignalInfo>> = {
  whistle1: { code: 'whistle1', name: 'Короткий свисток', file: 'whistle1.wav', durationMs: 200 },
  whistle2: { code: 'whistle2', name: '2 свистка', file: 'whistle2.wav', durationMs: 370 },
  whistleLong: {
    code: 'whistleLong',
    name: 'Длинный свисток',
    file: 'whistleLong.wav',
    durationMs: 800,
  },
  bibeep: { code: 'bibeep', name: 'Би-бип', file: 'bibeep.wav', durationMs: 270 },
  train: { code: 'train', name: 'Ту-ту', file: 'train.wav', durationMs: 680 },
  finish: { code: 'finish', name: 'Финиш', file: 'finish.wav', durationMs: 1500 },
};

export function isSignalType(value: unknown): value is SignalType {
  return typeof value === 'string' && (SIGNAL_TYPES as readonly string[]).includes(value);
}
