import { useRef } from 'react';
import type { VectorShape } from '../../engine/types';
import { moveNodePoint, nodePoints, pageSegs, withSegs, type NodePoint, type Seg } from '../../engine/design/pathNodes';
import { toLocal, toPage } from '../../engine/design/shapeTransform';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';
import { patchShape } from './ShapeLookFields';

/*
 * Inkscape's Node tool on a path shape in edit mode (docs/plan-edicion-formas.md): square nodes, round handles on
 * thin lines to their node. Dragging a node carries its handles; dragging a handle shapes the curve. One undo step
 * per drag. Formulas: engine/design/pathNodes.ts.
 */
export function PathNodes({ view, sessionId, docId, layerId, shape }: { view: View; sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pt: NodePoint; base: Seg[]; shape: VectorShape; from: { x: number; y: number }; moved: boolean } | null>(null);
  // Nodes on the same spot (an arrow's tip): each press there picks the next one, as Inkscape cycles with Alt.
  const turn = useRef<{ at: string; i: number }>({ at: '', i: 0 });
  // Segments in the path's own coordinates; a converted shape's turn (rot) maps them to the page, both ways.
  const segs = pageSegs(shape);
  const scr = (p: [number, number]) => { const [x, y] = toPage(shape, p[0], p[1]); return documentToScreen({ x, y }, view, { left: 0, top: 0 }); };
  // Pointer → own coordinates of `sh`: during a drag always the shape at its start (review: mixing it with the
  // current one drifted the other nodes).
  const page = (e: { clientX: number; clientY: number }, sh: VectorShape = shape) => { const q = screenToDocument({ x: e.clientX, y: e.clientY }, view, ref.current!.getBoundingClientRect()); const [x, y] = toLocal(sh, q.x, q.y); return { x, y }; };
  // Handles under nodes, and none that sit on their node (Inkscape hides zero-length handles): a node is always
  // what a click on it picks.
  const all = nodePoints(segs).filter((p) => p.kind === 'node' || (() => { const a = scr(p.at), b = scr(p.from!); return Math.hypot(a.x - b.x, a.y - b.y) >= 6; })());
  const pts = [...all.filter((p) => p.kind === 'handle'), ...all.filter((p) => p.kind === 'node')];
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const q = page(e, d.shape);
    // Each frame from the segments at the start of the drag: no drift; the first change records the undo step.
    // From the shape at the start of the drag (review of 480cfc3: the current one compounded the turn correction).
    const next = withSegs(d.shape, moveNodePoint(d.base, d.pt, q.x - d.from.x, q.y - d.from.y));
    patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h }, { record: !d.moved });
    d.moved = true;
  };
  return <svg ref={ref} className="stroke-ruler shape-knots path-nodes" aria-label="Path nodes">
    <g className="shape-knot-lines">{pts.filter((p) => p.kind === 'handle').map((p) => { const a = scr(p.from!), b = scr(p.at); return <line key={`l${p.seg}-${p.k}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />; })}</g>
    {pts.map((p) => {
      const c = scr(p.at), handlers = {
        onPointerDown: (e: React.PointerEvent<SVGElement>) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          // By proximity, nodes first (review: at small zoom a handle or another node could take the click).
          const sc = { x: e.clientX - ref.current!.getBoundingClientRect().left, y: e.clientY - ref.current!.getBoundingClientRect().top };
          const near = (q: NodePoint) => { const c = scr(q.at); return Math.hypot(c.x - sc.x, c.y - sc.y); };
          const nodes = pts.filter((q) => q.kind === 'node' && near(q) <= 8).sort((a, b) => near(a) - near(b));
          // Only nodes on the very same spot cycle (not ones merely as far from the pointer).
          const at0 = nodes[0] && scr(nodes[0].at), same = nodes.filter((q) => { const c = scr(q.at); return Math.hypot(c.x - at0.x, c.y - at0.y) < 0.5; });
          const key = same.map((q) => q.seg).join(',');
          turn.current = { at: key, i: turn.current.at === key ? (turn.current.i + 1) % Math.max(1, same.length) : 0 };
          drag.current = { pt: same[turn.current.i] ?? p, base: segs, shape, from: page(e), moved: false };
        },
        onPointerMove: move, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; },
      };
      return p.kind === 'node'
        ? <rect key={`n${p.seg}`} className="stroke-ruler-handle shape-knot path-node" data-node={p.seg} data-tip="Node · drag to move it with its handles" x={c.x - 4.5} y={c.y - 4.5} width={9} height={9} {...handlers} />
        : <circle key={`h${p.seg}-${p.k}`} className="stroke-ruler-handle shape-knot path-handle" data-handle={`${p.seg}-${p.k}`} data-tip="Curve handle · drag to shape the curve" cx={c.x} cy={c.y} r={4} {...handlers} />;
    })}
  </svg>;
}
