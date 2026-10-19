import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/disk', () => ({
  disk: { isStale: () => false, reset: () => undefined, getState: async () => null, setState: async () => 'ok', putState: async () => 'ok', setCommit: async () => 'ok', wipe: async () => undefined },
  diskAvailable: async () => false,
}));

import { stateDb } from '../src/lib/idb';

const text = (savedAt: number, ids: string[]) =>
  JSON.stringify({ savedAt, state: { settings: {}, sessions: Object.fromEntries(ids.map((id) => [id, { id }])) }, version: 1 });

describe('format 2 commit is one IndexedDB transaction', () => {
  it('writes sessions, removals, globals and manifest in a single readwrite transaction', async () => {
    await stateDb.set('ogs-app', text(1, ['ses_a', 'ses_b']));
    const spy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    await stateDb.set('ogs-app', text(2, ['ses_a', 'ses_c']));
    const writes = spy.mock.calls.filter(([, mode]) => mode === 'readwrite');
    spy.mockRestore();
    // The commit is ONE transaction (sessions, removals, globals, manifest and the unsent-work record); the disk's receipt
    // then clears that record in a second, small one.
    expect(writes).toHaveLength(2);
    const back = JSON.parse((await stateDb.get('ogs-app'))!);
    expect(Object.keys(back.state.sessions).sort()).toEqual(['ses_a', 'ses_c']);
  });
});
