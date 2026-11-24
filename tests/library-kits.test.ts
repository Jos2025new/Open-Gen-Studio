import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  let writerLock = true;
  let failSetAt: ((key: string) => Error | null) | null = null;
  let failGetAt: ((key: string) => Error | null) | null = null;
  return {
    blobs,
    setLock: (v: boolean) => { writerLock = v; },
    getLock: () => writerLock,
    setFailSet: (fn: ((key: string) => Error | null) | null) => { failSetAt = fn; },
    setFailGet: (fn: ((key: string) => Error | null) | null) => { failGetAt = fn; },
    blobDb: {
      async get(key: string): Promise<Blob | undefined> {
        const err = failGetAt?.(key);
        if (err) throw err;
        return blobs.get(key);
      },
      async set(key: string, value: Blob): Promise<void> {
        // Matches real idb.ts:344: silent return without writer lock.
        if (!writerLock) return;
        const err = failSetAt?.(key);
        if (err) throw err;
        blobs.set(key, value);
      },
      async del(key: string): Promise<void> {
        if (!writerLock) return;
        blobs.delete(key);
      },
      async delMany(keys: string[]): Promise<void> {
        if (!writerLock) return;
        for (const k of keys) blobs.delete(k);
      },
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

import { SUBJECT_KINDS, deleteSubject, libraryItem, saveSubject } from '../src/engine/libraryActions';
import { isKit, KIT_KINDS, mentionableSubjects } from '../src/engine/libraryTypes';
import { buildLibraryIndex, kitDependencies, kitUsedBy, libraryAssetOwners, libraryAssetSet, subjectAssetIds, wouldCreateKitCycle } from '../src/engine/libraryGraph';
import { createKit, openKit, readKitVersion, restoreKitVersion, saveKit, updateKit, waitKitQueue } from '../src/engine/libraryVersions';
import { createDoc, newRasterLayer, newVectorLayer, touch } from '../src/engine/design/doc';
import { addDoc } from '../src/engine/design/actions';
import { deleteSession } from '../src/engine/actions';
import { deleteAssets, deleteGeneration } from '../src/engine/assetActions';
import { purgeDiscarded } from '../src/engine/jobState';
import { createSession, setDoc, useStore } from '../src/store/store';
import { resolveSendPlan } from '../src/engine/sendInputs';
import { run, setApprover } from '../src/engine/commands';
import { runCommandsTool } from '../src/engine/agent/commandCalls';
import type { Asset, Generation, RasterLayer, Subject } from '../src/engine/types';

async function blobBytes(b: Blob | undefined): Promise<Uint8Array> {
  if (!b) return new Uint8Array();
  return new Uint8Array(await b.arrayBuffer());
}

function resetStore() {
  const s = createSession('Origin');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.setLock(true);
  hoisted.setFailSet(null);
  hoisted.setFailGet(null);
});

describe('Contract 1 & 2: kit types, graph, cycles, missing refs and assets', () => {
  it('keeps SUBJECT_KINDS unchanged and classifies kits via KIT_KINDS and isKit', () => {
    expect(SUBJECT_KINDS.map((k) => k.value)).toEqual(['character', 'object', 'product', 'location', 'style']);
    expect([...KIT_KINDS]).toEqual(['moodboard', 'design-system', 'brand-kit']);
    const classic: Subject = { id: 's1', name: 'Hero', kind: 'character', refAssetIds: [] };
    const ds: Subject = { id: 'k1', name: 'AcmeDS', kind: 'design-system', refAssetIds: [] };
    const mb: Subject = { id: 'k2', name: 'AcmeMood', kind: 'moodboard', refAssetIds: [] };
    const kit: Subject = { id: 'k3', name: 'AcmeBrand', kind: 'brand-kit', refAssetIds: [] };
    expect(isKit(classic)).toBe(false);
    const legacy: Subject = { id: 's0', name: 'Legacy', refAssetIds: [] };
    expect(isKit(legacy)).toBe(false);
    expect(isKit(ds)).toBe(true);
    expect(isKit(mb)).toBe(true);
    expect(isKit(kit)).toBe(true);
    expect(mentionableSubjects([classic, ds, mb, kit]).map((x) => x.id)).toEqual(['s1']);
  });

  it('tracks dependencies, usedBy, missing refs, transitive cycles and assets across all versions', () => {
    const ds: Subject = {
      id: 'ds1', name: 'AcmeDS', kind: 'design-system', refAssetIds: [],
      pieces: [{ id: 'p1', kind: 'asset', role: 'logo', assetId: 'ast_logo_v2' }],
      tokens: { colors: { bg: '#111', accent: '#d4f25a' }, fonts: { display: 'Inter' }, spacing: { md: 16 }, radii: { card: 8 } },
      versions: [
        { id: 'lv1', at: 1, by: 'user', space: 'studio', label: 'v1', assetIds: ['ast_logo_v1'] },
        { id: 'lv2', at: 2, by: 'agent', space: 'designer', label: 'v2', assetIds: ['ast_logo_v2'] },
      ],
    };
    const mb: Subject = {
      id: 'mb1', name: 'AcmeMood', kind: 'moodboard', refAssetIds: [],
      pieces: [
        { id: 'p2', kind: 'asset', assetId: 'ast_mood' },
        { id: 'p3', kind: 'text', text: 'Warm editorial light' },
      ],
      links: [{ id: 'l1', from: 'p2', to: 'p3', label: 'lighting note' }],
    };
    const brand: Subject = {
      id: 'bk1', name: 'AcmeBrand', kind: 'brand-kit', refAssetIds: [],
      pieces: [
        { id: 'b1', kind: 'kit', role: 'design-system', kitId: 'ds1' },
        { id: 'b2', kind: 'kit', role: 'moodboard', kitId: 'mb1' },
        { id: 'b3', kind: 'kit', role: 'deleted-part', kitId: 'missing_kit' },
      ],
    };
    const lib = [ds, mb, brand];
    const index = buildLibraryIndex(lib);

    expect(kitDependencies(brand, lib)).toEqual({
      kitIds: ['ds1', 'mb1'],
      missingKitIds: ['missing_kit'],
      assetIds: [],
    });
    expect(kitUsedBy('ds1', lib).map((x) => x.id)).toEqual(['bk1']);
    expect(kitUsedBy('mb1', lib).map((x) => x.id)).toEqual(['bk1']);
    expect(index.missingRefs.get('bk1')).toEqual(['missing_kit']);

    // Direct self-cycle rejected
    expect(wouldCreateKitCycle(lib, 'ds1', [{ id: 'x', kind: 'kit', kitId: 'ds1' }])).toMatchObject({ ok: false });
    // Indirect cycle ds1 -> bk1 -> ds1 rejected
    expect(wouldCreateKitCycle(lib, 'ds1', [{ id: 'x', kind: 'kit', kitId: 'bk1' }])).toMatchObject({ ok: false });
    // Non-cyclic link ds1 -> mb1 allowed
    expect(wouldCreateKitCycle(lib, 'ds1', [{ id: 'x', kind: 'kit', kitId: 'mb1' }])).toEqual({ ok: true });

    // Assets from OLD versions are included
    expect(subjectAssetIds(ds).sort()).toEqual(['ast_logo_v1', 'ast_logo_v2']);
    expect(libraryAssetSet(lib).has('ast_logo_v1')).toBe(true);
    expect(libraryAssetSet(lib).has('ast_mood')).toBe(true);
    expect(libraryAssetOwners(lib).get('ast_logo_v1')?.map((s) => s.id)).toEqual(['ds1']);
  });
});

describe('Contract 3: versions, pixels, copy, restore, failures, lock, delete', () => {
  it('round-trips through serialized persistence, edits pixels, overwrites, restores v1 with exact bytes, and reuses unchanged bytes', async () => {
    const s = resetStore();
    const { subject: kit } = await createKit({ name: 'AcmeDS', kind: 'design-system', space: 'studio', sessionId: s.id, by: 'agent', tokens: { colors: { bg: '#111' } } });
    // Build a working doc with 2 raster layers (one with paintBaseId) and a vector layer with pixelMask
    const baseLayer: RasterLayer = { ...newRasterLayer('Hero', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), paintBaseId: 'pb_1', rev: 1 };
    const staticLayer: RasterLayer = { ...newRasterLayer('Static', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), rev: 1 };
    const maskLayer: RasterLayer = { ...newRasterLayer('Mask', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), rev: 1 };
    const vecLayer = { ...newVectorLayer('Shapes', []), pixelMask: maskLayer };
    const workDoc = { ...createDoc('AcmeDS', 100, 100, '#111'), layers: [baseLayer, staticLayer, vecLayer], library: { subjectId: kit.id, versionId: '', view: 'studio' as const } };
    addDoc(s.id, workDoc);

    const bytesHeroV1 = new Uint8Array([1, 2, 3, 4]);
    const bytesBaseV1 = new Uint8Array([9, 8, 7, 6]);
    const bytesStatic = new Uint8Array([5, 5, 5, 5]);
    const bytesMaskV1 = new Uint8Array([2, 4, 6, 8]);
    hoisted.blobs.set(`raster:${baseLayer.id}`, new Blob([bytesHeroV1], { type: 'image/png' }));
    hoisted.blobs.set('raster:pb_1', new Blob([bytesBaseV1], { type: 'image/png' }));
    hoisted.blobs.set(`raster:${staticLayer.id}`, new Blob([bytesStatic], { type: 'image/png' }));
    hoisted.blobs.set(`raster:${maskLayer.id}`, new Blob([bytesMaskV1], { type: 'image/png' }));

    const v1 = await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: workDoc.id, space: 'studio', by: 'user', label: 'v1' });
    expect(v1.draft).toBe(false);
    expect(v1.versions?.length).toBe(1);
    const v1Id = v1.versionId!;
    const snap1 = await readKitVersion(v1Id);
    expect(snap1?.doc?.layers.length).toBe(3);

    // Simulate reload: serialize library & sessions to JSON and restore into store
    const serialized = JSON.stringify({ library: useStore.getState().library, sessions: useStore.getState().sessions });
    const reloaded = JSON.parse(serialized) as { library: Subject[]; sessions: ReturnType<typeof useStore.getState>['sessions'] };
    useStore.setState({ library: reloaded.library, sessions: reloaded.sessions });

    // Edit hero pixels (different bytes) and bump static rev WITHOUT changing static bytes (must reuse static id by bytes, not rev!)
    const bytesHeroV2 = new Uint8Array([99, 98, 97, 96]);
    hoisted.blobs.set(`raster:${baseLayer.id}`, new Blob([bytesHeroV2], { type: 'image/png' }));
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [s.id]: {
          ...st.sessions[s.id],
          docs: st.sessions[s.id].docs.map((d) => d.id === workDoc.id ? { ...d, layers: d.layers.map((l) => l.id === staticLayer.id ? { ...l, rev: 99 } : l) } : d),
        },
      },
    }));

    const v2 = await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: workDoc.id, space: 'designer', by: 'user', label: 'v2' });
    expect(v2.versions?.length).toBe(2);
    const snap2 = await readKitVersion(v2.versionId!);
    const v1StaticId = snap1!.doc!.layers[1].id;
    const v2StaticId = snap2!.doc!.layers[1].id;
    const v1HeroId = snap1!.doc!.layers[0].id;
    const v2HeroId = snap2!.doc!.layers[0].id;
    expect(v2StaticId).toBe(v1StaticId); // identical bytes -> reused despite rev bump
    expect(v2HeroId).not.toBe(v1HeroId); // changed bytes -> new id
    expect(await blobBytes(hoisted.blobs.get(`raster:${v2HeroId}`))).toEqual(bytesHeroV2);

    // Restore v1 -> appends v3 without deleting v1/v2, bytes match v1 exactly
    const v3 = await restoreKitVersion({ subjectId: kit.id, versionId: v1Id, space: 'library', by: 'user' });
    expect(v3.versions?.length).toBe(3);
    const snap3 = await readKitVersion(v3.versionId!);
    const restoredHero = snap3!.doc!.layers[0] as RasterLayer;
    expect(await blobBytes(hoisted.blobs.get(`raster:${restoredHero.id}`))).toEqual(bytesHeroV1);
    expect(await blobBytes(hoisted.blobs.get(`raster:${restoredHero.paintBaseId}`))).toEqual(bytesBaseV1);

    // Delete origin session -> kit versions and pixels survive intact
    deleteSession(s.id);
    expect(useStore.getState().library.some((x) => x.id === kit.id)).toBe(true);
    expect(await blobBytes(hoisted.blobs.get(`raster:${restoredHero.id}`))).toEqual(bytesHeroV1);

    // Open in new active session -> creates working copy; opening again reuses it and drops studio view in designer
    const s2 = useStore.getState().activeSessionId;
    const openedStudio = await openKit(kit.id, { sessionId: s2, space: 'studio' });
    expect(openedStudio.library).toMatchObject({ subjectId: kit.id, versionId: v3.versionId, view: 'studio' });
    expect(openedStudio.library?.linkedAt).toBe(openedStudio.updatedAt);
    expect(await blobBytes(hoisted.blobs.get(`raster:${openedStudio.layers[0].id}`))).toEqual(bytesHeroV1);
    const reopenedDesigner = await openKit(kit.id, { sessionId: s2, space: 'designer' });
    expect(reopenedDesigner.id).toBe(openedStudio.id);
    expect(reopenedDesigner.library?.view).toBeUndefined();
  });

  it('gives copies independent pixels so deleting original or copy never affects the other, and unlinks open working docs', async () => {
    const s = resetStore();
    const { subject: orig } = await createKit({ name: 'Orig', kind: 'moodboard', space: 'designer', sessionId: s.id, by: 'user' });
    const lyr = { ...newRasterLayer('Img', { x: 0, y: 0, width: 4, height: 4 }, { width: 4, height: 4 }), rev: 1 };
    const doc = { ...createDoc('Orig', 100, 100, null), layers: [lyr], library: { subjectId: orig.id, versionId: '' } };
    addDoc(s.id, doc);
    const px = new Uint8Array([10, 20, 30, 40]);
    hoisted.blobs.set(`raster:${lyr.id}`, new Blob([px], { type: 'image/png' }));

    const savedOrig = await saveKit({ subjectId: orig.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' });
    const copy = await saveKit({ subjectId: orig.id, mode: 'copy', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user', name: 'Copy' });
    expect(copy.copiedFrom).toBe(orig.id);

    const origSnap = await readKitVersion(savedOrig.versionId!);
    const copySnap = await readKitVersion(copy.versionId!);
    expect(copySnap!.doc!.layers[0].id).not.toBe(origSnap!.doc!.layers[0].id);

    // Edit working doc locally so delete detaches it with its pixels instead of removing an unchanged copy
    setDoc(s.id, doc.id, (d) => touch(d));
    // Delete original -> copy keeps its pixels, modified working doc keeps its pixels and loses library link
    deleteSubject(orig.id);
    await waitKitQueue(orig.id);
    expect(hoisted.blobs.has(`libver:${savedOrig.versionId}`)).toBe(false);
    expect(hoisted.blobs.has(`raster:${origSnap!.doc!.layers[0].id}`)).toBe(false);
    expect(await blobBytes(hoisted.blobs.get(`raster:${copySnap!.doc!.layers[0].id}`))).toEqual(px);
    const stillOpen = useStore.getState().sessions[s.id].docs.find((d) => d.id === doc.id)!;
    expect(stillOpen.library).toBeUndefined();
    expect(await blobBytes(hoisted.blobs.get(`raster:${lyr.id}`))).toEqual(px);

    // Make a second copy from copy, then delete copy -> second copy survives
    const copyDoc = await openKit(copy.id, { sessionId: s.id, space: 'designer' });
    const copy2 = await saveKit({ subjectId: copy.id, mode: 'copy', sessionId: s.id, docId: copyDoc.id, space: 'designer', by: 'user', name: 'Copy2' });
    const copy2Snap = await readKitVersion(copy2.versionId!);
    deleteSubject(copy.id);
    await waitKitQueue(copy.id);
    expect(await blobBytes(hoisted.blobs.get(`raster:${copy2Snap!.doc!.layers[0].id}`))).toEqual(px);
  });

  it('aborts with previous version intact on pixel write failure, blob write failure, missing blob, or missing writer lock', async () => {
    const s = resetStore();
    const { subject: kit } = await createKit({ name: 'SafeKit', kind: 'design-system', space: 'designer', sessionId: s.id, by: 'user' });
    const lyr = { ...newRasterLayer('Img', { x: 0, y: 0, width: 4, height: 4 }, { width: 4, height: 4 }), rev: 1 };
    const doc = { ...createDoc('SafeKit', 100, 100, null), layers: [lyr], library: { subjectId: kit.id, versionId: '' } };
    addDoc(s.id, doc);
    hoisted.blobs.set(`raster:${lyr.id}`, new Blob([new Uint8Array([1, 1])], { type: 'image/png' }));
    const v1 = await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' });

    // Edit pixels
    hoisted.blobs.set(`raster:${lyr.id}`, new Blob([new Uint8Array([2, 2])], { type: 'image/png' }));

    // 1) Pixel write failure
    hoisted.setFailSet((k) => k.startsWith('raster:') ? new Error('disk full on pixels') : null);
    await expect(saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' })).rejects.toThrow(/disk full/i);
    expect(useStore.getState().library.find((x) => x.id === kit.id)?.versionId).toBe(v1.versionId);

    // 2) Version blob write failure
    hoisted.setFailSet((k) => k.startsWith('libver:') ? new Error('disk full on libver') : null);
    await expect(saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' })).rejects.toThrow(/disk full/i);
    expect(useStore.getState().library.find((x) => x.id === kit.id)?.versionId).toBe(v1.versionId);
    hoisted.setFailSet(null);

    // 3) Writer lock missing (blobDb.set returns silently -> re-read catches it and pointer does NOT move)
    hoisted.setLock(false);
    await expect(saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' })).rejects.toThrow(/verify|lock/i);
    expect(useStore.getState().library.find((x) => x.id === kit.id)?.versionId).toBe(v1.versionId);
    hoisted.setLock(true);

    // 4) Missing expected source pixel blob
    hoisted.blobs.delete(`raster:${lyr.id}`);
    await expect(saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' })).rejects.toThrow(/missing/i);
    expect(useStore.getState().library.find((x) => x.id === kit.id)?.versionId).toBe(v1.versionId);

    // 5) Restore when version blob is missing -> clear error
    await expect(restoreKitVersion({ subjectId: kit.id, versionId: 'lv_missing', space: 'library', by: 'user' })).rejects.toThrow(/missing/i);

    // 6) Origin is immutable on updateKit, and kits are invisible to libraryItem()
    const origOrigin = v1.origin;
    const updated = await updateKit(kit.id, { name: 'RenamedKit' });
    expect(updated.origin).toEqual(origOrigin);
    expect(libraryItem('RenamedKit')).toBeUndefined();
    saveSubject({ id: 'sub_classic', name: 'ClassicHero', kind: 'character', refAssetIds: [] });
    expect(libraryItem('ClassicHero')?.id).toBe('sub_classic');
  });
});

describe('Contract 4: image protection across deleteSession, purgeDiscarded, deleteAssets, deleteGeneration', () => {
  const mkAsset = (id: string, sessionId: string, generationId?: string): Asset => ({
    id, kind: 'image', mime: 'image/png', width: 100, height: 100, sessionId, generationId,
    origin: 'generated', stored: true, favorite: false, createdAt: 1,
  });

  it('protects assets from OLD kit versions on deleteSession and purgeDiscarded, and keeps library-used assets with toast on deleteAssets/deleteGeneration', async () => {
    const s = resetStore();
    useStore.setState({
      assets: {
        ast_old_v1: mkAsset('ast_old_v1', s.id, 'gen_1'),
        ast_v2: mkAsset('ast_v2', s.id),
      },
    });
    const { subject: kit } = await createKit({
      name: 'BrandKit', kind: 'brand-kit', space: 'studio', sessionId: s.id, by: 'user',
      pieces: [{ id: 'p1', kind: 'asset', assetId: 'ast_old_v1' }],
    });
    await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, space: 'studio', by: 'user', label: 'v1' });
    // Overwrite v2 removing ast_old_v1 from current pieces (now only in v1!)
    await saveKit({
      subjectId: kit.id, mode: 'overwrite', sessionId: s.id, space: 'studio', by: 'user', label: 'v2',
      pieces: [{ id: 'p2', kind: 'asset', assetId: 'ast_v2' }],
    });
    saveSubject({ id: 'sub_c', name: 'Hero', kind: 'character', frontalAssetId: 'ast_subj', refAssetIds: [] });

    const gen: Generation = {
      id: 'gen_1', sessionId: s.id, kind: 'image', prompt: 'p', modelRef: 'm', modelName: 'M', provider: 'local',
      settings: { count: 1, advanced: {} }, inputs: { refs: [] }, status: 'done',
      assetIds: ['ast_old_v1', 'ast_free_gen'], origin: 'composer', estimate: { usd: 0, approximate: false }, createdAt: 1,
    };
    const discGen: Generation = { ...gen, id: 'gen_disc', discard: true, assetIds: ['ast_old_v1', 'ast_disc_free'] };
    useStore.setState({
      assets: {
        ast_old_v1: mkAsset('ast_old_v1', s.id, 'gen_1'),
        ast_v2: mkAsset('ast_v2', s.id),
        ast_subj: mkAsset('ast_subj', s.id),
        ast_free: mkAsset('ast_free', s.id),
        ast_free_gen: mkAsset('ast_free_gen', s.id, 'gen_1'),
        ast_disc_free: mkAsset('ast_disc_free', s.id, 'gen_disc'),
      },
      generations: { gen_1: gen, gen_disc: discGen },
      ui: { ...useStore.getState().ui, toasts: [] },
    });
    for (const id of ['ast_old_v1', 'ast_v2', 'ast_subj', 'ast_free', 'ast_free_gen', 'ast_disc_free']) {
      hoisted.blobs.set(`asset:${id}`, new Blob(['img']));
    }

    // 1) deleteAssets keeps ast_old_v1 and ast_subj, deletes ast_free, and toasts the entry names
    deleteAssets(['ast_old_v1', 'ast_subj', 'ast_free']);
    expect(useStore.getState().assets.ast_old_v1).toBeDefined();
    expect(useStore.getState().assets.ast_subj).toBeDefined();
    expect(useStore.getState().assets.ast_free).toBeUndefined();
    expect(useStore.getState().ui.toasts.some((t) => t.text.includes('BrandKit') && t.text.includes('Hero'))).toBe(true);

    // 2) deleteGeneration keeps ast_old_v1, deletes ast_free_gen, toasts BrandKit
    useStore.setState((st) => ({ ui: { ...st.ui, toasts: [] } }));
    deleteGeneration('gen_1');
    expect(useStore.getState().generations.gen_1).toBeUndefined();
    expect(useStore.getState().assets.ast_old_v1).toBeDefined();
    expect(useStore.getState().assets.ast_free_gen).toBeUndefined();
    expect(useStore.getState().ui.toasts.some((t) => t.text.includes('BrandKit'))).toBe(true);

    // 3) purgeDiscarded keeps ast_old_v1 and deletes ast_disc_free
    purgeDiscarded('gen_disc');
    expect(useStore.getState().assets.ast_old_v1).toBeDefined();
    expect(useStore.getState().assets.ast_disc_free).toBeUndefined();

    // 4) deleteSession keeps ast_old_v1 (OLD version!) and ast_v2 and ast_subj
    deleteSession(s.id);
    expect(useStore.getState().assets.ast_old_v1).toBeDefined();
    expect(useStore.getState().assets.ast_v2).toBeDefined();
    expect(useStore.getState().assets.ast_subj).toBeDefined();
    expect(hoisted.blobs.has('asset:ast_old_v1')).toBe(true);
  });
});

describe('Contract 5 (engine) & 6: kits out of sends + library.kit.* commands + DOC_CREATORS', () => {
  it('treats @KitName as nonexistent in resolveSendPlan and excludes kits from legacy nodeLibrary capture', async () => {
    const s = resetStore();
    useStore.setState({ assets: { ast_1: { id: 'ast_1', kind: 'image', mime: 'image/png', width: 100, height: 100, sessionId: s.id, origin: 'upload', stored: true, favorite: false, createdAt: 1 } } });
    await createKit({ name: 'AcmeBrand', kind: 'brand-kit', space: 'library', by: 'user', pieces: [{ id: 'p1', kind: 'asset', assetId: 'ast_1' }] });
    saveSubject({ id: 'sub_hero', name: 'Hero', kind: 'character', frontalAssetId: 'ast_hero', refAssetIds: [] });
    const gen: Generation = {
      id: 'g_node', sessionId: s.id, kind: 'image', prompt: 'Portrait of @Hero', modelRef: 'm::1', modelName: 'M', provider: 'local',
      settings: { count: 1, advanced: {} }, inputs: { refs: [] }, status: 'done',
      assetIds: [], origin: 'node', estimate: { usd: 0, approximate: false }, createdAt: 1,
    };
    useStore.setState((st) => ({
      generations: { ...st.generations, g_node: gen },
      sessions: { ...st.sessions, [s.id]: { ...st.sessions[s.id], graph: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Img', outputIndex: 0, generationId: 'g_node', prompt: 'Portrait of @Hero', modelRef: 'm::1', settings: { count: 1, advanced: {} } } }], edges: [] } } },
    }));

    // resolveSendPlan with @AcmeBrand behaves identically to @NonExistent
    const withKit = resolveSendPlan({ kind: 'image', modelRef: 'm::1', prompt: 'Poster in @AcmeBrand style', settings: { count: 1, advanced: {} }, inputs: { refs: [] } }, useStore.getState());
    const withUnknown = resolveSendPlan({ kind: 'image', modelRef: 'm::1', prompt: 'Poster in @NonExistent style', settings: { count: 1, advanced: {} }, inputs: { refs: [] } }, useStore.getState());
    expect(withKit.slots.elements).toBeUndefined();
    expect(withKit.slots.refs).toEqual([]);
    expect(withUnknown.slots.elements).toBeUndefined();

    // Editing Hero captures legacy nodeLibrary WITHOUT kits
    saveSubject({ id: 'sub_hero', name: 'Hero', kind: 'character', description: 'v2', frontalAssetId: 'ast_hero', refAssetIds: [] });
    const captured = useStore.getState().generations.g_node.inputs.nodeLibrary ?? [];
    expect(captured.map((x) => x.name)).toEqual(['Hero']);
  });

  it('runs library.kit.* commands, enforces strict schemas, chains DOC_CREATORS in studio, and deletes via library.subject.delete', async () => {
    const s = resetStore();
    setApprover(() => true);

    // 1) create in studio with session -> draft + working doc view: 'studio' + chains $1.doc via DOC_CREATORS
    const chained = await runCommandsTool(s.id, {
      seq: [
        { cmd: 'library.kit.create', args: { name: 'StudioDS', kind: 'design-system', space: 'studio', tokens: { colors: { bg: '#111' } } } },
        { cmd: 'designer.layer.add_text', args: { text: 'Heading', x: 20, y: 20, width: 200 } },
      ],
    });
    expect(chained.done, chained.text).toBe(true);
    const createdKit = useStore.getState().library.find((x) => x.name === 'StudioDS')!;
    expect(createdKit.draft).toBe(true);
    expect(createdKit.origin?.space).toBe('studio');
    const studioDoc = useStore.getState().sessions[s.id].docs.find((d) => d.library?.subjectId === createdKit.id)!;
    expect(studioDoc.library?.view).toBe('studio');
    expect(studioDoc.layers.some((l) => l.type === 'text' && l.text === 'Heading')).toBe(true);

    // 2) update (valid + cycle rejected + strict rejects extra keys)
    const upd = await run({ cmd: 'library.kit.update', args: { id: createdKit.id, pieces: [{ id: 'p1', kind: 'color', color: '#111' }, { id: 'p2', kind: 'text', text: 'Ink' }], links: [{ id: 'l1', from: 'p1', to: 'p2', label: 'note' }] } }, { caller: 'agent' });
    expect(upd.ok).toBe(true);
    expect(await run({ cmd: 'library.kit.update', args: { id: createdKit.id, pieces: [{ id: 'c1', kind: 'kit', kitId: createdKit.id }] } }, { caller: 'agent' })).toMatchObject({ ok: false });
    expect(await run({ cmd: 'library.kit.create', args: { name: 'Bad', kind: 'moodboard', extra: 1 } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });

    // 3) save overwrite, copy, read, list with dependencies, open in designer, restore
    const saved = await run({ cmd: 'library.kit.save', on: { session: s.id, doc: studioDoc.id }, args: { id: createdKit.id, mode: 'overwrite', space: 'studio', label: 'v1' } }, { caller: 'agent' });
    expect(saved.ok).toBe(true);
    const v1Id = (saved.results[0] as Subject).versionId!;

    const brandRes = await run({ cmd: 'library.kit.create', args: { name: 'MasterKit', kind: 'brand-kit', space: 'library', pieces: [{ id: 'pk', kind: 'kit', kitId: createdKit.id }] } }, { caller: 'agent' });
    expect(brandRes.ok).toBe(true);
    const brandSubject = (brandRes.results[0] as { subject: Subject }).subject;
    const brandId = brandSubject.id;

    // Opening a kit without any saved document creates a new blank linked document
    const blankOpen = await run({ cmd: 'library.kit.open', on: { session: s.id }, args: { id: brandId, space: 'designer' } }, { caller: 'agent' });
    expect(blankOpen.ok).toBe(true);
    const blankDocId = (blankOpen.results[0] as { doc: string }).doc;
    expect(useStore.getState().sessions[s.id].docs.find((d) => d.id === blankDocId)?.library).toMatchObject({ subjectId: brandId, versionId: brandSubject.versionId });

    const listed = await run({ cmd: 'library.kit.list', args: {} }, { caller: 'agent' });
    expect(listed.ok).toBe(true);
    const rows = listed.results[0] as Array<{ id: string; dependencies: { kitIds: string[] }; usedBy: string[] }>;
    expect(rows.find((r) => r.id === createdKit.id)?.usedBy.length).toBe(1);

    const readRes = await run({ cmd: 'library.kit.read', args: { id: createdKit.id } }, { caller: 'agent' });
    expect(readRes.ok).toBe(true);

    const opened = await run({ cmd: 'library.kit.open', on: { session: s.id }, args: { id: createdKit.id, space: 'designer' } }, { caller: 'agent' });
    expect(opened.ok).toBe(true);
    expect(useStore.getState().sessions[s.id].docs.find((d) => d.id === studioDoc.id)?.library?.view).toBeUndefined();

    const restored = await run({ cmd: 'library.kit.restore', args: { id: createdKit.id, versionId: v1Id, space: 'library' } }, { caller: 'agent' });
    expect(restored.ok).toBe(true);
    expect((restored.results[0] as Subject).versions?.length).toBe(3);

    // 4) delete via library.subject.delete cleans blobs
    const delRes = await run({ cmd: 'library.subject.delete', args: { id: createdKit.id } }, { caller: 'agent' });
    expect(delRes.ok).toBe(true);
    expect(hoisted.blobs.has(`libver:${v1Id}`)).toBe(false);
    setApprover(null);
  });
});
