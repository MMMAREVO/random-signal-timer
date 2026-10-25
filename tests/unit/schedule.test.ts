import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mulberry32 } from '../../src/domain/rng';
import { generateSchedule, ScheduleError, type ScheduleEvent } from '../../src/domain/schedule';
import {
  QUIET_END_MS,
  QUIET_START_MS,
  defaultSettings,
  maxSignals,
  type Settings,
} from '../../src/domain/settings';
import { SIGNALS, SIGNAL_TYPES, type SignalType } from '../../src/domain/signals';

const EPS = 1e-6;
const s = (patch: Partial<Settings>): Settings => ({ ...defaultSettings(), ...patch });
const end = (e: ScheduleEvent) => e.atMs + SIGNALS[e.type].durationMs;

/** Arbitrary valid settings with N anywhere in 1…Nmax. */
const validSettings = fc
  .record({
    durationSec: fc.integer({ min: 2, max: 720 }).map((k) => k * 5),
    types: fc.subarray([...SIGNAL_TYPES], { minLength: 1 }),
    gapSec: fc.integer({ min: 1, max: 20 }).map((k) => k * 0.5),
    countFraction: fc.double({ min: 0, max: 1, noNaN: true }),
  })
  .map(({ countFraction, ...rest }) => {
    const max = maxSignals(rest);
    return s({ ...rest, count: Math.max(1, Math.min(max, Math.ceil(countFraction * max))) });
  });
const seed = fc.integer({ min: 0, max: 2 ** 31 });

describe('rng', () => {
  it('TC-10: одно зерно — одинаковая последовательность, разные — разные; значения в [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const sa = Array.from({ length: 1000 }, a);
    const sb = Array.from({ length: 1000 }, b);
    const sc = Array.from({ length: 1000 }, c);
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of [...sa, ...sc]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateSchedule', () => {
  it('TC-11: ровно N событий', () => {
    fc.assert(
      fc.property(validSettings, seed, (settings, sd) => {
        expect(generateSchedule(settings, mulberry32(sd))).toHaveLength(settings.count);
      }),
      { numRuns: 300 },
    );
  });

  it('TC-12: события отсортированы по времени', () => {
    fc.assert(
      fc.property(validSettings, seed, (settings, sd) => {
        const ev = generateSchedule(settings, mulberry32(sd));
        for (let i = 1; i < ev.length; i++) {
          expect(ev[i]!.atMs).toBeGreaterThan(ev[i - 1]!.atMs);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('TC-13: первый сигнал ≥ 4 с; конец последнего ≤ T − 1 с (property)', () => {
    fc.assert(
      fc.property(validSettings, seed, (settings, sd) => {
        const ev = generateSchedule(settings, mulberry32(sd));
        expect(ev[0]!.atMs).toBeGreaterThanOrEqual(QUIET_START_MS - EPS);
        expect(end(ev.at(-1)!)).toBeLessThanOrEqual(
          settings.durationSec * 1000 - QUIET_END_MS + EPS,
        );
      }),
      { numRuns: 1000 },
    );
  });

  it('TC-14: от конца одного до начала следующего ≥ g, наложений нет (1000 зёрен)', () => {
    fc.assert(
      fc.property(validSettings, seed, (settings, sd) => {
        const ev = generateSchedule(settings, mulberry32(sd));
        for (let i = 1; i < ev.length; i++) {
          expect(ev[i]!.atMs - end(ev[i - 1]!)).toBeGreaterThanOrEqual(
            settings.gapSec * 1000 - EPS,
          );
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('TC-15: в расписании только выбранные типы', () => {
    fc.assert(
      fc.property(validSettings, seed, (settings, sd) => {
        for (const e of generateSchedule(settings, mulberry32(sd))) {
          expect(settings.types).toContain(e.type);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('TC-16: N ≥ k — каждый выбранный тип хотя бы раз; N < k — N разных типов', () => {
    fc.assert(
      fc.property(validSettings, seed, (settings, sd) => {
        const types = generateSchedule(settings, mulberry32(sd)).map((e) => e.type);
        const unique = new Set(types);
        if (settings.count >= settings.types.length) {
          expect(unique.size).toBe(settings.types.length);
        } else {
          expect(unique.size).toBe(settings.count);
        }
      }),
      { numRuns: 500 },
    );
    const few = generateSchedule(s({ count: 3 }), mulberry32(1)).map((e) => e.type);
    expect(new Set(few).size).toBe(3);
  });

  it('TC-17: одно зерно → одно расписание; разные зёрна → разные', () => {
    const settings = s({ count: 10 });
    expect(generateSchedule(settings, mulberry32(7))).toEqual(
      generateSchedule(settings, mulberry32(7)),
    );
    expect(generateSchedule(settings, mulberry32(7))).not.toEqual(
      generateSchedule(settings, mulberry32(8)),
    );
  });

  it('TC-18: промежутки случайны и не равны, сигналы не скапливаются у края (1000 прогонов)', () => {
    const settings = s({ durationSec: 60, count: 10 });
    const T = 60_000;
    let firstHalf = 0;
    let secondHalf = 0;
    let sumMean = 0;
    for (let sd = 0; sd < 1000; sd++) {
      const ev = generateSchedule(settings, mulberry32(sd));
      const gaps = ev.slice(1).map((e, i) => e.atMs - ev[i]!.atMs);
      // gaps are not all the same within one schedule
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(100);
      for (const e of ev) {
        if (e.atMs < T / 2) firstHalf++;
        else secondHalf++;
      }
      sumMean += ev.reduce((a, e) => a + e.atMs, 0) / ev.length;
    }
    const meanOfMeans = sumMean / 1000;
    // Average signal position stays near the middle of the period.
    expect(meanOfMeans).toBeGreaterThan(T * 0.4);
    expect(meanOfMeans).toBeLessThan(T * 0.6);
    // Neither half collects most of the signals.
    expect(firstHalf / (firstHalf + secondHalf)).toBeGreaterThan(0.4);
    expect(firstHalf / (firstHalf + secondHalf)).toBeLessThan(0.6);
    // First signal does not always sit right at the quiet zone.
    const firsts = Array.from(
      { length: 200 },
      (_, sd) => generateSchedule(settings, mulberry32(sd))[0]!.atMs,
    );
    expect(new Set(firsts.map((x) => Math.round(x))).size).toBeGreaterThan(150);
  });

  it('TC-19: равномерность типов (10 000 сигналов, 3 типа) — доля каждого 33 % ± 3 %', () => {
    const types: SignalType[] = ['whistle1', 'whistle2', 'tutu'];
    const settings = s({ durationSec: 60, types, count: 10 });
    const counts = new Map<SignalType, number>();
    let total = 0;
    for (let sd = 0; sd < 1000; sd++) {
      for (const e of generateSchedule(settings, mulberry32(sd))) {
        counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
        total++;
      }
    }
    expect(total).toBe(10_000);
    for (const t of types) {
      const share = (counts.get(t) ?? 0) / total;
      expect(share).toBeGreaterThan(1 / 3 - 0.03);
      expect(share).toBeLessThan(1 / 3 + 0.03);
    }
  });

  it('TC-20: N = Nмакс, только самый длинный тип («Короткий-длинный») — расписание строится, правила соблюдены', () => {
    for (const durationSec of [10, 60, 300, 3600]) {
      const base = s({ durationSec, types: ['shortLong'] });
      const settings = { ...base, count: maxSignals(base) };
      for (let sd = 0; sd < 100; sd++) {
        const ev = generateSchedule(settings, mulberry32(sd));
        expect(ev).toHaveLength(settings.count);
        expect(ev[0]!.atMs).toBeGreaterThanOrEqual(QUIET_START_MS - EPS);
        expect(end(ev.at(-1)!)).toBeLessThanOrEqual(durationSec * 1000 - QUIET_END_MS + EPS);
        for (let i = 1; i < ev.length; i++) {
          expect(ev[i]!.atMs - end(ev[i - 1]!)).toBeGreaterThanOrEqual(
            settings.gapSec * 1000 - EPS,
          );
        }
      }
    }
  });

  it('TC-21: N > Nмакс напрямую в функцию — понятная ошибка, без зависания', () => {
    const settings = s({ count: 19 });
    expect(() => generateSchedule(settings, mulberry32(1))).toThrow(ScheduleError);
    expect(() => generateSchedule(settings, mulberry32(1))).toThrow(/максимум 18/);
    expect(() => generateSchedule(s({ count: 10_000 }), mulberry32(1))).toThrow(ScheduleError);
  });
});
