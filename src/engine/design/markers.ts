import type { ShapeSpec } from '../types';

/*
 * Arrowheads and end markers for lines and paths. Each kind is drawn in one unit frame: the tip at 0,0 pointing
 * along +x, three units long, scaled by the stroke width (SVG markerUnits="strokeWidth"). The canvas and the SVG
 * export use the same frame, so the marker looks the same on screen, in PNG and in the SVG.
 */

export type MarkerKind = 'none' | 'triangle' | 'open' | 'circle' | 'square' | 'bar';
export const MARKER_KINDS: Array<{ value: MarkerKind; label: string }> = [
  { value: 'none', label: 'None' }, { value: 'triangle', label: 'Triangle' }, { value: 'open', label: 'Open arrow' },
  { value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }, { value: 'bar', label: 'Bar' },
];

type Pt = [number, number];

/** The first and last direction of a path's outline: where a marker at each end points away from the path. */
export function pathEnds(d: string): { start: Pt; startDir: Pt; end: Pt; endDir: Pt } | null {
  const t = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const pts: Pt[] = [];
  let i = 0, cmd = '';
  while (i < t.length) {
    if (/[A-Za-z]/.test(t[i])) cmd = t[i++];
    const need = cmd === 'M' || cmd === 'L' ? 2 : cmd === 'Q' ? 4 : cmd === 'C' ? 6 : 0;
    if (!need) { if (cmd === 'Z') continue; return null; }
    // Only the first subpath has ends; later moves stop the reading. Numbers after M are implicit lines.
    if (cmd === 'M' && pts.length) break;
    const v = t.slice(i, i + need).map(Number);
    if (v.length < need) return null;
    i += need;
    for (let k = 0; k < need; k += 2) pts.push([v[k], v[k + 1]]);
    if (cmd === 'M') cmd = 'L';
  }
  if (pts.length < 2) return null;
  const start = pts[0];
  const after = pts.find((p) => p[0] !== start[0] || p[1] !== start[1]);
  const end = pts[pts.length - 1];
  const before = [...pts].reverse().find((p) => p[0] !== end[0] || p[1] !== end[1]);
  if (!after || !before) return null;
  return { start, startDir: [after[0] - start[0], after[1] - start[1]], end, endDir: [end[0] - before[0], end[1] - before[1]] };
}

/** The outline a shape's ends are read from: a line's diagonal, or a path's own data. */
export function shapeEnds(s: ShapeSpec) {
  return s.type === 'line' ? pathEnds(`M ${s.x} ${s.y} L ${s.x + s.w} ${s.y + s.h}`) : s.type === 'path' && s.d ? pathEnds(s.d) : null;
}

/** Unit geometry: `fill` shapes as SVG path data, or the open arrow as a stroked chevron (width 0.5 unit). */
const UNIT: Record<Exclude<MarkerKind, 'none' | 'circle'>, { d: string; stroked?: boolean }> = {
  triangle: { d: 'M 0 0 L -3 1.5 L -3 -1.5 Z' },
  open: { d: 'M -3 1.5 L 0 0 L -3 -1.5', stroked: true },
  square: { d: 'M -3 -1.5 L 0 -1.5 L 0 1.5 L -3 1.5 Z' },
  bar: { d: 'M -0.5 -1.5 L 0.5 -1.5 L 0.5 1.5 L -0.5 1.5 Z' },
};

/** Draw one marker on a canvas: tip at x,y, pointing `angle` (radians), sized by `sw`. */
export function drawMarker(ctx: CanvasRenderingContext2D, kind: MarkerKind, x: number, y: number, angle: number, sw: number, color: string, alpha: number): void {
  if (kind === 'none') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(sw, sw);
  ctx.globalAlpha *= alpha;
  if (kind === 'circle') { ctx.beginPath(); ctx.arc(-1.5, 0, 1.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
  else {
    const u = UNIT[kind];
    const p = new Path2D(u.d);
    if (u.stroked) { ctx.strokeStyle = color; ctx.lineWidth = 0.5; ctx.stroke(p); } else { ctx.fillStyle = color; ctx.fill(p); }
  }
  ctx.restore();
}

/** Both markers of a shape, drawn in the shape's own coordinates (the same frame as its stroke). */
export function drawShapeMarkers(ctx: CanvasRenderingContext2D, s: ShapeSpec, sw: number, color: string, alpha: number): void {
  if (!s.markerStart && !s.markerEnd) return;
  const e = shapeEnds(s);
  if (!e) return;
  if (s.markerStart && s.markerStart !== 'none') drawMarker(ctx, s.markerStart, e.start[0], e.start[1], Math.atan2(-e.startDir[1], -e.startDir[0]), sw, color, alpha);
  if (s.markerEnd && s.markerEnd !== 'none') drawMarker(ctx, s.markerEnd, e.end[0], e.end[1], Math.atan2(e.endDir[1], e.endDir[0]), sw, color, alpha);
}

/** SVG marker definitions for a shape and the attributes that attach them (empty when it has none). */
export function markerSvg(s: ShapeSpec, id: string, color: string, xmlEscape: (v: string) => string): { defs: string; attrs: string } {
  const parts: string[] = [], attrs: string[] = [];
  const e = (s.markerStart && s.markerStart !== 'none') || (s.markerEnd && s.markerEnd !== 'none') ? shapeEnds(s) : null;
  if (!e) return { defs: '', attrs: '' };
  const content = (kind: MarkerKind) => {
    const c = xmlEscape(color);
    if (kind === 'circle') return `<circle cx="-1.5" cy="0" r="1.5" fill="${c}"/>`;
    const u = UNIT[kind as Exclude<MarkerKind, 'none' | 'circle'>];
    return u.stroked ? `<path d="${u.d}" fill="none" stroke="${c}" stroke-width="0.5"/>` : `<path d="${u.d}" fill="${c}"/>`;
  };
  for (const [side, kind, orient] of [['s', s.markerStart, 'auto-start-reverse'], ['e', s.markerEnd, 'auto']] as const) {
    if (!kind || kind === 'none') continue;
    const mid = `${id}-${side}`;
    parts.push(`<marker id="${mid}" markerUnits="strokeWidth" markerWidth="3" markerHeight="3" refX="0" refY="0" orient="${orient}" overflow="visible">${content(kind)}</marker>`);
    attrs.push(`marker-${side === 's' ? 'start' : 'end'}="url(#${mid})"`);
  }
  return { defs: parts.join(''), attrs: attrs.join(' ') };
}
