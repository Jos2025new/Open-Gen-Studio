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

test('rectangle: one click transforms, double-click edits (corner and blur knots), one undo per drag, Done and Esc leave', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.6, c.y + c.height * 0.7, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('v');
  const mid = { x: c.x + c.width * 0.45, y: c.y + c.height * 0.5 };
  // One click: the shape is picked for moving and transforming; no corner or blur knots (docs/plan-edicion-formas.md).
  await page.mouse.click(mid.x, mid.y);
  await expect(strip(page).getByRole('button', { name: 'Edit shape' })).toBeVisible();
  await expect(knot(page, 'rx')).toHaveCount(0);
  // Double-click: edit mode, with its own knots (blur knots too, at 0) and its label.
  await page.mouse.dblclick(mid.x, mid.y);
  await expect(strip(page)).toContainText('Editing shape');
  for (const k of ['rx', 'ry', 'top', 'right']) await expect(knot(page, k)).toBeVisible();
  await expect(strip(page).getByRole('slider', { name: 'W', exact: true })).toBeVisible();
  const s0 = await shape(page);

  // Rx: dragging left along the top edge rounds the corners; Ry, unset, follows it (Inkscape).
  await dragKnot(page, 'rx', -60, 0);
  const s1 = await shape(page);
  expect(s1.rx).toBeGreaterThan(5);
  expect(s1.ry).toBeUndefined();
  // Ry alone: now an ellipse corner. Then Ctrl: both radii equal.
  await dragKnot(page, 'ry', 0, 30);
  const sr = await shape(page);
  expect(sr.ry).not.toBeCloseTo(s1.rx, 1);
  // Only the dragged radius moves: Rx keeps its value (user's rule; Ctrl or «Lock radii» move both).
  expect(sr.rx).toBeCloseTo(s1.rx, 6);
  // «Lock radii» in the bar: a plain drag moves both, like Ctrl.
  await strip(page).getByRole('switch', { name: /Lock radii/ }).click();
  await dragKnot(page, 'rx', -10, 0);
  const sl = await shape(page);
  expect(sl.rx).toBeCloseTo(sl.ry, 6);
  await strip(page).getByRole('switch', { name: /Lock radii/ }).click();
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
  expect([s3.rx, s3.ry, s3.radius]).toEqual([undefined, undefined, 0]);

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
  // Double-click a corner knot: its exact value is ready to type in the bar.
  await knot(page, 'rx').dblclick();
  await expect(strip(page).getByRole('spinbutton', { name: 'Rx value' })).toBeFocused();
  await page.keyboard.press('Escape');
  // Done leaves edit mode; double-click again and Esc leaves too. The shape stays picked, the knots go.
  const canvasSig = () => page.evaluate(() => { const c = document.querySelector('canvas.stage-canvas') as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; });
  const editingSig = await canvasSig();
  await strip(page).getByRole('button', { name: 'Done' }).click();
  await expect(knot(page, 'rx')).toHaveCount(0);
  // Review: Done redraws the canvas at once, with the transform handles back.
  await page.waitForTimeout(150);
  expect(await canvasSig()).not.toBe(editingSig);
  await expect(strip(page).getByRole('button', { name: 'Edit shape' })).toBeVisible();
  await strip(page).getByRole('button', { name: 'Edit shape' }).click();
  await expect(knot(page, 'rx')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(knot(page, 'rx')).toHaveCount(0);
  // A click on empty canvas leaves it too.
  await page.mouse.dblclick(mid.x, mid.y);
  await expect(knot(page, 'rx')).toBeVisible();
  await page.mouse.click(c.x + c.width * 0.9, c.y + c.height * 0.2);
  await expect(knot(page, 'rx')).toHaveCount(0);
  await page.mouse.dblclick(mid.x, mid.y);
  await expect(knot(page, 'rx')).toBeVisible();
  // A tiny shape on screen: Rx and Ry never share a spot, and the blur knots stay 20 px out.
  await page.evaluate(async () => {
    const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string);
    const sid = st.useStore.getState().activeSessionId, d = A.activeDoc(sid), l = d.layers.find((x: any) => x.type === 'vector');
    A.patchLayer(sid, d.id, l.id, { shapes: l.shapes.map((x: any) => ({ ...x, w: 6, h: 4, rx: 0, ry: 0, blur: 0 })) });
  });
  const at = async (k: string) => { const b = (await knot(page, k).boundingBox())!; return [b.x + b.width / 2, b.y + b.height / 2]; };
  const [rx, ry] = [await at('rx'), await at('ry')];
  expect(Math.hypot(rx[0] - ry[0], rx[1] - ry[1])).toBeGreaterThanOrEqual(10);
  const tiny = await page.locator('.shape-knot-lines line').evaluateAll((ls) => ls.map((l: any) => Math.hypot(l.x2.baseVal.value - l.x1.baseVal.value, l.y2.baseVal.value - l.y1.baseVal.value)));
  expect(Math.min(...tiny)).toBeGreaterThanOrEqual(19.5);
  await page.screenshot({ path: `${SHOTS}/tiny.png` });
  // The same at 5 %, 100 % and 400 % zoom: knots apart, no transform handles in the way (only knots are hit).
  for (const z of ['5', '100', '400']) {
    await page.getByRole('textbox', { name: 'Zoom percent' }).fill(z);
    await page.getByRole('textbox', { name: 'Zoom percent' }).press('Enter');
    await expect(strip(page)).toContainText('Editing shape');
    const [a, b2] = [await at('rx'), await at('ry')];
    expect(Math.hypot(a[0] - b2[0], a[1] - b2[1]), `zoom ${z}`).toBeGreaterThanOrEqual(10);
    const lines = await page.locator('.shape-knot-lines line').evaluateAll((ls) => ls.map((l: any) => Math.hypot(l.x2.baseVal.value - l.x1.baseVal.value, l.y2.baseVal.value - l.y1.baseVal.value)));
    expect(Math.min(...lines), `zoom ${z}`).toBeGreaterThanOrEqual(19.5);
  }
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

/*
 * Canvas and SVG draw a shape the same (review of 523dd35): a blurred line with no height, a thick stroke with
 * little blur, fill + stroke blurred together; and a shape from before Rx/Ry is drawn pixel for pixel as before.
 */
test('canvas and SVG match for blurred shapes; legacy rounded rectangles are unchanged', async ({ page }) => {
  const errors = await setup(page);
  const out = await page.evaluate(async () => {
    const R = await import('/src/engine/design/render.ts' as string); const E = await import('/src/engine/design/export.ts' as string);
    const W = 400, H = 260;
    const canvasOf = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const base = { id: 'v', type: 'vector', name: 'v', visible: true, locked: false, opacity: 1, blend: 'normal' };
    const docOf = (shape: any) => ({ id: 'd', name: 'd', width: W, height: H, background: null, activeLayerId: 'v', layers: [{ ...base, shapes: [{ id: 's', radius: 0, fill: null, stroke: null, strokeWidth: 0, ...shape }] }] });
    const viaCanvas = (doc: any) => { const c = canvasOf(); R.drawDoc(c.getContext('2d')!, doc, { resolution: 'document' }); return c.getContext('2d')!.getImageData(0, 0, W, H).data; };
    const viaSvg = async (doc: any) => {
      const svg = await E.docToSvg(doc, { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 });
      const img = new Image(); img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); await img.decode();
      const c = canvasOf(); c.getContext('2d')!.drawImage(img, 0, 0, W, H); return c.getContext('2d')!.getImageData(0, 0, W, H).data;
    };
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let n = 0, max = 0, ink = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > 8) n++; max = Math.max(max, d); if (i % 4 === 3 && a[i] > 0) ink++; } return { n, max, ink }; };
    const cases: Record<string, any> = {
      lineH: { type: 'line', x: 80, y: 130, w: 240, h: 0, stroke: '#ffffff', strokeWidth: 20, blur: 5 },
      lineV: { type: 'line', x: 200, y: 20, w: 0, h: 220, stroke: '#ffffff', strokeWidth: 20, blur: 5 },
      thickStroke: { type: 'rect', x: 80, y: 70, w: 240, h: 120, stroke: '#3366ff', strokeWidth: 50, blur: 2, join: 'miter' },
      fillAndStroke: { type: 'rect', x: 80, y: 70, w: 240, h: 120, fill: '#ffdd00', stroke: '#2244ff', strokeWidth: 20, blur: 10, rx: 30, ry: 12 },
      zeroWidthRect: { type: 'rect', x: 200, y: 60, w: 0, h: 120, stroke: '#ffffff', strokeWidth: 20, blur: 5 },
      zeroWidthSharp: { type: 'rect', x: 200, y: 60, w: 0, h: 120, stroke: '#ffffff', strokeWidth: 20 },
      turnedRounded: { type: 'rect', x: 120, y: 80, w: 160, h: 100, fill: '#ffdd00', stroke: '#2244ff', strokeWidth: 8, rx: 30, ry: 14, blur: 3, rot: [Math.cos(0.5), Math.sin(0.5), -Math.sin(0.5), Math.cos(0.5)] },
      turnedEllipse: { type: 'ellipse', x: 120, y: 80, w: 160, h: 100, fill: '#ff4488', rot: [Math.cos(-0.7), Math.sin(-0.7), -Math.sin(-0.7), Math.cos(-0.7)] },
      strokeBehind: { type: 'rect', x: 80, y: 70, w: 240, h: 120, fill: '#ffdd00', stroke: '#2244ff', strokeWidth: 20, blur: 10, paintOrder: 'stroke' },
    };
    const res: Record<string, any> = {};
    for (const [k, shape] of Object.entries(cases)) { const doc = docOf(shape); res[k] = diff(viaCanvas(doc), await viaSvg(doc)); }
    // Legacy: what the renderer drew before Rx/Ry (native roundRect), against what it draws now.
    const legacy = { type: 'rect', x: 80, y: 70, w: 240, h: 120, fill: '#ffdd00', stroke: '#ffffff', strokeWidth: 2, radius: 8 };
    const before = canvasOf(), b = before.getContext('2d')!;
    b.beginPath(); b.roundRect(80, 70, 240, 120, 8); b.fillStyle = '#ffdd00'; b.fill(); b.strokeStyle = '#ffffff'; b.lineWidth = 2; b.lineCap = 'round'; b.lineJoin = 'round'; b.stroke();
    res.legacy = diff(b.getImageData(0, 0, W, H).data, viaCanvas(docOf(legacy)));
    return res;
  });
  console.log(JSON.stringify(out));
  for (const k of ['lineH', 'lineV', 'thickStroke', 'fillAndStroke', 'strokeBehind', 'zeroWidthRect', 'zeroWidthSharp', 'turnedRounded', 'turnedEllipse']) {
    expect(out[k].ink, `${k}: the canvas shows it`).toBeGreaterThan(1000);
    expect(out[k].n, `${k}: canvas and SVG agree (pixels off by more than 8/255)`).toBeLessThan(out[k].ink * 0.01);
  }
  expect(out.legacy.max, 'a legacy rounded rectangle is drawn exactly as before').toBe(0);
  expect(errors).toEqual([]);
});

test('free rotation keeps a rectangle a rectangle: still editable, knots turned with it', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(c.x + c.width * 0.35, c.y + c.height * 0.35); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.55, c.y + c.height * 0.6, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('v');
  const mid = { x: c.x + c.width * 0.45, y: c.y + c.height * 0.48 };
  // Click, then click again: rotate handles (Inkscape); drag a corner to turn it.
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(400);
  await page.mouse.click(mid.x, mid.y);
  const corner = { x: c.x + c.width * 0.55, y: c.y + c.height * 0.6 };
  await page.mouse.move(corner.x, corner.y); await page.mouse.down();
  await page.mouse.move(corner.x + 60, corner.y - 10, { steps: 8 }); await page.mouse.up();
  const s1 = await shape(page);
  expect(s1.type).toBe('rect');
  expect(s1.rot).toBeDefined();
  // Still editable: double-click shows its knots; dragging Rx rounds the turned rectangle.
  await page.mouse.dblclick(mid.x, mid.y);
  await expect(knot(page, 'rx')).toBeVisible();
  await dragKnot(page, 'rx', -30, 0);
  const s2 = await shape(page);
  expect(s2.type).toBe('rect');
  expect(s2.rx).toBeGreaterThan(3);
  expect(s2.rot).toEqual(s1.rot);
  await page.screenshot({ path: `${SHOTS}/turned.png` });
  expect(errors).toEqual([]);
});

test('Convert to path, then edit its nodes (Inkscape Node tool): one undo per drag, double-click returns to nodes', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.6, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('v');
  const mid = { x: c.x + c.width * 0.4, y: c.y + c.height * 0.45 };
  await page.mouse.dblclick(mid.x, mid.y);
  await strip(page).getByRole('button', { name: 'Convert to path' }).click();
  const s0 = await shape(page);
  expect(s0.type).toBe('path');
  await expect(strip(page)).toContainText('Editing nodes');
  await expect(page.locator('rect.path-node')).toHaveCount(4);
  // Drag the second node (top right) out: the outline follows, as one undo step.
  const n = (await page.locator('rect.path-node').nth(1).boundingBox())!;
  await page.mouse.move(n.x + n.width / 2, n.y + n.height / 2); await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(n.x + n.width / 2 + 12 * i, n.y + n.height / 2 - 6 * i);
  await page.mouse.up();
  const s1 = await shape(page);
  expect(s1.d).not.toBe(s0.d);
  expect(s1.w).toBeGreaterThan(s0.w);
  await page.screenshot({ path: `${SHOTS}/nodes.png` });
  await page.keyboard.press('Control+z');
  expect((await shape(page)).d).toBe(s0.d);
  // Esc leaves; double-click on the path shows its nodes again.
  await page.keyboard.press('Escape');
  await expect(page.locator('rect.path-node')).toHaveCount(0);
  await page.mouse.dblclick(mid.x, mid.y);
  await expect(page.locator('rect.path-node')).toHaveCount(4);
  expect(errors).toEqual([]);
});

test('Convert to path changes no pixel, even turned, skewed, dashed and blurred; every node is what a click picks', async ({ page }) => {
  const errors = await setup(page);
  const out = await page.evaluate(async () => {
    const R = await import('/src/engine/design/render.ts' as string); const A = await import('/src/engine/design/affine.ts' as string); const M = await import('/src/engine/design/matrix.ts' as string);
    const W = 900, H = 660;
    const draw = (shape: any) => { const c = document.createElement('canvas'); c.width = W; c.height = H; R.drawDoc(c.getContext('2d')!, { id: 'd', name: 'd', width: W, height: H, background: '#202020', activeLayerId: 'v', layers: [{ id: 'v', type: 'vector', name: 'v', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [shape] }] } as any, { resolution: 'document' }); return c.getContext('2d')!.getImageData(0, 0, W, H).data; };
    const base = { id: 's', type: 'rect', x: 280, y: 220, w: 340, h: 200, fill: '#ffdd00', stroke: '#2244ff', strokeWidth: 14, radius: 0, rx: 60, ry: 25, blur: 6, dash: [4, 2], dashOffset: 1 };
    const turned = A.transformShape(A.transformShape(base, M.rotateAbout(0.5, 450, 320)), M.scaleAbout(1.6, 0.5, 450, 320));
    const res: Record<string, { n: number; max: number }> = {};
    for (const [k, s] of Object.entries({ plain: base, turnedSkewed: turned })) {
      const a = draw(s), b = draw(A.shapeToPath(s)); let n = 0, max = 0;
      for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > 8) n++; if (d > max) max = d; }
      res[k] = { n, max };
    }
    return res;
  });
  console.log(JSON.stringify(out));
  for (const k of Object.keys(out)) expect(out[k].n, `${k}: pixels off by more than 8/255 after Convert to path`).toBe(0);
  // Nodes over handles: the element under each node's centre is that node.
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('o');
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.36, c.y + c.height * 0.36, { steps: 4 }); await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.dblclick(c.x + c.width * 0.33, c.y + c.height * 0.33);
  await strip(page).getByRole('button', { name: 'Convert to path' }).click();
  const hits = await page.locator('rect.path-node').evaluateAll((ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === n; }));
  expect(hits.length).toBe(4);
  expect(hits.every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});

test('a turned path: dragging one node leaves the others where they were on screen (review of 480cfc3)', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.6, { steps: 6 }); await page.mouse.up();
  // Turn it 0.5 rad and make it a path, through the app's own functions.
  await page.evaluate(async () => {
    const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string);
    const F = await import('/src/engine/design/affine.ts' as string); const M = await import('/src/engine/design/matrix.ts' as string);
    const sid = st.useStore.getState().activeSessionId, d = A.activeDoc(sid), l = d.layers.find((x: any) => x.type === 'vector');
    A.patchLayer(sid, d.id, l.id, { shapes: l.shapes.map((x: any) => F.shapeToPath(F.transformShape(x, M.rotateAbout(0.5, x.x + x.w / 2, x.y + x.h / 2)))) });
  });
  await page.keyboard.press('v');
  await page.mouse.dblclick(c.x + c.width * 0.4, c.y + c.height * 0.45);
  const centres = () => page.locator('rect.path-node').evaluateAll((ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  const before = await centres();
  expect(before).toHaveLength(4);
  const [x, y] = before[2];
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + 5 * i, y + 3 * i);
  await page.mouse.up();
  const after = await centres();
  for (const i of [0, 1, 3]) expect(Math.hypot(after[i][0] - before[i][0], after[i][1] - before[i][1]), `node ${i}`).toBeLessThan(0.1);
  expect(Math.hypot(after[2][0] - before[2][0], after[2][1] - before[2][1])).toBeGreaterThan(50);
  // The dragged node ends under the pointer (review: converting the pointer with the current shape left it ~3.6 px off).
  expect(Math.hypot(after[2][0] - (x + 60), after[2][1] - (y + 36)), 'dragged node under the pointer').toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

test('layer opacity and blend apply to the layer as a whole, as SVG groups them (canvas = SVG)', async ({ page }) => {
  const errors = await setup(page);
  const out = await page.evaluate(async () => {
    const R = await import('/src/engine/design/render.ts' as string); const E = await import('/src/engine/design/export.ts' as string);
    const W = 440, H = 260;
    const doc = (bg: string | null, layer: any) => ({ id: 'd', name: 'd', width: W, height: H, background: bg, activeLayerId: 'v', layers: [{ id: 'v', type: 'vector', name: 'v', visible: true, locked: false, ...layer }] });
    const canvasOf = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const viaCanvas = (d: any) => { const c = canvasOf(); R.drawDoc(c.getContext('2d')!, d, { resolution: 'document' }); return c.getContext('2d')!.getImageData(0, 0, W, H).data; };
    const viaSvg = async (d: any) => {
      const svg = await E.docToSvg(d, { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 });
      const img = new Image(); img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); await img.decode();
      const c = canvasOf(); c.getContext('2d')!.drawImage(img, 0, 0, W, H); return c.getContext('2d')!.getImageData(0, 0, W, H).data;
    };
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let n = 0, max = 0, ink = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i] - b[i]); if (v > 8) n++; max = Math.max(max, v); if (i % 4 === 3 && a[i] > 0) ink++; } return { n, max, ink }; };
    const sh = (o: any) => ({ id: Math.random().toString(36), radius: 0, fill: null, stroke: null, strokeWidth: 0, ...o });
    const two = [sh({ type: 'rect', x: 100, y: 65, w: 240, h: 120, fill: '#ffdd00', blur: 0 }), sh({ type: 'ellipse', x: 200, y: 100, w: 200, h: 120, fill: '#ff3388' })];
    const fillStroke = (order?: string) => [sh({ type: 'rect', x: 100, y: 60, w: 240, h: 140, fill: '#ffdd00', stroke: '#2244ff', strokeWidth: 24, paintOrder: order })];
    const cases: Record<string, any> = {
      twoNormal: doc('#303030', { opacity: 0.5, blend: 'normal', shapes: two }),
      twoMultiply: doc('#808080', { opacity: 0.4, blend: 'multiply', shapes: two }),
      twoScreen: doc('#303030', { opacity: 0.4, blend: 'screen', shapes: two }),
      oneFillStroke: doc('#303030', { opacity: 0.5, blend: 'normal', shapes: fillStroke() }),
      oneStrokeBehind: doc('#303030', { opacity: 0.5, blend: 'normal', shapes: fillStroke('stroke') }),
      transparentBg: doc(null, { opacity: 0.5, blend: 'normal', shapes: two }),
      withBlur: doc('#303030', { opacity: 0.5, blend: 'normal', shapes: [two[0], sh({ ...two[1], blur: 6 })] }),
    };
    const res: Record<string, any> = {};
    for (const [k, d] of Object.entries(cases)) res[k] = diff(viaCanvas(d), await viaSvg(d));
    return res;
  });
  console.log(JSON.stringify(out));
  for (const [k, v] of Object.entries(out) as Array<[string, { n: number; ink: number }]>) expect(v.n, `${k}: canvas and SVG agree`).toBeLessThan(v.ink * 0.01);
  expect(errors).toEqual([]);
});

test('node types: pick a node, make it smooth or symmetric (bar or Shift+S / Shift+Y); its handles follow; one undo', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('o');
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.55, c.y + c.height * 0.65, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.dblclick(c.x + c.width * 0.42, c.y + c.height * 0.47);
  await strip(page).getByRole('button', { name: 'Convert to path' }).click();
  // Press the first node (no drag): it is picked and the bar offers its type.
  const n0 = (await page.locator('rect.path-node').first().boundingBox())!;
  await page.mouse.click(n0.x + n0.width / 2, n0.y + n0.height / 2);
  await expect(page.locator('rect.path-node.is-picked')).toHaveCount(1);
  await expect(strip(page).getByRole('radiogroup', { name: 'Node' })).toBeVisible();
  await page.keyboard.press('Shift+Y');
  let s = await shape(page);
  expect(s.nodeTypes?.[0]).toBe('z');
  // Drag one handle of that node: the other mirrors it (symmetric).
  const h = page.locator('circle.path-handle');
  const count = await h.count();
  const near = async () => { let best = 0, d = 1e9; for (let i = 0; i < count; i++) { const b = (await h.nth(i).boundingBox())!; const v = Math.hypot(b.x - n0.x, b.y - n0.y); if (v < d) { d = v; best = i; } } return best; };
  const hb = (await h.nth(await near()).boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(hb.x + hb.width / 2 + 4 * i, hb.y + hb.height / 2 + 6 * i);
  await page.mouse.up();
  const before = s.d;
  s = await shape(page);
  expect(s.d).not.toBe(before);
  // Symmetric: the node is the midpoint of its two handles (read from the saved path).
  const sym = await page.evaluate(async () => {
    const st = await import('/src/store/store.ts' as string); const A = await import('/src/engine/design/actions.ts' as string); const P = await import('/src/engine/design/pathNodes.ts' as string);
    const d = A.activeDoc(st.useStore.getState().activeSessionId), sh = d.layers.flatMap((l: any) => (l.type === 'vector' ? l.shapes : []))[0];
    const segs = P.pageSegs(sh), h = P.nodeHandles(segs, 0), at = segs[0].p[0], a = segs[h.in[0]].p[h.in[1]], b = segs[h.out[0]].p[h.out[1]];
    return Math.hypot((a[0] + b[0]) / 2 - at[0], (a[1] + b[1]) / 2 - at[1]);
  });
  expect(sym).toBeLessThan(0.05);
  await page.keyboard.press('Control+z');
  expect((await shape(page)).d).toBe(before);
  // The bar's choice works too.
  await strip(page).getByRole('radio', { name: /Cusp node/ }).click();
  expect((await shape(page)).nodeTypes?.[0]).toBe('c');
  expect(errors).toEqual([]);
});

test('add a node by double-clicking the outline, delete it with Delete (never the layer); outline unchanged on add', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.6, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.dblclick(c.x + c.width * 0.4, c.y + c.height * 0.45);
  await strip(page).getByRole('button', { name: 'Convert to path' }).click();
  await expect(page.locator('rect.path-node')).toHaveCount(4);
  const s0 = await shape(page);
  // Double-click the middle of the top edge (between the first two nodes).
  const [a, b] = [(await page.locator('rect.path-node').nth(0).boundingBox())!, (await page.locator('rect.path-node').nth(1).boundingBox())!];
  await page.mouse.dblclick((a.x + b.x) / 2 + a.width / 2, (a.y + b.y) / 2 + a.height / 2);
  await expect(page.locator('rect.path-node')).toHaveCount(5);
  await expect(page.locator('rect.path-node.is-picked')).toHaveCount(1);
  const s1 = await shape(page);
  // Paths keep 2 decimals when written back.
  const same = (p: any, q: any) => [p.x, p.y, p.w, p.h].forEach((v: number, i: number) => expect(Math.abs(v - [q.x, q.y, q.w, q.h][i])).toBeLessThan(0.01));
  same(s1, s0);
  // Delete removes that node only; the layer and the shape stay.
  await page.keyboard.press('Delete');
  await expect(page.locator('rect.path-node')).toHaveCount(4);
  const s2 = await shape(page);
  expect(s2).toBeTruthy();
  same(s2, s0);
  // Pick a corner and delete it from the bar: three nodes left; Ctrl+Z brings it back in one step.
  const n = (await page.locator('rect.path-node').nth(2).boundingBox())!;
  await page.mouse.click(n.x + n.width / 2, n.y + n.height / 2);
  await strip(page).getByRole('button', { name: 'Delete node' }).click();
  await expect(page.locator('rect.path-node')).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(page.locator('rect.path-node')).toHaveCount(4);
  expect(errors).toEqual([]);
});
