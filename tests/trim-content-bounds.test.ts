import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
// A paint layer whose pixels were measured empty (null), as rasterBounds reports it.
vi.mock('../src/engine/design/rasterBounds', async (orig) => ({ ...(await orig<object>()), rasterPaintedBox: () => null }));

import { trimToContent } from '../src/engine/design/canvasSize';
import { addDoc, getDoc } from '../src/engine/design/actions';
import { createDoc, newRasterLayer, newVectorLayer } from '../src/engine/design/doc';
import { useStore } from '../src/store/store';

const rect = (x: number, y: number, w: number, h: number, strokeWidth = 0) => ({ type: 'rect' as const, x, y, w, h, fill: '#fff', stroke: strokeWidth ? '#000' : null, strokeWidth, radius: 0, join: 'round' as const });

function setup(layers: ReturnType<typeof newVectorLayer | typeof newRasterLayer>[]) {
  const sid = useStore.getState().activeSessionId;
  const doc = { ...createDoc('t', 100, 100), layers };
  addDoc(sid, doc);
  return { sid, id: doc.id };
}

describe('trim to content measures what is painted', () => {
  it('an empty page-sized paint layer adds nothing', () => {
    const { sid, id } = setup([newRasterLayer('paint', { x: 0, y: 0, width: 100, height: 100 }, { width: 100, height: 100 }), newVectorLayer('s', [rect(10, 20, 30, 40)])]);
    expect(trimToContent(sid, id)).toBeNull();
    expect([getDoc(sid, id)!.width, getDoc(sid, id)!.height]).toEqual([30, 40]);
  });

  it('a thick stroke is kept whole', () => {
    const { sid, id } = setup([newVectorLayer('s', [rect(10, 20, 30, 40, 10)])]);
    expect(trimToContent(sid, id)).toBeNull();
    expect(getDoc(sid, id)!.width).toBeGreaterThanOrEqual(40);
    expect(getDoc(sid, id)!.height).toBeGreaterThanOrEqual(50);
  });

  it('content larger than the page limit is refused, not cut', () => {
    const { sid, id } = setup([newVectorLayer('s', [rect(0, 0, 9000, 50)])]);
    expect(trimToContent(sid, id)).toMatch(/8192/);
    expect(getDoc(sid, id)!.width).toBe(100);
  });
});
