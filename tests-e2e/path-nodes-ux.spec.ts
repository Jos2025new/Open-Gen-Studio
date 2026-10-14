import { chromium, expect, test } from '@playwright/test';
import { setup, shape, SHOTS, strip } from './shapeHelpers';

/*
 * Node editing on a curved path, set up through the store (no clicks on the interface except the gesture under test):
 * a vector layer with an ellipse-like path of four curves, picked for editing, node 1 picked. Then: two handles show
 * on the picked node; Shift+S makes a broken corner smooth (read from the model); dragging a point of a segment bends
 * the curve through it (2 px); double-clicking a segment adds a node. Sandbox only:
 * `npx playwright test tests-e2e/path-nodes-ux.spec.ts --workers=1`. Screens go to tests-e2e/screens/shapes/.
 */

test.use({ viewport: { width: 1500, height: 940 }, launchOptions: { executablePath: chromium.executablePath() } });
test.describe.configure({ timeout: 120_000 });

const D = 'M 50 0 C 77 0 100 22 100 50 C 100 77 77 100 50 100 C 22 100 0 77 0 50 C 0 22 22 0 50 0 Z';

/** Build the scene through the store: one vector layer with the path, picked and in node edit with node 1 picked. */
async function prepare(page: import('@playwright/test').Page) {
  await page.evaluate(async (d) => {
    const st = await import('/src/store/store.ts' as string);
    const A = await import('/src/engine/design/actions.ts' as string);
    const O = await import('/src/engine/design/objectSelection.ts' as string);
    const sid = st.useStore.getState().activeSessionId;
    const doc = A.activeDoc(sid)!;
    const layerId = A.addEmptyLayer(sid, doc.id, 'vector')!;
    const shapeId = 'pathUx';
    A.patchLayer(sid, doc.id, layerId, { shapes: [{ id: shapeId, type: 'path', d, box0: { x: 0, y: 0, w: 100, h: 100 }, x: 300, y: 150, w: 300, h: 300, fill: '#ff8800', stroke: '#000000', strokeWidth: 4, radius: 0 }] });
    st.setUi({ tool: 'move' });
    O.pickObject(doc.id, layerId, shapeId, false);
    O.editShape(doc.id, layerId, shapeId);
    O.setShapeEdit(doc.id, { layerId, shapeId, node: 1, nodes: [1] } as never);
  }, D);
}

/** A point on the drawn outline (screen px), at a fraction of its length. */
const outlinePoint = (page: import('@playwright/test').Page, fraction: number) =>
  page.evaluate((f) => {
    const el = document.querySelector<SVGPathElement>('svg.path-nodes path.path-outline')!;
    const svg = el.ownerSVGElement!.getBoundingClientRect();
    const p = el.getPointAtLength(el.getTotalLength() * f);
    return { x: svg.left + p.x, y: svg.top + p.y };
  }, fraction);

test('path nodes: handles show on the picked node, Shift+S smooths a corner, a segment bends, double-click adds a node', async ({ page }) => {
  const errors = await setup(page);
  await prepare(page);
  await expect(strip(page)).toContainText('Editing nodes');
  // (1) The picked node (seg 1) shows its two handles: in (1,1) and out (2,0).
  await expect(page.locator('circle.path-handle[data-handle="1-1"]')).toBeVisible();
  await expect(page.locator('circle.path-handle[data-handle="2-0"]')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/path-nodes-handles.png` });

  // (2) Break the node: drag its out handle away, then Shift+S: the two handles are in line (read from the model).
  const out = page.locator('circle.path-handle[data-handle="2-0"]');
  const b = (await out.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 - 30, { steps: 5 }); await page.mouse.up();
  await page.locator('rect.path-node[data-node="1"]').click();
  await page.keyboard.press('Shift+S');
  const s = await shape(page);
  const angle = await page.evaluate(async (d: string) => {
    const pn = await import('/src/engine/design/pathNodes.ts' as string);
    const segs = pn.parseSegs(d);
    const h = pn.nodeHandles(segs, 1);
    const at = segs[pn.nodeSegs(segs).seg[1]].p.at(-1);
    const i = segs[h.in![0]].p[h.in![1]], o = segs[h.out![0]].p[h.out![1]];
    const u = [i[0] - at[0], i[1] - at[1]], v = [o[0] - at[0], o[1] - at[1]];
    const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
    return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  }, s.d);
  expect(Math.abs(angle - 180)).toBeLessThan(0.5);

  // (3) Drag a point of a segment: the path changes and the grabbed point lies on the new curve (2 px).
  const before = s.d;
  const g = await outlinePoint(page, 0.12);
  await page.mouse.move(g.x, g.y); await page.mouse.down();
  await page.mouse.move(g.x + 25, g.y - 35, { steps: 6 }); await page.mouse.up();
  const after = await shape(page);
  expect(after.d).not.toBe(before);
  const dist = await page.evaluate((t) => {
    const el = document.querySelector<SVGPathElement>('svg.path-nodes path.path-outline')!;
    const svg = el.ownerSVGElement!.getBoundingClientRect(), L = el.getTotalLength();
    let best = Infinity;
    for (let k = 0; k <= 4000; k++) { const p = el.getPointAtLength((L * k) / 4000); best = Math.min(best, Math.hypot(svg.left + p.x - t.x, svg.top + p.y - t.y)); }
    return best;
  }, { x: g.x + 25, y: g.y - 35 });
  expect(dist).toBeLessThan(2);
  await page.screenshot({ path: `${SHOTS}/path-nodes-bent.png` });

  // (4) Double-click on a segment adds a node.
  const n0 = (await shape(page)).d.split(/[CLQ]/).length;
  const m = await outlinePoint(page, 0.6);
  await page.mouse.dblclick(m.x, m.y);
  await expect.poll(async () => (await shape(page)).d.split(/[CLQ]/).length).toBeGreaterThan(n0);

  expect(errors).toEqual([]);
});
