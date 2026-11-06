import type { DesignDoc } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { maskSelection, type PixelSelection } from './pixelSelection';
import { pointInPolygon } from './lassoNodes';

/* Moving a selection's outline (not the pixels under it). A polygon moves by its points; a mask is redrawn once, in whole pixels. */

type Page = Pick<DesignDoc, 'width' | 'height'>;

/** Whether the page point (x, y) is inside the selection. */
export function pointInSelection(doc: Page, sel: PixelSelection, x: number, y: number): boolean {
  if (sel.mask) {
    const b = sel.box;
    if (!b || x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return false;
    return ctx2d(sel.mask).getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] > 127;
  }
  const inPoly = pointInPolygon([x, y], sel.points);
  if (!sel.inverted) return inPoly;
  return !inPoly && x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}

/** The offset a move really applies: whole pixels for a mask, as dragged for a polygon. */
export const moveOffset = (sel: PixelSelection, dx: number, dy: number): { dx: number; dy: number } =>
  sel.mask ? { dx: Math.round(dx), dy: Math.round(dy) } : { dx, dy };

/** The selection shifted by (dx, dy); null when a mask is pushed wholly off the page. */
export function translateSelection(doc: Page, sel: PixelSelection, dx: number, dy: number): PixelSelection | null {
  const d = moveOffset(sel, dx, dy);
  if (!sel.mask) return { ...sel, points: sel.points.map(([x, y]) => [x + d.dx, y + d.dy] as [number, number]) };
  const out = createCanvas(Math.round(doc.width), Math.round(doc.height));
  ctx2d(out).drawImage(sel.mask, d.dx, d.dy);
  return maskSelection(out);
}
