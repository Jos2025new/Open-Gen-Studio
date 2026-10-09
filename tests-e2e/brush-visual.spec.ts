import { chromium, expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

/*
 * The brush tip in the real browser (sandbox only): start `npm run dev:sandbox`, then `npm run brush:check`.
 * Screenshots of the brush settings and of strokes go to tests-e2e/screens/brush/. Checks on the pixels: softer tips
 * fade at their edges, texture dims the paint, and a saved stroke replays as it was painted (real browser canvases).
 */
const ORIGIN = 'http://localhost:5183';
const SHOTS = 'tests-e2e/screens/brush';
test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, launchOptions: { executablePath: chromium.executablePath() } });

const panel = (page: Page) => page.getByRole('complementary', { name: 'Layers', exact: true });

async function setup(page: Page) {
  await page.addInitScript(() => { if (location.port === '5183') Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ORIGIN);
  if (new URL(page.url()).origin !== ORIGIN) throw new Error('sandbox only');
  await page.waitForFunction(() => (window as any).__OGS_TEST__?.().hydrated);
  // A fresh session: whatever the sandbox already holds stays as it is.
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  if (!(await page.getByRole('button', { name: 'New document', exact: true }).isVisible())) {
    await page.getByRole('button', { name: 'Switch workspace', exact: true }).click();
    await page.getByText('Designer', { exact: true }).click();
  }
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('button', { name: /^Landscape 16:9/ }).first().click();
  await page.keyboard.press('b');
  await mkdir(SHOTS, { recursive: true });
  return errors;
}

/** A wavy stroke across the page at a height (fraction of the stage). */
async function stroke(page: Page, y: number) {
  const b = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(b.x + b.width * (0.2 + i * 0.015), b.y + b.height * (y + Math.sin(i / 3) * 0.02));
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** The paint on the stage (white on the dark page): pixels with paint, partly covered ones, and the light in all. */
async function coverage(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas.stage-canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let partial = 0, painted = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; if (v > 40) { painted++; light += v; } if (v > 40 && v < 200) partial++; }
    return { partial, painted, light, share: painted ? partial / painted : 0 };
  });
}

/** Undo is a canvas key: it does not reach a focused field, so whatever has the focus lets go first. */
async function undo(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
}

/** Brush settings are kept by the app: each test starts from the same ones (white, hard, no texture). */
async function reset(page: Page) {
  await panel(page).getByRole('button', { name: /^Color/ }).first().click();
  await page.getByRole('textbox', { name: 'Hex' }).fill('#ffffff');
  await page.keyboard.press('Escape');
  await panel(page).getByRole('radio', { name: 'Hard', exact: true }).click();
  await panel(page).getByRole('button', { name: /^Texture/ }).click();
  await page.getByRole('button', { name: 'None', exact: true }).click();
}

test('the brush settings, and a stroke for each tip', async ({ page }) => {
  const errors = await setup(page);
  await reset(page);
  await panel(page).getByRole('slider', { name: 'Size', exact: true }).fill('24');
  await panel(page).screenshot({ path: `${SHOTS}/settings.png` });
  const shares: Record<string, number> = {};
  for (const name of ['Hard', 'Firm', 'Soft', 'Airbrush']) {
    await panel(page).getByRole('radio', { name, exact: true }).click();
    await stroke(page, 0.3);
    shares[name] = (await coverage(page)).share;
    await page.locator('canvas.stage-canvas').screenshot({ path: `${SHOTS}/tip-${name.toLowerCase()}.png` });
    await undo(page);
  }
  // Softer tips leave more partly covered pixels at their edges (measured on the view at 50 %, which already
  // anti-aliases a hard edge, so the steps are modest).
  expect(shares.Firm).toBeGreaterThan(shares.Hard);
  expect(shares.Soft).toBeGreaterThan(shares.Firm);
  expect(shares.Airbrush).toBeGreaterThan(shares.Soft);
  expect(errors).toEqual([]);
});

test('texture dims the paint', async ({ page }) => {
  const errors = await setup(page);
  await reset(page);
  await panel(page).getByRole('slider', { name: 'Size', exact: true }).fill('40');
  const empty = await coverage(page);
  await stroke(page, 0.3);
  const plain = await coverage(page);
  await undo(page);
  expect((await coverage(page)).light, 'undo removed the plain stroke').toBe(empty.light);
  await panel(page).getByRole('button', { name: /^Texture/ }).click();
  await page.getByRole('button', { name: 'Grain', exact: true }).click();
  await panel(page).getByRole('slider', { name: 'Texture strength', exact: true }).fill('0.9');
  await stroke(page, 0.3);
  await page.locator('canvas.stage-canvas').screenshot({ path: `${SHOTS}/texture-grain.png` });
  const grain = await coverage(page);
  // Grain leaves part of the stroke at a fraction of its paint: less light in the stroke.
  expect(grain.light - empty.light).toBeLessThan((plain.light - empty.light) * 0.85);
  expect(errors).toEqual([]);
});

test('a saved stroke replays as it was painted, for every tip setting', async ({ page }) => {
  await setup(page);
  // The engine itself, from the dev server: the live painter and the replay run on real browser canvases.
  const diffs = await page.evaluate(async () => {
    const raster = await import('/src/engine/design/raster.ts' as string);
    const brush = await import('/src/engine/design/brushStroke.ts' as string);
    const tips = [
      { size: 30, hardness: 1 },
      { size: 30, hardness: 0.05, pressureDensity: true, minDensity: 0.1 },
      { size: 30, hardness: 0.4, texture: 'paper', textureStrength: 0.8, blend: 'multiply' },
      { size: 30, hardness: 0.7, keepOpacity: true, minSize: 0.2 },
    ];
    const out: number[] = [];
    for (const t of tips) {
      const base = document.createElement('canvas'); base.width = 200; base.height = 120;
      const b = base.getContext('2d')!; b.fillStyle = '#3366cc'; b.fillRect(0, 0, 120, 120);
      const live = document.createElement('canvas'); live.width = 200; live.height = 120;
      live.getContext('2d')!.drawImage(base, 0, 0);
      const opts = { ...t, color: '#ff8800', opacity: 0.8 };
      const stroke = brush.newBrushStroke(opts, false);
      const ls = raster.beginLiveStroke(base, opts.color, opts.opacity, false, null, stroke.tip);
      const layer = { x: 0, y: 0, width: 200, height: 120, pxWidth: 200, pxHeight: 120 };
      let prev = { x: 20, y: 60 };
      for (let i = 1; i <= 24; i++) {
        const next = { x: 20 + i * 7, y: 60 + Math.sin(i / 3) * 25 };
        brush.addBrushSegment(stroke, ls, live, brush.brushSegment(layer, prev, next, opts, Math.abs(Math.sin(i / 8))));
        prev = next;
      }
      const replay = document.createElement('canvas'); replay.width = 200; replay.height = 120;
      const r = replay.getContext('2d')!; r.drawImage(base, 0, 0);
      raster.drawRasterStroke(r, stroke);
      const a = live.getContext('2d')!.getImageData(0, 0, 200, 120).data, c = r.getImageData(0, 0, 200, 120).data;
      // What shows: each colour channel weighted by its alpha (a nearly transparent pixel's colour does not show).
      let max = 0;
      for (let k = 0; k < a.length; k += 4) for (let ch = 0; ch < 4; ch++) {
        const pa = ch === 3 ? a[k + 3] : (a[k + ch] * a[k + 3]) / 255, pc = ch === 3 ? c[k + 3] : (c[k + ch] * c[k + 3]) / 255;
        max = Math.max(max, Math.abs(pa - pc));
      }
      out.push(Math.round(max * 10) / 10);
    }
    return out;
  });
  // Every new stroke, the plain hard one included, replays within one level (canvas rounding).
  expect(diffs).toHaveLength(4);
  for (const d of diffs) expect(d).toBeLessThanOrEqual(1);
});

test('every tool shows its settings in the same fields (screenshots for review)', async ({ page }) => {
  const errors = await setup(page);
  for (const [key, name] of [['b', 'brush'], ['e', 'eraser'], ['p', 'lineart'], ['g', 'fill'], ['r', 'rect']] as const) {
    await page.keyboard.press(key);
    await page.waitForTimeout(200);
    await panel(page).screenshot({ path: `${SHOTS}/panel-${name}.png` });
    // No tool keeps a bare range input: every slider is the shared field.
    expect(await panel(page).locator('input[type=range]:not(.opt-range)').count(), `${name}: a slider outside InlineSlider`).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('simulate pressure: with a mouse, a fast stroke paints thinner than a slow one', async ({ page }) => {
  const errors = await setup(page);
  await reset(page);
  await panel(page).getByRole('slider', { name: 'Size', exact: true }).fill('40');
  const sim = panel(page).getByRole('switch', { name: 'Simulate pressure' });
  if ((await sim.getAttribute('aria-checked')) !== 'true') await sim.click();
  const b = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const line = async (steps: number) => {
    const empty = await coverage(page);
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.4, { steps });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const painted = (await coverage(page)).painted - empty.painted;
    await undo(page);
    return painted;
  };
  const slow = await line(120), fast = await line(6);
  await page.locator('canvas.stage-canvas').screenshot({ path: `${SHOTS}/simulated.png` });
  expect(fast).toBeLessThan(slow * 0.8);
  expect(errors).toEqual([]);
});
