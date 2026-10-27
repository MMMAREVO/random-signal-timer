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
  /** One or more frequencies, mixed together (detuned pairs sound harsh). */
  freqs: number[];
  wave: Wave;
  /** For 'sine': extra partials as [frequency ratio, amplitude]; non-integer ratios give a bell. */
  partials?: Array<[number, number]>;
  /** Exponential decay time constant — a struck, percussive sound instead of a flat tone. */
  decayMs?: number;
  /** Pitch at the end relative to the start (linear glide), e.g. 0.7 for a falling tone. */
  glide?: number;
  /** Pitch and loudness wobble — the rattling pea of a referee whistle. */
  trill?: { hz: number; pitch: number; depth: number };
  /** Breath noise mixed in, as a share of the tone. */
  noise?: number;
  /** Resonant band-passes (formants) as [Hz, Q, gain], mixed over the dry tone. */
  formants?: { peaks: Array<[number, number, number]>; mix: number };
  /** Saturation (tanh) amount after mixing — harsher, more distorted sound. */
  drive?: number;
}
interface Rest {
  kind: 'rest';
  ms: number;
}
export type Part = Tone | Rest;

/** Referee pea whistle: piercing ~3.4 kHz, bright overtones, fast trill, overdriven. */
const whistle = (ms: number): Tone => ({
  kind: 'tone',
  ms,
  freqs: [3400],
  wave: 'sine',
  partials: [
    [2, 0.3],
    [3, 0.12],
  ],
  trill: { hz: 40, pitch: 0.03, depth: 0.3 },
  noise: 0.04,
  drive: 3,
});
export const rest = (ms: number): Rest => ({ kind: 'rest', ms });

/** Steam locomotive chime whistle: three-note chord with breathy steam. */
const toot = (ms: number): Tone => ({
  kind: 'tone',
  ms,
  freqs: [440, 523, 659],
  wave: 'sine',
  partials: [
    [2, 0.35],
    [3, 0.15],
  ],
  glide: 0.98,
  trill: { hz: 5, pitch: 0.004, depth: 0.08 },
  noise: 0.12,
  drive: 1.5,
});

/**
 * Three whistles differ by length and count; "tutu" is a harsh electronic chirp;
 * "tu" is a steam locomotive whistle. Keep signals.ts durations in sync (TC-23).
 */
export const DESIGN: Record<SoundId, Part[]> = {
  whistle1: [whistle(200)],
  whistle2: [whistle(150), rest(70), whistle(150)],
  shortLong: [whistle(120), rest(70), whistle(400)],
  tutu: [toot(150), rest(60), toot(220)],
  train: [toot(450)],
  // Countdown: short wooden "tick" every second.
  tick: [
    {
      kind: 'tone',
      ms: 40,
      freqs: [1900],
      wave: 'sine',
      partials: [[2.7, 0.5]],
      noise: 0.4,
      decayMs: 8,
    },
  ],
  // Start and finish: struck gong — inharmonic partials, slow shimmer, long ring.
  gong: [
    {
      kind: 'tone',
      ms: 2500,
      freqs: [220, 221.3],
      wave: 'sine',
      partials: [
        [2.0, 0.6],
        [2.76, 0.8],
        [4.07, 0.5],
        [5.4, 0.35],
        [6.8, 0.2],
      ],
      noise: 0.05,
      decayMs: 750,
      drive: 2,
    },
  ],
};

function osc(t: Tone, phase: number): number {
  const p = phase - Math.floor(phase);
  if (t.wave === 'square') return p < 0.5 ? 1 : -1;
  if (t.wave === 'saw') return 2 * p - 1;
  let v = Math.sin(2 * Math.PI * phase);
  for (const [ratio, amp] of t.partials ?? []) v += amp * Math.sin(2 * Math.PI * phase * ratio);
  return v;
}

/** Deterministic white noise, so regenerated WAVs are byte-identical. */
function noiseSource(seed = 1): () => number {
  let x = seed;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return (x / 2 ** 32) * 2 - 1;
  };
}

/** RBJ band-pass biquad (constant 0 dB peak gain). */
function bandPass(input: Float32Array, hz: number, q: number): Float32Array {
  const w = (2 * Math.PI * hz) / SAMPLE_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const [b0, b2, a1, a2] = [alpha / a0, -alpha / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0];
  const out = new Float32Array(input.length);
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  input.forEach((x, i) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, x, y1, y];
    out[i] = y;
  });
  return out;
}

function renderTone(t: Tone): Float32Array {
  const n = Math.round((t.ms / 1000) * SAMPLE_RATE);
  const out = new Float32Array(n);
  const fade = Math.round((FADE_MS / 1000) * SAMPLE_RATE);
  const phases = t.freqs.map(() => 0);
  const noise = noiseSource();
  for (let i = 0; i < n; i++) {
    const ms = (i / SAMPLE_RATE) * 1000;
    const trill = t.trill ? Math.sin((2 * Math.PI * t.trill.hz * ms) / 1000) : 0;
    const bend = (1 + ((t.glide ?? 1) - 1) * (i / n)) * (1 + (t.trill?.pitch ?? 0) * trill);
    let v = 0;
    t.freqs.forEach((f, k) => {
      phases[k] = (phases[k] as number) + (f * bend) / SAMPLE_RATE;
      v += osc(t, phases[k] as number);
    });
    v = v / t.freqs.length + (t.noise ?? 0) * noise();
    const am = t.trill ? 1 - t.trill.depth * (0.5 - 0.5 * trill) : 1;
    const decay = t.decayMs ? Math.exp(-ms / t.decayMs) : 1;
    const env = Math.min(1, i / fade, (n - 1 - i) / fade) * decay * am;
    out[i] = v * Math.max(0, env);
  }
  const shaped = t.formants ? applyFormants(out, t.formants) : out;
  if (!t.drive) return shaped;
  const d = t.drive;
  return shaped.map((v) => Math.tanh(d * v) / Math.tanh(d));
}

function applyFormants(dry: Float32Array, f: NonNullable<Tone['formants']>): Float32Array {
  const wet = new Float32Array(dry.length);
  for (const [hz, q, gain] of f.peaks) {
    bandPass(dry, hz, q).forEach((v, i) => (wet[i] = (wet[i] as number) + gain * v));
  }
  return dry.map((v, i) => (1 - f.mix) * v + f.mix * 3 * (wet[i] as number));
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
