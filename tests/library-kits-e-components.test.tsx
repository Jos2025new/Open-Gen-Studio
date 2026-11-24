// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const blobs = new Map<string, Blob>();
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: {
    get: async (k: string) => blobs.get(k),
    set: async (k: string, b: Blob) => { blobs.set(k, b); },
    del: async (k: string) => { blobs.delete(k); },
    delMany: async (ks: string[]) => { for (const k of ks) blobs.delete(k); },
  },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  deleteAssetBlobs: async () => undefined,
}));
vi.mock('../src/components/ui/AssetMedia', () => ({
  AssetMedia: ({ assetId }: { assetId: string }) => createElement('span', { 'data-asset': assetId }),
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GalleryPanel } from '../src/components/gallery/GalleryPanel';
import { addDoc, getDoc } from '../src/engine/design/actions';
import { createDoc, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { insertComponent } from '../src/engine/libraryInsert';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import { createSession, setDoc, setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let host: HTMLDivElement;
let root: Root;
const sid = () => useStore.getState().activeSessionId;
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
const click = async (el: Element | null | undefined) => {
  await act(async () => { (el as HTMLElement).click(); });
};
const menuItem = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.includes(text));

beforeEach(() => {
  blobs.clear();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const s = createSession('Components Test');
  act(() => {
    useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
    setUi({ workspace: 'designer', home: false, panel: 'gallery', panelExpanded: true });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('Lote E Punto 3: LayerGroups with layers are components in design systems and brand kits', () => {
  it('inserts directly by group id and lists document LayerGroups in Components menu for design systems and brand kits', async () => {
    const s = sid();
    const { subject: bk, doc: bkDoc } = await createItem({
      name: 'Acme Brand', kind: 'brand-kit', space: 'designer', by: 'user', sessionId: s, draft: false,
    });
    const rect = { ...newVectorLayer('Card Bg', [{ type: 'rect', x: 0, y: 0, w: 200, h: 100, fill: '#112233', stroke: null, strokeWidth: 0, radius: 8 }]), groupId: 'g_card' };
    const title = { ...newTextLayer('Card Title', 'Hello', { x: 12, y: 12, width: 160 }), groupId: 'g_card' };
    setDoc(s, bkDoc!.id, (d) => ({
      ...d,
      groups: [{ id: 'g_card', name: 'Hero Card' }, { id: 'g_empty', name: 'Empty Folder' }],
      layers: [rect, title],
    }));
    const saved = await saveItem({
      subjectId: bk.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: s, docId: bkDoc!.id,
    });
    expect(saved.graph).toBeUndefined();

    // Target working doc in Designer
    const work = createDoc('Landing', 1080, 1080, null);
    addDoc(s, work);

    // Engine: insertComponent accepts LayerGroup id directly and rejects empty group
    const ins = await insertComponent(s, work.id, bk.id, 'g_card');
    expect(ins.layerIds).toHaveLength(2);
    expect(getDoc(s, work.id)?.groups?.find((g) => g.id === ins.groupId)).toMatchObject({
      name: 'Hero Card', from: { subjectId: bk.id, pieceId: 'g_card', versionId: saved.versionId },
    });
    await expect(insertComponent(s, work.id, bk.id, 'g_empty')).rejects.toThrow(/piece|group/i);

    // UI: GalleryPanel lists LayerGroups with layers under Components on brand-kit too (readKitVersion on open)
    await act(async () => root.render(createElement(GalleryPanel)));
    await click(q('.pc-source'));
    await click(menuItem('Brand kits'));
    await click(host.querySelector('[aria-label="More actions for Acme Brand"]'));
    expect(menuItem('Components')).toBeDefined();

    await click(menuItem('Components'));
    expect(menuItem('Hero Card')).toBeDefined();
    expect(menuItem('Empty Folder')).toBeUndefined();

    const beforeCount = getDoc(s, work.id)!.groups?.length ?? 0;
    await click(menuItem('Hero Card'));
    expect(getDoc(s, work.id)!.groups?.length).toBe(beforeCount + 1);
  });
});
