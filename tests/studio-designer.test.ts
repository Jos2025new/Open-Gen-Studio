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

import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudioBoard } from '../src/components/studio/StudioBoard';
import { EMBEDDED_TOOLS } from '../src/components/studio/EmbeddedDesigner';
import { Stage } from '../src/components/designer/Stage';
import { getStudioBoard, reloadStudioBoard, setStudioBoard } from '../src/lib/studioBoard';
import { addEmptyLayer, newBlankDoc } from '../src/engine/design/actions';
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => noop) as never);
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

describe('the Designer view of the Studio board', () => {
  it('is enabled, mounts the embedded Designer with only pick/pan, undo and zoom, and keeps the workspace', () => {
    setStudioBoard({ view: 'assets' });
    render(createElement(StudioBoard));
    const tab = [...host.querySelectorAll<HTMLButtonElement>('.studio-view')][2];
    expect(tab.textContent).toBe('Designer');
    expect(tab.disabled).toBe(false);
    const ws = useStore.getState().ui.workspace;
    act(() => tab.click());
    expect(getStudioBoard().view).toBe('designer');
    expect(useStore.getState().ui.workspace).toBe(ws);
    expect(q('.studio-designer .stage')).not.toBeNull();
    for (const label of ['Select and move', 'Pan', 'Undo', 'Redo', 'Zoom in', 'Zoom out', 'Fit canvas']) expect(q(`[aria-label="${label}"]`), label).not.toBeNull();
    for (const sel of ['.tool-rail', '.designer-palette', '.layers-panel', '.document-picker']) expect(q(sel), sel).toBeNull();
    expect(host.textContent).not.toContain('Export');
    expect([...EMBEDDED_TOOLS]).toEqual(['move', 'hand']);
  });
  it('lists the layers: the eye hides one, a click makes it the active layer', () => {
    addEmptyLayer(sid, doc().id, 'raster');
    const second = addEmptyLayer(sid, doc().id, 'raster')!;
    setStudioBoard({ view: 'designer' });
    render(createElement(StudioBoard));
    const rows = host.querySelectorAll('.studio-layer');
    expect(rows.length).toBe(doc().layers.length);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    act(() => q('.studio-layer [aria-label^="Hide"]')!.click());
    expect(doc().layers.filter((l) => !l.visible).length).toBe(1);
    act(() => host.querySelectorAll<HTMLElement>('.studio-layer-name')[rows.length - 1].click());
    expect(doc().activeLayerId).not.toBe(second);
  });
  it('a tool left over from the full Designer is replaced by pick and move', () => {
    setUi({ tool: 'brush' });
    setStudioBoard({ view: 'designer' });
    render(createElement(StudioBoard));
    expect(useStore.getState().ui.tool).toBe('move');
  });
  it('without a design it says so instead of mounting a stage', () => {
    useStore.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], docs: [], activeDocId: null } } }));
    setStudioBoard({ view: 'designer' });
    render(createElement(StudioBoard));
    expect(q('.stage')).toBeNull();
    expect(host.textContent).toContain('No design in this session yet');
  });
});

describe('keyboard scope', () => {
  const press = (target: EventTarget, init: KeyboardEventInit) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });
  it('Ctrl+Z typed in the chat composer does not reach the board; after pressing inside the board it does', () => {
    setStudioBoard({ view: 'designer' });
    const chat = document.createElement('textarea');
    document.body.append(chat);
    render(createElement(StudioBoard));
    act(() => chat.focus());
    press(chat, { key: 'z', ctrlKey: true });
    expect(keys.designerKey).not.toHaveBeenCalled();
    act(() => { q('.studio-designer-bar')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    press(document.body, { key: 'z', ctrlKey: true });
    expect(keys.designerKey).toHaveBeenCalledTimes(1);
    expect(keys.designerKey.mock.calls[0][3]).toBe(EMBEDDED_TOOLS);
    act(() => { chat.blur(); chat.focus(); });
    press(chat, { key: 'Delete' });
    expect(keys.designerKey).toHaveBeenCalledTimes(1);
    chat.remove();
  });
  it('the embedded key set never opens another tool or the rulers', async () => {
    const real = await vi.importActual<typeof import('../src/components/designer/designerKeys')>('../src/components/designer/designerKeys');
    setUi({ tool: 'move', rulers: false });
    const d = doc();
    real.designerKey(new KeyboardEvent('keydown', { key: 'b' }), sid, d, EMBEDDED_TOOLS);
    real.designerKey(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }), sid, d, EMBEDDED_TOOLS);
    expect(useStore.getState().ui.tool).toBe('move');
    expect(useStore.getState().ui.rulers).toBeFalsy();
    real.designerKey(new KeyboardEvent('keydown', { key: 'R', shiftKey: true }), sid, d);
    expect(useStore.getState().ui.rulers).toBe(true);
    setUi({ rulers: false });
  });
});

describe('Stage fit reserve', () => {
  const zoomWith = (board?: { bottom: number }) => {
    seenZoom = [];
    render(createElement(Stage, { sessionId: sid, doc: doc(), selectedCurve: null, setSelectedCurve: () => undefined, board: board && { scope: createRef<HTMLElement>(), ...board } }));
    return seenZoom[seenZoom.length - 1];
  };
  it('comes from the props: a small reserve fits larger than the composer default', () => {
    const embedded = zoomWith({ bottom: 12 });
    act(() => root.render(createElement('div')));
    const full = zoomWith();
    act(() => root.render(createElement('div')));
    const tall = zoomWith({ bottom: 200 });
    expect(embedded).toBeCloseTo((600 - 48) / 1000, 3);
    expect(tall).toBeCloseTo((600 - 24 - 200) / 1000, 2);
    expect(embedded).toBeGreaterThan(full);
    expect(full).toBeGreaterThan(tall);
  });
});
