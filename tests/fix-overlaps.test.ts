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
import { Tagger } from '../src/engine/design/exactRebuild';
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
it('Fill: a separate contour drawn the other way that crosses the body adds (the overlap fills); Cut leaves it empty', () => {
  const two = [...poly([[0, 0], [100, 0], [100, 100], [0, 100]]), ...poly([[-40, 20], [-40, 80], [60, 50]])];
  expect(winding(two, 20, 50)).toBe(0);
  const fill = fixOverlaps({ segs: two }, undefined, 'fill'), cut = fixOverlaps({ segs: two }, undefined, 'cut');
  expect(winding(fill, 20, 50)).not.toBe(0);
  expect(winding(cut, 20, 50)).toBe(0);
  for (const out of [fill, cut]) { expect(winding(out, -30, 50)).not.toBe(0); expect(winding(out, 80, 80)).not.toBe(0); }
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

// ---- one cubic that loops over itself, touching vertices, orientation, size
const orig = [[0, 0], [150, 150], [-50, 150], [100, 0]] as Pt[];
/** Largest distance from the piece's samples to the original cubic (a piece may start and end at the same point: no parameter lookup of its ends). */
function maxDistToCurve(piece: Pt[], c: Pt[]): number {
  const at = (t: number): Pt => { const m = 1 - t; return [m * m * m * c[0][0] + 3 * m * m * t * c[1][0] + 3 * m * t * t * c[2][0] + t * t * t * c[3][0], m * m * m * c[0][1] + 3 * m * m * t * c[1][1] + 3 * m * t * t * c[2][1] + t * t * t * c[3][1]]; };
  const dist = (p: Pt) => { let best = 0, bd = Infinity; for (let i = 0; i <= 4000; i++) { const q = at(i / 4000); const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i / 4000; } } let lo = Math.max(0, best - 1 / 4000), hi = Math.min(1, best + 1 / 4000); for (let i = 0; i < 60; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3; if (Math.hypot(at(a)[0] - p[0], at(a)[1] - p[1]) < Math.hypot(at(b)[0] - p[0], at(b)[1] - p[1])) hi = b; else lo = a; } return Math.hypot(at((lo + hi) / 2)[0] - p[0], at((lo + hi) / 2)[1] - p[1]); };
  let worst = 0;
  for (let i = 0; i <= 10; i++) { const u = i / 10, m = 1 - u; worst = Math.max(worst, dist([0, 1].map((k) => m * m * m * piece[0][k] + 3 * m * m * u * piece[1][k] + 3 * m * u * u * piece[2][k] + u * u * u * piece[3][k]) as Pt)); }
  return worst;
}
const loopCubic = parseSegs('M 0 0 C 150 150 -50 150 100 0 Z');
it('a single cubic that loops over itself: Fill fills the loop, Cut follows the winding, one new node, curves exact', () => {
  for (const m of ['fill', 'cut'] as const) {
    const out = fixOverlaps({ segs: loopCubic }, undefined, m);
    expect(out).not.toBe(loopCubic);
    expect(winding(out, 50, 100)).not.toBe(0); // the loop
    expect(winding(out, 50, 20)).not.toBe(0); // the body under the crossing
    expect(nodesOf(out)).toBe(2 + 1);
    const cubics = out.map((s, i) => (s.c === 'C' ? [out[i - 1].p[out[i - 1].p.length - 1], ...s.p] : null)).filter(Boolean) as Pt[][];
    expect(cubics.length).toBeGreaterThanOrEqual(2);
    for (const c of cubics) expect(maxDistToCurve(c, orig)).toBeLessThan(1e-6);
    expect(out.some((s) => s.c === 'L' && s.p[0][0] === 50 && Math.abs(s.p[0][1] - 64.2857) < 1e-3)).toBe(false); // no zero-length line at the crossing
  }
  const fill = fixOverlaps({ segs: loopCubic }, undefined, 'fill');
  expect(winding(fill, 50, 100) * winding(fill, 50, 20)).toBeGreaterThan(0); // Fill: the flipped loop winds like the rest
});
it('a closed cubic whose node is both its start (t 0) and its end (t 1) keeps its curve when another contour crosses it', () => {
  const drop = parseSegs('M 0 0 C 200 200 -200 200 0 0 Z'), dropC = [[0, 0], [200, 200], [-200, 200], [0, 0]] as Pt[];
  const segs = [...drop, ...poly([[-100, 40], [100, 40], [100, 60], [-100, 60]])];
  for (const m of ['fill', 'cut'] as const) {
    const out = fixOverlaps({ segs }, undefined, m);
    expect(out).not.toBe(segs);
    const cubics = out.map((s, i) => (s.c === 'C' ? [out[i - 1].p[out[i - 1].p.length - 1], ...s.p] : null)).filter(Boolean) as Pt[][];
    expect(cubics.length).toBeGreaterThan(0);
    for (const c of cubics) expect(maxDistToCurve(c, dropC)).toBeLessThan(1e-6);
    expect(winding(out, 0, 30)).not.toBe(0); expect(winding(out, 0, 100)).not.toBe(0);
  }
});
it('a figure 8 pinched exactly at a vertex is detected and both lobes wind the same way after Fill', () => {
  const pinch = poly([[0, 50], [50, 50], [100, 0], [100, 100], [50, 50], [0, 0]]);
  expect(Math.sign(winding(pinch, 20, 40))).toBe(-Math.sign(winding(pinch, 85, 50)));
  const out = fixOverlaps({ segs: pinch }, undefined, 'fill');
  expect(out).not.toBe(pinch);
  expect(winding(out, 85, 50)).not.toBe(0); expect(winding(out, 15, 40)).not.toBe(0);
  expect(Math.sign(winding(out, 85, 50))).toBe(Math.sign(winding(out, 15, 40)));
});
it('a vertex on another edge (T-junction) splits that edge: the enclosed lobe becomes a face', () => {
  // the contour goes up the middle of the square's bottom edge's line: vertex (50,0) lies on the edge (0,0)-(100,0)
  const t = poly([[0, 0], [100, 0], [100, 100], [50, 0], [50, -60], [0, -60]]);
  const out = fixOverlaps({ segs: t }, undefined, 'fill');
  expect(out).not.toBe(t);
  expect(winding(out, 80, 20)).not.toBe(0);
  expect(winding(out, 20, -30)).not.toBe(0);
});
it('collinear overlapping edges merge instead of breaking the graph', () => {
  const c = poly([[0, 0], [100, 0], [100, 100], [0, 100], [0, 50], [60, 50], [60, 70], [150, 70], [150, 30], [60, 30], [60, 50], [0, 50]]);
  const out = fixOverlaps({ segs: c }, undefined, 'fill');
  expect(out).not.toBe(c);
  expect(winding(out, 20, 20)).not.toBe(0); expect(winding(out, 125, 50)).not.toBe(0);
});
it('Fill orientation comes from the outer boundary: a ring whose outer has a big inverted lobe keeps its hole', () => {
  const bow = poly([[800, 0], [1200, 0], [0, 4000], [2000, 4000]]); // small lobe below (CCW), big one above (CW, bigger)
  const hole = poly([[970, 100], [1000, 250], [1030, 100]]); // drawn against the small lobe
  const ring = [...bow, ...hole];
  for (const m of ['fill', 'cut'] as const) {
    const out = fixOverlaps({ segs: ring }, undefined, m);
    expect(out).not.toBe(ring);
    expect(winding(out, 1000, 150)).toBe(0);
    expect(winding(out, 1000, 40)).not.toBe(0);
    expect(winding(out, 1000, 3000)).not.toBe(0);
  }
});
it('a huge polyline does not freeze: Fill falls back to winding semantics', () => {
  const n = 9000, pts: number[][] = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n, r = 1000 + (i % 2) * 5; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  pts.push([-2000, 0], [2000, 10]);
  const t0 = Date.now();
  expect(() => fixOverlaps({ segs: poly(pts) })).not.toThrow();
  expect(Date.now() - t0).toBeLessThan(8000);
});
it('Fill orientation: a bow whose folded lobe holds the lowest vertex still follows the body, so a ring keeps its hole', () => {
  const bow = poly([[-50, -200], [-40, 0], [100, 0], [100, 100], [0, 100], [0, 0], [40, 0]]); // net area positive, lowest vertex in the folded lobe
  const hole = poly([[40, 30], [40, 70], [70, 70], [70, 30]]); // drawn against the body
  for (const m of ['fill', 'cut'] as const) {
    const out = fixOverlaps({ segs: [...bow, ...hole] }, undefined, m);
    expect(winding(out, 55, 50)).toBe(0);
    expect(winding(out, 20, 50)).not.toBe(0);
    expect(winding(out, 90, 50)).not.toBe(0);
  }
});
it('collinear edges that overlap with interleaved ends (a<c<b<d on one line) are split at the overlap ends', () => {
  // (0,0)->(100,0) and later (60,0)->(160,0) share the stretch 60..100
  const c = poly([[0, 0], [100, 0], [100, 80], [160, 80], [160, 0], [60, 0], [60, -80], [0, -80]]);
  const out = fixOverlaps({ segs: c }, undefined, 'fill');
  expect(winding(out, 130, 40)).not.toBe(0);
  expect(winding(out, 30, -40)).not.toBe(0);
  expect(winding(out, 80, 40)).toBe(0); // the stretch 60..100 on y=0 has no area of its own: nothing bounded above x 60..100
});
it('a big path: Fill gives exactly the Cut result (the guard counts flattened points)', () => {
  const n = 9000, pts: number[][] = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n, r = 1000 + (i % 2) * 5; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  pts.push([-2000, 0], [2000, 10]);
  const big = poly(pts);
  expect(JSON.stringify(fixOverlaps({ segs: big }, undefined, 'fill'))).toBe(JSON.stringify(fixOverlaps({ segs: big }, undefined, 'cut')));
});
/** Rebuild of a loop of the first path with `extra` (a point of the second path, no shared segment) inserted after point `at`. */
function rebuiltWith(segs: Seg[], other: Seg[], at: number, extra: Pt, near?: Pt) {
  const tg = new Tagger(1000), paths = tg.tag([...segs, ...other], 0.1);
  const pt = paths[1].find((q) => q.x === extra[0] * 1000 && q.y === extra[1] * 1000)!;
  const body = paths[0].filter((q) => q.x !== pt.x || q.y !== pt.y); // the same place on the body is replaced by the other shape's point
  let k = at;
  if (near) { let bd = Infinity; body.forEach((q, i) => { const d = Math.hypot(q.x - near[0] * 1000, q.y - near[1] * 1000); if (d < bd && q.x < near[0] * 1000) { bd = d; k = i; } }); }
  const loop = [...body.slice(0, k + 1), pt, ...body.slice(k + 1)];
  return { out: tg.rebuild(loop, 0.25) };
}
it('projection before the refit: ends with no shared segment are projected onto the original line, no spurious node', () => {
  const rect = poly([[0, 0], [200, 0], [200, 100], [0, 100]]), tri = poly([[50, 0], [150, 0], [100, -50]]);
  const { out } = rebuiltWith(rect, tri, 0, [50, 0]);
  expect(nodesOf(out)).toBe(4);
  expect(out.some((s) => s.c !== 'Z' && s.p[s.p.length - 1][0] === 50)).toBe(false);
  expect(out.filter((s) => s.c === 'L')).toHaveLength(4); // 200,0 / 200,100 / 0,100 / back to 0,0
});
it('projection before the refit, curved: a touching point of another shape stays on the original cubic', () => {
  const arc = parseSegs('M 0 0 C 0 -60 100 -60 100 0 L 100 60 L 0 60 Z'), tri = poly([[50, -45], [30, -100], [70, -100]]);
  const { out } = rebuiltWith(arc, tri, 0, [50, -45], [50, -45]);
  const cubics = out.map((s, i) => (s.c === 'C' ? [out[i - 1].p[out[i - 1].p.length - 1], ...s.p] : null)).filter(Boolean) as Pt[][];
  expect(cubics).toHaveLength(1);
  expect(maxGapToCubic(cubics[0], [[0, 0], [0, -60], [100, -60], [100, 0]])).toBeLessThan(1e-6);
  expect(nodesOf(out)).toBe(4);
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
