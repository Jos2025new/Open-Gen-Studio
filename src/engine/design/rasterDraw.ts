import { createCanvas, ctx2d } from '../../lib/media';
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
 * blend; Keep Opacity then keeps the canvas's alpha as it was before the stroke. `before` is the pre-stroke canvas,
 * read at (dx + bx, dy + by).
 */
export function layMask(ctx: CanvasRenderingContext2D, mask: HTMLCanvasElement, sx: number, sy: number, dx: number, dy: number, w: number, h: number, tip: BrushTip | undefined, opacity: number, erase: boolean, before?: HTMLCanvasElement, bx = 0, by = 0): void {
  const keep = tip?.keepOpacity && !erase;
  // The pixels under the stroke before it lands, for Keep Opacity (the live stroke passes its base).
  let base = before, sxb = dx + bx, syb = dy + by;
  if (keep && !base) {
    base = createCanvas(w, h);
    ctx2d(base).drawImage(ctx.canvas, dx, dy, w, h, 0, 0, w, h);
    sxb = 0; syb = 0;
  }
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = compositeOp(tip, erase);
  ctx.drawImage(mask, sx, sy, w, h, dx, dy, w, h);
  if (keep && base) {
    // destination-in clears outside what it draws: kept to the stroke's region.
    ctx.beginPath();
    ctx.rect(dx, dy, w, h);
    ctx.clip();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(base, sxb, syb, w, h, dx, dy, w, h);
  }
  ctx.restore();
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
