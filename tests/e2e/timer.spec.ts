import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

interface PlayedSound {
  file: string;
  t: number;
}

/** Records every audible play() instead of producing sound; unlock (muted) plays are ignored. */
async function prepare(page: Page) {
  await page.route('https://telegram.org/**', (r) => r.abort());
  await page.addInitScript(() => {
    const w = window as unknown as { __played: Array<{ file: string; t: number }> };
    w.__played = [];
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!this.muted)
        w.__played.push({ file: this.src.split('/').pop() ?? '', t: performance.now() });
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {};
    HTMLMediaElement.prototype.load = function () {};
  });
  await page.clock.install();
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Старт' })).toBeVisible();
}

const played = (page: Page) =>
  page.evaluate(() => (window as unknown as { __played: PlayedSound[] }).__played);
const signalsOnly = (p: PlayedSound[]) => p.filter((x) => x.file !== 'finish.wav');

test.describe('сквозные сценарии', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
  });

  test('TC-48: 1 мин, 3 типа, 10 сигналов → Старт → +66 с: 10 сигналов выбранных типов, финиш, журнал', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '1 мин' }).click();
    await page.getByRole('checkbox', { name: 'Кря', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: 'Крик', exact: true }).uncheck();
    await page.getByLabel('Число сигналов').fill('10');
    await page.getByRole('button', { name: 'Старт' }).click();
    await expect(page.locator('.countdown-number')).toHaveText('5');
    await page.clock.runFor(66_000);

    await expect(page.getByRole('heading', { name: 'Готово' })).toBeVisible();
    const p = await played(page);
    const sigs = signalsOnly(p);
    expect(sigs).toHaveLength(10);
    for (const s of sigs) expect(['whistle1.wav', 'whistle2.wav', 'horn1.wav']).toContain(s.file);
    expect(new Set(sigs.map((s) => s.file)).size).toBe(3);
    expect(p.filter((x) => x.file === 'finish.wav')).toHaveLength(1);
    expect(p.at(-1)!.file).toBe('finish.wav');
    await expect(page.getByRole('listitem')).toHaveCount(10);
    await expect(page.getByRole('listitem').first()).toHaveText(
      /^\d\d:\d\d — (1 свисток|2 свистка|Гудок)$/,
    );
  });

  test('TC-48: два запуска подряд дают разные расписания', async ({ page }) => {
    await page.getByRole('button', { name: 'Старт' }).click();
    await page.clock.runFor(66_000);
    const first = await page.locator('.log').innerText();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await page.clock.runFor(66_000);
    const second = await page.locator('.log').innerText();
    expect(second).not.toBe(first);
  });

  test('TC-49: Стоп на 20-й секунде → +60 с: новых звуков нет', async ({ page }) => {
    await page.getByRole('button', { name: 'Старт' }).click();
    await page.clock.runFor(5000 + 20_000);
    await page.getByRole('button', { name: 'Стоп' }).click();
    await expect(page.getByRole('button', { name: 'Старт' })).toBeVisible();
    const n = (await played(page)).length;
    await page.clock.runFor(60_000);
    expect(await played(page)).toHaveLength(n);
  });

  test('TC-50: пауза 15 с → Продолжить: всё равно 10 сигналов, финиш позже на 15 с', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Старт' }).click();
    const t0 = await page.evaluate(() => performance.now());
    await page.clock.runFor(5000 + 20_000);
    await page.getByRole('button', { name: 'Пауза' }).click();
    await expect(page.getByText('Таймер на паузе')).toBeVisible();
    const during = (await played(page)).length;
    await page.clock.runFor(15_000);
    expect(await played(page)).toHaveLength(during);
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.clock.runFor(39_000);
    expect((await played(page)).some((x) => x.file === 'finish.wav')).toBe(false);
    await page.clock.runFor(2_000);
    await expect(page.getByRole('heading', { name: 'Готово' })).toBeVisible();
    const p = await played(page);
    expect(signalsOnly(p)).toHaveLength(10);
    const finish = p.find((x) => x.file === 'finish.wav')!;
    expect(Math.abs(finish.t - t0 - (5000 + 60_000 + 15_000))).toBeLessThan(1000);
  });

  test('TC-51: перезагрузка страницы — настройки сохранились', async ({ page }) => {
    await page.getByRole('button', { name: '2 мин' }).click();
    await page.getByRole('checkbox', { name: 'Крик', exact: true }).uncheck();
    await page.getByLabel('Число сигналов').fill('7');
    await page.reload();
    await expect(page.getByLabel('Длительность')).toHaveValue('2:00');
    await expect(page.getByRole('checkbox', { name: 'Крик', exact: true })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: '1 свисток', exact: true })).toBeChecked();
    await expect(page.getByLabel('Число сигналов')).toHaveValue('7');
  });

  test('TC-52: страница скрыта во время таймера — автопауза и сообщение', async ({ page }) => {
    await page.getByRole('button', { name: 'Старт' }).click();
    await page.clock.runFor(5000 + 10_000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByText('Таймер на паузе')).toBeVisible();
    const n = (await played(page)).length;
    await page.clock.runFor(60_000);
    expect(await played(page)).toHaveLength(n);
    await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible();
  });

  test('TC-47: доступность — кнопки ≥ 48 × 48 px, нет критичных нарушений axe', async ({
    page,
  }) => {
    const checkScreen = async () => {
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      for (const b of await page.locator('button:visible').all()) {
        const box = await b.boundingBox();
        expect(box, await b.innerText()).not.toBeNull();
        expect(box!.width, await b.innerText()).toBeGreaterThanOrEqual(48);
        expect(box!.height, await b.innerText()).toBeGreaterThanOrEqual(48);
      }
    };
    await page.locator('summary').click();
    await checkScreen();
    await page.getByRole('button', { name: 'Старт' }).click();
    await checkScreen();
    await page.clock.runFor(5000 + 3000);
    await checkScreen();
    await page.clock.runFor(60_000);
    await expect(page.getByRole('heading', { name: 'Готово' })).toBeVisible();
    await checkScreen();
  });
});
