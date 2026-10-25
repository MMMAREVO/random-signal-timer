import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_SETTINGS,
  defaultSettings,
  maxSignals,
  validate,
  type Settings,
} from '../../src/domain/settings';
import { SIGNAL_TYPES } from '../../src/domain/signals';

const s = (patch: Partial<Settings>): Settings => ({ ...defaultSettings(), ...patch });

describe('settings', () => {
  it('TC-01: значения по умолчанию: 60 с, все 5 типов, N = 10, g = 2,5 с; валидация проходит', () => {
    expect(DEFAULT_SETTINGS.durationSec).toBe(60);
    expect([...DEFAULT_SETTINGS.types].sort()).toEqual([...SIGNAL_TYPES].sort());
    expect(DEFAULT_SETTINGS.types).toHaveLength(5);
    expect(DEFAULT_SETTINGS.count).toBe(10);
    expect(DEFAULT_SETTINGS.gapSec).toBe(2.5);
    expect(DEFAULT_SETTINGS.countdownSec).toBe(5);
    expect(validate(defaultSettings())).toMatchObject({ valid: true, errors: {} });
  });

  it.each([5, 9, 3605])('TC-02: T = %i с — ошибка «длительность»', (durationSec) => {
    const r = validate(s({ durationSec, count: 1 }));
    expect(r.valid).toBe(false);
    expect(r.errors.duration).toMatch(/длительность/i);
  });

  it.each([10, 3600])('TC-02: T = %i с — валидна', (durationSec) => {
    const r = validate(s({ durationSec, count: 1 }));
    expect(r.errors.duration).toBeUndefined();
    expect(r.valid).toBe(true);
  });

  it('TC-03: T не кратна 5 с (62 с) — ошибка «длительность»', () => {
    const r = validate(s({ durationSec: 62 }));
    expect(r.valid).toBe(false);
    expect(r.errors.duration).toMatch(/длительность/i);
  });

  it('TC-04: не выбран ни один тип — ошибка «выберите хотя бы один сигнал»', () => {
    const r = validate(s({ types: [] }));
    expect(r.valid).toBe(false);
    expect(r.errors.types).toMatch(/выберите хотя бы один сигнал/i);
  });

  it.each([0, -1, 2.5])('TC-05: N = %s — ошибка «число сигналов»', (count) => {
    const r = validate(s({ count }));
    expect(r.valid).toBe(false);
    expect(r.errors.count).toMatch(/число сигналов/i);
  });

  it('TC-06: maxSignals: 60 с, все типы, g = 2,5 с → 19', () => {
    // floor((60 − 4 − 1 + 2,5) / (0,45 + 2,5)) = floor(57,5 / 2,95) = 19
    expect(maxSignals(s({ durationSec: 60, gapSec: 2.5 }))).toBe(19);
  });

  it('TC-07: maxSignals: 60 с, только «Кря» → 21 (максимум зависит от самого длинного типа)', () => {
    // floor(57,5 / (0,2 + 2,5)) = 21
    expect(maxSignals(s({ durationSec: 60, types: ['quack'] }))).toBe(21);
    expect(maxSignals(s({ durationSec: 60, types: ['quack', 'whistle2'] }))).toBe(20);
  });

  it('TC-08: N = Nмакс валидно; N = Nмакс + 1 — ошибка «максимум 19»', () => {
    expect(validate(s({ count: 19 })).valid).toBe(true);
    const r = validate(s({ count: 20 }));
    expect(r.valid).toBe(false);
    expect(r.errors.count).toContain('максимум 19');
    expect(r.maxSignals).toBe(19);
  });

  it('TC-09: при любых допустимых T, типах, g — Nмакс ≥ 1 (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 720 }).map((k) => k * 5),
        fc.subarray([...SIGNAL_TYPES], { minLength: 1 }),
        fc.integer({ min: 1, max: 20 }).map((k) => k * 0.5),
        (durationSec, types, gapSec) => {
          const settings = s({ durationSec, types, gapSec, count: 1 });
          expect(validate(settings).valid).toBe(true);
          expect(maxSignals(settings)).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
