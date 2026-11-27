// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../src/lib/idb', () => {
  const blobs = new Map<string, Blob>();
  return {
    stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
    cacheDb: { get: async () => undefined, set: async () => undefined },
    blobDb: {
      get: async (k: string) => blobs.get(k),
      set: async (k: string, v: Blob) => { blobs.set(k, v); },
      del: async (k: string) => { blobs.delete(k); },
      delMany: async (ks: string[]) => { ks.forEach((k) => blobs.delete(k)); },
    },
    getAssetBlob: async () => undefined,
    putAssetBlob: async () => undefined,
    deleteAssetBlobs: async () => undefined,
  };
});

vi.mock('../src/engine/actions', async (orig) => {
  const actual = await orig<typeof import('../src/engine/actions')>();
  return {
    ...actual,
    uploadFiles: async (files: File[]) => files.map((f, i) => {
      const id = `ast_up_${i}_${f.name.replace(/[^a-z0-9]/gi, '_')}`;
      useStore.setState((st) => ({
        assets: {
          ...st.assets,
          [id]: { id, sessionId: st.activeSessionId, kind: 'image', mime: f.type || 'image/png', name: f.name, width: 200, height: 100, origin: 'upload', stored: true, favorite: false, createdAt: Date.now() },
        },
      }));
      return id;
    }),
  };
});

import { BrandSyncNotice } from '../src/components/designer/BrandSyncNotice';
import { KitTokens as KitTokensEditor } from '../src/components/gallery/KitTokens';
import { autoLinkDocToBrand, formatBrandLinkSummary, previewBrandLink } from '../src/engine/brandAutoLink';
import { formatBulkImportSummary, importBrandFiles } from '../src/engine/brandBulkImport';
import { dismissBrandSyncNotice, installBrandSync } from '../src/engine/brandSync';
import { run } from '../src/engine/commands';
import { addTextLayer, addVectorLayer, getDoc, mutateDoc, newBlankDoc, undoDoc } from '../src/engine/design/actions';
import { newRasterLayer } from '../src/engine/design/doc';
import { installTokenSync, tokenOf } from '../src/engine/design/tokenBind';
import { addToSection, sectionNodes } from '../src/engine/librarySections';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import type { KitTokens } from '../src/engine/libraryTypes';
import type { RasterLayer, TextLayer, VectorLayer } from '../src/engine/types';
import { createSession, setComposer, setDoc, setSettings, useStore } from '../src/store/store';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Canva-simple Brand Kit: bulk drop import & 1-click auto-link', () => {
  let sid: string, kitId: string, docId: string;
  let stopTokens: () => void, stopBrand: () => void;
  let host: HTMLDivElement, root: Root;

  const TOKENS: KitTokens = {
    'marca.fondo': { type: 'color', value: '#f4f7f2' },
    'firma.pastilla': { type: 'color', value: '#1c2a1ccc' },
    'firma.texto': { type: 'color', value: '#ffffff' },
    'marca.fuente': { type: 'fontFamily', value: 'Outfit, sans-serif' },
    'firma.tamano': { type: 'dimension', value: '18px' },
    'firma.radio': { type: 'dimension', value: '12px' },
    'marca.logo.ancho': { type: 'dimension', value: '320px' },
  };

  beforeEach(async () => {
    const s = createSession('S1');
    useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
    sid = s.id;
    setSettings({ brandSyncMode: 'auto' });
    dismissBrandSyncNotice();
    stopTokens = installTokenSync();
    stopBrand = installBrandSync();
    kitId = (await createItem({ name: 'Marca Verde', kind: 'brand-kit', tokens: TOKENS, space: 'library', by: 'user' })).subject.id;
    setComposer({ kitId });
    docId = newBlankDoc(sid, { label: 'Importado SVG', width: 1080, height: 1080 }).id;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    stopBrand();
    stopTokens();
    dismissBrandSyncNotice();
    setSettings({ brandSyncMode: 'auto' });
    setComposer({ kitId: null });
  });

  it('bulk-imports mixed tokens.json, logos and photos in one drop and classifies them automatically', async () => {
    const emptyKit = (await createItem({ name: 'Nueva Marca', kind: 'brand-kit', space: 'library', by: 'user' })).subject.id;
    const jsonFile = new File([JSON.stringify({
      marca: { fondo: { $type: 'color', $value: '#1c2a1c' }, radio: { $type: 'dimension', $value: '14px' } },
    })], 'tokens.json', { type: 'application/json' });
    const logoFile = new File(['png'], 'logo-horizontal-oscuro.png', { type: 'image/png' });
    const photoFile = new File(['png'], 'hero-banner.png', { type: 'image/png' });
    const ignored = new File(['hi'], 'readme.txt', { type: 'text/plain' });

    const res = await importBrandFiles(emptyKit, [jsonFile, logoFile, photoFile, ignored]);
    expect(res).toMatchObject({ tokens: 2, logos: 1, images: 1, skipped: ['readme.txt'] });
    expect(formatBulkImportSummary(res)).toContain('2 tokens');
    expect(formatBulkImportSummary(res)).toContain('1 logo');

    const kit = useStore.getState().library.find((s) => s.id === emptyKit)!;
    expect(kit.tokens?.['marca.fondo']?.value).toBe('#1c2a1c');
    expect(kit.tokens?.['marca.radio']?.value).toBe('14px');
    expect(sectionNodes(kit, { title: 'Logos' })).toHaveLength(1);
    expect(sectionNodes(kit, { title: 'Photos' })).toHaveLength(1);
  });

  it('auto-links colors (with alpha), font, size, radius, width, background and logo in 1 undo step, and live-syncs afterwards', async () => {
    // Seed a logo slot in the Brand Kit.
    useStore.setState((st) => ({
      assets: { ...st.assets, ast_logo: { id: 'ast_logo', sessionId: sid, kind: 'image', mime: 'image/png', name: 'logo-horizontal-oscuro.png', width: 320, height: 80, origin: 'upload', stored: true, favorite: false, createdAt: 1 } },
    }));
    await addToSection(kitId, 'Logos', { assetIds: ['ast_logo'] });

    // Build a static imported-like document (no tokens or libraryAsset attached yet).
    mutateDoc(sid, docId, (d) => ({ ...d, background: '#f4f7f2' }));
    addVectorLayer(sid, docId, [{
      type: 'rect', x: 40, y: 900, w: 320, h: 52, fill: '#1c2a1c', fillOpacity: 0.8, stroke: null, strokeWidth: 0, radius: 12, rx: 12, ry: 12,
    }]);
    addTextLayer(sid, docId, '@marcaverde', { x: 60, y: 916, width: 200 }, { color: '#ffffff', fontFamily: 'Outfit', fontSize: 18 });
    const staticLogo: RasterLayer = newRasterLayer('logo-horizontal-oscuro.png', { x: 40, y: 800, width: 320, height: 80 }, { width: 320, height: 80 });
    setDoc(sid, docId, (d) => ({ ...d, layers: [...d.layers, staticLogo] }));

    const preview = previewBrandLink(getDoc(sid, docId)!, kitId);
    expect(preview).toMatchObject({ colors: 3, fonts: 1, sizes: 1, radii: 1, widths: 2, logos: 1, total: 9 });
    expect(formatBrandLinkSummary(preview)).toContain('3 colors');
    expect(formatBrandLinkSummary(preview)).toContain('1 logo');

    // Run via 1-click autoLinkDocToBrand (or command library.item.auto_link).
    const linked = autoLinkDocToBrand(sid, docId, kitId);
    expect(linked.total).toBe(9);
    expect(previewBrandLink(getDoc(sid, docId)!, kitId).total).toBe(0);

    const after = getDoc(sid, docId)!;
    expect(tokenOf(after, 'background')?.token).toBe('marca.fondo');
    const shape = (after.layers[0] as VectorLayer).shapes[0];
    expect(tokenOf(shape, 'fill')?.token).toBe('firma.pastilla');
    expect(tokenOf(shape, 'radius')?.token).toBe('firma.radio');
    expect(tokenOf(shape, 'width')?.token).toBe('marca.logo.ancho');
    const text = after.layers[1] as TextLayer;
    expect(tokenOf(text, 'color')?.token).toBe('firma.texto');
    expect(tokenOf(text, 'fontFamily')?.token).toBe('marca.fuente');
    expect(tokenOf(text, 'fontSize')?.token).toBe('firma.tamano');
    const logo = after.layers[2] as RasterLayer;
    expect(logo.libraryAsset?.subjectId).toBe(kitId);
    expect(tokenOf(logo, 'width')?.token).toBe('marca.logo.ancho');

    // Updating a token now propagates live to the previously-static design!
    await saveItem({ subjectId: kitId, mode: 'overwrite', space: 'library', by: 'user', tokens: { ...TOKENS, 'firma.radio': { type: 'dimension', value: '24px' } } });
    expect((getDoc(sid, docId)!.layers[0] as VectorLayer).shapes[0].radius).toBe(24);

    // 1 single Ctrl+Z reverts the entire auto-link cleanly.
    undoDoc(sid, docId);
    const undone = getDoc(sid, docId)!;
    expect(tokenOf((undone.layers[0] as VectorLayer).shapes[0], 'radius')).toBeUndefined();
    expect((undone.layers[2] as RasterLayer).libraryAsset).toBeUndefined();
  });

  it('shows 1-click "Link all" corner suggestion in BrandSyncNotice and supports library.item.auto_link command', async () => {
    addVectorLayer(sid, docId, [{ type: 'rect', x: 0, y: 0, w: 320, h: 40, fill: '#ffffff', stroke: null, strokeWidth: 0, radius: 12, rx: 12, ry: 12 }]);
    act(() => root.render(createElement(BrandSyncNotice, { sessionId: sid })));
    expect(host.textContent).toContain('Matches "Marca Verde"');
    expect(host.textContent).toContain('Link all');

    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Link all'))!;
    act(() => btn.click());
    expect(previewBrandLink(getDoc(sid, docId)!, kitId).total).toBe(0);

    // Agent command works on a fresh doc too.
    const doc2 = newBlankDoc(sid, { label: 'Doc2', width: 500, height: 500 }).id;
    addTextLayer(sid, doc2, 'Hola', { x: 10, y: 10, width: 200 }, { color: '#ffffff', fontFamily: 'Outfit', fontSize: 18 });
    const res = await run({ cmd: 'library.item.auto_link', on: { session: sid, doc: doc2 }, args: {} }, { caller: 'agent' });
    expect(res.ok).toBe(true);
    expect(res.results[0]).toMatchObject({ total: 3, colors: 1, fonts: 1, sizes: 1 });
  });

  it('KitTokens shows empty state, auto-saves imported W3C tokens.json immediately, and notifies on empty JSON', async () => {
    const emptyKit = (await createItem({ name: 'Luna Kit', kind: 'brand-kit', space: 'library', by: 'user', draft: false, open: false })).subject;
    act(() => root.render(createElement(KitTokensEditor, { item: emptyKit, types: ['color'] })));
    expect(host.textContent).toContain('No colors yet');
    expect(host.textContent).toContain('Import tokens.json');

    const input = host.querySelector('input[type="file"][aria-label="Import tokens JSON"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const w3cFile = new File(
      [JSON.stringify({
        $schema: 'https://design-tokens.github.io/community-group/format/',
        color: { ink: { $type: 'color', $value: '#1c2a1ccc' }, accent: { $type: 'color', $value: '#e85d3f' } },
        font: { body: { $type: 'fontFamily', $value: 'Inter' } },
        dimension: { radius: { $type: 'dimension', $value: '12px' } },
      })],
      'tokens.json',
      { type: 'application/json' },
    );
    Object.defineProperty(input, 'files', { value: [w3cFile], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });

    const saved = useStore.getState().library.find((s) => s.id === emptyKit.id);
    expect(saved?.tokens?.['color.ink']?.value).toBe('#1c2a1ccc');
    expect(saved?.tokens?.['color.accent']?.value).toBe('#e85d3f');
    expect(saved?.tokens?.['font.body']?.value).toBe('Inter');
    expect(saved?.tokens?.['dimension.radius']?.value).toBe('12px');
  });
});
