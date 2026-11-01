import type { VectorShape } from '../types';
import { shapeToPath } from './affine';
import { editablePageSegs } from './multiPathEdit';
import { booleanOp, faces, flatten, type Area } from './pathBoolean';
import { withSegs, type Seg } from './pathNodes';
import { uid } from '../../lib/id';

/*
 * Boolean operations on picked vector shapes (Union, Subtract, Intersect, Exclude, Divide), as Figma and Illustrator
 * do them: rectangles, ellipses and paths are read as filled areas in page coordinates (turn included), the result is
 * a plain path. Union / Intersect / Exclude take the look of the bottom-most shape, Subtract the look of the back one,
 * Divide gives every region the look of the top-most shape that covers it. Open paths without a fill cannot be
 * united: they are ignored, except by Divide, where they cut. Geometry: pathBoolean.ts (Clipper2). The face-merging
 * rules of the Shape Builder follow vectorcraft (crates/pathops/src/pathfinder.rs; MIT OR Apache-2.0).
 */

export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude' | 'divide';
export const BOOL_OPS: Array<{ op: BoolOp; label: string; key: string; tip: string }> = [
  { op: 'union', label: 'Union', key: 'U', tip: 'Merge the shapes into one' },
  { op: 'subtract', label: 'Subtract', key: 'S', tip: 'Cut the front shapes out of the back one' },
  { op: 'intersect', label: 'Intersect', key: 'I', tip: 'Keep only where all shapes overlap' },
  { op: 'exclude', label: 'Exclude', key: 'E', tip: 'Keep everything except where the shapes overlap' },
  { op: 'divide', label: 'Divide', key: '', tip: 'Every overlap region becomes its own shape' },
];

/** A closed outline in page coordinates: every subpath ends with Z. */
function allClosed(segs: Seg[]): boolean {
  let open = false;
  for (const g of segs) {
    if (g.c === 'M') { if (open) return false; open = true; } else if (g.c === 'Z') open = false;
  }
  return !open;
}
/** The shape's outline in page coordinates, with its turn applied. */
export const outlineOf = (s: VectorShape): Seg[] => editablePageSegs(shapeToPath(s));

/** Can this shape be a filled area? Rectangles and ellipses always; paths when filled or closed; lines never. */
export function isFillable(s: VectorShape): boolean {
  if (s.type === 'line') return false;
  if (s.type !== 'path') return true;
  return !!s.fill || !!s.fillGradient || allClosed(outlineOf(s));
}
export const areaOf = (s: VectorShape): Area => ({ segs: outlineOf(s), fillRule: s.fillRule });

/** A new path with `source`'s look and these page-coordinate segments (no turn, primitive or node types left). */
export function restyle(source: VectorShape, segs: Seg[], id = uid('shp')): VectorShape {
  const base = { ...shapeToPath(source), id, rot: undefined, prim: undefined, nodeTypes: undefined, fillRule: undefined, radius: 0 } as VectorShape;
  return withSegs(base, segs);
}

/** Shapes (back to front) → the resulting shapes, or a short message when nothing sensible comes out. */
export function booleanShapes(op: BoolOp, shapes: VectorShape[]): { shapes: VectorShape[]; ignored: number } | string {
  const fill = shapes.filter(isFillable), ignored = shapes.length - fill.length;
  if (fill.length < 2) return 'Pick two or more shapes with a fill (open paths without fill cannot be combined).';
  const areas = fill.map(areaOf);
  if (op === 'divide') {
    const cutters = shapes.filter((s) => !isFillable(s)).flatMap((s) => flatten(outlineOf(s), 0.25).filter((p) => !p.closed).map((p) => p.points));
    const parts = faces(areas, cutters);
    if (!parts) return 'These shapes are too complex to divide.';
    const out = parts.filter((f) => f.segs.length).map((f) => restyle(fill[Math.max(...f.sources)], f.segs));
    return out.length ? { shapes: out, ignored: 0 } : 'Nothing to divide.';
  }
  let segs: Seg[];
  if (op === 'union') segs = booleanOp('union', areas, []);
  else if (op === 'subtract') segs = booleanOp('difference', [areas[0]], areas.slice(1));
  else {
    const kind = op === 'intersect' ? 'intersection' : 'xor';
    segs = areas[0].segs.length ? booleanOp('union', [areas[0]], []) : [];
    for (const a of areas.slice(1)) segs = booleanOp(kind, [{ segs, fillRule: 'nonzero' }], [a]);
  }
  if (!segs.length) return op === 'intersect' ? 'These shapes do not overlap.' : 'Nothing is left of the result.';
  return { shapes: [restyle(fill[0], segs)], ignored };
}
