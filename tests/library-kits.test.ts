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

import { SUBJECT_KINDS } from '../src/engine/libraryActions';
import { isKit, KIT_KINDS, mentionableSubjects } from '../src/engine/libraryTypes';
import { buildLibraryIndex, kitDependencies, kitUsedBy, libraryAssetOwners, libraryAssetSet, subjectAssetIds, wouldCreateKitCycle } from '../src/engine/libraryGraph';
import type { Subject } from '../src/engine/types';

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
