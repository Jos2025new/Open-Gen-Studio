// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
vi.mock('../src/engine/design/viewCoordinates', async (original) => ({ ...await original<typeof import('../src/engine/design/viewCoordinates')>(), screenToDocument: (p: { x: number; y: number }) => p }));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Stage } from '../src/components/designer/Stage';
import { addEmptyLayer, addTextLayer, getDoc, newBlankDoc, patchLayer, setActiveLayer, undoDoc } from '../src/engine/design/actions';
import { drawShape, placeShape, shapeTarget } from '../src/engine/design/drawShape';
import { objectPicks } from '../src/engine/design/objectSelection';
import { docToSvg, type SvgDeps } from '../src/engine/design/export';
import { setUi, useStore } from '../src/store/store';
import type { VectorLayer, VectorShape } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const shape = (id: string, x = 0): VectorShape => ({ id, type: 'rect', x, y: 0, w: 10, h: 10, radius: 0, fill: '#000', stroke: null, strokeWidth: 0 } as VectorShape);
let sid: string, docId: string;
const doc = () => getDoc(sid, docId)!;
const vectors = () => doc().layers.filter((l): l is VectorLayer => l.type === 'vector');
const ctx: unknown = new Proxy({ globalAlpha: 1, lineWidth: 1 }, { get: (t, k) => (k in t ? t[k as keyof typeof t] : k === 'canvas' ? document.createElement('canvas') : k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : k === 'measureText' ? () => ({ width: 0 }) : () => ctx), set: (t, k, v) => { (t as Record<PropertyKey, unknown>)[k] = v; return true; } });
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  sid = useStore.getState().activeSessionId;
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], docs: [], activeDocId: null } } }));
  docId = newBlankDoc(sid, { label: 'Square', width: 1000, height: 1000 }).id;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shapes are drawn inside the active layer', () => {
  it('two shapes in a row share one layer, the second above the first, and the new one is the picked object', () => {
    const before = doc().layers.length;
    const layerId = drawShape(sid, docId, shape('a'))!;
    expect(doc().layers.length).toBe(before + 1);
    expect(doc().activeLayerId).toBe(layerId);
    expect(doc().layers.at(-1)!.name).toMatch(/^Layer \d+$/);
    expect(drawShape(sid, docId, shape('b', 20))).toBe(layerId);
    expect(doc().layers.length).toBe(before + 1);
    expect((doc().layers.at(-1) as VectorLayer).shapes.map((s) => s.id)).toEqual(['a', 'b']);
    expect(objectPicks(docId)).toEqual([{ layerId, ids: ['b'] }]);
  });
  it('one undo step takes the shape back, and the layer with it when the shape made it', () => {
    const before = doc().layers.length;
    drawShape(sid, docId, shape('a'));
    drawShape(sid, docId, shape('b'));
    undoDoc(sid, docId);
    expect((doc().layers.at(-1) as VectorLayer).shapes.map((s) => s.id)).toEqual(['a']);
    expect(objectPicks(docId).flatMap((p) => p.ids)).not.toContain('b');
    undoDoc(sid, docId);
    expect(doc().layers.length).toBe(before);
  });
  it('an image, a text, a hidden, a locked or a pixel-masked active layer gets a new layer; the next shape goes in that one', () => {
    const cases: Array<() => void> = [
      () => { addEmptyLayer(sid, docId, 'raster'); },
      () => { addTextLayer(sid, docId, 'Hi', { x: 0, y: 0, width: 100 }, {}); },
      () => { patchLayer(sid, docId, addEmptyLayer(sid, docId, 'vector')!, { visible: false }); },
      () => { patchLayer(sid, docId, addEmptyLayer(sid, docId, 'vector')!, { locked: true }); },
      () => { patchLayer(sid, docId, addEmptyLayer(sid, docId, 'vector')!, { pixelMask: { id: 'm' } } as never); },
    ];
    cases.forEach((make, i) => {
      make();
      const active = doc().activeLayerId, count = doc().layers.length;
      expect(shapeTarget(doc()), `case ${i}`).toBeNull();
      const first = drawShape(sid, docId, shape(`n${i}`))!;
      expect(first, `case ${i}`).not.toBe(active);
      expect(doc().layers.length, `case ${i}`).toBe(count + 1);
      expect(doc().layers.at(-1)!.id, `case ${i}`).toBe(first);
      expect(drawShape(sid, docId, shape(`m${i}`)), `case ${i}`).toBe(first);
      expect(doc().layers.length, `case ${i}`).toBe(count + 1);
    });
  });
  it('an active vector layer takes the shape where it is, above its shapes; older one-shape layers stay as they were', () => {
    const lower = addEmptyLayer(sid, docId, 'vector')!;
    patchLayer(sid, docId, lower, { shapes: [shape('old')] } as never);
    const upper = addEmptyLayer(sid, docId, 'vector')!;
    patchLayer(sid, docId, upper, { shapes: [shape('other')] } as never);
    setActiveLayer(sid, docId, lower);
    const placed = placeShape(doc(), shape('new'));
    expect(placed.created).toBe(false);
    expect(placed.doc.layers.map((l) => l.id)).toEqual(doc().layers.map((l) => l.id));
    expect((placed.doc.layers.find((l) => l.id === lower) as VectorLayer).shapes.map((s) => s.id)).toEqual(['old', 'new']);
    expect((placed.doc.layers.find((l) => l.id === upper) as VectorLayer).shapes.map((s) => s.id)).toEqual(['other']);
  });
  it('exports both shapes inside the one layer group', async () => {
    const layerId = drawShape(sid, docId, shape('a', 111))!;
    drawShape(sid, docId, shape('b', 222));
    const deps: SvgDeps = { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 };
    const dom = new DOMParser().parseFromString(await docToSvg(doc(), deps), 'image/svg+xml');
    expect([...dom.querySelectorAll(`g[id="${layerId}"] rect`)].map((r) => r.getAttribute('x'))).toEqual(['111', '222']);
  });
});

describe('the Rectangle tool on the canvas', () => {
  let host: HTMLDivElement, root: Root;
  const render = () => act(() => root.render(createElement(Stage, { sessionId: sid, doc: doc(), selectedCurve: null, setSelectedCurve: () => undefined })));
  const dragRect = (x0: number, y0: number, x1: number, y1: number) => {
    const canvas = host.querySelector('canvas.stage-canvas')!;
    const fire = (type: string, x: number, y: number) => act(() => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' })));
    fire('pointerdown', x0, y0); fire('pointermove', x1, y1); fire('pointerup', x1, y1);
    render();
  };
  beforeEach(() => {
    vi.stubGlobal('DOMMatrix', class { translate() { return this; } });
    vi.stubGlobal('Path2D', class { addPath() {} moveTo() {} lineTo() {} closePath() {} rect() {} ellipse() {} arc() {} });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
    HTMLElement.prototype.setPointerCapture = () => undefined;
    setUi({ tool: 'rect', showGuides: false });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    render();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  it('two drags draw two rectangles in the same layer; with an image layer active the next one opens a new layer', () => {
    dragRect(100, 100, 200, 180);
    dragRect(300, 100, 400, 180);
    expect(vectors().length).toBe(1);
    expect(vectors()[0].shapes.length).toBe(2);
    expect(objectPicks(docId)).toEqual([{ layerId: vectors()[0].id, ids: [vectors()[0].shapes[1].id] }]);
    addEmptyLayer(sid, docId, 'raster');
    render();
    dragRect(100, 300, 200, 380);
    expect(vectors().length).toBe(2);
    expect(vectors().map((l) => l.shapes.length)).toEqual([2, 1]);
  });
});
