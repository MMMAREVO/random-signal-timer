/**
 * Writes preview/beeps.html + WAVs: several candidate designs for the three beep signals,
 * to pick one by ear. Not part of the app build. Run: npx tsx scripts/preview-beeps.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN, encodeWav, renderParts, rest, type Part } from './generate-sounds';

type BeepId = 'beep1' | 'beep2' | 'beep3';
interface Variant {
  key: string;
  title: string;
  note: string;
  parts: Record<BeepId, Part[]>;
}

const series = (make: (i: number) => Part, n: number, gapMs: number): Part[] =>
  Array.from({ length: n }, (_, i) => (i ? [rest(gapMs), make(i)] : [make(i)])).flat();

const sport = (): Part => ({
  kind: 'tone',
  ms: 110,
  freqs: [1000],
  wave: 'sine',
  partials: [
    [3, 0.3],
    [5, 0.1],
  ],
});
const NOTES = [1047, 1319, 1568];
const note = (i: number, ms = 100): Part => ({
  kind: 'tone',
  ms,
  freqs: [NOTES[i] as number],
  wave: 'sine',
  partials: [
    [2, 0.3],
    [3, 0.2],
  ],
});
const bell = (): Part => ({
  kind: 'tone',
  ms: 140,
  freqs: [1400],
  wave: 'sine',
  partials: [
    [2.76, 0.5],
    [5.4, 0.25],
  ],
  decayMs: 45,
});
const lowSquare = (): Part => ({ kind: 'tone', ms: 90, freqs: [1000], wave: 'square' });

const VARIANTS: Variant[] = [
  {
    key: 'current',
    title: 'Сейчас в приложении',
    note: 'Прямоугольная волна, высокие частоты 1800 / 2500 / 3300 Гц',
    parts: { beep1: DESIGN.beep1, beep2: DESIGN.beep2, beep3: DESIGN.beep3 },
  },
  {
    key: 'sport',
    title: 'A. Спортивный таймер',
    note: 'Округлый тон 1000 Гц, одна высота, чуть длиннее и мягче',
    parts: {
      beep1: [sport()],
      beep2: series(sport, 2, 70),
      beep3: series(sport, 3, 70),
    },
  },
  {
    key: 'melody',
    title: 'B. Ноты вверх',
    note: '1 — до, 2 — до-ми, 3 — до-ми-соль; различаются мелодией',
    parts: {
      beep1: [note(0, 130)],
      beep2: series((i) => note(i), 2, 40),
      beep3: series((i) => note(i), 3, 40),
    },
  },
  {
    key: 'bell',
    title: 'C. Колокольчик',
    note: 'Звонкий «динь» с затуханием',
    parts: {
      beep1: [bell()],
      beep2: series(bell, 2, 20),
      beep3: series(bell, 3, 20),
    },
  },
  {
    key: 'low',
    title: 'D. Электронный пониже',
    note: 'Как сейчас, но ниже (1000 Гц) и одной высоты — не так режет слух',
    parts: {
      beep1: [lowSquare()],
      beep2: series(lowSquare, 2, 60),
      beep3: series(lowSquare, 3, 60),
    },
  },
];

const LABELS: Record<BeepId, string> = { beep1: '1 бип', beep2: '2 бипа', beep3: '3 бипа' };
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'preview');
mkdirSync(join(outDir, 'beeps'), { recursive: true });

const cards = VARIANTS.map((v) => {
  const buttons = (Object.keys(LABELS) as BeepId[])
    .map((id) => {
      const samples = renderParts(v.parts[id]);
      const file = `beeps/${v.key}-${id}.wav`;
      writeFileSync(join(outDir, file), encodeWav(samples));
      const ms = Math.round((samples.length / 44_100) * 1000);
      return `<button data-src="${file}">${LABELS[id]}<small>${ms} мс</small></button>`;
    })
    .join('');
  return `<section><h2>${v.title}</h2><p>${v.note}</p><div class="row">${buttons}<button class="all">Все подряд</button></div></section>`;
}).join('\n');

writeFileSync(
  join(outDir, 'beeps.html'),
  `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Варианты бипов</title>
<style>
body{margin:0;background:#000;color:#fff;font:18px system-ui,sans-serif;padding:16px;max-width:560px;margin:auto}
h1{font-size:1.5rem}section{background:#161616;border-radius:14px;padding:14px;margin-bottom:14px}
h2{margin:0 0 4px;font-size:1.15rem}p{margin:0 0 12px;color:#b8b8b8;font-size:.95rem}
.row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
button{min-height:64px;border:2px solid #00c853;background:#0b2e18;color:#fff;border-radius:12px;font:700 1rem system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center}
button small{font-weight:400;color:#b8b8b8;font-size:.75rem}.all{background:#00c853;color:#000}
</style></head><body>
<h1>Варианты бипов</h1>
<p>Нажмите, послушайте, скажите букву варианта. «Все подряд» играет 1, 2 и 3 бипа с паузой в секунду.</p>
${cards}
<script>
const play = (src) => new Promise((done) => { const a = new Audio(src); a.onended = done; a.play(); });
document.querySelectorAll('button[data-src]').forEach((b) => b.onclick = () => play(b.dataset.src));
document.querySelectorAll('.all').forEach((b) => b.onclick = async () => {
  for (const s of b.parentElement.querySelectorAll('button[data-src]')) {
    await play(s.dataset.src);
    await new Promise((r) => setTimeout(r, 1000));
  }
});
</script></body></html>
`,
);
console.log(`preview/beeps.html: ${VARIANTS.length} вариантов`);
