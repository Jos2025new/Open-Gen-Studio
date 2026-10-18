import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { keptDrafts } from '../src/store/homeDrafts';
import { deleteSession } from '../src/engine/actions';
import { newSession, setUi, useStore } from '../src/store/store';

describe('keptDrafts', () => {
  it('drops empty drafts and ids of missing sessions', () => {
    const kept = keptDrafts({ a: 'fox', b: '', c: 'gone?', d: 'dog' }, { a: {}, b: {}, d: {} });
    expect(kept).toEqual({ a: 'fox', d: 'dog' });
  });
});

describe('deleteSession drops its Home draft', () => {
  beforeEach(() => setUi({ homeDrafts: {} }));

  it('removes that session entry and keeps the others', () => {
    const first = newSession();
    const second = newSession();
    setUi({ homeDrafts: { [first]: 'a red fox', [second]: 'a blue dog' } });
    deleteSession(first);
    const drafts = useStore.getState().ui.homeDrafts ?? {};
    expect(drafts[first]).toBeUndefined();
    expect(drafts[second]).toBe('a blue dog');
  });
});

describe('rehydrate merge drops drafts of sessions not persisted', () => {
  it('keeps only drafts whose session is in the persisted sessions', () => {
    const current = useStore.getState();
    const persisted = {
      sessions: { live: { id: 'live', feed: [], agent: {} } },
      activeSessionId: 'live',
      ui: { homeDrafts: { live: 'kept', ghost: 'dropped', empty: '' } },
    };
    const merged = useStore.persist.getOptions().merge!(persisted as never, current) as { ui: { homeDrafts: Record<string, string> } };
    expect(merged.ui.homeDrafts).toEqual({ live: 'kept' });
  });
});
