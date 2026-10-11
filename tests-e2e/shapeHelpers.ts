import type { Page } from '@playwright/test';

/* Shared by the shape e2e specs (shape-knots, path-nodes): sandbox only. */
export const ORIGIN = 'http://localhost:5183';
export const SHOTS = 'tests-e2e/screens/shapes';
export const strip = (page: Page) => page.locator('.context-strip');

export async function setup(page: Page) {
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
export const shape = (page: Page) => page.evaluate(async () => {
  const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string);
  const d = A.activeDoc(st.useStore.getState().activeSessionId);
  return d.layers.flatMap((l: any) => (l.type === 'vector' ? l.shapes : []))[0];
});
export const knot = (page: Page, k: string) => page.locator(`circle[data-knot="${k}"]`);
export async function dragKnot(page: Page, k: string, dx: number, dy: number, mod?: 'Control') {
  const b = (await knot(page, k).boundingBox())!, x = b.x + b.width / 2, y = b.y + b.height / 2;
  if (mod) await page.keyboard.down(mod);
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + (dx * i) / 5, y + (dy * i) / 5);
  await page.mouse.up();
  if (mod) await page.keyboard.up(mod);
}

