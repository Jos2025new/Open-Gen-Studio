// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { ToolDock } from '../src/components/designer/ToolDock';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { editShape, setObjectPick, useObjectSelection, useShapeEdit } from '../src/engine/design/objectSelection';
import { fixShapeOverlaps } from '../src/engine/design/fixOverlaps';
import { useStore } from '../src/store/store';
import type { DesignDoc, VectorShape } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { useStore.setState({ ui: initialUi }); useObjectSelection.setState({ byDoc: {} }); useShapeEdit.setState({ byDoc: {} }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const common = { stroke: '#000000', strokeWidth: 2, radius: 0, fill: '#ff0000' };
const folded = { ...common, type: 'path', d: 'M 0 0 L 100 0 L 100 100 L 0 100 Z M 50 50 L 50 150 L 150 150 L 150 50 Z', box0: { x: 0, y: 0, w: 150, h: 150 }, x: 0, y: 0, w: 150, h: 150, fillRule: 'evenodd' };
const clean = { ...common, type: 'path', d: 'M 0 0 L 100 0 L 100 100 L 0 100 Z', box0: { x: 0, y: 0, w: 100, h: 100 }, x: 0, y: 0, w: 100, h: 100 };
const rectP = { ...common, type: 'rect', box0: { x: 0, y: 0, w: 100, h: 60 }, x: 0, y: 0, w: 100, h: 60 };

function fresh(shape: Record<string, unknown>) {
  useStore.setState({ ui: { ...initialUi, tool: 'move' } });
  const sid = useStore.getState().activeSessionId, layer = newVectorLayer('Shape 9', [shape as never]);
  const doc = { ...createDoc('t', 300, 300), layers: [layer], activeLayerId: layer.id };
  addDoc(sid, doc);
  const shapes = () => (getDoc(sid, doc.id)!.layers[0] as { shapes: VectorShape[] }).shapes;
  const sh = shapes()[0];
  setObjectPick(doc.id, { layerId: layer.id, ids: [sh.id] });
  return { sid, doc, layer, sh, shapes };
}
const steps = (sid: string, docId: string, n: number) => { let c = 0; for (let i = 0; i < n; i++) { const b = getDoc(sid, docId)!.layers[0]; undoDoc(sid, docId); if (getDoc(sid, docId)!.layers[0] !== b) c++; } return c; };

it('fixShapeOverlaps: keeps id and style, sets nonzero, is one undo step', () => {
  const t = fresh(folded);
  expect(fixShapeOverlaps(t.sid, t.doc.id, t.layer.id, t.sh)).toBe(true);
  const s = t.shapes()[0];
  expect(s.id).toBe(t.sh.id);
  expect(s.fill).toBe('#ff0000'); expect(s.strokeWidth).toBe(2);
  expect(s.fillRule).toBeUndefined();
  expect(s.d).not.toBe(t.sh.d);
  undoDoc(t.sid, t.doc.id);
  expect(t.shapes()[0].d).toBe(t.sh.d);
});

it('no crossings: no change, no undo step', () => {
  const t = fresh(clean);
  const before = getDoc(t.sid, t.doc.id)!.layers[0];
  expect(fixShapeOverlaps(t.sid, t.doc.id, t.layer.id, t.sh)).toBe(false);
  expect(getDoc(t.sid, t.doc.id)!.layers[0]).toBe(before);
});

async function openMore(host: HTMLElement, selector: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
  return () => [...document.querySelectorAll<HTMLButtonElement>('.node-more button')].find((b) => b.textContent === 'Fix overlaps');
}
async function mount(sid: string, docId: string, host: HTMLElement) {
  const root = createRoot(host);
  await act(async () => root.render(createElement(ToolDock, { sessionId: sid, doc: getDoc(sid, docId) as DesignDoc })));
  return async () => act(async () => root.unmount());
}

it('selection strip More: Fix overlaps is enabled on a filled path and fixes it', async () => {
  const t = fresh(folded);
  const host = document.createElement('div'); document.body.append(host);
  const unmount = await mount(t.sid, t.doc.id, host);
  const entry = await openMore(host, '.context-more[aria-label="More shape operations"]');
  expect(entry()!.disabled).toBe(false);
  expect(entry()!.getAttribute('data-tip')).toBe('Resolve self-crossings (Fill or Cut)');
  await act(async () => entry()!.click());
  expect(t.shapes()[0].fillRule).toBeUndefined();
  expect(steps(t.sid, t.doc.id, 1)).toBe(1);
  await unmount(); host.remove();
});

it('selection strip More: disabled with a tip on a primitive', async () => {
  const t = fresh(rectP);
  const host = document.createElement('div'); document.body.append(host);
  const unmount = await mount(t.sid, t.doc.id, host);
  const entry = await openMore(host, '.context-more[aria-label="More shape operations"]');
  expect(entry()!.disabled).toBe(true);
  expect(entry()!.getAttribute('data-tip')).toContain('cannot cross');
  await unmount(); host.remove();
});

it('node edit More: Fix overlaps fixes and keeps editing the same shape', async () => {
  const t = fresh(folded);
  editShape(t.doc.id, t.layer.id, t.sh.id);
  const host = document.createElement('div'); document.body.append(host);
  const unmount = await mount(t.sid, t.doc.id, host);
  const entry = await openMore(host, '.context-more');
  expect(entry()!.disabled).toBe(false);
  await act(async () => entry()!.click());
  expect(t.shapes()[0].fillRule).toBeUndefined();
  expect(useShapeEdit.getState().byDoc[t.doc.id]?.shapeId).toBe(t.sh.id);
  await unmount(); host.remove();
});

it('a segment dragged back across its own contour: the flipped lobe is filled, nothing outside the outline is', async () => {
  const { fixOverlaps, flatten } = await import('../src/engine/design/pathBoolean');
  // Square whose right edge was dragged back past the left edge: the contour crosses itself and the fold winds the other way.
  const segs = [{ c: 'M', p: [[0, 0]] }, { c: 'L', p: [[100, 0]] }, { c: 'L', p: [[-40, 50]] }, { c: 'L', p: [[100, 100]] }, { c: 'L', p: [[0, 100]] }, { c: 'Z', p: [] }] as never;
  const out = fixOverlaps({ segs });
  const area = flatten(out, 0.1).filter((l) => l.closed).reduce((sum, l) => sum + Math.abs(l.points.reduce((a, p, k, ps) => { const q = ps[(k + 1) % ps.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2), 0);
  expect(area).toBeGreaterThan(4000);
  expect(area).toBeLessThan(4300);
});

// ---- Fill / Cut and exact curves
import { fixOverlaps, flatten, booleanOp } from '../src/engine/design/pathBoolean';
import { parseSegs, type Pt, type Seg } from '../src/engine/design/pathNodes';
const poly = (pts: number[][]): Seg[] => [{ c: 'M', p: [pts[0] as Pt] }, ...pts.slice(1).map((p): Seg => ({ c: 'L', p: [p as Pt] })), { c: 'Z', p: [] }];
/** Sum of the winding numbers of the closed loops around (x, y): nonzero fill = this is not 0. */
function winding(segs: Seg[], x: number, y: number): number {
  let w = 0;
  for (const l of flatten(segs, 0.05).filter((q) => q.closed)) {
    for (let i = 0; i < l.points.length; i++) {
      const [ax, ay] = l.points[i], [bx, by] = l.points[(i + 1) % l.points.length], c = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
      if (ay <= y) { if (by > y && c > 0) w++; } else if (by <= y && c < 0) w--;
    }
  }
  return w;
}
// A closed path whose segment was dragged back across its own contour: one lobe overlaps the original with opposite winding.
const lobe = poly([[0, 0], [100, 0], [100, 100], [0, 100], [0, 50], [60, 50], [60, 70], [150, 70], [150, 30], [60, 30], [60, 50], [0, 50]]);
const overlapAt: Pt = [80, 50], plusAt: Pt = [20, 20], minusAt: Pt = [125, 50];

it('the folded-back lobe: the overlap is winding 0 in the source (enclosed and cancelled), the lobe winds the other way', () => {
  expect(winding(lobe, ...overlapAt)).toBe(0);
  expect(Math.sign(winding(lobe, ...plusAt))).toBe(-Math.sign(winding(lobe, ...minusAt)));
  expect(winding(lobe, ...plusAt)).not.toBe(0);
});
it('Fill straightens the flipped part: the overlap is filled; Cut leaves it empty; the flipped lobe is filled in both', () => {
  const fill = fixOverlaps({ segs: lobe }, undefined, 'fill'), cut = fixOverlaps({ segs: lobe }, undefined, 'cut');
  expect(fill).not.toBe(lobe); expect(cut).not.toBe(lobe);
  expect(winding(fill, ...overlapAt)).not.toBe(0);
  expect(winding(cut, ...overlapAt)).toBe(0);
  for (const out of [fill, cut]) { expect(winding(out, ...plusAt)).not.toBe(0); expect(winding(out, ...minusAt)).not.toBe(0); }
  expect(fixOverlaps({ segs: lobe })).toEqual(fill); // Fill is the default
});
it('a ring drawn as two opposite contours keeps its hole in both modes (beside a fold)', () => {
  const ring = [...poly([[0, 0], [100, 0], [100, 100], [0, 100]]), ...poly([[25, 25], [25, 75], [75, 75], [75, 25]]), ...poly([[200, 0], [300, 100], [300, 0], [200, 100]])];
  for (const m of ['fill', 'cut'] as const) {
    const out = fixOverlaps({ segs: ring }, undefined, m);
    expect(out).not.toBe(ring);
    expect(winding(out, 50, 50)).toBe(0);
    expect(winding(out, 10, 10)).not.toBe(0);
    expect(winding(out, 210, 50)).not.toBe(0);
  }
});

const curved = parseSegs('M 0 50 C 0 -20 100 -20 100 50 L 50 -40 L 0 50 Z');
const nodesOf = (segs: Seg[]) => new Set(segs.filter((s) => s.c !== 'Z').map((s) => s.p[s.p.length - 1].map((v) => Math.round(v * 1e5)).join(','))).size;
/** The cubic `out` is the piece of `orig` between two parameters: the largest gap over samples. */
function maxGapToCubic(out: Pt[], orig: Pt[]): number {
  const at = (c: Pt[], t: number): Pt => { const m = 1 - t; return [m * m * m * c[0][0] + 3 * m * m * t * c[1][0] + 3 * m * t * t * c[2][0] + t * t * t * c[3][0], m * m * m * c[0][1] + 3 * m * m * t * c[1][1] + 3 * m * t * t * c[2][1] + t * t * t * c[3][1]]; };
  const find = (p: Pt) => { let best = 0, bd = Infinity; for (let i = 0; i <= 20000; i++) { const q = at(orig, i / 20000), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i / 20000; } } let lo = Math.max(0, best - 1 / 20000), hi = Math.min(1, best + 1 / 20000); for (let i = 0; i < 60; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3; if (Math.hypot(...(at(orig, a).map((v, k) => v - p[k]) as Pt)) < Math.hypot(...(at(orig, b).map((v, k) => v - p[k]) as Pt))) hi = b; else lo = a; } return (lo + hi) / 2; };
  const t0 = find(out[0]), t1 = find(out[3]);
  let gap = 0;
  for (let i = 0; i <= 10; i++) { const u = i / 10, a = at(out, u), b = at(orig, t0 + (t1 - t0) * u); gap = Math.max(gap, Math.hypot(a[0] - b[0], a[1] - b[1])); }
  return gap;
}
it('curved segments stay the original curves: original nodes plus one per crossing, no extra nodes', () => {
  for (const m of ['fill', 'cut'] as const) {
    const out = fixOverlaps({ segs: curved }, undefined, m);
    expect(out).not.toBe(curved);
    expect(nodesOf(out)).toBe(3 + 2); // 3 nodes + 2 crossings of the arch with the two lines
    const cubics = out.filter((s) => s.c === 'C');
    expect(cubics.length).toBeGreaterThan(0);
    for (const c of out.map((s, i) => (s.c === 'C' ? [out[i - 1].p[out[i - 1].p.length - 1], ...s.p] : null))) if (c) expect(maxGapToCubic(c, [[0, 50], [0, -20], [100, -20], [100, 50]])).toBeLessThan(1e-6);
  }
});
it('booleanOp cuts a curve exactly: the pieces are sub-curves of the original, crossings are the only new nodes', () => {
  const body = parseSegs('M 0 0 C 0 -60 100 -60 100 0 L 100 60 L 0 60 Z');
  const out = booleanOp('intersection', [{ segs: body }], [{ segs: parseSegs('M 20 -100 L 80 -100 L 80 100 L 20 100 Z') }]);
  const cubics = out.map((s, i) => (s.c === 'C' ? [out[i - 1].p[out[i - 1].p.length - 1], ...s.p] : null)).filter(Boolean) as Pt[][];
  expect(cubics).toHaveLength(1);
  expect(maxGapToCubic(cubics[0], [[0, 0], [0, -60], [100, -60], [100, 0]])).toBeLessThan(1e-6);
  expect(nodesOf(out)).toBe(4);
});
it('booleanOp keeps untouched curves exactly (a union that only adds to straight edges)', () => {
  const body = parseSegs('M 0 0 C 0 50 100 50 100 0 L 100 -50 L 0 -50 Z');
  const out = booleanOp('union', [{ segs: body }], [{ segs: parseSegs('M 50 -80 L 120 -20 L 20 -20 Z') }]);
  const arch = out.find((s) => s.c === 'C')!;
  expect(out.filter((s) => s.c === 'C')).toHaveLength(1);
  expect(arch.p.flat()).toEqual([100, 50, 0, 50, 0, 0]);
});

// ---- UI: Fill / Cut inside the one entry
async function menuEntries(host: HTMLElement, selector: string) {
  await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click());
  const radio = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.node-more [role="radio"]')].find((b) => b.textContent === label)!;
  return { radio, run: () => [...document.querySelectorAll<HTMLButtonElement>('.node-more button')].find((b) => b.textContent === 'Fix overlaps')! };
}
const lobeShape = { ...folded, d: 'M 0 0 L 100 0 L 100 100 L 0 100 L 0 50 L 60 50 L 60 70 L 150 70 L 150 30 L 60 30 L 60 50 L 0 50 Z', fillRule: undefined, box0: { x: 0, y: 0, w: 150, h: 100 }, x: 0, y: 0, w: 150, h: 100 };
for (const [name, selector, edit] of [['selection More', '.context-more[aria-label="More shape operations"]', false], ['node edit More', '.context-more', true]] as const) {
  it(`${name}: Fill and Cut live in the one entry, the last choice is remembered, one undo step each`, async () => {
    for (const mode of ['fill', 'cut'] as const) {
      const t = fresh(lobeShape);
      if (edit) editShape(t.doc.id, t.layer.id, t.sh.id);
      const host = document.createElement('div'); document.body.append(host);
      const unmount = await mount(t.sid, t.doc.id, host);
      const m = await menuEntries(host, selector);
      expect(m.radio('Fill').getAttribute('data-tip')).toContain('straightened');
      expect(m.radio('Cut').getAttribute('data-tip')).toContain('overlap');
      expect(m.radio('Fill').getAttribute('aria-checked')).toBe(mode === 'fill' ? 'true' : String(useStore.getState().ui.fixMode === undefined));
      await act(async () => m.radio(mode === 'fill' ? 'Fill' : 'Cut').click());
      expect(useStore.getState().ui.fixMode).toBe(mode);
      await act(async () => m.run().click());
      const segs = parseSegs(t.shapes()[0].d as string);
      expect(winding(segs, ...overlapAt) === 0).toBe(mode === 'cut');
      expect(steps(t.sid, t.doc.id, 1)).toBe(1);
      await unmount(); host.remove();
    }
  });
}
