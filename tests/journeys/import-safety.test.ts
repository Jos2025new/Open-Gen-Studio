import { afterEach, describe, expect, it, vi } from 'vitest';

const persistence = vi.hoisted(() => ({ writes: 0 }));
vi.mock('../../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => { persistence.writes += 1; }, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => { persistence.writes += 1; } },
  blobDb: { get: async () => undefined, set: async () => { persistence.writes += 1; }, del: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined,
}));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('journey module import isolation', () => {
  it('isolates imports, deferred hydration writes and queued logs', async () => {
    const requests: string[] = [];
    vi.useFakeTimers();
    vi.stubGlobal('fetch', async (input: string | URL) => {
      requests.push(String(input));
      throw new Error(`Blocked every network request during import: ${input}`);
    });
    vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: () => undefined });
    vi.stubGlobal('document', { addEventListener: () => undefined, visibilityState: 'visible' });
    await vi.resetModules();
    await Promise.all([
      import('../../src/engine/agent/runtime'), import('../../src/engine/jobs'),
      import('../../src/components/composer/Composer'), import('../../src/lib/log'),
      import('../../src/lib/journeyTrace'), import('../../src/store/store'),
    ]);
    expect(requests).toEqual([]);
    const { useStore } = await import('../../src/store/store');
    const { logEvent, logSettled } = await import('../../src/lib/log');
    // Exercise hydration/debounce rather than leaving the persistence timers frozen.
    useStore.setState({ hydrated: true });
    await vi.advanceTimersByTimeAsync(2100);
    expect(persistence.writes).toBeGreaterThan(0); // Writes terminate in the mock, never IndexedDB/disk.
    expect(requests).toEqual([]);
    logEvent('app', { what: 'isolation probe' });
    await logSettled();
    expect(requests).toEqual(['/x/store/log']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests).toEqual(['/x/store/log']);
  });
});
