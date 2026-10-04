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
  it('imports runtime and UI modules without network or persistent writes', async () => {
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
    expect(persistence.writes).toBe(0);
  });
});
