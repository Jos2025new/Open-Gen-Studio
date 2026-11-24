import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  let writerLock = true;
  let failSetAt: ((key: string) => Error | null) | null = null;
  let onSetHook: ((key: string) => void | Promise<void>) | null = null;
  return {
    blobs,
    setLock: (v: boolean) => { writerLock = v; },
    setFailSet: (fn: ((key: string) => Error | null) | null) => { failSetAt = fn; },
    setOnSet: (fn: ((key: string) => void | Promise<void>) | null) => { onSetHook = fn; },
    blobDb: {
      async get(key: string): Promise<Blob | undefined> { return blobs.get(key); },
      async set(key: string, value: Blob): Promise<void> { if (!writerLock) return; if (onSetHook) await onSetHook(key); const err = failSetAt?.(key); if (err) throw err; blobs.set(key, value); },
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

import { saveSubject } from '../src/engine/libraryActions';
import { createItem, libraryToDesigner, readKitVersion, restoreItemVersion, saveItem } from '../src/engine/libraryVersions';
import { createDoc, newRasterLayer, newTextLayer, touch } from '../src/engine/design/doc';
import { addDoc, selectDoc } from '../src/engine/design/actions';
import { ensureBuffers } from '../src/engine/design/raster';
import { createSession, setDoc, useStore } from '../src/store/store';
import { run, setApprover } from '../src/engine/commands';
import { runCommandsTool } from '../src/engine/agent/commandCalls';
import type { Asset, RasterLayer, Subject } from '../src/engine/types';

async function blobBytes(b: Blob | undefined): Promise<Uint8Array> {
  return b ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array();
}

function mkAsset(id: string, sessionId: string): Asset {
  return { id, sessionId, kind: 'image', mime: 'image/png', width: 64, height: 64, origin: 'upload', stored: true, favorite: false, createdAt: 1 };
}

function resetStore() {
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => { hoisted.blobs.clear(); hoisted.setLock(true); hoisted.setFailSet(null); hoisted.setOnSet(null); setApprover(null); });

describe('Hardening guarantees (versioning, rasters, races, rollback)', () => {
  it('1) library.item.save ignores ctx.on.doc from runCommandsTool and only uses explicit args.doc for another doc', async () => {
    const s = resetStore();
    const { subject: kit } = await createItem({ name: 'Palette', kind: 'design-system', space: 'library', by: 'user' });
    const unrelated = { ...createDoc('Unrelated Poster', 800, 600, '#fff'), layers: [newTextLayer('Secret', 'DO NOT SAVE', { x: 0, y: 0, width: 100 })] };
    addDoc(s.id, unrelated);
    selectDoc(s.id, unrelated.id);

    const res = await runCommandsTool(s.id, { seq: [{ cmd: 'library.item.save', args: { id: kit.id, mode: 'overwrite', label: 'meta-only' } }] });
    expect(res.done, res.text).toBe(true);
    expect((await readKitVersion(useStore.getState().library.find((x) => x.id === kit.id)!.versionId!))?.doc).toBeUndefined();

    const resExplicit = await runCommandsTool(s.id, { seq: [{ cmd: 'library.item.save', args: { id: kit.id, mode: 'overwrite', doc: unrelated.id, label: 'explicit' } }] });
    expect(resExplicit.done, resExplicit.text).toBe(true);
    const snap2 = await readKitVersion(useStore.getState().library.find((x) => x.id === kit.id)!.versionId!);
    expect(snap2?.doc?.layers.some((l) => l.type === 'text' && l.text === 'DO NOT SAVE')).toBe(true);
  });

  it('2) overwrite without working copy fails with reason when current version blob is missing or unreadable', async () => {
    const s = resetStore();
    const { subject: kit, doc } = await createItem({ name: 'Kit2', kind: 'moodboard', space: 'studio', sessionId: s.id, by: 'user' });
    const v1 = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'studio', by: 'user' });
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s.id]: { ...st.sessions[s.id], docs: [] } } }));

    hoisted.blobs.delete(`libver:${v1.versionId}`);
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'user' })).rejects.toThrow(/missing|unreadable/i);
    hoisted.blobs.set(`libver:${v1.versionId}`, new Blob(['{broken-json'], { type: 'application/json' }));
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'user' })).rejects.toThrow(/missing|unreadable/i);
  });

  it('3) allows new empty raster layers, tracks storedRasterIds, and aborts on missing paintBaseId, unreadable layer, or lost stored blob', async () => {
    const s = resetStore();
    const { subject: kit } = await createItem({ name: 'RasterKit', kind: 'design-system', space: 'designer', sessionId: s.id, by: 'user' });
    const emptyLayer = newRasterLayer('EmptyNew', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 });
    const paintedLayer: RasterLayer = { ...newRasterLayer('Painted', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), rev: 1 };
    const doc = { ...createDoc('RasterKit', 100, 100, null), layers: [emptyLayer, paintedLayer], library: { subjectId: kit.id, versionId: '' } };
    addDoc(s.id, doc);
    const px = new Uint8Array([7, 8, 9]);
    hoisted.blobs.set(`raster:${paintedLayer.id}`, new Blob([px], { type: 'image/png' }));

    const v1 = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc.id, space: 'designer', by: 'user' });
    const snap = await readKitVersion(v1.versionId!);
    expect(snap?.storedRasterIds).toEqual([snap!.doc!.layers[1].id]);

    const s2 = createSession('S2');
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: s2 } }));
    const opened = await libraryToDesigner(s2.id, kit.id);
    expect(hoisted.blobs.has(`raster:${opened.layers[0].id}`)).toBe(false);
    expect(await blobBytes(hoisted.blobs.get(`raster:${opened.layers[1].id}`))).toEqual(px);

    hoisted.blobs.delete(`raster:${snap!.doc!.layers[1].id}`);
    const s3 = createSession('S3');
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s3.id]: s3 } }));
    await expect(libraryToDesigner(s3.id, kit.id)).rejects.toThrow(/missing/i);
    await expect(restoreItemVersion({ subjectId: kit.id, versionId: v1.versionId!, space: 'library', by: 'user' })).rejects.toThrow(/missing/i);

    const badBase: RasterLayer = { ...newRasterLayer('HasBase', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), paintBaseId: 'pb_missing' };
    const docBadBase = { ...createDoc('BadBase', 100, 100, null), layers: [badBase] };
    addDoc(s.id, docBadBase);
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: docBadBase.id, space: 'designer', by: 'user' })).rejects.toThrow(/missing/i);

    const badLayer: RasterLayer = { ...newRasterLayer('Corrupt', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), rev: 0 };
    hoisted.blobs.set(`raster:${badLayer.id}`, new Blob(['not-an-image'], { type: 'image/png' }));
    await ensureBuffers([badLayer]);
    const docBadRead = { ...createDoc('Unreadable', 100, 100, null), layers: [badLayer] };
    addDoc(s.id, docBadRead);
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: docBadRead.id, space: 'designer', by: 'user' })).rejects.toThrow(/unreadable/i);
  });

  it('4) re-reads state on commit, cleans up if deleted mid-flight, queues delete, and rolls back partial blobs', async () => {
    const s = resetStore();
    const { subject: kit, doc } = await createItem({ name: 'OrigName', kind: 'design-system', space: 'studio', sessionId: s.id, by: 'user' });
    const lyr: RasterLayer = { ...newRasterLayer('P', { x: 0, y: 0, width: 4, height: 4 }, { width: 4, height: 4 }), rev: 1 };
    setDoc(s.id, doc!.id, (d) => touch({ ...d, layers: [lyr] }));
    hoisted.blobs.set(`raster:${lyr.id}`, new Blob([new Uint8Array([1, 2])], { type: 'image/png' }));

    let renamedOnce = false;
    hoisted.setOnSet((k) => {
      if (renamedOnce || !k.startsWith('libver:')) return;
      renamedOnce = true;
      useStore.setState((st) => ({ library: st.library.map((x) => x.id === kit.id ? { ...x, name: 'RenamedMidSave' } : x) }));
    });
    const v1 = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'studio', by: 'user' });
    expect(v1.name).toBe('RenamedMidSave');

    hoisted.blobs.set(`raster:${lyr.id}`, new Blob([new Uint8Array([3, 4])], { type: 'image/png' }));
    const keysBefore = new Set(hoisted.blobs.keys());
    hoisted.setOnSet((k) => { if (k.startsWith('libver:')) useStore.setState((st) => ({ library: st.library.filter((x) => x.id !== kit.id) })); });
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'studio', by: 'user' })).rejects.toThrow(/deleted/i);
    expect([...hoisted.blobs.keys()].filter((k) => !keysBefore.has(k))).toEqual([]);

    hoisted.setOnSet(null);
    const { subject: kit2, doc: doc2 } = await createItem({ name: 'RaceDel', kind: 'moodboard', space: 'studio', sessionId: s.id, by: 'user' });
    const lyr2: RasterLayer = { ...newRasterLayer('P2', { x: 0, y: 0, width: 4, height: 4 }, { width: 4, height: 4 }), rev: 1 };
    setDoc(s.id, doc2!.id, (d) => touch({ ...d, layers: [lyr2] }));
    hoisted.blobs.set(`raster:${lyr2.id}`, new Blob([new Uint8Array([5, 6])], { type: 'image/png' }));
    let releaseSave!: () => void;
    const gate = new Promise<void>((r) => { releaseSave = r; });
    hoisted.setOnSet((k) => k.startsWith('libver:') ? gate : undefined);
    const savePromise = saveItem({ subjectId: kit2.id, mode: 'overwrite', sessionId: s.id, docId: doc2!.id, space: 'studio', by: 'user' });
    const deletion = run({ cmd: 'library.subject.delete', args: { id: kit2.id } }, { caller: 'ui' });
    releaseSave();
    const savedV = await savePromise;
    expect(await deletion).toMatchObject({ ok: true });
    expect(useStore.getState().library.some((x) => x.id === kit2.id)).toBe(false);
    expect(hoisted.blobs.has(`libver:${savedV.versionId}`)).toBe(true);
  });

  it('5) rejects saveSubject overwriting a kit and validates missing assets in graph nodes', async () => {
    const s = resetStore();
    useStore.setState({ assets: { real_a: mkAsset('real_a', s.id) } });
    const { subject: kit } = await createItem({ name: 'BrandKit', kind: 'brand-kit', space: 'library', by: 'user' });
    expect(await run({ cmd: 'library.subject.save', args: { subject: { id: kit.id, name: 'Hijack', kind: 'character', refAssetIds: [] } } }, { caller: 'agent' })).toMatchObject({ ok: false });
    expect(() => saveSubject({ id: kit.id, name: 'Hijack', kind: 'character', refAssetIds: [] })).toThrow(/kit/i);
    await expect(createItem({ name: 'BadAsset', kind: 'moodboard', space: 'library', by: 'user', graph: { nodes: [{ id: 'p1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'A', assetId: 'nope' } }], edges: [] } })).rejects.toThrow(/missing asset/i);
  });
});

describe('Full-cycle test (commands + bytes + serialized reload midway)', () => {
  it('create in studio -> edit -> save -> reload -> open in S2 -> edit & save -> S1 open (detaches old!) -> restore v1 -> copy -> delete original -> open copy', async () => {
    const s1 = resetStore();
    const s2 = createSession('S2');
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: s2 } }));
    setApprover(() => true);

    const created = await runCommandsTool(s1.id, {
      seq: [
        { cmd: 'library.item.create', args: { name: 'CycleBrand', kind: 'brand-kit', space: 'studio', tokens: { 'color.brand': { type: 'color', value: '#ff5500' } } } },
        { cmd: 'designer.layer.add_text', args: { text: 'V1 Headline', x: 10, y: 10, width: 200 } },
      ],
    });
    expect(created.done, created.text).toBe(true);
    const kit = useStore.getState().library.find((x) => x.name === 'CycleBrand')!;
    const d1 = useStore.getState().sessions[s1.id].docs.find((d) => d.library?.subjectId === kit.id)!;

    const pxV1 = new Uint8Array([11, 22, 33, 44]);
    const rPainted: RasterLayer = { ...newRasterLayer('LogoPx', { x: 0, y: 0, width: 4, height: 4 }, { width: 4, height: 4 }), rev: 1 };
    const rEmpty = newRasterLayer('EmptyScratch', { x: 0, y: 0, width: 4, height: 4 }, { width: 4, height: 4 });
    setDoc(s1.id, d1.id, (d) => touch({ ...d, layers: [...d.layers, rPainted, rEmpty] }));
    hoisted.blobs.set(`raster:${rPainted.id}`, new Blob([pxV1], { type: 'image/png' }));

    expect((await runCommandsTool(s1.id, { seq: [{ cmd: 'library.item.save', args: { id: kit.id, mode: 'overwrite', space: 'studio', doc: d1.id, label: 'v1' } }] })).done).toBe(true);
    const v1Id = useStore.getState().library.find((x) => x.id === kit.id)!.versionId!;

    const reloaded = JSON.parse(JSON.stringify({ library: useStore.getState().library, sessions: useStore.getState().sessions, activeSessionId: useStore.getState().activeSessionId })) as { library: Subject[]; sessions: ReturnType<typeof useStore.getState>['sessions']; activeSessionId: string };
    useStore.setState({ library: reloaded.library, sessions: reloaded.sessions, activeSessionId: reloaded.activeSessionId });

    expect((await runCommandsTool(s2.id, { seq: [{ cmd: 'library.item.open', args: { id: kit.id, space: 'designer' } }] })).done).toBe(true);
    const d2 = useStore.getState().sessions[s2.id].docs.find((d) => d.library?.subjectId === kit.id)!;
    const d2Painted = d2.layers.find((l) => l.name === 'LogoPx')!;
    expect(await blobBytes(hoisted.blobs.get(`raster:${d2Painted.id}`))).toEqual(pxV1);

    const pxV2 = new Uint8Array([99, 88, 77, 66]);
    hoisted.blobs.set(`raster:${d2Painted.id}`, new Blob([pxV2], { type: 'image/png' }));
    expect((await runCommandsTool(s2.id, { seq: [{ cmd: 'designer.layer.add_text', on: { doc: d2.id }, args: { text: 'V2 Tagline', x: 10, y: 80, width: 200 } }, { cmd: 'library.item.save', args: { id: kit.id, mode: 'overwrite', space: 'designer', doc: d2.id, label: 'v2' } }] })).done).toBe(true);

    expect((await runCommandsTool(s1.id, { seq: [{ cmd: 'library.item.open', args: { id: kit.id, space: 'designer' } }] })).done).toBe(true);
    const d1Old = useStore.getState().sessions[s1.id].docs.find((d) => d.id === d1.id)!;
    expect(d1Old.library).toBeUndefined();
    expect(d1Old.view).toBe('studio');
    const d1v2 = useStore.getState().sessions[s1.id].docs.find((d) => d.library?.subjectId === kit.id)!;
    expect(await blobBytes(hoisted.blobs.get(`raster:${d1v2.layers.find((l) => l.name === 'LogoPx')!.id}`))).toEqual(pxV2);

    expect((await run({ cmd: 'library.item.restore', args: { id: kit.id, versionId: v1Id, space: 'library' } }, { caller: 'agent' })).ok).toBe(true);
    expect((await runCommandsTool(s1.id, { seq: [{ cmd: 'library.item.open', args: { id: kit.id, space: 'designer' } }] })).done).toBe(true);
    const d1v1 = useStore.getState().sessions[s1.id].docs.find((d) => d.library?.subjectId === kit.id)!;
    expect(await blobBytes(hoisted.blobs.get(`raster:${d1v1.layers.find((l) => l.name === 'LogoPx')!.id}`))).toEqual(pxV1);

    const copyRes = await run({ cmd: 'library.item.save', on: { session: s1.id }, args: { id: kit.id, mode: 'copy', name: 'CycleBrand Copy', space: 'designer' } }, { caller: 'agent' });
    const copyKit = copyRes.results[0] as { id: string; versionId?: string };
    expect((await run({ cmd: 'library.item.delete', args: { id: kit.id } }, { caller: 'agent' })).ok).toBe(true);

    expect((await runCommandsTool(s2.id, { seq: [{ cmd: 'library.item.open', args: { id: copyKit.id, space: 'designer' } }] })).done).toBe(true);
    const dCopy = useStore.getState().sessions[s2.id].docs.find((d) => d.library?.subjectId === copyKit.id)!;
    expect(await blobBytes(hoisted.blobs.get(`raster:${dCopy.layers.find((l) => l.name === 'LogoPx')!.id}`))).toEqual(pxV1);
  });
});
