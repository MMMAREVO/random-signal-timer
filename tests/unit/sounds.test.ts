import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIGNALS, SOUND_IDS } from '../../src/domain/signals';

const dir = join(__dirname, '..', '..', 'public', 'sounds');

interface Wav {
  sampleRate: number;
  channels: number;
  bits: number;
  samples: Int16Array;
}

function readWav(file: string): Wav {
  const b = readFileSync(join(dir, file));
  expect(b.toString('ascii', 0, 4)).toBe('RIFF');
  expect(b.toString('ascii', 8, 12)).toBe('WAVE');
  let off = 12;
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | undefined;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: b.readUInt16LE(body),
        channels: b.readUInt16LE(body + 2),
        sampleRate: b.readUInt32LE(body + 4),
        bits: b.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error(`${file}: data before fmt`);
      expect(fmt.format).toBe(1);
      const samples = new Int16Array(size / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = b.readInt16LE(body + i * 2);
      return { ...fmt, samples };
    }
    off = body + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

describe('sound files', () => {
  it('TC-22: 6 файлов в public/sounds, каждый — WAV 44,1 кГц, моно, 16 бит', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    expect(files.sort()).toEqual(SOUND_IDS.map((id) => SIGNALS[id].file).sort());
    for (const id of SOUND_IDS) {
      const w = readWav(SIGNALS[id].file);
      expect(w.sampleRate).toBe(44_100);
      expect(w.channels).toBe(1);
      expect(w.bits).toBe(16);
    }
  });

  it.each(SOUND_IDS.map((id) => [id]))(
    'TC-23: длительность %s совпадает с каталогом signals.ts ± 10 мс',
    (id) => {
      const w = readWav(SIGNALS[id].file);
      const ms = (w.samples.length / w.sampleRate) * 1000;
      expect(Math.abs(ms - SIGNALS[id].durationMs)).toBeLessThanOrEqual(10);
    },
  );

  it.each(SOUND_IDS.map((id) => [id]))('TC-24: пик %s от −1,5 до −0,5 дБ', (id) => {
    const w = readWav(SIGNALS[id].file);
    let peak = 0;
    for (const v of w.samples) peak = Math.max(peak, Math.abs(v));
    const db = 20 * Math.log10(peak / 32767);
    expect(db).toBeGreaterThanOrEqual(-1.5);
    expect(db).toBeLessThanOrEqual(-0.5);
  });
});
