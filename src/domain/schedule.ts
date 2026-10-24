import { randomInt, shuffle, type Rng } from './rng';
import { QUIET_END_MS, QUIET_START_MS, maxSignals, validate, type Settings } from './settings';
import { SIGNALS, type SignalType } from './signals';

export interface ScheduleEvent {
  /** Start of the signal, ms from the start of the period (after the countdown). */
  atMs: number;
  type: SignalType;
}

export class ScheduleError extends Error {
  override name = 'ScheduleError';
}

function pickTypes(types: readonly SignalType[], n: number, rng: Rng): SignalType[] {
  const k = types.length;
  let picked: SignalType[];
  if (n >= k) {
    picked = [...types];
    for (let i = k; i < n; i++) picked.push(types[randomInt(rng, k)] as SignalType);
  } else {
    picked = shuffle([...types], rng).slice(0, n);
  }
  return shuffle(picked, rng);
}

/**
 * Builds the whole random schedule up front. Pure: no clocks, no sound; randomness comes from rng.
 * Free time F = T − t_start − t_end − Σd − (N−1)·g is split into N+1 random pieces by N uniform
 * points; signal i+1 starts at end of signal i + g + r_i.
 */
export function generateSchedule(settings: Settings, rng: Rng): ScheduleEvent[] {
  const n = settings.count;
  const max = maxSignals(settings);
  if (Number.isInteger(n) && n > max && settings.types.length > 0) {
    throw new ScheduleError(`Нельзя уместить ${n} сигналов в эти настройки: максимум ${max}`);
  }
  const { valid, errors } = validate(settings);
  if (!valid) {
    throw new ScheduleError(`Неверные настройки: ${Object.values(errors).join('; ')}`);
  }

  const T = Math.round(settings.durationSec * 1000);
  const g = Math.round(settings.gapSec * 1000);
  const types = pickTypes(settings.types, n, rng);
  const durations = types.map((t) => SIGNALS[t].durationMs);
  const totalSound = durations.reduce((a, b) => a + b, 0);
  const free = T - QUIET_START_MS - QUIET_END_MS - totalSound - (n - 1) * g;
  if (free < 0) {
    // Cannot happen when n ≤ maxSignals, kept as a guard.
    throw new ScheduleError('Сигналы не помещаются в период');
  }

  const points = Array.from({ length: n }, () => rng() * free).sort((a, b) => a - b);
  const pieces: number[] = [];
  let prev = 0;
  for (const p of points) {
    pieces.push(p - prev);
    prev = p;
  }

  const events: ScheduleEvent[] = [];
  let at = QUIET_START_MS + (pieces[0] ?? 0);
  for (let i = 0; i < n; i++) {
    events.push({ atMs: at, type: types[i] as SignalType });
    at += (durations[i] as number) + g + (pieces[i + 1] ?? 0);
  }
  return events;
}
