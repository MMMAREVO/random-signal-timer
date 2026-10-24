import { SIGNALS, SOUND_IDS, type SoundId } from '../domain/signals';

/**
 * Sounds go through <audio> elements, not Web Audio: on iPhone Web Audio is muted by the
 * silent switch while <audio> keeps playing (hypothesis to verify on real phones, TC-53).
 */
export interface AudioPlayer {
  /** Must be called synchronously inside the "Start" tap: primes every sound. */
  unlock(): void;
  play(id: SoundId): Promise<void>;
  /** Called when the browser refuses to play (autoplay policy). */
  onBlocked(listener: (error: unknown) => void): void;
}

export interface AudioOptions {
  baseUrl: string;
  createAudio?: (src: string) => HTMLAudioElement;
  nav?: Navigator;
}

interface AudioSessionLike {
  type: string;
}

export function createAudioPlayer(opts: AudioOptions): AudioPlayer {
  const create = opts.createAudio ?? ((src: string) => new Audio(src));
  const nav = opts.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const listeners: Array<(e: unknown) => void> = [];
  const elements = new Map<SoundId, HTMLAudioElement>();
  /** Elements currently being primed muted; a real play() takes them over. */
  const priming = new Set<HTMLAudioElement>();

  for (const id of SOUND_IDS) {
    const el = create(opts.baseUrl + SIGNALS[id].file);
    el.preload = 'auto';
    el.load?.();
    elements.set(id, el);
  }

  const blocked = (e: unknown) => listeners.forEach((l) => l(e));

  return {
    unlock() {
      const session = (nav as unknown as { audioSession?: AudioSessionLike } | undefined)
        ?.audioSession;
      if (session) {
        try {
          session.type = 'playback';
        } catch {
          // older engines expose a read-only property
        }
      }
      for (const el of elements.values()) {
        priming.add(el);
        el.muted = true;
        let p: Promise<void> | undefined;
        try {
          p = el.play();
        } catch {
          p = undefined;
        }
        const done = () => {
          if (!priming.has(el)) return;
          priming.delete(el);
          el.pause();
          el.currentTime = 0;
          el.muted = false;
        };
        if (p && typeof p.then === 'function') p.then(done, done);
        else done();
      }
    },

    async play(id) {
      const el = elements.get(id);
      if (!el) return;
      priming.delete(el);
      el.muted = false;
      try {
        el.currentTime = 0;
        await el.play();
      } catch (e) {
        blocked(e);
        throw e;
      }
    },

    onBlocked(listener) {
      listeners.push(listener);
    },
  };
}
