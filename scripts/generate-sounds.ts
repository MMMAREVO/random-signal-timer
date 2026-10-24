/**
 * Generates public/sounds/*.wav: 44.1 kHz, mono, 16-bit PCM, peak at −1 dBFS.
 * Each signal is one file so repeats inside a signal stay evenly spaced.
 * Run: npm run sounds
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNALS, SOUND_IDS, type SoundId } from '../src/domain/signals';

export const SAMPLE_RATE = 44_100;
const PEAK_DB = -1;
const FADE_MS = 5;

type Wave = 'square' | 'saw';
interface Tone {
  kind: 'tone';
  ms: number;
  /** One or more frequencies, mixed together (gives a "harsh" horn). */
  freqs: number[];
  wave: Wave;
  /** Optional frequency alternation for the finish siren. */
  altFreq?: number;
  altEveryMs?: number;
}
interface Rest {
  kind: 'rest';
  ms: number;
}
type Part = Tone | Rest;

const beep: Tone = { kind: 'tone', ms: 150, freqs: [2500], wave: 'square' };
const horn: Tone = { kind: 'tone', ms: 400, freqs: [350, 352.5, 700], wave: 'saw' };
const rest = (ms: number): Rest => ({ kind: 'rest', ms });

/** Starting point from the plan; tune by ear and keep signals.ts durations in sync. */
export const DESIGN: Record<SoundId, Part[]> = {
  beep1: [beep],
  beep2: [beep, rest(150), beep],
  beep3: [beep, rest(150), beep, rest(150), beep],
  horn1: [horn],
  tutu: [
    { kind: 'tone', ms: 300, freqs: [880], wave: 'square' },
    rest(100),
    { kind: 'tone', ms: 300, freqs: [587], wave: 'square' },
  ],
  finish: [{ kind: 'tone', ms: 1500, freqs: [1200], wave: 'saw', altFreq: 800, altEveryMs: 125 }],
};

function osc(wave: Wave, phase: number): number {
  const p = phase - Math.floor(phase);
  return wave === 'square' ? (p < 0.5 ? 1 : -1) : 2 * p - 1;
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
      v += osc(t.wave, phases[k] as number);
    });
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = (v / t.freqs.length) * Math.max(0, env);
  }
  return out;
}

export function renderSound(id: SoundId): Float32Array {
  const chunks = DESIGN[id].map((p) =>
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

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');
mkdirSync(outDir, { recursive: true });
for (const id of SOUND_IDS) {
  const wav = encodeWav(renderSound(id));
  writeFileSync(join(outDir, SIGNALS[id].file), wav);
  console.log(`${SIGNALS[id].file}: ${(wav.length / 1024).toFixed(1)} KB`);
}
