import { uid } from '../../lib/id';
import type { RasterLayer, RasterStroke } from '../types';
import { atPressure, simulatedPressure, taperAt, tipFor, type BrushOptions } from './brushEngine';
import { paintLive, repaintLive, type LiveStroke } from './raster';
import { toLayerSpace } from './render';

/* A brush or eraser stroke on a raster layer: what the canvas records as the pointer moves (Stage.tsx). */

/** The last input the brush read: what the settings show, so a missing pen pressure is visible, not silent. */
export interface PressureReading { device: string; pressure: number | null }
let lastReading: PressureReading | null = null;
const readers = new Set<() => void>();
export const lastPressure = () => lastReading;
export function onPressure(fn: () => void): () => void { readers.add(fn); return () => readers.delete(fn); }

/**
 * Pressure (0–1) when the device reports one: a pen, or any pointer whose pressure is not the fixed values a mouse
 * sends (0.5 pressed, 0 released). Some tablets reach the browser as a "mouse" with real pressure (Linux). Without
 * pressure the brush paints at full size and density.
 */
export function penPressure(e: { pointerType: string; pressure: number }): number {
  const real = e.pressure > 0 && (e.pointerType === 'pen' || e.pressure !== 0.5);
  const reading = { device: e.pointerType || 'mouse', pressure: real ? e.pressure : null };
  if (reading.device !== lastReading?.device || (reading.pressure === null) !== (lastReading?.pressure === null) || Math.abs((reading.pressure ?? 0) - (lastReading?.pressure ?? 0)) > 0.02) {
    lastReading = reading;
    readers.forEach((fn) => fn());
  }
  return real ? e.pressure : 1;
}

// The stroke being painted (one at a time): its simulated pressure (perfect-freehand starts at 0.5) and how far
// it has gone, for the start taper.
let simulated = 0.5;
let travelled = 0;

export function newBrushStroke(brush: BrushOptions & { color: string; opacity: number }, erase: boolean): RasterStroke {
  simulated = 0.5;
  travelled = 0;
  const tip = tipFor(brush, erase);
  return { id: uid('rst'), x: 0, y: 0, segments: [], color: brush.color, opacity: brush.opacity, erase, tip };
}

type Seg = [number, number, number, number, number];
/** A segment in the layer's pixels, its width and density taken from the pressure; with mirror, its reflection too. */
export function brushSegment(layer: RasterLayer, a: { x: number; y: number }, b: { x: number; y: number }, brush: BrushOptions, pressure: number, pageWidth?: number): { seg: Seg; density: number; mirror?: Seg } {
  const one = brushSegmentOnly(layer, a, b, brush, pressure);
  if (!brush.mirror || !pageWidth) return one;
  // The reflection has the same width and density; it does not count again toward the start taper.
  const m = segmentIn(layer, { x: pageWidth - a.x, y: a.y }, { x: pageWidth - b.x, y: b.y });
  return { ...one, mirror: [...m, one.seg[4]] };
}

function segmentIn(layer: RasterLayer, a: { x: number; y: number }, b: { x: number; y: number }): [number, number, number, number] {
  const kx = layer.pxWidth / layer.width, ky = layer.pxHeight / layer.height;
  if (layer.transform) { const [ax, ay] = toLayerSpace(layer, a.x, a.y), [bx, by] = toLayerSpace(layer, b.x, b.y); a = { x: ax, y: ay }; b = { x: bx, y: by }; }
  return [(a.x - layer.x) * kx, (a.y - layer.y) * ky, (b.x - layer.x) * kx, (b.y - layer.y) * ky];
}

function brushSegmentOnly(layer: RasterLayer, a: { x: number; y: number }, b: { x: number; y: number }, brush: BrushOptions, pressure: number): { seg: Seg; density: number } {
  const kx = layer.pxWidth / layer.width, ky = layer.pxHeight / layer.height;
  // A rotated image: the pointer is taken back into the image's own space, so the stroke lands under it.
  if (layer.transform) { const [ax, ay] = toLayerSpace(layer, a.x, a.y), [bx, by] = toLayerSpace(layer, b.x, b.y); a = { x: ax, y: ay }; b = { x: bx, y: by }; }
  const step = Math.hypot(b.x - a.x, b.y - a.y);
  travelled += step;
  if (brush.simulatePressure) pressure = simulated = simulatedPressure(simulated, step, brush.size);
  // The start taper: the first touch is a point, and the width opens over Taper start (then pressure shapes it).
  const { width, density } = atPressure(brush, pressure), w = width * taperAt(travelled, brush.taperStart, 'start');
  return { seg: [(a.x - layer.x) * kx, (a.y - layer.y) * ky, (b.x - layer.x) * kx, (b.y - layer.y) * ky, (w * (kx + ky)) / 2], density };
}

/** Record the segment in the stroke (its density too, when the tip keeps them) and paint it live. */
export function addBrushSegment(stroke: RasterStroke, live: LiveStroke, buf: HTMLCanvasElement, s: { seg: Seg; density: number; mirror?: Seg }): void {
  for (const seg of s.mirror ? [s.seg, s.mirror] : [s.seg]) {
    stroke.segments.push(seg);
    stroke.tip?.densities?.push(s.density);
    paintLive(buf, live, { x: seg[0], y: seg[1] }, { x: seg[2], y: seg[3] }, seg[4], s.density);
  }
}

/**
 * The end taper, when the pointer lifts (only then is the end known): the last Taper end of the stroke closes to a
 * point, and that part is painted again. The saved widths are the tapered ones, so the replay matches.
 */
export function endBrushStroke(stroke: RasterStroke, live: LiveStroke, buf: HTMLCanvasElement, layer: RasterLayer, brush: BrushOptions): void {
  const length = (brush.taperEnd ?? 0) * (layer.pxWidth / layer.width + layer.pxHeight / layer.height) / 2, segs = stroke.segments;
  if (!(length > 0) || !segs.length) return;
  const before = segs.map((s) => s.slice() as typeof s);
  // With mirror the segments come in pairs (stroke, reflection): both get the same share; the length counts once.
  const step = stroke.tip?.mirror ? 2 : 1;
  let i = segs.length - 1;
  for (let fromEnd = 0; i >= 0 && fromEnd < length; i -= step) {
    const k = taperAt(fromEnd, length, 'end');
    for (let j = i; j > i - step && j >= 0; j--) segs[j][4] *= k;
    fromEnd += Math.hypot(segs[i][2] - segs[i][0], segs[i][3] - segs[i][1]);
  }
  repaintLive(buf, live, before.slice(i + 1), segs, stroke.tip?.densities);
}
