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
import { createDoc } from '../src/engine/design/doc';
import { addDoc } from '../src/engine/design/actions';
import { createItem, libraryToDesigner, saveItem } from '../src/engine/libraryVersions';
import { createSession, setUi, useStore } from '../src/store/store';
import type { Asset, Graph, Subject } from '../src/engine/types';

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
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) =>
    b.textContent?.includes(text),
  );
const openSource = async (label: string) => {
  await click(q('.pc-source'));
  await click(menuItem(label));
};
const makeAsset = (id: string): Asset => ({
  id, sessionId: sid(), kind: 'image', mime: 'image/png', name: `${id}.png`,
  createdAt: 1, origin: 'upload', width: 200, height: 100, stored: true, favorite: false,
});

beforeEach(() => {
  blobs.clear();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const s = createSession('Gallery Kit Test');
  act(() => {
    useStore.setState({
      sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {},
    });
    setUi({ workspace: 'designer', home: false, panel: 'gallery', panelExpanded: true });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('Lote D Parte 1: Library kit categories, cards, menu, versions, components and New', () => {
  it('lists kit categories after Style with counts, isolates kits from Character, and shows empty state', async () => {
    const a1 = makeAsset('a1');
    const char: Subject = { id: 'c1', name: 'Hero', refAssetIds: [] };
    const mb: Subject = {
      id: 'm1', name: 'Summer Mood', kind: 'moodboard', refAssetIds: [],
      graph: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Pic', assetId: 'a1' } }], edges: [] },
    };
    const ds: Subject = { id: 'd1', name: 'Acme DS', kind: 'design-system', refAssetIds: [] };
    act(() => { useStore.setState({ assets: { a1 }, library: [char, mb, ds] }); });
    await act(async () => root.render(createElement(GalleryPanel)));

    await click(q('.pc-source'));
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
    expect(labels).toEqual([
      'All', 'Character1', 'Location0', 'Product0', 'Object0', 'Style0',
      'Moodboards1', 'Design systems1', 'Brand kits0',
    ]);

    await click(menuItem('Character'));
    expect([...host.querySelectorAll('.lib-tile .pc-info-title')].map((e) => e.textContent)).toEqual(['@Hero']);

    await openSource('Brand kits');
    expect(host.querySelector('.empty-block')).not.toBeNull();
    expect(host.querySelectorAll('.lib-tile')).toHaveLength(0);
  });

  it('renders kit cover from image or version, placeholder icon when none, and name without @', async () => {
    const a1 = makeAsset('a1');
    const a2 = makeAsset('a2');
    const mbWithGraph: Subject = {
      id: 'm1', name: 'Board One', kind: 'moodboard', refAssetIds: [],
      graph: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'One', assetId: 'a1' } }], edges: [] },
    };
    const mbWithVer: Subject = {
      id: 'm2', name: 'Board Two', kind: 'moodboard', refAssetIds: [],
      versionId: 'v1', versions: [{ id: 'v1', at: 1000, by: 'user', space: 'studio', assetIds: ['a2'] }],
    };
    const mbEmpty: Subject = { id: 'm3', name: 'Board Three', kind: 'moodboard', refAssetIds: [] };
    act(() => { useStore.setState({ assets: { a1, a2 }, library: [mbWithGraph, mbWithVer, mbEmpty] }); });
    await act(async () => root.render(createElement(GalleryPanel)));
    await openSource('Moodboards');

    const tiles = [...host.querySelectorAll('.lib-tile')];
    expect(tiles.map((t) => t.querySelector('.pc-info-title')?.textContent)).toEqual([
      'Board One', 'Board Three', 'Board Two',
    ]);
    expect(tiles[0].querySelector('[data-asset="a1"]')).not.toBeNull();
    expect(tiles[1].querySelector('[data-asset]')).toBeNull();
    expect(tiles[1].querySelector('.g-open svg')).not.toBeNull();
    expect(tiles[2].querySelector('[data-asset="a2"]')).not.toBeNull();
  });

  it('opens in current space, gates Open in Nodes on graph content, restores versions, inserts components, and warns on Remove', async () => {
    const dsRes = await createItem({
      name: 'Acme DS', kind: 'design-system', space: 'designer', by: 'user', sessionId: sid(), draft: false,
    });
    const doc = dsRes.doc!;
    const layer = {
      id: 'l1', type: 'text' as const, name: 'Btn', visible: true, locked: false, opacity: 1,
      blend: 'normal' as const, groupId: 'g1', text: 'Go', x: 0, y: 0, width: 80, height: 30,
      fontFamily: 'Inter', fontSize: 16, fontWeight: 600, letterSpacing: 0, color: '#ffffff',
      align: 'left' as const, lineHeight: 1.2,
    };
    const compGraph: Graph = {
      nodes: [{ id: 'p1', position: { x: 0, y: 0 }, data: { kind: 'part', partKind: 'component', title: 'Primary Button', groupId: 'g1' } }],
      edges: [],
    };
    useStore.setState((st) => ({
      sessions: {
        ...st.sessions,
        [sid()]: {
          ...st.sessions[sid()],
          docs: st.sessions[sid()].docs.map((d) =>
            d.id === doc.id ? { ...d, groups: [{ id: 'g1', name: 'Primary Button' }], layers: [layer] } : d,
          ),
        },
      },
    }));
    await saveItem({ subjectId: dsRes.subject.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: sid(), docId: doc.id, graph: compGraph, label: 'v2' });
    await createItem({
      name: 'Acme Brand', kind: 'brand-kit', space: 'library', by: 'user', kits: [dsRes.subject.id], draft: false,
    });

    const workDoc = createDoc('Landing', 1080, 1080, null);
    addDoc(sid(), workDoc);
    await act(async () => root.render(createElement(GalleryPanel)));
    await openSource('Design systems');

    const tile = q('.lib-tile');
    await click(tile.querySelector('[aria-label="More actions for Acme DS"]'));
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent);
    expect(items.some((t) => t?.includes('Open in Studio'))).toBe(true);
    expect(items.some((t) => t?.includes('Open in Designer'))).toBe(true);
    expect(items.some((t) => t?.includes('Open in Nodes'))).toBe(true);
    expect(items.some((t) => t?.includes('Versions'))).toBe(true);
    expect(items.some((t) => t?.includes('Components'))).toBe(true);

    // Insert component into open Designer doc
    await click(menuItem('Components'));
    await click(menuItem('Primary Button'));
    const updatedDoc = useStore.getState().sessions[sid()].docs.find((d) => d.id === workDoc.id)!;
    expect(updatedDoc.groups?.some((g) => g.from?.subjectId === dsRes.subject.id)).toBe(true);

    // Versions -> click -> MenuConfirm -> restore creates a new version
    const beforeVers = useStore.getState().library.find((s) => s.id === dsRes.subject.id)!.versions!.length;
    await click(tile.querySelector('[aria-label="More actions for Acme DS"]'));
    await click(menuItem('Versions'));
    const verRows = [...document.querySelectorAll('[role="menuitem"]')].filter((b) => b.textContent?.includes('user'));
    expect(verRows.length).toBeGreaterThanOrEqual(2);
    await click(verRows[verRows.length - 1]);
    expect(document.querySelector('.confirm')).not.toBeNull();
    const restoreBtn = [...document.querySelectorAll('.confirm button')].find((b) => b.textContent === 'Restore');
    await click(restoreBtn);
    const afterVers = useStore.getState().library.find((s) => s.id === dsRes.subject.id)!.versions!.length;
    expect(afterVers).toBe(beforeVers + 1);

    // Escape closes menu cleanly
    await click(tile.querySelector('[aria-label="More actions for Acme DS"]'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // Open in Designer then delete while open: Remove MenuConfirm lists usedBy and detaches open doc
    const opened = await libraryToDesigner(sid(), dsRes.subject.id);
    await click(tile.querySelector('[aria-label="More actions for Acme DS"]'));
    await click(menuItem('Remove'));
    expect(document.querySelector('.confirm')?.textContent).toContain('Acme Brand');
    const rmBtn = [...document.querySelectorAll('.confirm button')].find((b) => b.textContent === 'Remove');
    await click(rmBtn);
    expect(useStore.getState().library.some((s) => s.id === dsRes.subject.id)).toBe(false);
    const detached = useStore.getState().sessions[sid()].docs.find((d) => d.id === opened.id);
    expect(detached).toBeDefined();
    expect(detached?.library).toBeUndefined();
  });

  it('New button creates an empty kit of that kind and opens in current space without duplicate on double click', async () => {
    act(() => { setUi({ workspace: 'designer', home: false, panel: 'gallery' }); });
    await act(async () => root.render(createElement(GalleryPanel)));
    await openSource('Moodboards');

    const newBtn = [...host.querySelectorAll<HTMLButtonElement>('.pc-bar button')].find((b) => b.textContent?.includes('New'))!;
    expect(newBtn).toBeDefined();
    await act(async () => {
      newBtn.click();
      newBtn.click();
    });
    const mbs = useStore.getState().library.filter((s) => s.kind === 'moodboard');
    expect(mbs).toHaveLength(1);
    expect(useStore.getState().sessions[sid()].docs.some((d) => d.library?.subjectId === mbs[0].id)).toBe(true);
  });
});
