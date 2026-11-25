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

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SendToMenu } from '../src/components/assets/AssetActions';
import { createItem } from '../src/engine/libraryVersions';
import { createSession, setUi, useStore } from '../src/store/store';
import type { Asset, Subject } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let host: HTMLDivElement;
let root: Root;
const sid = () => useStore.getState().activeSessionId;
const click = async (el: Element | null | undefined) => {
  await act(async () => { (el as HTMLElement).click(); });
};
const findBtn = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
const makeAsset = (id: string, kind: Asset['kind'] = 'image'): Asset => ({
  id, sessionId: sid(), kind, mime: kind === 'image' ? 'image/png' : 'video/mp4', name: `${id}.png`,
  createdAt: 1, origin: 'upload', width: 256, height: 256, stored: true, favorite: false,
});

beforeEach(() => {
  blobs.clear();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const s = createSession('SendTo Moodboard Test');
  act(() => {
    useStore.setState({
      sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {},
    });
    setUi({ workspace: 'chat', home: false, panel: null });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('Lote D Parte 3: SendToMenu Add to moodboard', () => {
  it('shows Add to moodboard only on images, lists existing moodboards + New moodboard, and adds via engine ops', async () => {
    const img = makeAsset('img-1', 'image');
    const vid = makeAsset('vid-1', 'video');
    const char: Subject = { id: 'c1', name: 'Hero', kind: 'character', refAssetIds: [] };
    act(() => { useStore.setState({ assets: { [img.id]: img, [vid.id]: vid }, library: [char] }); });
    const mb = await createItem({ name: 'Warm Vibes', kind: 'moodboard', space: 'library', by: 'user', draft: false });
    await createItem({ name: 'Acme DS', kind: 'design-system', space: 'library', by: 'user', draft: false });

    // Video does NOT offer Add to moodboard
    await act(async () => root.render(createElement(SendToMenu, { assetId: vid.id })));
    await click(host.querySelector('button[aria-label="Send to"]'));
    expect(findBtn('Add to moodboard')).toBeUndefined();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });

    // Image offers Add to moodboard -> lists the Library entries and New moodboard (not Hero)
    await act(async () => root.render(createElement(SendToMenu, { assetId: img.id })));
    await click(host.querySelector('button[aria-label="Send to"]'));
    await click(findBtn('Add to moodboard'));
    const labels = [...document.querySelectorAll('.menu button')].map((b) => b.textContent);
    expect(labels.some((t) => t?.includes('Warm Vibes'))).toBe(true);
    expect(labels.some((t) => t?.includes('New moodboard'))).toBe(true);
    expect(labels.some((t) => t?.includes('Acme DS'))).toBe(true);
    expect(labels.some((t) => t?.includes('Hero'))).toBe(false);

    // Clicking Warm Vibes adds the image node as a new version (double click does not duplicate)
    const mbBtn = findBtn('Warm Vibes')!;
    await act(async () => {
      mbBtn.click();
      mbBtn.click();
    });
    const updated = useStore.getState().library.find((s) => s.id === mb.subject.id)!;
    const assetNodes = (updated.graph?.nodes ?? []).filter((n) => n.data.kind === 'asset' && n.data.assetId === img.id);
    expect(assetNodes).toHaveLength(1);
    expect(updated.versions?.length).toBe(2);

    // Reopening starts at main menu; New moodboard creates a new moodboard with the image and no blank doc
    await click(host.querySelector('button[aria-label="Send to"]'));
    await click(findBtn('Add to moodboard'));
    await click(findBtn('New moodboard'));
    const mbs = useStore.getState().library.filter((s) => s.kind === 'moodboard');
    expect(mbs).toHaveLength(2);
    const created = mbs.find((s) => s.id !== mb.subject.id)!;
    expect(created.graph?.nodes.some((n) => n.data.kind === 'asset' && n.data.assetId === img.id)).toBe(true);
    expect(created.versions?.length).toBe(1);
    expect(useStore.getState().sessions[sid()].docs).toHaveLength(0);
  });
});
