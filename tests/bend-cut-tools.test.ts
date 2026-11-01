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

import { PathNodes } from '../src/components/designer/PathNodes';
import { StrokeTools } from '../src/components/designer/StrokeTools';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { roundNode, sharpenNode } from '../src/engine/design/bendNode';
import { setNodeEditMode } from '../src/engine/design/nodeEditMode';
import { setObjectPick, setShapeEdit, useObjectSelection, useShapeEdit } from '../src/engine/design/objectSelection';
import { nodeHandles, parseSegs } from '../src/engine/design/pathNodes';
import { cutPickedStrokesAcross, editStrokes } from '../src/engine/design/strokeEdit';
import { cutStrokeAcross } from '../src/engine/design/strokeCut';
import { DEFAULT_STROKE_STYLE, newStroke } from '../src/engine/design/strokes';
import { useStore } from '../src/store/store';
import type { VectorLayer, VectorShape } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { setNodeEditMode('move'); useObjectSelection.setState({ byDoc: {} }); useShapeEdit.setState({ byDoc: {} }); });

const long = () => newStroke([[0, 0, 0.2], [100, 0, 0.8]], { ...DEFAULT_STROKE_STYLE, size: 4 }, false);

describe('Lineart cut across', () => {
  it('cuts at every crossing, interpolating x, y and pressure; new ends blunt, original ends keep the taper', () => {
    const s = { ...long(), taperStart: 3, taperEnd: 5 }, out = cutStrokeAcross(s, [25, -10], [25, 10]);
    expect(out).toHaveLength(2);
    expect(out[0].points[1].slice(0, 2)).toEqual([25, 0]); expect(out[0].points[1][2]).toBeCloseTo(0.35);
    expect([out[0].taperStart, out[0].taperEnd, out[1].taperStart, out[1].taperEnd]).toEqual([3, 0, 0, 5]);
    const wavy = newStroke([[0, 0, 0.5], [50, 40, 0.5], [100, 0, 0.5], [150, 40, 0.5]], DEFAULT_STROKE_STYLE, false);
    expect(cutStrokeAcross(wavy, [-10, 20], [200, 20])).toHaveLength(4);
  });
  it('a line that misses (or only grazes the end) changes nothing', () => {
    const s = long();
    expect(cutStrokeAcross(s, [25, 5], [25, 20])[0]).toBe(s);
    expect(cutStrokeAcross(s, [100, -5], [100, 5])[0]).toBe(s);
    expect(cutStrokeAcross(s, [0, -5], [0, 5])[0]).toBe(s);
  });
  it('picked strokes: pieces stay picked, one undo step, a miss records nothing', () => {
    const sid = useStore.getState().activeSessionId, a = long(), layer = { ...newVectorLayer('Lineart 4'), strokes: [a] } as VectorLayer;
    const doc = { ...createDoc('t', 200, 200), layers: [layer], activeLayerId: layer.id };
    addDoc(sid, doc);
    editStrokes(doc.id, layer.id, [a.id]);
    const strokes = () => (getDoc(sid, doc.id)!.layers[0] as VectorLayer).strokes!;
    expect(cutPickedStrokesAcross(sid, doc.id, layer.id, [50, 20], [50, 40])).toBe(false);
    expect(strokes()).toHaveLength(1);
    expect(cutPickedStrokesAcross(sid, doc.id, layer.id, [30, -9], [30, 9])).toBe(true);
    expect(strokes()).toHaveLength(2);
    expect(useObjectSelection.getState().byDoc[doc.id]!.ids).toEqual(strokes().map((s) => s.id));
    undoDoc(sid, doc.id);
    expect(strokes()).toHaveLength(1);
  });
  it('the overlay shows the cut mark in Cut mode and the influence ring in Bend mode', async () => {
    const sid = useStore.getState().activeSessionId, a = long(), layer = { ...newVectorLayer('Lineart 4'), strokes: [a] } as VectorLayer;
    const doc = { ...createDoc('t', 200, 200), layers: [layer], activeLayerId: layer.id };
    addDoc(sid, doc);
    editStrokes(doc.id, layer.id, [a.id]);
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host), view = { x: 0, y: 0, zoom: 1, width: 800, height: 600 } as never;
    const show = async (mode: 'cut' | 'bend') => { setNodeEditMode(mode); await act(async () => root.render(createElement(StrokeTools, { view, sessionId: sid, doc: getDoc(sid, doc.id)! }))); };
    const hover = async () => act(async () => { host.querySelector('svg')!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 2, clientY: 3 })); });
    await show('cut'); await hover();
    expect(host.querySelector('.cut-mark')).not.toBeNull();
    expect(host.querySelector('.cut-dot')).not.toBeNull();
    await show('bend'); await hover();
    expect(host.querySelector('.cut-mark')).toBeNull();
    expect(host.querySelector('.influence-ring')).not.toBeNull();
    expect(host.querySelector('.influence-dot')).not.toBeNull();
    await act(async () => root.unmount()); host.remove();
  });
});

describe('Path bend: node', () => {
  const poly = () => parseSegs('M 20 100 L 100 100 L 180 100');
  it('round: mirrored handles on a node between straight segments, node turns symmetric', () => {
    const r = roundNode(poly(), 1, 0, 30), h = nodeHandles(r.segs, 1);
    expect(r.type).toBe('z');
    expect(r.segs[r.segs.length - 1].c).toBe('C');
    expect(r.segs[h.out![0]].p[h.out![1]]).toEqual([100, 130]);
    expect(r.segs[h.in![0]].p[h.in![1]]).toEqual([100, 70]);
  });
  it('sharpen: handles retract onto the node; a sharp node gives null', () => {
    const r = roundNode(poly(), 1, 0, 30), s = sharpenNode(r.segs, 1)!, h = nodeHandles(s, 1);
    expect(s[h.out![0]].p[h.out![1]]).toEqual([100, 100]);
    expect(s[h.in![0]].p[h.in![1]]).toEqual([100, 100]);
    expect(sharpenNode(poly(), 1)).toBeNull();
  });
});

describe('Path bend: mounted', () => {
  function mount() {
    const sid = useStore.getState().activeSessionId;
    const shape = { type: 'path', d: 'M 20 100 L 100 100 L 180 100', box0: { x: 20, y: 100, w: 160, h: 0 }, x: 20, y: 100, w: 160, h: 0, fill: null, stroke: '#000000', strokeWidth: 2, radius: 0 } as VectorShape;
    const layer = newVectorLayer('s', [shape]), doc = { ...createDoc('t', 200, 200), layers: [layer], activeLayerId: layer.id };
    addDoc(sid, doc);
    const cur = () => (getDoc(sid, doc.id)!.layers[0] as VectorLayer).shapes[0];
    setObjectPick(doc.id, { layerId: layer.id, ids: [cur().id] });
    setShapeEdit(doc.id, { layerId: layer.id, shapeId: cur().id });
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host), view = { x: 0, y: 0, zoom: 1, width: 800, height: 600 } as never;
    const render = async () => act(async () => root.render(createElement(PathNodes, { view, sessionId: sid, docId: doc.id, layerId: layer.id, shape: cur() })));
    const fire = async (el: Element, type: string, x: number, y: number) => act(async () => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })); });
    return { sid, doc, host, render, fire, cur, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
  }
  Element.prototype.setPointerCapture = () => {};
  const node = (host: HTMLElement) => host.querySelector('[data-node="1"]')!;

  it('hovering a segment in Bend mode highlights it; Move mode does not', async () => {
    const t = mount();
    setNodeEditMode('bend'); await t.render();
    expect(t.host.querySelector('.bend-hl')).toBeNull();
    await t.fire(t.host.querySelector('.segment-hit')!, 'pointermove', 60, 102);
    expect(t.host.querySelector('.bend-hl')).not.toBeNull();
    setNodeEditMode('move'); await t.render();
    expect(t.host.querySelector('.bend-hl')).toBeNull();
    await t.unmount();
  });
  it('dragging a node pulls mirrored handles out; one undo step; a click then makes it sharp, one more step', async () => {
    const t = mount();
    setNodeEditMode('bend'); await t.render();
    await t.fire(node(t.host), 'pointerdown', 100, 100);
    await t.fire(node(t.host), 'pointermove', 100, 120);
    await t.fire(node(t.host), 'pointermove', 100, 130);
    await t.fire(node(t.host), 'pointerup', 100, 130);
    const segs = parseSegs(t.cur().d!), h = nodeHandles(segs, 1);
    expect(segs[h.out![0]].p[h.out![1]]).toEqual([100, 130]);
    expect(segs[h.in![0]].p[h.in![1]]).toEqual([100, 70]);
    expect(t.cur().nodeTypes?.[1]).toBe('z');
    await t.render();
    await t.fire(node(t.host), 'pointerdown', 100, 100);
    await t.fire(node(t.host), 'pointerup', 100, 100);
    const sharp = parseSegs(t.cur().d!), hs = nodeHandles(sharp, 1);
    expect(sharp[hs.out![0]].p[hs.out![1]]).toEqual([100, 100]);
    expect(sharp[hs.in![0]].p[hs.in![1]]).toEqual([100, 100]);
    expect(t.cur().nodeTypes?.[1]).toBe('c');
    undoDoc(t.sid, t.doc.id);
    expect(nodeHandles(parseSegs(t.cur().d!), 1).out).toBeDefined();
    expect(parseSegs(t.cur().d!).some((g) => g.c === 'C' && g.p[0][1] === 130)).toBe(true);
    undoDoc(t.sid, t.doc.id);
    expect(t.cur().d).toBe('M 20 100 L 100 100 L 180 100');
    await t.unmount();
  });
  it('a click on a sharp node records no undo step', async () => {
    const t = mount();
    setNodeEditMode('bend'); await t.render();
    await t.fire(node(t.host), 'pointerdown', 100, 100);
    await t.fire(node(t.host), 'pointerup', 100, 100);
    expect(t.cur().d).toBe('M 20 100 L 100 100 L 180 100');
    await t.unmount();
  });
});
