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

import { command, run, setApprover } from '../src/engine/commands';
import { libraryContextLines } from '../src/engine/libraryGraph';
import { createSession, useStore } from '../src/store/store';
import type { Asset, Subject } from '../src/engine/types';

function mkAsset(id: string, sessionId: string): Asset {
  return { id, sessionId, kind: 'image', mime: 'image/png', width: 64, height: 64, origin: 'upload', stored: true, favorite: false, createdAt: 1 };
}

beforeEach(() => {
  hoisted.blobs.clear();
  setApprover(() => true);
  const s = createSession('IndexSession');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
});

describe('Part 3: library.item.* generic verbs, pure plain-text internal index, and bounded agent read/list/context', () => {
  it('exposes library.item.* verbs (create, save, open, restore, delete, read, list, insert) and removes library.kit.*', async () => {
    for (const verb of ['create', 'save', 'open', 'restore', 'delete', 'read', 'list', 'insert']) {
      expect(command(`library.item.${verb}`), `library.item.${verb}`).toBeDefined();
    }
    for (const old of ['create', 'read', 'update', 'open', 'save', 'restore', 'list', 'insert']) {
      expect(command(`library.kit.${old}`), `old library.kit.${old}`).toBeUndefined();
    }

    const sid = useStore.getState().activeSessionId;
    useStore.setState({ assets: { a1: mkAsset('a1', sid) } });

    // Real origin.space for studio, designer, library
    const cStudio = await run({ cmd: 'library.item.create', on: { session: sid }, args: { name: 'StudioDS', kind: 'design-system', space: 'studio', tokens: { 'color.main': { type: 'color', value: '#2255ff' } } } }, { caller: 'agent' });
    expect(cStudio.ok, JSON.stringify(cStudio)).toBe(true);
    const ds = (cStudio.results[0] as { subject: Subject }).subject;
    expect(ds.origin?.space).toBe('studio');

    const cDesigner = await run({ cmd: 'library.item.create', on: { session: sid }, args: { name: 'DesignerMB', kind: 'moodboard', space: 'designer' } }, { caller: 'agent' });
    expect(cDesigner.ok).toBe(true);
    expect((cDesigner.results[0] as { subject: Subject }).subject.origin?.space).toBe('designer');

    const cBrand = await run({
      cmd: 'library.item.create',
      args: {
        name: 'AcmeBrand', kind: 'brand-kit', space: 'library', description: 'Main brand identity',
        kits: [ds.id, 'kit_missing'],
        graph: {
          nodes: [
            { id: 'n_img', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Logo', assetId: 'a1' } },
            { id: 'n_txt', position: { x: 200, y: 0 }, data: { kind: 'text', title: 'Voice', text: 'Warm and direct' } },
            { id: 'n_col', position: { x: 400, y: 0 }, data: { kind: 'part', partKind: 'color', title: 'Accent', color: '#ff5500' } },
            { id: 'n_cmp', position: { x: 600, y: 0 }, data: { kind: 'part', partKind: 'component', title: 'CTA', groupId: 'grp_gone' } },
          ],
          edges: [{ id: 'e1', source: 'n_img', target: 'n_txt', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref', label: 'tone' }],
        },
      },
    }, { caller: 'agent' });
    expect(cBrand.ok, JSON.stringify(cBrand)).toBe(true);
    const brand = (cBrand.results[0] as { subject: Subject }).subject;
    expect(brand.origin?.space).toBe('library');

    // Pure plain-text index via library.item.read (no snapshot, no raw graph, no blobs)
    const readBrand = await run({ cmd: 'library.item.read', args: { id: brand.id } }, { caller: 'agent' });
    expect(readBrand.ok).toBe(true);
    const payload = readBrand.results[0] as Record<string, unknown>;
    expect('snapshot' in payload).toBe(false);
    expect('graph' in payload).toBe(false);
    expect(typeof payload.index).toBe('string');
    const txt = payload.index as string;
    expect(txt).toContain('AcmeBrand');
    expect(txt).toContain('brand-kit');
    expect(txt).toContain('origin: library');
    expect(txt).toContain('versions:');
    expect(txt).toContain(ds.id);
    expect(txt).toContain('Logo -> Voice [tone]');
    expect(txt).toContain('kit:kit_missing');
    expect(txt).toContain('group:grp_gone');

    // usedBy appears on ds read
    const readDs = await run({ cmd: 'library.item.read', args: { id: ds.id } }, { caller: 'agent' });
    expect((readDs.results[0] as { index: string }).index).toContain(brand.id);

    // Nothing derived saved on subject
    const storedBrand = useStore.getState().library.find((x) => x.id === brand.id)!;
    expect('index' in storedBrand).toBe(false);
    expect('usedBy' in storedBrand).toBe(false);
    expect('missingRefs' in storedBrand).toBe(false);

    // library.item.delete works (effect: 'delete')
    const del = await run({ cmd: 'library.item.delete', args: { id: brand.id } }, { caller: 'agent' });
    expect(del.ok).toBe(true);
    expect(useStore.getState().library.some((x) => x.id === brand.id)).toBe(false);
  });

  it('stays bounded with 500 entries and 2,000-character names: context count-only, list max 20, read <= 2,500 chars cut by line', async () => {
    const longPrefix = 'X'.repeat(1980);
    const entries: Subject[] = [];
    for (let i = 0; i < 500; i++) {
      entries.push({
        id: `kit_${i}`,
        name: `${longPrefix}_ITEM_${i}`,
        kind: i === 0 ? 'brand-kit' : 'moodboard',
        refAssetIds: [],
        ...(i === 0 ? {
          description: 'D'.repeat(800),
          kits: Array.from({ length: 100 }, (_, j) => `kit_${j + 1}`),
          graph: {
            nodes: Array.from({ length: 60 }, (_, j) => ({
              id: `n_${j}`, position: { x: 0, y: 0 },
              data: { kind: 'text' as const, title: `Note_${j}_${'T'.repeat(100)}`, text: `Body_${j}_${'B'.repeat(120)}` },
            })),
            edges: Array.from({ length: 50 }, (_, j) => ({
              id: `e_${j}`, source: `n_${j}`, target: `n_${j + 1}`, sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' as const, label: `rel_${j}`,
            })),
          },
        } : {}),
        origin: { space: 'library', by: 'user', at: 1 },
      });
    }
    useStore.setState({ library: entries });

    // 1) Context per turn has ONLY the total count
    const ctx = libraryContextLines(useStore.getState().library, {});
    expect(ctx).toHaveLength(1);
    expect(ctx[0]).toContain('500');
    expect(ctx[0].length).toBeLessThan(120);
    expect(ctx[0]).not.toContain(longPrefix);

    // 2) library.item.list: max 20 entries, short { id, name, kind }
    const listed = await run({ cmd: 'library.item.list', args: {} }, { caller: 'agent' });
    expect(listed.ok).toBe(true);
    const listRes = listed.results[0] as { total: number; items: Array<Record<string, unknown>>; truncated?: boolean };
    expect(listRes.total).toBe(500);
    expect(listRes.items).toHaveLength(20);
    expect(listRes.truncated).toBe(true);
    for (const row of listRes.items) {
      expect(Object.keys(row).sort()).toEqual(['id', 'kind', 'name']);
      expect((row.name as string).length).toBeLessThanOrEqual(120);
    }

    // 3) library.item.read: <= 2,500 chars, cut by line, explicitly states truncated, no snapshot/graph
    const readRes = await run({ cmd: 'library.item.read', args: { id: 'kit_0' } }, { caller: 'agent' });
    expect(readRes.ok).toBe(true);
    const readPayload = readRes.results[0] as { id: string; index: string; truncated: boolean };
    expect(readPayload.truncated).toBe(true);
    expect(readPayload.index.length).toBeLessThanOrEqual(2500);
    expect(readPayload.index).toMatch(/truncated/i);
    // Cut at line boundary: last line is the truncation marker, previous lines are complete (not mid-line chopped)
    const lines = readPayload.index.split('\n');
    expect(lines[lines.length - 1]).toMatch(/truncated/i);
    expect(lines.length).toBeGreaterThan(3);
  });
});
