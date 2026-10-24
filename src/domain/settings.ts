import { SIGNALS, SIGNAL_TYPES, type SignalType } from './signals';

export type CountdownSec = 0 | 3 | 5 | 10;

export interface Settings {
  /** Period length T, seconds. */
  durationSec: number;
  /** Enabled signal types (k of them). */
  types: SignalType[];
  /** Total number of signals N. */
  count: number;
  /** Minimal pause g between the end of one signal and the start of the next, seconds. */
  gapSec: number;
  countdownSec: CountdownSec;
  /** Flash colour + big signal name for 1.5 s. */
  showFlash: boolean;
}

export const MIN_DURATION_SEC = 10;
export const MAX_DURATION_SEC = 60 * 60;
export const DURATION_STEP_SEC = 5;
export const MIN_GAP_SEC = 0.5;
export const MAX_GAP_SEC = 10;
export const GAP_STEP_SEC = 0.5;
export const COUNTDOWN_OPTIONS: readonly CountdownSec[] = [0, 3, 5, 10];
/** Quiet zones (fixed in v1): first signal starts ≥ 4 s after start, last ends ≥ 1 s before end. */
export const QUIET_START_MS = 4000;
export const QUIET_END_MS = 1000;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  durationSec: 60,
  types: [...SIGNAL_TYPES],
  count: 10,
  gapSec: 2.5,
  countdownSec: 5,
  showFlash: true,
};

export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, types: [...DEFAULT_SETTINGS.types] };
}

export interface ValidationErrors {
  duration?: string;
  types?: string;
  count?: string;
  gap?: string;
  countdown?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrors;
  maxSignals: number;
}

/**
 * N_max = floor((T − t_start − t_end + g) / (d_max + g)), d_max — the longest enabled type.
 * Returns 0 when no type is enabled. All math in whole milliseconds.
 */
export function maxSignals(s: Pick<Settings, 'durationSec' | 'types' | 'gapSec'>): number {
  if (s.types.length === 0) return 0;
  const T = Math.round(s.durationSec * 1000);
  const g = Math.round(s.gapSec * 1000);
  const dMax = Math.max(...s.types.map((t) => SIGNALS[t].durationMs));
  const n = Math.floor((T - QUIET_START_MS - QUIET_END_MS + g) / (dMax + g));
  return Math.max(0, n);
}

function isMultiple(value: number, step: number): boolean {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

function durationOk(sec: number): boolean {
  return (
    Number.isFinite(sec) &&
    sec >= MIN_DURATION_SEC &&
    sec <= MAX_DURATION_SEC &&
    isMultiple(sec, DURATION_STEP_SEC)
  );
}

function gapOk(sec: number): boolean {
  return (
    Number.isFinite(sec) &&
    sec >= MIN_GAP_SEC &&
    sec <= MAX_GAP_SEC &&
    isMultiple(sec, GAP_STEP_SEC)
  );
}

export function validate(s: Settings): ValidationResult {
  const errors: ValidationErrors = {};

  if (!durationOk(s.durationSec)) {
    errors.duration = 'Длительность: от 10 с до 60 мин, шаг 5 с';
  }
  if (s.types.length === 0) {
    errors.types = 'Выберите хотя бы один сигнал';
  }
  if (!gapOk(s.gapSec)) {
    errors.gap = 'Пауза: от 0,5 до 10 с, шаг 0,5 с';
  }
  if (!COUNTDOWN_OPTIONS.includes(s.countdownSec)) {
    errors.countdown = 'Отсчёт: 0, 3, 5 или 10 с';
  }

  const max = errors.duration || errors.gap ? 0 : maxSignals(s);
  if (!Number.isInteger(s.count) || s.count < 1) {
    errors.count = 'Число сигналов — целое число от 1';
  } else if (!errors.duration && !errors.types && !errors.gap && s.count > max) {
    errors.count = `Слишком много сигналов: максимум ${max} для этих настроек`;
  }

  return { valid: Object.keys(errors).length === 0, errors, maxSignals: max };
}
