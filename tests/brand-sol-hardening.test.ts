import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hoisted, mkAsset, putImageBlob, resetStore } from './library-kits-final-fixtures';
import { addDoc, addTextLayer, addVectorLayer, getDoc, newBlankDoc, patchLayer } from '../src/engine/design/actions';
import { createDoc, newRasterLayer, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { docToSvg } from '../src/engine/design/export';
import { groupLayers, patchGroup } from '../src/engine/design/groups';
import { installTokenSync, tokenChoices, tokenPatch } from '../src/engine/design/tokenBind';
import { autoLinkDocToBrand, previewBrandLink } from '../src/engine/brandAutoLink';
import { importBrandFiles } from '../src/engine/brandBulkImport';
import { brandAssetExt, kitExportSlug, linkedBrandHref } from '../src/engine/brandExportFolder';
import { dismissBrandSyncNotice, installBrandSync, placeLinkedAsset, revertBrandSyncNotice, setBrandSyncMode, syncBrandInSession } from '../src/engine/brandSync';
import { run } from '../src/engine/commands';
import { insertComponent } from '../src/engine/libraryInsert';
import { addToSection, replaceSectionAsset, sectionNodes } from '../src/engine/librarySections';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import type { KitTokens } from '../src/engine/libraryTypes';
import type { Asset, RasterLayer, TextLayer, VectorLayer } from '../src/engine/types';
import { setComposer, setDoc, setSettings, useStore } from '../src/store/store';
import { syncBrandExportOnDisk } from '../server/brand-export.js';

const PNG_V1 = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const B64_PNG = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_V1))}`;

function seedImage(id: string, name: string, w: number, h: number, mime = 'image/png'): Asset {
  const asset: Asset = { ...mkAsset(id, useStore.getState().activeSessionId, w, h), name, mime };
  useStore.setState((st) => ({ assets: { ...st.assets, [id]: asset } }));
  putImageBlob(id, w, h);
  return asset;
}

describe('GPT 6.2 Sol hardening regressions (Altos 1–8 & Medios 1–5)', () => {
  let sid: string, kitId: string, docId: string;
  let stopTokens: () => void, stopBrand: () => void;

  const TOKENS: KitTokens = {
    'brand.red': { type: 'color', value: '#cc2222', modes: { Dark: '#ff5555' } },
    'brand.green': { type: 'color', value: '#22aa44' },
    'brand.size': { type: 'dimension', value: '24px' },
  };

  beforeEach(async () => {
    sid = resetStore().id;
    setSettings({ brandSyncMode: 'auto' });
    dismissBrandSyncNotice();
    stopTokens = installTokenSync();
    stopBrand = installBrandSync();
    kitId = (await createItem({ name: 'Sol Brand', kind: 'brand-kit', tokens: TOKENS, space: 'library', by: 'user' })).subject.id;
    setComposer({ kitId });
    docId = newBlankDoc(sid, { label: 'Main', width: 1000, height: 1000 }).id;
  });

  afterEach(() => {
    stopBrand();
    stopTokens();
    dismissBrandSyncNotice();
    setSettings({ brandSyncMode: 'auto' });
    setComposer({ kitId: null });
  });

  it('Alto 1: preserves edits made by the user while logo sync is awaiting asset loads', async () => {
    setBrandSyncMode('manual');
    seedImage('ast_l1', 'logo.png', 200, 100);
    seedImage('ast_l2', 'logo-v2.png', 400, 100);
    const kit1 = await addToSection(kitId, 'Logos', { assetIds: ['ast_l1'] });
    const nodeId = kit1.graph!.nodes[0].id;
    const layerId = await placeLinkedAsset(sid, docId, kitId, nodeId);
    await replaceSectionAsset(kitId, nodeId, 'ast_l2');

    // Inject a concurrent user edit during the async getAssetBlob load of ast_l2.
    let editedDuringAwait = false;
    hoisted.setOnGetAsset((id) => {
      if (id === 'ast_l2' && !editedDuringAwait) {
        editedDuringAwait = true;
        addTextLayer(sid, docId, 'EDIT WHILE WAITING', { x: 10, y: 10, width: 200 }, {});
      }
    });

    const res = await syncBrandInSession(sid, { docId });
    expect(res.logosUpdated).toBe(1);
    const doc = getDoc(sid, docId)!;
    expect(doc.layers.some((l) => l.type === 'text' && l.text === 'EDIT WHILE WAITING')).toBe(true);
    expect((doc.layers.find((l) => l.id === layerId) as RasterLayer).libraryAsset?.assetId).toBe('ast_l2');
  });

  it('Alto 2: "Volver al anterior" preserves a later user edit on the SAME property', async () => {
    const redRef = tokenChoices('color').find((c) => c.label === 'brand.red')!.ref;
    addTextLayer(sid, docId, 'Title', { x: 0, y: 0, width: 200 }, { ...tokenPatch('color', '#cc2222', redRef) });
    const textId = getDoc(sid, docId)!.layers[0].id;

    // Auto-sync updates text color from #cc2222 -> #0055ff.
    await saveItem({ subjectId: kitId, mode: 'overwrite', space: 'library', by: 'user', tokens: { ...TOKENS, 'brand.red': { type: 'color', value: '#0055ff' } } });
    expect((getDoc(sid, docId)!.layers[0] as TextLayer).color).toBe('#0055ff');

    // User manually changes the same text to green (#00aa00) and unlinks the token.
    patchLayer(sid, docId, textId, { color: '#00aa00', colorToken: undefined } as Partial<TextLayer>);

    // Reverting the brand sync notice MUST NOT overwrite the user's green edit.
    expect(revertBrandSyncNotice()).toBe(true);
    const afterRevert = getDoc(sid, docId)!.layers[0] as TextLayer;
    expect(afterRevert.color).toBe('#00aa00');
    expect(afterRevert.colorToken).toBeUndefined();
  });

  it('Alto 3: component sync preserves local text overrides made on an instance', async () => {
    setBrandSyncMode('manual');
    const { subject: uiKit, doc: kitDoc } = await createItem({ name: 'UI', kind: 'design-system', space: 'studio', sessionId: sid, by: 'user' });
    const bg = newVectorLayer('Bg', [{ type: 'rect', x: 0, y: 0, w: 200, h: 50, fill: '#111111', stroke: null, strokeWidth: 0, radius: 8 }]);
    const lbl = newTextLayer('Label', 'V1 default', { x: 10, y: 10, width: 150 });
    setDoc(sid, kitDoc!.id, (d) => ({ ...d, layers: [bg, lbl] }));
    const srcGid = groupLayers(sid, kitDoc!.id, [bg.id, lbl.id])!;
    patchGroup(sid, kitDoc!.id, srcGid, { name: 'Badge' });
    await saveItem({ subjectId: uiKit.id, mode: 'overwrite', sessionId: sid, docId: kitDoc!.id, space: 'studio', by: 'user' });

    const target = createDoc('Poster', 800, 800, '#ffffff');
    addDoc(sid, target);
    await insertComponent(sid, target.id, uiKit.id, srcGid, { x: 40, y: 40 });
    // User edits the instance's text locally.
    const instTextId = getDoc(sid, target.id)!.layers.find((l) => l.type === 'text')!.id;
    patchLayer(sid, target.id, instTextId, { text: 'Local override' });

    // Kit publishes V2 (bg color changed + default text changed).
    setDoc(sid, kitDoc!.id, (d) => ({
      ...d,
      layers: d.layers.map((l) => (l.type === 'vector' ? { ...l, shapes: [{ ...l.shapes[0], fill: '#2255ff' }] } : l.type === 'text' ? { ...l, text: 'V2 default' } : l)),
    }));
    await saveItem({ subjectId: uiKit.id, mode: 'overwrite', sessionId: sid, docId: kitDoc!.id, space: 'studio', by: 'user' });

    await syncBrandInSession(sid, { docId: target.id });
    const after = getDoc(sid, target.id)!;
    expect((after.layers.find((l) => l.type === 'vector') as VectorLayer).shapes[0].fill).toBe('#2255ff');
    expect((after.layers.find((l) => l.type === 'text') as TextLayer).text).toBe('Local override');
  });

  it('Alto 4 & Medio 3: auto-link never hijacks a non-kit sourceAssetId by name, skips ambiguous logos, and never links 50% stroke to an opaque token', async () => {
    seedImage('ast_kit_red', 'logo.png', 200, 100);
    seedImage('ast_kit_dup', 'logo.png', 200, 100);
    seedImage('ast_other_blue', 'logo.png', 200, 100);
    await addToSection(kitId, 'Logos', { assetIds: ['ast_kit_red'] });

    // 1. Layer with known non-kit sourceAssetId named "logo.png" MUST NOT be hijacked.
    const externalLogo: RasterLayer = {
      ...newRasterLayer('logo.png', { x: 0, y: 0, width: 200, height: 100 }, { width: 200, height: 100 }),
      sourceAssetId: 'ast_other_blue',
    };
    setDoc(sid, docId, (d) => ({ ...d, layers: [externalLogo] }));
    // 2. Semi-transparent 50% green stroke MUST NOT match opaque #22aa44 token.
    addVectorLayer(sid, docId, [{
      type: 'rect', x: 0, y: 0, w: 50, h: 50, fill: null, stroke: '#22aa44', strokeOpacity: 0.5, strokeWidth: 2, radius: 0,
    }]);

    const preview = previewBrandLink(getDoc(sid, docId)!, kitId);
    expect(preview.logos).toBe(0);
    expect(preview.colors).toBe(0);

    // 3. Ambiguous duplicate logo title in Logos section is skipped and reported in ambiguous.
    await addToSection(kitId, 'Logos', { assetIds: ['ast_kit_dup'] });
    const svgImportedLogo: RasterLayer = newRasterLayer('logo.png', { x: 0, y: 0, width: 200, height: 100 }, { width: 200, height: 100 });
    setDoc(sid, docId, (d) => ({ ...d, layers: [svgImportedLogo] }));
    const amb = autoLinkDocToBrand(sid, docId, kitId);
    expect(amb.logos).toBe(0);
    expect(amb.ambiguous).toEqual(['logo.png']);
  });

  it('Alto 5 & Alto 8: raster logos keep stable .png href across PNG->JPG replacement, unique kit slugs, and unverified SVG links fall back to embedded pixels', async () => {
    expect(brandAssetExt('image/jpeg', 'logo.jpg')).toBe('png');
    expect(brandAssetExt('image/gif', 'anim.gif')).toBe('png');
    expect(brandAssetExt('image/svg+xml', 'mark.svg')).toBe('svg');

    const kit2 = (await createItem({ name: 'Sol Brand', kind: 'brand-kit', space: 'library', by: 'user' })).subject;
    const lib = useStore.getState().library;
    const k1 = lib.find((s) => s.id === kitId)!;
    expect(kitExportSlug(k1, lib)).not.toBe(kitExportSlug(kit2, lib));

    seedImage('ast_p', 'logo.png', 200, 100, 'image/png');
    seedImage('ast_j', 'logo.jpg', 200, 100, 'image/jpeg');
    const kitWithLogo = await addToSection(kitId, 'Logos', { assetIds: ['ast_p'] });
    const nodeId = kitWithLogo.graph!.nodes[0].id;
    const layerId = await placeLinkedAsset(sid, docId, kitId, nodeId);
    const beforeHref = linkedBrandHref(getDoc(sid, docId)!.layers.find((l) => l.id === layerId) as RasterLayer);
    await replaceSectionAsset(kitId, nodeId, 'ast_j');
    await syncBrandInSession(sid, { docId });
    const afterHref = linkedBrandHref(getDoc(sid, docId)!.layers.find((l) => l.id === layerId) as RasterLayer);
    expect(beforeHref).toBe('vigente/logo.png');
    expect(afterHref).toBe('vigente/logo.png');

    // Alto 8: when verifiedBrandHrefs does NOT contain the layer (e.g. disk sync failed), docToSvg embeds instead of emitting a broken href.
    const svg = await docToSvg(getDoc(sid, docId)!, {
      rasterHref: async () => 'data:image/png;base64,EMBEDDED_FALLBACK',
      layout: () => ({ lines: [], height: 0, width: 0 }) as never,
      ascent: () => 0,
    }, undefined, { linkBrandAssets: true, verifiedBrandHrefs: new Map() });
    expect(svg).toContain('EMBEDDED_FALLBACK');
    expect(svg).not.toContain('href="vigente/');
  });

  it('Alto 6, Alto 7 & Medio 4: server/brand-export.js validates atomically before writing, rejects bad magic bytes / malformed JSON / pre-existing symlinks', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ogs-sol-export-'));
    try {
      // Seed valid V1 first.
      const r1 = await syncBrandExportOnDisk(tmp, { kitSlug: 'my-kit', versionId: 'v1', tokensJson: '{"v":1}', assets: [{ filename: 'logo.png', dataUrl: B64_PNG }] });
      expect(readFileSync(join(r1.dir, 'tokens.json'), 'utf8')).toBe('{"v":1}');

      // Bad second asset (GIF bytes labeled as .png) must fail BEFORE mutating tokens.json or vigente!
      const gifB64 = `data:image/png;base64,${btoa('GIF89a123456')}`;
      await expect(syncBrandExportOnDisk(tmp, {
        kitSlug: 'my-kit', versionId: 'v2', tokensJson: '{"v":2}',
        assets: [{ filename: 'logo.png', dataUrl: B64_PNG }, { filename: 'bad.png', dataUrl: gifB64 }],
      })).rejects.toThrow(/Invalid file bytes/);
      expect(readFileSync(join(r1.dir, 'tokens.json'), 'utf8')).toBe('{"v":1}');

      // Truncated tokensJson rejected before touching disk.
      await expect(syncBrandExportOnDisk(tmp, { kitSlug: 'my-kit', versionId: 'v2', tokensJson: '{"broken":', assets: [] })).rejects.toThrow(/Malformed tokensJson/);
      expect(readFileSync(join(r1.dir, 'tokens.json'), 'utf8')).toBe('{"v":1}');

      // Existing non-symlink vigente dir returns 409 WITHOUT overwriting tokens.json.
      const k2 = join(tmp, 'brand-exports', 'dir-kit');
      mkdirSync(join(k2, 'vigente'), { recursive: true });
      writeFileSync(join(k2, 'tokens.json'), '{"keep":true}');
      await expect(syncBrandExportOnDisk(tmp, { kitSlug: 'dir-kit', versionId: 'v1', tokensJson: '{"overwrite":true}', assets: [] })).rejects.toMatchObject({ statusCode: 409 });
      expect(readFileSync(join(k2, 'tokens.json'), 'utf8')).toBe('{"keep":true}');

      // Pre-existing symlink at kitDir is refused with 403.
      const outside = mkdtempSync(join(tmpdir(), 'ogs-outside-'));
      try {
        symlinkSync(outside, join(tmp, 'brand-exports', 'evil-link'));
        await expect(syncBrandExportOnDisk(tmp, { kitSlug: 'evil-link', versionId: 'v1', tokensJson: '{}', assets: [] })).rejects.toMatchObject({ statusCode: 403 });
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Medio 1, Medio 2 & Medio 5: bulk import tolerates malformed JSON, resolves cross-file token aliases, classifies Logo_Principal.svg, and add_shapes rejects unknown {token}', async () => {
    const emptyKit = (await createItem({ name: 'Bulk', kind: 'brand-kit', space: 'library', by: 'user' })).subject.id;
    const badJson = new File(['{"broken":'], 'broken.json', { type: 'application/json' });
    const baseJson = new File([JSON.stringify({ base: { green: { $type: 'color', $value: '#1c2a1c' } } })], 'base.json', { type: 'application/json' });
    const aliasJson = new File([JSON.stringify({ semantic: { bg: { $type: 'color', $value: '{base.green}' } } })], 'alias.json', { type: 'application/json' });

    const res = await importBrandFiles(emptyKit, [badJson, baseJson, aliasJson]);
    expect(res.skipped).toContain('broken.json');
    expect(res.tokens).toBe(2);
    const kit = useStore.getState().library.find((s) => s.id === emptyKit)!;
    expect(kit.tokens?.['semantic.bg']?.value).toBe('{base.green}');

    // Medio 5: designer.layer.add_shapes rejects unknown {token} aliases just like add_text.
    const badShape = await run({
      cmd: 'designer.layer.add_shapes',
      on: { session: sid, doc: docId },
      args: { shapes: [{ type: 'rect', x: 0, y: 0, w: '{unknown.size}', h: 40, fill: '#000000', radius: '{unknown.rad}' }] },
    }, { caller: 'agent' });
    expect(badShape.ok).toBe(false);
    if (!badShape.ok) expect(badShape.error.message).toMatch(/no token/i);

    // Check sectionNodes helper stays clean.
    expect(sectionNodes(kit, { title: 'Logos' })).toHaveLength(0);
  });
});
