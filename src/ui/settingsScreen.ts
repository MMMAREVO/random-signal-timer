import {
  COUNTDOWN_OPTIONS,
  DURATION_STEP_SEC,
  GAP_STEP_SEC,
  MAX_DURATION_SEC,
  MAX_GAP_SEC,
  MIN_DURATION_SEC,
  MIN_GAP_SEC,
  validate,
  type CountdownSec,
  type Settings,
} from '../domain/settings';
import { SIGNALS, SIGNAL_TYPES, type SignalType } from '../domain/signals';
import { h } from './dom';
import { formatDuration, formatGap, parseDuration } from './format';

const QUICK_DURATIONS: ReadonlyArray<[number, string]> = [
  [30, '30 с'],
  [60, '1 мин'],
  [120, '2 мин'],
  [180, '3 мин'],
  [300, '5 мин'],
];

export interface SettingsScreenHandlers {
  onChange(settings: Settings): void;
  onStart(settings: Settings): void;
  onListen(type: SignalType): void;
}

export interface SettingsScreen {
  el: HTMLElement;
  set(settings: Settings): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (v: number, step: number) => Math.round(v / step) * step;

export function createSettingsScreen(
  doc: Document,
  initial: Settings,
  version: string,
  on: SettingsScreenHandlers,
): SettingsScreen {
  let s: Settings = { ...initial, types: [...initial.types] };

  const durInput = h(doc, 'input', {
    id: 'duration',
    class: 'value-input',
    inputmode: 'numeric',
    autocomplete: 'off',
    'aria-describedby': 'duration-error',
  });
  const durError = h(doc, 'p', { id: 'duration-error', class: 'error', role: 'alert' });
  const durMinus = h(
    doc,
    'button',
    { type: 'button', class: 'step', 'aria-label': 'Меньше на 5 секунд' },
    '−',
  );
  const durPlus = h(
    doc,
    'button',
    { type: 'button', class: 'step', 'aria-label': 'Больше на 5 секунд' },
    '+',
  );
  const quick = QUICK_DURATIONS.map(([sec, label]) =>
    h(doc, 'button', { type: 'button', class: 'chip', 'data-sec': sec }, label),
  );

  const typeRows = SIGNAL_TYPES.map((type) => {
    const box = h(doc, 'input', { type: 'checkbox', id: `type-${type}`, 'data-type': type });
    const listen = h(
      doc,
      'button',
      {
        type: 'button',
        class: 'listen',
        'data-listen': type,
        'aria-label': `Прослушать «${SIGNALS[type].name}»`,
      },
      '▶',
    );
    const row = h(
      doc,
      'div',
      { class: 'signal-row', 'data-type': type },
      h(
        doc,
        'label',
        { class: 'toggle', for: `type-${type}` },
        box,
        h(doc, 'span', { class: 'swatch' }),
        SIGNALS[type].name,
      ),
      listen,
    );
    box.addEventListener('change', () => {
      const set = new Set(s.types);
      if (box.checked) set.add(type);
      else set.delete(type);
      s.types = SIGNAL_TYPES.filter((t) => set.has(t));
      changed();
    });
    listen.addEventListener('click', () => on.onListen(type));
    return { type, box, row };
  });
  const typesError = h(doc, 'p', { id: 'types-error', class: 'error', role: 'alert' });

  const countInput = h(doc, 'input', {
    id: 'count',
    class: 'value-input',
    type: 'number',
    inputmode: 'numeric',
    min: 1,
    step: 1,
    'aria-describedby': 'max-hint count-error',
  });
  const countMinus = h(
    doc,
    'button',
    { type: 'button', class: 'step', 'aria-label': 'Меньше сигналов' },
    '−',
  );
  const countPlus = h(
    doc,
    'button',
    { type: 'button', class: 'step', 'aria-label': 'Больше сигналов' },
    '+',
  );
  const maxHint = h(doc, 'p', { id: 'max-hint', class: 'hint' });
  const countError = h(doc, 'p', { id: 'count-error', class: 'error', role: 'alert' });

  const gapValue = h(doc, 'output', { id: 'gap', class: 'value-output', 'aria-live': 'polite' });
  const gapMinus = h(
    doc,
    'button',
    { type: 'button', class: 'step', 'aria-label': 'Пауза меньше' },
    '−',
  );
  const gapPlus = h(
    doc,
    'button',
    { type: 'button', class: 'step', 'aria-label': 'Пауза больше' },
    '+',
  );
  const gapError = h(doc, 'p', { id: 'gap-error', class: 'error', role: 'alert' });
  const countdownButtons = COUNTDOWN_OPTIONS.map((sec) =>
    h(
      doc,
      'button',
      { type: 'button', class: 'chip', 'data-countdown': sec, 'aria-pressed': 'false' },
      `${sec} с`,
    ),
  );
  const flashBox = h(doc, 'input', { type: 'checkbox', id: 'show-flash' });

  const startBtn = h(
    doc,
    'button',
    { type: 'button', id: 'start', class: 'btn-primary btn-start' },
    'Старт',
  );

  const el = h(
    doc,
    'section',
    { class: 'screen screen-settings', 'data-screen': 'settings' },
    h(doc, 'h1', { class: 'title' }, 'Таймер сигналов'),
    h(
      doc,
      'div',
      { class: 'field' },
      h(doc, 'label', { class: 'field-label', for: 'duration' }, 'Длительность'),
      h(doc, 'div', { class: 'stepper' }, durMinus, durInput, durPlus),
      h(doc, 'div', { class: 'chips' }, ...quick),
      durError,
    ),
    h(
      doc,
      'fieldset',
      { class: 'field' },
      h(doc, 'legend', { class: 'field-label' }, 'Сигналы'),
      ...typeRows.map((r) => r.row),
      typesError,
    ),
    h(
      doc,
      'div',
      { class: 'field' },
      h(doc, 'label', { class: 'field-label', for: 'count' }, 'Число сигналов'),
      h(doc, 'div', { class: 'stepper' }, countMinus, countInput, countPlus),
      maxHint,
      countError,
    ),
    h(
      doc,
      'details',
      { class: 'field more' },
      h(doc, 'summary', {}, 'Дополнительные настройки'),
      h(doc, 'p', { class: 'field-label' }, 'Минимальная пауза между сигналами'),
      h(doc, 'div', { class: 'stepper' }, gapMinus, gapValue, gapPlus),
      gapError,
      h(doc, 'p', { class: 'field-label' }, 'Отсчёт перед стартом'),
      h(doc, 'div', { class: 'chips' }, ...countdownButtons),
      h(
        doc,
        'label',
        { class: 'toggle', for: 'show-flash' },
        flashBox,
        'Показывать сигнал на экране',
      ),
    ),
    h(
      doc,
      'p',
      { class: 'volume-note' },
      'Выкрутите громкость телефона на максимум и отключите беззвучный режим',
    ),
    startBtn,
    h(doc, 'p', { class: 'version' }, version),
  );
  function changed(rerenderInputs = false) {
    render(rerenderInputs);
    on.onChange({ ...s, types: [...s.types] });
  }

  function render(rerenderInputs: boolean) {
    const v = validate(s);
    if (rerenderInputs || doc.activeElement !== durInput) {
      if (Number.isFinite(s.durationSec)) durInput.value = formatDuration(s.durationSec);
    }
    if (rerenderInputs || doc.activeElement !== countInput) {
      countInput.value = Number.isFinite(s.count) ? String(s.count) : '';
    }
    durInput.setAttribute('aria-invalid', String(!!v.errors.duration));
    countInput.setAttribute('aria-invalid', String(!!v.errors.count));
    durError.textContent = v.errors.duration ?? '';
    typesError.textContent = v.errors.types ?? '';
    countError.textContent = v.errors.count ?? '';
    gapError.textContent = v.errors.gap ?? '';
    maxHint.textContent = v.maxSignals > 0 ? `Максимум для этих настроек: ${v.maxSignals}` : '';
    for (const r of typeRows) r.box.checked = s.types.includes(r.type);
    for (const b of quick)
      b.setAttribute('aria-pressed', String(Number(b.dataset.sec) === s.durationSec));
    gapValue.textContent = formatGap(s.gapSec);
    for (const b of countdownButtons) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.countdown) === s.countdownSec));
    }
    flashBox.checked = s.showFlash;
    startBtn.disabled = !v.valid;
  }

  const stepDuration = (dir: 1 | -1) => {
    const base = Number.isFinite(s.durationSec) ? snap(s.durationSec, DURATION_STEP_SEC) : 60;
    s.durationSec = clamp(base + dir * DURATION_STEP_SEC, MIN_DURATION_SEC, MAX_DURATION_SEC);
    changed(true);
  };
  durMinus.addEventListener('click', () => stepDuration(-1));
  durPlus.addEventListener('click', () => stepDuration(1));
  durInput.addEventListener('input', () => {
    s.durationSec = parseDuration(durInput.value);
    changed();
  });
  durInput.addEventListener('blur', () => render(true));
  for (const b of quick) {
    b.addEventListener('click', () => {
      s.durationSec = Number(b.dataset.sec);
      changed(true);
    });
  }

  const stepCount = (dir: 1 | -1) => {
    const base = Number.isFinite(s.count) ? Math.round(s.count) : 1;
    const max = Math.max(1, validate({ ...s, count: 1 }).maxSignals);
    s.count = clamp(base + dir, 1, max);
    changed(true);
  };
  countMinus.addEventListener('click', () => stepCount(-1));
  countPlus.addEventListener('click', () => stepCount(1));
  countInput.addEventListener('input', () => {
    s.count = countInput.value.trim() === '' ? Number.NaN : Number(countInput.value);
    changed();
  });

  const stepGap = (dir: 1 | -1) => {
    s.gapSec = clamp(snap(s.gapSec, GAP_STEP_SEC) + dir * GAP_STEP_SEC, MIN_GAP_SEC, MAX_GAP_SEC);
    changed(true);
  };
  gapMinus.addEventListener('click', () => stepGap(-1));
  gapPlus.addEventListener('click', () => stepGap(1));
  for (const b of countdownButtons) {
    b.addEventListener('click', () => {
      s.countdownSec = Number(b.dataset.countdown) as CountdownSec;
      changed(true);
    });
  }
  flashBox.addEventListener('change', () => {
    s.showFlash = flashBox.checked;
    changed();
  });

  startBtn.addEventListener('click', () => {
    if (validate(s).valid) on.onStart({ ...s, types: [...s.types] });
  });

  render(true);

  return {
    el,
    set(next) {
      s = { ...next, types: [...next.types] };
      render(true);
    },
  };
}
