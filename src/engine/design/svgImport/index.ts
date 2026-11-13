import type { DesignDoc, Layer, LayerGroup, ObjectGroup, ShapeSpec, VectorLayer } from '../../types';
import { uid } from '../../../lib/id';
import { pinPaintMode } from '../paintMode';
import { normalizeObjectTree } from '../objectTreeNormalize';
import { createDoc, newRasterLayer, newVectorLayer } from '../doc';
import { sanitizeSvg } from './sanitize';
import { walkSvg, type Item, type Own, type Place, type RasterItem } from './structure';
import { defaultRasterizer, type Rasterizer } from './rasterize';
import { unsafeUseExpansion } from './useBudget';

/** Elements that <use> may produce in one import (a legit icon sheet stays far below). */
export const MAX_USE_ELEMENTS = 100_000;

/*
 * Import an SVG as a document, in the model the export writes: its layers are layers, its groups are object groups
 * inside them, editable shapes where the model can hold them, raster layers for the rest. See docs/inkscape-importacion.md.
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

type ShapeItem = Extract<Item, { kind: 'shape' }>;
const top = (p: Place): Place => (p.parent?.name != null ? top(p.parent) : p);
const whole = (i: Exclude<Item, { kind: 'empty-layer' }>, k: 'hidden' | 'locked') => i.place[k] || i[k] || i.groups.some((g) => g[k]);

/**
 * One vector layer from consecutive shapes of one SVG layer: its groups become object groups with their name, state,
 * opacity and blend; each shape keeps its name and its own hidden and lock. A shape's own opacity goes to its fill or
 * stroke when it has only one of them (the same picture); otherwise, and for a blend of its own, it gets a group of one.
 */
function vectorLayer(name: string, items: ShapeItem[]): VectorLayer {
  const ids = new Map<number, string>(), groups: ObjectGroup[] = [];
  const look = (o: Own): Partial<ObjectGroup> => ({ ...(o.hidden ? { hidden: true } : {}), ...(o.locked ? { locked: true } : {}), ...(o.opacity < 1 ? { opacity: o.opacity } : {}), ...(o.blend !== 'normal' ? { blend: o.blend } : {}) });
  const layer = newVectorLayer(name, items.map((i) => {
    let parentId: string | undefined;
    for (const g of i.groups) {
      if (!ids.has(g.id)) { ids.set(g.id, uid('og')); groups.push({ id: ids.get(g.id)!, name: g.name, parentId, ...look(g) }); }
      parentId = ids.get(g.id);
    }
    const s = i.shape, paints = +(!!s.fill || !!s.fillGradient) + +((!!s.stroke || !!s.strokeGradient) && s.strokeWidth > 0);
    const fold = i.blend === 'normal' && i.opacity < 1 && paints <= 1;
    if (!fold && (i.opacity < 1 || i.blend !== 'normal')) { const id = uid('og'); groups.push({ id, name: i.label ?? 'Group', parentId, ...look({ ...i, hidden: false, locked: false }) }); parentId = id; }
    return {
      ...s, ...(fold ? { fillOpacity: (s.fillOpacity ?? 1) * i.opacity, strokeOpacity: (s.strokeOpacity ?? 1) * i.opacity } : {}),
      ...(parentId ? { groupId: parentId } : {}), ...(i.label ? { name: i.label } : {}), ...(i.hidden ? { hidden: true } : {}), ...(i.locked ? { locked: true } : {}),
    } as ShapeSpec;
  }));
  const p = items[0].place;
  return normalizeObjectTree({ ...layer, visible: !p.hidden, locked: p.locked, opacity: p.opacity, blend: p.blend, ...(groups.length ? { objectGroups: groups } : {}) });
}

/** Parse, sanitize, walk and rasterize; the document is built here but not stored. */
export async function importSvg(text: string, name: string, rasterizer: Rasterizer = defaultRasterizer): Promise<SvgImport | { error: string }> {
  const clean = sanitizeSvg(text);
  if ('error' in clean) return clean;
  // Bound what <use> can produce before walking: counted in produced elements (memoized per referenced element), so
  // a big group referenced many times cannot blow up even when nothing is rasterized (D69).
  if (unsafeUseExpansion(clean.root, MAX_USE_ELEMENTS, 0)) return { error: 'SVG use expansion limit reached; import stopped.' };
  const walked = walkSvg(clean.root);
  if (walked.items.some((item) => item.kind === 'raster') && (walked.warnings.includes('use expansion limit reached; content skipped') || unsafeUseExpansion(clean.root))) {
    return { error: 'SVG use expansion limit reached; import stopped before rasterizing.' };
  }
  const report: ImportReport = { editable: 0, rasterized: 0, reasons: {}, removed: clean.stats, warnings: [...walked.warnings] };
  const doc = createDoc(name, walked.width, walked.height, null);
  const layers: Layer[] = [], places: Place[] = [], buffers = new Map<string, HTMLCanvasElement>(), used = new Map<string, number>();
  let pending: ShapeItem[] = [];

  const unique = (base: string) => { const n = (used.get(base) ?? 0) + 1; used.set(base, n); return n === 1 ? base : `${base} ${n}`; };
  const sub = new Set<Layer>();
  const add = (layer: Layer, place: Place) => { layers.push(layer); places.push(top(place)); if (top(place) !== place) sub.add(layer); };
  const flush = () => {
    if (!pending.length) return;
    add(vectorLayer(unique(pending[0].place.name ?? 'Shapes'), pending), pending[0].place);
    report.editable += pending.length;
    pending = [];
  };

  const rasters = new Map<RasterItem, Awaited<ReturnType<Rasterizer>>>();
  for (const item of walked.items) if (item.kind === 'raster') rasters.set(item, await rasterizer(item, walked));

  for (const item of walked.items) {
    if (item.kind === 'empty-layer') {
      flush();
      const p = item.place;
      add({ ...newVectorLayer(unique(p.name ?? 'Layer'), []), visible: !p.hidden, locked: p.locked, opacity: p.opacity, blend: p.blend }, p);
      continue;
    }
    if (item.kind === 'shape') {
      if (pending.length && pending[0].place !== item.place) flush();
      pending.push(item);
      continue;
    }
    flush();
    const r = rasters.get(item);
    if (!r) { report.warnings.push(`${item.reasons[0]} element could not be drawn and was skipped`); continue; }
    const base = item.label ?? (item.reasons[0] === 'text' ? 'Text' : item.reasons[0][0].toUpperCase() + item.reasons[0].slice(1));
    const layer = newRasterLayer(unique(base), { x: r.box.x, y: r.box.y, width: r.box.w, height: r.box.h }, { width: r.canvas.width, height: r.canvas.height });
    // A picture cannot sit inside an object group: it takes what the groups above it set.
    const blend = item.blend !== 'normal' ? item.blend : [...item.groups].reverse().find((g) => g.blend !== 'normal')?.blend ?? item.place.blend;
    add({ ...layer, visible: !whole(item, 'hidden'), locked: whole(item, 'locked'), opacity: item.groups.reduce((o, g) => o * g.opacity, item.place.opacity), blend }, item.place);
    buffers.set(layer.id, r.canvas);
    report.rasterized++;
    for (const k of item.reasons) report.reasons[k] = (report.reasons[k] ?? 0) + 1;
  }
  flush();
  // An SVG layer that came out as several layers (pictures between its shapes) or that holds sublayers is a folder with its name.
  const groups: LayerGroup[] = [];
  const folders = new Map<Place, string>();
  places.forEach((p, i) => {
    if (p.name === null || (places.filter((x) => x === p).length < 2 && !sub.has(layers[i]))) return;
    if (!folders.has(p)) { const g: LayerGroup = { id: uid('grp'), name: p.name }; groups.push(g); folders.set(p, g.id); }
    layers[i] = { ...layers[i], groupId: folders.get(p) };
  });
  return { doc: { ...pinPaintMode({ ...doc, paintMode: undefined, layers }), layers, groups, activeLayerId: layers.length ? layers[layers.length - 1].id : null }, buffers, report };
}
