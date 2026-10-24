import { normalizePrim, type PrimSpec } from './primitives';

/*
 * Inkscape's own attributes for the parametric primitives (arcs, slices, chords, polygons, stars), written beside the
 * unchanged `d` so Inkscape opens them as editable shapes and other apps keep reading the path. Values are in the
 * path's LOCAL frame: the unit frame primPath draws in (centre 0,0, radius 1). The element's transform matrix, which
 * the exporter already writes, carries the box, the turn and any skew, exactly as Inkscape applies a transform to a
 * shape (src/object/sp-ellipse.cpp SPGenericEllipse::set_shape, line 489: Scale(rx, ry) * Translate(cx, cy)).
 */
const num = (v: number) => String(+v.toFixed(9));
const TAU = Math.PI * 2;
/** Radians in [0, 2π), as Geom::Angle::radians0 (sp-ellipse.cpp SPGenericEllipse::normalize, line 681). */
const radians0 = (deg: number) => { const r = (((deg - 90) * Math.PI) / 180) % TAU; return r < 0 ? r + TAU : r; };

/** Attributes (with a leading space) for a primitive, or '' when Inkscape cannot draw the same outline (rounded corners). */
export function inkscapePrimAttrs(prim: PrimSpec): string {
  const p = normalizePrim(prim);
  if (p.kind === 'sector' || p.kind === 'arc' || p.kind === 'chord') {
    // sp-ellipse.cpp SPGenericEllipse::write, lines 308-312: type arc plus the centre and radii (unit frame here).
    let a = ' sodipodi:type="arc" sodipodi:cx="0" sodipodi:cy="0" sodipodi:rx="1" sodipodi:ry="1"';
    const start = radians0(p.a0 ?? 0), end = radians0(p.a1 ?? 270);
    // _isSlice (line 689): an extent of 0 or 2π is a whole ellipse, and write() then removes start, end, open and
    // arc-type (lines 334-338).
    if (Math.abs(start - end) < 1e-6 || Math.abs(Math.abs(start - end) - TAU) < 1e-6) return a;
    a += ` sodipodi:start="${num(start)}" sodipodi:end="${num(end)}"`;
    // Lines 319-331: slice drops `open`; chord and arc write open="true" (backwards compatibility) and arc-type.
    if (p.kind === 'sector') return `${a} sodipodi:arc-type="slice"`;
    return `${a} sodipodi:open="true" sodipodi:arc-type="${p.kind}"`;
  }
  // Inkscape's rounded corners are curves through the vertices (sp-star.cpp set_shape, lines 346-410), not ours cut back
  // from the corner; with attributes it would redraw another outline, so a rounded primitive stays a plain path.
  if (p.round) return '';
  // sp-star.cpp SPStar::write, lines 72-82. Regular polygon: arg2 = arg1 + π/sides (star-tool.cpp line 310) and r2 the
  // apothem (unused when flatsided: set_shape, line 365 only draws the outer points).
  const sides = p.sides ?? 5, flat = p.kind === 'polygon';
  const arg1 = -Math.PI / 2; // our first vertex is at the top (primitives.ts rad(0))
  const r2 = flat ? Math.cos(Math.PI / sides) : p.inner ?? 0.5;
  return ` sodipodi:type="star" inkscape:flatsided="${flat}" sodipodi:sides="${sides}" sodipodi:cx="0" sodipodi:cy="0" sodipodi:r1="1" sodipodi:r2="${num(r2)}" sodipodi:arg1="${num(arg1)}" sodipodi:arg2="${num(arg1 + Math.PI / sides)}" inkscape:rounded="0" inkscape:randomized="0"`;
}
