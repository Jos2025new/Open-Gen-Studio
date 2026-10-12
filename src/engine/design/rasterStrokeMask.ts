import type { RasterStroke } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { hexRgb, segmentBox, stampSegment, type BrushTip } from './brushEngine';

import { editorCacheBudget } from './cacheBudget';

// Saved segments/tips are immutable after a stroke ends (history depends on that too). Translation only changes
// stroke.x/y, so its coverage can be reused. Coverage is kept under the editor's shared byte budget (cacheBudget.ts):
// the least recently used masks go first, and a mask larger than the budget is simply not kept.
type Mask = { canvas: HTMLCanvasElement; x: number; y: number };
type Entry = Mask & { tip: BrushTip; color: string; bytes: number; id: string };
const masks = new Map<RasterStroke['segments'], Entry>();
let serial = 0;

/** Bounds and coverage in stroke-local pixels; opacity, erase, blend and offset are applied by the compositor. */
export function rasterStrokeMask(stroke: RasterStroke, tip: BrushTip): Mask {
  const found = masks.get(stroke.segments);
  if (found) {
    if (found.tip === tip && found.color === stroke.color) { masks.delete(stroke.segments); masks.set(stroke.segments, found); editorCacheBudget.touch(found.id); return found; }
    masks.delete(stroke.segments);
    editorCacheBudget.remove(found.id);
  }
  const boxes = stroke.segments.map(segmentBox);
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const w = Math.max(...boxes.map((b) => b.x + b.w)) - x, h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
  const canvas = createCanvas(w, h), m = ctx2d(canvas), img = m.createImageData(canvas.width, canvas.height), rgb = hexRgb(stroke.color);
  stroke.segments.forEach((seg, i) => stampSegment(img, x, y, seg, tip.densities?.[i] ?? 1, tip, rgb, i ? { width: stroke.segments[i - 1][4], density: tip.densities?.[i - 1] ?? 1 } : undefined));
  m.putImageData(img, 0, 0);
  const bytes = canvas.width * canvas.height * 4;
  // Stored under the shared budget: its drop callback forgets the mask, so the next use recomputes it.
  const id = `mask:${++serial}`;
  masks.set(stroke.segments, { canvas, x, y, tip, color: stroke.color, bytes, id });
  editorCacheBudget.put(id, bytes, () => {
    for (const [segments, e] of masks) if (e.id === id) masks.delete(segments);
  });
  return { canvas, x, y };
}
