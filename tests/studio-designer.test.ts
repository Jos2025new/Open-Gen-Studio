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
  it('is enabled, mounts the embedded Designer with a top bar and a bottom bar, and keeps the workspace', () => {
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
    for (const label of ['File', 'Undo', 'Redo', 'Zoom in', 'Zoom out', 'Fit canvas', 'Select and move', 'Pen', 'Edit', 'Eraser', 'Text', 'Layers']) expect(q(`[aria-label="${label}"]`), label).not.toBeNull();
    expect(q('[aria-label^="Pan"]')).not.toBeNull();
    // Top bar keeps: select · hand · undo · redo · zoom − · % · zoom + · fit; the bottom bar has no select/hand.
    expect([...document.querySelectorAll('.studio-designer-tools [aria-label]')].map((b) => b.getAttribute('aria-label'))).toEqual(['Select and move', 'Pan (or hold Space and drag)', 'Undo', 'Redo', 'Zoom out', 'Zoom in', 'Fit canvas']);
    expect(q('.studio-palette .tool-dock')).not.toBeNull();
    for (const sel of ['.designer-view', '.layers-panel', '.document-picker', '.studio-layers']) expect(q(sel), sel).toBeNull();
    expect(host.textContent).not.toContain('Export');
    expect([...EMBEDDED_TOOLS]).toEqual(expect.arrayContaining(['move', 'hand', 'lineart', 'eraser', 'text', 'rect', 'ellipse', 'line']));
    for (const no of ['brush', 'fill', 'select', 'ruler', 'eyedropper', 'gradient']) expect(EMBEDDED_TOOLS.has(no as never), no).toBe(false);
  });
  it('the Layers popover lists the layers: the eye hides one, a click makes it the active layer', () => {
    addEmptyLayer(sid, doc().id, 'raster');
    const second = addEmptyLayer(sid, doc().id, 'raster')!;
    setStudioBoard({ view: 'designer' });
    render(createElement(StudioBoard));
    expect(document.querySelector('.studio-layers')).toBeNull();
    act(() => q('[aria-label="Layers"]')!.click());
    const rows = document.querySelectorAll('.studio-layer');
    expect(rows.length).toBe(doc().layers.length);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    act(() => document.querySelector<HTMLElement>('.studio-layer [aria-label^="Hide"]')!.click());
    expect(doc().layers.filter((l) => !l.visible).length).toBe(1);
    act(() => document.querySelectorAll<HTMLElement>('.studio-layer-name')[rows.length - 1].click());
    expect(doc().activeLayerId).not.toBe(second);
  });
  it('the bottom bar is the ToolDock limited to the board\'s tools: families open variants and set the tool', () => {
    addEmptyLayer(sid, doc().id, 'raster');
    setStudioBoard({ view: 'designer' });
    render(createElement(StudioBoard));
    const tool = () => useStore.getState().ui.tool;
    const dock = () => q('.studio-palette .tool-dock')!;
    const pick = (label: string) => act(() => [...dock().querySelectorAll<HTMLElement>(`button[aria-label="${label}"]`)].at(-1)!.click());
    expect([...dock().querySelectorAll('[aria-label="Tools"] > span > button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Edit', 'Pen', 'Eraser', 'Text']);
    pick('Pen'); pick('Lineart');
    expect(tool()).toBe('lineart');
    expect(dock().querySelector('[aria-label="Pen variants"] button[aria-label="Bezier pen"]')).toBeNull();
    const bar = q('.studio-palette')!;
    expect(bar.querySelector('button[aria-haspopup][aria-label="Size"]')).toBeTruthy();
    expect(bar.querySelector('button[aria-label^="Color · "]')).toBeTruthy();
    act(() => (bar.querySelector('button[aria-haspopup][aria-label="Size"]') as HTMLElement).click());
    expect(bar.querySelector('button[aria-haspopup][aria-label="Size"]')!.getAttribute('aria-expanded')).toBe('true');
    pick('Eraser');
    expect(tool()).toBe('eraser');
    expect((bar.querySelector('button[aria-label="Color"]') as HTMLButtonElement | null)?.disabled).toBe(true);
    pick('Text');
    expect(tool()).toBe('text');
    pick('Edit'); pick('Rectangle');
    expect(tool()).toBe('rect');
    expect(dock().querySelector('[aria-label="Edit variants"] button[aria-label="Arrow"]')).not.toBeNull();
    for (const no of ['Brush', 'Ruler', 'Layout']) expect(dock().querySelector(`[aria-label="Tools"] button[aria-label="${no}"]`), no).toBeNull();
    act(() => q('[aria-label="Select and move"]')!.click());
    expect(tool()).toBe('move');
    act(() => q('[aria-label^="Pan"]')!.click());
    expect(tool()).toBe('hand');
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
    addEmptyLayer(sid, doc().id, 'raster');
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

describe('image paste, copy and cut', () => {
  const pasteImage = (target: EventTarget) => {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    act(() => { target.dispatchEvent(ev); });
  };
  it('paste works with focus inside the board and never from the chat composer or outside it', () => {
    setStudioBoard({ view: 'designer' });
    upload.uploadFiles.mockClear();
    const chat = document.createElement('textarea');
    document.body.append(chat);
    render(createElement(StudioBoard));
    act(() => chat.focus());
    pasteImage(chat);
    expect(upload.uploadFiles).not.toHaveBeenCalled();
    act(() => { chat.blur(); document.body.focus(); });
    pasteImage(document.body);
    expect(upload.uploadFiles).not.toHaveBeenCalled();
    act(() => { q('.studio-designer-bar')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    pasteImage(q('.studio-designer')!);
    expect(upload.uploadFiles).toHaveBeenCalledTimes(1);
    act(() => { chat.blur(); chat.focus(); });
    pasteImage(chat);
    expect(upload.uploadFiles).toHaveBeenCalledTimes(1);
    chat.remove();
  });
  it('copy is handled by the same Designer clipboard code, gated by the focus guard', async () => {
    const real = await vi.importActual<typeof import('../src/components/designer/designerClipboard')>('../src/components/designer/designerClipboard');
    const off = real.designerClipboard(sid, doc(), () => false);
    const ev = new Event('copy', { bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
    off();
  });
});

describe('file menu', () => {
  const menu = () => [...document.querySelectorAll<HTMLElement>('.popover [role="menuitem"], .popover button')];
  const item = (text: string) => menu().find((b) => b.textContent?.startsWith(text))!;
  beforeEach(() => { file.importDesignFiles.mockClear(); file.runDesignOutput.mockClear(); setStudioBoard({ view: 'designer' }); });
  it('is one icon with New, Open, Import image and Export', () => {
    render(createElement(StudioBoard));
    expect(menu().length).toBe(0);
    act(() => q('[aria-label="File"]')!.click());
    for (const t of ['New', 'Open', 'Import image', 'Export']) expect(item(t), t).toBeDefined();
  });
  it('New uses the presets and creates a design; Open lists the designs and selects one', () => {
    render(createElement(StudioBoard));
    act(() => q('[aria-label="File"]')!.click());
    act(() => item('New')!.click());
    const before = useStore.getState().sessions[sid].docs.length;
    act(() => item('Landscape')!.click());
    expect(useStore.getState().sessions[sid].docs.length).toBe(before + 1);
    const first = useStore.getState().sessions[sid].docs[0].id;
    act(() => q('[aria-label="File"]')!.click());
    act(() => item('Open')!.click());
    const choices = document.querySelectorAll<HTMLElement>('.popover .document-choice');
    expect(choices.length).toBe(before + 1);
    act(() => choices[0].click());
    expect(useStore.getState().sessions[sid].activeDocId).toBe(first);
  });
  it('Export and Save to gallery call the existing action; Import hands the files to the existing import', async () => {
    render(createElement(StudioBoard));
    act(() => q('[aria-label="File"]')!.click());
    act(() => item('Export')!.click());
    act(() => item('PNG')!.click());
    expect(file.runDesignOutput).toHaveBeenCalledWith(sid, doc().id, false, 'png');
    await act(async () => { await Promise.resolve(); });
    act(() => q('[aria-label="File"]')!.click());
    act(() => item('Save to gallery')!.click());
    expect(file.runDesignOutput).toHaveBeenCalledTimes(1);
    act(() => [...document.querySelectorAll<HTMLElement>('.popover button')].find((b) => b.textContent === 'Save')!.click());
    expect(file.runDesignOutput).toHaveBeenLastCalledWith(sid, doc().id, true, undefined);
    const input = q('input[type="file"]') as HTMLInputElement;
    const f = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(file.importDesignFiles).toHaveBeenCalledWith(sid, doc().id, [f]);
  });
});

describe('pending list', () => {
  it('records the keyboard layer delete that never runs, with file and line', async () => {
    const fs = await import('node:fs');
    const text = fs.readFileSync('docs/pendientes-gui.md', 'utf8');
    expect(text).toMatch(/designerKeys\.ts:\d+/);
    const line = Number(/designerKeys\.ts:(\d+)/.exec(text)![1]);
    expect(fs.readFileSync('src/components/designer/designerKeys.ts', 'utf8').split('\n')[line - 1]).toContain("e.key === 'Delete'");
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
