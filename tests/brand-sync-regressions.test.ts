import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkAsset, putImageBlob, resetStore } from './library-kits-final-fixtures';
import { addDoc, addVectorLayer, getDoc, newBlankDoc } from '../src/engine/design/actions';
import { createDoc, newRasterLayer, newTextLayer, newVectorLayer } from '../src/engine/design/doc';
import { docToSvg } from '../src/engine/design/export';
import { groupLayers, patchGroup } from '../src/engine/design/groups';
import { undo } from '../src/engine/design/history';
import { getBuffer, releaseBuffers, setBuffer } from '../src/engine/design/raster';
import { installTokenSync, syncTokens, tokenChoices, tokenPatch } from '../src/engine/design/tokenBind';
import {
  brandSlotFile,
  dismissBrandSyncNotice,
  getBrandSyncNotice,
  installBrandSync,
  linkedSvgHref,
  placeLinkedAsset,
  revertBrandSyncNotice,
  setBrandSyncMode,
  syncBrandExportFolder,
  syncBrandInSession,
} from '../src/engine/brandSync';
import { insertComponent } from '../src/engine/libraryInsert';
import { addToSection, replaceSectionAsset } from '../src/engine/librarySections';
import { createItem, saveItem } from '../src/engine/libraryVersions';
import { normalizeShapes } from '../src/engine/planSteps/layer';
import { commands as layerCommands } from '../src/engine/design/layer.commands';
import type { KitTokens } from '../src/engine/libraryTypes';
import type { Asset, RasterLayer, TextLayer, VectorLayer } from '../src/engine/types';
import { createCanvas } from '../src/lib/media';
import { createSession, setComposer, setDoc, setSettings, useStore } from '../src/store/store';
import { brandExport } from '../server/brand-export.js';

const PNG_V1 = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

function seedImageAsset(id: string, name: string, w: number, h: number, mime = 'image/png'): Asset {
  const asset: Asset = { ...mkAsset(id, useStore.getState().activeSessionId, w, h), name, mime };
  useStore.setState((st) => ({ assets: { ...st.assets, [id]: asset } }));
  putImageBlob(id, w, h);
  return asset;
}

describe('brandSync regressions (bugs 1, 2, 3, 5, 6, 7, 8)', () => {
  let sid: string, kitId: string, docId: string;
  let stopTokens: () => void, stopBrand: () => void;

  const TOKENS: KitTokens = {
    'firma.radio': { type: 'dimension', value: '12px' },
    'marca.logo.ancho': { type: 'dimension', value: '320px' },
    'marca.acento': { type: 'color', value: '#11aa22', modes: { Dark: '#112233' } },
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
    vi.restoreAllMocks();
  });

  it('Bug 1: revert restores real v1 pixel buffer (not v2)', async () => {
    seedImageAsset('ast_v1', 'Logo', 200, 100);
    seedImageAsset('ast_v2', 'Logo v2', 400, 100);
    const kit = await addToSection(kitId, 'Logos', { assetIds: ['ast_v1'] });
    const nodeId = kit.graph!.nodes[0].id;
    const layerId = (await placeLinkedAsset(sid, docId, kitId, nodeId))!;
    expect(getBuffer(layerId)?.width).toBe(200);

    await replaceSectionAsset(kitId, nodeId, 'ast_v2');
    await vi.waitFor(() => {
      expect(getBuffer(layerId)?.width).toBe(400);
    });

    expect(revertBrandSyncNotice()).toBe(true);
    expect(getBuffer(layerId)?.width).toBe(200);
    expect((getDoc(sid, docId)!.layers.find((l) => l.id === layerId) as RasterLayer).libraryAsset?.assetId).toBe('ast_v1');
  });

  it('Bug 2: revert is surgical (keeps later user layers & edits) and undoable via Ctrl+Z', async () => {
    seedImageAsset('ast_v1', 'Logo', 200, 100);
    seedImageAsset('ast_v2', 'Logo v2', 400, 100);
    const kit = await addToSection(kitId, 'Logos', { assetIds: ['ast_v1'] });
    const nodeId = kit.graph!.nodes[0].id;
    const logoId = (await placeLinkedAsset(sid, docId, kitId, nodeId))!;

    await replaceSectionAsset(kitId, nodeId, 'ast_v2');
    await vi.waitFor(() => {
      expect((getDoc(sid, docId)!.layers.find((l) => l.id === logoId) as RasterLayer).libraryAsset?.assetId).toBe('ast_v2');
    });

    // User adds a new layer and moves the logo AFTER auto-sync.
    const extraId = addVectorLayer(sid, docId, [{ type: 'rect', x: 5, y: 5, w: 50, h: 50, fill: '#ff0000', stroke: null, strokeWidth: 0, radius: 0 }], 'User Layer');
    setDoc(sid, docId, (d) => ({ ...d, layers: d.layers.map((l) => (l.id === logoId ? { ...l, x: 555 } : l)) }));
    expect(getDoc(sid, docId)!.layers.length).toBe(2);

    // Clicking "Volver al anterior" reverts logo to v1 while keeping User Layer and x: 555.
    expect(revertBrandSyncNotice()).toBe(true);
    const afterRevert = getDoc(sid, docId)!;
    expect(afterRevert.layers.some((l) => l.id === extraId)).toBe(true);
    const revertedLogo = afterRevert.layers.find((l) => l.id === logoId) as RasterLayer;
    expect(revertedLogo.libraryAsset?.assetId).toBe('ast_v1');
    expect(revertedLogo.x).toBe(555);
    expect(getBuffer(logoId)?.width).toBe(200);

    // Ctrl+Z undoes the revert itself and brings back v2 while keeping User Layer.
    const undone = undo(afterRevert);
    expect(undone).toBeTruthy();
    expect(undone!.layers.some((l) => l.id === extraId)).toBe(true);
    expect((undone!.layers.find((l) => l.id === logoId) as RasterLayer).libraryAsset?.assetId).toBe('ast_v2');
  });

  it('Bug 3: designer.layer.add_shapes preserves and binds {token} for radius/rx and width/w', async () => {
    const addShapesCmd = layerCommands.find((c) => c.id === 'designer.layer.add_shapes')!;
    const out = await addShapesCmd.run(
      { on: { session: sid, doc: docId } } as never,
      {
        shapes: [
          { type: 'rect', x: 10, y: 20, w: '{marca.logo.ancho}', h: 60, radius: '{firma.radio}', fill: '#ffffff' },
          { type: 'rect', x: 30, y: 40, width: '{marca.logo.ancho}', h: 50, rx: '{firma.radio}', fill: '#ffffff' },
        ],
      } as never,
    );
    expect(out).toBeTruthy();
    const vec = getDoc(sid, docId)!.layers[0] as VectorLayer;
    expect(vec.shapes[0]).toMatchObject({ w: 320, radius: 12, rx: 12, ry: 12 });
    expect(vec.shapes[0].widthToken?.token).toBe('marca.logo.ancho');
    expect(vec.shapes[0].radiusToken?.token).toBe('firma.radio');
    expect(vec.shapes[1]).toMatchObject({ w: 320, radius: 12, rx: 12, ry: 12 });
    expect(vec.shapes[1].widthToken?.token).toBe('marca.logo.ancho');
    expect(vec.shapes[1].radiusToken?.token).toBe('firma.radio');

    // Also verify fresh() resolves raw rx and w aliases when syncTokens runs directly.
    const rawDoc = createDoc('Alias', 500, 500, '#ffffff');
    const rawLayer = newVectorLayer('Raw', normalizeShapes([{ type: 'rect', x: 0, y: 0, w: '{marca.logo.ancho}', h: 40, rx: '{firma.radio}' }]));
    const synced = syncTokens({ ...rawDoc, layers: [rawLayer] }, useStore.getState().library);
    expect((synced.layers[0] as VectorLayer).shapes[0]).toMatchObject({ w: 320, radius: 12, rx: 12, ry: 12 });
  });

  it('Bug 5: merges simultaneous token + logo updates in notice/revert, syncs on session switch and manual→auto', async () => {
    seedImageAsset('ast_v1', 'Logo', 200, 100);
    seedImageAsset('ast_v2', 'Logo v2', 400, 100);
    const kit = await addToSection(kitId, 'Logos', { assetIds: ['ast_v1'] });
    const nodeId = kit.graph!.nodes[0].id;
    const logoId = (await placeLinkedAsset(sid, docId, kitId, nodeId))!;
    const dim = (name: string) => tokenChoices('dimension').find((c) => c.label === name)!.ref;
    addVectorLayer(sid, docId, [{ type: 'rect', x: 0, y: 0, w: 100, h: 40, fill: '#1c2a1c', stroke: null, strokeWidth: 0, ...tokenPatch('radius', 12, dim('firma.radio')) }]);

    // Update token AND logo in ONE saveItem call.
    await saveItem({
      subjectId: kitId, mode: 'overwrite', space: 'library', by: 'user',
      tokens: { ...TOKENS, 'firma.radio': { type: 'dimension', value: '30px' } },
      graph: (g) => ({ ...(g ?? { nodes: [], edges: [] }), nodes: (g?.nodes ?? []).map((n) => (n.id === nodeId && n.data.kind === 'asset' ? { ...n, data: { ...n.data, assetId: 'ast_v2' } } : n)) }),
    });
    await vi.waitFor(() => {
      expect((getDoc(sid, docId)!.layers.find((l) => l.id === logoId) as RasterLayer).libraryAsset?.assetId).toBe('ast_v2');
      expect(getBrandSyncNotice()?.summary).toMatch(/firma\.radio/);
      expect(getBrandSyncNotice()?.summary).toMatch(/Logo/);
    });

    // Reverting restores BOTH token radius AND logo asset/buffer!
    expect(revertBrandSyncNotice()).toBe(true);
    const vecAfter = getDoc(sid, docId)!.layers.find((l) => l.type === 'vector') as VectorLayer;
    const logoAfter = getDoc(sid, docId)!.layers.find((l) => l.id === logoId) as RasterLayer;
    expect(vecAfter.shapes[0].radius).toBe(12);
    expect(logoAfter.libraryAsset?.assetId).toBe('ast_v1');
    expect(getBuffer(logoId)?.width).toBe(200);

    // Session switch in auto mode: switch to S2, update kit to ast_v3, switch back to S1 → S1 auto-updates!
    seedImageAsset('ast_v3', 'Logo v3', 300, 100);
    const s2 = createSession('S2');
    useStore.setState((st) => ({ sessions: { ...st.sessions, [s2.id]: s2 }, activeSessionId: s2.id }));
    await replaceSectionAsset(kitId, nodeId, 'ast_v3');
    expect((getDoc(sid, docId)!.layers.find((l) => l.id === logoId) as RasterLayer).libraryAsset?.assetId).toBe('ast_v1');
    useStore.setState({ activeSessionId: sid });
    await vi.waitFor(() => {
      expect((getDoc(sid, docId)!.layers.find((l) => l.id === logoId) as RasterLayer).libraryAsset?.assetId).toBe('ast_v3');
    });

    // manual → auto via setSettings (as DataTab does) syncs pending logos!
    seedImageAsset('ast_v4', 'Logo v4', 250, 100);
    setSettings({ brandSyncMode: 'manual' });
    await replaceSectionAsset(kitId, nodeId, 'ast_v4');
    expect((getDoc(sid, docId)!.layers.find((l) => l.id === logoId) as RasterLayer).libraryAsset?.assetId).toBe('ast_v3');
    setSettings({ brandSyncMode: 'auto' });
    await vi.waitFor(() => {
      expect((getDoc(sid, docId)!.layers.find((l) => l.id === logoId) as RasterLayer).libraryAsset?.assetId).toBe('ast_v4');
    });
  });

  it('Bug 6: Inkscape vigente/ uses consistent disambiguated filenames, real MIME extensions, length caps, and merges marca.logo in tokens.json', async () => {
    const longTitle = 'Logo '.repeat(30).trim();
    seedImageAsset('ast_a', 'Logo', 100, 100, 'image/png');
    seedImageAsset('ast_b', 'Logo', 100, 100, 'image/svg+xml');
    seedImageAsset('ast_c', longTitle, 100, 100, 'image/webp');

    const longKit = (await createItem({ name: 'Marca '.repeat(25).trim(), kind: 'brand-kit', tokens: TOKENS, space: 'library', by: 'user' })).subject;
    let kit = await addToSection(longKit.id, 'Logos', { assetIds: ['ast_a', 'ast_b', 'ast_c'] });
    const [n1, n2, n3] = kit.graph!.nodes;
    const f1 = brandSlotFile(kit, n1.id, useStore.getState().assets);
    const f2 = brandSlotFile(kit, n2.id, useStore.getState().assets);
    const f3 = brandSlotFile(kit, n3.id, useStore.getState().assets);

    expect(f1.filename).toBe('logo.png');
    expect(f2.filename).toMatch(/^logo-[a-z0-9]{1,4}\.svg$/);
    expect(f3.filename.endsWith('.png')).toBe(true);
    expect(f3.filename.length).toBeLessThanOrEqual(80);

    // placeLinkedAsset, linkedSvgHref and docToSvg all agree with brandSlotFile!
    const l2Id = (await placeLinkedAsset(sid, docId, kit.id, n2.id))!;
    const l2 = getDoc(sid, docId)!.layers.find((l) => l.id === l2Id) as RasterLayer;
    expect(linkedSvgHref(l2)).toBe(`vigente/${f2.filename}`);
    const svg = await docToSvg(getDoc(sid, docId)!, {
      rasterHref: async () => 'data:image/png;base64,NO',
      layout: () => ({ lines: [], height: 0, width: 0 }) as never,
      ascent: () => 0,
    }, undefined, { linkBrandAssets: true });
    expect(svg).toContain(`href="vigente/${f2.filename}"`);

    // syncBrandExportFolder sends X-OGS: 1, caps kitSlug ≤ 64, and merges marca.logo preserving marca.logo.ancho.
    vi.stubGlobal('FileReader', class {
      result = '';
      onload: (() => void) | null = null;
      readAsDataURL(blob: Blob) {
        void blob.arrayBuffer().then((ab) => {
          this.result = `data:${blob.type || 'image/png'};base64,${btoa(String.fromCharCode(...new Uint8Array(ab)))}`;
          this.onload?.();
        });
      }
    });
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: { kitSlug: string; tokensJson: string; assets: Array<{ filename: string }> } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body ?? '{}'));
      return { ok: true, json: async () => ({ dir: '/tmp/x', vigentePath: '/tmp/x/vigente', versionDir: '/tmp/x/v', files: [] }) };
    }));
    await syncBrandExportFolder(kit.id);
    expect(capturedHeaders['X-OGS']).toBe('1');
    expect(capturedBody!.kitSlug.length).toBeLessThanOrEqual(64);
    expect(capturedBody!.assets.map((a) => a.filename)).toEqual([f1.filename, f2.filename, f3.filename]);
    const parsedTokens = JSON.parse(capturedBody!.tokensJson);
    expect(parsedTokens.marca.logo.ancho).toEqual({ $type: 'dimension', $value: { value: 320, unit: 'px' } });
    expect(parsedTokens.marca.logo[f2.slug]).toEqual({ $type: 'string', $value: `vigente/${f2.filename}` });
  });

  it('Bug 7: server/brand-export enforces loopback, X-OGS: 1, matching Origin, and returns 409 if vigente is a real directory', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ogs-brand-sec-'));
    try {
      const plugin = brandExport(tmp);
      let mw: ((req: unknown, res: unknown, next: () => void) => Promise<void>) | null = null;
      (plugin.configureServer as (s: unknown) => void)({ middlewares: { use: (fn: typeof mw) => { mw = fn; } } });

      const call = async (opts: { remoteAddress?: string; headers?: Record<string, string>; body?: object }) => {
        const raw = JSON.stringify(opts.body ?? { kitSlug: 'marca', versionId: 'v1', assets: [] });
        const bytes = new TextEncoder().encode(raw);
        const req = {
          method: 'POST',
          url: '/x/brand-export/sync',
          headers: opts.headers ?? {},
          socket: { remoteAddress: opts.remoteAddress },
          async *[Symbol.asyncIterator]() { yield bytes; },
        };
        let statusCode = 0, out = '';
        const res = {
          set statusCode(v: number) { statusCode = v; },
          get statusCode() { return statusCode; },
          setHeader: () => undefined,
          end: (s = '') => { out = String(s); },
        };
        await mw!(req, res, () => { statusCode = 404; });
        return { statusCode, out };
      };

      expect((await call({ remoteAddress: undefined, headers: { 'x-ogs': '1' } })).statusCode).toBe(403);
      expect((await call({ remoteAddress: '192.168.1.9', headers: { 'x-ogs': '1' } })).statusCode).toBe(403);
      expect((await call({ remoteAddress: '127.0.0.1', headers: {} })).statusCode).toBe(403);
      expect((await call({ remoteAddress: '127.0.0.1', headers: { 'x-ogs': '1', host: 'localhost:5173', origin: 'http://evil.com' } })).statusCode).toBe(403);

      const b64 = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_V1))}`;
      const okRes = await call({
        remoteAddress: '127.0.0.1',
        headers: { 'x-ogs': '1', host: 'localhost:5173', origin: 'http://localhost:5173' },
        body: { kitSlug: 'marca', versionId: 'v1', assets: [{ filename: 'logo.png', dataUrl: b64 }] },
      });
      expect(okRes.statusCode).toBe(200);

      // If vigente is a real directory (not a symlink), return 409 without deleting it.
      const realDir = join(tmp, 'brand-exports', 'real-kit', 'vigente');
      mkdirSync(realDir, { recursive: true });
      writeFileSync(join(realDir, 'keep.txt'), 'safe');
      const conflict = await call({
        remoteAddress: '127.0.0.1',
        headers: { 'x-ogs': '1', host: 'localhost:5173', origin: 'http://localhost:5173' },
        body: { kitSlug: 'real-kit', versionId: 'v1', assets: [{ filename: 'logo.png', dataUrl: b64 }] },
      });
      expect(conflict.statusCode).toBe(409);
      expect(readFileSync(join(realDir, 'keep.txt'), 'utf8')).toBe('safe');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Bug 8: skips replacing unchanged components on token-only save, respects target doc tokenMode, and cleans up buffers on sync/revert', async () => {
    setBrandSyncMode('manual');
    const { subject: uiKit, doc: kitDoc } = await createItem({ name: 'UI Kit', kind: 'design-system', tokens: TOKENS, space: 'studio', sessionId: sid, by: 'user' });
    const accentRef = { kit: uiKit.id, token: 'marca.acento', value: '#11aa22' };
    const bg = newVectorLayer('Bg', [{ type: 'rect', x: 0, y: 0, w: 120, h: 40, fill: '#11aa22', fillToken: accentRef, stroke: null, strokeWidth: 0, radius: 6 }]);
    const lbl = newTextLayer('Label', 'v1', { x: 10, y: 10, width: 100 });
    const img = newRasterLayer('Icon', { x: 0, y: 0, width: 40, height: 40 }, { width: 40, height: 40 });
    setBuffer(img.id, createCanvas(40, 40));
    setDoc(sid, kitDoc!.id, (d) => ({ ...d, layers: [bg, lbl, img] }));
    const srcGid = groupLayers(sid, kitDoc!.id, [bg.id, lbl.id, img.id])!;
    patchGroup(sid, kitDoc!.id, srcGid, { name: 'Chip' });
    await saveItem({ subjectId: uiKit.id, mode: 'overwrite', sessionId: sid, docId: kitDoc!.id, space: 'studio', by: 'user' });

    const target = { ...createDoc('DarkPost', 600, 600, '#000000'), tokenMode: 'Dark' };
    addDoc(sid, target);
    const { groupId } = await insertComponent(sid, target.id, uiKit.id, srcGid, { x: 20, y: 30 });
    // User customizes text locally on the instance.
    setDoc(sid, target.id, (d) => ({ ...d, layers: d.layers.map((l) => (l.type === 'text' ? { ...l, text: 'Local custom' } : l)) }));
    const oldRasterId = getDoc(sid, target.id)!.layers.find((l) => l.type === 'raster')!.id;
    setBuffer(oldRasterId, createCanvas(40, 40));

    // Save v2 changing ONLY a token (component layers untouched) → local text edit MUST NOT be clobbered!
    const v2 = await saveItem({ subjectId: uiKit.id, mode: 'overwrite', sessionId: sid, docId: kitDoc!.id, space: 'studio', by: 'user', tokens: { ...TOKENS, 'firma.radio': { type: 'dimension', value: '20px' } } });
    const rNoop = await syncBrandInSession(sid, { docId: target.id });
    expect(rNoop.componentsUpdated).toBe(0);
    expect((getDoc(sid, target.id)!.layers.find((l) => l.type === 'text') as TextLayer).text).toBe('Local custom');
    expect(getDoc(sid, target.id)!.groups?.find((g) => g.id === groupId)?.from?.versionId).toBe(v2.versionId);

    // Now actually change the component in v3 → instance updates, respects tokenMode='Dark' (#112233), and releases old raster buffer!
    setDoc(sid, kitDoc!.id, (d) => ({ ...d, layers: d.layers.map((l) => (l.type === 'text' ? { ...l, text: 'v3 real' } : l)) }));
    await saveItem({ subjectId: uiKit.id, mode: 'overwrite', sessionId: sid, docId: kitDoc!.id, space: 'studio', by: 'user' });
    const rReal = await syncBrandInSession(sid, { docId: target.id });
    expect(rReal.componentsUpdated).toBe(1);
    const afterDoc = getDoc(sid, target.id)!;
    // Local text override ('Local custom') is preserved across component sync while v3 structural/token updates apply!
    expect((afterDoc.layers.find((l) => l.type === 'text') as TextLayer).text).toBe('Local custom');
    expect((afterDoc.layers.find((l) => l.type === 'vector') as VectorLayer).shapes[0].fill).toBe('#112233');
    // Old raster buffer was freed!
    releaseBuffers(afterDoc.layers.filter((l) => l.type === 'raster').map((l) => l.id), [oldRasterId]);
    expect(getBuffer(oldRasterId)).toBeUndefined();

    // Revert restores old raster buffer and local text!
    expect(revertBrandSyncNotice()).toBe(true);
    expect((getDoc(sid, target.id)!.layers.find((l) => l.type === 'text') as TextLayer).text).toBe('Local custom');
    expect(getBuffer(oldRasterId)?.width).toBe(40);
  });
});
