import type { VectorShape } from '../types';
import { shapeToPath } from './affine';
import { pageSegs, type Pt, type Seg } from './pathNodes';
import { pathTransform } from './path';
import { shapeMatrix } from './shapeTransform';
import { strokeAlignOf, MITER_DEFAULT } from './shapeLook';
import { uid } from '../../lib/id';

/*
 * Outline stroke (Figma's «Outline stroke», Inkscape's «Stroke to Path»): the stroke becomes a filled path. The path
 * is flattened to a polyline (curves cut finely enough to stay under ~0.05 px), cut into dashes when dashed, and the
 * stroke is the union of simple polygons: a quad per segment, a join piece per vertex (round disc, bevel triangle,
 * miter tip) and a cap per open end (round disc, square extension). All polygons are wound the same way and share one
 * path, so a nonzero fill is their exact union, with no boolean operation and no seams. Own algorithm, no source copied.
 */

const TOL = 0.05;
type P = [number, number];

function flatten(segs: Seg[]): Array<{ pts: P[]; closed: boolean }> {
  const out: Array<{ pts: P[]; closed: boolean }> = [];
  let cur: P[] = [], at: P = [0, 0], start: P = [0, 0];
  const end = (closed: boolean) => { if (cur.length) out.push({ pts: cur, closed }); cur = []; };
  for (const s of segs) {
    if (s.c === 'M') { end(false); at = start = s.p[0]; cur = [at]; }
    else if (s.c === 'L') { for (const q of s.p) { cur.push(q); at = q; } }
    else if (s.c === 'C') {
      const [a, b, c] = s.p, ctrl = Math.hypot(a[0] - at[0], a[1] - at[1]) + Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]);
      // A cubic's flatness error is about chord²·κ/8: steps grow with the square root of its length.
      const n = Math.min(200, Math.max(4, Math.ceil(Math.sqrt(ctrl / TOL) / 2)));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push([u * u * u * at[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * c[0], u * u * u * at[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * c[1]]);
      }
      at = c;
    } else { // Z
      if (cur.length) { end(true); at = start; cur = [start]; }
    }
  }
  if (cur.length > 1 || (cur.length === 1 && out.length === 0)) end(false);
  return out.map((o) => ({ ...o, pts: o.pts.filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 1e-9) })).filter((o) => o.pts.length > 0);
}

/** Cut a polyline into dash pieces (pattern in px); a closed one is walked once around, from its first point. */
function dashed(pts: P[], closed: boolean, pattern: number[], offset: number): P[][] {
  const path = closed ? [...pts, pts[0]] : pts;
  const pat = pattern.length % 2 ? [...pattern, ...pattern] : pattern, total = pat.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [path];
  let idx = 0, left = pat[0], on = true, o = ((offset % total) + total) % total;
  while (o > 0) { const take = Math.min(o, left); o -= take; left -= take; if (left <= 1e-9) { idx = (idx + 1) % pat.length; left = pat[idx]; on = !on; } }
  const pieces: P[][] = [];
  let piece: P[] = on ? [path[0]] : [];
  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1]; const b = path[i];
    let len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (len > left + 1e-9) {
      const t = left / len, m: P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (on) { piece.push(m); pieces.push(piece); piece = []; } else piece = [m];
      len -= left; a = m; on = !on; idx = (idx + 1) % pat.length; left = Math.max(pat[idx], 1e-6);
    }
    left -= len;
    if (on) piece.push(b);
  }
  if (on && piece.length > 1) pieces.push(piece);
  return pieces;
}

const disc = (c: P, r: number): P[] => {
  const n = Math.min(64, Math.max(12, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - TOL / Math.max(r, TOL))))));
  return Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)] as P);
};

/** The polygons whose union is the stroke of one polyline. */
function strokePolygons(pts: P[], closed: boolean, h: number, join: 'miter' | 'round' | 'bevel', cap: 'butt' | 'round' | 'square', miter: number): P[][] {
  const polys: P[][] = [];
  if (pts.length === 1) { if (cap === 'round') polys.push(disc(pts[0], h)); else if (cap === 'square') polys.push([[pts[0][0] - h, pts[0][1] - h], [pts[0][0] + h, pts[0][1] - h], [pts[0][0] + h, pts[0][1] + h], [pts[0][0] - h, pts[0][1] + h]]); return polys; }
  const ring = closed && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9 ? pts.slice(0, -1) : pts;
  const m = ring.length, count = closed ? m : m - 1, dir: P[] = [];
  for (let i = 0; i < count; i++) {
    const a = ring[i], b = ring[(i + 1) % m], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, d: P = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    dir.push(d);
    const nx = -d[1] * h, ny = d[0] * h;
    polys.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
  }
  const joinAt = (v: P, d1: P, d2: P) => {
    if (join === 'round') { polys.push(disc(v, h)); return; }
    const cross = d1[0] * d2[1] - d1[1] * d2[0], dot = d1[0] * d2[0] + d1[1] * d2[1];
    if (Math.abs(cross) < 1e-9 && dot > 0) return;
    const sg = cross > 0 ? -1 : 1, n1: P = [-d1[1] * sg * h, d1[0] * sg * h], n2: P = [-d2[1] * sg * h, d2[0] * sg * h];
    const p1: P = [v[0] + n1[0], v[1] + n1[1]], p2: P = [v[0] + n2[0], v[1] + n2[1]];
    // Miter length over width is 1 / sin(half the angle between the segments) = 1 / cos(half the turn).
    const ratio = 1 / Math.sqrt(Math.max(1e-9, (1 + dot) / 2));
    if (join === 'miter' && ratio <= miter && Math.abs(cross) > 1e-9) {
      const k = 1 / (1 + dot);
      polys.push([v, p1, [v[0] + (n1[0] + n2[0]) * k, v[1] + (n1[1] + n2[1]) * k], p2]);
    } else polys.push([v, p1, p2]);
  };
  for (let i = 1; i < count; i++) joinAt(ring[i], dir[i - 1], dir[i]);
  if (closed) joinAt(ring[0], dir[count - 1], dir[0]);
  else if (cap === 'round') { polys.push(disc(ring[0], h), disc(ring[m - 1], h)); }
  else if (cap === 'square') {
    const d0 = dir[0], d1 = dir[count - 1], a = ring[0], b = ring[m - 1];
    polys.push([[a[0] - d0[1] * h, a[1] + d0[0] * h], [a[0] + d0[1] * h, a[1] - d0[0] * h], [a[0] + d0[1] * h - d0[0] * h, a[1] - d0[0] * h - d0[1] * h], [a[0] - d0[1] * h - d0[0] * h, a[1] + d0[0] * h - d0[1] * h]]);
    polys.push([[b[0] - d1[1] * h, b[1] + d1[0] * h], [b[0] + d1[1] * h, b[1] - d1[0] * h], [b[0] + d1[1] * h + d1[0] * h, b[1] - d1[0] * h + d1[1] * h], [b[0] - d1[1] * h + d1[0] * h, b[1] + d1[0] * h + d1[1] * h]]);
  }
  return polys;
}

const area = (p: P[]) => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + (q[0] * r[1] - r[0] * q[1]) / 2; }, 0);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Can this shape's stroke be outlined? Centered strokes of anything with a visible stroke (aligned ones are not offset yet). */
export function canOutlineStroke(s: VectorShape): boolean {
  return (!!s.stroke || !!s.strokeGradient) && s.strokeWidth > 0 && strokeAlignOf(s) === 'center';
}

/** The outline of a shape's stroke as one filled path (page coordinates, no rotation left), or null when there is none. */
export function strokeOutlineShape(s: VectorShape): VectorShape | null {
  if (!canOutlineStroke(s)) return null;
  const p = shapeToPath(s), t = pathTransform(p);
  // The stroke's width on the page: a shape's stroke keeps its width when scaled, unless `scaleStroke` says it grows.
  const w = p.type === 'path' && p.scaleStroke ? s.strokeWidth * Math.sqrt(Math.abs(t.sx * t.sy)) : s.strokeWidth;
  const turn = s.rot ? shapeMatrix(s) : null;
  const mapPt = (q: Pt): P => (turn ? [turn[0] * q[0] + turn[2] * q[1] + turn[4], turn[1] * q[0] + turn[3] * q[1] + turn[5]] : [q[0], q[1]]);
  const segs = pageSegs(p).map((g) => ({ c: g.c, p: g.p.map(mapPt) }));
  const polys: P[][] = [];
  for (const sub of flatten(segs)) {
    const pieces = s.dash?.length ? dashed(sub.pts, sub.closed, s.dash.map((d) => Math.max(0, d) * w), (s.dashOffset ?? 0) * w) : null;
    if (pieces) for (const piece of pieces) polys.push(...strokePolygons(piece, false, w / 2, s.join ?? 'round', s.cap ?? 'round', s.miter ?? MITER_DEFAULT));
    else polys.push(...strokePolygons(sub.pts, sub.closed, w / 2, s.join ?? 'round', s.cap ?? 'round', s.miter ?? MITER_DEFAULT));
  }
  const all = polys.filter((q) => q.length >= 3).map((q) => (area(q) < 0 ? [...q].reverse() : q));
  if (!all.length) return null;
  const xs = all.flat().map((q) => q[0]), ys = all.flat().map((q) => q[1]);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(1, Math.max(...xs) - Math.min(...xs)), h: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
  const d = all.map((q) => `M ${q.map(([x, y]) => `${r3(x)} ${r3(y)}`).join(' L ')} Z`).join(' ');
  return {
    ...s, type: 'path', d, box0: box, ...box, radius: 0, rx: undefined, ry: undefined, rot: undefined, prim: undefined, nodeTypes: undefined,
    fill: s.stroke, fillGradient: s.strokeGradient, fillOpacity: s.strokeOpacity, fillRule: undefined,
    stroke: null, strokeGradient: undefined, strokeOpacity: undefined, strokeWidth: 0, strokeAlign: undefined, scaleStroke: undefined,
    join: undefined, cap: undefined, miter: undefined, dash: undefined, dashOffset: undefined, paintOrder: undefined, markerStart: undefined, markerEnd: undefined,
  };
}

/**
 * Outline stroke on a list of shapes: a shape with a fill keeps it (its stroke removed) and the outline is a new shape
 * just above it (a stroke painted under the fill goes below); with no fill the shape itself is replaced, keeping its id.
 */
export function outlineStrokeShapes(shapes: VectorShape[], id: string): VectorShape[] {
  return shapes.flatMap((s) => {
    if (s.id !== id) return [s];
    const o = strokeOutlineShape(s);
    if (!o) return [s];
    if (!s.fill && !s.fillGradient) return [{ ...o, id: s.id }];
    const rest: VectorShape = { ...s, stroke: null, strokeGradient: undefined, strokeWidth: 0 }, ring = { ...o, id: uid('shp') };
    return s.paintOrder === 'stroke' ? [ring, rest] : [rest, ring];
  });
}
