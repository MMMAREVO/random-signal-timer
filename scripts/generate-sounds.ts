/**
 * Generates public/sounds/*.wav: 44.1 kHz, mono, 16-bit PCM, peak at −1 dBFS.
 * Each signal is one file so repeats inside a signal stay evenly spaced.
 * Run: npm run sounds
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNALS, SOUND_IDS, type SoundId } from '../src/domain/signals';

export const SAMPLE_RATE = 44_100;
const PEAK_DB = -1;
const FADE_MS = 5;

type Wave = 'square' | 'saw' | 'sine';
interface Tone {
  kind: 'tone';
  ms: number;
  /** One or more frequencies, mixed together (gives a "harsh" horn). */
  freqs: number[];
  wave: Wave;
  /** Optional frequency alternation for the finish siren. */
  altFreq?: number;
  altEveryMs?: number;
  /** For 'sine': extra partials as [frequency ratio, amplitude]; non-integer ratios give a bell. */
  partials?: Array<[number, number]>;
  /** Exponential decay time constant — a struck, percussive sound instead of a flat tone. */
  decayMs?: number;
}
interface Rest {
  kind: 'rest';
  ms: number;
}
export type Part = Tone | Rest;

/** Rounded 1 kHz tone (sine + odd harmonics), as in gym interval timers. */
const sportPip: Tone = {
  kind: 'tone',
  ms: 110,
  freqs: [1000],
  wave: 'sine',
  partials: [
    [3, 0.3],
    [5, 0.1],
  ],
};
/** Plain electronic 1 kHz pip. */
const squarePip: Tone = { kind: 'tone', ms: 90, freqs: [1000], wave: 'square' };
export const rest = (ms: number): Rest => ({ kind: 'rest', ms });

/**
 * Chosen by ear (scripts/preview-beeps.ts): each beep signal has its own timbre — high square,
 * rounded tone, low square; "tu-tu" is mid, the horn is low. Keep signals.ts durations in sync (TC-23).
 */
export const DESIGN: Record<SoundId, Part[]> = {
  beep1: [{ kind: 'tone', ms: 100, freqs: [1800], wave: 'square' }],
  beep2: [sportPip, rest(70), sportPip],
  beep3: [squarePip, rest(60), squarePip, rest(60), squarePip],
  horn1: [{ kind: 'tone', ms: 350, freqs: [220, 221.5, 330], wave: 'saw' }],
  tutu: [
    { kind: 'tone', ms: 150, freqs: [1047], wave: 'square' },
    rest(40),
    { kind: 'tone', ms: 150, freqs: [698], wave: 'square' },
  ],
  finish: [{ kind: 'tone', ms: 1500, freqs: [1200], wave: 'saw', altFreq: 800, altEveryMs: 125 }],
};

function osc(t: Tone, phase: number): number {
  const p = phase - Math.floor(phase);
  if (t.wave === 'square') return p < 0.5 ? 1 : -1;
  if (t.wave === 'saw') return 2 * p - 1;
  let v = Math.sin(2 * Math.PI * phase);
  for (const [ratio, amp] of t.partials ?? []) v += amp * Math.sin(2 * Math.PI * phase * ratio);
  return v;
}

function renderTone(t: Tone): Float32Array {
  const n = Math.round((t.ms / 1000) * SAMPLE_RATE);
  const out = new Float32Array(n);
  const fade = Math.round((FADE_MS / 1000) * SAMPLE_RATE);
  const phases = t.freqs.map(() => 0);
  for (let i = 0; i < n; i++) {
    const ms = (i / SAMPLE_RATE) * 1000;
    const useAlt =
      t.altFreq !== undefined && t.altEveryMs && Math.floor(ms / t.altEveryMs) % 2 === 1;
    let v = 0;
    t.freqs.forEach((f, k) => {
      const freq = useAlt ? (t.altFreq as number) * (f / (t.freqs[0] as number)) : f;
      phases[k] = (phases[k] as number) + freq / SAMPLE_RATE;
      v += osc(t, phases[k] as number);
    });
    const decay = t.decayMs ? Math.exp(-ms / t.decayMs) : 1;
    const env = Math.min(1, i / fade, (n - 1 - i) / fade) * decay;
    out[i] = (v / t.freqs.length) * Math.max(0, env);
  }
  return out;
}

export function renderSound(id: SoundId): Float32Array {
  return renderParts(DESIGN[id]);
}

export function renderParts(parts: Part[]): Float32Array {
  const chunks = parts.map((p) =>
    p.kind === 'tone' ? renderTone(p) : new Float32Array(Math.round((p.ms / 1000) * SAMPLE_RATE)),
  );
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  // Normalise peak to −1 dBFS.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 10 ** (PEAK_DB / 20) / peak : 0;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) * gain;
  return out;
}

export function encodeWav(samples: Float32Array): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  samples.forEach((v, i) => {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2);
  });
  return buf;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');
  mkdirSync(outDir, { recursive: true });
  for (const id of SOUND_IDS) {
    const wav = encodeWav(renderSound(id));
    writeFileSync(join(outDir, SIGNALS[id].file), wav);
    console.log(`${SIGNALS[id].file}: ${(wav.length / 1024).toFixed(1)} KB`);
  }
}
