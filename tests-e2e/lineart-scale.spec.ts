import { chromium, expect, test } from '@playwright/test';
import { setup, SHOTS, strip } from './shapeHelpers';

/*
 * Lineart strokes shrunk five times in a row: the scene is set up through the store (a vector layer with two strokes,
 * picked for editing), and each shrink is the layer transform the box handles run (transformLayer, from the layer as
 * it was when the gesture started). Checked on the model: the outline area follows the scale squared, the strokes do
 * not vanish, and the width follows the scale. Sandbox only: `npx playwright test tests-e2e/lineart-scale.spec.ts --workers=1`.
 */

test.use({ viewport: { width: 1500, height: 940 }, launchOptions: { executablePath: chromium.executablePath() } });
test.describe.configure({ timeout: 120_000 });

test('lineart: five shrinks in a row keep the strokes proportional and visible', async ({ page }) => {
  const errors = await setup(page);
  await page.evaluate(async () => {
    const st = await import('/src/store/store.ts' as string);
    const A = await import('/src/engine/design/actions.ts' as string);
    const O = await import('/src/engine/design/objectSelection.ts' as string);
    const S = await import('/src/engine/design/strokes.ts' as string);
    const sid = st.useStore.getState().activeSessionId;
    const doc = A.activeDoc(sid)!;
    const layerId = A.addEmptyLayer(sid, doc.id, 'vector')!;
    const mk = (y: number, taper: number) => S.newStroke(Array.from({ length: 41 }, (_, i) => [300 + i * 8, y, 0.5] as [number, number, number]), { ...S.DEFAULT_STROKE_STYLE, size: 4, taperStart: taper, taperEnd: taper }, false);
    A.patchLayer(sid, doc.id, layerId, { strokes: [mk(260, 6), mk(330, 0)] });
    st.setUi({ tool: 'move' });
    const first = (A.activeDoc(sid)!.layers.find((l: any) => l.id === layerId) as any).strokes[0];
    O.pickObject(doc.id, layerId, first.id, false);
  });
  await expect(strip(page)).toBeVisible();

  const area = (id: string) => page.evaluate(async (sid: string) => {
    const st = await import('/src/store/store.ts' as string);
    const A = await import('/src/engine/design/actions.ts' as string);
    const S = await import('/src/engine/design/strokes.ts' as string);
    const d = A.activeDoc(sid)!;
    const l = d.layers.find((x: any) => x.strokes) as any;
    return l.strokes.map((s: any) => { const o = S.strokeOutline(s) as number[][]; return { a: Math.abs(o.reduce((acc, p, i) => { const q = o[(i + 1) % o.length]; return acc + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2, n: o.length, w: S.bakeStroke(s).size }; });
  }, id);

  const sid = await page.evaluate(() => (window as any).__OGS_TEST__().sessionId as string);
  const a0 = await area(sid);
  // Five shrinks, each from the layer as it was when its gesture started (transformLayer, as the box handles run it).
  for (let i = 0; i < 5; i++) {
    await page.evaluate(async (sid: string) => {
      const st = await import('/src/store/store.ts' as string);
      const A = await import('/src/engine/design/actions.ts' as string);
      const T = await import('/src/engine/design/affine.ts' as string);
      const d = A.activeDoc(sid)!;
      const base = d.layers.find((x: any) => x.strokes) as any;
      const ids = base.strokes.map((s: any) => s.id);
      const next = T.transformLayer(base, ids, [0.7, 0, 0, 0.7, 0, 0], {}, true);
      A.patchLayer(sid, d.id, base.id, { strokes: (next as any).strokes });
    }, sid);
  }
  const a1 = await area(sid);
  await page.screenshot({ path: `${SHOTS}/lineart-five-shrinks.png` });
  a0.forEach((s, i) => {
    expect(s.n).toBeGreaterThan(0);                                       // the stroke did not vanish
    expect(a1[i].a / s.a).toBeCloseTo(0.7 ** 10, 2);                      // area follows the scale squared, 5 times
    expect(a1[i].w).toBeCloseTo(s.w * 0.7 ** 5, 6);                       // width follows the scale
  });
  expect(errors).toEqual([]);
});
