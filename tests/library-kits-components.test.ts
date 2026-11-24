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

import { buildLibraryIndex, kitDependencies, libraryContextLines } from '../src/engine/libraryGraph';
import { createKit, openKit, readKitVersion, restoreKitVersion, saveKit, updateKit } from '../src/engine/libraryVersions';
import { newRasterLayer, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { groupLayers, patchGroup, setGroupFlag, ungroup } from '../src/engine/design/groups';
import { createSession, setDoc, useStore } from '../src/store/store';
import { run } from '../src/engine/commands';
import type { RasterLayer } from '../src/engine/types';

async function blobBytes(b: Blob | undefined): Promise<Uint8Array> {
  return b ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array();
}

function resetStore() {
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => {
  hoisted.blobs.clear();
});

describe('Part 2: component & style pieces, missing groups, token deps in index, remapDoc survival', () => {
  it('validates component and style pieces, tracks missing component groups, and indexes component/style -> token deps via links and aliases', async () => {
    const s = resetStore();
    const { subject: kit, doc } = await createKit({
      name: 'AcmeDS', kind: 'design-system', space: 'studio', sessionId: s.id, by: 'agent',
      tokens: {
        'color.primario': { type: 'color', value: '#2255ff' },
        'font.display': { type: 'fontFamily', value: 'Inter' },
        'space.md': { type: 'dimension', value: '16px' },
      },
    });

    // Reject invalid component & style pieces
    await expect(updateKit(kit.id, { pieces: [{ id: 'c_bad', kind: 'component', name: 'NoGroup' }] })).rejects.toThrow(/groupId/i);
    await expect(updateKit(kit.id, { pieces: [{ id: 'c_bad2', kind: 'component', groupId: 'grp_1' }] })).rejects.toThrow(/name/i);
    await expect(updateKit(kit.id, { pieces: [{ id: 's_bad', kind: 'style', values: { color: '#fff' } }] })).rejects.toThrow(/styleType/i);
    await expect(updateKit(kit.id, { pieces: [{ id: 's_bad2', kind: 'style', styleType: 'color', values: {} }] })).rejects.toThrow(/values/i);

    // Build a real group in the doc
    const l1 = newTextLayer('BtnText', 'Buy', { x: 10, y: 10, width: 80 });
    const l2 = newVectorLayer('BtnBg', [{ type: 'rect', x: 0, y: 0, w: 120, h: 44, fill: '#2255ff', stroke: null, strokeWidth: 0, radius: 8 }]);
    setDoc(s.id, doc!.id, (d) => ({ ...d, layers: [l2, l1] }));
    const gid = groupLayers(s.id, doc!.id, [l2.id, l1.id])!;
    patchGroup(s.id, doc!.id, gid, { name: 'Primary Button' });

    // Save v1 with the group so kit records groupIds
    await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s.id, space: 'studio', by: 'user' });

    // Register valid component, a component whose group does NOT exist, and text/color styles with literal + {token} aliases + links
    const res = await run({
      cmd: 'library.kit.update',
      args: {
        id: kit.id,
        pieces: [
          { id: 'c1', kind: 'component', groupId: gid, name: 'Primary Button', role: 'cta', description: 'Main CTA' },
          { id: 'c_missing', kind: 'component', groupId: 'grp_deleted', name: 'Ghost Card' },
          { id: 'st_h1', kind: 'style', name: 'Heading 1', styleType: 'text', values: { fontFamily: '{font.display}', color: '{color.primario}', fontSize: 32 } },
          { id: 'st_bg', kind: 'style', name: 'Surface', styleType: 'color', values: { color: '{color.ghost}', border: '#eee' } },
        ],
        links: [
          { id: 'lnk1', from: 'c1', to: 'st_h1', label: 'uses typography' },
          { id: 'lnk2', from: 'c1', to: 'space.md', label: 'padding' },
        ],
      },
    }, { caller: 'agent' });
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const lib = useStore.getState().library;
    const updated = lib.find((x) => x.id === kit.id)!;
    const dep = kitDependencies(updated, lib);
    expect(dep.missingGroupIds).toEqual(['grp_deleted']);
    expect(dep.pieceTokens.st_h1.sort()).toEqual(['color.primario', 'font.display']);
    expect(dep.pieceTokens.st_bg).toEqual(['color.ghost']);
    expect(dep.pieceTokens.c1.sort()).toEqual(['color.primario', 'font.display', 'space.md']);
    expect(dep.tokenIds.sort()).toEqual(['color.ghost', 'color.primario', 'font.display', 'space.md']);
    expect(dep.missingTokenIds).toEqual(['color.ghost']);

    const index = buildLibraryIndex(lib);
    expect(index.dependencies.get(kit.id)?.missingGroupIds).toEqual(['grp_deleted']);

    // Context line mentions components/styles and flags missing group
    const ctxLines = libraryContextLines(lib, {});
    expect(ctxLines.join('\n')).toContain('group:grp_deleted');
    expect(ctxLines.join('\n')).toContain('component');
  });

  it('groupId and member layers survive save, open, copy, and restore (remapDoc)', async () => {
    const s1 = resetStore();
    const s2 = createSession('S2');
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: s2 } }));

    const { subject: kit, doc } = await createKit({ name: 'GroupKit', kind: 'design-system', space: 'studio', sessionId: s1.id, by: 'user' });
    const r: RasterLayer = { ...newRasterLayer('IconPx', { x: 0, y: 0, width: 24, height: 24 }, { width: 24, height: 24 }), rev: 1 };
    const t = newTextLayer('Label', 'Submit', { x: 30, y: 4, width: 100 });
    const v = newVectorLayer('Pill', [{ type: 'rect', x: 0, y: 0, w: 140, h: 40, fill: '#000', stroke: null, strokeWidth: 0, radius: 12 }]);
    setDoc(s1.id, doc!.id, (d) => ({ ...d, layers: [v, r, t] }));
    const px = new Uint8Array([42, 43, 44, 45]);
    hoisted.blobs.set(`raster:${r.id}`, new Blob([px], { type: 'image/png' }));

    const gid = groupLayers(s1.id, doc!.id, [v.id, r.id, t.id])!;
    patchGroup(s1.id, doc!.id, gid, { name: 'ActionPill' });
    // Hide the raster layer then toggle group visibility so keptHidden stores raster id
    setDoc(s1.id, doc!.id, (d) => ({ ...d, layers: d.layers.map((l) => (l.id === r.id ? { ...l, visible: false } : l)) }));
    setGroupFlag(s1.id, doc!.id, gid, 'visible', false);

    // 1) Save v1
    const v1 = await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s1.id, space: 'studio', by: 'user', label: 'v1' });
    const snap1 = await readKitVersion(v1.versionId!);
    expect(snap1?.doc?.groups?.some((g) => g.id === gid && g.name === 'ActionPill')).toBe(true);
    const snapRaster = snap1!.doc!.layers.find((l) => l.type === 'raster')!;
    expect(snap1!.doc!.layers.every((l) => l.groupId === gid)).toBe(true);
    expect(snap1!.doc!.groups![0].keptHidden).toEqual([snapRaster.id]);

    // 2) Open in S2
    const d2 = await openKit(kit.id, { sessionId: s2.id, space: 'designer' });
    expect(d2.groups?.some((g) => g.id === gid && g.name === 'ActionPill')).toBe(true);
    expect(d2.layers.every((l) => l.groupId === gid)).toBe(true);
    const d2Raster = d2.layers.find((l) => l.type === 'raster')!;
    expect(d2.groups![0].keptHidden).toEqual([d2Raster.id]);
    expect(await blobBytes(hoisted.blobs.get(`raster:${d2Raster.id}`))).toEqual(px);

    // 3) Copy
    const copy = await saveKit({ subjectId: kit.id, mode: 'copy', sessionId: s2.id, docId: d2.id, space: 'designer', by: 'user', name: 'GroupKit Copy' });
    const copySnap = await readKitVersion(copy.versionId!);
    expect(copySnap?.doc?.groups?.some((g) => g.id === gid)).toBe(true);
    expect(copySnap!.doc!.layers.every((l) => l.groupId === gid)).toBe(true);

    // 4) Ungroup in S2 & save v2 -> Restore v1 -> Open in S1 -> groupId & layers are back!
    ungroup(s2.id, d2.id, gid);
    await saveKit({ subjectId: kit.id, mode: 'overwrite', sessionId: s2.id, docId: d2.id, space: 'designer', by: 'user', label: 'v2' });
    await restoreKitVersion({ subjectId: kit.id, versionId: v1.versionId!, space: 'library', by: 'user' });
    const dRestored = await openKit(kit.id, { sessionId: s2.id, space: 'designer' });
    expect(dRestored.groups?.some((g) => g.id === gid && g.name === 'ActionPill')).toBe(true);
    expect(dRestored.layers.every((l) => l.groupId === gid)).toBe(true);
    expect(await blobBytes(hoisted.blobs.get(`raster:${dRestored.layers.find((l) => l.type === 'raster')!.id}`))).toEqual(px);
  });
});
