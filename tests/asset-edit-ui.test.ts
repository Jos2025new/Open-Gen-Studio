// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
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
  canvasToAsset: vi.fn(async () => ({ id: 'node-sketch-copy' })),
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

vi.mock('../src/engine/flow/actions', () => ({
  setSketch: vi.fn(),
}));

import { AssetActions } from '../src/components/assets/AssetActions';
import { SketchEditor } from '../src/components/assets/SketchEditor';
import { Toasts } from '../src/components/ui/Toasts';
import { subjectFromAsset } from '../src/engine/actions';
import { ADAPTERS } from '../src/engine/providers/registry';
import { canvasToAsset } from '../src/engine/design/actions';
import { setSketch } from '../src/engine/flow/actions';
import type { Asset, ModelSchema, ModelSummary } from '../src/engine/types';
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
    vi.clearAllMocks();
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
      assets: { hero },
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

  const openPaintFromDock = () => {
    const paintBtn = [...host.querySelectorAll<HTMLButtonElement>('.asset-actions > button')].find((b) => b.textContent?.includes('Pintar'));
    expect(paintBtn).toBeTruthy();
    act(() => paintBtn!.click());
  };

  const getSaveBtn = () =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Editor de imagen"] .sketch-bar > button')]
      .find((b) => b.textContent?.trim() === 'Guardar')!;

  it('opens Sketch in paint mode from Pintar, offers Guardar (default, versioned) and Guardar como copia, and offers Deshacer toast', async () => {
    act(() => {
      root.render(createElement('div', null, createElement(AssetActions, { assetId: 'hero' }), createElement(SketchEditor), createElement(Toasts)));
    });

    const moreBtn = host.querySelector<HTMLButtonElement>('[aria-label="More"]')!;
    moreBtn.getBoundingClientRect = () => ({ left: 100, top: 100, right: 130, bottom: 130, width: 30, height: 30, x: 100, y: 100, toJSON() {} });
    act(() => moreBtn.click());

    const menuButtons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Operations"] button')];
    expect(menuButtons.some((b) => b.textContent?.includes('Revertir'))).toBe(false);
    expect(menuButtons.some((b) => /paint/i.test(b.textContent ?? '') && !/region/i.test(b.textContent ?? ''))).toBe(false);
    act(() => moreBtn.click());
    openPaintFromDock();

    // beginAssetEdit sets ui.sketch to paint mode without mutating the original asset
    expect(useStore.getState().ui.sketch).toEqual({ assetId: 'hero', mode: 'paint' });
    const sketchDialog = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Editor de imagen"]')!;
    expect(sketchDialog).toBeTruthy();
    const paintTab = [...sketchDialog.querySelectorAll('button')].find((b) => b.textContent === 'Pintar')!;
    expect(paintTab.classList.contains('is-active')).toBe(true);
    expect(paintTab.getAttribute('aria-pressed')).toBe('true');
    const maskTab = [...sketchDialog.querySelectorAll('button')].find((b) => b.textContent === 'Máscara')!;
    expect(maskTab.getAttribute('aria-pressed')).toBe('false');
    expect([...sketchDialog.querySelectorAll('button')].some((b) => b.textContent?.includes('Revertir'))).toBe(false);

    // Save disabled until there are changes and uses muted disabled primary styling
    const saveBtn0 = getSaveBtn();
    expect(saveBtn0.disabled).toBe(true);
    expect(saveBtn0.classList.contains('btn-primary')).toBe(true);
    const shellCss = readFileSync('src/styles/shell.css', 'utf8');
    expect(shellCss).toMatch(/\.sketch-bar\s+\.btn-primary:disabled\s*\{[^}]*background:\s*var\(--surface-3\);[^}]*color:\s*var\(--text-3\);/);

    // Paint a stroke; original asset and blob remain untouched
    await paintStroke();
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
    expect(useStore.getState().assets.hero.revisions).toBeUndefined();

    // Save opens Google Photos style sheet with Guardar (first & default) and Guardar como copia
    const saveBtn = getSaveBtn();
    expect(saveBtn.disabled).toBe(false);
    saveBtn.getBoundingClientRect = () => ({ left: 200, top: 20, right: 260, bottom: 50, width: 60, height: 30, x: 200, y: 20, toJSON() {} });
    act(() => saveBtn.click());

    const savePop = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Guardar imagen"]')!;
    expect(savePop).toBeTruthy();
    expect(savePop.style.width).toBe('');
    const sheetBtns = [...savePop.querySelectorAll('button')];
    expect(sheetBtns).toHaveLength(2);
    expect(sheetBtns[0].textContent).toContain('Guardar');
    expect(sheetBtns[0].textContent).toContain('Se guarda en el historial de versiones');
    expect(sheetBtns[0].classList.contains('is-active')).toBe(true);
    expect(sheetBtns[1].textContent).toContain('Guardar como copia');
    expect(sheetBtns[1].textContent).toContain('El original no cambia');

    // 1) Guardar como copia creates a new asset and leaves hero untouched
    await act(async () => {
      sheetBtns[1].click();
      await flush();
    });
    expect(useStore.getState().ui.sketch).toBeNull();
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
    const copyAsset = Object.values(useStore.getState().assets).find((a) => a.copiedFromAssetId === 'hero');
    expect(copyAsset).toBeTruthy();
    expect(await blobs.get(copyAsset!.id)?.text()).toBe('painted-png-bytes');

    // 2) Guardar appends a new version and keeps verifiable original backup
    openPaintFromDock();
    await paintStroke();
    const saveBtn2 = getSaveBtn();
    saveBtn2.getBoundingClientRect = () => ({ left: 200, top: 20, right: 260, bottom: 50, width: 60, height: 30, x: 200, y: 20, toJSON() {} });
    act(() => saveBtn2.click());
    const origBtn2 = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Guardar imagen"] button')][0];
    await act(async () => {
      origBtn2.click();
      await flush();
    });
    expect(useStore.getState().ui.sketch).toBeNull();
    expect(await blobs.get('hero')?.text()).toBe('painted-png-bytes');
    const heroAfter = useStore.getState().assets.hero;
    expect(heroAfter.revisionIndex).toBe(1);
    expect(heroAfter.revisions).toHaveLength(2);
    expect(await blobs.get(heroAfter.revisions![0].assetId)?.text()).toBe('original-bytes');

    // Toast includes Deshacer action button (and no standalone Revertir button exists in SketchEditor)
    const toastUndoBtn = host.querySelector<HTMLButtonElement>('.toast-action');
    expect(toastUndoBtn?.textContent).toBe('Deshacer');
    openPaintFromDock();
    await act(async () => {
      await flush();
    });
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Editor de imagen"] .sketch-bar button')]
        .some((b) => b.textContent?.includes('Revertir')),
    ).toBe(false);

    // Close editor cleanly (no changes)
    const closeBtn = host.querySelector<HTMLButtonElement>('[role="dialog"][aria-label="Editor de imagen"] [aria-label="Cerrar"]')!;
    act(() => closeBtn.click());
    expect(useStore.getState().ui.sketch).toBeNull();

    cleanup();
  });

  it('asks ¿Descartar cambios? when closing with unsaved strokes and never saves implicitly', async () => {
    act(() => {
      root.render(createElement('div', null, createElement(AssetActions, { assetId: 'hero' }), createElement(SketchEditor)));
    });
    openPaintFromDock();
    await paintStroke();

    const closeBtn = host.querySelector<HTMLButtonElement>('[role="dialog"][aria-label="Editor de imagen"] [aria-label="Cerrar"]')!;
    closeBtn.getBoundingClientRect = () => ({ left: 300, top: 20, right: 330, bottom: 50, width: 30, height: 30, x: 300, y: 20, toJSON() {} });
    act(() => closeBtn.click());

    const discardPop = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Descartar cambios"]')!;
    expect(discardPop).toBeTruthy();
    expect(discardPop.textContent).toContain('¿Descartar cambios?');
    expect(discardPop.textContent).toContain('Tus cambios no se guardarán');
    const keepBtn = [...discardPop.querySelectorAll('button')].find((b) => b.textContent === 'Seguir editando')!;
    const dropBtn = [...discardPop.querySelectorAll('button')].find((b) => b.textContent === 'Descartar')!;
    expect(keepBtn).toBeTruthy();
    expect(dropBtn).toBeTruthy();

    // Seguir editando keeps editor open and image untouched
    act(() => keepBtn.click());
    expect(useStore.getState().ui.sketch).toEqual({ assetId: 'hero', mode: 'paint' });
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');

    // Descartar closes without saving
    act(() => closeBtn.click());
    const dropBtn2 = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Descartar cambios"] button')]
      .find((b) => b.textContent === 'Descartar')!;
    act(() => dropBtn2.click());
    expect(useStore.getState().ui.sketch).toBeNull();
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
    expect(Object.values(useStore.getState().assets).some((a) => a.copiedFromAssetId === 'hero')).toBe(false);

    cleanup();
  });

  it('keeps node targets saving directly as a copy without opening the save sheet', async () => {
    act(() => {
      setUi({ sketch: { assetId: 'hero', nodeId: 'node-1', mode: 'paint' } });
      root.render(createElement(SketchEditor));
    });
    await paintStroke();
    const saveBtn = getSaveBtn();
    await act(async () => {
      saveBtn.click();
      await flush();
    });

    expect(document.querySelector('[role="dialog"][aria-label="Guardar imagen"]')).toBeNull();
    expect(canvasToAsset).toHaveBeenCalledTimes(1);
    expect(setSketch).toHaveBeenCalledWith(useStore.getState().activeSessionId, 'node-1', 'node-sketch-copy');
    expect(useStore.getState().ui.sketch).toBeNull();

    cleanup();
  });

  it('undoes back to the previous version via the toast Deshacer button without deleting versions', async () => {
    act(() => {
      root.render(
        createElement(
          'div',
          null,
          createElement(AssetActions, { assetId: 'hero' }),
          createElement(SketchEditor),
          createElement(Toasts),
        ),
      );
    });
    expect(host.textContent).not.toContain('Revertir');

    openPaintFromDock();
    await paintStroke();
    const saveBtn = getSaveBtn();
    saveBtn.getBoundingClientRect = () => ({ left: 200, top: 20, right: 260, bottom: 50, width: 60, height: 30, x: 200, y: 20, toJSON() {} });
    act(() => saveBtn.click());
    const origBtn = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Guardar imagen"] button')][0];
    await act(async () => {
      origBtn.click();
      await flush();
    });

    const toastUndoBtn = host.querySelector<HTMLButtonElement>('.toast-action')!;
    expect(toastUndoBtn).toBeTruthy();
    expect(toastUndoBtn.textContent).toBe('Deshacer');
    await act(async () => {
      toastUndoBtn.click();
      await flush();
    });
    expect(useStore.getState().assets.hero.revisionIndex).toBe(0);
    expect(useStore.getState().assets.hero.revisions).toHaveLength(2);
    expect(await blobs.get('hero')?.text()).toBe('original-bytes');
    expect(host.querySelector('.toast-action')).toBeNull();

    cleanup();
  });

  it('keeps SketchEditor open when Guardar (original) cannot verify a backup of the original', async () => {
    act(() => {
      root.render(createElement('div', null, createElement(AssetActions, { assetId: 'hero' }), createElement(SketchEditor)));
    });
    openPaintFromDock();
    await paintStroke();

    // Remove original blob before clicking Guardar (original)
    blobs.delete('hero');
    useStore.setState((st) => ({ ui: { ...st.ui, toasts: [] } }));
    const saveBtn = getSaveBtn();
    saveBtn.getBoundingClientRect = () => ({ left: 200, top: 20, right: 260, bottom: 50, width: 60, height: 30, x: 200, y: 20, toJSON() {} });
    act(() => saveBtn.click());
    const origBtn = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Guardar imagen"] button')][0];
    await act(async () => {
      origBtn.click();
      await flush();
    });

    // Editor stays open with strokes preserved, no success toast emitted
    expect(useStore.getState().ui.sketch).toEqual({ assetId: 'hero', mode: 'paint' });
    expect(useStore.getState().assets.hero.revisions).toBeUndefined();
    expect(useStore.getState().ui.toasts.some((t) => t.level === 'success')).toBe(false);
    expect(useStore.getState().ui.toasts.some((t) => t.level === 'error')).toBe(true);

    cleanup();
  });

  it('sizes the save popover to its content without clipping on the left', async () => {
    const uiCss = readFileSync('src/styles/ui.css', 'utf8');
    expect(uiCss).toMatch(/\.spend-actions\s*\{[^}]*flex-wrap:\s*wrap/);

    act(() => {
      root.render(createElement('div', null, createElement(AssetActions, { assetId: 'hero' }), createElement(SketchEditor)));
    });
    openPaintFromDock();
    await paintStroke();

    const saveBtn = getSaveBtn();
    saveBtn.getBoundingClientRect = () => ({ left: 900, top: 20, right: 960, bottom: 50, width: 60, height: 30, x: 900, y: 20, toJSON() {} });
    act(() => saveBtn.click());

    const savePop = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Guardar imagen"]')!;
    expect(savePop).toBeTruthy();
    expect(savePop.style.width).toBe('');
    expect(Number.parseFloat(savePop.style.left)).toBeGreaterThanOrEqual(8);
    expect(savePop.scrollWidth).toBeLessThanOrEqual(savePop.clientWidth);

    const { boundPopoverLeft, boundPopoverWidth } = await import('../src/components/ui/Popover');
    const contentWidth = 360;
    const vw = 1280;
    const boundedW = boundPopoverWidth(contentWidth, 8, vw - 8);
    const boundedLeft = boundPopoverLeft(960 - boundedW, boundedW, 8, vw - 8);
    expect(boundedW).toBe(360);
    expect(boundedLeft).toBe(600);
    expect(boundedLeft).toBeGreaterThanOrEqual(8);
    expect(boundedLeft + boundedW).toBeLessThanOrEqual(vw - 8);

    cleanup();
  });

  it('applies a mask operation from a Space once confirmed under an active limit (same opSessionId)', async () => {
    const modelRef = 'fal::fal-ai/ideogram/object-removal';
    const model: ModelSummary = { ref: modelRef, provider: 'fal', id: 'fal-ai/ideogram/object-removal', name: 'Object Removal', kind: 'image', acceptsText: true, acceptsImage: true };
    const schema: ModelSchema = { ref: modelRef, source: 'schema', slots: { images: { min: 1, max: 1 }, mask: { key: 'mask_url', kind: 'white' }, promptRequired: false }, params: [] };
    blobs.set('node-sketch-copy', new Blob(['mask-bytes'], { type: 'image/png' }));
    const activeSid = useStore.getState().activeSessionId;
    useStore.setState((st) => ({
      generations: {},
      spentUsd: 0.9,
      assets: {
        ...st.assets,
        'node-sketch-copy': { id: 'node-sketch-copy', kind: 'image', mime: 'image/png', width: 120, height: 80, sessionId: activeSid, origin: 'upload', createdAt: 11, stored: true, favorite: false },
      },
      catalog: { ...st.catalog, models: { ...st.catalog.models, [modelRef]: model }, schemas: { ...st.catalog.schemas, [modelRef]: schema } },
      settings: { ...st.settings, keys: { ...st.settings.keys, fal: 'test-key' }, budgetOn: true, budgetUsd: 1, budgetAccepted: null, budgetNoAsk: false },
      ui: { ...st.ui, space: 'create', sketch: { assetId: 'hero', mode: 'mask' }, toasts: [] },
    }));
    const gen = vi.spyOn(ADAPTERS.fal, 'generate').mockResolvedValue({
      outputs: [{ blob: new Blob(['edited-bytes'], { type: 'image/png' }), mime: 'image/png' }],
    });
    try {
      act(() => {
        root.render(createElement(SketchEditor));
      });
      await paintStroke();

      const applyBtn = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="Editor de imagen"] .sketch-bar > button')]
        .find((b) => b.textContent?.includes('Quitar objeto'))!;
      expect(applyBtn).toBeTruthy();
      applyBtn.getBoundingClientRect = () => ({ left: 200, top: 20, right: 300, bottom: 50, width: 100, height: 30, x: 200, y: 20, toJSON() {} });
      await act(async () => {
        applyBtn.click();
        await flush();
      });

      const confirmPop = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Aplicar máscara"]')!;
      expect(confirmPop).toBeTruthy();
      const continueBtn = [...confirmPop.querySelectorAll<HTMLButtonElement>('.spend-actions button')]
        .find((b) => b.textContent?.includes('Continue once'))!;
      expect(continueBtn).toBeTruthy();

      await act(async () => {
        continueBtn.click();
        await flush();
        await flush();
      });

      expect(useStore.getState().ui.toasts.filter((t) => t.level === 'error')).toEqual([]);
      expect(gen).toHaveBeenCalledTimes(1);
      const created = Object.values(useStore.getState().generations);
      expect(created).toHaveLength(1);
      expect(created[0].sessionId).not.toBe(activeSid);
      expect(useStore.getState().sessions[created[0].sessionId]?.hidden).toBe(true);
    } finally {
      gen.mockRestore();
      useStore.setState((st) => ({ ui: { ...st.ui, space: undefined } }));
      cleanup();
    }
  });
});
