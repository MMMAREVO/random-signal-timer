/**
 * Keeps the screen on while the timer runs (Screen Wake Lock API).
 * The browser drops the lock when the page is hidden, so acquire() is called again on return.
 */
export interface WakeLockController {
  acquire(): Promise<void>;
  release(): Promise<void>;
  readonly supported: boolean;
}

interface SentinelLike {
  released?: boolean;
  release(): Promise<void>;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<SentinelLike>;
}

export function createWakeLock(
  nav: Navigator | undefined = globalThis.navigator,
): WakeLockController {
  const api = (nav as unknown as { wakeLock?: WakeLockApi } | undefined)?.wakeLock;
  let sentinel: SentinelLike | null = null;
  let wanted = false;

  return {
    supported: !!api,

    async acquire() {
      wanted = true;
      if (!api || (sentinel && !sentinel.released)) return;
      try {
        const s = await api.request('screen');
        if (!wanted) {
          await s.release();
          return;
        }
        sentinel = s;
      } catch {
        // not allowed (hidden page, policy) — the UI still works, the screen may dim
      }
    },

    async release() {
      wanted = false;
      const s = sentinel;
      sentinel = null;
      if (s && !s.released) {
        try {
          await s.release();
        } catch {
          // already released by the browser
        }
      }
    },
  };
}
