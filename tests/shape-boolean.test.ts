// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { ShapeBuilder } from '../src/components/designer/ShapeBuilder';
import { BooleanOps } from '../src/components/designer/BooleanOps';
import { designerKey } from '../src/components/designer/designerKeys';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { setObjectPick, useObjectSelection } from '../src/engine/design/objectSelection';
import { flatten } from '../src/engine/design/pathBoolean';
import { parseSegs, type Pt, type Seg } from '../src/engine/design/pathNodes';
import { booleanShapes, outlineOf } from '../src/engine/design/shapeBoolean';
import { applyBoolean, applyBuilder, builderModel, faceAt } from '../src/engine/design/shapeBuilder';
import { shortcutGroups } from '../src/engine/shortcuts';
import { useStore } from '../src/store/store';
import type { VectorLayer, VectorShape } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Array<{ unmount: () => void }> = [];
afterEach(() => { for (const r of roots.splice(0)) act(() => r.unmount()); useObjectSelection.setState({ byDoc: {} }); document.body.innerHTML = ''; });

const base = { stroke: null, strokeWidth: 0, radius: 0 };
const rect = (id: string, x: number, y: number, w: number, h: number, fill: string, extra: Partial<VectorShape> = {}) => ({ ...base, id, type: 'rect', x, y, w, h, fill, ...extra }) as VectorShape;
const disc = (id: string, cx: number, cy: number, r: number, fill: string) => ({ ...base, id, type: 'ellipse', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, fill }) as VectorShape;
const shoelace = (pts: Pt[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + (p[0] * q[1] - q[0] * p[1]) / 2; }, 0);
/** Filled area of a shape (holes oriented opposite, as the engine writes them). */
const area = (s: VectorShape) => Math.abs(flatten(outlineOf(s) as Seg[], 0.05).reduce((a, l) => a + shoelace(l.points), 0));
const near = (a: number, b: number, rel = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel + 0.5);
const ok = (r: ReturnType<typeof booleanShapes>) => { if (typeof r === 'string') throw new Error(r); return r; };

const A = rect('a', 0, 0, 100, 100, '#f00', { stroke: '#111', strokeWidth: 2 }), B = rect('b', 50, 50, 100, 100, '#00f');

describe('boolean operations on shapes', () => {
  it('areas of union, subtract, intersect and exclude on two overlapping rectangles', () => {
    near(area(ok(booleanShapes('union', [A, B])).shapes[0]), 17500);
    near(area(ok(booleanShapes('subtract', [A, B])).shapes[0]), 7500);
    near(area(ok(booleanShapes('intersect', [A, B])).shapes[0]), 2500);
    near(area(ok(booleanShapes('exclude', [A, B])).shapes[0]), 15000);
  });
  it('two circles: the lens plus both crescents make the union', () => {
    const c1 = disc('c1', 0, 0, 50, '#0f0'), c2 = disc('c2', 50, 0, 50, '#ff0');
    const lens = area(ok(booleanShapes('intersect', [c1, c2])).shapes[0]);
    expect(lens).toBeGreaterThan(1000);
    near(area(ok(booleanShapes('union', [c1, c2])).shapes[0]), 2 * Math.PI * 2500 - lens, 0.02);
    near(area(ok(booleanShapes('exclude', [c1, c2])).shapes[0]), 2 * Math.PI * 2500 - 2 * lens, 0.02);
  });
  it('the look comes from the bottom shape (subtract: the back one); divide keeps each region\'s top-most paint', () => {
    for (const op of ['union', 'subtract', 'intersect', 'exclude'] as const) {
      const r = ok(booleanShapes(op, [A, B])).shapes[0];
      expect([r.type, r.fill, r.stroke, r.strokeWidth]).toEqual(['path', '#f00', '#111', 2]);
    }
    const parts = ok(booleanShapes('divide', [A, B])).shapes;
    expect(parts).toHaveLength(3);
    const byArea = (n: number) => parts.find((p) => Math.abs(area(p) - n) < 60)!;
    expect(byArea(2500).fill).toBe('#00f'); expect(byArea(7500).fill).toBe('#f00');
    near(parts.reduce((s, p) => s + area(p), 0), 17500);
  });
  it('turned shapes are read where they are drawn', () => {
    const turned = rect('t', 0, 0, 100, 100, '#0f0', { rot: [0, 1, -1, 0] });
    near(area(ok(booleanShapes('union', [turned, rect('u', 200, 0, 10, 10, '#000')])).shapes[0]), 10100);
  });
  it('open paths without fill are ignored (and reported), a line cuts in Divide, too few shapes explain themselves', () => {
    const open = { ...base, id: 'o', type: 'path', x: 0, y: 0, w: 10, h: 10, d: 'M 0 0 L 10 10', box0: { x: 0, y: 0, w: 10, h: 10 }, fill: null, stroke: '#000', strokeWidth: 1 } as VectorShape;
    expect(ok(booleanShapes('union', [A, B, open])).ignored).toBe(1);
    expect(booleanShapes('union', [A, open])).toMatch(/two or more/);
    const cut = { ...open, id: 'k', d: 'M 25 -10 L 25 120', box0: { x: 25, y: -10, w: 1, h: 130 }, x: 25, y: -10, w: 1, h: 130 } as VectorShape;
    expect(ok(booleanShapes('divide', [A, B, cut])).shapes.length).toBeGreaterThan(3);
    expect(booleanShapes('intersect', [A, rect('far', 500, 500, 10, 10, '#000')])).toMatch(/do not overlap/);
  });
});

function setup(shapes: VectorShape[], pick = shapes.map((s) => s.id)) {
  const sid = useStore.getState().activeSessionId, layer = { ...newVectorLayer('Shapes'), shapes } as VectorLayer;
  const doc = { ...createDoc('t', 400, 400), layers: [layer], activeLayerId: layer.id };
  addDoc(sid, doc);
  setObjectPick(doc.id, { layerId: layer.id, ids: pick });
  const shapesNow = () => (getDoc(sid, doc.id)!.layers[0] as VectorLayer).shapes as VectorShape[];
  return { sid, doc, layer, shapesNow };
}

describe('applying a boolean', () => {
  it('replaces the picks by one path in one undo step and leaves it picked; untouched shapes keep their place', () => {
    const other = rect('z', 300, 300, 10, 10, '#000'), { sid, doc, shapesNow } = setup([A, other, B], ['a', 'b']);
    expect(applyBoolean(sid, doc.id, 'union')).toBeNull();
    expect(shapesNow().map((s) => s.type)).toEqual(['rect', 'path']);
    expect(useObjectSelection.getState().byDoc[doc.id]!.ids).toEqual([shapesNow()[1].id]);
    near(area(shapesNow()[1]), 17500);
    undoDoc(sid, doc.id);
    expect(shapesNow().map((s) => s.id)).toEqual(['a', 'z', 'b']);
  });
  it('divide gives every region its own picked shape; a lone shape does nothing', () => {
    const { sid, doc, shapesNow } = setup([A, B]);
    applyBoolean(sid, doc.id, 'divide');
    expect(shapesNow()).toHaveLength(3);
    expect(useObjectSelection.getState().byDoc[doc.id]!.ids).toHaveLength(3);
    const one = setup([A, B], ['a']);
    expect(applyBoolean(one.sid, one.doc.id, 'union')).toMatch(/two or more/);
    expect(one.shapesNow()).toHaveLength(2);
  });
});

describe('Shape Builder', () => {
  const c1 = disc('c1', 100, 100, 50, '#0f0'), c2 = disc('c2', 150, 100, 50, '#ff0');
  it('two circles make three faces, found by point; the faces are computed once per set of shapes', () => {
    const model = builderModel([c1, c2]);
    expect(model.faces).toHaveLength(3);
    expect(builderModel([c1, c2])).toBe(model);
    const sources = (p: Pt) => model.faces![faceAt(model, p)].sources;
    expect(sources([60, 100])).toEqual([0]); expect(sources([125, 100])).toEqual([0, 1]); expect(sources([190, 100])).toEqual([1]);
    expect(faceAt(model, [400, 400])).toBe(-1);
  });
  it('merging two faces gives one contour; what is left stays as the remaining part of its original', () => {
    const { sid, doc, shapesNow } = setup([c1, c2]);
    const model = builderModel([c1, c2]), at = (p: Pt) => faceAt(model, p);
    expect(applyBuilder(sid, doc.id, doc.layers[0].id, ['c1', 'c2'], [at([60, 100]), at([125, 100])], 'merge', at([60, 100]))).toBe(true);
    const now = shapesNow();
    expect(now).toHaveLength(2);
    const merged = now.find((s) => s.id !== 'c2')!, rest = now.find((s) => s.id === 'c2')!;
    near(area(merged), Math.PI * 2500, 0.02);
    expect(merged.fill).toBe('#0f0');
    expect(parseSegs(merged.d!).filter((g) => g.c === 'M')).toHaveLength(1);
    near(area(rest) + area(merged), area(c1) + area(c2) - area(ok(booleanShapes('intersect', [c1, c2])).shapes[0]), 0.02);
    undoDoc(sid, doc.id);
    expect(shapesNow().map((s) => s.id)).toEqual(['c1', 'c2']);
  });
  it('the style comes from the top-most shape under the drag start', () => {
    const { sid, doc, shapesNow } = setup([c1, c2]);
    const model = builderModel([c1, c2]), lens = faceAt(model, [125, 100]);
    applyBuilder(sid, doc.id, doc.layers[0].id, ['c1', 'c2'], [lens], 'merge', lens);
    expect(shapesNow().find((s) => s.id !== 'c1' && s.id !== 'c2')!.fill).toBe('#ff0');
  });
  it('Alt deletes the touched faces and keeps the rest as the originals', () => {
    const { sid, doc, shapesNow } = setup([c1, c2]);
    const model = builderModel([c1, c2]), lens = faceAt(model, [125, 100]);
    applyBuilder(sid, doc.id, doc.layers[0].id, ['c1', 'c2'], [lens], 'delete');
    expect(shapesNow()).toHaveLength(2);
    near(shapesNow().reduce((s, x) => s + area(x), 0), 2 * Math.PI * 2500 - 2 * area(ok(booleanShapes('intersect', [c1, c2])).shapes[0]), 0.03);
    expect(shapesNow().every((s) => s.fill === '#0f0' || s.fill === '#ff0')).toBe(true);
  });
  it('too many shapes: no faces, nothing breaks', () => {
    const many = Array.from({ length: 70 }, (_, i) => rect(`m${i}`, i, 0, 20, 20, '#000'));
    expect(builderModel(many).faces).toBeNull();
    expect(faceAt(builderModel(many), [5, 5])).toBe(-1);
  });
});

describe('Shape Builder overlay', () => {
  const view = { x: 0, y: 0, zoom: 1, width: 800, height: 600 } as never;
  const c1 = disc('c1', 100, 100, 50, '#0f0'), c2 = disc('c2', 150, 100, 50, '#ff0');
  async function mount(pick: string[]) {
    (SVGElement.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined;
    const ctx = setup([c1, c2], pick), host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host); roots.push(root);
    await act(async () => root.render(createElement(ShapeBuilder, { view, sessionId: ctx.sid, doc: getDoc(ctx.sid, ctx.doc.id)! })));
    const fire = async (type: string, x: number, y: number, alt = false) => act(async () => { host.querySelector('svg')!.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, altKey: alt, button: 0 })); });
    return { ...ctx, host, fire };
  }
  it('hover shows the face under the pointer; a drag across regions merges them on release', async () => {
    const t = await mount(['c1', 'c2']);
    await t.fire('pointermove', 125, 100);
    expect(t.host.querySelectorAll('.sb-face')).toHaveLength(1);
    await t.fire('pointerdown', 60, 100); await t.fire('pointermove', 125, 100);
    expect(t.host.querySelectorAll('.sb-face.is-touched')).toHaveLength(2);
    await t.fire('pointerup', 125, 100);
    expect(t.shapesNow()).toHaveLength(2);
    expect(t.shapesNow().some((s) => s.type === 'path' && s.fill === '#0f0')).toBe(true);
  });
  it('Alt deletes; Esc cancels a drag; fewer than two shapes explains itself', async () => {
    const t = await mount(['c1', 'c2']);
    await t.fire('pointerdown', 125, 100, true); await t.fire('pointerup', 125, 100, true);
    expect(t.shapesNow().map((s) => s.type)).toEqual(['path', 'path']);
    undoDoc(t.sid, t.doc.id);
    await t.fire('pointerdown', 60, 100);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    await t.fire('pointerup', 60, 100);
    expect(t.shapesNow().map((s) => s.id)).toEqual(['c1', 'c2']);
    const lone = await mount(['c1']);
    expect(lone.host.querySelector('.stage-hint')!.textContent).toMatch(/pick two or more/i);
  });
});

describe('visible controls and keys', () => {
  it('the strip shows the combine group only with two or more shapes picked', async () => {
    const { sid, doc } = setup([A, B], ['a']);
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    const show = async () => act(async () => root.render(createElement(BooleanOps, { sessionId: sid, doc: getDoc(sid, doc.id)! })));
    await show();
    expect(host.querySelector('.boolean-ops')).toBeNull();
    setObjectPick(doc.id, { layerId: doc.layers[0].id, ids: ['a', 'b'] });
    await show();
    const names = [...host.querySelectorAll('.boolean-ops [aria-label]')].map((b) => b.getAttribute('aria-label')!);
    expect(names.slice(0, 4).map((n) => n.split(/\s/)[0])).toEqual(['Union', 'Subtract', 'Intersect', 'Exclude']);
    expect(names[0]).toContain('Ctrl+Alt+U');
    await act(async () => (host.querySelector('[aria-label^="Union"]') as HTMLButtonElement).click());
    expect(((getDoc(sid, doc.id)!.layers[0] as VectorLayer).shapes)).toHaveLength(1);
    act(() => root.unmount());
  });
  it('Ctrl+Alt+U / S / I / E run the operations and nothing else claims them', () => {
    const { sid, doc, shapesNow } = setup([A, B]);
    const press = (code: string, init: KeyboardEventInit = {}) => { const e = new KeyboardEvent('keydown', { key: code.slice(3).toLowerCase(), code, ctrlKey: true, altKey: true, bubbles: true, cancelable: true, ...init }); designerKey(e, sid, getDoc(sid, doc.id)); return e; };
    expect(press('KeyS').defaultPrevented).toBe(true);
    near(area(shapesNow()[0]), 7500);
    undoDoc(sid, doc.id);
    setObjectPick(doc.id, { layerId: doc.layers[0].id, ids: ['a', 'b'] });
    press('KeyI'); near(area(shapesNow()[0]), 2500);
    const keys = shortcutGroups().flatMap((g) => g.items.map((i) => i.keys));
    expect(keys.filter((k) => /Ctrl\+Alt\+U/.test(k))).toHaveLength(1);
    expect(keys.filter((k) => /Shift\+M/.test(k))).toHaveLength(1);
    expect(keys.filter((k) => /Mod \+ Alt \+ P/.test(k))).toHaveLength(1);
  });
});
