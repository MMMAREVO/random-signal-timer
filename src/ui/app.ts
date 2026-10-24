import type { Rng } from '../domain/rng';
import type { ScheduleEvent } from '../domain/schedule';
import { SIGNALS } from '../domain/signals';
import { Timer, type Clock, type TickInfo, type TimerState } from '../engine/timer';
import type { AudioPlayer } from '../platform/audio';
import type { SettingsStorage } from '../platform/storage';
import type { TelegramBridge } from '../platform/telegram';
import type { WakeLockController } from '../platform/wakeLock';
import { h } from './dom';
import { formatClock, formatRemaining } from './format';
import { createSettingsScreen } from './settingsScreen';

export const FLASH_MS = 1500;
export const AUDIO_BLOCKED_TEXT = 'Звук заблокирован — коснитесь экрана';

export interface AppDeps {
  root: HTMLElement;
  doc?: Document;
  audio: AudioPlayer;
  telegram: TelegramBridge;
  storage: SettingsStorage;
  wakeLock: WakeLockController;
  clock: Clock;
  rng: Rng;
  version: string;
}

export interface App {
  timer: Timer;
  destroy(): void;
}

/** Screens shown for each timer state; "paused" reuses the running screen. */
const SCREEN_OF: Record<TimerState, string> = {
  settings: 'settings',
  countdown: 'countdown',
  running: 'running',
  paused: 'running',
  finished: 'finish',
};
const SESSION_STATES: ReadonlySet<TimerState> = new Set(['countdown', 'running', 'paused']);

export async function createApp(deps: AppDeps): Promise<App> {
  const doc = deps.doc ?? deps.root.ownerDocument;
  const win = doc.defaultView;
  let settings = await deps.storage.load();
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  deps.telegram.init();

  // ----- screens -----
  const settingsScreen = createSettingsScreen(doc, settings, deps.version, {
    onChange(next) {
      settings = next;
      void deps.storage.save(settings);
    },
    onStart(next) {
      settings = next;
      // Unlock must happen synchronously inside the tap.
      deps.audio.unlock();
      deps.telegram.haptic('tap');
      void deps.storage.save(settings);
      timer.start(settings);
    },
    onListen(type) {
      deps.audio.play(type).catch(() => undefined);
    },
  });

  const cdNumber = h(doc, 'p', { class: 'countdown-number', 'aria-live': 'assertive' });
  const cdStop = h(
    doc,
    'button',
    { type: 'button', class: 'btn-secondary', 'data-act': 'stop' },
    'Стоп',
  );
  const countdownScreen = h(
    doc,
    'section',
    { class: 'screen screen-countdown', 'data-screen': 'countdown', hidden: true },
    h(doc, 'p', { class: 'countdown-label' }, 'Приготовьтесь'),
    cdNumber,
    h(doc, 'div', { class: 'actions' }, cdStop),
  );

  const remaining = h(doc, 'p', { class: 'remaining', 'aria-label': 'Осталось' });
  const counter = h(doc, 'p', { class: 'counter' });
  const progressFill = h(doc, 'div', { class: 'progress-fill' });
  const progress = h(
    doc,
    'div',
    {
      class: 'progress',
      role: 'progressbar',
      'aria-label': 'Прогресс',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
    },
    progressFill,
  );
  const pausedNote = h(
    doc,
    'p',
    { class: 'paused-note', role: 'status', hidden: true },
    'Таймер на паузе',
  );
  const pauseBtn = h(
    doc,
    'button',
    { type: 'button', class: 'btn-primary', 'data-act': 'pause' },
    'Пауза',
  );
  const runStop = h(
    doc,
    'button',
    { type: 'button', class: 'btn-secondary', 'data-act': 'stop' },
    'Стоп',
  );
  const flash = h(doc, 'div', { class: 'flash', 'aria-live': 'assertive', hidden: true });
  const runningScreen = h(
    doc,
    'section',
    { class: 'screen screen-running', 'data-screen': 'running', hidden: true },
    remaining,
    counter,
    progress,
    pausedNote,
    h(doc, 'div', { class: 'actions' }, pauseBtn, runStop),
    flash,
  );

  const logList = h(doc, 'ol', { class: 'log', 'aria-label': 'Журнал сигналов' });
  const repeatBtn = h(
    doc,
    'button',
    { type: 'button', class: 'btn-primary', 'data-act': 'repeat' },
    'Повторить',
  );
  const toSettingsBtn = h(
    doc,
    'button',
    { type: 'button', class: 'btn-secondary', 'data-act': 'to-settings' },
    'К настройкам',
  );
  const finishScreen = h(
    doc,
    'section',
    { class: 'screen screen-finish', 'data-screen': 'finish', hidden: true },
    h(doc, 'h2', { class: 'done' }, 'Готово'),
    logList,
    h(doc, 'div', { class: 'actions' }, repeatBtn, toSettingsBtn),
  );

  const audioBanner = h(
    doc,
    'button',
    { type: 'button', class: 'audio-banner', role: 'alert', hidden: true },
    AUDIO_BLOCKED_TEXT,
  );

  const screens: Record<string, HTMLElement> = {
    settings: settingsScreen.el,
    countdown: countdownScreen,
    running: runningScreen,
    finish: finishScreen,
  };
  deps.root.replaceChildren(
    settingsScreen.el,
    countdownScreen,
    runningScreen,
    finishScreen,
    audioBanner,
  );

  // ----- timer -----
  const timer: Timer = new Timer({
    clock: deps.clock,
    rng: deps.rng,
    player: deps.audio,
    events: {
      onState: (state) => applyState(state),
      onTick: (info) => renderTick(info),
      onSignal: (ev) => showSignal(ev),
      onFinish: (log) => renderLog(log),
      onAudioError: () => showAudioBlocked(),
    },
  });

  function applyState(state: TimerState) {
    const active = SCREEN_OF[state];
    for (const [name, el] of Object.entries(screens)) el.hidden = name !== active;
    const paused = state === 'paused';
    pausedNote.hidden = !paused;
    pauseBtn.textContent = paused ? 'Продолжить' : 'Пауза';
    pauseBtn.dataset.act = paused ? 'resume' : 'pause';
    runningScreen.classList.toggle('is-paused', paused);
    if (state !== 'running') hideFlash();

    deps.telegram.setClosingConfirmation(SESSION_STATES.has(state));
    if (state === 'countdown' || state === 'running') void deps.wakeLock.acquire();
    else void deps.wakeLock.release();

    if (state === 'settings') settingsScreen.set(settings);
    if (state === 'finished') deps.telegram.haptic('finish');
    if (state === 'countdown') logList.replaceChildren();
    renderTick(timer.snapshot());
  }

  function renderTick(t: TickInfo) {
    if (t.state === 'countdown') {
      cdNumber.textContent = String(Math.ceil(t.countdownLeftMs / 1000));
      return;
    }
    remaining.textContent = formatRemaining(t.remainingMs);
    counter.textContent = `Сигналов: ${t.played} из ${t.total}`;
    const pct = t.durationMs > 0 ? Math.round((t.elapsedMs / t.durationMs) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    progress.setAttribute('aria-valuenow', String(pct));
  }

  function showSignal(ev: ScheduleEvent) {
    deps.telegram.haptic('signal');
    if (!settings.showFlash) return;
    flash.textContent = SIGNALS[ev.type].name;
    flash.dataset.type = ev.type;
    flash.hidden = false;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(hideFlash, FLASH_MS);
  }

  function hideFlash() {
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = null;
    flash.hidden = true;
  }

  function renderLog(log: ScheduleEvent[]) {
    logList.replaceChildren(
      ...log.map((e) =>
        h(doc, 'li', { 'data-type': e.type }, `${formatClock(e.atMs)} — ${SIGNALS[e.type].name}`),
      ),
    );
  }

  function showAudioBlocked() {
    audioBanner.hidden = false;
  }

  // ----- controls -----
  const click = (el: HTMLElement, fn: () => void) => el.addEventListener('click', fn);
  click(cdStop, () => timer.stop());
  click(runStop, () => timer.stop());
  click(pauseBtn, () => {
    if (timer.state === 'paused') {
      deps.audio.unlock();
      timer.resume();
    } else {
      timer.pause();
    }
  });
  click(repeatBtn, () => {
    deps.audio.unlock();
    timer.repeat();
  });
  click(toSettingsBtn, () => timer.stop());

  deps.audio.onBlocked(() => showAudioBlocked());
  const onAnyTap = () => {
    if (audioBanner.hidden) return;
    audioBanner.hidden = true;
    deps.audio.unlock();
  };
  doc.addEventListener('pointerdown', onAnyTap, true);
  click(audioBanner, onAnyTap);

  // ----- leaving the app -----
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') timer.setHidden(true);
    else if (timer.state === 'running' || timer.state === 'countdown') void deps.wakeLock.acquire();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('pagehide', () => timer.setHidden(true));
  deps.telegram.onActiveChange((active) => {
    if (!active) timer.setHidden(true);
  });

  applyState(timer.state);

  return {
    timer,
    destroy() {
      timer.stop();
      hideFlash();
      doc.removeEventListener('visibilitychange', onVisibility);
      doc.removeEventListener('pointerdown', onAnyTap, true);
    },
  };
}
