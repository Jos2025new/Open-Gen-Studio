import { chromium, expect, test, type Page } from '@playwright/test';
import { setup } from './shapeHelpers';

/*
 * Picking several shapes as in Inkscape and Photoshop (each shape is its own layer): Shift-click (or Ctrl-click)
 * adds, dragging a picked one moves them all, a click without dragging keeps just it; clicks add no empty undo
 * steps. Sandbox only: `npm run dev:sandbox`, then `npx playwright test tests-e2e/multi-select.spec.ts`.
 */
test.use({ viewport: { width: 1500, height: 940 }, launchOptions: { executablePath: chromium.executablePath() } });
test.describe.configure({ timeout: 90_000 });

const state = (page: Page) => page.evaluate(async () => {
  const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string);
  const H = await import('/src/engine/design/history.ts' as string); const S = await import('/src/engine/design/selection.ts' as string);
  const d = A.activeDoc(st.useStore.getState().activeSessionId);
  const vec = d.layers.filter((l: any) => l.type === 'vector');
  return { boxes: vec.map((l: any) => [l.shapes[0].x, l.shapes[0].y]), picked: S.layerSelection(d.id, d.activeLayerId, d.layers.map((l: any) => l.id)).length, undo: H.historyDepth(d.id).undo };
});

test('Shift-click adds a second shape; dragging one moves both; a click keeps just it; clicks add no undo steps', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: c.x + c.width * fx, y: c.y + c.height * fy });
  for (const [x0, y0] of [[0.2, 0.3], [0.55, 0.3]]) {
    await page.keyboard.press('r');
    const a = at(x0, y0), b = at(x0 + 0.15, y0 + 0.25);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  }
  await page.keyboard.press('v');
  const p1 = at(0.27, 0.42), p2 = at(0.62, 0.42);
  await page.mouse.click(p1.x, p1.y);
  const u0 = (await state(page)).undo;
  // Plain Shift-click on the other shape: both picked (no Ctrl+Shift needed); clicks record no undo step.
  await page.keyboard.down('Shift'); await page.mouse.click(p2.x, p2.y); await page.keyboard.up('Shift');
  let s = await state(page);
  expect(s.picked).toBe(2);
  expect(s.undo).toBe(u0);
  // Drag one of them without modifiers: both move, one undo step.
  const before = s.boxes;
  await page.mouse.move(p1.x, p1.y); await page.mouse.down(); await page.mouse.move(p1.x + 80, p1.y + 40, { steps: 8 }); await page.mouse.up();
  s = await state(page);
  expect(s.picked).toBe(2);
  for (let i = 0; i < 2; i++) expect(s.boxes[i][0] - before[i][0]).toBeGreaterThan(40);
  expect(s.undo).toBe(u0 + 1);
  // One undo puts both back at once.
  await page.keyboard.press('Control+z');
  s = await state(page);
  expect(s.boxes).toEqual(before);
  // A click without dragging on one of the picked keeps just it.
  await page.mouse.click(p2.x, p2.y);
  expect((await state(page)).picked).toBe(1);
  expect(errors).toEqual([]);
});

// Isolated sandbox fixtures: real pointer/key events exercise Stage; reads measure its stored geometry.
async function fixture(page: Page, kind: 'shapes' | 'lineart' | 'raster' | 'image', mode = 'objects') {
  await setup(page);
  await page.evaluate(async ({ kind, mode }) => {
    const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string);
    const D = await import('/src/engine/design/doc.ts' as string), R = await import('/src/engine/design/raster.ts' as string);
    const L = await import('/src/engine/design/strokes.ts' as string), P = await import('/src/engine/design/objectSelection.ts' as string);
    const sid = S.useStore.getState().activeSessionId, d = A.activeDoc(sid);
    let layers: any[];
    if (kind === 'shapes') layers = [400, 1000].map((x) => D.newVectorLayer('Rectangle', [{ type: 'rect', x, y: 300, w: 300, h: 200, radius: 0, fill: '#ffffff', stroke: null, strokeWidth: 0 }]));
    else if (kind === 'lineart') {
      const l = D.newVectorLayer('Lineart');
      l.strokes = [300, 550].map((y) => L.newStroke([[400, y, .5], [700, y, .5]], { ...L.DEFAULT_STROKE_STYLE, size: 30 }, true)); layers = [l];
    } else {
      const l = D.newRasterLayer(kind, { x: 0, y: 0, width: d.width, height: d.height }, { width: d.width, height: d.height }, kind === 'image' ? 'test-image' : undefined);
      const c = document.createElement('canvas'); c.width = d.width; c.height = d.height;
      const ctx = c.getContext('2d')!; ctx.fillStyle = '#ffffff';
      if (kind === 'raster') { ctx.lineWidth = 30; ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(400, 400); ctx.lineTo(700, 400); ctx.stroke(); l.paintStrokes = [{ id: 'stroke', segments: [[400, 400, 700, 400, 30]], x: 0, y: 0, color: '#ffffff', opacity: 1, erase: false }]; }
      else ctx.fillRect(400, 300, 300, 200);
      if (kind === 'raster') { const base = document.createElement('canvas'); base.width = d.width; base.height = d.height; l.paintBaseId = `${l.id}-base`; R.setBuffer(l.paintBaseId, base, false); }
      R.setBuffer(l.id, c, false); layers = [l];
    }
    S.setDoc(sid, d.id, (dd: any) => ({ ...dd, layers, activeLayerId: layers[0].id }));
    P.setObjectPick(d.id, null); S.setUi({ tool: 'move', selectMode: mode, rulers: false, snap: { on: false, page: false, layers: false } });
  }, { kind, mode });
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const z = Math.min((c.width - 48) / 1920, (c.height - 144) / 1080, 4);
  return (x: number, y: number) => ({ x: c.x + (c.width - 1920 * z) / 2 + x * z, y: c.y + Math.max(12, (c.height - 120 - 1080 * z) / 2) + y * z });
}
const details = (page: Page) => page.evaluate(async () => {
  const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string);
  const H = await import('/src/engine/design/history.ts' as string), P = await import('/src/engine/design/objectSelection.ts' as string), L = await import('/src/engine/design/selection.ts' as string);
  const d = A.activeDoc(S.useStore.getState().activeSessionId);
  return { layers: d.layers, objects: P.objectPick(d.id)?.ids ?? [], picked: L.layerSelection(d.id, d.activeLayerId, d.layers.map((l: any) => l.id)), undo: H.historyDepth(d.id).undo };
});
async function move(page: Page, p: { x: number; y: number }, dx = 70, dy = 35) {
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 }); await page.mouse.up();
}
const shots = '/tmp/ogs-multiselect-review';

test('Ctrl-click toggles across layers; Ctrl-click lineart within one layer keeps both objects', async ({ page }) => {
  let at = await fixture(page, 'shapes');
  const a = at(550, 400), b = at(1150, 400);
  await page.mouse.click(a.x, a.y); await page.keyboard.down('Control'); await page.mouse.click(b.x, b.y); await page.keyboard.up('Control');
  expect((await details(page)).picked).toHaveLength(2);
  expect((await details(page)).objects).toHaveLength(0);
  await page.screenshot({ path: `${shots}/ctrl-layers.png` });
  await page.keyboard.down('Control'); await page.mouse.click(b.x, b.y); await page.keyboard.up('Control');
  expect((await details(page)).picked).toHaveLength(1);
  at = await fixture(page, 'lineart');
  const p = at(480, 300), q = at(480, 550);
  await page.mouse.click(p.x, p.y); await page.keyboard.down('Control'); await page.mouse.click(q.x, q.y); await page.keyboard.up('Control');
  expect((await details(page)).objects).toHaveLength(2);
  await page.screenshot({ path: `${shots}/ctrl-lineart.png` });
  const before = await details(page); await move(page, p);
  const after = await details(page);
  for (let i = 0; i < 2; i++) expect(after.layers[0].strokes[i].points[0][0]).toBeGreaterThan(before.layers[0].strokes[i].points[0][0]);
  await page.keyboard.press('Control+z'); expect((await details(page)).layers).toEqual(before.layers);
  await page.mouse.dblclick(p.x, p.y);
  await expect(page.locator('.stage-hint').filter({ hasText: 'Drag points to edit' })).toBeVisible();
  await page.screenshot({ path: `${shots}/lineart-edit.png` });
});

test('rounding controls edit picked rectangles in Objects and rectangles across picked layers in Layers', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string);
    const D = await import('/src/engine/design/doc.ts' as string), P = await import('/src/engine/design/objectSelection.ts' as string);
    const L = await import('/src/engine/design/selection.ts' as string);
    const sid = S.useStore.getState().activeSessionId, d = A.activeDoc(sid);
    const a = D.newVectorLayer('A', [
      { type: 'rect', x: 400, y: 300, w: 240, h: 160, radius: 0, fill: '#fff', stroke: null, strokeWidth: 0 },
      { type: 'rect', x: 760, y: 300, w: 240, h: 160, radius: 0, fill: '#fff', stroke: null, strokeWidth: 0 },
    ]);
    const b = D.newVectorLayer('B', [{ type: 'rect', x: 1100, y: 300, w: 240, h: 160, radius: 0, fill: '#fff', stroke: null, strokeWidth: 0 }]);
    S.setDoc(sid, d.id, (dd: any) => ({ ...dd, layers: [a, b], activeLayerId: a.id }));
    P.setObjectPick(d.id, null); L.setLayerPicks(d.id, []);
    S.setUi({ tool: 'move', selectMode: 'objects', rulers: false, snap: { on: false, page: false, layers: false } });
  });
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const z = Math.min((c.width - 48) / 1920, (c.height - 144) / 1080, 4);
  const at = (x: number, y: number) => ({ x: c.x + (c.width - 1920 * z) / 2 + x * z, y: c.y + Math.max(12, (c.height - 120 - 1080 * z) / 2) + y * z });
  const a = at(330, 240), b = at(1050, 520);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  const rounding = page.locator('[data-rounding-selection]');
  expect(await rounding.count()).toBe(1);
  const rx = rounding.getByRole('spinbutton', { name: 'Rx value' });
  await rx.fill('30');
  const shapes = () => page.evaluate(async () => {
    const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string);
    const d = A.activeDoc(S.useStore.getState().activeSessionId);
    return d.layers.map((l: any) => l.shapes.map((s: any) => [s.rx, s.ry]));
  });
  expect((await shapes())[0].map((r: any[]) => r[0])).toEqual([30, 30]);
  await page.keyboard.press('Control+z'); expect((await shapes())[0].map((r: any[]) => r[0])).toEqual([0, 0]);
  await page.keyboard.press('Control+Shift+z'); expect((await shapes())[0].map((r: any[]) => r[0])).toEqual([30, 30]);

  await page.evaluate(async () => {
    const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string), L = await import('/src/engine/design/selection.ts' as string);
    const d = A.activeDoc(S.useStore.getState().activeSessionId);
    S.setUi({ selectMode: 'layers' }); L.setLayerPicks(d.id, d.layers.map((l: any) => l.id));
  });
  const layerRounding = page.locator('[data-rounding-selection]');
  expect(await layerRounding.count()).toBe(1);
  const ry = layerRounding.getByRole('spinbutton', { name: 'Ry value' });
  await expect(ry).toBeVisible(); await ry.fill('18');
  expect((await shapes()).flat().map((r: any[]) => r[1])).toEqual([18, 18, 18]);
  await page.keyboard.press('Control+z'); expect((await shapes()).flat().map((r: any[]) => r[1])).toEqual([0, 0, 0]);
  await page.keyboard.press('Control+Shift+z'); expect((await shapes()).flat().map((r: any[]) => r[1])).toEqual([18, 18, 18]);
});

test('Layer mode: clicks add no history; group scales, switches to rotate, rotates and undoes', async ({ page }) => {
  const at = await fixture(page, 'shapes', 'layers'), a = at(550, 400), b = at(1150, 400);
  const u0 = (await details(page)).undo;
  for (let i = 0; i < 3; i++) await page.mouse.click(a.x, a.y);
  expect((await details(page)).undo).toBe(u0);
  await page.keyboard.down('Shift'); await page.mouse.click(b.x, b.y); await page.keyboard.up('Shift');
  expect((await details(page)).picked).toHaveLength(2);
  const before = await details(page);
  await move(page, at(1300, 500), 50, 35);
  const scaled = await details(page); expect(scaled.undo).toBe(u0 + 1);
  expect(scaled.layers[0].shapes[0].w).toBeGreaterThan(before.layers[0].shapes[0].w);
  expect(scaled.layers[1].shapes[0].w).toBeGreaterThan(before.layers[1].shapes[0].w);
  await page.screenshot({ path: `${shots}/group-scale.png` });
  await page.keyboard.press('Control+z');
  await page.mouse.click(a.x, a.y);
  await expect(page.locator('.stage-hint').filter({ hasText: 'Drag a corner to rotate' })).toBeVisible();
  await page.screenshot({ path: `${shots}/group-rotate-handles.png` });
  await move(page, at(1300, 300), 0, 70);
  const rotated = await details(page);
  expect(rotated.layers.every((l: any) => Math.abs(l.shapes[0].rot?.[1] ?? 0) > .01)).toBe(true);
  await page.screenshot({ path: `${shots}/group-rotated.png` });
  await page.keyboard.press('Control+z'); expect((await details(page)).layers).toEqual(before.layers);
});

for (const kind of ['shapes', 'raster', 'image'] as const) test(`${kind}: clicks then drag undo in one step, with geometry and next canvas frame timing`, async ({ page }) => {
  const at = await fixture(page, kind), p = at(480, 400);
  await page.mouse.click(p.x, p.y);
  const before = await details(page);
  if (kind === 'shapes') { const corner = at(400, 300); await page.mouse.click(corner.x, corner.y); expect((await details(page)).undo).toBe(before.undo); }
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(350); await page.mouse.click(p.x, p.y); }
  expect((await details(page)).undo).toBe(before.undo);
  expect((await details(page)).layers).toEqual(before.layers);
  await move(page, p);
  expect((await details(page)).undo).toBe(before.undo + 1);
  await page.screenshot({ path: `${shots}/${kind}-moved.png` });
  await page.evaluate(() => {
    const c = document.querySelector('canvas.stage-canvas') as HTMLCanvasElement, ctx = c.getContext('2d')!;
    const sig = () => { const d = ctx.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; };
    const initial = sig(); (window as any).__undoMeasurement = new Promise((resolve) => {
      document.addEventListener('keydown', function listener(e) {
        if (e.key !== 'z' || !e.ctrlKey) return; document.removeEventListener('keydown', listener, true);
        const start = performance.now(); const frame = () => { if (sig() !== initial) resolve(performance.now() - start); else if (performance.now() - start > 2000) resolve(2000); else requestAnimationFrame(frame); }; requestAnimationFrame(frame);
      }, true);
    });
  });
  await page.keyboard.press('Control+z');
  const ms = await page.evaluate(() => (window as any).__undoMeasurement);
  expect((await details(page)).layers).toEqual(before.layers);
  expect(ms).toBeLessThan(500);
  console.log(JSON.stringify({ case: kind, undoToCanvasMs: ms, undoSteps: 1 }));
  await page.screenshot({ path: `${shots}/${kind}-undo.png` });
});
