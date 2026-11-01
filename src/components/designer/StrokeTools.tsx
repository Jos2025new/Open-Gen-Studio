import { useEffect, useRef, useState } from 'react';
import type { DesignDoc } from '../../engine/types';
import type { Stroke } from '../../engine/strokeTypes';
import { bakeStroke, bendStroke, strokeHandles, worldPoints } from '../../engine/design/strokes';
import { cutPickedStrokes, cutPickedStrokesAcross, erasePickedStrokes, usePickedStrokes } from '../../engine/design/strokeEdit';
import { nearestOnStroke } from '../../engine/design/strokeCut';
import { getDoc, patchLayer } from '../../engine/design/actions';
import { useNodeEditMode } from '../../engine/design/nodeEditMode';
import { setShapeEdit } from '../../engine/design/objectSelection';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';
import { useStore } from '../../store/store';
import { boardKey } from './boardKey';
import { MARK } from './PathNodeTools';
import '../../styles/path-tools.css';

const REACH = 12; // screen px from a stroke that a click or hover still counts as on it

/*
 * The overlay of the stroke edit row (strokeEdit.ts) for picked Lineart strokes. Move: drag the points of each
 * stroke (the neighbours follow, as Alt+drag does). Bend: drag anywhere near a stroke. Cut: click a stroke to split
 * it there, or drag a line across them (as the path Cut does). Erase: drag a circle over it. One undo step per gesture; a gesture that changes nothing records nothing.
 */
export function StrokeTools({ view, sessionId, doc }: { view: View; sessionId: string; doc: DesignDoc }) {
  const picked = usePickedStrokes(doc);
  const mode = useNodeEditMode((s) => s.mode), radiusPx = useNodeEditMode((s) => s.eraseRadius);
  const influence = useStore((s) => s.ui.lineartInfluence ?? 80);
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [trail, setTrail] = useState<[{ x: number; y: number }, { x: number; y: number }] | null>(null);
  const cut = useRef<{ start: { x: number; y: number }; moved: boolean } | null>(null);
  const drag = useRef<{ kind: 'bend'; base: Stroke[]; si: number; point: number; x: number; y: number; moved: boolean } | { kind: 'erase'; last: [number, number] | null; moved: boolean } | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && boardKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); setShapeEdit(doc.id, null); } };
    // Capture phase: runs before the Stage's own Esc (which would also drop the pick).
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [doc.id]);
  // A pick that is no longer only strokes (a shape of the same layer, a locked or hidden layer) ends stroke editing.
  useEffect(() => { if (!picked) setShapeEdit(doc.id, null); }, [picked, doc.id]);
  if (!picked) return null;
  const { layerId, strokes } = picked;
  const rect = () => ref.current!.getBoundingClientRect();
  const page = (e: { clientX: number; clientY: number }) => screenToDocument({ x: e.clientX, y: e.clientY }, view, rect());
  const scr = (x: number, y: number) => documentToScreen({ x, y }, view, { left: 0, top: 0 });
  const layerStrokes = () => { const l = getDoc(sessionId, doc.id)?.layers.find((x) => x.id === layerId); return l?.type === 'vector' ? l.strokes ?? [] : []; };

  const begin = (e: React.PointerEvent, si: number, point: number) => {
    e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = page(e);
    drag.current = { kind: 'bend', base: layerStrokes(), si, point, x: p.x, y: p.y, moved: false };
  };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = page(e), tol = REACH / view.zoom;
    if (mode === 'bend') {
      const best = nearestGrab(layerStrokes(), strokes, p.x, p.y, tol * 2);
      if (best) begin(e, best.si, best.point);
    } else if (mode === 'cut') {
      e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId);
      cut.current = { start: { x: e.clientX - rect().left, y: e.clientY - rect().top }, moved: false };
    } else if (mode === 'erase') {
      e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { kind: 'erase', last: null, moved: false };
      rub(p);
    }
  };
  const rub = (p: { x: number; y: number }) => {
    const g = drag.current;
    if (g?.kind !== 'erase') return;
    const r = radiusPx / view.zoom, from = g.last ?? [p.x, p.y], n = Math.max(1, Math.ceil(Math.hypot(p.x - from[0], p.y - from[1]) / Math.max(0.5, r / 2)));
    g.last = [p.x, p.y];
    for (let i = 1; i <= n; i++) if (erasePickedStrokes(sessionId, doc.id, layerId, [from[0] + ((p.x - from[0]) * i) / n, from[1] + ((p.y - from[1]) * i) / n], r, !g.moved)) g.moved = true;
  };
  const move = (e: React.PointerEvent) => {
    const g = drag.current, p = page(e);
    setHover({ x: e.clientX - rect().left, y: e.clientY - rect().top });
    const c = cut.current;
    if (c) {
      const at = { x: e.clientX - rect().left, y: e.clientY - rect().top };
      if (c.moved || Math.hypot(at.x - c.start.x, at.y - c.start.y) > 3) { c.moved = true; setTrail([c.start, at]); }
    }
    if (g?.kind === 'erase') rub(p);
    else if (g?.kind === 'bend') {
      if (!g.moved && Math.hypot(p.x - g.x, p.y - g.y) * view.zoom < 2) return;
      const s = g.base[g.si], next = g.base.map((q, i) => (i === g.si ? bendStroke(q, g.point, p.x - g.x, p.y - g.y, Math.max(influence, s.size * 2)) : q));
      patchLayer(sessionId, doc.id, layerId, { strokes: next } as never, { record: !g.moved });
      g.moved = true;
    }
  };
  const end = (e?: React.PointerEvent) => {
    const c = cut.current;
    cut.current = null; setTrail(null);
    if (c && e && e.type === 'pointerup') {
      const to = (q: { x: number; y: number }): [number, number] => { const d = screenToDocument({ x: q.x + rect().left, y: q.y + rect().top }, view, rect()); return [d.x, d.y]; };
      // A short drag that crosses nothing still cuts where it started, as a click.
      if (c.moved && cutPickedStrokesAcross(sessionId, doc.id, layerId, to(c.start), to({ x: e.clientX - rect().left, y: e.clientY - rect().top }))) { /* cut across */ }
      else { const p = to(c.start); cutPickedStrokes(sessionId, doc.id, layerId, p[0], p[1], REACH / view.zoom); }
    }
    drag.current = null;
  };

  // Cut preview, as the path Cut shows it: a short mark across the stroke at the nearest point, perpendicular to it there.
  let mark: { a: { x: number; y: number }; b: { x: number; y: number }; c: { x: number; y: number } } | null = null;
  if (mode === 'cut' && hover && !trail) {
    const p = screenToDocument({ x: hover.x + rect().left, y: hover.y + rect().top }, view, rect());
    let best: { stroke: Stroke; index: number; point: [number, number, number]; d: number } | null = null;
    for (const s of strokes) { const h = nearestOnStroke(s, p.x, p.y); if (h && h.distance - s.size / 2 <= REACH / view.zoom && (!best || h.distance < best.d)) best = { stroke: s, index: h.index, point: h.point, d: h.distance }; }
    if (best) {
      const pts = bakeStroke(best.stroke).points, a = scr(pts[best.index][0], pts[best.index][1]), b = scr(pts[best.index + 1][0], pts[best.index + 1][1]), c = scr(best.point[0], best.point[1]);
      const len = Math.hypot(b.x - a.x, b.y - a.y), tx = len > 1e-6 ? (b.x - a.x) / len : 1, ty = len > 1e-6 ? (b.y - a.y) / len : 0;
      mark = { a: { x: c.x + ty * MARK, y: c.y - tx * MARK }, b: { x: c.x - ty * MARK, y: c.y + tx * MARK }, c };
    }
  }
  // Bend preview: the influence ring at the pointer and the point that will move.
  let grab: { x: number; y: number } | null = null;
  if (mode === 'bend' && hover) {
    const p = screenToDocument({ x: hover.x + rect().left, y: hover.y + rect().top }, view, rect()), g = drag.current;
    const q = g?.kind === 'bend' ? worldPoints(layerStrokes()[g.si])[g.point] : nearestPoint(layerStrokes(), strokes, p.x, p.y, (REACH * 2) / view.zoom);
    if (q) grab = scr(q[0], q[1]);
  }
  const live = layerStrokes();
  return <svg ref={ref} className={`stroke-ruler shape-knots path-tools is-${mode}`} style={mode === 'move' ? { pointerEvents: 'none' } : undefined} aria-label={`Stroke ${mode} tool`} onPointerDown={mode === 'move' ? undefined : down} onPointerMove={mode === 'move' ? undefined : move} onPointerUp={end} onPointerCancel={end} onPointerLeave={() => { if (!cut.current) setHover(null); }}>
    {mode !== 'move' && <rect className="path-tools-hit" x="0" y="0" width="100%" height="100%" />}
    {mode === 'move' && strokes.map((picked) => {
      const si = live.findIndex((s) => s.id === picked.id), s = live[si];
      return s ? strokeHandles(s).map((i) => { const q = worldPoints(s)[i]; if (!q) return null; const c = scr(q[0], q[1]);
        return <circle key={`${s.id}:${i}`} className="stroke-ruler-handle" cx={c.x} cy={c.y} r={5} onPointerDown={(e) => { if (e.button === 0) begin(e, si, i); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />; }) : null;
    })}
    {mark && <><line className="cut-mark" x1={mark.a.x} y1={mark.a.y} x2={mark.b.x} y2={mark.b.y} /><circle className="cut-dot" cx={mark.c.x} cy={mark.c.y} r={3.5} /></>}
    {mode === 'cut' && trail && <line className="cut-rubber" x1={trail[0].x} y1={trail[0].y} x2={trail[1].x} y2={trail[1].y} />}
    {mode === 'bend' && hover && <><circle className="influence-ring" cx={hover.x} cy={hover.y} r={influence * view.zoom} data-influence-radius={influence} />{grab && <circle className="influence-dot" cx={grab.x} cy={grab.y} r={4} />}</>}
    {mode === 'erase' && hover && <><circle className="erase-halo" cx={hover.x} cy={hover.y} r={radiusPx} /><circle className="erase-ring" cx={hover.x} cy={hover.y} r={radiusPx} data-erase-radius={radiusPx} /></>}
  </svg>;
}

/** The picked stroke point nearest to (x, y) within `tol` (beyond half the stroke width): what a Bend drag there would move. */
function nearestGrab(all: Stroke[], picked: Stroke[], x: number, y: number, tol: number): { si: number; point: number; d: number } | null {
  let best: { si: number; point: number; d: number } | null = null;
  all.forEach((s, si) => { if (!picked.some((q) => q.id === s.id)) return; worldPoints(s).forEach(([px, py], point) => { const d = Math.hypot(px - x, py - y); if (d <= tol + s.size / 2 && (!best || d < best.d)) best = { si, point, d }; }); });
  return best;
}
function nearestPoint(all: Stroke[], picked: Stroke[], x: number, y: number, tol: number): [number, number] | null {
  const b = nearestGrab(all, picked, x, y, tol);
  const q = b && worldPoints(all[b.si])[b.point];
  return q ? [q[0], q[1]] : null;
}
