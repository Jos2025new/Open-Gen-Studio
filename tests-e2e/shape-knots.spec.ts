import { chromium, expect, test, type Page } from '@playwright/test';

/*
 * Inkscape's shape knots and look (engine/design/shapeLook.ts) as a person uses them: draw a rectangle, pick it with
 * Edit, round its corners with the knots (Ctrl: equal; Shift-click: sharp), blur it from the strip and with the blur
 * knots, undo a drag in one step, and see it on the canvas. Sandbox only: `npm run dev:sandbox`, then
 * `npx playwright test tests-e2e/shape-knots.spec.ts`. Screens go to tests-e2e/screens/shapes/.
 */
const ORIGIN = 'http://localhost:5183';
const SHOTS = 'tests-e2e/screens/shapes';
test.use({ viewport: { width: 1500, height: 940 }, launchOptions: { executablePath: chromium.executablePath() } });
test.describe.configure({ timeout: 90_000 });
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
/** The one shape in the document, as stored. */
const shape = (page: Page) => page.evaluate(async () => {
  const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string);
  const d = A.activeDoc(st.useStore.getState().activeSessionId);
  return d.layers.flatMap((l: any) => (l.type === 'vector' ? l.shapes : []))[0];
});
const knot = (page: Page, k: string) => page.locator(`circle[data-knot="${k}"]`);
async function dragKnot(page: Page, k: string, dx: number, dy: number, mod?: 'Control') {
  const b = (await knot(page, k).boundingBox())!, x = b.x + b.width / 2, y = b.y + b.height / 2;
  if (mod) await page.keyboard.down(mod);
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + (dx * i) / 5, y + (dy * i) / 5);
  await page.mouse.up();
  if (mod) await page.keyboard.up(mod);
}

test('rectangle: corner knots, sharp corners, blur from the strip and its knots, one undo per drag', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.6, c.y + c.height * 0.7, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.click(c.x + c.width * 0.45, c.y + c.height * 0.5);
  await expect(knot(page, 'rx')).toBeVisible();
  await expect(knot(page, 'ry')).toBeVisible();
  const s0 = await shape(page);

  // Rx: dragging left along the top edge rounds the corners; Ry, unset, follows it (Inkscape).
  await dragKnot(page, 'rx', -60, 0);
  const s1 = await shape(page);
  expect(s1.rx).toBeGreaterThan(5);
  expect(s1.ry).toBeUndefined();
  // Ry alone: now an ellipse corner. Then Ctrl: both radii equal.
  await dragKnot(page, 'ry', 0, 30);
  expect((await shape(page)).ry).not.toBeCloseTo(s1.rx, 1);
  await dragKnot(page, 'ry', 0, 40, 'Control');
  const s2 = await shape(page);
  expect(s2.rx).toBeCloseTo(s2.ry, 6);
  expect(s2.ry).toBeGreaterThan(5);
  await expect(strip(page).getByRole('slider', { name: 'Rx', exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/corners.png` });

  // One undo per drag: Ctrl+Z goes back to the shape before the Ctrl-drag, not to a frame in the middle of it.
  await page.keyboard.press('Control+z');
  expect((await shape(page)).ry).not.toBeCloseTo(s2.ry, 1);
  await page.keyboard.press('Control+Shift+z');
  expect((await shape(page)).ry).toBeCloseTo(s2.ry, 6);

  // Shift-click on a corner knot: sharp corners.
  await knot(page, 'rx').click({ modifiers: ['Shift'] });
  const s3 = await shape(page);
  expect([s3.rx, s3.ry]).toEqual([0, 0]);

  // Blur from the strip: Inkscape's % → σ = (b/100)² · (w + h) / 4.
  await strip(page).getByRole('slider', { name: 'Blur', exact: true }).fill('30');
  const s4 = await shape(page);
  expect(s4.blur).toBeCloseTo(0.09 * (Math.abs(s0.w) + Math.abs(s0.h)) / 4, 3);
  await expect(knot(page, 'top')).toBeVisible();
  // Dragging the right blur knot further out blurs more.
  await dragKnot(page, 'right', 40, 0);
  expect((await shape(page)).blur).toBeGreaterThan(s4.blur);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/blur.png` });
  expect(errors).toEqual([]);
});
