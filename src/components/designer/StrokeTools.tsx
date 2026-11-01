import { useEffect, useRef, useState } from 'react';
import type { DesignDoc } from '../../engine/types';
import type { Stroke } from '../../engine/strokeTypes';
import { bendStroke, strokeHandles, worldPoints } from '../../engine/design/strokes';
import { cutPickedStrokes, erasePickedStrokes, usePickedStrokes } from '../../engine/design/strokeEdit';
import { nearestOnStroke } from '../../engine/design/strokeCut';
import { getDoc, patchLayer } from '../../engine/design/actions';
import { useNodeEditMode } from '../../engine/design/nodeEditMode';
import { setShapeEdit } from '../../engine/design/objectSelection';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';
import { useStore } from '../../store/store';
import { boardKey } from './boardKey';
import '../../styles/path-tools.css';

const REACH = 12; // screen px from a stroke that a click or hover still counts as on it

/*
 * The overlay of the stroke edit row (strokeEdit.ts) for picked Lineart strokes. Move: drag the points of each
 * stroke (the neighbours follow, as Alt+drag does). Bend: drag anywhere near a stroke. Cut: click a stroke to split
 * it there. Erase: drag a circle over it. One undo step per gesture; a gesture that changes nothing records nothing.
 */
export function StrokeTools({ view, sessionId, doc }: { view: View; sessionId: string; doc: DesignDoc }) {
  const picked = usePickedStrokes(doc);
  const mode = useNodeEditMode((s) => s.mode), radiusPx = useNodeEditMode((s) => s.eraseRadius);
  const influence = useStore((s) => s.ui.lineartInfluence ?? 80);
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ kind: 'bend'; base: Stroke[]; si: number; point: number; x: number; y: number; moved: boolean } | { kind: 'erase'; last: [number, number] | null; moved: boolean } | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && boardKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); setShapeEdit(doc.id, null); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [doc.id]);
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
      let best: { si: number; point: number; d: number } | null = null;
      layerStrokes().forEach((s, si) => { if (!strokes.some((q) => q.id === s.id)) return; worldPoints(s).forEach(([x, y], point) => { const d = Math.hypot(x - p.x, y - p.y); if (d <= tol * 2 + s.size / 2 && (!best || d < best.d)) best = { si, point, d }; }); });
      if (best) begin(e, (best as { si: number }).si, (best as { point: number }).point);
    } else if (mode === 'cut') {
      e.stopPropagation();
      cutPickedStrokes(sessionId, doc.id, layerId, p.x, p.y, tol);
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
    if (g?.kind === 'erase') rub(p);
    else if (g?.kind === 'bend') {
      if (!g.moved && Math.hypot(p.x - g.x, p.y - g.y) * view.zoom < 2) return;
      const s = g.base[g.si], next = g.base.map((q, i) => (i === g.si ? bendStroke(q, g.point, p.x - g.x, p.y - g.y, Math.max(influence, s.size * 2)) : q));
      patchLayer(sessionId, doc.id, layerId, { strokes: next } as never, { record: !g.moved });
      g.moved = true;
    }
  };
  const end = () => { drag.current = null; };

  // Cut preview: a dot on the nearest picked stroke.
  const cutAt = mode === 'cut' && hover ? (() => { const p = screenToDocument({ x: hover.x + rect().left, y: hover.y + rect().top }, view, rect()); let best: { x: number; y: number; d: number } | null = null; for (const s of strokes) { const h = nearestOnStroke(s, p.x, p.y); if (h && h.distance - s.size / 2 <= REACH / view.zoom && (!best || h.distance < best.d)) best = { x: h.point[0], y: h.point[1], d: h.distance }; } return best && scr(best.x, best.y); })() : null;
  const live = layerStrokes();
  return <svg ref={ref} className={`stroke-ruler shape-knots path-tools is-${mode}`} style={mode === 'move' ? { pointerEvents: 'none' } : undefined} aria-label={`Stroke ${mode} tool`} onPointerDown={mode === 'move' ? undefined : down} onPointerMove={mode === 'move' ? undefined : move} onPointerUp={end} onPointerCancel={end} onPointerLeave={() => setHover(null)}>
    {mode !== 'move' && <rect className="path-tools-hit" x="0" y="0" width="100%" height="100%" />}
    {mode === 'move' && strokes.map((picked) => {
      const si = live.findIndex((s) => s.id === picked.id), s = live[si];
      return s ? strokeHandles(s).map((i) => { const q = worldPoints(s)[i]; if (!q) return null; const c = scr(q[0], q[1]);
        return <circle key={`${s.id}:${i}`} className="stroke-ruler-handle" cx={c.x} cy={c.y} r={5} onPointerDown={(e) => { if (e.button === 0) begin(e, si, i); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />; }) : null;
    })}
    {cutAt && <circle className="cut-dot" cx={cutAt.x} cy={cutAt.y} r={3.5} />}
    {mode === 'erase' && hover && <><circle className="erase-halo" cx={hover.x} cy={hover.y} r={radiusPx} /><circle className="erase-ring" cx={hover.x} cy={hover.y} r={radiusPx} data-erase-radius={radiusPx} /></>}
  </svg>;
}
