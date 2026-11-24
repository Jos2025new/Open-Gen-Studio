import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  let writerLock = true;
  let failSetAt: ((key: string) => Error | null) | null = null;
  return {
    blobs,
    setLock: (v: boolean) => { writerLock = v; },
    setFailSet: (fn: ((key: string) => Error | null) | null) => { failSetAt = fn; },
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> {
        if (!writerLock) return;
        const err = failSetAt?.(key);
        if (err) throw err;
        blobs.set(key, value);
      },
      async del(key: string): Promise<void> { if (writerLock) blobs.delete(key); },
      async delMany(keys: string[]): Promise<void> { if (writerLock) for (const k of keys) blobs.delete(k); },
    },
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: hoisted.blobDb,
  getAssetBlob: async (id: string) => hoisted.blobs.get(`asset:${id}`),
  putAssetBlob: async (id: string, b: Blob) => { hoisted.blobs.set(`asset:${id}`, b); },
  deleteAssetBlobs: async (ids: string[]) => { for (const id of ids) hoisted.blobs.delete(`asset:${id}`); },
}));

import { createKit, openKit, readKitVersion, saveKit, updateKit, waitKitQueue } from '../src/engine/libraryVersions';
import { deleteSubject } from '../src/engine/libraryActions';
import { newRasterLayer, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { groupLayers, patchGroup } from '../src/engine/design/groups';
import { createSession, setDoc, useStore } from '../src/store/store';
import { setApprover } from '../src/engine/commands';
import type { RasterLayer } from '../src/engine/types';

function resetStore() {
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.setLock(true);
  hoisted.setFailSet(null);
  setApprover(null);
});

describe('Part 0: critical A2 fixes (content dirty check, docRev, draft preservation)', () => {
  it('0a) detects working-copy edits by content & pixel bytes (not updatedAt), removes linkedAt, and treats doubt as dirty', async () => {
    const s1 = resetStore();
    const s2 = createSession('S2');
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: s2 } }));

    // Helper: create kit with raster+text+vector layers, save v1, open in S1, apply edit WITHOUT touching updatedAt,
    // advance kit to v2 in S2, then openKit in S1 and check whether S1's copy was detached (dirty) or deleted (clean).
    async function runPathway(edit: (sid: string, docId: string, rasterId: string) => void | Promise<void>) {
      const { subject: kit, doc: d0 } = await createKit({ name: 'ContentKit', kind: 'design-system', space: 'studio', sessionId: s1.id, by: 'user' });
      const r: RasterLayer = { ...newRasterLayer('Px', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), rev: 1 };
      const t = newTextLayer('Label', 'Hello', { x: 10, y: 10, width: 100 });
      const v = newVectorLayer('Box', [{ type: 'rect', x: 0, y: 0, w: 40, h: 40, fill: '#111', stroke: null, strokeWidth: 0, radius: 0 }]);
      setDoc(s1.id, d0!.id, (d) => ({ ...d, layers: [r, t, v], activeLayerId: t.id }));
      hoisted.blobs.set(`raster:${r.id}`, new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
      await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s1.id, space: 'studio', by: 'user' });

      // Ensure no linkedAt field exists on linked working copy
      const liveD0 = useStore.getState().sessions[s1.id].docs.find((d) => d.id === d0!.id)!;
      expect('linkedAt' in (liveD0.library ?? {})).toBe(false);

      // Apply the edit under test
      await edit(s1.id, d0!.id, r.id);

      // Move kit document forward in S2 so S1's copy becomes stale
      const d2 = await openKit(kit.id, { sessionId: s2.id, space: 'designer' });
      setDoc(s2.id, d2.id, (d) => ({ ...d, background: '#abcdef' }));
      await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s2.id, space: 'designer', by: 'user' });

      // Reopen in S1 -> if dirty, d0 MUST be detached (preserved); if clean, d0 MUST be deleted
      const reopened = await openKit(kit.id, { sessionId: s1.id, space: 'designer' });
      const oldDoc = useStore.getState().sessions[s1.id].docs.find((d) => d.id === d0!.id);
      return { kit, oldDoc, reopened };
    }

    // 1. Paint pixels (bytes changed without changing updatedAt or rev!)
    const paint = await runPathway((_sid, _docId, rid) => {
      hoisted.blobs.set(`raster:${rid}`, new Blob([new Uint8Array([9, 9, 9, 9])], { type: 'image/png' }));
    });
    expect(paint.oldDoc).toBeDefined();
    expect(paint.oldDoc?.library).toBeUndefined();

    // 2. setDoc without touch (mutates layer name without changing updatedAt)
    const noTouch = await runPathway((sid, docId) => {
      setDoc(sid, docId, (d) => ({ ...d, layers: d.layers.map((l, i) => (i === 2 ? { ...l, name: 'RenamedNoTouch' } : l)) }));
    });
    expect(noTouch.oldDoc).toBeDefined();
    expect(noTouch.oldDoc?.library).toBeUndefined();

    // 3. Groups (create group & patchGroup without touch)
    const grp = await runPathway((sid, docId) => {
      const doc = useStore.getState().sessions[sid].docs.find((d) => d.id === docId)!;
      const gid = groupLayers(sid, docId, [doc.layers[1].id, doc.layers[2].id])!;
      patchGroup(sid, docId, gid, { name: 'Card' });
      // Reset updatedAt back to original to prove content check doesn't depend on updatedAt
      setDoc(sid, docId, (d) => ({ ...d, updatedAt: doc.updatedAt }));
    });
    expect(grp.oldDoc).toBeDefined();
    expect(grp.oldDoc?.library).toBeUndefined();

    // 4. Text change without touch
    const txt = await runPathway((sid, docId) => {
      setDoc(sid, docId, (d) => ({ ...d, layers: d.layers.map((l) => (l.type === 'text' ? { ...l, text: 'Changed' } : l)) }));
    });
    expect(txt.oldDoc).toBeDefined();
    expect(txt.oldDoc?.library).toBeUndefined();

    // 5. Guides change without touch
    const guides = await runPathway((sid, docId) => {
      setDoc(sid, docId, (d) => ({ ...d, guides: { x: [120], y: [240] } }));
    });
    expect(guides.oldDoc).toBeDefined();
    expect(guides.oldDoc?.library).toBeUndefined();

    // 6. Background change without touch
    const bg = await runPathway((sid, docId) => {
      setDoc(sid, docId, (d) => ({ ...d, background: '#112233' }));
    });
    expect(bg.oldDoc).toBeDefined();
    expect(bg.oldDoc?.library).toBeUndefined();

    // 7. Truly clean copy (even if activeLayerId, updatedAt, or lastExport changed) -> deleted, NOT detached
    const clean = await runPathway((sid, docId) => {
      setDoc(sid, docId, (d) => ({ ...d, activeLayerId: d.layers[0].id, updatedAt: d.updatedAt + 5000 }));
    });
    expect(clean.oldDoc).toBeUndefined();

    // 8. Doubt (unreadable/missing version blob or missing pixel blob) -> treated as dirty (detached, never deleted!)
    const { subject: doubtKit, doc: dd } = await createKit({ name: 'DoubtKit', kind: 'moodboard', space: 'studio', sessionId: s1.id, by: 'user' });
    setDoc(s1.id, dd!.id, (d) => ({ ...d, layers: [newTextLayer('Note', 'Keep me', { x: 0, y: 0, width: 80 })] }));
    const savedDoubt = await saveKit({ subjectId: doubtKit.id, mode: 'overwrite', sessionId: s1.id, space: 'studio', by: 'user' });
    hoisted.blobs.set(`libver:${savedDoubt.versionId}`, new Blob(['{corrupt'], { type: 'application/json' }));
    deleteSubject(doubtKit.id);
    await waitKitQueue(doubtKit.id);
    const keptOnDoubt = useStore.getState().sessions[s1.id].docs.find((d) => d.id === dd!.id);
    expect(keptOnDoubt).toBeDefined();
    expect(keptOnDoubt?.library).toBeUndefined();
  });

  it('0b) updateKit preserves docRev so open working copy stays current instead of detaching and opening blank', async () => {
    const s1 = resetStore();
    // Normal flow: create draft -> compose -> register pieces via updateKit -> open in designer
    const { subject: kit, doc: draftDoc } = await createKit({ name: 'FlowDS', kind: 'design-system', space: 'studio', sessionId: s1.id, by: 'agent' });
    setDoc(s1.id, draftDoc!.id, (d) => ({ ...d, layers: [newTextLayer('Title', 'Brand Title', { x: 20, y: 20, width: 200 })] }));

    const afterMeta = await updateKit(kit.id, {
      pieces: [{ id: 'p1', kind: 'text', text: 'Brand Title' }],
      by: 'agent',
      space: 'studio',
    });
    expect(afterMeta.versionId).toBeTruthy();

    // Opening in designer must REUSE draftDoc with its composed layers intact (NOT detach & open blank!)
    const opened = await openKit(kit.id, { sessionId: s1.id, space: 'designer' });
    expect(opened.id).toBe(draftDoc!.id);
    expect(opened.library?.view).toBeUndefined();
    expect(opened.layers.some((l) => l.type === 'text' && l.text === 'Brand Title')).toBe(true);
    expect(useStore.getState().sessions[s1.id].docs.filter((d) => d.name.includes('(local copy)'))).toHaveLength(0);

    // After saving v2 (with doc -> gets docRev), another updateKit preserves docRev so working copy is still current
    const saved = await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s1.id, space: 'designer', by: 'user' });
    const snapSaved = await readKitVersion(saved.versionId!);
    expect(snapSaved?.docRev).toBeTruthy();
    const afterMeta2 = await updateKit(kit.id, { pieces: [{ id: 'p1', kind: 'text', text: 'Updated note' }], by: 'agent' });
    const snapMeta2 = await readKitVersion(afterMeta2.versionId!);
    expect(snapMeta2?.docRev).toBe(snapSaved?.docRev);
    const opened2 = await openKit(kit.id, { sessionId: s1.id, space: 'designer' });
    expect(opened2.id).toBe(draftDoc!.id);
  });

  it('0c) updateKit by agent keeps draft:true; only user save or user rename clears draft', async () => {
    const s1 = resetStore();
    const { subject: kit } = await createKit({ name: 'DraftKit', kind: 'design-system', space: 'studio', sessionId: s1.id, by: 'agent' });
    expect(kit.draft).toBe(true);

    // Agent registering pieces/links keeps draft: true
    const afterPieces = await updateKit(kit.id, { pieces: [{ id: 'p1', kind: 'text', text: 'Note' }], by: 'agent' });
    expect(afterPieces.draft).toBe(true);

    // Agent renaming keeps draft: true
    const afterAgentRename = await updateKit(kit.id, { name: 'DraftKit v2', by: 'agent' });
    expect(afterAgentRename.draft).toBe(true);

    // User renaming clears draft -> false
    const afterUserRename = await updateKit(kit.id, { name: 'Official DS', by: 'user' });
    expect(afterUserRename.draft).toBe(false);

    // Also test user saveKit clearing draft -> false on another draft
    const { subject: kit2 } = await createKit({ name: 'DraftKit2', kind: 'moodboard', space: 'studio', sessionId: s1.id, by: 'agent' });
    expect(kit2.draft).toBe(true);
    const afterAgentSave = await saveKit({ subjectId: kit2.id, mode: 'overwrite', sessionId: s1.id, space: 'studio', by: 'agent' });
    expect(afterAgentSave.draft).toBe(true);
    const afterUserSave = await saveKit({ subjectId: kit2.id, mode: 'overwrite', sessionId: s1.id, space: 'studio', by: 'user' });
    expect(afterUserSave.draft).toBe(false);
  });
});
