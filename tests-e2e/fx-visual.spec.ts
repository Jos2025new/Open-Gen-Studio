import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

/*
 * FX layers in the real browser (docs/fx-pruebas.md, ADR 0011), on the sandbox only: start `npm run dev:sandbox`,
 * then `npm run fx:check` (one case: `npm run fx:check -- -g "Blur"`). It drives the app like a user, saves a
 * screenshot per case in tests-e2e/screens/fx/, and checks on the canvas pixels that each filter changes the page,
 * keeps the content where and as big as it was (the zoom bug of 9364125) and that undo brings it back.
 * FX_BENCH=50 adds that many FX layers with a performance trace (ADR 0012) and prints where to read it.
 * Stop the sandbox when done.
 */
const ORIGIN = 'http://localhost:5183';
const SHOTS = 'tests-e2e/screens/fx';
test.use({ viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath: chromium.executablePath() } });

function assertSandbox(page: Page) {
  if (new URL(page.url()).origin !== ORIGIN) throw new Error(`Refusing non-sandbox URL: ${page.url()}`);
}
const layers = (page: Page) => page.getByRole('complementary', { name: 'Layers', exact: true });
const fxMenu = (page: Page) => page.getByRole('dialog', { name: 'Filters and effects', exact: true });

/** The stage canvas against the page background: content box, and how many pixels differ from a saved copy. */
async function measure(page: Page, save?: string) {
  return page.evaluate((save) => {
    const c = document.querySelector('canvas.stage-canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const w = window as unknown as Record<string, Uint8ClampedArray | undefined>;
    const base = w.__fxBase;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, changed = 0;
    for (let i = 0; i < d.length; i += 4) {
      // Content: anything clearly brighter than the dark page and its border.
      if (d[i] + d[i + 1] + d[i + 2] > 300) { const p = i / 4, x = p % c.width, y = (p - x) / c.width; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (base && Math.abs(d[i] - base[i]) + Math.abs(d[i + 1] - base[i + 1]) + Math.abs(d[i + 2] - base[i + 2]) > 24) changed++;
    }
    if (save) w[save] = d;
    return { box: { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }, changed };
  }, save);
}

async function setup(page: Page, trace?: string) {
  await page.addInitScript(() => {
    // Saving is enabled ONLY in this isolated sandbox; never disable the real app's automation guard.
    if (location.port === '5183') Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /localhost:5183/.test(m.location().url ?? '')) errors.push(m.text()); });
  await page.goto(trace ? `${ORIGIN}/?trace=${encodeURIComponent(trace)}` : ORIGIN);
  assertSandbox(page);
  await page.waitForFunction(() => (window as any).__OGS_TEST__?.().hydrated);
  if (!(await page.getByRole('button', { name: 'New document', exact: true }).isVisible())) {
    await page.getByRole('button', { name: 'Switch workspace', exact: true }).click();
    await page.getByText('Designer', { exact: true }).click();
  }
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('button', { name: /^Landscape 16:9/ }).first().click();
  // Content with colour: a lime rectangle (the shape tool's default fill) and a text layer.
  await page.keyboard.press('r');
  const stage = page.locator('canvas.stage-canvas');
  const b = (await stage.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.45, b.y + b.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await layers(page).getByRole('button', { name: 'New layer', exact: true }).click();
  await page.getByRole('dialog', { name: 'New layer', exact: true }).getByRole('button', { name: 'Text', exact: true }).click();
  await page.keyboard.press('v');
  await page.waitForTimeout(300);
  return errors;
}

async function applyFx(page: Page, label: string | RegExp) {
  await layers(page).getByRole('button', { name: 'Filters and effects', exact: true }).click();
  await fxMenu(page).getByRole('button', { name: label, exact: typeof label === 'string' }).click();
  await page.waitForTimeout(250);
}

const FILTERS = ['Brightness', 'Contrast', 'Saturation', 'Hue', 'Grayscale', 'Sepia', 'Invert', 'Blur'];
const EFFECTS = ['Glow', 'Drop shadow', 'Lens flare'];

test.describe('each filter and effect on a layer', () => {
  for (const label of [...FILTERS, ...EFFECTS]) {
    test(label, async ({ page }) => {
      const errors = await setup(page);
      await mkdir(SHOTS, { recursive: true });
      const before = await measure(page, '__fxBase');
      expect(before.box.w, 'content drawn before the FX').toBeGreaterThan(20);
      // On the text layer (active): "Layer below", like a filter on that layer.
      await applyFx(page, label);
      // A black shadow does not show on the dark page: the same shadow in white, set in the FX layer's editor.
      if (label === 'Drop shadow') { await page.getByLabel('Color', { exact: true }).first().fill('#ffffff'); await page.waitForTimeout(250); }
      const after = await measure(page);
      await page.locator('canvas.stage-canvas').screenshot({ path: `${SHOTS}/${label.toLowerCase().replace(/ /g, '-')}.png` });
      // White text: colour filters other than these leave it white; they show on the rest only with "Everything below".
      if (!['Saturation', 'Hue', 'Brightness'].includes(label)) expect(after.changed, `${label} changes pixels`).toBeGreaterThan(50);
      // Light and shadow must be clearly visible on the text (the flare was once placed off the layer and clipped away).
      if (['Glow', 'Drop shadow', 'Lens flare', 'Blur'].includes(label)) expect(after.changed, `${label} is visible`).toBeGreaterThan(300);
      // The content keeps its place and size (blur, glow, shadow and flare may spread it a little).
      const slack = ['Blur', 'Glow', 'Drop shadow', 'Lens flare'].includes(label) ? 0.25 : 0.03;
      if (label !== 'Invert' && label !== 'Lens flare') {
        expect(Math.abs(after.box.x0 - before.box.x0), 'left edge').toBeLessThanOrEqual(before.box.w * slack + 2);
        expect(after.box.w, 'width').toBeGreaterThanOrEqual(before.box.w * (1 - slack));
      }
      // One undo per action: the FX layer, and the colour change of the shadow.
      // Undo is a Designer key: it does not reach a focused field, so the colour input lets go first.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let i = 0; i < (label === 'Drop shadow' ? 2 : 1); i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(250); }
      expect((await measure(page)).changed, 'undo restores the page').toBeLessThan(20);
      expect(errors).toEqual([]);
    });
  }
});

test('a filter layer over everything below changes the rectangle too', async ({ page }) => {
  const errors = await setup(page);
  await mkdir(SHOTS, { recursive: true });
  await measure(page, '__fxBase');
  await applyFx(page, /^New filter layer/);
  await layers(page).getByRole('combobox', { name: 'Add filter', exact: true }).first().selectOption('grayscale');
  await page.waitForTimeout(250);
  const after = await measure(page);
  await page.locator('canvas.stage-canvas').screenshot({ path: `${SHOTS}/everything-below-grayscale.png` });
  // The lime rectangle turns grey: many pixels change, not only the text.
  expect(after.changed).toBeGreaterThan(2000);
  expect(errors).toEqual([]);
});

const BENCH = Number(process.env.FX_BENCH ?? 0);
test(`bench: ${BENCH || 'off (FX_BENCH=n)'} FX layers with a trace`, async ({ page }) => {
  test.skip(!BENCH, 'set FX_BENCH to the number of FX layers');
  test.setTimeout(120_000 + BENCH * 2_000);
  await setup(page, `fx-bench-${BENCH}`);
  const mark = (text: string) => page.evaluate((t) => (window as any).__OGS_TRACE__.mark(t), text);
  const stage = page.locator('canvas.stage-canvas');
  const b = (await stage.boundingBox())!;
  const drag = async () => {
    await page.keyboard.press('v');
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
    await page.mouse.down();
    // At a real pointer's pace (60 Hz): sent all at once, the moves would land before the first frame.
    // There and back, so the rectangle ends where it started and the next drag still grabs it.
    for (let i = 0; i < 30; i++) { await page.mouse.move(b.x + b.width * (0.5 + (i < 15 ? i : 30 - i) / 300), b.y + b.height * 0.5); await page.waitForTimeout(16); }
    await page.waitForTimeout(500);
    await page.mouse.up();
  };
  for (const n of [1, 5, 10, 25, 50, 100, 200, 300].filter((k) => k <= BENCH)) {
    const have = await page.evaluate(() => (window as any).__OGS_TEST__().document.layers.filter((l: any) => l.type === 'fx').length);
    await mark(`adding blur layers up to ${n}`);
    for (let i = have; i < n; i++) await applyFx(page, 'Blur');
    await mark(`${n} FX layers: dragging`);
    await drag();
  }
  const id = await page.evaluate(() => (window as any).__OGS_TRACE__.stop());
  console.log(`Trace: .sandbox/data/logs/trace-${id}.jsonl → npm run trace:report`);
});
