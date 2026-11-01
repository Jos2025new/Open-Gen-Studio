import type { VectorShape } from '../../engine/types';
import { pageSegs, type Pt, type Seg } from '../../engine/design/pathNodes';
import { eraseArea, eraseBand, knifeArea } from '../../engine/design/pathBoolean';
import { areaPieces, layerShapes, replaceWithSubpaths, usablePieces } from './pathPieces';

/*
 * Cut (drag) and Erase on a FILLED closed path work on its area, like Inkscape's eraser in cut mode or Illustrator's
 * knife (engine: pathBoolean.ts): the pieces are closed filled areas that can be cut or erased again. Outline-only paths
 * keep the edge tools (pathCut.ts, vectorErase.ts). While node editing goes on the pieces stay subpaths of the shape;
 * leaving separates them by component (pathPieces.ts).
 */
export { isFilledArea } from './pathPieces';

function apply(s: string, d: string, l: string, shape: VectorShape, out: Seg[][], segs: Seg[]): boolean {
  if (out.length === 1 && out[0] === segs) return false; // engine: nothing happened
  const pieces = usablePieces(out), before = areaPieces(shape).length;
  replaceWithSubpaths(s, d, l, layerShapes(s, d, l), shape, pieces, { split: pieces.length > before, before });
  return true;
}

/** Knife along `line` (own coordinates). False (and no undo step) when it divides nothing. */
export function knifeFilled(s: string, d: string, l: string, shape: VectorShape, line: Pt[]): boolean {
  const segs = pageSegs(shape);
  return apply(s, d, l, shape, knifeArea({ segs, fillRule: shape.fillRule }, line), segs);
}

/** Area eraser: remove what the brush of `radius` swept along `trail` (own coordinates), in one undo step. */
export function eraseFilled(s: string, d: string, l: string, shape: VectorShape, trail: Pt[], radius: number): boolean {
  const segs = pageSegs(shape);
  return apply(s, d, l, shape, eraseArea({ segs, fillRule: shape.fillRule }, trail, radius), segs);
}

/** SVG path data of the swept band, mapped to screen by `toScreen` (own point -> screen px). */
export function bandScreenPath(trail: Pt[], radius: number, toScreen: (p: Pt) => { x: number; y: number }): string {
  const f = (p: Pt) => { const q = toScreen(p); return `${q.x.toFixed(1)} ${q.y.toFixed(1)}`; };
  return eraseBand(trail, radius).map((g) => (g.c === 'Z' ? 'Z' : `${g.c} ${g.p.map(f).join(' ')}`)).join(' ');
}
