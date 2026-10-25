import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  getByLabelText,
  getByRole,
  getByText,
  queryByRole,
  within,
} from '@testing-library/dom';
import { SIGNALS } from '../../src/domain/signals';
import { AUDIO_BLOCKED_TEXT, FLASH_MS } from '../../src/ui/app';
import { formatClock } from '../../src/ui/format';
import { mountApp, type Harness } from '../helpers/appHarness';

const screen = (h: Harness, name: string) =>
  h.root.querySelector<HTMLElement>(`[data-screen="${name}"]`) as HTMLElement;
const visibleScreen = (h: Harness) =>
  [...h.root.querySelectorAll<HTMLElement>('[data-screen]')]
    .filter((s) => !s.hidden)
    .map((s) => s.dataset.screen);
const startBtn = (h: Harness) =>
  getByRole(screen(h, 'settings'), 'button', { name: 'Старт' }) as HTMLButtonElement;
const hint = (h: Harness) => h.root.querySelector('#max-hint')!.textContent;
const flushMicrotasks = () => Promise.resolve().then(() => Promise.resolve());

describe('UI', () => {
  let h: Harness;
  beforeEach(async () => {
    vi.useFakeTimers();
    h = await mountApp();
  });
  afterEach(() => {
    h.app.destroy();
    vi.useRealTimers();
  });

  it('TC-41: подсказка максимума видна под полем и пересчитывается при смене длительности и типов', () => {
    const s = screen(h, 'settings');
    expect(hint(h)).toBe('Максимум для этих настроек: 19');
    fireEvent.click(getByRole(s, 'button', { name: '2 мин' }));
    // floor((120 − 5 + 2,5) / 2,95) = 39
    expect(hint(h)).toBe('Максимум для этих настроек: 39');
    fireEvent.click(getByRole(s, 'button', { name: '1 мин' }));
    for (const t of ['whistle1', 'whistle2', 'horn1', 'scream'] as const) {
      fireEvent.click(getByLabelText(s, SIGNALS[t].name));
    }
    // only «Кря»: floor(57,5 / 2,7) = 21
    expect(hint(h)).toBe('Максимум для этих настроек: 21');
    fireEvent.click(getByRole(s, 'button', { name: 'Больше на 5 секунд' }));
    expect((getByLabelText(s, 'Длительность') as HTMLInputElement).value).toBe('1:05');
    expect(hint(h)).toBe('Максимум для этих настроек: 23');
    expect(h.saved.length).toBeGreaterThan(0);
    expect(h.saved.at(-1)).toMatchObject({ durationSec: 65, types: ['quack'] });
  });

  it('TC-42: неверные настройки — «Старт» неактивен, текст ошибки рядом с полем', () => {
    const s = screen(h, 'settings');
    expect(startBtn(h).disabled).toBe(false);

    const count = getByLabelText(s, 'Число сигналов') as HTMLInputElement;
    fireEvent.input(count, { target: { value: '20' } });
    expect(startBtn(h).disabled).toBe(true);
    expect(s.querySelector('#count-error')!.textContent).toContain('максимум 19');
    expect(count.getAttribute('aria-describedby')).toContain('count-error');
    fireEvent.input(count, { target: { value: '10' } });
    expect(startBtn(h).disabled).toBe(false);

    const dur = getByLabelText(s, 'Длительность') as HTMLInputElement;
    fireEvent.input(dur, { target: { value: '0:07' } });
    expect(startBtn(h).disabled).toBe(true);
    expect(s.querySelector('#duration-error')!.textContent).toMatch(/длительность/i);
    fireEvent.input(dur, { target: { value: '1:00' } });
    expect(startBtn(h).disabled).toBe(false);

    for (const t of Object.values(SIGNALS).filter((x) => x.code !== 'finish')) {
      fireEvent.click(getByLabelText(s, t.name));
    }
    expect(startBtn(h).disabled).toBe(true);
    expect(s.querySelector('#types-error')!.textContent).toBe('Выберите хотя бы один сигнал');

    fireEvent.click(startBtn(h));
    expect(visibleScreen(h)).toEqual(['settings']);
  });

  it('TC-43: кнопка «прослушать» играет именно свой сигнал', () => {
    const s = screen(h, 'settings');
    for (const t of ['whistle1', 'whistle2', 'horn1', 'quack', 'scream'] as const) {
      fireEvent.click(getByRole(s, 'button', { name: `Прослушать «${SIGNALS[t].name}»` }));
      expect(h.played.at(-1)).toBe(t);
    }
    expect(h.played).toEqual(['whistle1', 'whistle2', 'horn1', 'quack', 'scream']);
  });

  it('TC-44: на экране «Идёт» время следующего сигнала нигде не показано', () => {
    fireEvent.click(startBtn(h));
    expect(h.audio.unlock).toHaveBeenCalledTimes(1);
    h.advance(5000);
    expect(visibleScreen(h)).toEqual(['running']);
    const schedule = h.app.timer.currentSchedule;
    const run = screen(h, 'running');
    for (let step = 0; step < 60; step++) {
      const snap = h.app.timer.snapshot();
      const upcoming = schedule.filter((e) => e.atMs > snap.elapsedMs);
      const text = run.textContent ?? '';
      expect(text).not.toMatch(/следующ/i);
      expect(run.innerHTML).not.toMatch(/data-next|atMs/);
      // The UI shows only remaining period time and the counter.
      expect(run.querySelector('.remaining')!.textContent).toMatch(/^\d\d:\d\d$/);
      expect(run.querySelector('.counter')!.textContent).toBe(
        `Сигналов: ${snap.played} из ${schedule.length}`,
      );
      for (const e of upcoming) {
        const untilNext = formatClock(e.atMs - snap.elapsedMs);
        if (untilNext !== run.querySelector('.remaining')!.textContent) {
          expect(text).not.toContain(untilNext);
        }
      }
      h.clock.advance(1000);
    }
  });

  it('TC-45: каждый сигнал — вспышка и название на 1,5 с', () => {
    fireEvent.click(startBtn(h));
    h.advance(5000);
    const flash = screen(h, 'running').querySelector<HTMLElement>('.flash')!;
    expect(flash.hidden).toBe(true);
    const schedule = [...h.app.timer.currentSchedule];
    let elapsed = 0;
    for (const ev of schedule) {
      // engine timers are armed with whole-ms delays
      const at = Math.ceil(ev.atMs);
      h.clock.advance(at - elapsed);
      elapsed = at;
      expect(flash.hidden).toBe(false);
      expect(flash.textContent).toBe(SIGNALS[ev.type].name);
      expect(flash.dataset.type).toBe(ev.type);
      vi.advanceTimersByTime(FLASH_MS - 1);
      expect(flash.hidden).toBe(false);
      vi.advanceTimersByTime(1);
      expect(flash.hidden).toBe(true);
    }
    expect(h.telegram.calls.filter((c) => c === 'haptic:signal')).toHaveLength(schedule.length);
  });

  it('TC-45: вспышку можно выключить в дополнительных настройках', () => {
    fireEvent.click(getByLabelText(screen(h, 'settings'), 'Показывать сигнал на экране'));
    fireEvent.click(startBtn(h));
    h.advance(5000);
    const flash = screen(h, 'running').querySelector<HTMLElement>('.flash')!;
    h.clock.advance(Math.ceil(h.app.timer.currentSchedule[0]!.atMs));
    expect(flash.hidden).toBe(true);
  });

  it('TC-46: экран финиша — журнал из N строк «мм:сс — сигнал»', () => {
    fireEvent.click(startBtn(h));
    h.advance(65_000);
    expect(visibleScreen(h)).toEqual(['finish']);
    const fin = screen(h, 'finish');
    expect(within(fin).getByText('Готово')).toBeTruthy();
    const items = within(fin).getAllByRole('listitem');
    expect(items).toHaveLength(10);
    const schedule = h.app.timer.currentSchedule;
    items.forEach((li, i) => {
      expect(li.textContent).toMatch(/^\d\d:\d\d — .+$/);
      expect(li.textContent).toBe(
        `${formatClock(schedule[i]!.atMs)} — ${SIGNALS[schedule[i]!.type].name}`,
      );
    });
    expect(h.played.filter((p) => p === 'finish')).toHaveLength(1);
  });

  it('переходы по схеме: Повторить и К настройкам с экрана финиша', () => {
    fireEvent.click(startBtn(h));
    h.advance(65_000);
    const first = [...h.app.timer.currentSchedule];
    fireEvent.click(getByRole(screen(h, 'finish'), 'button', { name: 'Повторить' }));
    expect(visibleScreen(h)).toEqual(['countdown']);
    expect(h.app.timer.currentSchedule).not.toEqual(first);
    expect(screen(h, 'countdown').querySelector('.countdown-number')!.textContent).toBe('5');
    h.advance(65_000);
    fireEvent.click(getByRole(screen(h, 'finish'), 'button', { name: 'К настройкам' }));
    expect(visibleScreen(h)).toEqual(['settings']);
  });

  it('пауза / продолжить / стоп через кнопки; надпись «Таймер на паузе»', () => {
    fireEvent.click(startBtn(h));
    fireEvent.click(getByRole(screen(h, 'countdown'), 'button', { name: 'Стоп' }));
    expect(visibleScreen(h)).toEqual(['settings']);
    fireEvent.click(startBtn(h));
    h.advance(10_000);
    const run = screen(h, 'running');
    fireEvent.click(getByRole(run, 'button', { name: 'Пауза' }));
    expect(h.app.timer.state).toBe('paused');
    expect(getByRole(run, 'status').textContent).toBe('Таймер на паузе');
    fireEvent.click(getByRole(run, 'button', { name: 'Продолжить' }));
    expect(h.app.timer.state).toBe('running');
    expect(queryByRole(run, 'status')).toBeNull();
    fireEvent.click(getByRole(run, 'button', { name: 'Стоп' }));
    expect(visibleScreen(h)).toEqual(['settings']);
  });

  it('TC-36: play() отклонён — таймер идёт дальше, показано «Звук заблокирован — коснитесь экрана»', async () => {
    fireEvent.click(startBtn(h));
    h.advance(5000);
    h.audio.failNext = true;
    h.clock.advance(Math.ceil(h.app.timer.currentSchedule[0]!.atMs));
    await flushMicrotasks();
    const banner = getByText(h.root, AUDIO_BLOCKED_TEXT);
    expect(banner.hidden).toBe(false);
    expect(h.app.timer.state).toBe('running');
    const unlocks = h.audio.unlock.mock.calls.length;
    fireEvent.pointerDown(screen(h, 'running'));
    expect(banner.hidden).toBe(true);
    expect(h.audio.unlock.mock.calls.length).toBe(unlocks + 1);
    h.clock.advance(60_000);
    expect(h.app.timer.state).toBe('finished');
  });

  it('TC-38 / TC-40: подтверждение закрытия и wake lock только пока идёт таймер', () => {
    expect(h.telegram.calls).toContain('init');
    h.telegram.calls.length = 0;
    h.wake.log.length = 0;
    fireEvent.click(startBtn(h));
    expect(h.telegram.calls).toContain('closing:true');
    expect(h.wake.log).toEqual(['acquire']);
    h.advance(10_000);
    fireEvent.click(getByRole(screen(h, 'running'), 'button', { name: 'Пауза' }));
    expect(h.wake.log.at(-1)).toBe('release');
    fireEvent.click(getByRole(screen(h, 'running'), 'button', { name: 'Продолжить' }));
    expect(h.wake.log.at(-1)).toBe('acquire');
    h.advance(70_000);
    expect(h.app.timer.state).toBe('finished');
    expect(h.wake.log.at(-1)).toBe('release');
    expect(h.telegram.calls.at(-1)).toBe('haptic:finish');
    expect(h.telegram.calls).toContain('closing:false');
    fireEvent.click(getByRole(screen(h, 'finish'), 'button', { name: 'К настройкам' }));
    fireEvent.click(startBtn(h));
    fireEvent.click(getByRole(screen(h, 'countdown'), 'button', { name: 'Стоп' }));
    expect(h.wake.log.at(-1)).toBe('release');
    expect(h.telegram.calls.filter((c) => c.startsWith('closing')).at(-1)).toBe('closing:false');
  });

  it('TC-33 / TC-52: страница скрыта или Телеграм свёрнут — автопауза с сообщением', () => {
    fireEvent.click(startBtn(h));
    h.advance(10_000);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.app.timer.state).toBe('paused');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.app.timer.state).toBe('paused');
    expect(getByRole(screen(h, 'running'), 'status').textContent).toBe('Таймер на паузе');
    fireEvent.click(getByRole(screen(h, 'running'), 'button', { name: 'Продолжить' }));
    expect(h.app.timer.state).toBe('running');
    h.telegram.setActive(false);
    expect(h.app.timer.state).toBe('paused');
  });
});
