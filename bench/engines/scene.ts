import { professionalDocument, PROFESSIONAL_IDS, PROFESSIONAL_SIZE } from '../../src/lib/designerBenchProfessional';
import { drawRasterStroke } from '../../src/engine/design/raster';
import { moveRasterStroke } from '../../src/engine/design/rasterStrokes';
import { translateLayer } from '../../src/engine/design/doc';
import type { DesignDoc, Layer, RasterLayer, RasterStroke } from '../../src/engine/types';
import { splitRasterLimit } from './limit';

/*
 * The shared model of the engine comparison. All engines read the same document: raster layers keep a flattened base
 * (the strokes before the limit, drawn once by OGS's drawRasterStroke) and their editable strokes in paintStrokes.
 * Gestures are plain functions over this model; each engine draws what the model says.
 */

export interface Scene { doc: DesignDoc; bases: Map<string, HTMLCanvasElement> }

function blankCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = PROFESSIONAL_SIZE; c.height = PROFESSIONAL_SIZE;
  return c;
}

export function buildScene(): Scene {
  const { doc } = professionalDocument();
  const bases = new Map<string, HTMLCanvasElement>();
  const layers: Layer[] = doc.layers.map((l) => {
    if (l.type !== 'raster') return l;
    const { flat, editable } = splitRasterLimit(l.paintStrokes ?? []);
    const base = blankCanvas(), ctx = base.getContext('2d')!;
    for (const s of flat) drawRasterStroke(ctx, s);
    bases.set(l.id, base);
    return { ...l, paintBaseId: `${l.id}-base`, paintStrokes: editable };
  });
  return { doc: { ...doc, layers }, bases };
}

export function replaceLayer(doc: DesignDoc, id: string, fn: (l: Layer) => Layer): DesignDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? fn(l) : l)) };
}

/** Appends a stroke made of `points` (page px) to a raster layer; the tip is the document's usual soft-hard mix. */
export function addStroke(doc: DesignDoc, layerId: string, points: Array<[number, number]>, id: string): DesignDoc {
  const segments: RasterStroke['segments'] = [];
  for (let i = 1; i < points.length; i++) segments.push([points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], 6]);
  const stroke: RasterStroke = { id, x: 0, y: 0, color: '#ff5a36', opacity: 0.9, erase: false, segments, tip: { hardness: 0.7, texture: 'none', blend: 'normal' } };
  return replaceLayer(doc, layerId, (l) => ({ ...(l as RasterLayer), paintStrokes: [...((l as RasterLayer).paintStrokes ?? []), stroke] }));
}

export function moveEditableStroke(doc: DesignDoc, layerId: string, strokeId: string, dx: number, dy: number): DesignDoc {
  return replaceLayer(doc, layerId, (l) => moveRasterStroke(l as RasterLayer, strokeId, dx, dy));
}

export function moveWholeLayer(doc: DesignDoc, layerId: string, dx: number, dy: number): DesignDoc {
  return replaceLayer(doc, layerId, (l) => translateLayer(l, dx, dy));
}

export function setFolderVisible(doc: DesignDoc, groupId: string, visible: boolean): DesignDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.groupId === groupId ? { ...l, visible } : l)) };
}

/** A below-scoped FX op parameter changes (the layers panel's command, applied directly). */
export function setFxParam(doc: DesignDoc, fxId: string, opId: string, key: string, value: number): DesignDoc {
  return replaceLayer(doc, fxId, (l) => {
    const fx = l as Extract<Layer, { type: 'fx' }>;
    return { ...fx, ops: fx.ops.map((o) => (o.id === opId ? { ...o, params: { ...o.params, [key]: value } } : o)) } as Layer;
  });
}

export const GESTURE_IDS = {
  paintLayer: PROFESSIONAL_IDS.paintLayer,
  limitedLayer: PROFESSIONAL_IDS.longLayer,
  wholeLayer: PROFESSIONAL_IDS.wholeLayer,
  folder: PROFESSIONAL_IDS.folderPersonajes,
  curvesFx: PROFESSIONAL_IDS.curvesFx,
  curvesOp: `${PROFESSIONAL_IDS.curvesFx}-op`,
};
