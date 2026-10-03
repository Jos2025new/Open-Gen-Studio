import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { rememberColor, removeSwatch, saveSwatch } from '../src/engine/design/swatches';
import { useStore } from '../src/store/store';

describe('Designer swatches', () => {
  it('recent: newest first, no duplicates, at most 12; saved: add once, remove; bad values ignored', () => {
    for (let i = 0; i < 14; i++) rememberColor(`#0000${String(i).padStart(2, '0')}`);
    rememberColor('#000003');
    rememberColor('red');
    const s = useStore.getState().ui.swatches!;
    expect(s.recent[0]).toBe('#000003');
    expect(s.recent).toHaveLength(12);
    expect(new Set(s.recent).size).toBe(12);
    saveSwatch('#ABCDEF');
    saveSwatch('#abcdef');
    expect(useStore.getState().ui.swatches!.saved).toEqual(['#abcdef']);
    removeSwatch('#abcdef');
    expect(useStore.getState().ui.swatches!.saved).toEqual([]);
  });
});
