import type { RasterStroke } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { hexRgb, segmentBox, stampSegment, type BrushTip } from './brushEngine';

// Saved segments/tips are immutable after a stroke ends (history depends on that too). Translation only changes
// stroke.x/y, so its coverage can be reused. Keep an LRU bounded by pixels, rather than retaining every stroke ever seen.
const MAX_PIXELS = 16_000_000;
type Mask = { canvas: HTMLCanvasElement; x: number; y: number };
type Entry = Mask & { tip: BrushTip; color: string; pixels: number };
const masks = new Map<RasterStroke['segments'], Entry>();
let pixels = 0;

/** Bounds and coverage in stroke-local pixels; opacity, erase, blend and offset are applied by the compositor. */
export function rasterStrokeMask(stroke: RasterStroke, tip: BrushTip): Mask {
  const found = masks.get(stroke.segments);
  if (found) {
    masks.delete(stroke.segments);
    if (found.tip === tip && found.color === stroke.color) { masks.set(stroke.segments, found); return found; }
    pixels -= found.pixels;
  }
  const boxes = stroke.segments.map(segmentBox);
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const w = Math.max(...boxes.map((b) => b.x + b.w)) - x, h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
  const canvas = createCanvas(w, h), m = ctx2d(canvas), img = m.createImageData(canvas.width, canvas.height), rgb = hexRgb(stroke.color);
  stroke.segments.forEach((seg, i) => stampSegment(img, x, y, seg, tip.densities?.[i] ?? 1, tip, rgb, i ? { width: stroke.segments[i - 1][4], density: tip.densities?.[i - 1] ?? 1 } : undefined));
  m.putImageData(img, 0, 0);
  const size = canvas.width * canvas.height;
  if (size <= MAX_PIXELS) {
    // Budget in pixels only: a layer of hundreds of strokes keeps every mask it moves through (a count limit below
    // that number makes each frame rebuild them all: a cyclic walk never hits an LRU).
    while (masks.size && pixels + size > MAX_PIXELS) {
      const key = masks.keys().next().value!;
      pixels -= masks.get(key)!.pixels; masks.delete(key);
    }
    masks.set(stroke.segments, { canvas, x, y, tip, color: stroke.color, pixels: size }); pixels += size;
  }
  return { canvas, x, y };
}
