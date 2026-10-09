import { uid } from '../../lib/id';
import type { RasterLayer, RasterStroke } from '../types';
import { atPressure, tipFor, type BrushOptions } from './brushEngine';
import { paintLive, type LiveStroke } from './raster';
import { toLayerSpace } from './render';

/* A brush or eraser stroke on a raster layer: what the canvas records as the pointer moves (Stage.tsx). */

/** Pen pressure (0–1); a mouse or a finger paints at full pressure, so the minimum size never applies to them. */
export const penPressure = (e: { pointerType: string; pressure: number }) => (e.pointerType === 'pen' ? e.pressure || 0.5 : 1);

export function newBrushStroke(brush: BrushOptions & { color: string; opacity: number }, erase: boolean): RasterStroke {
  const tip = tipFor(brush, erase);
  return { id: uid('rst'), x: 0, y: 0, segments: [], color: brush.color, opacity: brush.opacity, erase, tip };
}

/** A segment in the layer's pixels, its width and density taken from the pressure. */
export function brushSegment(layer: RasterLayer, a: { x: number; y: number }, b: { x: number; y: number }, brush: BrushOptions, pressure: number): { seg: [number, number, number, number, number]; density: number } {
  const kx = layer.pxWidth / layer.width, ky = layer.pxHeight / layer.height;
  // A rotated image: the pointer is taken back into the image's own space, so the stroke lands under it.
  if (layer.transform) { const [ax, ay] = toLayerSpace(layer, a.x, a.y), [bx, by] = toLayerSpace(layer, b.x, b.y); a = { x: ax, y: ay }; b = { x: bx, y: by }; }
  const { width, density } = atPressure(brush, pressure);
  return { seg: [(a.x - layer.x) * kx, (a.y - layer.y) * ky, (b.x - layer.x) * kx, (b.y - layer.y) * ky, (width * (kx + ky)) / 2], density };
}

/** Record the segment in the stroke (its density too, when the tip keeps them) and paint it live. */
export function addBrushSegment(stroke: RasterStroke, live: LiveStroke, buf: HTMLCanvasElement, s: { seg: [number, number, number, number, number]; density: number }): void {
  stroke.segments.push(s.seg);
  stroke.tip?.densities?.push(s.density);
  paintLive(buf, live, { x: s.seg[0], y: s.seg[1] }, { x: s.seg[2], y: s.seg[3] }, s.seg[4], s.density);
}
