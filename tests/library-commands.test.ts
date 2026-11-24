import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { command, run, setApprover } from '../src/engine/commands';
import { LIBRARY_ACTIONS } from '../src/engine/library.commands';
import { createSession, useStore } from '../src/store/store';

beforeEach(() => { const s = createSession('Test'); useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {} }); setApprover(null); });
describe('library commands', () => {
  it('covers the library actions and registers every command', () => {
    expect(Object.keys(LIBRARY_ACTIONS).sort()).toEqual([
      'saveSubject', 'deleteSubject', 'libraryItem', 'subjectFromAsset', 'saveSheetViews', 'subjectFromAttachments',
      'createRecraftStyle', 'createSubjectVoice', 'createKit', 'readKit', 'updateKit', 'openKit', 'saveKit', 'restoreKitVersion', 'listKits', 'insertComponent',
    ].sort());
    for (const id of Object.values(LIBRARY_ACTIONS)) if (!id.startsWith('-')) expect(command(id)).toBeDefined();
  });
  it('saves, reads and chains results', async () => {
    const result = await run({ seq: [{ cmd: 'library.subject.save', args: { subject: { id: 's1', name: 'Alice', refAssetIds: [] } } }, { cmd: 'library.subject.get', args: { name: '$1.name' } }] }, { caller: 'agent' });
    expect(result.ok).toBe(true); expect(result.results[1]).toMatchObject({ id: 's1', name: 'Alice' });
  });
  it('rejects missing ids and extra fields without changing the library', async () => {
    const before = useStore.getState().library;
    expect(await run({ cmd: 'library.subject.from_asset', args: { asset: 'missing', name: 'A' } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await run({ cmd: 'library.subject.get', args: { name: 'A', extra: true } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(useStore.getState().library).toEqual(before);
  });
  it('denies every destructive or paid command without calling fetch', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('provider called'); });
    try { for (const call of [
      { cmd: 'library.subject.delete', args: { id: 's1' } },
      { cmd: 'library.style.create', on: { session: 's' }, args: { name: 'A' } },
      { cmd: 'library.voice.create', on: { session: 's' }, args: { subject: 's1' } },
    ]) expect(await run(call, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'denied' } });
    expect(fetch).not.toHaveBeenCalled(); } finally { fetch.mockRestore(); }
  });
});
