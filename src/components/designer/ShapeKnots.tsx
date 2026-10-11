import { useRef } from 'react';
import type { DesignDoc, VectorShape } from '../../engine/types';
import { blurKnots, clickKnot, cornerKnots, cornerRadii, dragBlur, dragRx, dragRy } from '../../engine/design/shapeLook';
import { getDoc } from '../../engine/design/actions';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';
import { patchShape, usePickedShape } from './ShapeLookFields';

/*
 * Inkscape's shape knots on the one picked shape (Edit → Objects): two round corner knots on a rectangle (Rx on the
 * top edge, Ry on the right edge; Ctrl: equal, Ctrl-click: copy, Shift-click: sharp) and, on a blurred shape, two
 * blur knots out from the top and right edges. One undo step per drag. Formulas: engine/design/shapeLook.ts.
 */
type Knot = 'rx' | 'ry' | 'top' | 'right';
const NUDGE = 10; // screen px: a zero-radius knot sits beside the corner, so the corner's scale handle stays reachable

export function ShapeKnots({ view, sessionId, doc }: { view: View; sessionId: string; doc: DesignDoc }) {
  const picked = usePickedShape(doc);
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ knot: Knot; layerId: string; shape: VectorShape; from: [number, number]; at: [number, number]; moved: boolean } | null>(null);
  if (!picked) return null;
  const s = picked.shape, rect = s.type === 'rect';
  const scr = (p: [number, number]) => documentToScreen({ x: p[0], y: p[1] }, view, { left: 0, top: 0 });
  const page = (e: { clientX: number; clientY: number }) => screenToDocument({ x: e.clientX, y: e.clientY }, view, ref.current!.getBoundingClientRect());
  const ck = rect ? cornerKnots(s) : null, bk = s.blur ? blurKnots(s) : null;
  const knots: Array<{ knot: Knot; p: [number, number]; dx?: number; dy?: number; tip: string }> = [];
  if (ck) {
    const r = cornerRadii(s), near = (v: number) => v * view.zoom < NUDGE;
    knots.push({ knot: 'rx', p: ck.rx, dx: near(r.rx) ? -NUDGE : 0, tip: 'Horizontal corner radius · Ctrl: both equal · Ctrl-click: copy to the other · Shift-click: sharp corners' });
    knots.push({ knot: 'ry', p: ck.ry, dy: near(r.ry) ? NUDGE : 0, tip: 'Vertical corner radius · Ctrl: both equal · Ctrl-click: copy to the other · Shift-click: sharp corners' });
  }
  if (bk) {
    knots.push({ knot: 'top', p: bk.top, tip: 'Blur · drag out for more' });
    knots.push({ knot: 'right', p: bk.right, tip: 'Blur · drag out for more' });
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const q = page(e), x = d.at[0] + q.x - d.from[0], y = d.at[1] + q.y - d.from[1];
    const patch = d.knot === 'rx' ? dragRx(d.shape, x, e.ctrlKey || e.metaKey) : d.knot === 'ry' ? dragRy(d.shape, y, e.ctrlKey || e.metaKey) : { blur: dragBlur(d.shape, d.knot, x, y) };
    // The first change of a drag records the undo step; the rest of the drag joins it.
    patchShape(sessionId, doc.id, d.layerId, d.shape.id, patch, { record: !d.moved });
    d.moved = true;
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || (d.knot !== 'rx' && d.knot !== 'ry')) return;
    const patch = clickKnot(d.shape, d.knot, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    if (patch) patchShape(sessionId, doc.id, d.layerId, d.shape.id, patch);
  };
  return <svg ref={ref} className="stroke-ruler shape-knots" aria-label="Shape handles">
    {bk && <g className="shape-knot-lines">
      {([[bk.edgeTop, bk.top], [bk.edgeRight, bk.right]] as const).map(([a, b], i) => { const A = scr(a), B = scr(b); return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} />; })}
    </g>}
    {knots.map((k) => { const c = scr(k.p); return <circle key={k.knot} className="stroke-ruler-handle shape-knot" data-knot={k.knot} data-tip={k.tip} cx={c.x + (k.dx ?? 0)} cy={c.y + (k.dy ?? 0)} r={5}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const cur = getDoc(sessionId, doc.id)?.layers.find((l) => l.id === picked.layerId);
        const shape = cur?.type === 'vector' ? cur.shapes.find((x) => x.id === s.id) : undefined;
        if (!shape) return;
        const q = page(e);
        drag.current = { knot: k.knot, layerId: picked.layerId, shape, from: [q.x, q.y], at: k.p, moved: false };
      }}
      onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }} />; })}
  </svg>;
}
