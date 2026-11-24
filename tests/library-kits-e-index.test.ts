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

import { run, setApprover } from '../src/engine/commands';
import { newRasterLayer, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import { createSession, setDoc, useStore } from '../src/store/store';
import type { Asset, Graph, VectorLayer } from '../src/engine/types';

function mkAsset(id: string, sessionId: string, width: number, height: number, origin: Asset['origin']): Asset {
  return { id, sessionId, kind: 'image', mime: 'image/png', width, height, origin, stored: true, favorite: false, createdAt: 1 };
}

beforeEach(() => {
  hoisted.blobs.clear();
  setApprover(() => true);
  const s = createSession('IndexDocSession');
  useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
});

describe('Lote E Punto 4: library.item.read includes doc summary, components, and image metadata within 2,500 chars', () => {
  it('derives doc measures/bg/layers/fonts/colors, group components, and image measures/origin without persisting them', async () => {
    const sid = useStore.getState().activeSessionId;
    useStore.setState({
      assets: {
        img_doc: mkAsset('img_doc', sid, 800, 600, 'generated'),
        img_ref: mkAsset('img_ref', sid, 1024, 512, 'upload'),
      },
    });

    const { subject, doc } = await createItem({
      name: 'Brand Book', kind: 'brand-kit', space: 'designer', by: 'user', sessionId: sid, draft: false,
    });
    const t1 = { ...newTextLayer('Heading', 'Acme', { x: 0, y: 0, width: 200 }, { fontFamily: 'Display', color: '#ffffff' }), groupId: 'g_btn' };
    const t2 = { ...newTextLayer('Body', 'Copy', { x: 0, y: 40, width: 200 }, { fontFamily: 'Inter', color: '#ffffff' }) };
    const vec: VectorLayer = {
      ...newVectorLayer('BtnShape', [{ type: 'rect', x: 0, y: 0, w: 120, h: 40, fill: '#2255ff', stroke: '#ffffff', strokeWidth: 2, radius: 6 }]),
      groupId: 'g_btn',
      strokes: [{ id: 'stk1', color: '#ff5500', size: 4, thinning: 0, smoothing: 0, streamline: 0, taperStart: 0, taperEnd: 0, opacity: 1, points: [[0, 0, 1]], simulatePressure: false }],
    };
    const rast = newRasterLayer('HeroPhoto', { x: 0, y: 0, width: 800, height: 600 }, { width: 800, height: 600 }, 'img_doc');
    setDoc(sid, doc!.id, (d) => ({
      ...d, width: 1200, height: 800, background: '#0f172a',
      groups: [{ id: 'g_btn', name: 'Primary CTA' }, { id: 'g_empty', name: 'Unused' }],
      layers: [t1, vec, t2, rast],
    }));

    const graph: Graph = {
      nodes: [{ id: 'n_ref', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Ref Photo', assetId: 'img_ref' } }],
      edges: [],
    };
    await saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: sid, docId: doc!.id, graph });

    const res = await run({ cmd: 'library.item.read', args: { id: subject.id } }, { caller: 'agent' });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const { index } = res.results[0] as { index: string; truncated: boolean };

    // Document intrinsic properties
    expect(index).toContain('1200x800');
    expect(index).toContain('#0f172a');
    expect(index).toContain('4 layers');
    expect(index).toContain('Display');
    expect(index).toContain('Inter');
    expect(index).toContain('#2255ff');
    expect(index).toContain('#ff5500');
    expect(index).toContain('#ffffff');
    // Distinct colors (no duplicate #ffffff on the doc line)
    const docLine = index.split('\n').find((l) => l.startsWith('doc:'))!;
    expect(docLine).toBeDefined();
    expect(docLine.match(/#ffffff/gi)?.length).toBe(1);

    // Components (LayerGroups with layers only)
    expect(index).toContain('g_btn');
    expect(index).toContain('Primary CTA');
    expect(index).not.toContain('g_empty');

    // Images: measures & origin (both graph asset node and doc raster image)
    expect(index).toContain('1024x512');
    expect(index).toContain('upload');
    expect(index).toContain('800x600');
    expect(index).toContain('generated');

    // Nothing derived persisted on subject
    const stored = useStore.getState().library.find((x) => x.id === subject.id)!;
    expect('fonts' in stored).toBe(false);
    expect('colors' in stored).toBe(false);
    expect('components' in stored).toBe(false);
  });

  it('stays within the 2,500-char limit even with many component groups', async () => {
    const sid = useStore.getState().activeSessionId;
    const { subject, doc } = await createItem({
      name: 'Huge DS', kind: 'design-system', space: 'designer', by: 'user', sessionId: sid, draft: false,
    });
    const groups = Array.from({ length: 120 }, (_, i) => ({ id: `grp_${i}`, name: `Component_${i}_${'A'.repeat(40)}` }));
    const layers = groups.map((g, i) => ({ ...newTextLayer(`L${i}`, `Text ${i}`, { x: 0, y: 0, width: 100 }), groupId: g.id }));
    setDoc(sid, doc!.id, (d) => ({ ...d, groups, layers }));
    await saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: sid, docId: doc!.id });

    const res = await run({ cmd: 'library.item.read', args: { id: subject.id } }, { caller: 'agent' });
    expect(res.ok).toBe(true);
    const payload = res.results[0] as { index: string; truncated: boolean };
    expect(payload.truncated).toBe(true);
    expect(payload.index.length).toBeLessThanOrEqual(2500);
  });
});
