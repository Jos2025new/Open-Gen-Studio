import { chromium, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setup } from './shapeHelpers';

// Fixed sandbox workload. Run before and after with identical fixtures and RASTER_PERF_LABEL only changed.
test.use({ viewport: { width: 1500, height: 940 }, launchOptions: { executablePath: chromium.executablePath() } });
test.setTimeout(600_000);
const label = process.env.RASTER_PERF_LABEL ?? 'raster-perf';
const dir = '/tmp/ogs-raster-performance';
mkdirSync(dir, { recursive: true });

test('raster workload: group move, undo/redo pixels, long painting and 4K single-object move', async ({ page }) => {
  const errors = await setup(page);
  const traceId = await page.evaluate((label) => (window as any).__OGS_TRACE__.start(label, { domains: ['history', 'raster', 'render', 'designer', 'browser', 'memory'] }), label);
  const cases: any[] = [];
  for (const [width, count, chosen] of [[1920, 1, 1], [1920, 10, 10], [1920, 50, 50], [1920, 50, 1], [3840, 50, 1]]) {
    const name = `${width}x${width * 9 / 16}-${count}-select-${chosen}`;
    const fixture = await page.evaluate(async ({ width, count, chosen }) => {
      const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string);
      const D = await import('/src/engine/design/doc.ts' as string), R = await import('/src/engine/design/raster.ts' as string);
      const B = await import('/src/engine/design/brushStroke.ts' as string), P = await import('/src/engine/design/objectSelection.ts' as string);
      const H = await import('/src/engine/design/history.ts' as string), L = await import('/src/engine/design/selection.ts' as string);
      const sid = S.useStore.getState().activeSessionId, d = A.activeDoc(sid), height = width * 9 / 16, k = width / 1920;
      const layer = D.newRasterLayer('Measured raster', { x: 0, y: 0, width, height }, { width, height });
      const opts = { color: '#ff8844', opacity: .8, size: 14 * k, hardness: .4, stabilization: 0, simulatePressure: false };
      const strokes = Array.from({ length: count }, (_, i) => {
        const s = B.newBrushStroke(opts, false), x = (100 + i % 5 * 320) * k, y = (100 + Math.floor(i / 5) * 75) * k;
        for (let j = 0; j < 96; j++) s.segments.push([x + j * 300 * k / 96, y + Math.sin(j / 10) * 15 * k, x + (j + 1) * 300 * k / 96, y + Math.sin((j + 1) / 10) * 15 * k, opts.size]);
        return s;
      });
      layer.paintStrokes = strokes; layer.paintBaseId = `${layer.id}-base`;
      const base = document.createElement('canvas'); base.width = width; base.height = height;
      R.setBuffer(layer.paintBaseId, base, false); R.composeRaster(layer, false);
      const original = R.getBuffer(layer.id)!;
      (window as any).__rasterFixture = { layer, original, sid, docId: d.id };
      S.setDoc(sid, d.id, (dd: any) => ({ ...dd, width, height, layers: [layer], activeLayerId: layer.id }));
      L.useLayerSelection.setState({ byDoc: {} }); H.dropHistory(d.id);
      P.setObjectPick(d.id, { layerId: layer.id, ids: strokes.slice(0, chosen).map((s: any) => s.id) });
      S.setUi({ tool: 'move', selectMode: 'objects', rulers: false, snap: { on: false, page: false, layers: false }, brush: { ...S.useStore.getState().ui.brush, ...opts } });
      return { width, height, cores: navigator.hardwareConcurrency, browser: navigator.userAgent, segmentsPerStroke: 96 };
    }, { width, count, chosen });
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
    const z = Math.min((c.width - 48) / fixture.width, (c.height - 144) / fixture.height, 4);
    const at = (x: number, y: number) => ({ x: c.x + (c.width - fixture.width * z) / 2 + x * width / 1920 * z, y: c.y + Math.max(12, (c.height - 120 - fixture.height * z) / 2) + y * width / 1920 * z });
    const mark = async (text: string) => page.evaluate((text) => (window as any).__OGS_TRACE__.mark(text), text);
    const reset = () => page.evaluate(async () => {
      const S = await import('/src/store/store.ts' as string), R = await import('/src/engine/design/raster.ts' as string), H = await import('/src/engine/design/history.ts' as string), P = await import('/src/engine/design/objectSelection.ts' as string);
      const f = (window as any).__rasterFixture;
      R.setBuffer(f.layer.id, f.original, false); H.dropHistory(f.docId);
      S.setDoc(f.sid, f.docId, (d: any) => ({ ...d, layers: [f.layer], activeLayerId: f.layer.id }));
      P.setObjectPick(f.docId, { layerId: f.layer.id, ids: f.layer.paintStrokes.slice(0, f.chosen).map((s: any) => s.id) }); S.setUi({ tool: 'move' });
    });
    await page.evaluate((chosen) => { (window as any).__rasterFixture.chosen = chosen; }, chosen);
    const pixels = (slot: string) => page.evaluate(async (slot) => {
      const R = await import('/src/engine/design/raster.ts' as string), f = (window as any).__rasterFixture, c = R.getBuffer(f.layer.id)!;
      f[slot] = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    }, slot);
    const compare = (slot: string) => page.evaluate(async (slot) => {
      const R = await import('/src/engine/design/raster.ts' as string), f = (window as any).__rasterFixture, c = R.getBuffer(f.layer.id)!, b = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, a = f[slot];
      let channels = 0, max = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) channels++; max = Math.max(max, d); }
      return { channels, max };
    }, slot);
    const key = async (action: 'undo' | 'redo') => {
      await page.evaluate(async (action) => {
        const T = await import('/src/lib/trace.ts' as string);
        document.addEventListener('keydown', function listener(e) { if (e.key.toLowerCase() !== 'z' || !e.ctrlKey) return; document.removeEventListener('keydown', listener, true); T.awaitFrame('designer', 'change', { action }); }, true);
      }, action);
      await page.keyboard.press(action === 'undo' ? 'Control+z' : 'Control+Shift+z');
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    };
    const repetitions = [];
    for (let rep = 0; rep < 3; rep++) {
      await mark(`${name}/setup-${rep}`); await reset(); await pixels('before');
      await mark(`${name}/move-${rep}`);
      const p = at(150, 115);
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(p.x + 36 * i / 8, p.y + 24 * i / 8);
      await page.mouse.up();
      await mark(`${name}/read-moved-${rep}`); await pixels('moved');
      const changed = await compare('before'); if (!changed.channels) { await page.screenshot({ path: `${dir}/failed-target.png` }); console.log(JSON.stringify({ name, rep, p, z, c, state: await page.evaluate(async () => { const S = await import('/src/store/store.ts' as string), A = await import('/src/engine/design/actions.ts' as string), P = await import('/src/engine/design/objectSelection.ts' as string); const d = A.activeDoc(S.useStore.getState().activeSessionId); return { tool: S.useStore.getState().ui.tool, pick: P.objectPick(d.id), offset: d.layers[0].paintStrokes[0].x }; }) })); } expect(changed.channels).toBeGreaterThan(0);
      await mark(`${name}/undo-${rep}`); await key('undo');
      await mark(`${name}/verify-undo-${rep}`); const undo = await compare('before'); expect(undo).toEqual({ channels: 0, max: 0 });
      await mark(`${name}/redo-${rep}`); await key('redo');
      await mark(`${name}/verify-redo-${rep}`); const redo = await compare('moved'); expect(redo).toEqual({ channels: 0, max: 0 });
      repetitions.push({ rep, changed, undo, redo });
    }
    if (width === 1920 && count === 50 && chosen === count) {
      for (let rep = 0; rep < 3; rep++) {
        await mark(`${name}/paint-setup-${rep}`); await reset(); await page.keyboard.press('b');
        await mark(`${name}/paint-${rep}`);
        const p = at(150, 930); await page.mouse.move(p.x, p.y); await page.mouse.down();
        for (let i = 1; i <= 80; i++) { const q = at(150 + i * 19, 930 + Math.sin(i / 8) * 30); await page.mouse.move(q.x, q.y); }
        await page.mouse.up();
        await mark(`${name}/paint-end-${rep}`);
      }
    }
    await page.screenshot({ path: `${dir}/${label}-${name}.png` });
    cases.push({ name, ...fixture, zoom: z, count, chosen, repetitions });
  }
  await page.evaluate(async () => { const R = await import('/src/engine/design/raster.ts' as string); await R.flushRaster(); });
  const saved = await page.evaluate(() => (window as any).__OGS_TRACE__.stop());
  writeFileSync(`${dir}/${label}.json`, JSON.stringify({ traceId, saved, cases, errors }, null, 2));
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ traceId, cases: cases.length, pixelProof: 'all undo/redo channels exact' }));
});

test('warm raster replay creates no canvas per saved stroke; cached coverage equals a fresh replay', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const R = await import('/src/engine/design/raster.ts' as string), D = await import('/src/engine/design/doc.ts' as string), B = await import('/src/engine/design/brushStroke.ts' as string);
    const l = D.newRasterLayer('coverage', { x: 0, y: 0, width: 512, height: 384 }, { width: 512, height: 384 });
    l.paintBaseId = `${l.id}-base`;
    const base = document.createElement('canvas'); base.width = 512; base.height = 384;
    const ctx = base.getContext('2d')!; ctx.fillStyle = '#336699'; ctx.fillRect(0, 0, 300, 384);
    R.setBuffer(l.paintBaseId, base, false);
    l.paintStrokes = Array.from({ length: 50 }, (_, i) => {
      const s = B.newBrushStroke({ color: i % 2 ? '#ff8040' : '#80ccff', opacity: .6, size: 18, hardness: .4, texture: i % 3 ? 'none' : 'paper', textureStrength: .7, pressureDensity: true, keepOpacity: i % 4 === 0, blend: i % 5 === 0 ? 'multiply' : 'normal' }, i % 7 === 0);
      for (let j = 0; j < 12; j++) { s.segments.push([30 + j * 30, 30 + i * 5, 60 + j * 30, 30 + i * 5 + Math.sin(j) * 8, 18]); s.tip!.densities!.push(.3 + (j % 4) / 4); }
      return s;
    });
    R.composeRaster(l, false);
    const moved = { ...l, paintStrokes: l.paintStrokes.map((s: any) => ({ ...s, x: 13.25, y: -7.5 })) };
    let canvases = 0;
    const original = document.createElement;
    document.createElement = function(tag: string, opts?: any) { if (tag === 'canvas') canvases++; return original.call(document, tag, opts); } as any;
    try { R.composeRaster(moved, false); } finally { document.createElement = original; }
    // Compare all channels, with translations, pressure density, texture, brush blend, Keep Opacity and erasers.
    const cached = R.getBuffer(l.id)!.getContext('2d')!.getImageData(0, 0, 512, 384).data;
    const fresh = { ...moved, paintStrokes: moved.paintStrokes.map((s: any) => ({ ...s, segments: s.segments.map((seg: any) => [...seg]) })) };
    R.composeRaster(fresh, false);
    const expected = R.getBuffer(l.id)!.getContext('2d')!.getImageData(0, 0, 512, 384).data;
    let differences = 0; for (let i = 0; i < expected.length; i++) if (cached[i] !== expected[i]) differences++;
    await R.flushRaster();
    const DB = await import('/src/lib/idb.ts' as string); R.commitEdit(l.id); await R.flushRaster();
    const blob = await DB.blobDb.get(`raster:${l.id}`);
    return { canvases, differences, saved: !!blob?.size };
  });
  // Replay may allocate destination/Keep Opacity surfaces, but never regenerate fifty coverage masks.
  expect(result.canvases).toBeLessThan(50);
  expect(result.differences).toBe(0);
  expect(result.saved).toBe(true);
  console.log(JSON.stringify({ cacheRegression: result }));
});
