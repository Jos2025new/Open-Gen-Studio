import type { ShapeSpec } from '../shapeSpec';
import type { DesignTool } from './rules';
import { primShape, withPrim, type PrimKind } from './primitives';

/*
 * The merged shape tools (after Inkscape's Ellipse/Arc and Star/Polygon tools). One Ellipse tool covers whole, slice,
 * arc and chord; one Polygon/Star tool covers both; the Line tool has an Arrow end. Stored shapes keep their kinds
 * (ellipse, sector, arc, chord, polygon, star, arrow): only the tool UI and the creation path change, so the
 * conversions below are patches over the same fields the old tools wrote.
 */

export type EllipseType = 'whole' | 'slice' | 'arc' | 'chord';
export const ELLIPSE_TYPES: Array<{ value: EllipseType; label: string }> = [{ value: 'whole', label: 'Whole' }, { value: 'slice', label: 'Slice' }, { value: 'arc', label: 'Arc' }, { value: 'chord', label: 'Chord' }];
const TYPE_TOOL: Record<EllipseType, DesignTool> = { whole: 'ellipse', slice: 'sector', arc: 'arc', chord: 'chord' };
const TYPE_KIND: Record<Exclude<EllipseType, 'whole'>, PrimKind> = { slice: 'sector', arc: 'arc', chord: 'chord' };

/** The tool a type draws with (the old tool ids stay: they are what Stage and the saved UI know). */
export const toolForEllipseType = (t: EllipseType): DesignTool => TYPE_TOOL[t];
export const ellipseTypeOfTool = (tool: DesignTool): EllipseType | null => (Object.keys(TYPE_TOOL) as EllipseType[]).find((t) => TYPE_TOOL[t] === tool) ?? null;
export const ELLIPSE_TOOLS: ReadonlySet<string> = new Set(Object.values(TYPE_TOOL));
export const CORNER_TOOLS: ReadonlySet<string> = new Set(['polygon', 'star']);
export const LINE_TOOLS: ReadonlySet<string> = new Set(['line', 'arrow']);

/** The type of a selected shape, or null when it is not in the ellipse family (a plain ellipse is «whole»). */
export function ellipseTypeOf(s: Pick<ShapeSpec, 'type' | 'prim'>): EllipseType | null {
  if (s.type === 'ellipse' && !s.prim) return 'whole';
  const k = s.prim?.kind;
  return k === 'sector' ? 'slice' : k === 'arc' ? 'arc' : k === 'chord' ? 'chord' : null;
}

/**
 * Whole circle test of Inkscape's SPGenericEllipse::_isSlice (sp-ellipse.cpp:689-694): the angle extent is nearly 0 or
 * nearly a full turn (2geom are_near, 1e-6 rad ≈ 5.7e-5°). Equal angles are the usual case.
 */
export function isWholeArc(a0: number, a1: number): boolean {
  const ext = (((a1 - a0) % 360) + 360) % 360;
  return ext < 5.7e-5 || ext > 360 - 5.7e-5;
}

/** Start and end given to a whole ellipse that becomes a slice, arc or chord: the defaults of the arc tool (0° to 270°). */
export const DEFAULT_ARC = { a0: 0, a1: 270 };

/**
 * Patch that gives the shape another ellipse type in place: same centre, radii and (for arc kinds) angles. Whole →
 * other takes the default angles; other → whole drops the parameters and keeps the box, which the unit circle filled.
 */
export function convertEllipse(s: ShapeSpec, to: EllipseType): Partial<ShapeSpec> | null {
  const from = ellipseTypeOf(s);
  if (!from || from === to) return null;
  if (to === 'whole') return { type: 'ellipse', prim: undefined, d: undefined, box0: undefined };
  const kind = TYPE_KIND[to];
  if (from === 'whole') {
    const x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h);
    return primShape(x, y, x + Math.abs(s.w), y + Math.abs(s.h), { kind, ...DEFAULT_ARC });
  }
  return withPrim(s, { kind });
}

/** Radii of an ellipse-family shape and the patch that sets one about its centre (Inkscape's Rx and Ry fields). */
export const radiiOf = (s: Pick<ShapeSpec, 'w' | 'h'>) => ({ rx: Math.abs(s.w) / 2, ry: Math.abs(s.h) / 2 });
export function withRadius(s: ShapeSpec, axis: 'rx' | 'ry', v: number): Partial<ShapeSpec> {
  const r = Math.max(0.5, v), cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  return axis === 'rx' ? { x: cx - r, w: 2 * r } : { y: cy - r, h: 2 * r };
}

/** Polygon ↔ star in place (Inkscape's flat-sided switch, star-toolbar.cpp:201-238): corners and rounding are kept. */
export function convertCorners(s: ShapeSpec, to: 'polygon' | 'star'): Partial<ShapeSpec> | null {
  if (!s.prim || (s.prim.kind !== 'polygon' && s.prim.kind !== 'star') || s.prim.kind === to) return null;
  return withPrim(s, { kind: to });
}
