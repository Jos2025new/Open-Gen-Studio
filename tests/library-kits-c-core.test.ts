import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  Object.assign(globalThis, {
    window: { setTimeout, clearTimeout, addEventListener: () => undefined },
    document: { addEventListener: () => undefined, visibilityState: 'visible' },
  });
  const blobs = new Map<string, Blob>();
  let onGetHook: ((key: string) => void | Promise<void>) | null = null;
  return {
    blobs,
    setOnGet: (fn: ((key: string) => void | Promise<void>) | null) => { onGetHook = fn; },
    blobDb: {
      async get(key: string): Promise<Blob | undefined> {
        if (onGetHook) await onGetHook(key);
        return blobs.get(key);
      },
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

import * as Tokens from '../src/engine/libraryTokens';
import * as Types from '../src/engine/libraryTypes';
import * as Doc from '../src/engine/design/doc';
import * as Versions from '../src/engine/libraryVersions';
import { createSession, setDoc, useStore } from '../src/store/store';
import type { Graph, RasterLayer } from '../src/engine/types';

function resetStore() {
  const s = createSession('S1');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
  return s;
}

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.setOnGet(null);
});

describe('Part 2: Graph model, KIT_KINDS table, trimmed tokens, shared approxLayerBox, and GPT fixes #7', () => {
  it('replaces pieces/links with Graph + kits[], stores only used fields, trims token helpers, and shares approxLayerBox', async () => {
    resetStore();
    expect('resolveTokens' in Tokens).toBe(false);
    expect('deleteToken' in Tokens).toBe(false);
    expect('renameToken' in Tokens).toBe(false);
    expect(typeof (Doc as Record<string, unknown>).approxLayerBox).toBe('function');
    expect(Types.KIT_KINDS).toMatchObject({
      moodboard: { tokens: false, kits: false },
      'design-system': { tokens: true, kits: true },
      'brand-kit': { tokens: true, kits: true },
    });

    const createItem = (Versions as Record<string, unknown>).createItem as (opts: Record<string, unknown>) => Promise<{ subject: Record<string, unknown> }>;
    expect(typeof createItem).toBe('function');
    const graph: Graph = {
      nodes: [
        { id: 'n1', position: { x: 10, y: 0 }, data: { kind: 'part', partKind: 'color', title: 'Accent', color: '#ff5500' } },
        { id: 'n2', position: { x: 200, y: 0 }, data: { kind: 'text', title: 'Note', text: 'Warm glow' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref', label: 'tone' }],
    };
    const { subject: mb } = await createItem({ name: 'Mood', kind: 'moodboard', space: 'library', by: 'user', graph });
    expect('pieces' in mb).toBe(false);
    expect('links' in mb).toBe(false);
    expect('tokens' in mb).toBe(false);
    expect('kits' in mb).toBe(false);
    expect(mb.graph).toMatchObject(graph);

    // Moodboard rejects tokens and kits
    await expect(createItem({ name: 'BadMb', kind: 'moodboard', space: 'library', by: 'user', tokens: { 'color.a': { type: 'color', value: '#fff' } } })).rejects.toThrow(/token/i);
    await expect(createItem({ name: 'BadMb2', kind: 'moodboard', space: 'library', by: 'user', kits: [mb.id] })).rejects.toThrow(/kit/i);
  });

  it('GPT #7(i): open and delete NEVER delete a working copy even when clean or edited mid-await, keeping studio-only view when detaching', async () => {
    const s1 = resetStore();
    const s2 = createSession('S2');
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: s2 } }));

    const createItem = (Versions as Record<string, unknown>).createItem as (opts: Record<string, unknown>) => Promise<{ subject: { id: string; versionId?: string }; doc?: { id: string } }>;
    const saveItem = (Versions as Record<string, unknown>).saveItem as (opts: Record<string, unknown>) => Promise<{ id: string; versionId?: string }>;
    const libraryToDesigner = (Versions as Record<string, unknown>).libraryToDesigner as (sid: string, id: string) => Promise<{ id: string; library?: Record<string, unknown> }>;
    const deleteItem = (Versions as Record<string, unknown>).deleteItem as (id: string) => Promise<void>;

    const { subject: kit, doc: d1 } = await createItem({ name: 'KeepDoc', kind: 'design-system', space: 'studio', sessionId: s1.id, by: 'user' });
    setDoc(s1.id, d1!.id, (d) => ({ ...d, layers: [Doc.newTextLayer('T', 'v1', { x: 0, y: 0, width: 100 })] }));
    await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s1.id, docId: d1!.id, space: 'studio', by: 'user' });

    // Advance kit in S2 so S1's d1 has an older docRev
    const d2 = await libraryToDesigner(s2.id, kit.id);
    setDoc(s2.id, d2.id, (d) => ({ ...d, layers: [Doc.newTextLayer('T', 'v2', { x: 0, y: 0, width: 100 })] }));
    await saveItem({ subjectId: kit.id, mode: 'overwrite', sessionId: s2.id, docId: d2.id, space: 'designer', by: 'user' });

    // Simulate edit happening mid-await during open in S1: old d1 MUST survive, unlinked, and keep view:'studio'
    let editedMidAwait = false;
    hoisted.setOnGet((key) => {
      if (!editedMidAwait && key.startsWith('libver:')) {
        editedMidAwait = true;
        setDoc(s1.id, d1!.id, (d) => ({ ...d, layers: [Doc.newTextLayer('LateEdit', 'User typed during await', { x: 0, y: 0, width: 100 })] }));
      }
    });
    const d1New = await libraryToDesigner(s1.id, kit.id);
    hoisted.setOnGet(null);
    expect(d1New.id).not.toBe(d1!.id);
    const oldD1 = useStore.getState().sessions[s1.id].docs.find((d) => d.id === d1!.id);
    expect(oldD1).toBeDefined();
    expect(oldD1?.library).toBeUndefined();
    expect((oldD1 as { view?: string } | undefined)?.view).toBe('studio');
    expect(oldD1?.layers.some((l) => l.type === 'text' && l.text === 'User typed during await')).toBe(true);

    // Delete kit: d1New (Designer) and d2 (Designer) are BOTH unlinked, NEVER deleted!
    await deleteItem(kit.id);
    const afterS1 = useStore.getState().sessions[s1.id].docs.find((d) => d.id === d1New.id);
    const afterS2 = useStore.getState().sessions[s2.id].docs.find((d) => d.id === d2.id);
    expect(afterS1).toBeDefined();
    expect(afterS1?.library).toBeUndefined();
    expect(afterS2).toBeDefined();
    expect(afterS2?.library).toBeUndefined();
  });

  it('GPT #7(ii): restoreItemVersion rejects a version belonging to another Library entry so pixels are never shared across entries', async () => {
    const s = resetStore();
    const createItem = (Versions as Record<string, unknown>).createItem as (opts: Record<string, unknown>) => Promise<{ subject: { id: string }; doc?: { id: string } }>;
    const saveItem = (Versions as Record<string, unknown>).saveItem as (opts: Record<string, unknown>) => Promise<{ id: string; versionId?: string }>;
    const restoreItemVersion = (Versions as Record<string, unknown>).restoreItemVersion as (opts: Record<string, unknown>) => Promise<unknown>;

    const { subject: kitA, doc: docA } = await createItem({ name: 'KitA', kind: 'design-system', space: 'designer', sessionId: s.id, by: 'user' });
    const lyr: RasterLayer = { ...Doc.newRasterLayer('Px', { x: 0, y: 0, width: 4, height: 4 }, { width: 4, height: 4 }), rev: 1 };
    setDoc(s.id, docA!.id, (d) => ({ ...d, layers: [lyr] }));
    hoisted.blobs.set(`raster:${lyr.id}`, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    const savedA = await saveItem({ subjectId: kitA.id, mode: 'overwrite', sessionId: s.id, docId: docA!.id, space: 'designer', by: 'user' });

    const { subject: kitB } = await createItem({ name: 'KitB', kind: 'design-system', space: 'library', by: 'user' });

    // Attempting to restore KitA's version into KitB MUST fail!
    await expect(restoreItemVersion({
      subjectId: kitB.id,
      versionId: savedA.versionId!,
      space: 'library',
      by: 'user',
    })).rejects.toThrow(/belong|subject|another/i);
  });
});
