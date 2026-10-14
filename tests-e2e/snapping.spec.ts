import { chromium, expect, test, type Page } from '@playwright/test';
import { setup, strip } from './shapeHelpers';

/*
 * Snapping as a person uses it. The scene (rectangles as vector layers) is set up through the store; the pointer is
 * used only for the drags under test. The zoom is read from the zoom readout, and the page is taken to be centred on
 * the canvas (the view on open). Sandbox only: `npx playwright test tests-e2e/snapping.spec.ts --workers=1`.
 */

test.use({ viewport: { width: 1500, height: 940 }, launchOptions: { executablePath: chromium.executablePath() } });
test.describe.configure({ timeout: 120_000 });

/** Zoom from the zoom field of the status bar (percent). */
const zoomOf = async (page: Page) => Number(await page.locator('input[aria-label="Zoom percent"]').inputValue()) / 100;

/** Put rectangles (doc px) as vector layers and return their ids; pick the first for moving. */
async function scene(page: Page, rects: Array<{ id: string; x: number; y: number; w: number; h: number }>, paintMode?: 'drawing' | 'design') {
  return page.evaluate(async ({ rects, paintMode }) => {
    const st = await import('/src/store/store.ts' as string);
    const A = await import('/src/engine/design/actions.ts' as string);
    const sid = st.useStore.getState().activeSessionId;
    const doc = A.activeDoc(sid)!;
    if (paintMode) A.mutateDoc(sid, doc.id, (d: any) => ({ ...d, paintMode }));
    const ids: Record<string, string> = {};
    for (const r of rects) {
      const layerId = A.addEmptyLayer(sid, doc.id, 'vector')!;
      A.patchLayer(sid, doc.id, layerId, { shapes: [{ id: r.id + 's', type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, fill: '#8fd', stroke: null, strokeWidth: 0, radius: 0 }] });
      ids[r.id] = layerId;
    }
    st.setUi({ tool: 'move' });
    return { ids, doc: { w: doc.width, h: doc.height } };
  }, { rects, paintMode });
}

/** The layer box of one rectangle, from the model. */
const boxOf = (page: Page, layerId: string) => page.evaluate(async (id: string) => {
  const st = await import('/src/store/store.ts' as string);
  const A = await import('/src/engine/design/actions.ts' as string);
  const d = A.activeDoc(st.useStore.getState().activeSessionId)!;
  const l = d.layers.find((x: any) => x.id === id) as any;
  return { x: l.shapes[0].x, y: l.shapes[0].y, w: l.shapes[0].w, h: l.shapes[0].h };
}, layerId);

/**
 * Screen point of a doc point. Horizontally the page is centred on the canvas (Stage's fit: setView, Stage.tsx:258);
 * vertically its top is 70 px below the canvas top at this viewport (read from the page: the page frame starts at
 * y 118, the canvas at y 48). Layers are 100 doc px tall, so that offset stays well inside them.
 */
const PAGE_TOP = 70;
const screenOf = (c: { x: number; y: number; width: number }, docW: number, _docH: number, zoom: number, p: { x: number; y: number }) =>
  ({ x: c.x + (c.width - docW * zoom) / 2 + p.x * zoom, y: c.y + PAGE_TOP + p.y * zoom });

// This case was previously disabled after a non-reproducible first-drag failure. It now runs with an explicit mode
// preference; the historical cause was not established (see docs/render-estado.md).
test('snapping: near an edge it snaps within 10 screen px; a fast drag does not', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const zoom = await zoomOf(page); // the readout is rounded to whole percent: a few px of error at most
  const { doc } = await scene(page, []);
  const cx = doc.w / 2, cy = doc.h / 2;
  // Mover (M) at the centre; its neighbour N starts 200 px to the right.
  const s = await scene(page, [{ id: 'M', x: cx - 50, y: cy - 50, w: 100, h: 100 }, { id: 'N', x: cx + 200, y: cy - 50, w: 100, h: 100 }]);
  const M = s.ids.M;

  // Vector-only documents are Drawing (paintMode.ts): the user turns the switch on for this mode, as the switch allows.
  await page.evaluate(async () => { const st = await import('/src/store/store.ts' as string); st.setUi({ snapByMode: { drawing: { on: true, page: true, layers: true } } }); });
  // (1) Snap: the right edge of M ends 6 doc px short of N's left edge (inside 10 screen px at this zoom). Pause before the
  // last move so the pointer is slow and the snap is taken.
  const from = screenOf(c, doc.w, doc.h, zoom, { x: cx, y: cy });
  const to = screenOf(c, doc.w, doc.h, zoom, { x: cx + 144 + 0.4, y: cy });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.waitForTimeout(250);
  await page.mouse.move(to.x + 0.2, to.y);
  await page.mouse.up();
  const b1 = await boxOf(page, M);
  expect(Math.abs(b1.x + b1.w - (cx + 200))).toBeLessThan(0.5); // right edge on N's left edge

  // (2) A fast drag does not snap: the box follows the pointer and does not land on N.
  const from2 = screenOf(c, doc.w, doc.h, zoom, { x: b1.x + b1.w / 2, y: cy });
  const to2 = screenOf(c, doc.w, doc.h, zoom, { x: b1.x + b1.w / 2 - 300 + 4, y: cy });
  await page.mouse.move(from2.x, from2.y); await page.mouse.down();
  await page.mouse.move(to2.x, to2.y, { steps: 1 });
  await page.mouse.up();
  const b2 = await boxOf(page, M);
  // The move follows the pointer (within the zoom readout's rounding, about 3 px at 300 px) and does not land on N.
  expect(Math.abs((b2.x - b1.x) - (-300 + 4))).toBeLessThan(3.5);
  expect(Math.abs(b2.x + b2.w - (cx + 200))).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

// The delayed snap: a fast drag to 6 doc px of a neighbour's edge, then the pointer stops for 300 ms with no other
// pointermove. The watchdog (snapIdle.ts) snaps by itself at 150 ms; the release then keeps that position.
test('snapping: fast drag, then stop 300 ms without moving: the layer snaps with no further pointermove', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const zoom = await zoomOf(page);
  const { doc } = await scene(page, [], 'drawing');
  const cx = doc.w / 2, cy = doc.h / 2;
  const s = await scene(page, [{ id: 'M', x: cx - 50, y: cy - 50, w: 100, h: 100 }, { id: 'N', x: cx + 200, y: cy - 50, w: 100, h: 100 }], 'drawing');
  await page.evaluate(async () => { const st = await import('/src/store/store.ts' as string); st.setUi({ snapByMode: { drawing: { on: true, page: true, layers: true }, design: { on: true, page: true, layers: true } } }); });
  const from = screenOf(c, doc.w, doc.h, zoom, { x: cx, y: cy });
  const to = screenOf(c, doc.w, doc.h, zoom, { x: cx + 144, y: cy });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y); // the drag's first sample (a move has no speed before it)
  await page.mouse.move(to.x, to.y, { steps: 1 }); // then one fast jump
  const during = await boxOf(page, s.ids.M);
  expect(Math.abs(during.x + during.w - (cx + 200))).toBeGreaterThan(1); // fast: not snapped yet
  await page.waitForTimeout(300); // no pointermove
  const idle = await boxOf(page, s.ids.M);
  expect(Math.abs(idle.x + idle.w - (cx + 200))).toBeLessThan(0.5); // snapped by the timer alone
  await page.mouse.up();
  const after = await boxOf(page, s.ids.M);
  expect(Math.abs(after.x + after.w - (cx + 200))).toBeLessThan(0.5); // release keeps the snapped position
  expect(errors).toEqual([]);
});

test('snapping: object alignment guide appears during drag, clears on release, and the snap is undoable', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const zoom = await zoomOf(page);
  const { doc } = await scene(page, [], 'drawing');
  const cx = doc.w / 2, cy = doc.h / 2;
  const s = await scene(page, [
    { id: 'M', x: cx + 50, y: cy + 20, w: 80, h: 40 },
    { id: 'N', x: cx + 230, y: cy - 300, w: 120, h: 600 },
  ], 'drawing');
  await page.evaluate(async () => { const st = await import('/src/store/store.ts' as string); st.setUi({ snapByMode: { drawing: { on: true, page: true, layers: true } } }); });
  const before = await boxOf(page, s.ids.M);
  const from = screenOf(c, doc.w, doc.h, zoom, { x: before.x + before.w / 2, y: before.y + before.h / 2 });
  const to = screenOf(c, doc.w, doc.h, zoom, { x: before.x + before.w / 2 + 99, y: before.y + before.h / 2 });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.waitForTimeout(220); // the 150 ms snap settles while the gesture remains open
  await expect(page.locator('.snap-indicator [data-snap-alignment="true"]')).toHaveCount(1);
  const during = await boxOf(page, s.ids.M);
  expect(Math.abs(during.x + during.w - (cx + 230))).toBeLessThan(0.5);
  await page.mouse.up();
  await expect(page.locator('.snap-indicator [data-snap-alignment="true"]')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  expect(await boxOf(page, s.ids.M)).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(Math.abs((await boxOf(page, s.ids.M)).x + before.w - (cx + 230))).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

test('snapping: pointer cancellation clears an active alignment guide', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const zoom = await zoomOf(page);
  const { doc } = await scene(page, [], 'drawing');
  const cx = doc.w / 2, cy = doc.h / 2;
  const s = await scene(page, [
    { id: 'M', x: cx + 50, y: cy + 20, w: 80, h: 40 },
    { id: 'N', x: cx + 230, y: cy - 300, w: 120, h: 600 },
  ], 'drawing');
  await page.evaluate(async () => { const st = await import('/src/store/store.ts' as string); st.setUi({ snapByMode: { drawing: { on: true, page: true, layers: true } } }); });
  const before = await boxOf(page, s.ids.M);
  const from = screenOf(c, doc.w, doc.h, zoom, { x: before.x + before.w / 2, y: before.y + before.h / 2 });
  const to = screenOf(c, doc.w, doc.h, zoom, { x: before.x + before.w / 2 + 99, y: before.y + before.h / 2 });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 }); await page.waitForTimeout(220);
  await expect(page.locator('.snap-indicator [data-snap-alignment="true"]')).toHaveCount(1);
  await page.locator('canvas.stage-canvas').dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
  await expect(page.locator('.snap-indicator [data-snap-alignment="true"]')).toHaveCount(0);
  await page.mouse.up();
  expect(errors).toEqual([]);
});

// Equal spacing: the switch is set explicitly, so the case does not depend on a value saved in the sandbox.
test('snapping: three boxes, a moving one dropped in a gap: equal spacing shows and equalises', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const zoom = await zoomOf(page);
  const { doc } = await scene(page, []);
  const cx = doc.w / 2, cy = doc.h / 2;
  // The switch is set explicitly: a saved value from an earlier run must not decide this case.
  await page.evaluate(async () => { const st = await import('/src/store/store.ts' as string); st.setUi({ snapByMode: { design: { on: true, page: true, layers: true } } }); });
  await page.evaluate(async () => { const st = await import('/src/store/store.ts' as string); st.setUi({ snapByMode: { drawing: { on: true, page: true, layers: true } } }); });
  const sp = await scene(page, [{ id: 'A', x: cx - 500, y: cy - 50, w: 100, h: 100 }, { id: 'B', x: cx + 100, y: cy - 50, w: 100, h: 100 }, { id: 'C', x: cx - 195, y: cy - 50, w: 100, h: 100 }]);
  await page.keyboard.press('Escape');
  await page.mouse.click(c.x + 600, c.y + 30);
  const from3 = screenOf(c, doc.w, doc.h, zoom, { x: cx - 145, y: cy });
  const to3 = screenOf(c, doc.w, doc.h, zoom, { x: cx - 155, y: cy });
  await page.mouse.move(from3.x, from3.y); await page.mouse.down();
  await page.mouse.move(to3.x, to3.y, { steps: 4 });
  await page.waitForTimeout(250);
  await page.mouse.move(to3.x - 0.2, to3.y);
  await expect(page.locator('.snap-indicator text')).toHaveCount(2);
  await page.mouse.up();
  const C = await boxOf(page, sp.ids.C), A = await boxOf(page, sp.ids.A), B = await boxOf(page, sp.ids.B);
  expect(Math.abs((C.x - (A.x + A.w)) - (B.x - (C.x + C.w)))).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

test('snapping: equal-distance guides compare neighboring gaps across rows during drag', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const zoom = await zoomOf(page);
  const { doc } = await scene(page, [], 'drawing');
  const cx = doc.w / 2, cy = doc.h / 2;
  const s = await scene(page, [
    { id: 'A', x: cx + 200, y: cy - 200, w: 40, h: 40 }, { id: 'B', x: cx + 260, y: cy - 200, w: 40, h: 40 },
    { id: 'E', x: cx + 400, y: cy - 100, w: 40, h: 40 }, { id: 'F', x: cx + 460, y: cy - 100, w: 40, h: 40 },
    { id: 'C', x: cx - 300, y: cy + 200, w: 40, h: 40 }, { id: 'M', x: cx - 232, y: cy + 200, w: 40, h: 40 },
  ], 'drawing');
  await page.evaluate(async () => { const st = await import('/src/store/store.ts' as string); st.setUi({ snapByMode: { drawing: { on: true, page: true, layers: true, equalSpacing: true } } }); });
  const before = await boxOf(page, s.ids.M);
  const from = screenOf(c, doc.w, doc.h, zoom, { x: before.x + before.w / 2, y: before.y + before.h / 2 });
  const to = screenOf(c, doc.w, doc.h, zoom, { x: before.x + before.w / 2 - 8, y: before.y + before.h / 2 });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 }); await page.waitForTimeout(220);
  const cotas = page.locator('.snap-indicator text');
  await expect(cotas).toHaveCount(3); // reference gaps in two other rows plus the moving object's gap
  expect((await cotas.allTextContents()).every((label) => label === '20.0')).toBe(true);
  const moved = await boxOf(page, s.ids.M);
  expect(moved.x).toBeCloseTo(cx - 240, 1);
  await page.mouse.up();
  await expect(page.locator('.snap-indicator text')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  expect(await boxOf(page, s.ids.M)).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect((await boxOf(page, s.ids.M)).x).toBeCloseTo(cx - 240, 1);
  expect(errors).toEqual([]);
});

test('snapping: in Drawing mode the switch is off, so a layer moved next to an edge does not snap', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const zoom = await zoomOf(page);
  // The sandbox keeps the ui between runs: clear any saved switch, so the mode decides the default.
  await page.evaluate(async () => { const st = await import('/src/store/store.ts' as string); st.setUi({ snapByMode: undefined } as never); });
  const { doc } = await scene(page, [], 'drawing');
  const cx = doc.w / 2, cy = doc.h / 2;
  const s = await scene(page, [{ id: 'M', x: cx - 50, y: cy - 50, w: 100, h: 100 }, { id: 'N', x: cx + 200, y: cy - 50, w: 100, h: 100 }], 'drawing');
  const from = screenOf(c, doc.w, doc.h, zoom, { x: cx, y: cy });
  const to = screenOf(c, doc.w, doc.h, zoom, { x: cx + 144 + 0.4, y: cy });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.waitForTimeout(250);
  await page.mouse.move(to.x + 0.2, to.y);
  await page.mouse.up();
  const b = await boxOf(page, s.ids.M);
  expect(Math.abs(b.x + b.w - (cx + 200))).toBeGreaterThan(0.5); // the same gesture that snapped in Design does not here
  expect(errors).toEqual([]);
});

// The first drag of an unselected layer, in each mode on its own (Object and Layer in the strip's switch).
for (const mode of ['Object', 'Layer'] as const) {
  test(`snapping: first drag moves an unselected layer in ${mode} mode`, async ({ page }) => {
    const errors = await setup(page);
    const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
    const ids = await page.evaluate(async () => {
      const st = await import('/src/store/store.ts' as string);
      const A = await import('/src/engine/design/actions.ts' as string);
      const sid = st.useStore.getState().activeSessionId;
      const doc = A.activeDoc(sid)!;
      const mk = (x: number) => { const id = A.addEmptyLayer(sid, doc.id, 'vector')!; A.patchLayer(sid, doc.id, id, { shapes: [{ id: id + 's', type: 'rect', x, y: 300, w: 200, h: 200, fill: '#8fd', stroke: null, strokeWidth: 0, radius: 0 }] }); return id; };
      const m = mk(700), n = mk(1200);
      st.setUi({ tool: 'move' });
      return { m, n, w: doc.width, h: doc.height };
    });
    const radio = page.getByRole('radio', { name: mode, exact: true }).first();
    await radio.click();
    await expect(radio).toHaveAttribute('aria-checked', 'true');
    const box = () => page.evaluate(async (id: string) => {
      const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string);
      const d = A.activeDoc(st.useStore.getState().activeSessionId)!; const l = d.layers.find((x: any) => x.id === id) as any; return l.shapes[0].x;
    }, ids.m);
    const before = await box();
    const z = Number(await page.locator('input[aria-label="Zoom percent"]').inputValue()) / 100;
    const sx = c.x + (c.width - ids.w * z) / 2 + (700 + 100) * z, sy = c.y + 70 + 400 * z;
    await page.mouse.move(sx, sy); await page.mouse.down();
    await page.mouse.move(sx - 150 * z, sy, { steps: 6 }); await page.mouse.up();
    const after = await box();
    // The first drag on an unselected layer moves it in this mode (the layer is alone on its band: no snap involved).
    expect(Math.abs(after - before + 150)).toBeLessThan(3); // the pointer moved 150 doc px (150 · zoom screen px)
    expect(errors).toEqual([]);
  });
}
