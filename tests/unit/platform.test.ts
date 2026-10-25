import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/domain/settings';
import { SOUND_IDS } from '../../src/domain/signals';
import { createAudioPlayer } from '../../src/platform/audio';
import { STORAGE_KEY, createSettingsStorage, parseSettings } from '../../src/platform/storage';
import { createTelegram, type CloudStorageLike } from '../../src/platform/telegram';
import { createWakeLock } from '../../src/platform/wakeLock';

class FakeAudio {
  muted = false;
  preload = '';
  currentTime = 0;
  paused = true;
  plays: Array<{ muted: boolean }> = [];
  constructor(
    public src: string,
    private readonly reject = false,
  ) {}
  load() {}
  play(): Promise<void> {
    this.plays.push({ muted: this.muted });
    if (this.reject) return Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

function fakePlayer(reject = false) {
  const els: FakeAudio[] = [];
  const player = createAudioPlayer({
    baseUrl: 'sounds/',
    createAudio: (src) => {
      const a = new FakeAudio(src, reject);
      els.push(a);
      return a as unknown as HTMLAudioElement;
    },
    nav: { audioSession: { type: 'auto' } } as unknown as Navigator,
  });
  return { player, els };
}

describe('audio', () => {
  it('TC-35: unlock() трогает все 6 звуков (беззвучно) и возвращает их в исходное состояние', async () => {
    const nav = { audioSession: { type: 'auto' } };
    const els: FakeAudio[] = [];
    const player = createAudioPlayer({
      baseUrl: 'sounds/',
      createAudio: (src) => {
        const a = new FakeAudio(src);
        els.push(a);
        return a as unknown as HTMLAudioElement;
      },
      nav: nav as unknown as Navigator,
    });
    expect(els).toHaveLength(SOUND_IDS.length);
    expect(els).toHaveLength(6);
    player.unlock();
    for (const el of els) expect(el.plays).toEqual([{ muted: true }]);
    await Promise.resolve();
    await Promise.resolve();
    for (const el of els) {
      expect(el.paused).toBe(true);
      expect(el.muted).toBe(false);
      expect(el.currentTime).toBe(0);
    }
    expect(nav.audioSession.type).toBe('playback');
  });

  it('TC-35: play() сразу после unlock() не глушится разблокировкой', async () => {
    const { player, els } = fakePlayer();
    player.unlock();
    await player.play('whistle2');
    await Promise.resolve();
    const el = els.find((e) => e.src.endsWith('whistle2.wav'))!;
    expect(el.plays.at(-1)).toEqual({ muted: false });
    expect(el.paused).toBe(false);
  });

  it('TC-36: play() отклонён браузером — слушатель onBlocked вызван, исключение не теряется', async () => {
    const { player } = fakePlayer(true);
    const blocked = vi.fn();
    player.onBlocked(blocked);
    await expect(player.play('whistle1')).rejects.toThrow();
    expect(blocked).toHaveBeenCalledTimes(1);
  });
});

function tgWindow(version: string, extra: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const handlers: Record<string, () => void> = {};
  const rec =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push(args.length ? `${name}(${args.join(',')})` : name);
  const WebApp = {
    version,
    initData: 'query_id=1',
    isVersionAtLeast: (v: string) => {
      const a = version.split('.').map(Number);
      const b = v.split('.').map(Number);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d) return d > 0;
      }
      return true;
    },
    ready: rec('ready'),
    expand: rec('expand'),
    disableVerticalSwipes: rec('disableVerticalSwipes'),
    enableClosingConfirmation: rec('enableClosingConfirmation'),
    disableClosingConfirmation: rec('disableClosingConfirmation'),
    setHeaderColor: rec('setHeaderColor'),
    setBackgroundColor: rec('setBackgroundColor'),
    onEvent: (name: string, cb: () => void) => (handlers[name] = cb),
    HapticFeedback: { impactOccurred: rec('impact'), notificationOccurred: rec('notify') },
    ...extra,
  };
  return { win: { Telegram: { WebApp } } as unknown as Window, calls, handlers };
}

describe('telegram', () => {
  it('TC-37: без window.Telegram все методы ничего не делают и не падают', () => {
    const tg = createTelegram({} as Window);
    expect(tg.isTelegram).toBe(false);
    expect(tg.cloudStorage).toBeNull();
    expect(() => {
      tg.init();
      tg.setClosingConfirmation(true);
      tg.haptic('signal');
      tg.onActiveChange(() => undefined);
    }).not.toThrow();
  });

  it('TC-37: скрипт подключён, но открыто в обычном браузере (нет initData/version) — заглушка', () => {
    const tg = createTelegram({ Telegram: { WebApp: { initData: '' } } } as unknown as Window);
    expect(tg.isTelegram).toBe(false);
  });

  it('TC-38: в Телеграме вызваны ready, expand, disableVerticalSwipes; подтверждение закрытия переключается', () => {
    const { win, calls, handlers } = tgWindow('8.0');
    const tg = createTelegram(win);
    expect(tg.isTelegram).toBe(true);
    tg.init();
    expect(calls).toEqual(expect.arrayContaining(['ready', 'expand', 'disableVerticalSwipes']));
    tg.setClosingConfirmation(true);
    tg.setClosingConfirmation(false);
    expect(calls.slice(-2)).toEqual(['enableClosingConfirmation', 'disableClosingConfirmation']);
    const active = vi.fn();
    tg.onActiveChange(active);
    handlers.deactivated?.();
    handlers.activated?.();
    expect(active.mock.calls).toEqual([[false], [true]]);
    tg.haptic('signal');
    expect(calls.at(-1)).toBe('impact(heavy)');
  });

  it('TC-38: старый Телеграм (6.0) — новые методы не вызываются', () => {
    const { win, calls } = tgWindow('6.0');
    const tg = createTelegram(win);
    tg.init();
    tg.setClosingConfirmation(true);
    tg.haptic('signal');
    expect(calls).toEqual(['ready', 'expand']);
  });
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function memoryCloud(): CloudStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k, cb) => queueMicrotask(() => cb(null, data.get(k) ?? '')),
    setItem: (k, v, cb) => {
      data.set(k, v);
      queueMicrotask(() => cb?.(null, true));
    },
  };
}

describe('storage', () => {
  const custom = {
    ...defaultSettings(),
    durationSec: 125,
    types: ['whistle1', 'beep'] as const,
    count: 7,
    gapSec: 3,
    countdownSec: 10 as const,
    showFlash: false,
  };

  it('TC-39: сохранили → загрузили те же (localStorage)', async () => {
    const local = memoryStorage();
    await createSettingsStorage({ local }).save({ ...custom, types: [...custom.types] });
    expect(await createSettingsStorage({ local }).load()).toEqual({
      ...custom,
      types: [...custom.types],
    });
  });

  it('TC-39: сохранили → загрузили те же (CloudStorage Телеграма)', async () => {
    const cloud = memoryCloud();
    await createSettingsStorage({ cloud, local: null }).save({
      ...custom,
      types: [...custom.types],
    });
    expect(cloud.data.has(STORAGE_KEY)).toBe(true);
    expect(await createSettingsStorage({ cloud, local: null }).load()).toEqual({
      ...custom,
      types: [...custom.types],
    });
  });

  it.each([
    ['пусто', null],
    ['не JSON', '{oops'],
    ['не объект', '42'],
    ['чужой тип сигнала', JSON.stringify({ ...defaultSettings(), types: ['horn4'] })],
    ['строка вместо числа', JSON.stringify({ ...defaultSettings(), durationSec: '60' })],
    ['неверный отсчёт', JSON.stringify({ ...defaultSettings(), countdownSec: 7 })],
  ])('TC-39: битые данные (%s) → значения по умолчанию', async (_, raw) => {
    const local = memoryStorage();
    if (raw !== null) local.setItem(STORAGE_KEY, raw);
    expect(await createSettingsStorage({ local }).load()).toEqual(defaultSettings());
    expect(parseSettings(raw)).toBeNull();
  });

  it('TC-39: localStorage бросает исключение — работаем со значениями по умолчанию', async () => {
    const local = memoryStorage();
    local.getItem = () => {
      throw new Error('denied');
    };
    local.setItem = () => {
      throw new Error('denied');
    };
    const st = createSettingsStorage({ local });
    await expect(st.save(defaultSettings())).resolves.toBeUndefined();
    expect(await st.load()).toEqual(defaultSettings());
  });
});

describe('wake lock', () => {
  function fakeNav() {
    const sentinels: Array<{ released: boolean; release: () => Promise<void> }> = [];
    const request = vi.fn(async () => {
      const s = {
        released: false,
        release: async () => {
          s.released = true;
        },
      };
      sentinels.push(s);
      return s;
    });
    return { nav: { wakeLock: { request } } as unknown as Navigator, request, sentinels };
  }

  it('TC-40: acquire запрашивает, release отпускает, после потери — запрашивается повторно', async () => {
    const { nav, request, sentinels } = fakeNav();
    const wl = createWakeLock(nav);
    expect(wl.supported).toBe(true);
    await wl.acquire();
    await wl.acquire(); // already held
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    await wl.release();
    expect(sentinels[0]!.released).toBe(true);
    await wl.acquire();
    expect(request).toHaveBeenCalledTimes(2);
    sentinels[1]!.released = true; // browser dropped it when the page was hidden
    await wl.acquire();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('TC-40: нет Wake Lock API или запрос отклонён — без ошибок', async () => {
    await expect(createWakeLock({} as Navigator).acquire()).resolves.toBeUndefined();
    const nav = {
      wakeLock: { request: () => Promise.reject(new DOMException('x', 'NotAllowedError')) },
    } as unknown as Navigator;
    await expect(createWakeLock(nav).acquire()).resolves.toBeUndefined();
  });
});
