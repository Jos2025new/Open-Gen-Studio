import { uid } from '../../lib/id';
import { getAssetBlob, putAssetBlob } from '../../lib/idb';
import { blobToCanvas, blobToDataUrl, canvasToBlob, createCanvas, downloadBlob, fetchBlob } from '../../lib/media';
import type { Asset, DesignDoc, Layer, LayerStep, RasterLayer, OpId, AdvancedValue, ShapeSpec, TextStyle } from '../types';
import { addAssets, patchSession, setDoc, setUi, toast, useStore } from '../../store/store';
import * as D from './doc';
import { record, undo, redo, dropHistory } from './history';
import { copyBuffer, deleteBuffers, ensureBuffers, getBuffer, setBuffer } from './raster';
import { exportDoc, layoutText, textAscent } from './render';
import { docToSvg, svgToPdf, type ExportFormat, type SvgDeps } from './export';
import { isProtectedImage, placementError } from './rules';

const get = useStore.getState;

export function sessionDocs(sessionId: string): DesignDoc[] {
  return get().sessions[sessionId]?.docs ?? [];
}

export function activeDoc(sessionId: string): DesignDoc | null {
  const s = get().sessions[sessionId];
  if (!s) return null;
  return s.docs.find((d) => d.id === s.activeDocId) ?? s.docs[0] ?? null;
}

export function getDoc(sessionId: string, docId: string): DesignDoc | undefined {
  return sessionDocs(sessionId).find((d) => d.id === docId);
}

/** Apply a change to a doc, recording undo history first. */
export function mutateDoc(sessionId: string, docId: string, fn: (d: DesignDoc) => DesignDoc, opts: { record?: boolean } = {}): void {
  const doc = getDoc(sessionId, docId);
  if (!doc) return;
  if (opts.record !== false) record(doc);
  setDoc(sessionId, docId, fn);
}

export function addDoc(sessionId: string, doc: DesignDoc): void {
  patchSession(sessionId, (s) => ({ ...s, docs: [...s.docs, doc], activeDocId: doc.id }));
}

export function selectDoc(sessionId: string, docId: string): void {
  patchSession(sessionId, (s) => ({ ...s, activeDocId: docId }));
  const doc = getDoc(sessionId, docId);
  if (doc) void ensureBuffers(doc.layers.filter((l) => l.type === 'raster') as Extract<Layer, { type: 'raster' }>[]);
}

export function newBlankDoc(sessionId: string, preset: { label: string; width: number; height: number }): DesignDoc {
  const count = sessionDocs(sessionId).length + 1;
  const doc = D.createDoc(`Design ${count}`, preset.width, preset.height);
  addDoc(sessionId, doc);
  return doc;
}

export function ensureDoc(sessionId: string, size?: { width: number; height: number }): DesignDoc {
  const existing = activeDoc(sessionId);
  if (existing) return existing;
  return newBlankDoc(sessionId, { label: 'Design', width: size?.width ?? 1080, height: size?.height ?? 1080 });
}

export function renameDoc(sessionId: string, docId: string, name: string): void {
  const n = name.trim();
  if (n) setDoc(sessionId, docId, (d) => D.touch({ ...d, name: n }));
}

export function deleteDoc(sessionId: string, docId: string): void {
  const doc = getDoc(sessionId, docId);
  if (!doc) return;
  void deleteBuffers(doc.layers.filter((l) => l.type === 'raster').map((l) => l.id));
  dropHistory(docId);
  patchSession(sessionId, (s) => {
    const docs = s.docs.filter((d) => d.id !== docId);
    return { ...s, docs, activeDocId: s.activeDocId === docId ? docs[docs.length - 1]?.id ?? null : s.activeDocId };
  });
}

export async function assetCanvas(assetId: string): Promise<HTMLCanvasElement> {
  const asset = get().assets[assetId];
  if (!asset) throw new Error('Asset not found');
  let blob = await getAssetBlob(assetId);
  if (!blob && asset.remoteUrl) blob = await fetchBlob(asset.remoteUrl);
  if (!blob) throw new Error('Asset is not available offline');
  return blobToCanvas(blob);
}

/**
 * Place an image asset as raster pixels.
 * target: 'base' = layer 1 (bottom), 'new' = new layer above the active one,
 * 'replace' = the active raster layer, or a specific raster layer id.
 */
export async function placeAsset(sessionId: string, docId: string, assetId: string, target: 'base' | 'new' | 'replace' | string, name?: string): Promise<string | null> {
  const asset = get().assets[assetId];
  const doc = getDoc(sessionId, docId);
  if (!asset || !doc) return null;
  if (asset.kind !== 'image') {
    toast(placementError({ type: 'raster', name: 'Layer' }, 'video') ?? 'Only images can be placed on layers.', 'error');
    return null;
  }
  let targetLayer: Layer | undefined;
  if (target === 'replace') {
    targetLayer = D.activeLayer(doc) ?? undefined;
    if (!targetLayer) target = 'new';
  } else if (target !== 'base' && target !== 'new') {
    targetLayer = doc.layers.find((l) => l.id === target);
  }
  if (targetLayer && targetLayer.type !== 'raster') {
    toast(placementError(targetLayer, 'image')!, 'error');
    return null;
  }
  const canvas = await assetCanvas(assetId);
  const current = getDoc(sessionId, docId)!;
  record(current);
  if (target === 'base') {
    const base = current.layers[0];
    if (base && base.type === 'raster' && !base.locked) {
      // Replace layer 1 pixels, fitted to cover the canvas.
      setBuffer(base.id, canvas);
      const rect = D.fitRect(current.width, current.height, canvas.width, canvas.height, 'cover');
      setDoc(sessionId, docId, (d) =>
        D.updateLayer(d, base.id, { ...rect, pxWidth: canvas.width, pxHeight: canvas.height, rev: base.rev + 1, sourceAssetId: assetId, name: name ?? base.name }),
      );
      setDoc(sessionId, docId, (d) => ({ ...d, activeLayerId: base.id }));
      return base.id;
    }
    const rect = D.fitRect(current.width, current.height, canvas.width, canvas.height, 'cover');
    const layer = D.newRasterLayer(name ?? 'Background', rect, { width: canvas.width, height: canvas.height }, assetId);
    setBuffer(layer.id, canvas);
    setDoc(sessionId, docId, (d) => D.insertLayer(d, layer, 'base'));
    return layer.id;
  }
  if (targetLayer && targetLayer.type === 'raster') {
    if (targetLayer.locked) {
      toast(`"${targetLayer.name}" is locked.`, 'error');
      return null;
    }
    setBuffer(targetLayer.id, canvas);
    const rect = { x: targetLayer.x, y: targetLayer.y, width: targetLayer.width, height: (targetLayer.width * canvas.height) / canvas.width };
    setDoc(sessionId, docId, (d) => D.updateLayer(d, targetLayer!.id, { ...rect, pxWidth: canvas.width, pxHeight: canvas.height, rev: targetLayer!.rev + 1, sourceAssetId: assetId }));
    return targetLayer.id;
  }
  const rect = current.layers.length
    ? D.fitRect(current.width, current.height, canvas.width, canvas.height, 'contain')
    : D.fitRect(current.width, current.height, canvas.width, canvas.height, 'cover');
  const layer = D.newRasterLayer(name ?? `Image ${current.layers.length + 1}`, rect, { width: canvas.width, height: canvas.height }, assetId);
  setBuffer(layer.id, canvas);
  setDoc(sessionId, docId, (d) => D.insertLayer(d, layer, current.layers.length ? 'above' : 'base'));
  return layer.id;
}

/** Open an image asset as a new document whose layer 1 is that image. */
export async function openAssetInDesigner(sessionId: string, assetId: string): Promise<void> {
  const asset = get().assets[assetId];
  if (!asset) return;
  if (asset.kind !== 'image') {
    toast('Extract a frame first: designer layers hold images, text and shapes.', 'error');
    return;
  }
  const scale = Math.min(1, 4096 / Math.max(asset.width, asset.height));
  const doc = D.createDoc(`Design ${sessionDocs(sessionId).length + 1}`, Math.round(asset.width * scale), Math.round(asset.height * scale), null);
  addDoc(sessionId, doc);
  setUi({ workspace: 'designer', panel: null, lightbox: null });
  await placeAsset(sessionId, doc.id, assetId, 'base', 'Layer 1');
}

export function addTextLayer(sessionId: string, docId: string, text: string, pos: { x: number; y: number; width: number }, style: Partial<TextStyle>, name?: string): string | null {
  const doc = getDoc(sessionId, docId);
  if (!doc) return null;
  const layer = D.newTextLayer(name ?? (text.split('\n')[0].slice(0, 24) || 'Text'), text, pos, style);
  mutateDoc(sessionId, docId, (d) => D.insertLayer(d, layer, 'top'));
  return layer.id;
}

export function addVectorLayer(sessionId: string, docId: string, shapes: ShapeSpec[], name = 'Shapes'): string | null {
  const doc = getDoc(sessionId, docId);
  if (!doc) return null;
  const layer = D.newVectorLayer(name, shapes);
  mutateDoc(sessionId, docId, (d) => D.insertLayer(d, layer, 'top'));
  return layer.id;
}

export function addEmptyLayer(sessionId: string, docId: string, type: Layer['type']): string | null {
  const doc = getDoc(sessionId, docId);
  if (!doc) return null;
  let layer: Layer;
  const n = doc.layers.length + 1;
  if (type === 'raster') {
    layer = D.newRasterLayer(`Layer ${n}`, { x: 0, y: 0, width: doc.width, height: doc.height }, { width: doc.width, height: doc.height });
    setBuffer(layer.id, (() => {
      const c = document.createElement('canvas');
      c.width = doc.width;
      c.height = doc.height;
      return c;
    })());
  } else if (type === 'vector') {
    layer = D.newVectorLayer(`Shapes ${n}`);
  } else {
    const ui = get().ui.text;
    layer = D.newTextLayer(`Text ${n}`, 'Your text', { x: doc.width * 0.1, y: doc.height * 0.1, width: 0 }, { ...ui, fontSize: Math.round(doc.width / 12) });
  }
  mutateDoc(sessionId, docId, (d) => D.insertLayer(d, layer, 'above'));
  return layer.id;
}

/**
 * Raster layer the brush should paint on: the active layer when it accepts strokes,
 * else the unlocked paint layer right above it, else a new doc-sized "Paint" layer.
 * The caller records history, so the new layer and its first stroke undo together.
 */
export function ensurePaintLayer(sessionId: string, docId: string): RasterLayer | null {
  const doc = getDoc(sessionId, docId);
  if (!doc) return null;
  const act = D.activeLayer(doc);
  const paintable = (l: Layer | undefined): l is RasterLayer => !!l && l.type === 'raster' && !l.locked && l.visible && !isProtectedImage(l);
  if (paintable(act ?? undefined)) return act as RasterLayer;
  const above = act ? doc.layers[doc.layers.indexOf(act) + 1] : undefined;
  if (paintable(above) && !above.sourceAssetId) {
    setActiveLayer(sessionId, docId, above.id);
    return above;
  }
  const n = doc.layers.filter((l) => l.type === 'raster' && !l.sourceAssetId).length + 1;
  const layer = D.newRasterLayer(`Paint ${n}`, { x: 0, y: 0, width: doc.width, height: doc.height }, { width: doc.width, height: doc.height });
  setBuffer(layer.id, createCanvas(doc.width, doc.height));
  setDoc(sessionId, docId, (d) => D.insertLayer(d, layer, 'above'));
  return layer;
}

export function setActiveLayer(sessionId: string, docId: string, layerId: string | null): void {
  setDoc(sessionId, docId, (d) => ({ ...d, activeLayerId: layerId }));
}

export function patchLayer(sessionId: string, docId: string, layerId: string, patch: Partial<Layer>, opts: { record?: boolean } = {}): void {
  mutateDoc(sessionId, docId, (d) => D.updateLayer(d, layerId, patch), opts);
}

export function deleteLayer(sessionId: string, docId: string, layerId: string): void {
  // Buffers stay in memory for undo; they are dropped from storage with the doc.
  mutateDoc(sessionId, docId, (d) => D.removeLayer(d, layerId));
}

export function duplicateLayer(sessionId: string, docId: string, layerId: string): void {
  const doc = getDoc(sessionId, docId);
  const l = doc?.layers.find((x) => x.id === layerId);
  if (!doc || !l) return;
  const copy = D.cloneLayer(l);
  if (l.type === 'raster') copyBuffer(l.id, copy.id);
  mutateDoc(sessionId, docId, (d) => ({ ...D.insertLayer({ ...d, activeLayerId: layerId }, copy, 'above') }));
}

export function moveLayer(sessionId: string, docId: string, layerId: string, dir: 1 | -1): void {
  mutateDoc(sessionId, docId, (d) => D.moveLayer(d, layerId, dir));
}

export function reorderLayer(sessionId: string, docId: string, layerId: string, toIndex: number): void {
  mutateDoc(sessionId, docId, (d) => D.reorderLayer(d, layerId, toIndex));
}

export function undoDoc(sessionId: string, docId: string): void {
  const doc = getDoc(sessionId, docId);
  if (!doc) return;
  const prev = undo(doc);
  if (prev) setDoc(sessionId, docId, () => prev);
}

export function redoDoc(sessionId: string, docId: string): void {
  const doc = getDoc(sessionId, docId);
  if (!doc) return;
  const next = redo(doc);
  if (next) setDoc(sessionId, docId, () => next);
}

async function storeDesignAsset(sessionId: string, blob: Blob, width: number, height: number, origin: Asset['origin']): Promise<Asset> {
  const id = uid('ast');
  await putAssetBlob(id, blob);
  const asset: Asset = { id, kind: 'image', mime: blob.type || 'image/png', width, height, sessionId, origin, stored: true, favorite: false, createdAt: Date.now() };
  addAssets([asset]);
  return asset;
}

/** Save a canvas as a new image asset (PNG). */
export async function canvasToAsset(sessionId: string, canvas: HTMLCanvasElement, origin: Asset['origin'] = 'design'): Promise<Asset> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png'));
  return storeDesignAsset(sessionId, blob, canvas.width, canvas.height, origin);
}

/** Snapshot a raster layer's pixels as an asset (input for operations and references). */
export async function layerToAsset(sessionId: string, docId: string, layerId: string): Promise<Asset> {
  const doc = getDoc(sessionId, docId);
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error('Layer not found');
  if (layer.type !== 'raster') throw new Error(placementError(layer, 'image') ?? 'Only raster layers hold pixels.');
  const buf = getBuffer(layer.id);
  if (!buf) throw new Error('Layer pixels are not loaded yet.');
  const blob = await new Promise<Blob>((resolve, reject) => buf.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png'));
  return storeDesignAsset(sessionId, blob, buf.width, buf.height, 'design');
}

/** Replace a raster layer's pixels with an asset produced by an operation. */
export async function replaceLayerPixels(sessionId: string, docId: string, layerId: string, assetId: string): Promise<void> {
  const doc = getDoc(sessionId, docId);
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!doc || !layer || layer.type !== 'raster') return;
  const canvas = await assetCanvas(assetId);
  record(getDoc(sessionId, docId)!);
  setBuffer(layer.id, canvas);
  // Keep the on-canvas width, follow the new pixel aspect (reframe/upscale change it).
  const height = (layer.width * canvas.height) / canvas.width;
  setDoc(sessionId, docId, (d) => D.updateLayer(d, layer.id, { pxWidth: canvas.width, pxHeight: canvas.height, height, rev: layer.rev + 1, sourceAssetId: assetId }));
}

/** PNG/JPG through the editor renderer; SVG/PDF keep layers as vector objects (design/export.ts). */
export async function exportDocFile(sessionId: string, docId: string, format: ExportFormat = 'png'): Promise<void> {
  const doc = getDoc(sessionId, docId);
  if (!doc) return;
  await ensureBuffers(doc.layers.filter((l) => l.type === 'raster') as Extract<Layer, { type: 'raster' }>[]);
  const base = doc.name.replace(/[^\w-]+/g, '_') || 'design';
  if (format === 'png' || format === 'jpg') {
    downloadBlob(await exportDoc(doc, format === 'jpg' ? 'image/jpeg' : 'image/png'), `${base}.${format}`);
    return;
  }
  const svg = await docToSvg(doc, svgDeps());
  if (format === 'svg') downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${base}.svg`);
  else downloadBlob(await svgToPdf(svg, doc.width, doc.height), `${base}.pdf`);
}

function svgDeps(): SvgDeps {
  return {
    rasterHref: async (l) => {
      const buf = getBuffer(l.id);
      return buf ? blobToDataUrl(await canvasToBlob(buf, 'image/png')) : null;
    },
    layout: layoutText,
    ascent: textAscent,
  };
}

export async function saveDocToGallery(sessionId: string, docId: string): Promise<Asset | null> {
  const doc = getDoc(sessionId, docId);
  if (!doc) return null;
  await ensureBuffers(doc.layers.filter((l) => l.type === 'raster') as Extract<Layer, { type: 'raster' }>[]);
  const blob = await exportDoc(doc);
  const asset = await storeDesignAsset(sessionId, blob, doc.width, doc.height, 'design');
  toast('Design saved to the gallery', 'success');
  return asset;
}

/** Apply a plan layer step (agent in the Designer). */
export async function applyLayerStep(sessionId: string, docId: string, step: LayerStep, sourceAssetId: string | null): Promise<string | null> {
  const doc = getDoc(sessionId, docId);
  if (!doc) return null;
  if (step.layerType === 'raster') {
    if (!sourceAssetId) throw new Error(`Step ${step.id}: no image to place.`);
    return placeAsset(sessionId, docId, sourceAssetId, step.target === 'base' || step.target === 'new' ? step.target : step.target, step.title);
  }
  if (step.layerType === 'text') {
    const box = step.box && step.box.width > 0 ? step.box : { x: doc.width * 0.08, y: doc.height * 0.08, width: doc.width * 0.84 };
    const style: Partial<TextStyle> = { fontSize: Math.round(doc.width / 11), ...step.style };
    if (step.target !== 'new') {
      const l = doc.layers.find((x) => x.id === step.target);
      if (l && l.type === 'text') {
        patchLayer(sessionId, docId, l.id, { text: step.text ?? l.text, ...style, ...(step.box ? { x: box.x, y: box.y, width: box.width } : {}) } as Partial<Layer>);
        return l.id;
      }
    }
    return addTextLayer(sessionId, docId, step.text ?? '', box, style, step.title);
  }
  const shapes = step.shapes ?? [];
  if (step.target !== 'new') {
    const l = doc.layers.find((x) => x.id === step.target);
    if (l && l.type === 'vector') {
      patchLayer(sessionId, docId, l.id, { shapes: [...l.shapes, ...D.newVectorLayer('tmp', shapes).shapes] } as Partial<Layer>);
      return l.id;
    }
  }
  return addVectorLayer(sessionId, docId, shapes, step.title);
}

export type LayerOpRequest = { sessionId: string; docId: string; layerId: string; op: OpId; params: Record<string, AdvancedValue> };
