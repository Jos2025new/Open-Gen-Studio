import type { DesignDoc, Layer, LayerGroup, ShapeSpec } from '../../types';
import { uid } from '../../../lib/id';
import { pinPaintMode } from '../paintMode';
import { createDoc, newRasterLayer, newVectorLayer } from '../doc';
import { sanitizeSvg } from './sanitize';
import { walkSvg, type Folder, type Item, type RasterItem } from './structure';
import { defaultRasterizer, type Rasterizer } from './rasterize';

/*
 * Import an Inkscape (or any) SVG as a document: folders for groups and layers, editable shapes where the model
 * can hold them, raster layers for the rest. See docs/inkscape-importacion.md.
 */

export interface ImportReport {
  editable: number;
  rasterized: number;
  /** Why elements were rasterized: gradient, text, clip-path… → count. */
  reasons: Record<string, number>;
  /** What the sanitizer removed (script, external href…) → count. */
  removed: Record<string, number>;
  warnings: string[];
}
export interface SvgImport { doc: DesignDoc; buffers: Map<string, HTMLCanvasElement>; report: ImportReport }

/** «12 editable, 5 rasterized (gradient ×2, text ×3)», plus what was removed or skipped. */
export function describeReport(r: ImportReport): string {
  const why = Object.entries(r.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ');
  const removed = Object.entries(r.removed).map(([k, v]) => `${k} ×${v}`).join(', ');
  return `${r.editable} editable, ${r.rasterized} rasterized${why ? ` (${why})` : ''}.${removed ? ` Removed for safety: ${removed}.` : ''}${r.warnings.length ? ` ${r.warnings.join('. ')}.` : ''}`;
}

const folderPath = (f: Folder): string => (f.parent ? `${folderPath(f.parent)} / ${f.name}` : f.name);

/** Parse, sanitize, walk and rasterize; the document is built here but not stored. */
export async function importSvg(text: string, name: string, rasterizer: Rasterizer = defaultRasterizer): Promise<SvgImport | { error: string }> {
  const clean = sanitizeSvg(text);
  if ('error' in clean) return clean;
  const walked = walkSvg(clean.root);
  const report: ImportReport = { editable: 0, rasterized: 0, reasons: {}, removed: clean.stats, warnings: [...walked.warnings] };
  const doc = createDoc(name, walked.width, walked.height, null);
  const layers: Layer[] = [], groups: LayerGroup[] = [], buffers = new Map<string, HTMLCanvasElement>();
  const runs = new Map<number, number>(), used = new Map<string, number>();
  let last: Folder | null = null, pending: { items: Extract<Item, { kind: 'shape' }>[] } | null = null, groupId: string | undefined;

  const unique = (base: string) => { const n = (used.get(base) ?? 0) + 1; used.set(base, n); return n === 1 ? base : `${base} ${n}`; };
  const enter = (f: Folder | null) => {
    if (f === last) return;
    last = f;
    if (!f) { groupId = undefined; return; }
    // A folder interrupted by another one comes back as a second folder, so each folder stays one run of layers.
    const n = (runs.get(f.id) ?? 0) + 1;
    runs.set(f.id, n);
    const g: LayerGroup = { id: uid('grp'), name: n === 1 ? folderPath(f) : `${folderPath(f)} (${n})` };
    groups.push(g);
    groupId = g.id;
  };
  const flush = () => {
    if (!pending) return;
    const first = pending.items[0];
    const nameOf = pending.items.length === 1 && first.label ? first.label : first.folder ? first.folder.name : 'Shapes';
    const layer = newVectorLayer(unique(nameOf), pending.items.map((i) => i.shape as ShapeSpec));
    layers.push({ ...layer, groupId, visible: !first.hidden, locked: first.locked, opacity: first.opacity, blend: first.blend });
    report.editable += pending.items.length;
    pending = null;
  };
  const sameLayer = (a: Extract<Item, { kind: 'shape' }>, b: Extract<Item, { kind: 'shape' }>) => a.folder === b.folder && a.hidden === b.hidden && a.locked === b.locked && a.opacity === b.opacity && a.blend === b.blend;

  const rasters = new Map<RasterItem, Awaited<ReturnType<Rasterizer>>>();
  for (const item of walked.items) if (item.kind === 'raster') rasters.set(item, await rasterizer(item, walked));

  for (const item of walked.items) {
    if (item.kind === 'shape') {
      if (pending && !sameLayer(pending.items[0], item)) flush();
      if (!pending) { enter(item.folder); pending = { items: [] }; }
      pending.items.push(item);
      continue;
    }
    flush();
    const r = rasters.get(item);
    if (!r) { report.warnings.push(`${item.reasons[0]} element could not be drawn and was skipped`); continue; }
    enter(item.folder);
    const base = item.label ?? (item.reasons[0] === 'text' ? 'Text' : item.reasons[0][0].toUpperCase() + item.reasons[0].slice(1));
    const layer = newRasterLayer(unique(base), { x: r.box.x, y: r.box.y, width: r.box.w, height: r.box.h }, { width: r.canvas.width, height: r.canvas.height });
    layers.push({ ...layer, groupId, visible: !item.hidden, locked: item.locked, opacity: item.opacity, blend: item.blend });
    buffers.set(layer.id, r.canvas);
    report.rasterized++;
    for (const k of item.reasons) report.reasons[k] = (report.reasons[k] ?? 0) + 1;
  }
  flush();
  return { doc: { ...pinPaintMode({ ...doc, paintMode: undefined, layers }), layers, groups, activeLayerId: layers.length ? layers[layers.length - 1].id : null }, buffers, report };
}
