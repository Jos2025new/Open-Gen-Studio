import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  return {
    blobs,
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> { blobs.set(key, value); },
      async del(key: string): Promise<void> { blobs.delete(key); },
      async delMany(keys: string[]): Promise<void> { for (const k of keys) blobs.delete(k); },
    },
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: hoisted.blobDb,
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));

import { createItem, libraryToDesigner, readKitVersion, renameItem, saveItem } from '../src/engine/libraryVersions';
import { newTextLayer } from '../src/engine/design/doc';
import { createSession, setDoc, useStore } from '../src/store/store';
import type { Graph } from '../src/engine/types';

function resetStore() {
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => { hoisted.blobs.clear(); });

describe('docRev tracking and draft preservation', () => {
  it('metadata-only save preserves docRev so open working copy stays reused in Designer', async () => {
    const s1 = resetStore();
    const { subject: kit, doc: draftDoc } = await createItem({ name: 'FlowDS', kind: 'design-system', space: 'studio', sessionId: s1.id, by: 'agent' });
    setDoc(s1.id, draftDoc!.id, (d) => ({ ...d, layers: [newTextLayer('Title', 'Brand Title', { x: 20, y: 20, width: 200 })] }));
    const g1: Graph = { nodes: [{ id: 'p1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Note', text: 'Brand Title' } }], edges: [] };
    const afterMeta = await saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'agent', graph: g1 });
    expect(afterMeta.versionId).toBeTruthy();

    const opened = await libraryToDesigner(s1.id, kit.id);
    expect(opened.id).toBe(draftDoc!.id);
    expect(opened.library?.view).toBeUndefined();
    expect(opened.layers.some((l) => l.type === 'text' && l.text === 'Brand Title')).toBe(true);

    const saved = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s1.id, space: 'designer', by: 'user' });
    const snapSaved = await readKitVersion(saved.versionId!);
    expect(snapSaved?.docRev).toBeTruthy();

    const afterMeta2 = await saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'agent', graph: { nodes: [{ id: 'p1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Note', text: 'Updated note' } }], edges: [] } });
    const snapMeta2 = await readKitVersion(afterMeta2.versionId!);
    expect(snapMeta2?.docRev).toBe(snapSaved?.docRev);
    const opened2 = await libraryToDesigner(s1.id, kit.id);
    expect(opened2.id).toBe(draftDoc!.id);
  });

  it('agent saves/renames keep draft:true; user save or user rename clears draft', async () => {
    const s1 = resetStore();
    const { subject: kit } = await createItem({ name: 'DraftKit', kind: 'design-system', space: 'studio', sessionId: s1.id, by: 'agent' });
    expect(kit.draft).toBe(true);
    const afterAgentSave = await saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'agent', graph: { nodes: [{ id: 'p1', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'N', text: 'Note' } }], edges: [] } });
    expect(afterAgentSave.draft).toBe(true);
    expect(renameItem(kit.id, { name: 'DraftKit v2', by: 'agent' }).draft).toBe(true);
    expect(renameItem(kit.id, { name: 'Official DS', by: 'user' }).draft).toBe(false);

    const { subject: kit2 } = await createItem({ name: 'DraftKit2', kind: 'moodboard', space: 'studio', sessionId: s1.id, by: 'agent' });
    expect((await saveItem({ subjectId: kit2.id, mode: 'overwrite', sessionId: s1.id, space: 'studio', by: 'agent' })).draft).toBe(true);
    expect((await saveItem({ subjectId: kit2.id, mode: 'overwrite', sessionId: s1.id, space: 'studio', by: 'user' })).draft).toBe(false);
  });
});
