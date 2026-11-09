// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined,
}));
vi.mock('../src/engine/design/viewCoordinates', async (original) => ({
  ...await original<typeof import('../src/engine/design/viewCoordinates')>(),
  screenToDocument: (p: { x: number; y: number }) => p,
}));
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Stage } from '../src/components/designer/Stage';
import { addEmptyLayer, newBlankDoc, patchLayer, setActiveLayer } from '../src/engine/design/actions';
import { setObjectPick, objectPicks } from '../src/engine/design/objectSelection';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, sid: string, docId: string, layerId: string;
const doc = () => useStore.getState().sessions[sid].docs.find((d) => d.id === docId)!;
const currentLayer = () => { const l = doc().layers.find((item) => item.id === layerId); if (!l || l.type !== 'vector') throw new Error('Missing vector layer'); return l; };
beforeEach(() => {
  const ctx: unknown = new Proxy({ globalAlpha: 1, lineWidth: 1 }, { get: (t, k) => (k in t ? t[k as keyof typeof t] : k === 'canvas' ? document.createElement('canvas') : k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : k === 'measureText' ? () => ({ width: 0 }) : () => ctx), set: (t, k, v) => { (t as Record<PropertyKey, unknown>)[k] = v; return true; } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  vi.stubGlobal('DOMMatrix', class { translate() { return this; } });
  vi.stubGlobal('Path2D', class { addPath() {} moveTo() {} lineTo() {} closePath() {} rect() {} ellipse() {} arc() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  HTMLElement.prototype.setPointerCapture = () => undefined;
  sid = useStore.getState().activeSessionId;
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], docs: [], activeDocId: null } } }));
  docId = newBlankDoc(sid, { label: 'Square', width: 1000, height: 1000 }).id;
  layerId = addEmptyLayer(sid, docId, 'vector')!;
  const shape = (id: string, x: number) => ({ id, groupId: 'g', type: 'rect' as const, x, y: 200, w: 100, h: 100, radius: 0, fill: '#000', stroke: null, strokeWidth: 0 });
  patchLayer(sid, docId, layerId, { shapes: [shape('a', 200), shape('b', 400)], objectGroups: [{ id: 'g', name: 'Group' }] });
  setActiveLayer(sid, docId, layerId);
  setUi({ tool: 'move', selectMode: 'objects', showGuides: false });
  setObjectPick(docId, { layerId, ids: ['a', 'b'] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(Stage, { sessionId: sid, doc: doc(), selectedCurve: null, setSelectedCurve: () => undefined })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('group selection on canvas', () => {
  it('moves both selected group members on Ctrl-drag', () => {
    const canvas = host.querySelector('canvas.stage-canvas')!;
    const fire = (type: string, x: number) => act(() => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: 240, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', ctrlKey: true, altKey: true })));
    fire('pointerdown', 240); fire('pointermove', 290); fire('pointerup', 290);
    expect(currentLayer().shapes.map((s) => s.x)).toEqual([250, 450]);
    expect(objectPicks(docId)[0].ids).toEqual(['a', 'b']);
  });
});
