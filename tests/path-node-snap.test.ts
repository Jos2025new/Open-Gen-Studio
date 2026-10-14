// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { PathNodes } from '../src/components/designer/PathNodes';
import { createDoc } from '../src/engine/design/doc';
import { undo, redo, historyDepth, dropHistory } from '../src/engine/design/history';
import { pageSegs, nodeSegs } from '../src/engine/design/pathNodes';
import { setShapeEdit } from '../src/engine/design/objectSelection';
import { useStore } from '../src/store/store';
import type { DesignDoc, VectorLayer, VectorShape } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const path = (id: string, d: string): VectorShape => ({
  id, type: 'path', d, x: 0, y: 0, w: 300, h: 300, box0: { x: 0, y: 0, w: 300, h: 300 }, fill: '#fff', stroke: null, strokeWidth: 0,
} as VectorShape);
const sid = 'path-node-snap-session', docId = 'path-node-snap-doc', layerId = 'path-node-snap-layer';
let root: Root, host: HTMLDivElement, doc: DesignDoc, oldRect: PropertyDescriptor | undefined;
const pointer = (type: string, x: number, y: number, t: number) => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'timeStamp', { value: t });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e;
};

beforeEach(async () => {
  vi.useFakeTimers();
  oldRect = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBoundingClientRect');
  Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300, toJSON() {} }) });
  Object.defineProperty(SVGElement.prototype, 'setPointerCapture', { configurable: true, value() {} });
  doc = { ...createDoc('Node snap', 300, 300), id: docId, paintMode: 'design', layers: [
    { id: layerId, name: 'Paths', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [path('moving', 'M 10 10 L 20 10'), path('target', 'M 40 50 L 70 80')] } as VectorLayer,
  ] };
  const s = useStore.getState().sessions[sid];
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: { ...s, id: sid, docs: [doc], activeDocId: docId } } }));
  setShapeEdit(docId, { layerId, shapeId: 'moving', node: 1, nodes: [1] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(PathNodes, { view: { x: 0, y: 0, zoom: 1 } as never, sessionId: sid, docId, layerId, shape: doc.layers[0].type === 'vector' ? doc.layers[0].shapes[0] as VectorShape : path('moving', '') })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); dropHistory(docId); setShapeEdit(docId, null); vi.useRealTimers();
  if (oldRect) Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', oldRect);
  else delete (SVGElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  delete (SVGElement.prototype as { setPointerCapture?: unknown }).setPointerCapture;
});

describe('path-node snap gesture', () => {
  it('the real drag snaps after idle and remains one undo/redo step', async () => {
    const node = host.querySelector<SVGRectElement>('[data-node="1"]')!, svg = host.querySelector('svg')!;
    await act(async () => node.dispatchEvent(pointer('pointerdown', 20, 10, 100)));
    await act(async () => svg.dispatchEvent(pointer('pointermove', 38, 48, 101)));
    await act(async () => { vi.advanceTimersByTime(150); });
    await act(async () => svg.dispatchEvent(pointer('pointerup', 38, 48, 252)));
    const current = useStore.getState().sessions[sid].docs[0];
    const moving = (current.layers[0] as VectorLayer).shapes[0] as VectorShape;
    const nodeIndex = nodeSegs(pageSegs(moving)).seg.indexOf(1);
    expect(pageSegs(moving)[nodeSegs(pageSegs(moving)).seg[nodeIndex]].p.at(-1)).toEqual([40, 50]);
    expect(historyDepth(docId).undo).toBe(1);
    const previous = undo(current)!;
    const undone = (previous.layers[0] as VectorLayer).shapes[0] as VectorShape;
    expect(pageSegs(undone)[nodeSegs(pageSegs(undone)).seg[nodeIndex]].p.at(-1)).toEqual([20, 10]);
    const restored = redo(previous)!;
    const redone = (restored.layers[0] as VectorLayer).shapes[0] as VectorShape;
    expect(pageSegs(redone)[nodeSegs(pageSegs(redone)).seg[nodeIndex]].p.at(-1)).toEqual([40, 50]);
  });
});
