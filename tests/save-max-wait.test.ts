import { describe, expect, it, vi } from 'vitest';

const writes = vi.hoisted(() => [] as number[]);
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => { writes.push(Date.now()); }, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { useStore } from '../src/store/store';

describe('state save while changes keep coming (P2)', () => {
  it('a change every 100 ms for 3 s still starts a save within 2 s, and the last change is saved', async () => {
    await useStore.persist.rehydrate(); // hydrated first: the store saves nothing before
    writes.length = 0;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 30; i++) {
      useStore.setState({ spentUsd: i });
      await wait(100);
    }
    const during = writes.length;
    await wait(500);
    expect(during).toBeGreaterThanOrEqual(1);
    expect(writes.length).toBe(during + 1); // the final quiet moment writes once more, not twice
  }, 10_000);
});
