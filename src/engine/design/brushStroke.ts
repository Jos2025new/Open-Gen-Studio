import { uid } from '../../lib/id';
import type { RasterLayer, RasterStroke } from '../types';
import { atPressure, simulatedPressure, tipFor, type BrushOptions } from './brushEngine';
import { paintLive, type LiveStroke } from './raster';
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

// The simulated pressure of the stroke being painted (one at a time); perfect-freehand starts a stroke at 0.5.
let simulated = 0.5;

export function newBrushStroke(brush: BrushOptions & { color: string; opacity: number }, erase: boolean): RasterStroke {
  simulated = 0.5;
  const tip = tipFor(brush, erase);
  return { id: uid('rst'), x: 0, y: 0, segments: [], color: brush.color, opacity: brush.opacity, erase, tip };
}

/** A segment in the layer's pixels, its width and density taken from the pressure. */
export function brushSegment(layer: RasterLayer, a: { x: number; y: number }, b: { x: number; y: number }, brush: BrushOptions, pressure: number): { seg: [number, number, number, number, number]; density: number } {
  const kx = layer.pxWidth / layer.width, ky = layer.pxHeight / layer.height;
  // A rotated image: the pointer is taken back into the image's own space, so the stroke lands under it.
  if (layer.transform) { const [ax, ay] = toLayerSpace(layer, a.x, a.y), [bx, by] = toLayerSpace(layer, b.x, b.y); a = { x: ax, y: ay }; b = { x: bx, y: by }; }
  if (brush.simulatePressure) pressure = simulated = simulatedPressure(simulated, Math.hypot(b.x - a.x, b.y - a.y), brush.size);
  const { width, density } = atPressure(brush, pressure);
  return { seg: [(a.x - layer.x) * kx, (a.y - layer.y) * ky, (b.x - layer.x) * kx, (b.y - layer.y) * ky, (width * (kx + ky)) / 2], density };
}

/** Record the segment in the stroke (its density too, when the tip keeps them) and paint it live. */
export function addBrushSegment(stroke: RasterStroke, live: LiveStroke, buf: HTMLCanvasElement, s: { seg: [number, number, number, number, number]; density: number }): void {
  stroke.segments.push(s.seg);
  stroke.tip?.densities?.push(s.density);
  paintLive(buf, live, { x: s.seg[0], y: s.seg[1] }, { x: s.seg[2], y: s.seg[3] }, s.seg[4], s.density);
}
