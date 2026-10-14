/* Canvas sprites the Stage paints: the transform arrows of a selection and the transparency checkerboard.
   Pure drawing, moved out of Stage.tsx to keep it under its size limit (no behaviour change). */

export function drawArrowHandle(ctx: CanvasRenderingContext2D, h: { op: string; fx: number; fy: number }, x: number, y: number): void {
  const head = (tx: number, ty: number, ang: number) => {
    ctx.moveTo(tx + Math.cos(ang + 2.5) * 5, ty + Math.sin(ang + 2.5) * 5);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx + Math.cos(ang - 2.5) * 5, ty + Math.sin(ang - 2.5) * 5);
  };
  const path = () => {
    ctx.beginPath();
    if (h.op === 'rotate') {
      const out = Math.atan2(h.fy, h.fx);
      const cx = x + Math.cos(out) * 4, cy = y + Math.sin(out) * 4, r = 9;
      const a0 = out - Math.PI / 2.6, a1 = out + Math.PI / 2.6;
      ctx.arc(cx, cy, r, a0, a1);
      head(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, a0 - Math.PI / 2);
      head(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, a1 + Math.PI / 2);
    } else {
      // Along the side, just outside it.
      const horizontal = h.fy !== 0;
      const ox = horizontal ? 0 : h.fx * 6, oy = horizontal ? h.fy * 6 : 0;
      const dx = horizontal ? 9 : 0, dy = horizontal ? 0 : 9;
      ctx.moveTo(x + ox - dx, y + oy - dy);
      ctx.lineTo(x + ox + dx, y + oy + dy);
      head(x + ox + dx, y + oy + dy, Math.atan2(dy, dx));
      head(x + ox - dx, y + oy - dy, Math.atan2(-dy, -dx));
    }
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  path();
  ctx.strokeStyle = '#0a0a0b';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  path();
  ctx.strokeStyle = '#d4f25a';
  ctx.lineWidth = 2;
  ctx.stroke();
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
