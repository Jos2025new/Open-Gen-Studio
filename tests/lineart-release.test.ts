// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));
const keys = vi.hoisted(() => ({ designerKey: vi.fn() }));
vi.mock('../src/components/designer/designerKeys', async (orig) => ({ ...(await orig<typeof import('../src/components/designer/designerKeys')>()), designerKey: keys.designerKey }));
const file = vi.hoisted(() => ({ importDesignFiles: vi.fn(async () => undefined), runDesignOutput: vi.fn(async () => undefined) }));
vi.mock('../src/components/designer/designerFile', async (orig) => ({ ...(await orig<typeof import('../src/components/designer/designerFile')>()), ...file }));
const upload = vi.hoisted(() => ({ uploadFiles: vi.fn(async () => [] as string[]) }));
vi.mock('../src/engine/actions', async (orig) => ({ ...(await orig<typeof import('../src/engine/actions')>()), ...upload }));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Stage } from '../src/components/designer/Stage';
import { reloadStudioBoard } from '../src/lib/studioBoard';
import { addEmptyLayer, newBlankDoc, patchLayer, setActiveLayer } from '../src/engine/design/actions';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let sid: string;
const q = (s: string) => host.querySelector<HTMLElement>(s);
const render = (el: ReturnType<typeof createElement>) => act(() => root.render(el));
const doc = () => { const s = useStore.getState().sessions[sid]; return s.docs.find((d) => d.id === s.activeDocId)!; };
let seenZoom: number[] = [];
const onView = (e: Event) => seenZoom.push((e as CustomEvent<number>).detail);

beforeEach(() => {
  const noop: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'canvas' ? document.createElement('canvas') : k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : noop), apply: () => noop, set: () => true });
  const store: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1 };
  const ctx: unknown = new Proxy(store, { get: (t, k) => (k in t ? t[k as string] : k === 'canvas' ? document.createElement('canvas') : k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : k === 'measureText' ? () => ({ width: 0 }) : () => ctx), set: (t, k, v) => { t[k as string] = v; return true; } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  vi.stubGlobal('DOMMatrix', class { translate() { return this; } });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  localStorage.clear(); reloadStudioBoard();
  sid = useStore.getState().activeSessionId;
  useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], docs: [], activeDocId: null } } }));
  newBlankDoc(sid, { label: 'Square', width: 1000, height: 1000 });
  seenZoom = [];
  window.addEventListener('ogs:designer-view', onView);
  keys.designerKey.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { window.removeEventListener('ogs:designer-view', onView); act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });


describe('Lineart stroke release', () => {
  it('keeps the stroke after release', () => {
    HTMLElement.prototype.setPointerCapture = () => undefined;
    vi.stubGlobal('Path2D', class { addPath() {} moveTo() {} lineTo() {} closePath() {} rect() {} ellipse() {} arc() {} });
    setUi({ tool: 'lineart' });
    const props = () => ({ sessionId: sid, doc: doc(), selectedCurve: null, setSelectedCurve: () => undefined });
    render(createElement(Stage, props()));
    const c = q('canvas.stage-canvas')!;
    const ev = (type: string, x: number, y: number) => act(() => { c.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' })); });
    ev('pointerdown', 200, 200); ev('pointermove', 260, 230); ev('pointermove', 320, 260); ev('pointerup', 320, 260);
    render(createElement(Stage, props()));
    const strokes = doc().layers.flatMap((l) => (l.type === 'vector' ? l.strokes ?? [] : []));
    expect(strokes.length).toBe(1);
  });
  it('a stroke drawn while the active vector layer is hidden lands on a visible layer, not in the hidden one', () => {
    HTMLElement.prototype.setPointerCapture = () => undefined;
    vi.stubGlobal('Path2D', class { addPath() {} moveTo() {} lineTo() {} closePath() {} rect() {} ellipse() {} arc() {} });
    const hidden = addEmptyLayer(sid, doc().id, 'vector')!;
    patchLayer(sid, doc().id, hidden, { visible: false });
    setActiveLayer(sid, doc().id, hidden);
    setUi({ tool: 'lineart' });
    render(createElement(Stage, { sessionId: sid, doc: doc(), selectedCurve: null, setSelectedCurve: () => undefined }));
    const c = q('canvas.stage-canvas')!;
    const ev = (type: string, x: number, y: number) => act(() => { c.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' })); });
    ev('pointerdown', 200, 200); ev('pointermove', 260, 230); ev('pointermove', 320, 260); ev('pointerup', 320, 260);
    const drawn = doc().layers.filter((l) => l.type === 'vector' && l.strokes?.length);
    expect(drawn.length).toBe(1);
    expect(drawn[0].visible).toBe(true);
    expect(doc().activeLayerId).toBe(drawn[0].id);
    // The notice says so and its button shows the skipped layer again.
    const notice = useStore.getState().ui.toasts.find((t) => t.text.includes('is hidden'));
    expect(notice?.action?.label).toBe('Show layer');
    act(() => notice!.action!.run());
    expect(doc().layers.find((l) => l.id === hidden)!.visible).toBe(true);
  });
});
