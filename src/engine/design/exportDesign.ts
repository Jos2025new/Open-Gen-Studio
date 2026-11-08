import { uid } from '../../lib/id';
import { blobToDataUrl, canvasToBlob, downloadBlob } from '../../lib/media';
import { setDoc } from '../../store/store';
import type { DesignDoc } from '../types';
import { ExportError, exportError } from './exportErrors';
import { exportPlan, exportPreview, type ExportFile, type ExportTarget } from './exportJob';
import type { ExportSettings, RememberedExport } from './exportSettings';
import { objectPicks } from './objectSelection';
import { getSelection, type PixelSelection } from './pixelSelection';
import { ensureBuffers, getBuffer, isUnreadable, rasterBufferIds } from './raster';
import { layoutText, textAscent } from './render';

const selectionKeys = new WeakMap<PixelSelection, string>();

export function currentExportTarget(doc: DesignDoc, settings: ExportSettings): string | undefined {
  if (settings.area === 'layer') return doc.activeLayerId ?? undefined;
  if (settings.area === 'objects') return objectPicks(doc.id).length ? JSON.stringify(objectPicks(doc.id)) : undefined;
  if (settings.area !== 'selection') return;
  const selection = getSelection(doc.id);
  if (!selection) return;
  let key = selectionKeys.get(selection);
  if (!key) {
    key = uid('selection');
    selectionKeys.set(selection, key);
  }
  return key;
}

export function resolveExportTarget(doc: DesignDoc, { settings, target }: RememberedExport): ExportTarget {
  if (settings.area === 'canvas' || settings.area === 'content') return {};
  if (settings.area === 'layer') return { layerId: target };
  if (settings.area === 'objects') return target && target === currentExportTarget(doc, settings) ? { objects: objectPicks(doc.id) } : {};
  return { selection: target && target === currentExportTarget(doc, settings) ? getSelection(doc.id) ?? undefined : undefined };
}

async function loadExportLayers(doc: DesignDoc, target: ExportTarget, signal?: AbortSignal) {
  const layers = target.layerId ? doc.layers.filter((l) => l.id === target.layerId) : doc.layers.filter((l) => l.visible);
  try {
    await ensureBuffers(layers);
    signal?.throwIfAborted();
    if (rasterBufferIds(layers).some(isUnreadable)) {
      throw new ExportError('Layer pixels could not be read, so retry from the Layers panel before exporting.');
    }
  } catch (error) {
    signal?.throwIfAborted();
    throw exportError(error, 'The design could not be read, so reopen it and try again.');
  }
}

export async function prepareDesignPreview(doc: DesignDoc, settings: ExportSettings, target: ExportTarget, signal?: AbortSignal) {
  await loadExportLayers(doc, target, signal);
  return exportPreview(doc, settings, target, signal);
}

export async function prepareDesignExport(doc: DesignDoc, settings: ExportSettings, target: ExportTarget, signal?: AbortSignal, onProgress?: (done: number, total: number) => void, filename = doc.name) {
  await loadExportLayers(doc, target, signal);
  const notices = new Set<string>();
  if (settings.area === 'selection' && (settings.format === 'svg' || settings.format === 'pdf' || settings.outputs?.some((r) => r.format === 'svg' || r.format === 'pdf'))) {
    notices.add('SVG and PDF use an embedded image for a pixel selection.');
  }
  const files = await exportPlan(doc, settings, target, {
    rasterHref: async (layer) => {
      const buf = getBuffer(layer.id);
      return buf ? blobToDataUrl(await canvasToBlob(buf)) : null;
    },
    layout: layoutText,
    ascent: textAscent,
    notice: (message) => notices.add(message),
  }, signal, onProgress, filename);
  if (settings.format === 'webp' && files[0].mime === 'image/jpeg') notices.add('This browser does not encode WebP. The Lightweight web preset prepared a JPG.');
  return { files, notices: [...notices] };
}

const requestedNames = new Set<string>();

export function deliverDesignExport(file: ExportFile): string {
  const dot = file.name.lastIndexOf('.');
  let name = file.name;
  for (let i = 2; requestedNames.has(name.toLowerCase()); i++) {
    name = `${file.name.slice(0, dot)}-${i}${file.name.slice(dot)}`;
  }
  try {
    downloadBlob(file.bytes, name);
  } catch (error) {
    throw exportError(error, 'The download could not start, so check your browser downloads and try again.');
  }
  requestedNames.add(name.toLowerCase());
  return name;
}

export function rememberDesignExport(sessionId: string, docId: string, lastExport: RememberedExport): void {
  setDoc(sessionId, docId, (doc) => ({ ...doc, lastExport }));
}
