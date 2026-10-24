import './ui/styles.css';
import { createAudioPlayer } from './platform/audio';
import { createSettingsStorage } from './platform/storage';
import { createTelegram } from './platform/telegram';
import { createWakeLock } from './platform/wakeLock';
import { createApp } from './ui/app';

const telegram = createTelegram(window);
const root = document.getElementById('app') as HTMLElement;

void createApp({
  root,
  audio: createAudioPlayer({ baseUrl: `${import.meta.env.BASE_URL}sounds/` }),
  telegram,
  storage: createSettingsStorage({ cloud: telegram.cloudStorage }),
  wakeLock: createWakeLock(navigator),
  clock: {
    now: () => performance.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  },
  rng: Math.random,
  version: `v${__APP_VERSION__} · ${__BUILD_ID__}`,
});
