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
      { type: 'rect', x: 350, y: 300, w: 180, h: 140, fill: '#ffffff', stroke: null, strokeWidth: 0 },
      { type: 'rect', x: 700, y: 300, w: 180, h: 140, fill: '#ffffff', stroke: null, strokeWidth: 0 },
      { type: 'rect', x: 1050, y: 300, w: 180, h: 140, fill: '#ffffff', stroke: null, strokeWidth: 0 },
    ];
    const a = D.newVectorLayer('A', [{ ...specs[0], x: 350, y: 650 } as any]), b = D.newVectorLayer('B', [{ ...specs[0], x: 1050, y: 650 } as any]);
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
  return { objects: O.objectPick(d.id)?.ids ?? [], layers: L.pickedLayers(d.id, d.layers.map((l: any) => l.id)), doc: d, boxes: d.layers.map((l: any) => [l.id, R.layerBox(l)]) };
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
  await marquee(page, at(300, 240), at(1300, 850));
  let s = await selection(page);
  expect(s.objects).toHaveLength(3);
  const align = page.getByRole('toolbar', { name: 'Edit settings' }).getByRole('button', { name: 'Align' });
  await expect(align).toBeEnabled();
  await align.click();
  await expect(page.locator('.menu-target')).toContainText('On 3 objects of Pair');
  await page.getByRole('button', { name: 'Center vertically' }).click();
  s = await selection(page);
  const same = s.doc.layers.find((l: any) => l.name === 'Pair') as any;
  expect(same.shapes[0].y + same.shapes[0].h / 2).toBeCloseTo(same.shapes[1].y + same.shapes[1].h / 2, 4);

  // Layer mode uses the same gesture but selects whole visible layers, then Align acts on that exact set.
  await page.evaluate(async () => {
    const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string), O = await import('/src/engine/design/objectSelection.ts' as string), L = await import('/src/engine/design/selection.ts' as string);
    const d = A.activeDoc(S.useStore.getState().activeSessionId); O.setObjectPick(d.id, null); L.setLayerPicks(d.id, []); S.setUi({ selectMode: 'layers' });
  });
  await marquee(page, at(300, 240), at(1300, 850));
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

test('Object and Layer picks replace or clear as expected after modified clicks', async ({ page }) => {
  const { at } = await fixture(page);
  const click = async (x: number, y: number, modifier?: 'Shift') => {
    if (modifier) await page.keyboard.down(modifier);
    const p = at(x, y); await page.mouse.click(p.x, p.y);
    if (modifier) await page.keyboard.up(modifier);
  };
  const blank = at(100, 1000);
  const emptyClick = async () => { await page.mouse.click(blank.x, blank.y); };

  // Object mode: Shift toggles picked objects, clicking an unpicked one replaces, and empty clears both stores.
  await click(400, 350); await click(750, 350, 'Shift');
  let s = await selection(page);
  expect(s.objects).toHaveLength(2); expect(s.layers).toEqual([]);
  await emptyClick(); s = await selection(page);
  expect(s.objects).toEqual([]); expect(s.layers).toEqual([]);
  await click(1100, 350); s = await selection(page);
  expect(s.objects).toHaveLength(1); expect(s.objects[0]).toBe(s.doc.layers.find((l: any) => l.name === 'Pair').shapes[2].id);
  await click(400, 350); await click(750, 350, 'Shift'); s = await selection(page);
  expect(s.objects).toHaveLength(2);
  await click(400, 350); s = await selection(page);
  expect(s.objects).toHaveLength(2); // Clicking a picked member keeps the group, as in Inkscape.
  await click(1100, 350, 'Shift'); s = await selection(page);
  expect(s.objects).toHaveLength(3);
  await emptyClick(); s = await selection(page);
  expect(s.objects).toEqual([]); expect(s.layers).toEqual([]);

  // Layer mode has the same replacement/clear behavior for whole layers.
  await page.evaluate(async () => { const S = await import('/src/store/store.ts' as string); S.setUi({ selectMode: 'layers' }); });
  await click(400, 700); await click(1100, 700, 'Shift');
  s = await selection(page); expect(s.layers).toHaveLength(2); expect(s.objects).toEqual([]);
  await emptyClick(); s = await selection(page);
  expect(s.layers).toEqual([]); expect(s.objects).toEqual([]);
  await click(400, 700); await click(1100, 700, 'Shift'); s = await selection(page);
  expect(s.layers).toHaveLength(2);
  await click(400, 700); s = await selection(page);
  expect(s.layers).toHaveLength(2); // A plain click on a selected layer does not drop the group.
  await click(750, 350, 'Shift'); s = await selection(page);
  expect(s.layers).toHaveLength(3);
  await emptyClick(); s = await selection(page);
  expect(s.layers).toEqual([]); expect(s.objects).toEqual([]);
});

test('marquee is rendered under the pointer while a closeable hint overlays the canvas', async ({ page }) => {
  await fixture(page);
  const canvas = page.locator('canvas.stage-canvas');
  const hint = page.locator('.stage-hint.has-close').first();
  const box = (await hint.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The hint text must be click-through, so this real pointer gesture begins on the canvas.
  await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('canvas.stage-canvas') != null, start)).toBe(true);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 70, { steps: 4 });
  const nearStart = await canvas.evaluate((node, p) => {
    const c = node as HTMLCanvasElement, r = c.getBoundingClientRect();
    const px = (p.x - r.left) * c.width / r.width, py = (p.y - r.top) * c.height / r.height;
    const x0 = Math.max(0, Math.floor(px - 2)), y0 = Math.max(0, Math.floor(py - 2));
    const w = Math.min(c.width - x0, 6), h = Math.min(c.height - y0, 6), d = c.getContext('2d')!.getImageData(x0, y0, w, h).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 180 && d[i + 2] < 150 && d[i + 3] > 0) return true;
    return false;
  }, start);
  expect(nearStart).toBe(true);
  await page.mouse.up();
});
