// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
vi.mock('../src/engine/design/viewCoordinates', async (original) => ({ ...await original<typeof import('../src/engine/design/viewCoordinates')>(), screenToDocument: (p: { x: number; y: number }) => p }));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Stage } from '../src/components/designer/Stage';
import { addEmptyLayer, getDoc, newBlankDoc } from '../src/engine/design/actions';
import { objectPicks } from '../src/engine/design/objectSelection';
import { getSelection } from '../src/engine/design/pixelSelection';
import { activeRuler } from '../src/engine/design/strokeRuler';
import { setBuffer } from '../src/engine/design/raster';
import type { DesignTool } from '../src/engine/design/rules';
import { setUi, useStore } from '../src/store/store';
import type { VectorLayer } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let sid: string, docId: string;
const doc = () => getDoc(sid, docId)!;
const vectors = () => doc().layers.filter((l): l is VectorLayer => l.type === 'vector');
const ctx: unknown = new Proxy({ globalAlpha: 1, lineWidth: 1 }, { get: (t, k) => (k in t ? t[k as keyof typeof t] : k === 'canvas' ? document.createElement('canvas') : k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : k === 'measureText' ? () => ({ width: 0 }) : k === 'getImageData' ? (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }) : () => ctx), set: (t, k, v) => { (t as Record<PropertyKey, unknown>)[k] = v; return true; } });
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  sid = useStore.getState().activeSessionId;
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], docs: [], activeDocId: null } } }));
  docId = newBlankDoc(sid, { label: 'Square', width: 1000, height: 1000 }).id;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

let host: HTMLDivElement;
let root: Root;
const queried = (selector: string) => host.querySelector<HTMLElement>(selector)!;
function render(tool: DesignTool) {
  setUi({ tool, showGuides: false });
  act(() => root.render(createElement(Stage, { sessionId: sid, doc: doc(), selectedCurve: null, setSelectedCurve: () => undefined })));
}

function pointer(target: Element, type: string, x: number, y: number) {
  act(() => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse',
  })));
}

function drag(target = queried('canvas.stage-canvas'), afterDown?: () => void) {
  pointer(target, 'pointerdown', 100, 110);
  afterDown?.();
  pointer(target, 'pointermove', 200, 180);
  pointer(target, 'pointerup', 200, 180);
}

beforeEach(() => {
  vi.stubGlobal('DOMMatrix', class { translate() { return this; } });
  vi.stubGlobal('Path2D', class { addPath() {} moveTo() {} lineTo() {} closePath() {} rect() {} ellipse() {} arc() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  HTMLElement.prototype.setPointerCapture = () => undefined;
  SVGElement.prototype.setPointerCapture = () => undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it.each([
  ['rect', 'rect'], ['ellipse', 'ellipse'], ['line', 'line'], ['polygon', 'path'], ['star', 'path'],
  ['sector', 'path'], ['arc', 'path'], ['chord', 'path'], ['curve', 'path'], ['arrow', 'path'],
] as const)('%s commits and picks a %s on release', (tool, type) => {
  render(tool);
  drag(undefined, () => expect(vectors().flatMap((layer) => layer.shapes)).toHaveLength(0));
  const shapes = vectors().flatMap((layer) => layer.shapes);
  expect(shapes.map((shape) => shape.type)).toEqual([type]);
  expect(objectPicks(docId).flatMap((pick) => pick.ids)).toEqual([shapes[0].id]);
});

it('move drags a picked object', () => {
  render('rect');
  drag();
  render('move');
  const canvas = queried('canvas.stage-canvas');
  pointer(canvas, 'pointerdown', 150, 140);
  pointer(canvas, 'pointermove', 240, 250);
  pointer(canvas, 'pointerup', 240, 250);
  expect(vectors()[0].shapes[0]).toMatchObject({ x: 190, y: 220 });
});

it('hand pans the Stage without editing the document', () => {
  const before = doc();
  render('hand');
  const canvas = queried('canvas.stage-canvas');
  expect(canvas.style.cursor).toBe('grab');
  drag(canvas);
  expect(doc()).toBe(before);
});

it('select creates a pixel region on release', () => {
  setUi({ selectShape: 'rect' });
  render('select');
  drag(undefined, () => expect(getSelection(docId)).toBeFalsy());
  expect(getSelection(docId)).toBeTruthy();
});

it('text opens an editor on press and leaves it open through release', () => {
  render('text');
  drag(undefined, () => {
    expect(doc().layers.filter((l) => l.type === 'text')).toHaveLength(1);
    render('text');
    expect(queried('textarea')).toBeTruthy();
  });
  expect(queried('textarea')).toBeTruthy();
});

it('lineart commits all points of a stroke', () => {
  setUi({ lineartMode: 'draw' });
  render('lineart');
  drag(undefined, () => expect(vectors().flatMap((layer) => layer.strokes ?? [])).toHaveLength(0));
  const strokes = vectors().flatMap((layer) => layer.strokes ?? []);
  expect(strokes).toHaveLength(1);
  expect(strokes[0].points.length).toBeGreaterThan(1);
});

it('gradient commits a layer on release', () => {
  render('gradient');
  const count = doc().layers.length;
  drag(undefined, () => expect(doc().layers).toHaveLength(count));
  expect(doc().layers).toHaveLength(count + 1);
});

it('eyedropper keeps the sampled color on release', () => {
  setUi({ brush: { ...useStore.getState().ui.brush, color: '#123456', sampleSource: 'all' } });
  render('eyedropper');
  drag(undefined, () => expect(useStore.getState().ui.brush.color).toBe('#123456'));
  expect(useStore.getState().ui.brush.color).toBe('#ffffff');
});

it('fill acts on press, and moving and releasing add no second layer', () => {
  render('fill');
  const count = doc().layers.length;
  drag(undefined, () => expect(doc().layers).toHaveLength(count + 1));
  expect(doc().layers).toHaveLength(count + 1);
});

it.each(['brush', 'eraser'] as const)('%s commits the active raster gesture on release', (tool) => {
  const layerId = addEmptyLayer(sid, docId, 'raster')!;
  setBuffer(layerId, document.createElement('canvas'), false);
  render(tool);
  const rev = () => {
    const layer = doc().layers.find((l) => l.id === layerId);
    return layer?.type === 'raster' ? layer.rev : -1;
  };
  const before = rev();
  drag();
  expect(rev()).toBeGreaterThan(before);
});

it('ruler stores both ends of a guide from its overlay', () => {
  render('ruler');
  drag(queried('svg.stroke-ruler'));
  expect(activeRuler(docId)).toMatchObject({ a: { x: 100, y: 110 }, b: { x: 200, y: 180 } });
});

it('shape builder leaves a bare-canvas drag to its own overlay', () => {
  render('shapeBuilder');
  const before = doc();
  drag();
  expect(doc()).toBe(before);
});
