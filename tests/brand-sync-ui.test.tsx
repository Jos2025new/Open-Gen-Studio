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

import { BrandSyncNotice } from '../src/components/designer/BrandSyncNotice';
import { LayerGeometry } from '../src/components/designer/LayerGeometry';
import { ShapeSizeFields } from '../src/components/designer/ShapeLookFields';
import { shapeGestures } from '../src/components/designer/tools/shape';
import { addVectorLayer, getDoc, newBlankDoc } from '../src/engine/design/actions';
import { newRasterLayer } from '../src/engine/design/doc';
import { installTokenSync, tokenChoices, tokenPatch } from '../src/engine/design/tokenBind';
import { dismissBrandSyncNotice, installBrandSync, setBrandSyncMode } from '../src/engine/brandSync';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import type { KitTokens } from '../src/engine/libraryTypes';
import type { RasterLayer, VectorLayer } from '../src/engine/types';
import { createSession, setComposer, setDoc, setSettings, useStore } from '../src/store/store';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BrandSyncNotice UI', () => {
  let host: HTMLDivElement, root: Root, sid: string, kitId: string, docId: string;
  let stopTokens: () => void, stopBrand: () => void;

  const TOKENS: KitTokens = { 'firma.radio': { type: 'dimension', value: '12px' } };

  beforeEach(async () => {
    const s = createSession('S1');
    useStore.setState({ sessions: { [s.id]: s }, activeSessionId: s.id, library: [], assets: {}, generations: {} });
    sid = s.id;
    setSettings({ brandSyncMode: 'auto' });
    dismissBrandSyncNotice();
    stopTokens = installTokenSync();
    stopBrand = installBrandSync();
    kitId = (await createItem({ name: 'Marca', kind: 'brand-kit', tokens: TOKENS, space: 'library', by: 'user' })).subject.id;
    setComposer({ kitId });
    docId = newBlankDoc(sid, { label: 'A', width: 200, height: 200 }).id;
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

  it('shows corner notice after auto token sync with Revert and Switch to on-demand buttons, then shows pending Update now in manual mode', async () => {
    const ref = tokenChoices('dimension')[0].ref;
    addVectorLayer(sid, docId, [{ type: 'rect', x: 0, y: 0, w: 100, h: 40, fill: '#1c2a1c', stroke: null, strokeWidth: 0, ...tokenPatch('radius', 12, ref) }]);
    act(() => root.render(createElement(BrandSyncNotice, { sessionId: sid })));
    expect(host.textContent).toBe('');

    await act(async () => {
      await saveItem({ subjectId: kitId, mode: 'overwrite', space: 'library', by: 'user', tokens: { 'firma.radio': { type: 'dimension', value: '28px' } } });
    });

    expect(host.textContent).toContain('firma.radio');
    expect(host.textContent).toContain('Volver al anterior');
    expect(host.textContent).toContain('Bajo demanda');

    // Clicking "Volver al anterior" reverts the shape radius to 12.
    const revertBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Volver al anterior'))!;
    act(() => revertBtn.click());
    expect((getDoc(sid, docId)!.layers[0] as VectorLayer).shapes[0].radius).toBe(12);

    // Switch to manual mode and update token again: notice shows "Actualizar ahora".
    act(() => setBrandSyncMode('manual'));
    await act(async () => {
      await saveItem({ subjectId: kitId, mode: 'overwrite', space: 'library', by: 'user', tokens: { 'firma.radio': { type: 'dimension', value: '36px' } } });
    });
    expect((getDoc(sid, docId)!.layers[0] as VectorLayer).shapes[0].radius).toBe(12);
    expect(host.textContent).toContain('Actualizar ahora');

    const applyBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Actualizar ahora'))!;
    await act(async () => { applyBtn.click(); });
    expect((getDoc(sid, docId)!.layers[0] as VectorLayer).shapes[0].radius).toBe(36);
  });

  it('Bug 4: exposes WidthTokenField on vector shapes & raster layers, and copies radiusToken when drawing a rectangle', () => {
    const ref = tokenChoices('dimension')[0].ref;
    const vecId = addVectorLayer(sid, docId, [{ type: 'rect', x: 0, y: 0, w: 100, h: 40, fill: '#1c2a1c', stroke: null, strokeWidth: 0, radius: 0 }])!;
    const shape = (getDoc(sid, docId)!.layers.find((l) => l.id === vecId) as VectorLayer).shapes[0];
    act(() => root.render(createElement(ShapeSizeFields, { sessionId: sid, docId, layerId: vecId, shape })));
    expect(host.textContent).toContain('Width token');

    const raster: RasterLayer = newRasterLayer('Logo', { x: 0, y: 0, width: 100, height: 50 }, { width: 100, height: 50 });
    setDoc(sid, docId, (d) => ({ ...d, layers: [...d.layers, raster] }));
    act(() => root.render(createElement(LayerGeometry, { sessionId: sid, doc: getDoc(sid, docId)!, layer: raster })));
    expect(host.textContent).toContain('Width token');

    // Drawing a rectangle with shapeGestures.shape.up copies radiusToken from shapeStyle.
    shapeGestures.shape.up({
      state: {
        doc: getDoc(sid, docId)!,
        sessionId: sid,
        view: { x: 0, y: 0, zoom: 1 },
        setPreview: () => undefined,
        shapeStyle: { fill: '#1c2a1c', stroke: null, strokeWidth: 0, ...tokenPatch('radius', 12, ref) },
      } as never,
      d: { kind: 'shape', tool: 'rect', strokeOnly: false, x0: 10, y0: 10, x1: 110, y1: 60 },
      e: {} as never,
    });
    const drawn = (getDoc(sid, docId)!.layers.find((l) => l.type === 'vector' && l.shapes.some((s) => s.radiusToken?.token === 'firma.radio')) as VectorLayer | undefined)?.shapes.find((s) => s.radiusToken?.token === 'firma.radio');
    expect(drawn).toMatchObject({ radius: 12, rx: 12, ry: 12 });
    expect(drawn?.radiusToken?.token).toBe('firma.radio');
  });
});
