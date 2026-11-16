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

vi.mock('../src/engine/design/actions', () => ({
  openAssetInDesigner: vi.fn(),
  canvasToAsset: vi.fn(),
  assetCanvas: vi.fn(async () => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    return c;
  }),
}));

vi.mock('../src/engine/design/raster', () => ({
  strokeSegment: vi.fn(),
}));

import { AssetActions, RevertAssetMenuItem } from '../src/components/assets/AssetActions';
import { SketchEditor } from '../src/components/assets/SketchEditor';
import { Toasts } from '../src/components/ui/Toasts';
import { subjectFromAsset } from '../src/engine/actions';
import type { Asset } from '../src/engine/types';
import { setUi, useStore } from '../src/store/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
afterAll(() => vi.unstubAllGlobals());

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('AssetActions and SketchEditor library editing flow', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    blobs.clear();
    const sessionId = useStore.getState().activeSessionId;
    const origBlob = new Blob(['original-bytes'], { type: 'image/png' });
    blobs.set('hero', origBlob);
    const hero: Asset = {
      id: 'hero',
      kind: 'image',
      mime: 'image/png',
      width: 120,
      height: 80,
      sessionId,
      origin: 'upload',
      createdAt: 10,
      stored: true,
      favorite: false,
    };
    useStore.setState((st) => ({
      library: [],
      assets: { ...st.assets, hero },
      ui: { ...st.ui, sketch: null, toasts: [] },
    }));
    subjectFromAsset('hero', 'Hero', 'character');

    Element.prototype.setPointerCapture = () => undefined;
    HTMLCanvasElement.prototype.getContext = (() => ({
      drawImage: () => undefined,
      clearRect: () => undefined,
      fillRect: () => undefined,
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(new Blob(['painted-png-bytes'], { type: 'image/png' }));
    };

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  const cleanup = () => {
    act(() => root.unmount());
    host.remove();
    setUi({ sketch: null });
  };

  const paintStroke = async () => {
    await act(async () => {
      await flush();
    });
    const paint = host.querySelector<HTMLCanvasElement>('canvas.sketch-paint')!;
    expect(paint).toBeTruthy();
    paint.getBoundingClientRect = () => ({ left: 0, top: 0, right: 120, bottom: 80, width: 120, height: 80, x: 0, y: 0, toJSON() {} });
    await act(async () => {
      paint.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      paint.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 20, clientY: 20 }));
    });
  };

  it('opens Sketch in paint mode on a working copy from AssetActions and offers Guardar como copia (default) or Aplicar al original', async () => {
    act(() => {
      root.render(createElement('div', null, createElement(AssetActions, { assetId: 'hero' }), createElement(SketchEditor), createElement(Toasts)));
    });

    const moreBtn = host.querySelector<HTMLButtonElement>('[aria-label="More"]')!;
    moreBtn.getBoundingClientRect = () => ({ left: 100, top: 100, right: 130, bottom: 130, width: 30, height: 30, x: 100, y: 100, toJSON() {} });
    act(() => moreBtn.click());

    const menuButtons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Operations"] button')];
    expect(menuButtons.some((b) => b.textContent?.includes('Revertir'))).toBe(false);
    const editBtn = menuButtons.find((b) => /paint/i.test(b.textContent ?? '') && !/region/i.test(b.textContent ?? ''));
    expect(editBtn).toBeTruthy();
    act(() => editBtn!.click());

    // beginAssetEdit sets ui.sketch to paint mode without mutating the original asset
    expect(useStore.getState().ui.sketch).toEqual({ assetId: 'hero', mode: 'paint' });
    const sketchDialog = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Sketch"]')!;
    expect(sketchDialog).toBeTruthy();
    const paintTab = [...sketchDialog.querySelectorAll('button')].find((b) => b.textContent === 'Paint')!;
    expect(paintTab.classList.contains('is-active')).toBe(true);

    // Paint a stroke; original asset and blob remain untouched
    await paintStroke();
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
    expect(useStore.getState().assets.hero.originalRevision).toBeUndefined();

    // Save offers Guardar como copia (primary/default) and Aplicar al original
    const saveBtn = [...sketchDialog.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    saveBtn.getBoundingClientRect = () => ({ left: 200, top: 20, right: 260, bottom: 50, width: 60, height: 30, x: 200, y: 20, toJSON() {} });
    act(() => saveBtn.click());

    const savePop = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Save asset"]')!;
    expect(savePop).toBeTruthy();
    const copyBtn = [...savePop.querySelectorAll('button')].find((b) => b.textContent?.includes('Guardar como copia'))!;
    const origBtn = [...savePop.querySelectorAll('button')].find((b) => b.textContent?.includes('Aplicar al original'))!;
    expect(copyBtn.classList.contains('btn-primary')).toBe(true);
    expect(origBtn.classList.contains('btn-secondary')).toBe(true);

    // 1) Guardar como copia creates a new asset and leaves hero untouched
    await act(async () => {
      copyBtn.click();
      await flush();
    });
    expect(useStore.getState().ui.sketch).toBeNull();
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
    const copyAsset = Object.values(useStore.getState().assets).find((a) => a.copiedFromAssetId === 'hero');
    expect(copyAsset).toBeTruthy();
    expect(await blobs.get(copyAsset!.id)?.text()).toBe('painted-png-bytes');

    // 2) Aplicar al original updates hero in place with a verifiable backup revision
    act(() => moreBtn.click());
    const editBtn2 = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Operations"] button')]
      .find((b) => /paint/i.test(b.textContent ?? '') && !/region/i.test(b.textContent ?? ''))!;
    act(() => editBtn2.click());
    await paintStroke();
    const saveBtn2 = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Sketch"] button')]
      .find((b) => b.textContent === 'Save')!;
    saveBtn2.getBoundingClientRect = () => ({ left: 200, top: 20, right: 260, bottom: 50, width: 60, height: 30, x: 200, y: 20, toJSON() {} });
    act(() => saveBtn2.click());
    const origBtn2 = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Save asset"] button')]
      .find((b) => b.textContent?.includes('Aplicar al original'))!;
    await act(async () => {
      origBtn2.click();
      await flush();
    });
    expect(useStore.getState().ui.sketch).toBeNull();
    expect(await blobs.get('hero')?.text()).toBe('painted-png-bytes');
    const rev = useStore.getState().assets.hero.originalRevision;
    expect(rev).toBeTruthy();
    expect(await blobs.get(rev!.assetId)?.text()).toBe('original-bytes');

    // Toast includes a real Revertir action button
    const toastRevertBtn = host.querySelector<HTMLButtonElement>('.toast-action');
    expect(toastRevertBtn?.textContent).toBe('Revertir');

    // Revertir appears in the image menu after apply, restores the original, and disappears
    act(() => moreBtn.click());
    const revertMenuBtn = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Operations"] button')]
      .find((b) => b.textContent?.includes('Revertir'));
    expect(revertMenuBtn).toBeTruthy();
    await act(async () => {
      revertMenuBtn!.click();
      await flush();
    });
    expect(useStore.getState().assets.hero.originalRevision).toBeUndefined();
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');

    act(() => moreBtn.click());
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Operations"] button')]
        .some((b) => b.textContent?.includes('Revertir')),
    ).toBe(false);

    cleanup();
  });

  it('restores the original via the toast Revertir button and hides RevertAssetMenuItem when nothing to revert', async () => {
    act(() => {
      root.render(
        createElement(
          'div',
          null,
          createElement(AssetActions, { assetId: 'hero' }),
          createElement(RevertAssetMenuItem, { assetId: 'hero' }),
          createElement(SketchEditor),
          createElement(Toasts),
        ),
      );
    });
    expect(host.textContent).not.toContain('Revertir');

    const moreBtn = host.querySelector<HTMLButtonElement>('[aria-label="More"]')!;
    moreBtn.getBoundingClientRect = () => ({ left: 100, top: 100, right: 130, bottom: 130, width: 30, height: 30, x: 100, y: 100, toJSON() {} });
    act(() => moreBtn.click());
    const editBtn = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Operations"] button')]
      .find((b) => /paint/i.test(b.textContent ?? '') && !/region/i.test(b.textContent ?? ''))!;
    act(() => editBtn.click());
    await paintStroke();
    const saveBtn = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Sketch"] button')]
      .find((b) => b.textContent === 'Save')!;
    saveBtn.getBoundingClientRect = () => ({ left: 200, top: 20, right: 260, bottom: 50, width: 60, height: 30, x: 200, y: 20, toJSON() {} });
    act(() => saveBtn.click());
    const origBtn = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Save asset"] button')]
      .find((b) => b.textContent?.includes('Aplicar al original'))!;
    await act(async () => {
      origBtn.click();
      await flush();
    });

    const toastRevertBtn = host.querySelector<HTMLButtonElement>('.toast-action')!;
    expect(toastRevertBtn).toBeTruthy();
    expect(toastRevertBtn.textContent).toBe('Revertir');
    await act(async () => {
      toastRevertBtn.click();
      await flush();
    });
    expect(useStore.getState().assets.hero.originalRevision).toBeUndefined();
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
    expect(host.querySelector('.toast-action')).toBeNull();
    expect(host.textContent).not.toContain('Revertir');

    cleanup();
  });

  it('keeps SketchEditor open when Aplicar al original cannot verify a backup of the original', async () => {
    act(() => {
      root.render(createElement('div', null, createElement(AssetActions, { assetId: 'hero' }), createElement(SketchEditor)));
    });
    const moreBtn = host.querySelector<HTMLButtonElement>('[aria-label="More"]')!;
    moreBtn.getBoundingClientRect = () => ({ left: 100, top: 100, right: 130, bottom: 130, width: 30, height: 30, x: 100, y: 100, toJSON() {} });
    act(() => moreBtn.click());
    const editBtn = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Operations"] button')]
      .find((b) => /paint/i.test(b.textContent ?? '') && !/region/i.test(b.textContent ?? ''))!;
    act(() => editBtn.click());
    await paintStroke();

    // Remove original blob before clicking Aplicar al original
    blobs.delete('hero');
    useStore.setState((st) => ({ ui: { ...st.ui, toasts: [] } }));
    const saveBtn = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Sketch"] button')]
      .find((b) => b.textContent === 'Save')!;
    saveBtn.getBoundingClientRect = () => ({ left: 200, top: 20, right: 260, bottom: 50, width: 60, height: 30, x: 200, y: 20, toJSON() {} });
    act(() => saveBtn.click());
    const origBtn = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Save asset"] button')]
      .find((b) => b.textContent?.includes('Aplicar al original'))!;
    await act(async () => {
      origBtn.click();
      await flush();
    });

    // Editor stays open with strokes preserved, no success toast emitted
    expect(useStore.getState().ui.sketch).toEqual({ assetId: 'hero', mode: 'paint' });
    expect(useStore.getState().assets.hero.originalRevision).toBeUndefined();
    expect(useStore.getState().ui.toasts.some((t) => t.level === 'success')).toBe(false);
    expect(useStore.getState().ui.toasts.some((t) => t.level === 'error')).toBe(true);

    cleanup();
  });
});
