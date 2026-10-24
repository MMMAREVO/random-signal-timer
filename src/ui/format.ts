const pad = (n: number) => String(n).padStart(2, '0');

/** 65 → "1:05" (duration field). */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${pad(Math.round(sec - m * 60))}`;
}

/** 65000 → "01:05" (journal, timers). Rounds down: a signal at 12.9 s is shown as 00:12. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Remaining time: rounds up so the display reaches 00:00 exactly at the end. */
export function formatRemaining(ms: number): string {
  return formatClock(Math.ceil(Math.max(0, ms) / 1000) * 1000);
}

/** "1:30", "90", "1" (minutes) → seconds; NaN if unparseable. */
export function parseDuration(text: string): number {
  const t = text.trim().replace(/[.,]/g, ':');
  let m = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2})$/.exec(t);
  if (m) return Number(m[1]) * 60;
  return Number.NaN;
}

export function formatGap(sec: number): string {
  return `${String(sec).replace('.', ',')} с`;
}
