import type { DesignDoc } from '../../engine/types';
import { getSelection, selectionPath } from '../../engine/design/pixelSelection';
import type { Mods } from '../../engine/design/modifierGate';

/** The pixel selection (or the outline being dragged) as a dashed two-tone line (dark under light) that reads on any artwork. */
export function drawSelect(ctx: CanvasRenderingContext2D, doc: DesignDoc, view: { zoom: number }, draft: Array<[number, number]> | null, _mods?: Mods): void {
  const sel = draft ? { points: draft } : getSelection(doc.id);
  // A pixel mask (magic wand, combined selections): its precomputed dashed outline.
  if (!draft && sel && 'edge' in sel && sel.edge) {
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
}
