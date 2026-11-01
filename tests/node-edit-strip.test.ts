// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { ToolDock } from '../src/components/designer/ToolDock';
import { PathNodes } from '../src/components/designer/PathNodes';
import { addDoc, getDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { editShape, setObjectPick, useObjectSelection, useShapeEdit } from '../src/engine/design/objectSelection';
import { setNodeEditMode, useNodeEditMode } from '../src/engine/design/nodeEditMode';
import { useStore } from '../src/store/store';
import type { DesignDoc, VectorShape } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Element.prototype.setPointerCapture = () => {};
});
afterEach(() => { useStore.setState({ ui: initialUi }); useObjectSelection.setState({ byDoc: {} }); useShapeEdit.setState({ byDoc: {} }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const base = { box0: { x: 0, y: 0, w: 100, h: 60 }, x: 0, y: 0, w: 100, h: 60, fill: '#ff0000', stroke: '#000000', strokeWidth: 2, radius: 0 };
async function mount(sid: string, docId: string, host: HTMLElement) {
  const root = createRoot(host);
  const render = async () => act(async () => root.render(createElement(ToolDock, { sessionId: sid, doc: getDoc(sid, docId) as DesignDoc })));
  await render();
  return { render, unmount: async () => act(async () => root.unmount()) };
}
function fresh(shape: Record<string, unknown>) {
  useStore.setState({ ui: { ...initialUi, tool: 'move' } });
  const sid = useStore.getState().activeSessionId, layer = newVectorLayer('Shape 9', [shape as never]);
  const doc = { ...createDoc('t', 200, 200), layers: [layer], activeLayerId: layer.id };
  addDoc(sid, doc);
  const sh = (getDoc(sid, doc.id)!.layers[0] as { shapes: VectorShape[] }).shapes[0];
  setObjectPick(doc.id, { layerId: layer.id, ids: [sh.id] });
  const shapes = () => (getDoc(sid, doc.id)!.layers[0] as { shapes: VectorShape[] }).shapes;
  return { sid, doc, layer, sh, shapes };
}
const path = { ...base, type: 'path', d: 'M 0 0 L 100 0' };
const ellipse = { ...base, type: 'ellipse' };

it('selection strip: one row of object actions, no tool settings; the variant row hides until Edit is pressed', async () => {
  const t = fresh(path);
  const host = document.createElement('div'); document.body.append(host);
  const m = await mount(t.sid, t.doc.id, host);
  const strip = host.querySelector('.tool-dock-strip .context-strip.context-row')!;
  expect(strip).not.toBeNull();
  for (const w of ['Shape 9', 'Edit nodes']) expect(strip.textContent).toContain(w);
  for (const w of ['Auto-select', 'Influence', 'Settings…']) expect(strip.textContent).not.toContain(w);
  expect(host.querySelector('[aria-label="Edit variants"]')).toBeNull();
  const family = [...host.querySelectorAll<HTMLButtonElement>('.tool-dock-family button')].find((b) => b.getAttribute('aria-label') === 'Edit')!;
  await act(async () => family.click());
  expect(host.querySelector('[aria-label="Edit variants"]')).not.toBeNull();
  expect(host.querySelector('.tool-dock-strip')).toBeNull();
  await m.unmount(); host.remove();
});

it('node edit strip: name, five modes, More, Done; active mode has aria-checked and is-active; Done is primary', async () => {
  const t = fresh(path);
  editShape(t.doc.id, t.layer.id, t.sh.id);
  const host = document.createElement('div'); document.body.append(host);
  const m = await mount(t.sid, t.doc.id, host);
  const strip = host.querySelector('.tool-dock-strip .context-strip.context-row')!;
  const text = strip.textContent!;
  for (const w of ['Shape 9', 'Move', 'Bend', 'Cut', 'Erase', 'Lasso', 'More', 'Done']) expect(text).toContain(w);
  for (const w of ['Editing nodes', 'Settings…', 'Blur']) expect(text).not.toContain(w);
  expect(strip.querySelector('input')).toBeNull();
  const radio = (n: string) => [...strip.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === n)!;
  expect(radio('Move').getAttribute('aria-checked')).toBe('true');
  await act(async () => radio('Cut').click());
  expect(radio('Cut').getAttribute('aria-checked')).toBe('true');
  expect(radio('Cut').classList.contains('is-active')).toBe(true);
  expect(radio('Move').classList.contains('is-active')).toBe(false);
  expect(strip.querySelector('.node-done')!.classList.contains('is-primary')).toBe(true);
  await m.unmount(); host.remove();
});

it('Bend on an ellipse converts it to a path first (one undo step) and continues in that mode', async () => {
  const t = fresh(ellipse);
  editShape(t.doc.id, t.layer.id, t.sh.id);
  const host = document.createElement('div'); document.body.append(host);
  const m = await mount(t.sid, t.doc.id, host);
  const strip = () => host.querySelector('.tool-dock-strip')!;
  const radio = (n: string) => [...strip().querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === n)!;
  await act(async () => radio('Move').click());
  expect(t.shapes()[0].type).toBe('ellipse');
  await act(async () => radio('Bend').click());
  await m.render();
  expect(t.shapes()[0].type).toBe('path');
  expect(t.shapes()[0].prim).toBeUndefined();
  expect(useNodeEditMode.getState().mode).toBe('bend');
  expect(useShapeEdit.getState().byDoc[t.doc.id]?.shapeId).toBe(t.sh.id);
  await m.unmount(); host.remove();
});

it('Bend drag on a path segment changes the segment', async () => {
  const t = fresh({ ...path, h: 1, box0: { x: 0, y: 0, w: 100, h: 1 } });
  editShape(t.doc.id, t.layer.id, t.sh.id);
  setNodeEditMode('bend');
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(PathNodes, { view: { x: 0, y: 0, zoom: 1 }, sessionId: t.sid, docId: t.doc.id, layerId: t.layer.id, shape: t.shapes()[0] })));
  const hit = host.querySelector('.segment-hit')!;
  const fire = (type: string, el: Element, x: number, y: number) => el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }), { pointerId: 1 }));
  await act(async () => { fire('pointerdown', hit, 50, 0); });
  await act(async () => { fire('pointermove', hit, 50, 30); });
  const d = t.shapes()[0].d!;
  expect(d).toContain('C');
  expect(d).not.toBe('M 0 0 L 100 0');
  await act(async () => root.unmount()); host.remove();
});
