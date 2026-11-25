import { strokesExportMask } from './exportStrokeMask';
import { layerObjects, wholeLayerObject } from './objectOps';
import { zip } from 'fflate';
import { blobToDataUrl } from '../../lib/media';
import { fxTarget } from '../fx/plan';
import type { DesignDoc, Layer } from '../types';
import { unionBox, type Box } from './doc';
import { docToSvg, svgToPdf, xmlEscape, type SvgDeps } from './export';
import { ExportError, exportError } from './exportErrors';
import { checkRasterExport, drawExport, exportDoc, PREVIEW_MAX_SIDE, type RasterExport } from './exportRaster';
import { canEmbedInPdf, collectFonts, fontFaceCss, isSlanted, woffToSfnt } from './exportText';
import { printPixelRatio, printPreflight } from './exportPrint';
import { autoSuffix, DEFAULT_JPEG_QUALITY, pageLayout, pdfPage, type ExportSettings } from './exportSettings';
import type { ObjectPick } from './objectSelection';
import { selectionBox, selectionPath, type PixelSelection } from './pixelSelection';
import { layerBox } from './render';
import { shownLayer } from './objectGroupTree';
import { blurRegion } from './shapeLook';

export interface ExportTarget {
  layerId?: string;
  selection?: PixelSelection;
  /** Picked objects, possibly in several layers. */
  objects?: ObjectPick[];
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
    if (!box) throw new ExportError('The pixel selection is missing, so select an area or choose Canvas.');
    return { doc, box };
  }
  if (settings.area === 'content') {
    const bounds = unionBox(doc.layers.filter((l) => l.visible && l.type !== 'fx').map(layerExtent).filter((b): b is Box => !!b));
    const box = bounds && clampBox(bounds, page);
    if (!box) throw new ExportError('The drawing has no content, so choose Canvas.');
    return { doc, box };
  }
  if (settings.area === 'objects') return objectsArea(doc, target.objects, page);
  const layer = doc.layers.find((l) => l.id === target.layerId && l.visible && l.type !== 'fx');
  if (!layer) throw new ExportError('The layer is unavailable, so choose a visible layer.');
  const extent = layerExtent(layer);
  const box = extent && clampBox(extent, page);
  if (!box) throw new ExportError('The layer has no area on the canvas, so choose another layer.');
  return { doc: onlyLayers(doc, new Map([[layer.id, layer]])), box };
}

/** Where a layer shows: its geometry plus the reach of strokes and blur. */
function layerExtent(layer: Layer): Box | null {
  const geometry = layerBox(layer);
  const paintExtents = layer.type === 'vector' && !layer.pixelMask
    ? shownLayer(layer).shapes.filter((shape) => shape.blur || (shape.strokeWidth > 0 && (shape.stroke || shape.strokeGradient))).map(blurRegion)
    : [];
  return unionBox(geometry ? [geometry, ...paintExtents] : paintExtents);
}

/** Only these layers (and the FX acting on them), without the page background. */
function onlyLayers(doc: DesignDoc, keep: Map<string, Layer>): DesignDoc {
  const layers = doc.layers.flatMap((l) => {
    if (keep.has(l.id)) return [keep.get(l.id)!];
    const target = l.type === 'fx' ? fxTarget(doc.layers, l.id) : undefined;
    return target && keep.has(target.id) ? [l] : [];
  });
  return { ...doc, layers, background: null };
}

function objectsArea(doc: DesignDoc, picks: ObjectPick[] | undefined, page: Box) {
  const keep = new Map<string, Layer>();
  const partial = new Map<string, Set<string>>();
  for (const pick of picks ?? []) {
    const layer = doc.layers.find((l) => l.id === pick.layerId && l.visible && l.type !== 'fx');
    if (!layer) continue;
    const ids = new Set(pick.ids);
    if (!layerObjects(layer).some((object) => ids.has(object.id))) continue;
    // Some strokes of a painted layer: its pixels are kept and cut to those strokes' footprint (exportStrokeMask.ts).
    if (layer.type === 'raster' && !wholeLayerObject(layer) && !ids.has(layer.id) && (layer.paintStrokes ?? []).some((st) => !st.erase && !ids.has(st.id))) partial.set(layer.id, ids);
    keep.set(layer.id, layer.type === 'vector'
      ? { ...layer, shapes: layer.shapes.filter((s) => ids.has(s.id)), strokes: layer.strokes?.filter((s) => ids.has(s.id)) }
      : layer);
  }
  const bounds = unionBox([...keep.values()].map(layerExtent).filter((b): b is Box => !!b));
  const box = bounds && clampBox(bounds, page);
  if (!box) throw new ExportError('No picked objects are on the canvas, so pick objects (Edit tool) or choose Canvas.');
  const strokeBoxes = [...partial].flatMap(([id, ids]) => layerObjects(keep.get(id)!).filter((o) => ids.has(o.id)).map((o) => o.box));
  const tight = partial.size ? unionBox([...[...keep.values()].filter((l) => !partial.has(l.id)).map(layerExtent).filter((b): b is Box => !!b), ...strokeBoxes]) : null;
  const area = (tight && clampBox(tight, page)) || box;
  return { doc: onlyLayers(doc, keep), box: area, mask: partial.size ? strokesExportMask(doc, [...keep.values()], partial, area) : undefined, maskBox: partial.size ? area : undefined };
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
    throw new ExportError('The pixel size is invalid, so enter a positive whole number.');
  }
  const { box } = area;
  const scale = settings.size === 'width' ? (settings.pixels ?? 0) / box.w
    : settings.size === 'long-side' ? (settings.pixels ?? 0) / Math.max(box.w, box.h)
    : settings.size;
  if (!Number.isFinite(scale) || scale <= 0) throw new ExportError('The width is invalid, so enter a positive width in pixels.');
  const width = Math.max(1, Math.round(box.w * scale)), height = Math.max(1, Math.round(box.h * scale));
  const fit = settings.preset === 'instagram' && settings.fitInstagram;
  const fittedHeight = Math.round(width * 5 / 4);
  const fittedScale = fit ? Math.min(width / box.w, fittedHeight / box.h) : scale;
  return { ...area, width, height: fit ? fittedHeight : height, scale: fittedScale,
    offsetX: fit ? (width - box.w * fittedScale) / 2 : 0,
    offsetY: fit ? (fittedHeight - box.h * fittedScale) / 2 : 0 };
}

function exportOutputs(settings: ExportSettings): ExportSettings[] {
  if (!settings.outputs?.length) return [settings];
  return settings.outputs.map((r) => ({ ...settings, outputs: undefined, size: r.scale, format: r.format, suffix: r.suffix }));
}

/** A suffix stays inside one file name: no folder separators or characters file systems reject. */
const safeSuffix = (suffix: string) => suffix.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');

/** The file names an export will produce, as the panel shows them before exporting. */
export function exportFileNames(settings: ExportSettings, filename: string): string[] {
  const base = filePrefix(settings.prefix) + fileBase(filename);
  return uniqueNames(exportOutputs(settings).map((o) => ({
    name: `${base}${safeSuffix(o.suffix ?? (typeof o.size === 'number' ? autoSuffix(o.size) : ''))}.${o.format}`,
  }))).map((f) => f.name);
}

export function validateExport(doc: DesignDoc, settings: ExportSettings, target: ExportTarget) {
  const sized = [settings.format, ...(settings.outputs ?? []).map((o) => o.format)].some((f) => f === 'jpg' || f === 'webp');
  if (sized && settings.maxKb !== undefined
    && (!Number.isFinite(settings.maxKb) || settings.maxKb <= 0)) {
    throw new ExportError('The file size limit is invalid, so enter a value above zero.');
  }
  for (const output of exportOutputs(settings)) {
    const geometry = exportGeometry(doc, output, target);
    if (output.format === 'pdf' && !pdfPage(output.pdf) && Math.max(geometry.width, geometry.height) > 19_200) {
      throw new ExportError('The PDF page is too large, so choose a smaller size or switch to home printing.');
    }
    if (output.format in rasterMime || output.area === 'selection') checkRasterExport(geometry.doc, geometry);
  }
}

function fileBase(name: string): string {
  return name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'design';
}

const filePrefix = (prefix = '') => prefix.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40);

/** Names that repeat get -2, -3 … so the user never meets a duplicate-name error. */
function uniqueNames<T extends { name: string }>(files: T[]): T[] {
  const seen = new Set<string>();
  return files.map((file) => {
    const dot = file.name.lastIndexOf('.');
    let name = file.name;
    for (let i = 2; seen.has(name.toLowerCase()); i++) name = `${file.name.slice(0, dot)}-${i}${file.name.slice(dot)}`;
    seen.add(name.toLowerCase());
    return name === file.name ? file : { ...file, name };
  });
}

function rasterLayout(doc: DesignDoc, settings: ExportSettings, target: ExportTarget, signal?: AbortSignal) {
  const geometry = exportGeometry(doc, settings, target);
  const background = settings.background === undefined ? geometry.doc.background : settings.background;
  const renderDoc = background === geometry.doc.background ? geometry.doc : { ...geometry.doc, background };
  const selection = settings.area === 'selection' ? target.selection : undefined;
  const options: RasterExport = {
    ...geometry, signal, mask: selection?.mask ?? ('mask' in geometry ? geometry.mask : undefined), maskBox: selection?.mask ? undefined : ('maskBox' in geometry ? geometry.maskBox : undefined),
    clip: selection && !selection.mask ? (ctx) => {
      selectionPath(ctx, doc, selection);
      ctx.clip('evenodd');
    } : undefined,
    background: settings.fitInstagram ? background ?? '#ffffff' : settings.background ?? undefined,
  };
  return { renderDoc, options, selection };
}

/** One small frame drawn straight onto a canvas (no PNG round trip), with the same crop, paper fit and background as the selected output. */
export function exportPreview(doc: DesignDoc, settings: ExportSettings, target: ExportTarget, signal?: AbortSignal): HTMLCanvasElement {
  const output = exportOutputs(settings)[0];
  const { renderDoc, options } = rasterLayout(doc, output, target, signal);
  const paper = output.format === 'pdf' ? pdfPage(output.pdf) : undefined;
  const layout = paper && pageLayout(paper, options.width, options.height, output.print);
  const width = layout?.pageWidth ?? options.width, height = layout?.pageHeight ?? options.height;
  const shrink = Math.min(1, PREVIEW_MAX_SIDE / Math.max(width, height));
  const bleedClip = layout?.trim && ((ctx: CanvasRenderingContext2D) => {
    const { box } = options;
    ctx.beginPath();
    ctx.rect(box.x + (layout.trim!.x - layout.bleed - layout.x) / layout.scale / options.scale, box.y + (layout.trim!.y - layout.bleed - layout.y) / layout.scale / options.scale,
      (layout.trim!.w + 2 * layout.bleed) / layout.scale / options.scale, (layout.trim!.h + 2 * layout.bleed) / layout.scale / options.scale);
    ctx.clip();
  });
  return drawExport(renderDoc, 'image/png', {
    // Both clips apply: the bleed box and the selection's own shape (the preview matches the exported area).
    ...options, clip: bleedClip || options.clip ? (ctx: CanvasRenderingContext2D) => { if (bleedClip) bleedClip(ctx); options.clip?.(ctx); } : undefined, preview: true, whiteBase: output.format === 'jpg',
    width: Math.max(1, Math.round(width * shrink)), height: Math.max(1, Math.round(height * shrink)),
    scale: options.scale * (layout?.scale ?? 1) * shrink,
    offsetX: ((layout?.x ?? 0) + (options.offsetX ?? 0) * (layout?.scale ?? 1)) * shrink,
    offsetY: ((layout?.y ?? 0) + (options.offsetY ?? 0) * (layout?.scale ?? 1)) * shrink,
    background: output.format === 'pdf' || output.format === 'jpg' ? options.background ?? '#ffffff' : options.background,
  }).canvas;
}

async function renderOutput(doc: DesignDoc, settings: ExportSettings, target: ExportTarget, deps: SvgDeps, base: string, signal?: AbortSignal): Promise<ExportFile> {
  const { renderDoc, options, selection } = rasterLayout(doc, settings, target, signal);
  const { format } = settings;
  const raster = rasterMime[format as keyof typeof rasterMime];
  const maxKb = format === 'jpg' || format === 'webp' ? settings.maxKb : undefined;
  let bytes: Blob;
  if (raster) {
    bytes = await exportDoc(renderDoc, raster, {
      ...options, quality: maxKb ? 100 : settings.quality ?? DEFAULT_JPEG_QUALITY, maxKb, webFallback: settings.preset === 'web',
    });
  } else {
    // Pixel selections can have arbitrary alpha. Preserve their exact shape in SVG and PDF as an embedded image.
    const page = format === 'pdf' ? pdfPage(settings.pdf) : undefined;
    const layout = page && pageLayout(page, options.width, options.height, settings.print);
    // On paper: pixels the SVG turns into an image are made at the chosen ppi (300) for the printed size; layers keep their own pixels.
    const ppi = settings.ppi ?? 300, ratio = layout ? printPixelRatio(layout.scale, ppi) : 1;
    if (layout) printPreflight(renderDoc, options.scale * layout.scale, deps.rasterSize ?? (() => null), ppi).forEach((m) => deps.notice?.(m));
    // PDF has no filters: what blur and effects cover goes in as pictures, at the print resolution (never under 2×).
    const pdfDeps = format === 'pdf' && deps.picture ? { ...deps, picture: (part: DesignDoc, area?: Box) => deps.picture!(part, area, Math.max(2, ratio)) } : deps;
    const texts = renderDoc.layers.filter((l): l is Extract<typeof l, { type: 'text' }> => l.type === 'text' && l.visible);
    const live = (settings.text ?? 'fonts') === 'fonts' && texts.length > 0;
    const { found, missing } = live ? await collectFonts(texts, deps.fontFile) : { found: new Map(), missing: [] as string[] };
    if (format === 'pdf') for (const [k, f] of found) if (!canEmbedInPdf(f.woff)) { found.delete(k); missing.push(f.family); } else if (isSlanted(f.italic, f.woff)) deps.notice?.(`“${f.family}” has no italic file, so the PDF shows it upright. Text as paths keeps the slant.`);
    missing.forEach((family) => deps.notice?.(`“${family}” is a system font the app cannot read, so its text keeps the font name.`));
    const svg = selection || options.mask ? await maskedSvg(renderDoc, options, ratio, settings.svg?.metadata !== false) : await docToSvg(renderDoc, pdfDeps, options, {
      ...settings.svg, text: settings.text ?? 'fonts', ...(format === 'pdf' ? { hidden: false, filters: false } : {}), fontFaces: format === 'svg' && live ? fontFaceCss(found.values()) : undefined,
    });
    signal?.throwIfAborted();
    bytes = format === 'pdf' ? await svgToPdf(svg, options.width, options.height, page, settings.print,
      [...found.values()].map((f) => ({ family: f.family, weight: f.weight, italic: f.italic, sfnt: woffToSfnt(f.woff) }))) : new Blob([svg], { type: 'image/svg+xml' });
  }
  signal?.throwIfAborted();
  const extension = bytes.type === 'image/jpeg' ? 'jpg' : format;
  const suffix = safeSuffix(settings.suffix ?? (typeof settings.size === 'number' ? autoSuffix(settings.size) : ''));
  return { name: `${base}${suffix}.${extension}`, mime: bytes.type, bytes };
}

async function maskedSvg(doc: DesignDoc, options: RasterExport, ratio = 1, metadata = true): Promise<string> {
  const { width, height } = options;
  const big = ratio === 1 ? options : { ...options, width: Math.round(width * ratio), height: Math.round(height * ratio), scale: options.scale * ratio,
    offsetX: (options.offsetX ?? 0) * ratio, offsetY: (options.offsetY ?? 0) * ratio };
  const href = await blobToDataUrl(await exportDoc(doc, 'image/png', big));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${metadata ? `<title>${xmlEscape(doc.name)}</title>` : ''}<image width="${width}" height="${height}" href="${href}"/></svg>`;
}

export async function exportPlan(doc: DesignDoc, settings: ExportSettings, target: ExportTarget, deps: SvgDeps, signal?: AbortSignal, onProgress?: (done: number, total: number) => void, filename = doc.name): Promise<ExportFile[]> {
  signal?.throwIfAborted();
  try {
    validateExport(doc, settings, target);
  } catch (error) {
    throw exportError(error, 'The export settings could not be checked, so reopen the design or choose another area.');
  }
  const base = filePrefix(settings.prefix) + fileBase(filename);
  const outputs = exportOutputs(settings);
  const files: ExportFile[] = [];
  for (const output of outputs) {
    onProgress?.(files.length, outputs.length);
    // Let the panel paint progress and handle Cancel before starting canvas or SVG work.
    if (onProgress) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    try {
      files.push(await renderOutput(doc, output, target, deps, base, signal));
    } catch (error) {
      signal?.throwIfAborted();
      throw exportError(error, `Could not prepare ${output.format.toUpperCase()}, so try a smaller size or another format.`);
    }
  }
  return uniqueNames(files);
}

export async function exportDownloadFile(filename: string, files: ExportFile[], signal?: AbortSignal): Promise<ExportFile> {
  signal?.throwIfAborted();
  if (files.length === 1) return files[0];
  files = uniqueNames(files);
  try {
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
    return { name: `${fileBase(filename)}.zip`, mime: 'application/zip', bytes: new Blob([bytes], { type: 'application/zip' }) };
  } catch (error) {
    signal?.throwIfAborted();
    throw exportError(error, 'The ZIP could not be created, so try a smaller size or a single format.');
  }
}
