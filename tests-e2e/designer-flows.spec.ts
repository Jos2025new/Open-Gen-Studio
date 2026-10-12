import { chromium, expect, test, type Page } from '@playwright/test';
import { resetDesignerUi } from './cleanUi';

/*
 * Three designer workflows (docs/plan-designer-ux.md, step 6, proposed by Astra): compose image and text, retouch with
 * a selection and the brush, adjust FX switching between layers. They check that the layout lets the work be done
 * without hunting for controls, without misleading labels, and without losing any function. Sandbox only:
 * `npm run dev:sandbox`, then `npm run flows:check`. Screens go to tests-e2e/screens/flows/.
 */
const ORIGIN = 'http://localhost:5183';
const SHOTS = 'tests-e2e/screens/flows';
test.use({ viewport: { width: 1500, height: 940 }, launchOptions: { executablePath: chromium.executablePath() } });
test.describe.configure({ timeout: 90_000 });

const panel = (page: Page) => page.getByRole('complementary', { name: 'Layers', exact: true });
const strip = (page: Page) => page.locator('.context-strip');

async function setup(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { if (location.port === '5183') Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await page.goto(ORIGIN);
  if (new URL(page.url()).origin !== ORIGIN) throw new Error('sandbox only');
  await page.waitForFunction(() => (window as any).__OGS_TEST__?.().hydrated);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  if (!(await page.getByRole('button', { name: 'New document', exact: true }).isVisible())) { await page.getByRole('button', { name: 'Switch workspace', exact: true }).click(); await page.getByText('Designer', { exact: true }).click(); }
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('button', { name: /^Landscape 16:9/ }).first().click();
  // The sandbox keeps `ui` between runs: every test starts from the app's own defaults.
  await resetDesignerUi(page);
  return errors;
}
const docState = (page: Page) => page.evaluate(async () => {
  const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string);
  const d = A.activeDoc(st.useStore.getState().activeSessionId);
  return { layers: d.layers.map((l: any) => ({ id: l.id, type: l.type, name: l.name, fontSize: l.fontSize, ops: l.ops })), active: d.activeLayerId, uiText: st.useStore.getState().ui.text.fontSize };
});
/** Where on the stage a colour shows (its box in canvas pixels) and how much of it: what the person sees. */
const colourBox = (page: Page, test: string) => page.evaluate((src) => {
  const match = new Function('r', 'g', 'b', 'a', `return ${src};`) as (r: number, g: number, b: number, a: number) => boolean;
  const c = document.querySelector('canvas.stage-canvas') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) { const i = (y * c.width + x) * 4; if (match(d[i], d[i + 1], d[i + 2], d[i + 3])) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
  return { n, x0, y0, x1, y1 };
}, test);
const pixelAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => Array.from((document.querySelector('canvas.stage-canvas') as HTMLCanvasElement).getContext('2d')!.getImageData(px, py, 1, 1).data), [x, y]);
/** A raster layer named `name` filled with `color` in a rectangle of the page (fractions). */
const addImage = (page: Page, name: string, color: string, r: [number, number, number, number]) => page.evaluate(async ([n, col, rx, ry, rw, rh]) => {
  const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string); const R = await import('/src/engine/design/raster.ts' as string);
  const sid = st.useStore.getState().activeSessionId, d = A.activeDoc(sid);
  const id = A.addEmptyLayer(sid, d.id, 'raster'); A.patchLayer(sid, d.id, id, { name: n });
  const c = R.getBuffer(id).getContext('2d'); c.fillStyle = col; c.fillRect(+rx * d.width, +ry * d.height, +rw * d.width, +rh * d.height); R.commitEdit(id);
  return id;
}, [name, color, ...r] as const);

test('compose: an image and a text over it; the chosen size is the one created; with the text selected the strip and Settings… change that text', async ({ page }) => {
  const errors = await setup(page);
  await addImage(page, 'Photo', '#cc2222', [0.1, 0.1, 0.6, 0.6]);
  const b = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('t');
  await expect(strip(page)).toContainText('new text');
  await strip(page).getByRole('slider', { name: 'Size', exact: true }).fill('60');
  await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.35);
  // Typed in the very instant the box appears: the first keys must not be lost (TextEditor keeps them until focused).
  await page.keyboard.type('Title');
  await page.keyboard.press('Escape');
  let s = await docState(page);
  const text = s.layers.find((l) => l.type === 'text')!;
  expect(text.fontSize).toBe(60);
  expect(await page.evaluate(async (id) => { const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string); return A.activeDoc(st.useStore.getState().activeSessionId).layers.find((l: any) => l.id === id).text; }, text.id)).toBe('Title');
  await expect(strip(page)).toContainText('(selected)');
  await strip(page).getByRole('slider', { name: 'Size', exact: true }).fill('80');
  s = await docState(page);
  expect(s.layers.find((l) => l.id === text.id)!.fontSize).toBe(80);
  expect(s.uiText).toBe(60);
  // The composition shows: the image where there is no text, and the text over it.
  await page.waitForTimeout(200);
  const red = await colourBox(page, 'r > 150 && g < 80 && b < 80 && a > 200');
  expect(red.n, 'the image shows').toBeGreaterThan(1000);
  const white = await colourBox(page, 'r > 220 && g > 220 && b > 220 && a > 200');
  expect(white.n, 'the text shows').toBeGreaterThan(100);
  expect(white.x0 >= red.x0 && white.x1 <= red.x1 + 400 && white.y0 >= red.y0, 'the text lies over the image').toBe(true);
  // Settings… with the text selected opens its properties (the full text fields), not the next-text settings.
  await strip(page).getByRole('button', { name: /Settings…/ }).click();
  await expect(panel(page).getByRole('tab', { name: 'Properties of the selected layer' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).getByRole('textbox', { name: /^Text/ }).or(panel(page).locator('textarea')).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/compose.png` });
  expect(errors).toEqual([]);
});

test('retouch: a selection finished from the strip; the stroke lands on the layer the strip names; changing tools or paint layers keeps Tool', async ({ page }) => {
  const errors = await setup(page);
  const base = await addImage(page, 'Base', '#3366cc', [0, 0, 1, 1]);
  const b = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('m');
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3); await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 5 }); await page.mouse.up();
  const before = (await docState(page)).layers.length;
  await strip(page).getByRole('button', { name: 'To layer', exact: true }).click();
  expect((await docState(page)).layers.length).toBe(before + 1);
  await strip(page).getByRole('button', { name: 'Deselect', exact: true }).click();
  await page.keyboard.press('b');
  await panel(page).getByRole('tab', { name: 'All the settings of the active tool' }).click();
  // Choosing another paint layer keeps the brush settings in view.
  await panel(page).getByRole('button', { name: 'Select Base', exact: true }).click();
  await expect(panel(page).getByRole('tab', { name: 'All the settings of the active tool' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('e'); await page.keyboard.press('b');
  await expect(panel(page).getByRole('tab', { name: 'All the settings of the active tool' })).toHaveAttribute('aria-selected', 'true');
  const target = (await strip(page).locator('.context-target span').textContent())!.trim();
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.7); await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.7, { steps: 10 }); await page.mouse.up();
  // The stroke's pixels are in the layer the strip named (white over the blue base).
  const painted = await page.evaluate(async ([name]) => {
    const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string); const R = await import('/src/engine/design/raster.ts' as string);
    const d = A.activeDoc(st.useStore.getState().activeSessionId);
    const l = name === 'new layer' ? d.layers[d.layers.length - 1] : d.layers.find((x: any) => x.name === name);
    const buf = R.getBuffer(l.id), px = buf.getContext('2d').getImageData(0, 0, buf.width, buf.height).data;
    let white = 0;
    for (let i = 0; i < px.length; i += 16) if (px[i] > 200 && px[i + 1] > 200 && px[i + 2] > 200 && px[i + 3] > 200) white++;
    return { layer: l.name, white };
  }, [target]);
  // The layer was solid blue (or empty): white pixels there are the stroke.
  expect(painted.white, `stroke pixels in "${painted.layer}"`).toBeGreaterThan(20);
  expect(base).toBeTruthy();
  await page.screenshot({ path: `${SHOTS}/retouch.png` });
  expect(errors).toEqual([]);
});

test('FX: selecting the FX layer shows its settings; changing its radius changes what shows; Settings… opens the tool; layer actions fit one row', async ({ page }) => {
  const errors = await setup(page);
  await addImage(page, 'Photo', '#ffffff', [0.3, 0.3, 0.4, 0.4]);
  await page.evaluate(async () => {
    const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string);
    const D = await import('/src/engine/design/doc.ts' as string); const F = await import('/src/engine/fx/commands.ts' as string);
    const sid = st.useStore.getState().activeSessionId, d = A.activeDoc(sid);
    A.mutateDoc(sid, d.id, (x: any) => D.insertLayer(x, { ...F.newFxLayer('filter', { scope: 'layer', ops: [F.newFxOp('blur', { radius: 1 })] }), name: 'Soft' }, 'above'));
  });
  await page.keyboard.press('b');
  await panel(page).getByRole('tab', { name: 'All the settings of the active tool' }).click();
  await panel(page).getByRole('button', { name: 'Select Soft' }).click();
  await expect(panel(page).getByRole('tab', { name: 'Properties of the selected layer' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).getByText('Applies to')).toBeVisible();
  await expect(panel(page).getByText('→ Photo')).toBeVisible();
  // Just outside the white square's edge: a stronger blur spreads more light there.
  await page.waitForTimeout(200);
  const sq = await colourBox(page, 'r > 200 && g > 200 && b > 200 && a > 200');
  expect(sq.n, 'the white image shows').toBeGreaterThan(1000);
  const edge = () => pixelAt(page, sq.x0 - 8, Math.round((sq.y0 + sq.y1) / 2));
  const before = (await edge())[0];
  await panel(page).getByRole('slider', { name: 'Radius' }).first().fill('30');
  await page.waitForTimeout(300);
  const ops = (await docState(page)).layers.find((l) => l.name === 'Soft')!.ops as Array<{ params: { radius: number } }>;
  expect(ops[0].params.radius).toBe(30);
  expect((await edge())[0]).toBeGreaterThan(before + 10);
  await page.keyboard.press('e');
  await expect(panel(page).getByRole('tab', { name: 'Properties of the selected layer' })).toHaveAttribute('aria-selected', 'true');
  await strip(page).getByRole('button', { name: /Settings…/ }).click();
  await expect(panel(page).getByRole('tab', { name: 'All the settings of the active tool' })).toHaveAttribute('aria-selected', 'true');
  const rows = await panel(page).locator('.layer-actions').evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(rows).toBeLessThan(48);
  await expect(panel(page).getByRole('button', { name: 'Duplicate layer' })).toBeVisible();
  await panel(page).getByRole('button', { name: 'More layer actions' }).click();
  for (const name of ['Merge down', 'Restore panel layout']) await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SHOTS}/fx.png` });
  expect(errors).toEqual([]);
});

test('small window (1280×720): the tool box fits on screen and the strip covers nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = await setup(page);
  await page.keyboard.press('b');
  await page.waitForTimeout(300);
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const rail = await box('.tool-rail'), stripBox = await box('.context-strip');
  const conv = (await page.getByRole('button', { name: /Conversation/ }).first().boundingBox())!;
  expect(rail.y + rail.height).toBeLessThanOrEqual(720);
  const overlap = (a: typeof rail, c: typeof rail) => a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
  expect(overlap(stripBox, conv), 'strip covers Conversation').toBe(false);
  expect(overlap(stripBox, rail), 'strip covers the tool box').toBe(false);
  await page.screenshot({ path: `${SHOTS}/small-window.png` });
  expect(errors).toEqual([]);
});
