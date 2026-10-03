import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { addDoc, getDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc } from '../src/engine/design/doc';
import { clearGuides, placeGuide, removeGuide, rulerStep } from '../src/engine/design/guides';
import { SNAP_DEFAULT, snapBox, snapTargets } from '../src/engine/design/snap';
import { useStore } from '../src/store/store';

describe('ruler guides', () => {
  it('add, move, remove, clear and undo; the snap sticks to them', () => {
    const sid = useStore.getState().activeSessionId;
    const doc = createDoc('t', 1000, 800);
    addDoc(sid, doc);
    placeGuide(sid, doc.id, 'x', 333.33);
    placeGuide(sid, doc.id, 'y', 100);
    placeGuide(sid, doc.id, 'x', 400, 0);
    expect(getDoc(sid, doc.id)!.guides).toEqual({ x: [400], y: [100] });
    const t = snapTargets({ ...getDoc(sid, doc.id)!, layers: [] }, 'none', { ...SNAP_DEFAULT, page: false });
    expect(snapBox({ x: 397, y: 500, w: 10, h: 10 }, t, 6)).toMatchObject({ dx: -2, gx: 400 }) // its center (402) is the nearest line to 400;
    removeGuide(sid, doc.id, 'y', 0);
    expect(getDoc(sid, doc.id)!.guides!.y).toEqual([]);
    undoDoc(sid, doc.id);
    expect(getDoc(sid, doc.id)!.guides!.y).toEqual([100]);
    clearGuides(sid, doc.id);
    expect(getDoc(sid, doc.id)!.guides).toBeUndefined();
  });
  it('ruler ticks land on 1/2/5 steps about every 70 screen px', () => {
    expect(rulerStep(1)).toBe(100);
    expect(rulerStep(0.5)).toBe(200);
    expect(rulerStep(4)).toBe(20);
  });
});
