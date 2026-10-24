import {
  COUNTDOWN_OPTIONS,
  defaultSettings,
  type CountdownSec,
  type Settings,
} from '../domain/settings';
import { isSignalType } from '../domain/signals';
import type { CloudStorageLike } from './telegram';

export const STORAGE_KEY = 'settings_v1';

export interface SettingsStorage {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
}

export interface StorageOptions {
  cloud?: CloudStorageLike | null;
  local?: Storage | null;
}

/** Corrupted or foreign data → null; the caller falls back to defaults. */
export function parseSettings(raw: string | null | undefined): Settings | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  if (!num(o.durationSec) || !num(o.count) || !num(o.gapSec)) return null;
  if (!Array.isArray(o.types) || !o.types.every(isSignalType)) return null;
  if (!COUNTDOWN_OPTIONS.includes(o.countdownSec as CountdownSec)) return null;
  return {
    durationSec: o.durationSec as number,
    types: [...new Set(o.types)],
    count: o.count as number,
    gapSec: o.gapSec as number,
    countdownSec: o.countdownSec as CountdownSec,
    showFlash: typeof o.showFlash === 'boolean' ? o.showFlash : true,
  };
}

function cloudGet(cloud: CloudStorageLike, key: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);
    try {
      cloud.getItem(key, (err, value) => {
        clearTimeout(timer);
        resolve(err ? null : (value ?? null));
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Telegram CloudStorage when available (follows the user across devices), localStorage as backup. */
export function createSettingsStorage(opts: StorageOptions = {}): SettingsStorage {
  const local = opts.local === undefined ? safeLocalStorage() : opts.local;
  const cloud = opts.cloud ?? null;

  const localGet = () => {
    try {
      return local?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  };

  return {
    async load() {
      const fromCloud = cloud ? parseSettings(await cloudGet(cloud, STORAGE_KEY)) : null;
      return fromCloud ?? parseSettings(localGet()) ?? defaultSettings();
    },

    async save(settings) {
      const raw = JSON.stringify(settings);
      try {
        local?.setItem(STORAGE_KEY, raw);
      } catch {
        // private mode / quota — not critical
      }
      if (cloud) {
        await new Promise<void>((resolve) => {
          try {
            cloud.setItem(STORAGE_KEY, raw, () => resolve());
          } catch {
            resolve();
          }
        });
      }
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
