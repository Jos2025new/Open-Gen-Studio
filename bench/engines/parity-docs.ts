import { createDoc, newRasterLayer, newVectorLayer } from '../../src/engine/design/doc';
import { newFxLayer, newFxOp } from '../../src/engine/fx/commands';
import type { DesignDoc, Layer, LayerGroup, RasterLayer, RasterStroke } from '../../src/engine/types';

/*
 * Synthetic documents for the parity oracle (Paso 2). Each one exercises a feature the optimized path must keep:
 * blend modes, opacity, layer and below FX, tip strokes (hardness, multiply, keep opacity), the eraser, hidden
 * folders and vector shapes. Deterministic: fixed ids, fixed geometry, no randomness.
 */

export const PARITY_SIZE = 480;

function stroke(id: string, y: number, color: string, opts: Partial<RasterStroke> & { tipBlend?: 'normal' | 'multiply'; hardness?: number; keep?: boolean } = {}): RasterStroke {
  const segments: RasterStroke['segments'] = [];
  for (let j = 0; j < 30; j++) {
    const x = 30 + j * 14;
    segments.push([x, y + Math.sin(j / 4) * 12, x + 14, y + Math.sin((j + 1) / 4) * 12, 14]);
  }
  return {
    id, x: 0, y: 0, color, opacity: 1, erase: false, segments,
    tip: { hardness: opts.hardness ?? 1, texture: 'none', blend: opts.tipBlend ?? 'normal', ...(opts.keep ? { keepOpacity: true } : {}) },
    ...(opts.erase ? { erase: true } : {}),
  };
}

/** The raster layers keep an empty base and their strokes; the caller composes them into buffers (browser side). */
export function parityDocument(): { doc: DesignDoc; rasters: RasterLayer[] } {
  const page = { x: 0, y: 0, width: PARITY_SIZE, height: PARITY_SIZE };
  const px = { width: PARITY_SIZE, height: PARITY_SIZE };
  const raster = (id: string, name: string, strokes: RasterStroke[], groupId?: string, over: Partial<RasterLayer> = {}): RasterLayer => ({
    ...newRasterLayer(name, page, px), id, paintBaseId: `${id}-base`, paintStrokes: strokes, ...(groupId ? { groupId } : {}), ...over,
  });
  const grp = 'par-grp-hidden';
  const bottom: Layer[] = [
    { ...raster('par-bg', 'Base', [stroke('s-bg', 120, '#ff8800', { hardness: 0.4 })]), blend: 'normal' },
    { ...raster('par-mul', 'Multiply', [stroke('s-m1', 200, '#3366ff', { hardness: 0.7 }), stroke('s-m2', 260, '#ffcc00', { tipBlend: 'multiply' })]), blend: 'multiply', opacity: 0.8 },
    { ...raster('par-scr', 'Screen', [stroke('s-s1', 300, '#22dd88', { keep: true })]), blend: 'screen', opacity: 0.7 },
    { ...raster('par-ovl', 'Overlay', [stroke('s-o1', 340, '#cc3366'), stroke('s-erase', 340, '#000000', { erase: true })]), blend: 'overlay' },
    { ...raster('par-dif', 'Difference', [stroke('s-d1', 400, '#ffffff', { hardness: 0.05 })]), blend: 'difference', opacity: 0.5 },
    // A folder hidden as a whole: its layer must not appear in either path.
    { ...raster('par-hidden', 'Hidden', [stroke('s-h1', 220, '#ff0000')], grp), visible: false },
    { ...newVectorLayer('Shapes', []), id: 'par-vec', shapes: [
      { id: 'par-shp-1', type: 'rect', x: 40, y: 40, w: 160, h: 60, fill: '#ffffff', stroke: '#000000', strokeWidth: 3, radius: 6 },
      { id: 'par-shp-2', type: 'ellipse', x: 300, y: 60, w: 120, h: 90, fill: '#4488ff', stroke: null, strokeWidth: 0, radius: 0 },
    ] },
  ];
  const fx: Layer[] = [
    // Layer-scoped FX: a shadow on the Multiply layer, a glow on the Screen layer.
    { ...newFxLayer('effect', { name: 'Shadow', scope: 'layer', ops: [{ ...newFxOp('shadow', { blur: 10, x: 6, y: 6, opacity: 0.7 }), id: 'par-op-1' }] }), id: 'par-fx-shadow' },
    { ...newFxLayer('effect', { name: 'Glow', scope: 'layer', ops: [{ ...newFxOp('glow', { strength: 0.6, radius: 8 }), id: 'par-op-2' }] }), id: 'par-fx-glow' },
    // Below-scoped FX: a blur and a curve over everything under them, then a hue on top.
    { ...newFxLayer('filter', { name: 'Blur below', scope: 'below', ops: [{ ...newFxOp('blur', { radius: 2 }), id: 'par-op-3' }] }), id: 'par-fx-blur' },
    { ...newFxLayer('filter', { name: 'Curves below', scope: 'below', ops: [{ ...newFxOp('curves', { shadows: 0.2, midtones: 0.55, highlights: 0.85 }), id: 'par-op-4' }] }), id: 'par-fx-curves' },
    { ...newFxLayer('filter', { name: 'Hue', scope: 'below', ops: [{ ...newFxOp('hue', { degrees: 20 }), id: 'par-op-5' }] }), id: 'par-fx-hue' },
  ];
  // Order bottom → top: the rasters, the hidden one, the vectors, then the FX (layer FX must follow their target).
  // Give the layer FX the layer they act on: the shadow follows the Multiply layer, the glow the Screen layer.
  const reordered: Layer[] = [bottom[0], bottom[1], fx[0], bottom[2], fx[1], bottom[3], bottom[4], bottom[5], bottom[6], fx[2], fx[3], fx[4]];
  const groups: LayerGroup[] = [{ id: grp, name: 'Hidden folder' }];
  const doc: DesignDoc = { ...createDoc('Parity', PARITY_SIZE, PARITY_SIZE, '#202020'), id: 'parity-doc', groups, layers: reordered, activeLayerId: null };
  return { doc, rasters: reordered.filter((l): l is RasterLayer => l.type === 'raster') };
}
