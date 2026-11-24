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
import { libraryToNodes } from '../src/engine/flow/fromLibrary';
import { newRasterLayer } from '../src/engine/design/doc';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import { createSession, setDoc, setUi, useStore } from '../src/store/store';
import type { Asset } from '../src/engine/types';

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
const mkAsset = (id: string, sessionId: string, kind: Asset['kind'] = 'image'): Asset => ({
  id, sessionId, kind, mime: kind === 'image' ? 'image/png' : 'video/mp4', name: `${id}.png`,
  createdAt: 1, origin: 'upload', width: 200, height: 100, stored: true, favorite: false,
});

beforeEach(() => {
  blobs.clear();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const s = createSession('DocToNodes Test');
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

describe('Lote E Punto 2: open doc-only Library entry in Nodes', () => {
  it('imports current-version image assetIds into Nodes as asset nodes in a named group and offers Open in Nodes', async () => {
    const s = sid();
    const img1 = mkAsset('img_1', s, 'image');
    const img2 = mkAsset('img_2', 'other_session', 'image');
    const vid = mkAsset('vid_1', s, 'video');
    act(() => { useStore.setState({ assets: { img_1: img1, img_2: img2, vid_1: vid } }); });

    // Doc-only entry with two image layers (no graph)
    const { subject, doc } = await createItem({
      name: 'Poster Kit', kind: 'moodboard', space: 'designer', by: 'user', sessionId: s, draft: false,
    });
    const l1 = newRasterLayer('Photo 1', { x: 0, y: 0, width: 200, height: 100 }, { width: 200, height: 100 }, 'img_1');
    const l2 = newRasterLayer('Photo 2', { x: 0, y: 0, width: 200, height: 100 }, { width: 200, height: 100 }, 'img_2');
    setDoc(s, doc!.id, (d) => ({ ...d, layers: [l1, l2] }));
    await saveItem({ subjectId: subject.id, mode: 'overwrite', space: 'designer', by: 'user', sessionId: s, docId: doc!.id });
    // Inject a non-image assetId into the current version ref to verify image-only filtering
    useStore.setState((st) => ({
      library: st.library.map((x) =>
        x.id === subject.id
          ? { ...x, versions: x.versions?.map((v) => (v.id === x.versionId ? { ...v, assetIds: [...v.assetIds, 'vid_1'] } : v)) }
          : x,
      ),
    }));

    // Empty entry with neither graph nor images
    const empty = await createItem({ name: 'Empty Board', kind: 'moodboard', space: 'library', by: 'user', draft: false });
    expect(libraryToNodes(s, empty.subject.id)).toEqual({ added: [], edges: [], groupId: null });

    // Engine: libraryToNodes imports the 2 images into a named group
    const imp = libraryToNodes(s, subject.id);
    expect(imp.added).toHaveLength(2);
    expect(imp.added.map((n) => (n.data.kind === 'asset' ? n.data.assetId : null))).toEqual(['img_1', 'img_2']);
    expect(imp.groupId).toBeTruthy();
    const grp = useStore.getState().sessions[s].graph.groups?.find((g) => g.id === imp.groupId);
    expect(grp).toMatchObject({ title: 'Poster Kit', library: { subjectId: subject.id } });

    // UI: GalleryPanel CardMenu offers Open in Nodes for doc-with-images, not for empty
    await act(async () => root.render(createElement(GalleryPanel)));
    await click(q('.pc-source'));
    await click(menuItem('Moodboards'));

    await click(host.querySelector('[aria-label="More actions for Poster Kit"]'));
    expect(menuItem('Open in Nodes')).toBeDefined();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });

    await click(host.querySelector('[aria-label="More actions for Empty Board"]'));
    expect(menuItem('Open in Nodes')).toBeUndefined();
  });
});
