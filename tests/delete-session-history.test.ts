import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { deleteSession } from '../src/engine/actions';
import { newBlankDoc } from '../src/engine/design/actions';
import { canUndo, record } from '../src/engine/design/history';
import { newSession, useStore } from '../src/store/store';

describe('deleting a session', () => {
  it('drops the undo history of its designs (M1)', () => {
    const first = useStore.getState().activeSessionId;
    const doc = newBlankDoc(first, { label: 'Design', width: 64, height: 64 });
    record(doc);
    expect(canUndo(doc.id)).toBe(true);
    newSession();
    deleteSession(first);
    expect(canUndo(doc.id)).toBe(false);
  });
});
