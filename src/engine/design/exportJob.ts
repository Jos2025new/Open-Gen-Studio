import { zip } from 'fflate';
import { blobToDataUrl } from '../../lib/media';
import { fxTarget } from '../fx/plan';
import type { DesignDoc } from '../types';
import { unionBox, type Box } from './doc';
import { docToSvg, svgToPdf, xmlEscape, type SvgDeps } from './export';
import { checkRasterExport, exportDoc, type RasterExport } from './exportRaster';
import { DEFAULT_JPEG_QUALITY, type ExportSettings } from './exportSettings';
import { selectionBox, selectionMask, type PixelSelection } from './pixelSelection';
import { layerBox } from './render';
import { blurRegion } from './shapeLook';

export interface ExportTarget {
  layerId?: string;
  selection?: PixelSelection;
}

export interface ExportFile {
  name: string;
  mime: string;
  bytes: Blob;
}

const rasterMime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

function exportArea(doc: DesignDoc, settings: ExportSettings, target: ExportTarget) {
  const page = { x: 0, y: 0, w: doc.width, h: doc.height };
  if (settings.area === 'canvas') return { doc, box: page };
  if (settings.area === 'selection') {
    const box = target.selection && selectionBox(doc, target.selection);
    if (!box) throw new Error('Select an area of the canvas or choose Canvas. No file was created.');
    return { doc, box };
  }
  const layer = doc.layers.find((l) => l.id === target.layerId && l.visible && l.type !== 'fx');
  if (!layer) throw new Error('The layer is unavailable. Choose a visible layer. No file was created.');
  const geometry = layerBox(layer);
  const paintExtents = layer.type === 'vector' && !layer.pixelMask
    ? layer.shapes.filter((shape) => shape.blur || (shape.strokeWidth > 0 && (shape.stroke || shape.strokeGradient))).map(blurRegion)
    : [];
  const bounds = unionBox(geometry ? [geometry, ...paintExtents] : paintExtents);
  const box = bounds && clampBox(bounds, page);
  if (!box) throw new Error('The layer has no area on the canvas. Choose another layer.');
  const layers = doc.layers.filter((l) => l === layer || (l.type === 'fx' && fxTarget(doc.layers, l.id) === layer));
  return { doc: { ...doc, layers, background: null }, box };
}

function clampBox(box: Box, page: Box): Box | null {
  const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
  const w = Math.min(page.w, Math.ceil(box.x + box.w)) - x;
  const h = Math.min(page.h, Math.ceil(box.y + box.h)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

export function exportGeometry(doc: DesignDoc, settings: ExportSettings, target: ExportTarget) {
  const area = exportArea(doc, settings, target);
  if (typeof settings.size === 'string' && (!Number.isSafeInteger(settings.pixels) || !settings.pixels || settings.pixels < 1)) {
    throw new Error('Enter a positive whole number of pixels. No file was created.');
  }
  const { box } = area;
  const scale = settings.size === 'width' ? (settings.pixels ?? 0) / box.w
    : settings.size === 'long-side' ? (settings.pixels ?? 0) / Math.max(box.w, box.h)
    : settings.size;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Enter a positive width in pixels. No file was created.');
  const width = Math.max(1, Math.round(box.w * scale)), height = Math.max(1, Math.round(box.h * scale));
  const fit = settings.preset === 'instagram' && settings.fitInstagram;
  const fittedHeight = Math.round(width * 5 / 4);
  const fittedScale = fit ? Math.min(width / box.w, fittedHeight / box.h) : scale;
  return { ...area, width, height: fit ? fittedHeight : height, scale: fittedScale,
    offsetX: fit ? (width - box.w * fittedScale) / 2 : 0,
    offsetY: fit ? (fittedHeight - box.h * fittedScale) / 2 : 0 };
}

function exportOutputs(settings: ExportSettings) {
  if (settings.preset !== 'brand') return [settings];
  return [
    { ...settings, size: 1, format: 'svg' },
    { ...settings, size: 1, format: 'png' },
    { ...settings, size: 2, format: 'png' },
  ] satisfies ExportSettings[];
}

export function validateExport(doc: DesignDoc, settings: ExportSettings, target: ExportTarget) {
  if ((settings.format === 'jpg' || settings.format === 'webp') && settings.maxKb !== undefined
    && (!Number.isFinite(settings.maxKb) || settings.maxKb <= 0)) {
    throw new Error('Enter a file size limit greater than zero. No file was created.');
  }
  for (const output of exportOutputs(settings)) {
    const geometry = exportGeometry(doc, output, target);
    if (output.format === 'pdf' && output.pdf !== 'a4' && Math.max(geometry.width, geometry.height) > 19_200) {
      throw new Error('The PDF page is too large. Choose a smaller size or A4. No file was created.');
    }
    if (output.format in rasterMime || output.area === 'selection') checkRasterExport(geometry.doc, geometry);
  }
}

function fileBase(name: string): string {
  return name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'design';
}

async function renderOutput(doc: DesignDoc, settings: ExportSettings, target: ExportTarget, deps: SvgDeps, signal?: AbortSignal): Promise<ExportFile> {
  const geometry = exportGeometry(doc, settings, target);
  const { format } = settings;
  const raster = rasterMime[format as keyof typeof rasterMime];
  const background = settings.background === undefined ? geometry.doc.background : settings.background;
  const renderDoc = background === geometry.doc.background ? geometry.doc : { ...geometry.doc, background };
  const mask = settings.area === 'selection' && target.selection ? selectionMask(doc, target.selection) : undefined;
  const lossy = format === 'jpg' || format === 'webp';
  const maxKb = lossy ? settings.maxKb : undefined;
  const options = { ...geometry, mask, background: settings.fitInstagram ? background ?? '#ffffff' : settings.background ?? undefined, signal,
    quality: maxKb ? 100 : settings.quality ?? DEFAULT_JPEG_QUALITY, maxKb, webFallback: settings.preset === 'web' };
  let bytes: Blob;
  if (raster) {
    bytes = await exportDoc(renderDoc, raster, options);
  } else {
    // Pixel selections can have arbitrary alpha. Preserve their exact shape in SVG and PDF as an embedded image.
    const svg = mask ? await maskedSvg(renderDoc, options) : await docToSvg(renderDoc, deps, geometry);
    signal?.throwIfAborted();
    bytes = format === 'pdf' ? await svgToPdf(svg, geometry.width, geometry.height, settings.pdf === 'a4') : new Blob([svg], { type: 'image/svg+xml' });
  }
  signal?.throwIfAborted();
  const extension = bytes.type === 'image/jpeg' ? 'jpg' : format;
  const suffix = typeof settings.size === 'number' && settings.size > 1 ? `@${settings.size}x` : '';
  return { name: `${fileBase(doc.name)}${suffix}.${extension}`, mime: bytes.type, bytes };
}

async function maskedSvg(doc: DesignDoc, options: RasterExport): Promise<string> {
  const { width, height } = options;
  const href = await blobToDataUrl(await exportDoc(doc, 'image/png', options));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${xmlEscape(doc.name)}</title><image width="${width}" height="${height}" href="${href}"/></svg>`;
}

export async function exportPlan(doc: DesignDoc, settings: ExportSettings, target: ExportTarget, deps: SvgDeps, signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<ExportFile[]> {
  signal?.throwIfAborted();
  validateExport(doc, settings, target);
  const outputs = exportOutputs(settings);
  const files: ExportFile[] = [];
  for (const output of outputs) {
    onProgress?.(files.length, outputs.length);
    // Let the panel paint progress and handle Cancel before starting canvas or SVG work.
    if (onProgress) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    try {
      files.push(await renderOutput(doc, output, target, deps, signal));
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && error.message.includes('No file was created')) throw error;
      const detail = error instanceof Error ? ` ${error.message}` : '';
      throw new Error(`Could not prepare ${output.format.toUpperCase()}. No file was created. Try a smaller size or another format.${detail}`);
    }
  }
  return files;
}

export async function exportDownloadFile(doc: DesignDoc, files: ExportFile[], signal?: AbortSignal): Promise<ExportFile> {
  signal?.throwIfAborted();
  if (files.length === 1) return files[0];
  if (new Set(files.map((file) => file.name)).size !== files.length) throw new Error('The export contains duplicate filenames. No file was created.');
  const entries = await Promise.all(files.map(async (file) => [file.name, new Uint8Array(await file.bytes.arrayBuffer())] as const));
  signal?.throwIfAborted();
  const bytes = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const abort = () => { stop(); reject(signal?.reason); };
    const stop = zip(Object.fromEntries(entries), { level: 0 }, (err, data) => {
      signal?.removeEventListener('abort', abort);
      if (err) reject(err);
      else resolve(new Uint8Array(data));
    });
    signal?.addEventListener('abort', abort, { once: true });
  });
  signal?.throwIfAborted();
  return { name: `${fileBase(doc.name)}.zip`, mime: 'application/zip', bytes: new Blob([bytes], { type: 'application/zip' }) };
}
