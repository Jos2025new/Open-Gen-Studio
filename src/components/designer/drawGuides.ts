import type { DesignDoc } from '../../engine/types';
import type { GuideAxis } from '../../engine/design/guides';

/** Ruler guides across the whole view; the one being dragged is skipped and shown dashed at its preview position. */
export function drawGuides(ctx: CanvasRenderingContext2D, guides: DesignDoc['guides'], preview: { axis: GuideAxis; index?: number; at: number } | null | undefined, sx: (v: number) => number, sy: (v: number) => number, size: { w: number; h: number }): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#2fb8ff';
  const line = (axis: GuideAxis, at: number) => {
    ctx.beginPath();
    if (axis === 'x') { const x = Math.round(sx(at)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, size.h); }
    else { const y = Math.round(sy(at)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(size.w, y); }
    ctx.stroke();
  };
  for (const axis of ['x', 'y'] as const) (guides?.[axis] ?? []).forEach((at, i) => { if (!(preview?.axis === axis && preview.index === i)) line(axis, at); });
  if (preview) { ctx.setLineDash([5, 4]); line(preview.axis, preview.at); }
  ctx.restore();
}
