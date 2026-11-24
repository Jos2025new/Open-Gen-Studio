// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const blobs = new Map<string, Blob>();
  let onSet: ((key: string) => void | Promise<void>) | null = null;
  return {
    blobs,
    setOnSet: (fn: ((key: string) => void | Promise<void>) | null) => { onSet = fn; },
    blobDb: {
      get: async (k: string) => blobs.get(k),
      set: async (k: string, b: Blob) => { if (onSet) await onSet(k); blobs.set(k, b); },
      del: async (k: string) => { blobs.delete(k); },
      delMany: async (ks: string[]) => { for (const k of ks) blobs.delete(k); },
    },
  };
});

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: hoisted.blobDb,
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
import type { Asset } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let hostA: HTMLDivElement;
let hostB: HTMLDivElement;
let rootA: Root;
let rootB: Root;
const sid = () => useStore.getState().activeSessionId;
const click = async (el: Element | null | undefined) => {
  await act(async () => { (el as HTMLElement).click(); });
};
const mkAsset = (id: string): Asset => ({
  id, sessionId: sid(), kind: 'image', mime: 'image/png', name: `${id}.png`,
  createdAt: 1, origin: 'upload', width: 256, height: 256, stored: true, favorite: false,
});

beforeEach(() => {
  hoisted.blobs.clear();
  hoisted.setOnSet(null);
  localStorage.clear();
  hostA = document.createElement('div');
  hostB = document.createElement('div');
  document.body.append(hostA, hostB);
  rootA = createRoot(hostA);
  rootB = createRoot(hostB);
  const s = createSession('SendTo Fresh Test');
  act(() => {
    useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
    setUi({ workspace: 'chat', home: false, panel: null });
  });
});

afterEach(async () => {
  hoisted.setOnSet(null);
  await act(async () => { rootA.unmount(); rootB.unmount(); });
  hostA.remove();
  hostB.remove();
  document.body.innerHTML = '';
});

describe('Lote E Punto 5: Add to moodboard reads fresh entry from store so back-to-back adds never clobber', () => {
  it('preserves both images when two SendToMenus add to the same moodboard back-to-back', async () => {
    const img1 = mkAsset('img-1');
    const img2 = mkAsset('img-2');
    act(() => { useStore.setState({ assets: { 'img-1': img1, 'img-2': img2 } }); });
    const { subject: mb } = await createItem({ name: 'Warm Vibes', kind: 'moodboard', space: 'library', by: 'user', draft: false });

    await act(async () => {
      rootA.render(createElement(SendToMenu, { assetId: 'img-1' }));
      rootB.render(createElement(SendToMenu, { assetId: 'img-2' }));
    });

    // Open both menus to "Add to moodboard" so both hold the initial render snapshot
    await click(hostA.querySelector('button[aria-label="Send to"]'));
    const addBtnsA = [...document.querySelectorAll<HTMLButtonElement>('.menu button')].filter((b) => b.textContent?.includes('Add to moodboard'));
    await click(addBtnsA[0]);

    await click(hostB.querySelector('button[aria-label="Send to"]'));
    const addBtnsB = [...document.querySelectorAll<HTMLButtonElement>('.menu button')].filter((b) => b.textContent?.includes('Add to moodboard'));
    await click(addBtnsB[addBtnsB.length - 1]);

    // Pause first save mid-flight while second click fires right behind it
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let paused = false;
    hoisted.setOnSet((k) => {
      if (!paused && k.startsWith('libver:')) { paused = true; return gate; }
    });

    const targetBtns = [...document.querySelectorAll<HTMLButtonElement>('.menu button')].filter((b) => b.textContent?.includes('Warm Vibes'));
    expect(targetBtns).toHaveLength(2);
    await act(async () => {
      targetBtns[0].click();
      targetBtns[1].click();
    });
    release();
    await act(async () => {
      await vi.waitFor(() => {
        const updated = useStore.getState().library.find((s) => s.id === mb.id)!;
        const ids = (updated.graph?.nodes ?? []).map((n) => (n.data.kind === 'asset' ? n.data.assetId : null)).sort();
        expect(ids).toEqual(['img-1', 'img-2']);
      });
    });
  });
});
