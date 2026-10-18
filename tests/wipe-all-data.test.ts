import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

const wipe = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/lib/disk', async (orig) => ({
  ...(await orig<typeof import('../src/lib/disk')>()),
  disk: { isStale: () => false, reset: () => undefined, getState: async () => null, setState: async () => 'ok', putState: async () => 'ok', setCommit: async () => 'ok', wipe, onStateConflict: () => undefined },
  diskAvailable: async () => false,
}));

import { stateDb } from '../src/lib/idb';
import { wipeAllData } from '../src/store/store';



describe('wipeAllData', () => {
  it('deletes the current format-2 database too, and finishes before reloading', async () => {
    await stateDb.set('ogs-app', JSON.stringify({ savedAt: 5, state: { sessions: { ses_a: { id: 'ses_a' } } }, version: 1 }));
    expect(await stateDb.get('ogs-app')).toBeDefined();
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    await wipeAllData();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(wipe).toHaveBeenCalled();
    // Empty even if the browser keeps the delete queued behind this page's open connection.
    expect(await stateDb.get('ogs-app')).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
