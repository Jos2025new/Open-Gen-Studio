import { chromium, expect, test, type Page } from '@playwright/test';

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
  return errors;
}
const docState = (page: Page) => page.evaluate(async () => {
  const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string);
  const d = A.activeDoc(st.useStore.getState().activeSessionId);
  return { layers: d.layers.map((l: any) => ({ id: l.id, type: l.type, name: l.name, fontSize: l.fontSize })), active: d.activeLayerId, uiText: st.useStore.getState().ui.text.fontSize };
});

test('compose: the text size chosen is the one created; with a text selected the strip changes that text', async ({ page }) => {
  const errors = await setup(page);
  const b = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('t');
  await expect(strip(page)).toContainText('new text');
  await strip(page).getByRole('slider', { name: 'Size', exact: true }).fill('60');
  await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.3);
  await page.keyboard.type('Title');
  await page.keyboard.press('Escape');
  let s = await docState(page);
  const text = s.layers.find((l) => l.type === 'text')!;
  expect(text.fontSize).toBe(60);
  await expect(strip(page)).toContainText('(selected)');
  await strip(page).getByRole('slider', { name: 'Size', exact: true }).fill('80');
  s = await docState(page);
  expect(s.layers.find((l) => l.id === text.id)!.fontSize).toBe(80);
  expect(s.uiText).toBe(60);
  await page.screenshot({ path: `${SHOTS}/compose.png` });
  expect(errors).toEqual([]);
});

test('retouch: a selection is finished from the strip; changing tools keeps the panel as left', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(async () => {
    const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string); const R = await import('/src/engine/design/raster.ts' as string);
    const sid = st.useStore.getState().activeSessionId, d = A.activeDoc(sid);
    const id = A.addEmptyLayer(sid, d.id, 'raster'); const c = R.getBuffer(id).getContext('2d'); c.fillStyle = '#3366cc'; c.fillRect(0, 0, 1920, 1080);
  });
  const b = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('m');
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3); await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5, { steps: 5 }); await page.mouse.up();
  const before = (await docState(page)).layers.length;
  await strip(page).getByRole('button', { name: 'To layer', exact: true }).click();
  expect((await docState(page)).layers.length).toBe(before + 1);
  await strip(page).getByRole('button', { name: 'Deselect', exact: true }).click();
  await panel(page).getByRole('tab', { name: /^Layers only/ }).click();
  await page.keyboard.press('b');
  await page.keyboard.press('e');
  await expect(panel(page).getByRole('tab', { name: /^Layers only/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('b');
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6); await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.65, { steps: 8 }); await page.mouse.up();
  await page.screenshot({ path: `${SHOTS}/retouch.png` });
  expect(errors).toEqual([]);
});

test('FX: selecting the FX layer shows its settings; Settings… opens the tool; layer actions fit one row', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(async () => {
    const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string);
    const D = await import('/src/engine/design/doc.ts' as string); const F = await import('/src/engine/fx/commands.ts' as string);
    const sid = st.useStore.getState().activeSessionId, d = A.activeDoc(sid);
    const img = A.addEmptyLayer(sid, d.id, 'raster'); A.patchLayer(sid, d.id, img, { name: 'Photo' });
    A.mutateDoc(sid, d.id, (x: any) => D.insertLayer(x, { ...F.newFxLayer('filter', { scope: 'layer', ops: [F.newFxOp('blur', { radius: 3 })] }), name: 'Soft' }, 'above'));
    A.addEmptyLayer(sid, d.id, 'text');
  });
  await page.keyboard.press('b');
  await panel(page).getByRole('tab', { name: 'All the settings of the active tool' }).click();
  await panel(page).getByRole('button', { name: 'Select Soft' }).click();
  await expect(panel(page).getByRole('tab', { name: 'Properties of the selected layer' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).getByText('Applies to')).toBeVisible();
  await expect(panel(page).getByText('→ Photo')).toBeVisible();
  await page.keyboard.press('e');
  await expect(panel(page).getByRole('tab', { name: 'Properties of the selected layer' })).toHaveAttribute('aria-selected', 'true');
  await strip(page).getByRole('button', { name: /Settings…/ }).click();
  await expect(panel(page).getByRole('tab', { name: 'All the settings of the active tool' })).toHaveAttribute('aria-selected', 'true');
  const rows = await panel(page).locator('.layer-actions').evaluate((el) => Math.round(el.getBoundingClientRect().height));
  expect(rows).toBeLessThan(48);
  await panel(page).getByRole('button', { name: 'More layer actions' }).click();
  for (const name of ['Duplicate layer', 'Restore panel layout']) await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SHOTS}/fx.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/small-window.png` });
  expect(errors).toEqual([]);
});
