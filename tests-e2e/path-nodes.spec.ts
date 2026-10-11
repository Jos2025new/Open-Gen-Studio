import { chromium, expect, test } from '@playwright/test';
import { dragKnot, knot, setup, shape, SHOTS, strip } from './shapeHelpers';

/*
 * Node editing of paths (Inkscape's Node tool) and Convert to path: drag, types, add, delete, turned paths. Sandbox only:
 * `npm run dev:sandbox`, then `npx playwright test tests-e2e/path-nodes.spec.ts`. Screens go to tests-e2e/screens/shapes/.
 */
test.use({ viewport: { width: 1500, height: 940 }, launchOptions: { executablePath: chromium.executablePath() } });
test.describe.configure({ timeout: 90_000 });

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
  // Esc clears the node selection, then exits; double-click on the path shows its nodes again.
  await page.keyboard.press('Escape');
  await expect(page.locator('rect.path-node')).toHaveCount(4);
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

test('Delete keeps the shape of a smooth node (Inkscape); Ctrl+Delete joins straight', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('o');
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.55, c.y + c.height * 0.65, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.dblclick(c.x + c.width * 0.42, c.y + c.height * 0.47);
  await strip(page).getByRole('button', { name: 'Convert to path' }).click();
  const s0 = await shape(page);
  // Add a node on the curve between the first two nodes (the outline's own point there), then Delete it.
  const outline = page.locator('path.path-outline');
  const pt = await outline.evaluate((p: SVGPathElement) => { const l = p.getTotalLength(), q = p.getPointAtLength(l * 0.1), r = p.ownerSVGElement!.getBoundingClientRect(); return { x: r.x + q.x, y: r.y + q.y }; });
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.locator('rect.path-node')).toHaveCount(5);
  await page.keyboard.press('Delete');
  await expect(page.locator('rect.path-node')).toHaveCount(4);
  const s1 = await shape(page);
  // The outline is back: same box within a hair, and the same curve (control points within 0.5 px).
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(s1[k] - s0[k]), k).toBeLessThan(0.5);
  const nums = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const a = nums(s0.d), b = nums(s1.d);
  expect(b.length).toBe(a.length);
  expect(Math.max(...a.map((v, i) => Math.abs(v - b[i])))).toBeLessThan(0.5);
  // Ctrl+Delete on a node: its neighbours joined by a straight segment.
  const n = (await page.locator('rect.path-node').nth(1).boundingBox())!;
  await page.mouse.click(n.x + n.width / 2, n.y + n.height / 2);
  await page.keyboard.press('Control+Delete');
  await expect(page.locator('rect.path-node')).toHaveCount(3);
  expect((await shape(page)).d).toContain(' L ');
  expect(errors).toEqual([]);
});

test('Shift+U / Shift+L turn segments between selected nodes into curves / lines; the tool does not change; one undo', async ({ page }) => {
  const errors = await setup(page);
  const c = (await page.locator('canvas.stage-canvas').boundingBox())!;
  await page.keyboard.press('r');
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.6, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('v');
  await page.mouse.dblclick(c.x + c.width * 0.4, c.y + c.height * 0.45);
  await strip(page).getByRole('button', { name: 'Convert to path' }).click();
  const s0 = await shape(page);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Shift+U');
  const s1 = await shape(page);
  expect((s1.d.match(/C/g) ?? []).length).toBe(4);
  // The U tool key (gradient) did not fire: still editing nodes with Edit.
  await expect(strip(page)).toContainText('Editing nodes');
  await expect(page.locator('circle.path-handle')).toHaveCount(8);
  await page.keyboard.press('Shift+L');
  expect((await shape(page)).d).not.toContain('C');
  await page.keyboard.press('Control+z');
  expect((await shape(page)).d).toBe(s1.d);
  await page.keyboard.press('Control+z');
  expect((await shape(page)).d).toBe(s0.d);
  // The bar's buttons do the same with two or more nodes selected.
  await page.keyboard.press('Control+a');
  await strip(page).getByRole('button', { name: 'Make curve' }).click();
  expect((await shape(page)).d).toContain('C');
  expect(errors).toEqual([]);
});
