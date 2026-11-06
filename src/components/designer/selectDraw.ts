import type { DesignDoc } from '../../engine/types';
import { getSelection, selectionPath } from '../../engine/design/pixelSelection';
import type { Mods } from '../../engine/design/modifierGate';
import { polygonVertices } from './selectPolygon';

/** The size of the box being dragged, shown beside the pointer (page pixels); null when nothing is dragging. */
export interface Readout { x: number; y: number; w: number; h: number }
let readout: Readout | null = null;
export const setReadout = (r: Readout | null): void => { readout = r; };

/** While the outline is being moved, how far (page pixels): the selection is drawn shifted, nothing is recomputed. */
let shift: { dx: number; dy: number } | null = null;
export const setOutlineShift = (s: { dx: number; dy: number } | null): void => { shift = s; };

/** The pixel selection (or the outline being dragged) as a dashed two-tone line (dark under light) that reads on any artwork. */
export function drawSelect(ctx: CanvasRenderingContext2D, doc: DesignDoc, view: { zoom: number }, draft: Array<[number, number]> | null, _mods?: Mods): void {
  const useDraft = Boolean(draft?.length);
  const sel = useDraft && draft ? { points: draft } : getSelection(doc.id);
  ctx.save();
  if (!useDraft && shift) ctx.translate(shift.dx, shift.dy);
  // A pixel mask (magic wand, combined selections): its precomputed dashed outline.
  if (!useDraft && sel && 'edge' in sel && sel.edge) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sel.edge, 0, 0);
    ctx.restore();
  }
  if (sel && sel.points.length > 1) {
    ctx.save();
    // Inverted: the page edge is part of the outline too, so it reads as "everything but this".
    if ('inverted' in sel && sel.inverted) {
      ctx.beginPath();
      ctx.rect(0, 0, doc.width, doc.height);
      sel.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    } else selectionPath(ctx, doc, { points: sel.points });
    ctx.lineWidth = 1 / view.zoom;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    ctx.setLineDash([4 / view.zoom, 4 / view.zoom]);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  if (draft) { drawVertices(ctx, view.zoom); drawReadout(ctx, view.zoom); }
}

/** The polygon's vertices: small squares, the first one larger (clicking it closes the shape). */
function drawVertices(ctx: CanvasRenderingContext2D, zoom: number): void {
  const vs = polygonVertices();
  if (!vs.length) return;
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  vs.forEach(([x, y], i) => {
    const r = (i ? 2.5 : 4) / zoom;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
  });
  ctx.restore();
}

/** "W × H" next to the pointer, in two tones like the outline. */
function drawReadout(ctx: CanvasRenderingContext2D, zoom: number): void {
  if (!readout) return;
  ctx.save();
  ctx.translate(readout.x + 12 / zoom, readout.y + 18 / zoom);
  ctx.scale(1 / zoom, 1 / zoom);
  ctx.font = '12px system-ui, sans-serif';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  const text = `${Math.round(readout.w)} × ${Math.round(readout.h)}`;
  ctx.strokeStyle = '#000000';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
