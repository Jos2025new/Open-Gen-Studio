import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { anchorOffset, resizeCanvas, trimToContent } from '../src/engine/design/canvasSize';
import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { useStore } from '../src/store/store';

const rect = (x: number, y: number, w: number, h: number) => ({ type: 'rect' as const, x, y, w, h, fill: '#fff', stroke: null, strokeWidth: 0, radius: 0 });

function setup() {
  const sid = useStore.getState().activeSessionId;
  const doc = { ...createDoc('t', 100, 100), layers: [newVectorLayer('s', [rect(10, 20, 30, 40)])] };
  addDoc(sid, doc);
  return { sid, id: doc.id };
}
const shape = (sid: string, id: string) => {
  const l = getDoc(sid, id)!.layers[0];
  return l.type === 'vector' ? l.shapes[0] : null;
};

describe('canvas size', () => {
  it('anchor decides where the old page sits in the new one', () => {
    expect(anchorOffset({ width: 100, height: 100 }, { width: 200, height: 160 }, 'middle-center')).toEqual({ dx: 50, dy: 30 });
    expect(anchorOffset({ width: 100, height: 100 }, { width: 200, height: 160 }, 'top-left')).toEqual({ dx: 0, dy: 0 });
    expect(anchorOffset({ width: 100, height: 100 }, { width: 50, height: 50 }, 'bottom-right')).toEqual({ dx: -50, dy: -50 });
  });

  it('resizing moves the layers with the anchor, refuses bad sizes, and undoes in one step', () => {
    const { sid, id } = setup();
    expect(resizeCanvas(sid, id, 0, 50, 'top-left')).toMatch(/1 to/);
    expect(resizeCanvas(sid, id, 200, 100, 'middle-right')).toBeNull();
    expect(getDoc(sid, id)!.width).toBe(200);
    expect(shape(sid, id)).toMatchObject({ x: 110, y: 20 });
    undoDoc(sid, id);
    expect(getDoc(sid, id)!.width).toBe(100);
    expect(shape(sid, id)).toMatchObject({ x: 10, y: 20 });
  });

  it('trim to content: the page becomes the box of the visible layers', () => {
    const { sid, id } = setup();
    expect(trimToContent(sid, id)).toBeNull();
    const d = getDoc(sid, id)!;
    expect([d.width, d.height]).toEqual([30, 40]);
    expect(shape(sid, id)).toMatchObject({ x: 0, y: 0 });
  });
});
