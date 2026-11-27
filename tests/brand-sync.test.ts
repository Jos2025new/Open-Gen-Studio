import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkAsset, putImageBlob, resetStore } from './library-kits-final-fixtures';
import { addDoc, addVectorLayer, getDoc, newBlankDoc } from '../src/engine/design/actions';
import { createDoc, newRasterLayer, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { groupLayers, patchGroup } from '../src/engine/design/groups';
import { docToSvg } from '../src/engine/design/export';
import { installTokenSync, tokenChoices, tokenPatch, tokenProblem } from '../src/engine/design/tokenBind';
import {
  brandSlug,
  dismissBrandSyncNotice,
  getBrandSyncNotice,
  installBrandSync,
  linkedSvgHref,
  pendingBrandUpdates,
  placeLinkedAsset,
  revertBrandSyncNotice,
  setBrandSyncMode,
  syncBrandInSession,
} from '../src/engine/brandSync';
import { insertComponent } from '../src/engine/libraryInsert';
import { addToSection, replaceSectionAsset } from '../src/engine/librarySections';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import type { KitTokens } from '../src/engine/libraryTypes';
import type { Asset, RasterLayer, TextLayer, VectorLayer } from '../src/engine/types';
import { setComposer, setDoc, setSettings, useStore } from '../src/store/store';
import { syncBrandExportOnDisk } from '../server/brand-export.js';

// Minimal valid 1x1 PNG bytes for disk symlink test.
const PNG_V1 = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

function seedImageAsset(id: string, name: string, w: number, h: number): Asset {
  const asset: Asset = { ...mkAsset(id, useStore.getState().activeSessionId, w, h), name };
  useStore.setState((st) => ({ assets: { ...st.assets, [id]: asset } }));
  putImageBlob(id, w, h);
  return asset;
}

describe('brandSync: tokens (radius/width), linked logos, component sync, auto/manual notice & Inkscape vigente/', () => {
  let sid: string, kitId: string, docId: string;
  let stopTokens: () => void, stopBrand: () => void;

  const TOKENS: KitTokens = {
    'firma.radio': { type: 'dimension', value: '12px' },
    'marca.logo.ancho': { type: 'dimension', value: '320px' },
    'firma.fondo': { type: 'color', value: '#1c2a1ccc' },
  };

  beforeEach(async () => {
    sid = resetStore().id;
    setSettings({ brandSyncMode: 'auto' });
    dismissBrandSyncNotice();
    stopTokens = installTokenSync();
    stopBrand = installBrandSync();
    kitId = (await createItem({ name: 'Marca Verde', kind: 'brand-kit', tokens: TOKENS, space: 'library', by: 'user' })).subject.id;
    setComposer({ kitId });
    docId = newBlankDoc(sid, { label: 'Poster', width: 1080, height: 1080 }).id;
  });

  afterEach(() => {
    stopBrand();
    stopTokens();
    dismissBrandSyncNotice();
    setSettings({ brandSyncMode: 'auto' });
    setComposer({ kitId: null });
  });

  it('syncs radius and width tokens on shapes and proportional width on raster layers, and validates agent aliases', async () => {
    const dim = (name: string) => tokenChoices('dimension').find((c) => c.label === name)!.ref;
    addVectorLayer(sid, docId, [{
      type: 'rect', x: 10, y: 20, w: 320, h: 60, fill: '#1c2a1c', stroke: null, strokeWidth: 0,
      ...tokenPatch('radius', 12, dim('firma.radio')),
      widthToken: dim('marca.logo.ancho'),
    }]);
    const raster: RasterLayer = {
      ...newRasterLayer('Logo', { x: 40, y: 40, width: 320, height: 160 }, { width: 200, height: 100 }),
      widthToken: dim('marca.logo.ancho'),
    };
    setDoc(sid, docId, (d) => ({ ...d, layers: [...d.layers, raster] }));

    expect(tokenProblem({ radius: '{firma.radio}', width: '{marca.logo.ancho}' })).toBeNull();
    expect(tokenProblem({ radius: '{no.existe}' })).toMatch(/no token "\{no\.existe\}"/);

    await saveItem({
      subjectId: kitId, mode: 'overwrite', space: 'library', by: 'user',
      tokens: { ...TOKENS, 'firma.radio': { type: 'dimension', value: '24px' }, 'marca.logo.ancho': { type: 'dimension', value: '400px' } },
    });

    const doc = getDoc(sid, docId)!;
    const shape = (doc.layers[0] as VectorLayer).shapes[0];
    expect(shape).toMatchObject({ radius: 24, rx: 24, ry: 24, w: 400 });
    const updatedRaster = doc.layers[1] as RasterLayer;
    expect(updatedRaster).toMatchObject({ width: 400, height: 200 });

    // Corner notice appeared and can revert the token propagation.
    const notice = getBrandSyncNotice();
    expect(notice?.canRevert).toBe(true);
    expect(revertBrandSyncNotice()).toBe(true);
    expect((getDoc(sid, docId)!.layers[0] as VectorLayer).shapes[0]).toMatchObject({ radius: 12, w: 320 });
  });

  it('replaces a linked brand logo slot in place, updates open designs automatically, and supports revert', async () => {
    seedImageAsset('ast_logo_v1', 'Logo Horizontal Oscuro', 200, 100);
    seedImageAsset('ast_logo_v2', 'Logo Horizontal Oscuro v2', 400, 100);

    const kit1 = await addToSection(kitId, 'Logos', { assetIds: ['ast_logo_v1'] });
    const nodeId = kit1.graph!.nodes[0].id;
    const layerId = await placeLinkedAsset(sid, docId, kitId, nodeId);
    expect(layerId).toBeTruthy();
    const before = getDoc(sid, docId)!.layers.find((l) => l.id === layerId) as RasterLayer;
    expect(before.libraryAsset).toMatchObject({ subjectId: kitId, nodeId, assetId: 'ast_logo_v1', slug: 'logo-horizontal-oscuro' });
    expect(linkedSvgHref(before)).toBe('vigente/logo-horizontal-oscuro.png');

    // Replace the logo in the kit: auto-sync should propagate to the design.
    await replaceSectionAsset(kitId, nodeId, 'ast_logo_v2');
    await vi.waitFor(() => {
      const l = getDoc(sid, docId)!.layers.find((x) => x.id === layerId) as RasterLayer;
      expect(l.libraryAsset?.assetId).toBe('ast_logo_v2');
      expect(l.sourceAssetId).toBe('ast_logo_v2');
      // Width preserved; height scaled proportionally from 400x100 (4:1).
      expect(l.width).toBe(before.width);
      expect(l.height).toBe(Math.max(1, Math.round((before.width * 100) / 400)));
    });

    expect(getBrandSyncNotice()?.summary).toMatch(/Logo Horizontal Oscuro/);
    expect(revertBrandSyncNotice()).toBe(true);
    const reverted = getDoc(sid, docId)!.layers.find((x) => x.id === layerId) as RasterLayer;
    expect(reverted.libraryAsset?.assetId).toBe('ast_logo_v1');
    expect(reverted.height).toBe(before.height);
  });

  it('respects manual (on-demand) mode and applies pending changes only when requested', async () => {
    setBrandSyncMode('manual');
    const dim = (name: string) => tokenChoices('dimension').find((c) => c.label === name)!.ref;
    addVectorLayer(sid, docId, [{
      type: 'rect', x: 0, y: 0, w: 100, h: 40, fill: '#1c2a1c', stroke: null, strokeWidth: 0,
      ...tokenPatch('radius', 12, dim('firma.radio')),
    }]);

    await saveItem({ subjectId: kitId, mode: 'overwrite', space: 'library', by: 'user', tokens: { ...TOKENS, 'firma.radio': { type: 'dimension', value: '30px' } } });

    // In manual mode, design stays untouched until synced.
    expect((getDoc(sid, docId)!.layers[0] as VectorLayer).shapes[0].radius).toBe(12);
    expect(pendingBrandUpdates(sid).tokens).toBe(1);

    const res = await syncBrandInSession(sid, { includeTokens: true, recordNotice: true });
    expect(res.tokensUpdated).toBe(1);
    expect((getDoc(sid, docId)!.layers[0] as VectorLayer).shapes[0].radius).toBe(30);
    expect(pendingBrandUpdates(sid).total).toBe(0);
  });

  it('syncs component group instances when the kit saves a new version while preserving placement', async () => {
    setBrandSyncMode('manual');
    const { subject: uiKit, doc: kitDoc } = await createItem({ name: 'UI Kit', kind: 'design-system', space: 'studio', sessionId: sid, by: 'user' });
    const bg = newVectorLayer('Bg', [{ type: 'rect', x: 100, y: 50, w: 160, h: 48, fill: '#1c2a1c', stroke: null, strokeWidth: 0, radius: 8 }]);
    const lbl = newTextLayer('Label', 'v1', { x: 120, y: 60, width: 100 });
    setDoc(sid, kitDoc!.id, (d) => ({ ...d, layers: [bg, lbl] }));
    const srcGid = groupLayers(sid, kitDoc!.id, [bg.id, lbl.id])!;
    patchGroup(sid, kitDoc!.id, srcGid, { name: 'Firma' });
    const v1 = await saveItem({ subjectId: uiKit.id, mode: 'overwrite', sessionId: sid, docId: kitDoc!.id, space: 'studio', by: 'user' });

    const target = createDoc('Post', 1080, 1080, '#ffffff');
    addDoc(sid, target);
    const { groupId } = await insertComponent(sid, target.id, uiKit.id, srcGid, { x: 20, y: 30 });
    expect(getDoc(sid, target.id)!.groups?.find((g) => g.id === groupId)?.from?.versionId).toBe(v1.versionId);

    // Update the component in the kit and save v2.
    setDoc(sid, kitDoc!.id, (d) => ({
      ...d,
      layers: d.layers.map((l) => (l.type === 'text' ? { ...l, text: 'v2 actualizada' } : l)),
    }));
    const v2 = await saveItem({ subjectId: uiKit.id, mode: 'overwrite', sessionId: sid, docId: kitDoc!.id, space: 'studio', by: 'user' });
    expect(pendingBrandUpdates(sid).components).toBe(1);

    const res = await syncBrandInSession(sid, { docId: target.id });
    expect(res.componentsUpdated).toBe(1);
    const updatedDoc = getDoc(sid, target.id)!;
    expect(updatedDoc.groups?.find((g) => g.id === groupId)?.from?.versionId).toBe(v2.versionId);
    const updatedText = updatedDoc.layers.find((l) => l.type === 'text') as TextLayer;
    const updatedBg = updatedDoc.layers.find((l) => l.type === 'vector') as VectorLayer;
    expect(updatedText.text).toBe('v2 actualizada');
    expect([updatedBg.shapes[0].x, updatedBg.shapes[0].y]).toEqual([20, 30]);
  });

  it('exports SVG with vigente/<slug>.png links and atomically updates the Inkscape vigente symlink on disk', async () => {
    const doc = createDoc('Inkscape', 800, 600, '#ffffff');
    const logoLayer: RasterLayer = {
      ...newRasterLayer('Logo', { x: 10, y: 20, width: 320, height: 80 }, { width: 320, height: 80 }),
      libraryAsset: { subjectId: kitId, nodeId: 'nd_1', assetId: 'ast_1', slug: brandSlug('Logo Horizontal Oscuro') },
    };
    const svg = await docToSvg({ ...doc, layers: [logoLayer] }, {
      rasterHref: async () => 'data:image/png;base64,SHOULD_NOT_EMBED',
      layout: () => ({ lines: [], height: 0, width: 0 }) as never,
      ascent: () => 0,
    }, undefined, { linkBrandAssets: true });
    expect(svg).toContain('href="vigente/logo-horizontal-oscuro.png"');
    expect(svg).not.toContain('SHOULD_NOT_EMBED');

    const tmp = mkdtempSync(join(tmpdir(), 'ogs-brand-export-'));
    try {
      const b64v1 = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_V1))}`;
      const v2 = new Uint8Array([...PNG_V1, 9, 9]);
      const b64v2 = `data:image/png;base64,${btoa(String.fromCharCode(...v2))}`;
      const r1 = await syncBrandExportOnDisk(tmp, { kitSlug: 'marca-verde', versionId: 'v1', tokensJson: '{"ok":1}', assets: [{ filename: 'logo-horizontal-oscuro.png', dataUrl: b64v1 }] });
      expect(new Uint8Array(readFileSync(join(r1.vigentePath, 'logo-horizontal-oscuro.png')))).toEqual(PNG_V1);
      expect(readFileSync(join(r1.dir, 'tokens.json'), 'utf8')).toBe('{"ok":1}');

      const r2 = await syncBrandExportOnDisk(tmp, { kitSlug: 'marca-verde', versionId: 'v2', tokensJson: '{"ok":2}', assets: [{ filename: 'logo-horizontal-oscuro.png', dataUrl: b64v2 }] });
      expect(new Uint8Array(readFileSync(join(r2.vigentePath, 'logo-horizontal-oscuro.png')))).toEqual(v2);
      expect(readFileSync(join(r2.dir, 'tokens.json'), 'utf8')).toBe('{"ok":2}');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
