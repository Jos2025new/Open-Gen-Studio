import { chromium, expect, test, type Page } from '@playwright/test';
import { setup, shape, strip } from './shapeHelpers';

test.use({ viewport: { width: 1500, height: 940 }, launchOptions: { executablePath: chromium.executablePath() } });
test.describe.configure({ timeout: 90_000 });
const nodes = (p: Page) => p.locator('rect.path-node');
const picked = (p: Page) => p.locator('rect.path-node.is-picked');
async function points(p: Page) {
  return nodes(p).evaluateAll((ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
}
async function fixture(p: Page) {
  const errors = await setup(p);
  const c = (await p.locator('canvas.stage-canvas').boundingBox())!;
  await p.keyboard.press('r');
  await p.mouse.move(c.x + c.width * .3, c.y + c.height * .3); await p.mouse.down();
  await p.mouse.move(c.x + c.width * .5, c.y + c.height * .6, { steps: 6 }); await p.mouse.up();
  await p.keyboard.press('v'); await p.mouse.dblclick(c.x + c.width * .4, c.y + c.height * .45);
  await strip(p).getByRole('button', { name: 'Convert to path' }).click();
  await expect(nodes(p)).toHaveCount(4);
  return errors;
}

test('Shift selection, frozen group drag, undo/redo, Ctrl+A, arrow steps and two-stage Esc', async ({ page }) => {
  const errors = await fixture(page);
  await page.evaluate(async () => {
    const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string), F = await import('/src/engine/design/affine.ts' as string), M = await import('/src/engine/design/matrix.ts' as string);
    const sid = S.useStore.getState().activeSessionId, d = A.activeDoc(sid), l = d.layers.find((x: any) => x.type === 'vector');
    A.patchLayer(sid, d.id, l.id, { shapes: l.shapes.map((s: any) => F.transformShape(s, M.rotateAbout(.5, s.x + s.w / 2, s.y + s.h / 2))) });
  });
  await nodes(page).nth(0).click();
  await nodes(page).nth(1).click({ modifiers: ['Shift'] });
  await expect(picked(page)).toHaveCount(2);
  const before = await points(page), s0 = await shape(page);
  await page.mouse.move(...before[0] as [number, number]); await page.mouse.down();
  await page.mouse.move(before[0][0] + 32, before[0][1] + 18, { steps: 8 }); await page.mouse.up();
  const after = await points(page);
  for (const i of [0, 1]) { expect(after[i][0] - before[i][0]).toBeCloseTo(32, 0); expect(after[i][1] - before[i][1]).toBeCloseTo(18, 0); }
  for (const i of [2, 3]) { expect(after[i][0]).toBeCloseTo(before[i][0], 1); expect(after[i][1]).toBeCloseTo(before[i][1], 1); }
  await expect(picked(page)).toHaveCount(2);
  const s1 = await shape(page);
  await page.keyboard.press('Control+z'); expect((await shape(page)).d).toBe(s0.d); await expect(picked(page)).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z'); expect((await shape(page)).d).toBe(s1.d); await expect(picked(page)).toHaveCount(2);
  await page.keyboard.press('Control+a'); await expect(picked(page)).toHaveCount(4);
  const a = await shape(page);
  await page.keyboard.press('ArrowRight'); const b = await shape(page); expect(b.x - a.x).toBeCloseTo(2, 3);
  await page.keyboard.press('Shift+ArrowDown'); const c = await shape(page); expect(c.y - b.y).toBeCloseTo(20, 3);
  const p0 = await points(page); await page.keyboard.press('Alt+ArrowLeft'); const p1 = await points(page); expect(p1[0][0] - p0[0][0]).toBeCloseTo(-1, 1);
  await page.keyboard.press('Escape'); await expect(picked(page)).toHaveCount(0); await expect(nodes(page)).toHaveCount(4);
  const kept = await shape(page); await page.keyboard.press('Delete'); expect((await shape(page)).d).toBe(kept.d); await expect(nodes(page)).toHaveCount(4);
  await page.keyboard.press('Escape'); await expect(nodes(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('rubberband replaces, Shift adds, Ctrl chooses outside, Ctrl+Shift subtracts; inputs keep their keys', async ({ page }) => {
  const errors = await fixture(page), ns = await points(page);
  const box = async (mods: string[] = []) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(ns[0][0] - 25, ns[0][1] - 25); await page.mouse.down();
    await page.mouse.move(ns[1][0] + 25, ns[1][1] + 25, { steps: 6 }); await page.mouse.up();
    for (const m of [...mods].reverse()) await page.keyboard.up(m);
  };
  await box(); await expect(picked(page)).toHaveCount(2);
  await nodes(page).nth(2).click({ modifiers: ['Shift'] }); await box(['Shift']); await expect(picked(page)).toHaveCount(3);
  await box(['Control']); await expect(picked(page)).toHaveCount(2);
  await page.keyboard.press('Control+a'); await box(['Control', 'Shift']); await expect(picked(page)).toHaveCount(2);
  const chosen = await picked(page).evaluateAll((ns) => ns.map((n) => n.getAttribute('data-node')));
  const bottom = await nodes(page).evaluateAll((ns) => ns.slice(2).map((n) => n.getAttribute('data-node'))); expect(chosen).toEqual(bottom);
  // A click on a selected member collapses the group only when no drag occurs.
  await page.keyboard.press('Control+a'); await nodes(page).nth(2).click(); await expect(picked(page)).toHaveCount(1);
  const input = strip(page).getByRole('slider', { name: 'Blur', exact: true });
  await input.focus(); const before = await shape(page); await page.keyboard.press('Control+a'); await page.keyboard.press('Escape');
  expect((await shape(page)).d).toBe(before.d); await expect(picked(page)).toHaveCount(1); await expect(nodes(page)).toHaveCount(4);
  await input.blur();
  await page.mouse.dblclick((ns[0][0] + ns[1][0]) / 2, (ns[0][1] + ns[1][1]) / 2);
  await expect(nodes(page)).toHaveCount(5); await expect(picked(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(nodes(page)).toHaveCount(4); await expect(picked(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(nodes(page)).toHaveCount(5); await expect(picked(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
