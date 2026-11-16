// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, Blob>() }));

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async (id: string) => blobs.get(id),
  putAssetBlob: async (id: string, b: Blob) => {
    blobs.set(id, b);
    return `blob:${id}`;
  },
  deleteAssetBlobs: async (ids: string[]) => ids.forEach((id) => blobs.delete(id)),
  peekAssetUrl: (id: string) => (blobs.has(id) ? `blob:${id}` : undefined),
  loadAssetUrl: async (id: string) => (blobs.has(id) ? `blob:${id}` : null),
}));

import { Lightbox } from '../src/components/assets/Lightbox';
import { useViewer3d } from '../src/components/assets/viewer3d';
import type { Asset, Generation } from '../src/engine/types';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
afterAll(() => vi.unstubAllGlobals());

describe('Lightbox viewer layout, floating info panel and bottom dock', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    blobs.clear();
    useViewer3d.setState({ el: null });
    const sessionId = useStore.getState().activeSessionId;
    blobs.set('img1', new Blob(['img1'], { type: 'image/png' }));
    blobs.set('mdl1', new Blob(['glb'], { type: 'model/gltf-binary' }));
    const gen: Generation = {
      id: 'gen1',
      sessionId,
      createdAt: 100,
      kind: 'image',
      prompt: 'A quiet studio portrait',
      modelRef: 'local/img',
      modelName: 'Local Image',
      provider: 'local',
      origin: 'composer',
      status: 'done',
      assetIds: ['img1'],
      inputs: { refs: [] },
      settings: { aspect: '1:1', resolution: '1K', count: 1, advanced: {} },
      estimate: { usd: 0, approximate: false },
    };
    const img: Asset = {
      id: 'img1',
      kind: 'image',
      mime: 'image/png',
      width: 512,
      height: 512,
      sessionId,
      generationId: 'gen1',
      origin: 'generated',
      createdAt: 100,
      stored: true,
      favorite: false,
    };
    const mdl: Asset = {
      id: 'mdl1',
      kind: 'model3d',
      mime: 'model/gltf-binary',
      width: 512,
      height: 512,
      sessionId,
      origin: 'generated',
      createdAt: 110,
      stored: true,
      favorite: false,
    };
    useStore.setState((st) => ({
      generations: { ...st.generations, gen1: gen },
      assets: { ...st.assets, img1: img, mdl1: mdl },
      ui: { ...st.ui, lightbox: { assetIds: ['img1'], index: 0 }, lightboxInfo: false, sketch: null },
    }));

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  const cleanup = () => {
    act(() => root.unmount());
    host.remove();
    setUi({ lightbox: null, lightboxInfo: false, sketch: null });
    useViewer3d.setState({ el: null });
  };

  it('removes .lb-side, keeps top-right floating cluster in order, and toggles floating info panel remembered across reopens', () => {
    act(() => {
      root.render(createElement(Lightbox));
    });

    // 1. No fixed right side panel (.lb-side)
    expect(host.querySelector('.lb-side')).toBeNull();
    expect(host.querySelector('.lb-stage')).toBeTruthy();

    // 2. Top-right cluster keeps icons in exact order: Download, Favorite, Attach, Send to, Info, Close
    const topCluster = host.querySelector('.lb-top-actions')!;
    expect(topCluster).toBeTruthy();
    const topLabels = [...topCluster.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(topLabels).toEqual(['Download', 'Favorite', 'Attach to prompt', 'Send to', 'Info', 'Close (Esc)']);

    // Closed by default
    expect(host.querySelector('.lb-info-panel')).toBeNull();
    const infoBtn = topCluster.querySelector<HTMLButtonElement>('[aria-label="Info"]')!;
    expect(infoBtn.getAttribute('aria-pressed')).toBe('false');

    // Toggle open -> floating details panel anchored top-right with GenerationInfo
    act(() => infoBtn.click());
    const panel = host.querySelector<HTMLElement>('.lb-info-panel')!;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('A quiet studio portrait');
    expect(infoBtn.getAttribute('aria-pressed')).toBe('true');
    expect(useStore.getState().ui.lightboxInfo).toBe(true);

    // Close and reopen viewer -> remembers open state for the session
    const closeBtn = topCluster.querySelector<HTMLButtonElement>('[aria-label="Close (Esc)"]')!;
    act(() => closeBtn.click());
    expect(host.querySelector('[role="dialog"][aria-label="Viewer"]')).toBeNull();

    act(() => setUi({ lightbox: { assetIds: ['img1'], index: 0 } }));
    expect(host.querySelector('.lb-info-panel')).toBeTruthy();

    // Toggle closed -> remembers closed state too
    act(() => host.querySelector<HTMLButtonElement>('.lb-top-actions [aria-label="Info"]')!.click());
    expect(host.querySelector('.lb-info-panel')).toBeNull();
    expect(useStore.getState().ui.lightboxInfo).toBe(false);

    cleanup();
  });

  it('shows Viewer3DControls inside the floating info panel for 3D assets when Info is open', () => {
    act(() => {
      setUi({ lightbox: { assetIds: ['mdl1'], index: 0 }, lightboxInfo: true });
      useViewer3d.setState({ el: document.createElement('div') as never });
      root.render(createElement(Lightbox));
    });

    const panel = host.querySelector<HTMLElement>('.lb-info-panel')!;
    expect(panel).toBeTruthy();
    expect(panel.querySelector('.v3d')).toBeTruthy();
    expect(panel.textContent).toContain('3D controls');

    cleanup();
  });

  it('puts Pintar first as a visible button in the bottom dock and keeps the rest in More', () => {
    act(() => {
      root.render(createElement(Lightbox));
    });

    const dock = host.querySelector<HTMLElement>('.lb-dock .asset-actions')!;
    expect(dock).toBeTruthy();
    const dockButtons = [...dock.querySelectorAll<HTMLButtonElement>(':scope > button')];
    expect(dockButtons[0].textContent).toContain('Pintar');

    // Open More -> Pintar is NOT hidden in More, while Edit region / Remove object stays
    const moreBtn = dock.querySelector<HTMLButtonElement>('[aria-label="More"]')!;
    moreBtn.getBoundingClientRect = () => ({ left: 100, top: 100, right: 130, bottom: 130, width: 30, height: 30, x: 100, y: 100, toJSON() {} });
    act(() => moreBtn.click());

    const menuItems = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Operations"] button')];
    expect(menuItems.some((b) => b.textContent === 'Pintar' || /Paint \/ Edit image/i.test(b.textContent ?? ''))).toBe(false);
    expect(menuItems.some((b) => b.textContent?.includes('Edit region / Remove object'))).toBe(true);

    // Clicking Pintar directly opens SketchEditor in paint mode
    act(() => dockButtons[0].click());
    expect(useStore.getState().ui.sketch).toEqual({ assetId: 'img1', mode: 'paint' });

    cleanup();
  });
});
