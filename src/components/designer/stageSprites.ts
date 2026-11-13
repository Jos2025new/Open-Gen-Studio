/* Canvas sprites the Stage paints: the transform arrows of a selection and the transparency checkerboard.
   Pure drawing, moved out of Stage.tsx to keep it under its size limit (no behaviour change). */

export function drawArrowHandle(ctx: CanvasRenderingContext2D, h: { op: string; fx: number; fy: number }, x: number, y: number, color = '#0a0a0b'): void {
  // One closed block-arrow outline (shaft and both heads), filled dark over a 1 px light rim: reads on any fill.
  const SW = 1.6, HW = 4.6, HL = 5;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  if (h.op === 'rotate') {
    const out = Math.atan2(h.fy, h.fx);
    const cx = x - Math.cos(out) * 2, cy = y - Math.sin(out) * 2, r = 12;
    const a0 = out - 0.8, a1 = out + 0.8, hb = HL / r;
    const P = (rad: number, a: number) => [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad] as const;
    ctx.arc(cx, cy, r + SW, a0 + hb, a1 - hb);
    ctx.lineTo(...P(r + HW, a1 - hb)); ctx.lineTo(...P(r, a1)); ctx.lineTo(...P(r - HW, a1 - hb));
    ctx.arc(cx, cy, r - SW, a1 - hb, a0 + hb, true);
    ctx.lineTo(...P(r - HW, a0 + hb)); ctx.lineTo(...P(r, a0)); ctx.lineTo(...P(r + HW, a0 + hb));
  } else {
    let ux: number, uy: number, ox: number, oy: number;
    if (h.op === 'scale') {
      // Pointing out of the box (diagonal at corners), just outside it.
      const len = Math.hypot(h.fx, h.fy) || 1; ux = h.fx / len; uy = h.fy / len;
      ox = x + ux * 9; oy = y + uy * 9;
    } else {
      // Skew: along the side, just outside it.
      const horizontal = h.fy !== 0;
      ux = horizontal ? 1 : 0; uy = horizontal ? 0 : 1;
      ox = x + (horizontal ? 0 : h.fx * 9); oy = y + (horizontal ? h.fy * 9 : 0);
    }
    const D = 8, B = D - HL, nx = -uy, ny = ux;
    const pts: [number, number][] = [[D, 0], [B, HW], [B, SW], [-B, SW], [-B, HW], [-D, 0], [-B, -HW], [-B, -SW], [B, -SW], [B, -HW]];
    pts.forEach(([a, b], i) => { const px = ox + ux * a + nx * b, py = oy + uy * a + ny * b; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
  }
  ctx.closePath();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

let tile: HTMLCanvasElement | null = null;
/** The transparency checkerboard: two 12 px cells of each tone. */
export function checkerTile(): HTMLCanvasElement {
  if (tile) return tile;
  tile = document.createElement('canvas');
  tile.width = tile.height = 24;
  const c = tile.getContext('2d')!;
  c.fillStyle = '#26262b';
  c.fillRect(0, 0, 24, 24);
  c.fillStyle = '#303036';
  c.fillRect(0, 0, 12, 12); // the page corner starts with the light cell, as before
  c.fillRect(12, 12, 12, 12);
  return tile;
}

/** Two-tone dashed box (dark under light, offset dashes): reads on white, black and any fill. */
export function drawSelectionBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(10,10,11,0.75)';
  ctx.strokeRect(x, y, w, h);
  ctx.lineDashOffset = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/** Small center mark: a dark-edged light cross. */
export function drawCenterMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const px = Math.round(x) + 0.5, py = Math.round(y) + 0.5;
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(px - 4, py); ctx.lineTo(px + 4, py); ctx.moveTo(px, py - 4); ctx.lineTo(px, py + 4);
  ctx.strokeStyle = '#0a0a0b'; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

export type HandleKey = { op: string; fx: number; fy: number };
export const sameHandle = (a: HandleKey | null | undefined, b: HandleKey | null | undefined): boolean =>
  !a || !b ? !a && !b : a.op === b.op && a.fx === b.fx && a.fy === b.fy;
export const handleCursor = (h: HandleKey): string => h.op === 'pivot' ? 'move' : h.op === 'rotate' ? 'grab'
  : h.op === 'skew' ? (h.fy ? 'ew-resize' : 'ns-resize')
    : h.fx && h.fy ? (h.fx === h.fy ? 'nwse-resize' : 'nesw-resize') : h.fx ? 'ew-resize' : 'ns-resize';

type ScreenBox = { x: number; y: number; w: number; h: number };
/** Selection overlay in screen pixels: while a handle is held, a thin box (and the center it turns about); otherwise
    the two-tone box, the center mark (scale mode) and the handles (arrows; the pivot as a ringed cross). */
export function drawTransformOverlay(ctx: CanvasRenderingContext2D, b: ScreenBox, live: { op: string; x: number; y: number } | null,
  handles: Array<{ op: string; fx: number; fy: number; x: number; y: number }>, scaleMode: boolean, hover?: HandleKey | null, accent = '#0a0a0b'): void {
  ctx.save();
  ctx.lineWidth = 1;
  if (live) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(236,236,239,0.6)';
    ctx.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w), Math.round(b.h));
    ctx.setLineDash([]);
    if (live.op !== 'scale') {
      const px = Math.round(live.x) + 0.5, py = Math.round(live.y) + 0.5;
      ctx.beginPath(); ctx.moveTo(px - 6, py); ctx.lineTo(px + 6, py); ctx.moveTo(px, py - 6); ctx.lineTo(px, py + 6);
      ctx.strokeStyle = '#0a0a0b'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#ececef'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
    return;
  }
  drawSelectionBox(ctx, Math.round(b.x) - 0.5, Math.round(b.y) - 0.5, Math.round(b.w) + 1, Math.round(b.h) + 1);
  if (scaleMode) drawCenterMark(ctx, b.x + b.w / 2, b.y + b.h / 2);
  for (const h of handles) {
    if (h.op !== 'pivot') { drawArrowHandle(ctx, h, h.x, h.y, sameHandle(h, hover) ? accent : undefined); continue; }
    ctx.beginPath();
    ctx.arc(h.x, h.y, 5, 0, Math.PI * 2); ctx.moveTo(h.x - 9, h.y); ctx.lineTo(h.x + 9, h.y); ctx.moveTo(h.x, h.y - 9); ctx.lineTo(h.x, h.y + 9);
    ctx.strokeStyle = '#0a0a0b'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = sameHandle(h, hover) ? accent : '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();
}
