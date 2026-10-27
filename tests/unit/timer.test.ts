import { beforeEach, describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/domain/rng';
import { defaultSettings, type Settings } from '../../src/domain/settings';
import type { SoundId } from '../../src/domain/signals';
import { Timer, type TickInfo, type TimerState } from '../../src/engine/timer';
import { FakeClock } from '../helpers/fakeClock';

interface Played {
  id: SoundId;
  at: number;
}

function setup(patch: Partial<Settings> = {}) {
  const clock = new FakeClock();
  const played: Played[] = [];
  const states: TimerState[] = [];
  const ticks: TickInfo[] = [];
  const audioErrors: unknown[] = [];
  let finishedLog: unknown[] | null = null;
  const timer = new Timer({
    clock,
    rng: mulberry32(123),
    player: { play: (id) => void played.push({ id, at: clock.now() }) },
    events: {
      onState: (s) => states.push(s),
      onTick: (t) => ticks.push(t),
      onFinish: (log) => (finishedLog = log),
      onAudioError: (e) => audioErrors.push(e),
    },
  });
  const settings: Settings = { ...defaultSettings(), ...patch };
  return {
    clock,
    timer,
    played,
    states,
    ticks,
    audioErrors,
    settings,
    get finishedLog() {
      return finishedLog;
    },
  };
}

const signals = (p: Played[]) => p.filter((x) => x.id !== 'tick' && x.id !== 'gong');
const gongs = (p: Played[]) => p.filter((x) => x.id === 'gong');

describe('timer engine', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('TC-26: старт → «Отсчёт» с тиканьем каждую секунду, через 5 с → «Идёт» и гонг', () => {
    expect(t.timer.state).toBe('settings');
    const t0 = t.clock.now();
    t.timer.start(t.settings);
    expect(t.timer.state).toBe('countdown');
    t.clock.advance(4999);
    expect(t.timer.state).toBe('countdown');
    expect(t.played).toEqual([0, 1000, 2000, 3000, 4000].map((d) => ({ id: 'tick', at: t0 + d })));
    t.clock.advance(1);
    expect(t.timer.state).toBe('running');
    expect(t.played.slice(5)).toEqual([{ id: 'gong', at: t0 + 5000 }]);
  });

  it('TC-26: отсчёт 0 с — сразу «Идёт» с гонгом, без тиканья', () => {
    const z = setup({ countdownSec: 0 });
    z.timer.start(z.settings);
    expect(z.timer.state).toBe('running');
    expect(z.played).toEqual([{ id: 'gong', at: z.clock.now() }]);
  });

  it('TC-26: пауза во время отсчёта → «Продолжить» — отсчёт тикает заново, гонг один', () => {
    t.timer.start(t.settings);
    t.clock.advance(2500);
    t.timer.pause();
    t.clock.advance(10_000);
    expect(t.played.map((p) => p.id)).toEqual(['tick', 'tick', 'tick']);
    t.timer.resume();
    t.clock.advance(5000);
    expect(t.played.map((p) => p.id)).toEqual([...Array<string>(8).fill('tick'), 'gong']);
  });

  it('TC-27: каждый сигнал звучит ровно один раз, в своё время ± 50 мс', () => {
    t.timer.start(t.settings);
    const start = t.clock.now() + 5000;
    const schedule = [...t.timer.currentSchedule];
    t.clock.advance(5000 + 60_000);
    const got = signals(t.played);
    expect(got).toHaveLength(schedule.length);
    got.forEach((p, i) => {
      expect(p.id).toBe(schedule[i]!.type);
      expect(Math.abs(p.at - start - schedule[i]!.atMs)).toBeLessThanOrEqual(50);
    });
  });

  it('TC-28: конец периода → «Финиш» + гонг один раз (второй за сессию, после стартового); после него тишина', () => {
    const t0 = t.clock.now();
    t.timer.start(t.settings);
    t.clock.advance(5000 + 59_999);
    expect(t.timer.state).toBe('running');
    t.clock.advance(1);
    expect(t.timer.state).toBe('finished');
    expect(gongs(t.played).map((p) => p.at - t0)).toEqual([5000, 65_000]);
    expect(t.played.at(-1)!.id).toBe('gong');
    expect(t.finishedLog).toHaveLength(10);
    const n = t.played.length;
    t.clock.advance(600_000);
    expect(t.played).toHaveLength(n);
    expect(t.clock.pending).toBe(0);
  });

  it('TC-29: пауза 10 с — тишина; оставшиеся сигналы и финиш сдвинуты на 10 с', () => {
    t.timer.start(t.settings);
    const start = t.clock.now() + 5000;
    const schedule = [...t.timer.currentSchedule];
    const pauseAt = 30_000;
    t.clock.advance(5000 + pauseAt);
    t.timer.pause();
    expect(t.timer.state).toBe('paused');
    const before = t.played.length;
    t.clock.advance(10_000);
    expect(t.played).toHaveLength(before);
    t.timer.resume();
    expect(t.timer.state).toBe('running');
    t.clock.advance(30_000);
    const got = signals(t.played);
    expect(got).toHaveLength(schedule.length);
    got.forEach((p, i) => {
      const ev = schedule[i]!;
      const shift = ev.atMs > pauseAt ? 10_000 : 0;
      expect(Math.abs(p.at - start - ev.atMs - shift)).toBeLessThanOrEqual(50);
    });
    const fin = gongs(t.played).at(-1)!;
    expect(fin.at - start).toBe(70_000);
  });

  it.each(['countdown', 'running', 'paused'] as const)(
    'TC-30: «Стоп» из «%s» → «Настройки», после стопа ни одного звука',
    (from) => {
      t.timer.start(t.settings);
      if (from !== 'countdown') t.clock.advance(5000 + 20_000);
      if (from === 'paused') t.timer.pause();
      expect(t.timer.state).toBe(from);
      const n = t.played.length;
      t.timer.stop();
      expect(t.timer.state).toBe('settings');
      t.clock.advance(600_000);
      expect(t.played).toHaveLength(n);
      expect(t.clock.pending).toBe(0);
    },
  );

  it('TC-31: «Повторить» после финиша — новое расписание, счётчики обнулены', () => {
    t.timer.start(t.settings);
    t.clock.advance(65_000);
    expect(t.timer.state).toBe('finished');
    const first = [...t.timer.currentSchedule];
    t.timer.repeat();
    expect(t.timer.state).toBe('countdown');
    expect(t.timer.currentSchedule).not.toEqual(first);
    expect(t.timer.snapshot()).toMatchObject({ played: 0, total: 10, elapsedMs: 0 });
    expect(t.timer.playedLog).toHaveLength(0);
    t.clock.advance(65_000);
    expect(t.timer.state).toBe('finished');
    expect(signals(t.played)).toHaveLength(20);
  });

  it('TC-31: «К настройкам» из «Финиш» → «Настройки»', () => {
    t.timer.start(t.settings);
    t.clock.advance(65_000);
    t.timer.stop();
    expect(t.timer.state).toBe('settings');
  });

  it('TC-32: часы «прыгнули» на 3 с — пропущенный сигнал звучит один раз сразу', () => {
    t.timer.start(t.settings);
    const schedule = [...t.timer.currentSchedule];
    const start = t.clock.now() + 5000;
    const target = schedule[2]!;
    // run until 100 ms before the 3rd signal, then the browser freezes for 3 s
    t.clock.advance(start - t.clock.now() + target.atMs - 100);
    expect(signals(t.played)).toHaveLength(2);
    t.clock.jump(3000);
    t.clock.advance(0);
    const after = signals(t.played);
    expect(after.filter((p) => p.at === t.clock.now()).length).toBeGreaterThanOrEqual(1);
    expect(after[2]!.id).toBe(target.type);
    t.clock.advance(70_000);
    const all = signals(t.played);
    expect(all).toHaveLength(schedule.length);
    expect(all.map((p) => p.id)).toEqual(schedule.map((e) => e.type));
  });

  it('TC-33: свернули и вернули — автопауза, после возврата остаётся на паузе до «Продолжить»', () => {
    t.timer.start(t.settings);
    t.clock.advance(5000 + 10_000);
    t.timer.setHidden(true);
    expect(t.timer.state).toBe('paused');
    t.clock.advance(20_000);
    t.timer.setHidden(false);
    expect(t.timer.state).toBe('paused');
    t.clock.advance(20_000);
    expect(t.timer.state).toBe('paused');
    t.timer.resume();
    expect(t.timer.state).toBe('running');
    expect(t.timer.snapshot().elapsedMs).toBe(10_000);
  });

  it('TC-33: свернули во время отсчёта — пауза, «Продолжить» запускает отсчёт заново', () => {
    t.timer.start(t.settings);
    t.clock.advance(2000);
    t.timer.setHidden(true);
    expect(t.timer.state).toBe('paused');
    t.timer.resume();
    expect(t.timer.state).toBe('countdown');
    expect(t.timer.snapshot().countdownLeftMs).toBe(5000);
  });

  it('TC-34: onTick — оставшееся время убывает, счётчик «X из N» верный', () => {
    t.timer.start(t.settings);
    t.clock.advance(65_000);
    const running = t.ticks.filter((x) => x.state === 'running');
    expect(running.length).toBeGreaterThan(100);
    for (let i = 1; i < running.length; i++) {
      expect(running[i]!.remainingMs).toBeLessThanOrEqual(running[i - 1]!.remainingMs);
      expect(running[i]!.played).toBeGreaterThanOrEqual(running[i - 1]!.played);
    }
    for (const tick of running) {
      expect(tick.total).toBe(10);
      const expectedPlayed = t.timer.currentSchedule.filter((e) => e.atMs <= tick.elapsedMs).length;
      expect(tick.played).toBe(expectedPlayed);
      expect(tick.remainingMs).toBe(60_000 - tick.elapsedMs);
    }
    const cd = t.ticks.filter((x) => x.state === 'countdown').map((x) => x.countdownLeftMs);
    expect(cd[0]).toBe(5000);
    expect(t.ticks.at(-1)).toMatchObject({ state: 'finished', remainingMs: 0, played: 10 });
  });

  it('проигрыватель бросает ошибку или отклоняет play() — таймер не падает', async () => {
    const clock = new FakeClock();
    const errors: unknown[] = [];
    let n = 0;
    const timer = new Timer({
      clock,
      rng: mulberry32(1),
      player: {
        play: () => {
          n++;
          if (n % 2) throw new Error('boom');
          return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
        },
      },
      events: { onAudioError: (e) => errors.push(e) },
    });
    timer.start({ ...defaultSettings(), countdownSec: 0 });
    clock.advance(60_000);
    await Promise.resolve();
    expect(timer.state).toBe('finished');
    expect(errors).toHaveLength(12); // start gong + 10 signals + finish gong
  });

  it('недопустимые переходы игнорируются', () => {
    t.timer.pause();
    t.timer.resume();
    t.timer.repeat();
    expect(t.timer.state).toBe('settings');
    t.timer.start(t.settings);
    t.timer.start(t.settings);
    t.timer.resume();
    expect(t.timer.state).toBe('countdown');
    expect(t.states).toEqual(['countdown']);
  });
});
