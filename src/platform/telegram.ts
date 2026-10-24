/**
 * The only place that touches window.Telegram. Outside Telegram every method is a no-op,
 * so the app runs in a normal browser too.
 * Docs: https://core.telegram.org/bots/webapps
 */

export interface CloudStorageLike {
  getItem(key: string, cb: (err: unknown, value?: string) => void): void;
  setItem(key: string, value: string, cb?: (err: unknown, ok?: boolean) => void): void;
}

interface WebAppLike {
  version?: string;
  ready?(): void;
  expand?(): void;
  isVersionAtLeast?(v: string): boolean;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent?(name: string, cb: () => void): void;
  HapticFeedback?: {
    impactOccurred?(style: string): void;
    notificationOccurred?(type: string): void;
  };
  CloudStorage?: CloudStorageLike;
  initData?: string;
}

export interface TelegramBridge {
  readonly isTelegram: boolean;
  init(): void;
  setClosingConfirmation(enabled: boolean): void;
  haptic(kind: 'signal' | 'finish' | 'tap'): void;
  onActiveChange(cb: (active: boolean) => void): void;
  readonly cloudStorage: CloudStorageLike | null;
}

export function createTelegram(win: Window = window): TelegramBridge {
  const wa = (win as unknown as { Telegram?: { WebApp?: WebAppLike } }).Telegram?.WebApp;
  // telegram-web-app.js defines WebApp even in a plain browser; real launches carry initData/version.
  const app = wa && (wa.initData || wa.version) ? wa : undefined;
  const atLeast = (v: string) => {
    if (!app) return false;
    try {
      return app.isVersionAtLeast ? app.isVersionAtLeast(v) : false;
    } catch {
      return false;
    }
  };
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      // never let the wrapper break the timer
    }
  };

  return {
    isTelegram: !!app,
    cloudStorage: app && atLeast('6.9') && app.CloudStorage ? app.CloudStorage : null,

    init() {
      if (!app) return;
      safe(() => app.ready?.());
      safe(() => app.expand?.());
      if (atLeast('7.7')) safe(() => app.disableVerticalSwipes?.());
      if (atLeast('6.1')) {
        safe(() => app.setHeaderColor?.('#000000'));
        safe(() => app.setBackgroundColor?.('#000000'));
      }
    },

    setClosingConfirmation(enabled) {
      if (!app || !atLeast('6.2')) return;
      safe(() =>
        enabled ? app.enableClosingConfirmation?.() : app.disableClosingConfirmation?.(),
      );
    },

    haptic(kind) {
      if (!app || !atLeast('6.1')) return;
      const h = app.HapticFeedback;
      safe(() => {
        if (kind === 'tap') h?.impactOccurred?.('light');
        else if (kind === 'finish') h?.notificationOccurred?.('success');
        else h?.impactOccurred?.('heavy');
      });
    },

    onActiveChange(cb) {
      if (!app || !atLeast('8.0')) return;
      safe(() => app.onEvent?.('activated', () => cb(true)));
      safe(() => app.onEvent?.('deactivated', () => cb(false)));
    },
  };
}
