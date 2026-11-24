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
    setFailSet: (fn: ((key: string) => Error | null) | null) => { failSetAt = fn; },
    setFailGet: (fn: ((key: string) => Error | null) | null) => { failGetAt = fn; },
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { const err = failGetAt?.(key); if (err) throw err; return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> { if (!writerLock) return; const err = failSetAt?.(key); if (err) throw err; blobs.set(key, value); },
      async del(key: string): Promise<void> { if (!writerLock) return; blobs.delete(key); },
      async delMany(keys: string[]): Promise<void> { if (!writerLock) return; for (const k of keys) blobs.delete(k); },
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
import { isKit, KIT_KIND_LIST, mentionableSubjects } from '../src/engine/libraryTypes';
import { kitDependencies, kitUsedBy, libraryAssetOwners, libraryAssetSet, subjectAssetIds, wouldCreateKitCycle } from '../src/engine/libraryGraph';
import { createItem, libraryToDesigner, libraryToStudio, readKitVersion, renameItem, restoreItemVersion, saveItem, waitKitQueue } from '../src/engine/libraryVersions';
import { createDoc, newRasterLayer, newVectorLayer } from '../src/engine/design/doc';
import { addDoc } from '../src/engine/design/actions';
import { deleteSession } from '../src/engine/actions';
import { deleteAssets, deleteGeneration } from '../src/engine/assetActions';
import { purgeDiscarded } from '../src/engine/jobState';
import { createSession, useStore } from '../src/store/store';
import { resolveSendPlan } from '../src/engine/sendInputs';
import { run, setApprover } from '../src/engine/commands';
import { runCommandsTool } from '../src/engine/agent/commandCalls';
import type { Asset, Generation, RasterLayer, Subject } from '../src/engine/types';

async function blobBytes(b: Blob | undefined): Promise<Uint8Array> {
  return b ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array();
}

function resetStore() {
  const s = createSession('Origin');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => { hoisted.blobs.clear(); hoisted.setLock(true); hoisted.setFailSet(null); hoisted.setFailGet(null); });

describe('Contract 1 & 2: item types, graph, cycles, missing refs and assets', () => {
  it('keeps SUBJECT_KINDS unchanged and classifies items via KIT_KIND_LIST and isKit', () => {
    expect(SUBJECT_KINDS.map((k) => k.value)).toEqual(['character', 'object', 'product', 'location', 'style']);
    expect([...KIT_KIND_LIST]).toEqual(['moodboard', 'design-system', 'brand-kit']);
    const classic: Subject = { id: 's1', name: 'Hero', kind: 'character', refAssetIds: [] };
    const ds: Subject = { id: 'k1', name: 'AcmeDS', kind: 'design-system', refAssetIds: [] };
    const mb: Subject = { id: 'k2', name: 'AcmeMood', kind: 'moodboard', refAssetIds: [] };
    const kit: Subject = { id: 'k3', name: 'AcmeBrand', kind: 'brand-kit', refAssetIds: [] };
    expect(isKit(classic)).toBe(false);
    const legacy: Subject = { id: 's0', name: 'Legacy', refAssetIds: [] };
    expect(isKit(legacy)).toBe(false);
    expect(isKit(ds) && isKit(mb) && isKit(kit)).toBe(true);
    expect(mentionableSubjects([classic, ds, mb, kit]).map((x) => x.id)).toEqual(['s1']);
  });

  it('tracks dependencies, usedBy, missing refs, transitive cycles and assets across all versions', () => {
    const ds: Subject = {
      id: 'ds1', name: 'AcmeDS', kind: 'design-system', refAssetIds: [],
      graph: { nodes: [{ id: 'p1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Logo', assetId: 'ast_logo_v2' } }], edges: [] },
      tokens: { 'color.bg': { type: 'color', value: '#111' } },
      versions: [
        { id: 'lv1', at: 1, by: 'user', space: 'studio', label: 'v1', assetIds: ['ast_logo_v1'] },
        { id: 'lv2', at: 2, by: 'agent', space: 'designer', label: 'v2', assetIds: ['ast_logo_v2'] },
      ],
    };
    const mb: Subject = {
      id: 'mb1', name: 'AcmeMood', kind: 'moodboard', refAssetIds: [],
      graph: {
        nodes: [
          { id: 'p2', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Mood', assetId: 'ast_mood' } },
          { id: 'p3', position: { x: 200, y: 0 }, data: { kind: 'text', title: 'Note', text: 'Warm editorial light' } },
        ],
        edges: [{ id: 'l1', source: 'p2', target: 'p3', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref', label: 'lighting note' }],
      },
    };
    const brand: Subject = { id: 'bk1', name: 'AcmeBrand', kind: 'brand-kit', refAssetIds: [], kits: ['ds1', 'mb1', 'missing_kit'] };
    const lib = [ds, mb, brand];

    expect(kitDependencies(brand, lib)).toMatchObject({ kitIds: ['ds1', 'mb1'], missingKitIds: ['missing_kit'], assetIds: [] });
    expect(kitUsedBy('ds1', lib).map((x) => x.id)).toEqual(['bk1']);
    expect(kitUsedBy('mb1', lib).map((x) => x.id)).toEqual(['bk1']);
    expect(wouldCreateKitCycle(lib, 'ds1', ['ds1'])).toMatchObject({ ok: false });
    expect(wouldCreateKitCycle(lib, 'ds1', ['bk1'])).toMatchObject({ ok: false });
    expect(wouldCreateKitCycle(lib, 'ds1', ['mb1'])).toEqual({ ok: true });
    expect(subjectAssetIds(ds).sort()).toEqual(['ast_logo_v1', 'ast_logo_v2']);
    expect(libraryAssetSet(lib).has('ast_logo_v1')).toBe(true);
    expect(libraryAssetSet(lib).has('ast_mood')).toBe(true);
    expect(libraryAssetOwners(lib).get('ast_logo_v1')?.map((s) => s.id)).toEqual(['ds1']);
  });
});

describe('Contract 3: versions, pixels, copy, restore, failures, lock, delete', () => {
  it('round-trips through serialized persistence, edits pixels, overwrites, restores v1 with exact bytes, and reuses unchanged bytes', async () => {
    const s = resetStore();
    const { subject: kit } = await createItem({ name: 'AcmeDS', kind: 'design-system', space: 'studio', sessionId: s.id, by: 'agent', tokens: { 'color.bg': { type: 'color', value: '#111' } } });
    const baseLayer: RasterLayer = { ...newRasterLayer('Hero', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), paintBaseId: 'pb_1', rev: 1 };
    const staticLayer: RasterLayer = { ...newRasterLayer('Static', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), rev: 1 };
    const maskLayer: RasterLayer = { ...newRasterLayer('Mask', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), rev: 1 };
    const vecLayer = { ...newVectorLayer('Shapes', []), pixelMask: maskLayer };
    const workDoc = { ...createDoc('AcmeDS', 100, 100, '#111'), layers: [baseLayer, staticLayer, vecLayer], library: { subjectId: kit.id, versionId: '', view: 'studio' as const } };
    addDoc(s.id, workDoc);

    const bytesHeroV1 = new Uint8Array([1, 2, 3, 4]), bytesBaseV1 = new Uint8Array([9, 8, 7, 6]), bytesStatic = new Uint8Array([5, 5, 5, 5]), bytesMaskV1 = new Uint8Array([2, 4, 6, 8]);
    hoisted.blobs.set(`raster:${baseLayer.id}`, new Blob([bytesHeroV1], { type: 'image/png' }));
    hoisted.blobs.set('raster:pb_1', new Blob([bytesBaseV1], { type: 'image/png' }));
    hoisted.blobs.set(`raster:${staticLayer.id}`, new Blob([bytesStatic], { type: 'image/png' }));
    hoisted.blobs.set(`raster:${maskLayer.id}`, new Blob([bytesMaskV1], { type: 'image/png' }));

    const v1 = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: workDoc.id, space: 'studio', by: 'user', label: 'v1' });
    expect(v1.draft).toBe(false);
    const v1Id = v1.versionId!;
    const snap1 = await readKitVersion(v1Id);
    expect(snap1?.doc?.layers.length).toBe(3);

    const reloaded = JSON.parse(JSON.stringify({ library: useStore.getState().library, sessions: useStore.getState().sessions })) as { library: Subject[]; sessions: ReturnType<typeof useStore.getState>['sessions'] };
    useStore.setState({ library: reloaded.library, sessions: reloaded.sessions });

    const bytesHeroV2 = new Uint8Array([99, 98, 97, 96]);
    hoisted.blobs.set(`raster:${baseLayer.id}`, new Blob([bytesHeroV2], { type: 'image/png' }));
    useStore.setState((st) => ({
      sessions: { ...st.sessions, [s.id]: { ...st.sessions[s.id], docs: st.sessions[s.id].docs.map((d) => d.id === workDoc.id ? { ...d, layers: d.layers.map((l) => l.id === staticLayer.id ? { ...l, rev: 99 } : l) } : d) } },
    }));

    const v2 = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: workDoc.id, space: 'designer', by: 'user', label: 'v2' });
    const snap2 = await readKitVersion(v2.versionId!);
    expect(snap2!.doc!.layers[1].id).toBe(snap1!.doc!.layers[1].id);
    expect(snap2!.doc!.layers[0].id).not.toBe(snap1!.doc!.layers[0].id);
    expect(await blobBytes(hoisted.blobs.get(`raster:${snap2!.doc!.layers[0].id}`))).toEqual(bytesHeroV2);

    const v3 = await restoreItemVersion({ subjectId: kit.id, versionId: v1Id, space: 'library', by: 'user' });
    expect(v3.versions?.length).toBe(3);
    const restoredHero = (await readKitVersion(v3.versionId!))!.doc!.layers[0] as RasterLayer;
    expect(await blobBytes(hoisted.blobs.get(`raster:${restoredHero.id}`))).toEqual(bytesHeroV1);
    expect(await blobBytes(hoisted.blobs.get(`raster:${restoredHero.paintBaseId}`))).toEqual(bytesBaseV1);

    deleteSession(s.id);
    expect(useStore.getState().library.some((x) => x.id === kit.id)).toBe(true);
    expect(await blobBytes(hoisted.blobs.get(`raster:${restoredHero.id}`))).toEqual(bytesHeroV1);

    const s2 = useStore.getState().activeSessionId;
    const openedStudio = await libraryToStudio(s2, kit.id);
    expect(openedStudio.library).toMatchObject({ subjectId: kit.id, versionId: v3.versionId, view: 'studio' });
    expect(await blobBytes(hoisted.blobs.get(`raster:${openedStudio.layers[0].id}`))).toEqual(bytesHeroV1);
    const reopenedDesigner = await libraryToDesigner(s2, kit.id);
    expect(reopenedDesigner.id).toBe(openedStudio.id);
    expect(reopenedDesigner.library?.view).toBeUndefined();
  });

  it('gives copies independent pixels so deleting original or copy never affects the other, and unlinks open working docs', async () => {
    const s = resetStore();
    const { subject: orig } = await createItem({ name: 'Orig', kind: 'moodboard', space: 'designer', sessionId: s.id, by: 'user' });
    const lyr = { ...newRasterLayer('Img', { x: 0, y: 0, width: 4, height: 4 }, { width: 4, height: 4 }), rev: 1 };
    const doc = { ...createDoc('Orig', 100, 100, null), layers: [lyr], library: { subjectId: orig.id, versionId: '' } };
    addDoc(s.id, doc);
    const px = new Uint8Array([10, 20, 30, 40]);
    hoisted.blobs.set(`raster:${lyr.id}`, new Blob([px], { type: 'image/png' }));

    const savedOrig = await saveItem({ subjectId: orig.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' });
    const copy = await saveItem({ subjectId: orig.id, mode: 'copy', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user', name: 'Copy' });
    expect(copy.copiedFrom).toBe(orig.id);

    const origSnap = await readKitVersion(savedOrig.versionId!), copySnap = await readKitVersion(copy.versionId!);
    expect(copySnap!.doc!.layers[0].id).not.toBe(origSnap!.doc!.layers[0].id);

    deleteSubject(orig.id);
    await waitKitQueue(orig.id);
    expect(hoisted.blobs.has(`libver:${savedOrig.versionId}`)).toBe(true);
    expect(hoisted.blobs.has(`raster:${origSnap!.doc!.layers[0].id}`)).toBe(true);
    expect(await blobBytes(hoisted.blobs.get(`raster:${copySnap!.doc!.layers[0].id}`))).toEqual(px);
    const stillOpen = useStore.getState().sessions[s.id].docs.find((d) => d.id === doc.id)!;
    expect(stillOpen.library).toBeUndefined();
    expect(await blobBytes(hoisted.blobs.get(`raster:${lyr.id}`))).toEqual(px);
  });

  it('aborts with previous version intact on pixel write failure, blob write failure, missing blob, or missing writer lock', async () => {
    const s = resetStore();
    const { subject: kit } = await createItem({ name: 'SafeKit', kind: 'design-system', space: 'designer', sessionId: s.id, by: 'user' });
    const lyr = { ...newRasterLayer('Img', { x: 0, y: 0, width: 4, height: 4 }, { width: 4, height: 4 }), rev: 1 };
    const doc = { ...createDoc('SafeKit', 100, 100, null), layers: [lyr], library: { subjectId: kit.id, versionId: '' } };
    addDoc(s.id, doc);
    hoisted.blobs.set(`raster:${lyr.id}`, new Blob([new Uint8Array([1, 1])], { type: 'image/png' }));
    const v1 = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' });
    hoisted.blobs.set(`raster:${lyr.id}`, new Blob([new Uint8Array([2, 2])], { type: 'image/png' }));

    hoisted.setFailSet((k) => k.startsWith('raster:') ? new Error('disk full on pixels') : null);
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' })).rejects.toThrow(/disk full/i);
    expect(useStore.getState().library.find((x) => x.id === kit.id)?.versionId).toBe(v1.versionId);

    hoisted.setFailSet((k) => k.startsWith('libver:') ? new Error('disk full on libver') : null);
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' })).rejects.toThrow(/disk full/i);
    hoisted.setFailSet(null);

    hoisted.setLock(false);
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' })).rejects.toThrow(/verify|lock/i);
    hoisted.setLock(true);

    hoisted.blobs.delete(`raster:${lyr.id}`);
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' })).rejects.toThrow(/missing/i);
    await expect(restoreItemVersion({ subjectId: kit.id, versionId: 'lv_missing', space: 'library', by: 'user' })).rejects.toThrow(/missing/i);

    const origOrigin = v1.origin;
    const updated = renameItem(kit.id, { name: 'RenamedKit' });
    expect(updated.origin).toEqual(origOrigin);
    expect(libraryItem('RenamedKit')).toBeUndefined();
    saveSubject({ id: 'sub_classic', name: 'ClassicHero', kind: 'character', refAssetIds: [] });
    expect(libraryItem('ClassicHero')?.id).toBe('sub_classic');
  });
});

describe('Contract 4: image protection across deleteSession, purgeDiscarded, deleteAssets, deleteGeneration', () => {
  const mkAsset = (id: string, sessionId: string, generationId?: string): Asset => ({ id, kind: 'image', mime: 'image/png', width: 100, height: 100, sessionId, generationId, origin: 'generated', stored: true, favorite: false, createdAt: 1 });

  it('protects assets from OLD versions on deleteSession and purgeDiscarded, and keeps library-used assets with toast', async () => {
    const s = resetStore();
    useStore.setState({ assets: { ast_old_v1: mkAsset('ast_old_v1', s.id, 'gen_1'), ast_v2: mkAsset('ast_v2', s.id) } });
    const { subject: kit } = await createItem({
      name: 'BrandKit', kind: 'brand-kit', space: 'studio', sessionId: s.id, by: 'user',
      graph: { nodes: [{ id: 'p1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'V1', assetId: 'ast_old_v1' } }], edges: [] },
    });
    await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, space: 'studio', by: 'user', label: 'v1' });
    await saveItem({
      subjectId: kit.id, mode: 'overwrite', sessionId: s.id, space: 'studio', by: 'user', label: 'v2',
      graph: { nodes: [{ id: 'p2', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'V2', assetId: 'ast_v2' } }], edges: [] },
    });
    saveSubject({ id: 'sub_c', name: 'Hero', kind: 'character', frontalAssetId: 'ast_subj', refAssetIds: [] });

    const gen: Generation = { id: 'gen_1', sessionId: s.id, kind: 'image', prompt: 'p', modelRef: 'm', modelName: 'M', provider: 'local', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, status: 'done', assetIds: ['ast_old_v1', 'ast_free_gen'], origin: 'composer', estimate: { usd: 0, approximate: false }, createdAt: 1 };
    const discGen: Generation = { ...gen, id: 'gen_disc', discard: true, assetIds: ['ast_old_v1', 'ast_disc_free'] };
    useStore.setState({
      assets: { ast_old_v1: mkAsset('ast_old_v1', s.id, 'gen_1'), ast_v2: mkAsset('ast_v2', s.id), ast_subj: mkAsset('ast_subj', s.id), ast_free: mkAsset('ast_free', s.id), ast_free_gen: mkAsset('ast_free_gen', s.id, 'gen_1'), ast_disc_free: mkAsset('ast_disc_free', s.id, 'gen_disc') },
      generations: { gen_1: gen, gen_disc: discGen },
      ui: { ...useStore.getState().ui, toasts: [] },
    });
    for (const id of ['ast_old_v1', 'ast_v2', 'ast_subj', 'ast_free', 'ast_free_gen', 'ast_disc_free']) hoisted.blobs.set(`asset:${id}`, new Blob(['img']));

    deleteAssets(['ast_old_v1', 'ast_subj', 'ast_free']);
    expect(useStore.getState().assets.ast_old_v1).toBeDefined();
    expect(useStore.getState().assets.ast_free).toBeUndefined();
    expect(useStore.getState().ui.toasts.some((t) => t.text.includes('BrandKit') && t.text.includes('Hero'))).toBe(true);

    useStore.setState((st) => ({ ui: { ...st.ui, toasts: [] } }));
    deleteGeneration('gen_1');
    expect(useStore.getState().assets.ast_old_v1).toBeDefined();
    expect(useStore.getState().assets.ast_free_gen).toBeUndefined();
    expect(useStore.getState().ui.toasts.some((t) => t.text.includes('BrandKit'))).toBe(true);

    purgeDiscarded('gen_disc');
    expect(useStore.getState().assets.ast_old_v1).toBeDefined();
    expect(useStore.getState().assets.ast_disc_free).toBeUndefined();

    deleteSession(s.id);
    expect(useStore.getState().assets.ast_old_v1).toBeDefined();
    expect(useStore.getState().assets.ast_v2).toBeDefined();
    expect(hoisted.blobs.has('asset:ast_old_v1')).toBe(true);
  });
});

describe('Contract 5 (engine) & 6: kits out of sends + library.item.* commands + DOC_CREATORS', () => {
  it('treats @ItemName as nonexistent in resolveSendPlan and excludes items from legacy nodeLibrary capture', async () => {
    const s = resetStore();
    useStore.setState({ assets: { ast_1: { id: 'ast_1', kind: 'image', mime: 'image/png', width: 100, height: 100, sessionId: s.id, origin: 'upload', stored: true, favorite: false, createdAt: 1 } } });
    await createItem({ name: 'AcmeBrand', kind: 'brand-kit', space: 'library', by: 'user', graph: { nodes: [{ id: 'p1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'A', assetId: 'ast_1' } }], edges: [] } });
    saveSubject({ id: 'sub_hero', name: 'Hero', kind: 'character', frontalAssetId: 'ast_hero', refAssetIds: [] });
    const gen: Generation = { id: 'g_node', sessionId: s.id, kind: 'image', prompt: 'Portrait of @Hero', modelRef: 'm::1', modelName: 'M', provider: 'local', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, status: 'done', assetIds: [], origin: 'node', estimate: { usd: 0, approximate: false }, createdAt: 1 };
    useStore.setState((st) => ({
      generations: { ...st.generations, g_node: gen },
      sessions: { ...st.sessions, [s.id]: { ...st.sessions[s.id], graph: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Img', outputIndex: 0, generationId: 'g_node', prompt: 'Portrait of @Hero', modelRef: 'm::1', settings: { count: 1, advanced: {} } } }], edges: [] } } },
    }));
    const withKit = resolveSendPlan({ kind: 'image', modelRef: 'm::1', prompt: 'Poster in @AcmeBrand style', settings: { count: 1, advanced: {} }, inputs: { refs: [] } }, useStore.getState());
    expect(withKit.slots.elements).toBeUndefined();
    expect(withKit.slots.refs).toEqual([]);
    saveSubject({ id: 'sub_hero', name: 'Hero', kind: 'character', description: 'v2', frontalAssetId: 'ast_hero', refAssetIds: [] });
    expect((useStore.getState().generations.g_node.inputs.nodeLibrary ?? []).map((x) => x.name)).toEqual(['Hero']);
  });

  it('runs library.item.* commands, enforces strict schemas, chains DOC_CREATORS in studio, and deletes via library.item.delete', async () => {
    const s = resetStore();
    setApprover(() => true);
    const chained = await runCommandsTool(s.id, {
      seq: [
        { cmd: 'library.item.create', args: { name: 'StudioDS', kind: 'design-system', space: 'studio', tokens: { 'color.bg': { type: 'color', value: '#111' } } } },
        { cmd: 'designer.layer.add_text', args: { text: 'Heading', x: 20, y: 20, width: 200 } },
      ],
    });
    expect(chained.done, chained.text).toBe(true);
    const createdKit = useStore.getState().library.find((x) => x.name === 'StudioDS')!;
    expect(createdKit.draft).toBe(true);
    const studioDoc = useStore.getState().sessions[s.id].docs.find((d) => d.library?.subjectId === createdKit.id)!;
    expect(studioDoc.library?.view).toBe('studio');
    expect(studioDoc.layers.some((l) => l.type === 'text' && l.text === 'Heading')).toBe(true);

    expect(await run({ cmd: 'library.item.create', args: { name: 'Bad', kind: 'moodboard', extra: 1 } }, { caller: 'agent' })).toMatchObject({ ok: false, error: { code: 'invalid' } });

    const saved = await run({ cmd: 'library.item.save', on: { session: s.id, doc: studioDoc.id }, args: { id: createdKit.id, mode: 'overwrite', space: 'studio', label: 'v1' } }, { caller: 'agent' });
    expect(saved.ok).toBe(true);
    const v1Id = (saved.results[0] as { id: string; versionId: string }).versionId;

    const brandRes = await run({ cmd: 'library.item.create', args: { name: 'MasterKit', kind: 'brand-kit', space: 'library', kits: [createdKit.id] } }, { caller: 'agent' });
    expect(brandRes.ok).toBe(true);
    const brandId = (brandRes.results[0] as { id: string }).id;
    expect(await run({ cmd: 'library.item.save', args: { id: createdKit.id, mode: 'overwrite', kits: [brandId] } }, { caller: 'agent' })).toMatchObject({ ok: false });

    const blankOpen = await run({ cmd: 'library.item.open', on: { session: s.id }, args: { id: brandId, space: 'designer' } }, { caller: 'agent' });
    expect(blankOpen.ok).toBe(true);

    const delRes = await run({ cmd: 'library.item.delete', args: { id: createdKit.id } }, { caller: 'agent' });
    expect(delRes.ok).toBe(true);
    expect(hoisted.blobs.has(`libver:${v1Id}`)).toBe(true);
    setApprover(null);
  });
});
