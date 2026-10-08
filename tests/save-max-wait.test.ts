import { describe, expect, it, vi } from 'vitest';

const writes = vi.hoisted(() => [] as number[]);
// A fake clock: the debounce is measured in simulated time, so a busy machine cannot stretch it (no real waits).
// window timers delegate to the global ones, so the fake clock below drives the store's debounce too.
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a), clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id), addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => { writes.push(Date.now()); }, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { useStore } from '../src/store/store';

describe('state save while changes keep coming (P2)', () => {
  it('a change every 100 ms for 3 s still starts a save within 2 s, and the last change is saved', async () => {
    vi.useFakeTimers(); // before hydrating: a timer the store sets now must run on the same clock
    await useStore.persist.rehydrate(); // hydrated first: the store saves nothing before
    await vi.advanceTimersByTimeAsync(2500); // let any save started by hydration finish
    writes.length = 0;
    const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 30; i++) {
      useStore.setState({ spentUsd: i });
      await wait(100);
    }
    const during = writes.length;
    await wait(500);
    expect(during).toBeGreaterThanOrEqual(1);
    expect(writes.length).toBe(during + 1); // the final quiet moment writes once more, not twice
    vi.useRealTimers();
  });
});
