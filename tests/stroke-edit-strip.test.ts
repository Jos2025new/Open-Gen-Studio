// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { ToolDock } from '../src/components/designer/ToolDock';
import { addDoc, getDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { setObjectPick, useObjectSelection, useShapeEdit } from '../src/engine/design/objectSelection';
import { cutPickedStrokes, editStrokes, erasePickedStrokes } from '../src/engine/design/strokeEdit';
import { DEFAULT_STROKE_STYLE, newStroke } from '../src/engine/design/strokes';
import { useNodeEditMode } from '../src/engine/design/nodeEditMode';
import { useStore } from '../src/store/store';
import type { DesignDoc, VectorLayer } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { useStore.setState({ ui: initialUi }); useObjectSelection.setState({ byDoc: {} }); useShapeEdit.setState({ byDoc: {} }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fresh() {
  useStore.setState({ ui: { ...initialUi, tool: 'move' } });
  const sid = useStore.getState().activeSessionId, stroke = newStroke([[0, 0, 0.5], [50, 0, 0.5], [100, 0, 0.5]], DEFAULT_STROKE_STYLE, false);
  const layer = { ...newVectorLayer('Lineart 4'), strokes: [stroke] } as VectorLayer;
  const doc = { ...createDoc('t', 200, 200), layers: [layer], activeLayerId: layer.id };
  addDoc(sid, doc);
  setObjectPick(doc.id, { layerId: layer.id, ids: [stroke.id] });
  const strokes = () => (getDoc(sid, doc.id)!.layers[0] as VectorLayer).strokes!;
  return { sid, doc, layer, stroke, strokes };
}
async function mount(sid: string, docId: string, host: HTMLElement) {
  const root = createRoot(host);
  const render = async () => act(async () => root.render(createElement(ToolDock, { sessionId: sid, doc: getDoc(sid, docId) as DesignDoc })));
  await render();
  return { render, unmount: async () => act(async () => root.unmount()) };
}

it('a picked Lineart stroke shows colour, size and Edit nodes; Edit nodes opens Move, Bend, Cut, Erase and Done (no Lasso or More)', async () => {
  const t = fresh();
  const host = document.createElement('div'); document.body.append(host);
  const m = await mount(t.sid, t.doc.id, host);
  const strip = () => host.querySelector('.tool-dock-strip .context-strip.context-row')!;
  for (const w of ['Lineart 4', 'Color', 'Size', 'Edit nodes']) expect(strip().textContent).toContain(w);
  const edit = [...strip().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Edit nodes')!;
  await act(async () => edit.click());
  await m.render();
  expect(useShapeEdit.getState().byDoc[t.doc.id]?.strokes).toBe(true);
  for (const w of ['Lineart 4', 'Move', 'Bend', 'Cut', 'Erase', 'Done']) expect(strip().textContent).toContain(w);
  for (const w of ['Lasso', 'More', 'Edit nodes']) expect(strip().textContent).not.toContain(w);
  const radio = (n: string) => [...strip().querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === n)!;
  await act(async () => radio('Cut').click());
  expect(useNodeEditMode.getState().mode).toBe('cut');
  expect(radio('Cut').classList.contains('is-active')).toBe(true);
  await act(async () => strip().querySelector<HTMLButtonElement>('.node-done')!.click());
  expect(useShapeEdit.getState().byDoc[t.doc.id]).toBeUndefined();
  expect(useNodeEditMode.getState().mode).toBe('move');
  await m.unmount(); host.remove();
});

it('Cut and Erase on the picked strokes: both pieces stay picked, a miss records nothing', () => {
  const t = fresh();
  editStrokes(t.doc.id, t.layer.id, [t.stroke.id]);
  const before = t.strokes();
  expect(cutPickedStrokes(t.sid, t.doc.id, t.layer.id, 25, 40, 5)).toBe(false);
  expect(t.strokes()).toBe(before);
  expect(cutPickedStrokes(t.sid, t.doc.id, t.layer.id, 25, 1, 5)).toBe(true);
  expect(t.strokes()).toHaveLength(2);
  expect(useObjectSelection.getState().byDoc[t.doc.id]!.ids).toEqual(t.strokes().map((s) => s.id));
  expect(useShapeEdit.getState().byDoc[t.doc.id]?.strokes).toBe(true);
  expect(erasePickedStrokes(t.sid, t.doc.id, t.layer.id, [0, 90], 5, true)).toBe(false);
  expect(erasePickedStrokes(t.sid, t.doc.id, t.layer.id, [75, 0], 10, true)).toBe(true);
  expect(t.strokes()).toHaveLength(3);
  expect(useObjectSelection.getState().byDoc[t.doc.id]!.ids).toHaveLength(3);
});
