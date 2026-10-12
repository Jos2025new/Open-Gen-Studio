import { chromium, expect, test } from '@playwright/test';
test.use({ launchOptions: { executablePath: chromium.executablePath() } });
test('merge, rasterize, grow/shrink and mirror in the real browser', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { if (location.port === '5183') Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await page.goto('http://localhost:5183');
  await page.waitForFunction(() => (window as any).__OGS_TEST__?.().hydrated);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const r = await page.evaluate(async () => {
    const st = await import('/src/store/store.ts' as string);
    const A = await import('/src/engine/design/actions.ts' as string);
    const R = await import('/src/engine/design/raster.ts' as string);
    const S = await import('/src/engine/design/pixelSelection.ts' as string);
    const B = await import('/src/engine/design/brushStroke.ts' as string);
    const sid = st.useStore.getState().activeSessionId;
    const doc0 = A.newBlankDoc(sid, { label: 't', width: 400, height: 300 });
    const id1 = A.addEmptyLayer(sid, doc0.id, 'raster'), id2 = A.addEmptyLayer(sid, doc0.id, 'raster');
    const paint = (id: string, x: number, color: string) => { const c = R.getBuffer(id).getContext('2d'); c.fillStyle = color; c.fillRect(x, 50, 100, 100); };
    paint(id1, 50, '#0000ff'); paint(id2, 100, '#ff0000');
    A.patchLayer(sid, doc0.id, id1, { opacity: 0.5 });
    const merged = await A.mergeDown(sid, doc0.id, id2);
    let doc = A.getDoc(sid, doc0.id);
    const m = doc.layers.find((l: any) => l.id === merged);
    const px = (id: string, x: number, y: number) => Array.from(R.getBuffer(id).getContext('2d').getImageData(x, y, 1, 1).data);
    const out: any = { layersAfterMerge: doc.layers.length, mergedOpacity: m.opacity, upperOpaque: px(merged, 150, 100), lowerOnly: px(merged, 70, 100) };
    const tid = A.addTextLayer(sid, doc0.id, 'Hello', { x: 20, y: 200, width: 0 }, { fontSize: 40, color: '#ffffff' });
    const rid = await A.rasterizeLayer(sid, doc0.id, tid);
    doc = A.getDoc(sid, doc0.id);
    const rl = doc.layers.find((l: any) => l.id === rid);
    const d = R.getBuffer(rid).getContext('2d').getImageData(0, 0, 400, 300).data; let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
    out.rasterized = { type: rl.type, inkPixels: ink };
    S.setSelection(doc0.id, { points: S.rectPoints(100, 100, 200, 160) });
    S.growSelection(doc, 10); out.grown = S.getSelection(doc0.id).box;
    S.growSelection(doc, -20); out.shrunk = S.getSelection(doc0.id).box;
    S.setSelection(doc0.id, null);
    const layer = doc.layers.find((l: any) => l.id === merged);
    const brush = { size: 10, mirror: true, color: '#00ff00', opacity: 1 };
    const stroke = B.newBrushStroke(brush, false);
    const buf = R.getBuffer(merged);
    const live = R.beginLiveStroke(R.cloneCanvas(buf), brush.color, 1, false, null, stroke.tip);
    B.addBrushSegment(stroke, live, buf, B.brushSegment(layer, { x: 20, y: 250 }, { x: 60, y: 250 }, brush, 1, 400));
    out.mirror = { left: px(merged, 40, 250), right: px(merged, 360, 250), segments: stroke.segments.length };
    return out;
  });
  console.log(JSON.stringify(r));
  expect(r.mergedOpacity).toBe(1);
  expect(r.upperOpaque[3]).toBe(255);
  expect(r.lowerOnly[3]).toBeGreaterThan(110); expect(r.lowerOnly[3]).toBeLessThan(145);
  expect(r.rasterized.type).toBe('raster'); expect(r.rasterized.inkPixels).toBeGreaterThan(100);
  expect(r.grown.w).toBeGreaterThan(115); expect(r.shrunk.w).toBeLessThan(85);
  expect(r.mirror.left[1]).toBe(255); expect(r.mirror.right[1]).toBe(255); expect(r.mirror.segments).toBe(2);
  expect(errors).toEqual([]);
});

test('stroke ruler (SAI 2): placed with the Ruler tool, the brush then paints along it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => { if (location.port === '5183') Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await page.goto('http://localhost:5183');
  await page.waitForFunction(() => (window as any).__OGS_TEST__?.().hydrated);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  if (!(await page.getByRole('button', { name: 'New document', exact: true }).isVisible())) { await page.getByRole('button', { name: 'Switch workspace', exact: true }).click(); await page.getByText('Designer', { exact: true }).click(); }
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('button', { name: /^Landscape 16:9/ }).first().click();
  const b = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const y0 = b.y + b.height * 0.4;
  await page.keyboard.press('k');
  await page.getByRole('complementary', { name: 'Layers', exact: true }).getByRole('tab', { name: 'All the settings of the active tool' }).click();
  // The kind is kept in the settings: choose it, whatever an earlier run left.
  await page.getByRole('complementary', { name: 'Layers', exact: true }).getByRole('button', { name: /^Ruler/ }).click();
  await page.getByRole('button', { name: 'Straight', exact: true }).click();
  await page.mouse.move(b.x + b.width * 0.2, y0); await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.7, y0, { steps: 5 }); await page.mouse.up();
  await page.keyboard.press('b');
  // The brush this test measures (white, opaque, plain), whatever earlier runs left in the sandbox: with a translucent,
  // pressure-thinned brush the stroke followed the ruler but never reached the white it looks for (MiMo, 2026-10-11).
  await page.evaluate(async () => {
    const st = await import('/src/store/store.ts' as string);
    st.setUi({ brush: { size: 24, color: '#ffffff', opacity: 1 } });
  });
  // A diagonal drag: with the ruler on, it lands as a horizontal line through its start.
  const ys = y0 + 80;
  await page.mouse.move(b.x + b.width * 0.3, ys); await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.6, ys + 150, { steps: 25 }); await page.mouse.up();
  await page.waitForTimeout(300);
  await page.locator('canvas.stage-canvas').screenshot({ path: 'tests-e2e/screens/ruler.png' });
  const rows = await page.evaluate(([x0, x1, y]) => {
    const c = document.querySelector('canvas.stage-canvas') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, hit = new Set<number>();
    for (let py = Math.round((y - 40 - r.top) * k); py < Math.round((y + 200 - r.top) * k); py++) for (let px = Math.round((x0 - r.left) * k); px < Math.round((x1 - r.left) * k); px += 3) { const i = (py * c.width + px) * 4; if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) hit.add(Math.round(py / k)); }
    return [...hit];
  }, [b.x + b.width * 0.35, b.x + b.width * 0.55, ys]);
  const span = Math.max(...rows) - Math.min(...rows);
  console.log('RULER rows', rows.length, 'span', span);
  expect(rows.length).toBeGreaterThan(0);
  expect(span).toBeLessThan(40);
});

test('perspective ruler: a stroke heads straight to the vanishing point it starts toward', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => { if (location.port === '5183') Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await page.goto('http://localhost:5183');
  await page.waitForFunction(() => (window as any).__OGS_TEST__?.().hydrated);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  if (!(await page.getByRole('button', { name: 'New document', exact: true }).isVisible())) { await page.getByRole('button', { name: 'Switch workspace', exact: true }).click(); await page.getByText('Designer', { exact: true }).click(); }
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await page.getByRole('button', { name: /^Landscape 16:9/ }).first().click();
  await page.keyboard.press('k');
  await page.getByRole('complementary', { name: 'Layers', exact: true }).getByRole('tab', { name: 'All the settings of the active tool' }).click();
  await page.getByRole('complementary', { name: 'Layers', exact: true }).getByRole('button', { name: /^Ruler/ }).click();
  await page.getByRole('button', { name: 'Perspective', exact: true }).click();
  const b = (await page.locator('canvas.stage-canvas').boundingBox())!;
  const vp1 = { x: b.x + b.width * 0.1, y: b.y + b.height * 0.3 }, vp2 = { x: b.x + b.width * 0.9, y: b.y + b.height * 0.3 };
  await page.mouse.move(vp1.x, vp1.y); await page.mouse.down(); await page.mouse.move(vp2.x, vp2.y, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('b');
  // Start low in the middle and move up-left, a little off: the stroke must lie on the line to the left point.
  const s = { x: b.x + b.width * 0.5, y: b.y + b.height * 0.7 };
  await page.mouse.move(s.x, s.y); await page.mouse.down();
  for (let i = 1; i <= 25; i++) await page.mouse.move(s.x - i * 9, s.y - i * 4 + (i % 3) * 3);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.locator('canvas.stage-canvas').screenshot({ path: 'tests-e2e/screens/perspective.png' });
  const off = await page.evaluate(([sx, sy, vx, vy]) => {
    const c = document.querySelector('canvas.stage-canvas') as HTMLCanvasElement, r = c.getBoundingClientRect(), k = c.width / r.width;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const ux = vx - sx, uy = vy - sy, ul = Math.hypot(ux, uy);
    let worst = 0, n = 0;
    for (let py = 0; py < c.height; py += 2) for (let px = 0; px < c.width; px += 2) {
      const i = (py * c.width + px) * 4;
      // Opaque white only: transparent pixels outside the page can keep a white colour.
      if (!(d[i] > 220 && d[i + 1] > 220 && d[i + 2] > 220 && d[i + 3] > 200)) continue;
      const x = px / k + r.left, y = py / k + r.top;
      if (Math.hypot(x - sx, y - sy) > 260) continue;
      n++; worst = Math.max(worst, Math.abs(((x - sx) * uy - (y - sy) * ux) / ul));
    }
    return { n, worst: Math.round(worst) };
  }, [s.x, s.y, vp1.x, vp1.y]);
  console.log('PERSPECTIVE', JSON.stringify(off));
  expect(off.n).toBeGreaterThan(20);
  expect(off.worst).toBeLessThan(14);
});
