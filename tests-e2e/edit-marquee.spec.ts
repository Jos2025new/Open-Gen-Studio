import { chromium, expect, test, type Page } from '@playwright/test';
import { setup } from './shapeHelpers';

test.use({ viewport: { width: 1500, height: 940 }, launchOptions: { executablePath: chromium.executablePath() } });
test.describe.configure({ timeout: 90_000 });

async function fixture(page: Page) {
  const errors = await setup(page);
  await page.evaluate(async () => {
    const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string), D = await import('/src/engine/design/doc.ts' as string), P = await import('/src/engine/design/objectSelection.ts' as string), L = await import('/src/engine/design/selection.ts' as string);
    const sid = S.useStore.getState().activeSessionId, d = A.activeDoc(sid);
    const specs = [
      { type: 'rect', x: 360, y: 300, w: 240, h: 160, fill: '#ffffff', stroke: null, strokeWidth: 0 },
      { type: 'rect', x: 820, y: 560, w: 320, h: 220, fill: '#ffffff', stroke: null, strokeWidth: 0 },
    ];
    const a = D.newVectorLayer('A', [specs[0] as any]), b = D.newVectorLayer('B', [specs[1] as any]);
    const same = D.newVectorLayer('Pair', specs as any);
    S.setDoc(sid, d.id, (dd: any) => ({ ...dd, layers: [same, a, b], activeLayerId: same.id }));
    P.setObjectPick(d.id, null); L.setLayerPicks(d.id, []);
    S.setUi({ tool: 'move', selectMode: 'objects', rulers: false, snap: { on: false, page: false, layers: false } });
  });
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const z = Math.min((c.width - 48) / 1920, (c.height - 144) / 1080, 4);
  const at = (x: number, y: number) => ({ x: c.x + (c.width - 1920 * z) / 2 + x * z, y: c.y + Math.max(12, (c.height - 120 - 1080 * z) / 2) + y * z });
  return { errors, at };
}

const selection = (page: Page) => page.evaluate(async () => {
  const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string), O = await import('/src/engine/design/objectSelection.ts' as string), L = await import('/src/engine/design/selection.ts' as string), R = await import('/src/engine/design/render.ts' as string);
  const d = A.activeDoc(S.useStore.getState().activeSessionId);
  return { objects: O.objectPick(d.id)?.ids ?? [], layers: L.layerSelection(d.id, d.activeLayerId, d.layers.map((l: any) => l.id)), doc: d, boxes: d.layers.map((l: any) => [l.id, R.layerBox(l)]) };
});

async function marquee(page: Page, start: { x: number; y: number }, end: { x: number; y: number }, modifier?: 'Shift' | 'Alt') {
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

test('Edit marquee targets the visible mode and feeds the matching Align operation', async ({ page }) => {
  const { errors, at } = await fixture(page);
  // Object mode selects the active layer's shapes. Align becomes available for those objects.
  await marquee(page, at(300, 240), at(1200, 850));
  let s = await selection(page);
  expect(s.objects).toHaveLength(2);
  const align = page.getByRole('toolbar', { name: 'Edit settings' }).getByRole('button', { name: 'Align' });
  await expect(align).toBeEnabled();
  await align.click();
  await expect(page.locator('.menu-target')).toContainText('On 2 objects of Pair');
  await page.getByRole('button', { name: 'Center vertically' }).click();
  s = await selection(page);
  const same = s.doc.layers.find((l: any) => l.name === 'Pair') as any;
  expect(same.shapes[0].y + same.shapes[0].h / 2).toBeCloseTo(same.shapes[1].y + same.shapes[1].h / 2, 4);

  // Layer mode uses the same gesture but selects whole visible layers, then Align acts on that exact set.
  await page.evaluate(async () => {
    const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string), O = await import('/src/engine/design/objectSelection.ts' as string), L = await import('/src/engine/design/selection.ts' as string);
    const d = A.activeDoc(S.useStore.getState().activeSessionId); O.setObjectPick(d.id, null); L.setLayerPicks(d.id, []); S.setUi({ selectMode: 'layers' });
  });
  await marquee(page, at(300, 240), at(1200, 850));
  s = await selection(page);
  expect(s.layers).toHaveLength(3);
  await page.getByRole('toolbar', { name: 'Edit settings' }).getByRole('button', { name: 'Align' }).click();
  await expect(page.locator('.menu-target')).toContainText('On 3 layers');
  await page.getByRole('button', { name: 'Center vertically' }).click();
  s = await selection(page);
  const layerBoxes = new Map(s.boxes);
  const a = layerBoxes.get(s.doc.layers.find((l: any) => l.name === 'A').id) as any;
  const b = layerBoxes.get(s.doc.layers.find((l: any) => l.name === 'B').id) as any;
  expect(a.y + a.h / 2).toBeCloseTo(b.y + b.h / 2, 4);
  expect(errors).toEqual([]);
});
