import { ctx2d } from '../../lib/media';
import type { RasterStroke } from '../types';
import { compositeOp, type BrushTip } from './brushEngine';
import { rasterStrokeMask } from './rasterStrokeMask';

/* Drawing a saved stroke onto a canvas, and one plain segment: the same code paints live and replays strokes. */

/**
 * Replay a saved stroke. Contiguous segments of the same width are one path, stroked once: with an opacity below
 * 100 % the overlapping round ends of separate segments would add up into beads along the line. `ox, oy` is the
 * place of the canvas in the full buffer: strokes are drawn in full-buffer pixels.
 */
export function drawRasterStroke(ctx: CanvasRenderingContext2D, stroke: RasterStroke, ox = 0, oy = 0): void {
  if (stroke.tip) return drawTipStroke(ctx, stroke, stroke.tip, ox, oy);
  const segs = stroke.segments;
  let i = 0;
  while (i < segs.length) {
    const width = segs[i][4];
    ctx.save();
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    ctx.globalAlpha = stroke.opacity;
    ctx.strokeStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(segs[i][0] + stroke.x - ox, segs[i][1] + stroke.y - oy);
    let j = i;
    for (; j < segs.length && segs[j][4] === width && (j === i || (segs[j][0] === segs[j - 1][2] && segs[j][1] === segs[j - 1][3])); j++) {
      // A tiny offset so a click without movement still leaves a dot.
      ctx.lineTo(segs[j][2] + stroke.x - ox + (j === i ? 0.01 : 0), segs[j][3] + stroke.y - oy);
    }
    ctx.stroke();
    ctx.restore();
    i = j;
  }
}

/** A stroke with a brush tip (brushEngine.ts): its mask built the same way as while it was painted, laid once. */
function drawTipStroke(ctx: CanvasRenderingContext2D, stroke: RasterStroke, tip: BrushTip, ox: number, oy: number): void {
  if (!stroke.segments.length) return;
  const { canvas: mask, x, y } = rasterStrokeMask(stroke, tip);
  layMask(ctx, mask, 0, 0, x + stroke.x - ox, y + stroke.y - oy, mask.width, mask.height, tip, stroke.opacity, stroke.erase);
}

/**
 * The mask laid on the canvas region (dx, dy, w, h) from (sx, sy) in the mask: at the stroke's opacity, with its
 * blend. Keep Opacity is an alpha lock: the paint changes colour only, each pixel keeps the alpha it had before the
 * stroke. `before` is the pre-stroke canvas, read at (dx + bx, dy + by).
 */
export function layMask(ctx: CanvasRenderingContext2D, mask: HTMLCanvasElement, sx: number, sy: number, dx: number, dy: number, w: number, h: number, tip: BrushTip | undefined, opacity: number, erase: boolean, before?: HTMLCanvasElement, bx = 0, by = 0): void {
  const keep = tip?.keepOpacity && !erase, op = compositeOp(tip, erase);
  const locked = keep && op !== 'source-over' && w > 0 && h > 0;
  // A blend mode cannot be combined with source-atop: blend, then put back the alpha from before the stroke.
  const base = !locked ? null : before ? ctx2d(before).getImageData(dx + bx, dy + by, w, h) : ctx.getImageData(dx, dy, w, h);
  ctx.save();
  ctx.globalAlpha = opacity;
  // Normal paint: source-atop leaves the destination's alpha as it was, on the GPU.
  ctx.globalCompositeOperation = keep && op === 'source-over' ? 'source-atop' : op;
  ctx.drawImage(mask, sx, sy, w, h, dx, dy, w, h);
  ctx.restore();
  if (!base) return;
  const painted = ctx.getImageData(dx, dy, w, h);
  lockAlpha(painted.data, base.data);
  ctx.putImageData(painted, dx, dy);
}

/** The painted pixels with the alpha of `base` (straight RGBA, as ImageData holds it): an exact alpha lock. */
export function lockAlpha(painted: Uint8ClampedArray, base: Uint8ClampedArray): void {
  for (let i = 3; i < painted.length; i += 4) painted[i] = base[i];
}

/** One brush or eraser segment in canvas pixels (shared by the Designer and the sketch editor). */
export function strokeSegment(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  opts: { width: number; color: string; opacity: number; erase: boolean },
): void {
  ctx.save();
  ctx.globalCompositeOperation = opts.erase ? 'destination-out' : 'source-over';
  ctx.globalAlpha = opts.opacity;
  ctx.strokeStyle = opts.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = opts.width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  // A tiny offset so a click without movement still leaves a dot.
  ctx.lineTo(b.x + 0.01, b.y);
  ctx.stroke();
  ctx.restore();
}
