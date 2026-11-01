// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { ToolDock } from '../src/components/designer/ToolDock';
import { PathNodes } from '../src/components/designer/PathNodes';
import { chooseSelectMode } from '../src/components/designer/selectModeActions';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { editShape, setObjectPick, setShapeEdit, useObjectSelection, useShapeEdit } from '../src/engine/design/objectSelection';
import { resetNodeEditMode, setNodeEditMode, useNodeEditMode } from '../src/engine/design/nodeEditMode';
import { pageSegs, parseSegs } from '../src/engine/design/pathNodes';
import { deriveSel, edgesOf, facesOf, pickFace } from '../src/engine/design/selectMode';
import { useStore } from '../src/store/store';
import type { DesignDoc, VectorShape } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const initialUi = useStore.getState().ui;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Element.prototype.setPointerCapture = () => {};
});
afterEach(() => { useStore.setState({ ui: initialUi }); useObjectSelection.setState({ byDoc: {} }); useShapeEdit.setState({ byDoc: {} }); resetNodeEditMode(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Nodes 0-3: outer square · 4-7: its square hole · 8-11: a separate circle.
const D = 'M 0 0 L 100 0 L 100 100 L 0 100 Z M 30 30 L 30 70 L 70 70 L 70 30 Z M 230 50 C 230 66.57 216.57 80 200 80 C 183.43 80 170 66.57 170 50 C 170 33.43 183.43 20 200 20 C 216.57 20 230 33.43 230 50 Z';
const shapeSpec = { type: 'path', d: D, box0: { x: 0, y: 0, w: 230, h: 100 }, x: 0, y: 0, w: 230, h: 100, fill: '#ff0000', stroke: '#000000', strokeWidth: 2, radius: 0 };
function fresh() {
  useStore.setState({ ui: { ...initialUi, tool: 'move' } });
  const sid = useStore.getState().activeSessionId, layer = newVectorLayer('Shape 9', [shapeSpec as never]);
  const doc = { ...createDoc('t', 300, 200), layers: [layer], activeLayerId: layer.id };
  addDoc(sid, doc);
  const sh = (getDoc(sid, doc.id)!.layers[0] as { shapes: VectorShape[] }).shapes[0];
  setObjectPick(doc.id, { layerId: layer.id, ids: [sh.id] });
  editShape(doc.id, layer.id, sh.id);
  const shapes = () => (getDoc(sid, doc.id)!.layers[0] as { shapes: VectorShape[] }).shapes;
  return { sid, doc, layer, sh, shapes, edit: () => useShapeEdit.getState().byDoc[doc.id]! };
}
async function mountNodes(t: ReturnType<typeof fresh>) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const render = async () => act(async () => root.render(createElement(PathNodes, { view: { x: 0, y: 0, zoom: 1 }, sessionId: t.sid, docId: t.doc.id, layerId: t.layer.id, shape: t.shapes()[0] })));
  await render();
  const fire = async (type: string, x: number, y: number, extra: object = {}) => {
    const el = host.querySelector('.sel-hit')!;
    await act(async () => { el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, ...extra }), { pointerId: 1 })); });
    await render();
  };
  return { host, render, fire, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const key = async (k: string, target: EventTarget = document.body) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });

it('engine: segments are the edges (closing one included), faces the closed subpaths with their holes', () => {
  const segs = parseSegs(D);
  expect(edgesOf(segs).map((e) => [e.a, e.b])).toEqual([[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [8, 9], [9, 10], [10, 11], [11, 8]]);
  const faces = facesOf(segs);
  expect(faces.map((f) => [f.id, f.hole, f.holes, f.nodes.length])).toEqual([[0, false, [1], 8], [1, true, [], 4], [2, false, [], 4]]);
  expect(pickFace(faces, [10, 10])!.id).toBe(0);
  expect(pickFace(faces, [50, 50])!.id).toBe(1); // a click in the hole picks the hole contour itself
  expect(pickFace(faces, [200, 50])!.id).toBe(2);
  expect(pickFace(faces, [140, 50])).toBeNull();
});

it('mode conversion: node to segment keeps segments with both ends, node to face whole faces, back to node keeps the nodes', async () => {
  const t = fresh();
  setShapeEdit(t.doc.id, { ...t.edit(), node: 0, nodes: [0, 1, 2, 9] });
  chooseSelectMode(t.doc.id, t.shapes()[0], 'segment');
  expect(t.edit().segs).toEqual([0, 1]); expect(t.edit().nodes).toEqual([0, 1, 2]); // the lone node 9 is no segment
  chooseSelectMode(t.doc.id, t.shapes()[0], 'face');
  expect(t.edit().faces).toBeUndefined(); expect(t.edit().nodes).toEqual([]);
  setShapeEdit(t.doc.id, { ...t.edit(), node: 0, nodes: [0, 1, 2, 3, 4, 5, 6, 7] });
  chooseSelectMode(t.doc.id, t.shapes()[0], 'face');
  expect(t.edit().faces).toEqual([0]); // the hole belongs to the outer face
  chooseSelectMode(t.doc.id, t.shapes()[0], 'segment');
  expect(t.edit().segs).toHaveLength(8);
  chooseSelectMode(t.doc.id, t.shapes()[0], 'node');
  expect(t.edit().nodes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); expect(t.edit().segs).toBeUndefined();
  expect(deriveSel(edgesOf(pageSegs(t.shapes()[0])), [], 'node', [3, 1]).nodes).toEqual([1, 3]);
});

it('Segment mode: a click picks the segment (its two nodes), Shift adds, and a click on a segment again with Shift removes it', async () => {
  const t = fresh(); chooseSelectMode(t.doc.id, t.shapes()[0], 'segment');
  const m = await mountNodes(t);
  await m.fire('pointerdown', 50, 1); await m.fire('pointerup', 50, 1);
  expect(t.edit().nodes).toEqual([0, 1]); expect(t.edit().segs).toEqual([0]);
  expect(m.host.querySelectorAll('.sel-seg:not(.is-hover)')).toHaveLength(1);
  await m.fire('pointerdown', 99, 50, { shiftKey: true }); await m.fire('pointerup', 99, 50);
  expect(t.edit().segs).toEqual([0, 1]); expect(t.edit().nodes).toEqual([0, 1, 2]);
  await m.fire('pointerdown', 50, 0, { shiftKey: true }); await m.fire('pointerup', 50, 0);
  expect(t.edit().segs).toEqual([1]);
  await m.unmount();
});

it('Face mode: a click inside picks the face (with its holes), in the hole picks the hole, and the face fills with a tint', async () => {
  const t = fresh(); chooseSelectMode(t.doc.id, t.shapes()[0], 'face');
  const m = await mountNodes(t);
  await m.fire('pointerdown', 10, 10); await m.fire('pointerup', 10, 10);
  expect(t.edit().faces).toEqual([0]); expect(t.edit().nodes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(m.host.querySelector('.sel-face')).not.toBeNull();
  await m.fire('pointerdown', 50, 50); await m.fire('pointerup', 50, 50);
  expect(t.edit().faces).toEqual([1]); expect(t.edit().nodes).toEqual([4, 5, 6, 7]);
  await m.fire('pointerdown', 200, 50, { shiftKey: true }); await m.fire('pointerup', 200, 50);
  expect(t.edit().faces).toEqual([1, 2]); expect(t.edit().nodes).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  await m.unmount();
});

it('dragging a face moves only its nodes, in one undo step', async () => {
  const t = fresh(); chooseSelectMode(t.doc.id, t.shapes()[0], 'face');
  const m = await mountNodes(t);
  await m.fire('pointerdown', 10, 10);
  await m.fire('pointermove', 20, 15); await m.fire('pointermove', 30, 20); await m.fire('pointerup', 30, 20);
  const segs = pageSegs(t.shapes()[0]), before = parseSegs(D);
  expect(segs[0].p[0]).toEqual([20, 10]); // outer square moved by (20, 10)
  expect(segs[5].p[0]).toEqual([50, 40]); // so did its hole
  expect(segs.slice(10)).toEqual(before.slice(10)); // the circle did not
  undoDoc(t.sid, t.doc.id);
  expect(parseSegs(t.shapes()[0].d!)).toEqual(before);
  await m.unmount();
});

it('Delete removes the selected segments or the selected face with its holes, one undo step each', async () => {
  const t = fresh(); const m = await mountNodes(t);
  chooseSelectMode(t.doc.id, t.shapes()[0], 'segment'); await m.render();
  await m.fire('pointerdown', 50, 0); await m.fire('pointerup', 50, 0);
  await key('Delete'); await m.render();
  expect(t.shapes()[0].d!.match(/Z/g)).toHaveLength(2); // the square opened; hole and circle stay closed
  expect(parseSegs(t.shapes()[0].d!)[0].c).toBe('M');
  undoDoc(t.sid, t.doc.id);
  expect(parseSegs(t.shapes()[0].d!)).toEqual(parseSegs(D));
  chooseSelectMode(t.doc.id, t.shapes()[0], 'face'); await m.render();
  await m.fire('pointerdown', 10, 10); await m.fire('pointerup', 10, 10);
  await key('Delete'); await m.render();
  expect(t.shapes()[0].d!.match(/M/g)).toHaveLength(1); // only the circle is left
  expect(t.edit().nodes).toEqual([]);
  undoDoc(t.sid, t.doc.id);
  expect(parseSegs(t.shapes()[0].d!)).toEqual(parseSegs(D));
  await m.unmount();
});

it('keys 1 / 2 / 3 switch the element only with the board focused, in Move or Lasso, and reset to Node when editing starts', async () => {
  const t = fresh(); const m = await mountNodes(t);
  await key('2'); expect(useNodeEditMode.getState().select).toBe('segment');
  await key('3'); expect(useNodeEditMode.getState().select).toBe('face');
  const input = document.createElement('input'); document.body.append(input);
  await key('1', input); expect(useNodeEditMode.getState().select).toBe('face'); // typing in a field
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true })); });
  expect(useNodeEditMode.getState().select).toBe('face');
  setNodeEditMode('bend'); await m.render();
  await key('1'); expect(useNodeEditMode.getState().select).toBe('face'); // Bend works on nodes only
  setNodeEditMode('lasso'); await m.render();
  await key('1'); expect(useNodeEditMode.getState().select).toBe('node');
  await key('2'); setShapeEdit(t.doc.id, null); expect(useNodeEditMode.getState().select).toBe('node');
  input.remove(); await m.unmount();
});

it('the strip shows Node · Segment · Face with aria-checked, only in Move or Lasso', async () => {
  const t = fresh();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const render = async () => act(async () => root.render(createElement(ToolDock, { sessionId: t.sid, doc: getDoc(t.sid, t.doc.id) as DesignDoc })));
  await render();
  const radio = (n: string) => host.querySelector<HTMLButtonElement>(`.node-select [aria-label="${n}"]`);
  expect(radio('Node (1)')!.getAttribute('aria-checked')).toBe('true');
  expect(radio('Segment (2)')!.getAttribute('aria-checked')).toBe('false');
  await act(async () => radio('Segment (2)')!.click());
  expect(radio('Segment (2)')!.getAttribute('aria-checked')).toBe('true');
  expect(radio('Node (1)')!.getAttribute('aria-checked')).toBe('false');
  expect(radio('Face (3)')!.getAttribute('data-tip')).toContain('Face (3)');
  await act(async () => setNodeEditMode('cut'));
  expect(host.querySelector('.node-select')).toBeNull();
  await act(async () => root.unmount()); host.remove();
});
