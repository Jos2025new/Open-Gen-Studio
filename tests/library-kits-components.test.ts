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

import { formatLibraryItemIndex, kitDependencies } from '../src/engine/libraryGraph';
import { createItem, libraryToDesigner, readKitVersion, restoreItemVersion, saveItem } from '../src/engine/libraryVersions';
import { newRasterLayer, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { groupLayers, patchGroup, setGroupFlag, ungroup } from '../src/engine/design/groups';
import { createSession, setDoc, useStore } from '../src/store/store';
import type { Graph, RasterLayer } from '../src/engine/types';

async function blobBytes(b: Blob | undefined): Promise<Uint8Array> {
  return b ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array();
}

function resetStore() {
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => { hoisted.blobs.clear(); });

describe('Designer group components, tokens, written guidelines, and remapDoc survival', () => {
  it('indexes Designer groups as components, tokens with descriptions, section texts, and missing token refs in doc', async () => {
    const s = resetStore();
    const { subject: kit, doc } = await createItem({
      name: 'AcmeDS', kind: 'design-system', space: 'studio', sessionId: s.id, by: 'agent',
      tokens: {
        'color.primario': { type: 'color', value: '#2255ff', description: 'Primary CTA fill' },
        'color.accion': { type: 'color', value: '{color.primario}' },
        'font.display': { type: 'fontFamily', value: 'Inter' },
        'space.md': { type: 'dimension', value: '16px' },
      },
    });

    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'agent', tokens: { bad: { type: 'color', value: '{color.nope}' } } })).rejects.toThrow(/color\.nope/i);
    await expect(saveItem({ subjectId: kit.id, mode: 'overwrite', space: 'library', by: 'agent', graph: { nodes: [{ id: 'bad_txt', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Empty', text: '   ' } }], edges: [] } })).rejects.toThrow(/text/i);

    const l1 = newTextLayer('BtnText', 'Buy', { x: 10, y: 10, width: 80 }, { color: '#2255ff', colorToken: { kit: kit.id, token: 'color.ghost', value: '#2255ff' } });
    const l2 = newVectorLayer('BtnBg', [{ type: 'rect', x: 0, y: 0, w: 120, h: 44, fill: '#2255ff', fillToken: { kit: kit.id, token: 'color.accion', value: '#2255ff' }, stroke: null, strokeWidth: 0, radius: 8 }]);
    setDoc(s.id, doc!.id, (d) => ({ ...d, layers: [l2, l1] }));
    const gid = groupLayers(s.id, doc!.id, [l2.id, l1.id])!;
    patchGroup(s.id, doc!.id, gid, { name: 'Primary Button' });

    const graph: Graph = {
      nodes: [
        { id: 'g_cta', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'Buttons', text: 'One primary CTA per view', section: 'Guidelines' } },
      ],
      edges: [],
    };
    const updated = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, docId: doc!.id, space: 'studio', by: 'user', graph });
    const savedDoc = (await readKitVersion(updated.versionId!))!.doc!;

    const dep = kitDependencies(updated, useStore.getState().library, savedDoc);
    expect(dep.tokenIds.sort()).toEqual(['color.accion', 'color.ghost', 'color.primario']);
    expect(dep.missingTokenIds).toEqual(['color.ghost']);

    const index = formatLibraryItemIndex(updated, useStore.getState().library, {}, 2500, savedDoc).text;
    expect(index).toContain(`component ${gid} "Primary Button"`);
    expect(index).toContain('token color.primario (color): #2255ff — Primary CTA fill');
    expect(index).toContain('in Guidelines: One primary CTA per view');
    expect(index).toContain('token:color.ghost');
  });

  it('groupId and member layers survive save, open, copy, and restore (remapDoc)', async () => {
    const s1 = resetStore();
    const s2 = createSession('S2');
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: s2 } }));

    const { subject: kit, doc } = await createItem({ name: 'GroupKit', kind: 'design-system', space: 'studio', sessionId: s1.id, by: 'user' });
    const r: RasterLayer = { ...newRasterLayer('IconPx', { x: 0, y: 0, width: 24, height: 24 }, { width: 24, height: 24 }), rev: 1 };
    const t = newTextLayer('Label', 'Submit', { x: 30, y: 4, width: 100 });
    const v = newVectorLayer('Pill', [{ type: 'rect', x: 0, y: 0, w: 140, h: 40, fill: '#000', stroke: null, strokeWidth: 0, radius: 12 }]);
    setDoc(s1.id, doc!.id, (d) => ({ ...d, layers: [v, r, t] }));
    const px = new Uint8Array([42, 43, 44, 45]);
    hoisted.blobs.set(`raster:${r.id}`, new Blob([px], { type: 'image/png' }));

    const gid = groupLayers(s1.id, doc!.id, [v.id, r.id, t.id])!;
    patchGroup(s1.id, doc!.id, gid, { name: 'ActionPill' });
    setDoc(s1.id, doc!.id, (d) => ({ ...d, layers: d.layers.map((l) => (l.id === r.id ? { ...l, visible: false } : l)) }));
    setGroupFlag(s1.id, doc!.id, gid, 'visible', false);

    const v1 = await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s1.id, docId: doc!.id, space: 'studio', by: 'user', label: 'v1' });
    const snap1 = await readKitVersion(v1.versionId!);
    expect(snap1?.doc?.groups?.some((g) => g.id === gid && g.name === 'ActionPill')).toBe(true);
    const snapRaster = snap1!.doc!.layers.find((l) => l.type === 'raster')!;
    expect(snap1!.doc!.groups![0].keptHidden).toEqual([snapRaster.id]);

    const d2 = await libraryToDesigner(s2.id, kit.id);
    expect(d2.groups?.some((g) => g.id === gid && g.name === 'ActionPill')).toBe(true);
    const d2Raster = d2.layers.find((l) => l.type === 'raster')!;
    expect(d2.groups![0].keptHidden).toEqual([d2Raster.id]);
    expect(await blobBytes(hoisted.blobs.get(`raster:${d2Raster.id}`))).toEqual(px);

    const copy = await saveItem({ subjectId: kit.id, mode: 'copy', sessionId: s2.id, docId: d2.id, space: 'designer', by: 'user', name: 'GroupKit Copy' });
    expect((await readKitVersion(copy.versionId!))?.doc?.groups?.some((g) => g.id === gid)).toBe(true);

    ungroup(s2.id, d2.id, gid);
    await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s2.id, docId: d2.id, space: 'designer', by: 'user', label: 'v2' });
    await restoreItemVersion({ subjectId: kit.id, versionId: v1.versionId!, space: 'library', by: 'user' });
    const dRestored = await libraryToDesigner(s2.id, kit.id);
    expect(dRestored.groups?.some((g) => g.id === gid && g.name === 'ActionPill')).toBe(true);
    expect(await blobBytes(hoisted.blobs.get(`raster:${dRestored.layers.find((l) => l.type === 'raster')!.id}`))).toEqual(px);
  });
});
