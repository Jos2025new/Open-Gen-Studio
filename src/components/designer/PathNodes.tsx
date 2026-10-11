import { useRef } from 'react';
import type { VectorShape } from '../../engine/types';
import { moveNodePoint, nodePoints, pageSegs, withSegs, type NodePoint, type Seg } from '../../engine/design/pathNodes';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';
import { patchShape } from './ShapeLookFields';

/*
 * Inkscape's Node tool on a path shape in edit mode (docs/plan-edicion-formas.md): square nodes, round handles on
 * thin lines to their node. Dragging a node carries its handles; dragging a handle shapes the curve. One undo step
 * per drag. Formulas: engine/design/pathNodes.ts.
 */
export function PathNodes({ view, sessionId, docId, layerId, shape }: { view: View; sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pt: NodePoint; base: Seg[]; from: { x: number; y: number }; moved: boolean } | null>(null);
  const segs = pageSegs(shape), pts = nodePoints(segs);
  const scr = (p: [number, number]) => documentToScreen({ x: p[0], y: p[1] }, view, { left: 0, top: 0 });
  const page = (e: { clientX: number; clientY: number }) => screenToDocument({ x: e.clientX, y: e.clientY }, view, ref.current!.getBoundingClientRect());
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const q = page(e);
    // Each frame from the segments at the start of the drag: no drift; the first change records the undo step.
    const next = withSegs(shape, moveNodePoint(d.base, d.pt, q.x - d.from.x, q.y - d.from.y));
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
          drag.current = { pt: p, base: segs, from: page(e), moved: false };
        },
        onPointerMove: move, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; },
      };
      return p.kind === 'node'
        ? <rect key={`n${p.seg}`} className="stroke-ruler-handle shape-knot path-node" data-node={p.seg} data-tip="Node · drag to move it with its handles" x={c.x - 4.5} y={c.y - 4.5} width={9} height={9} {...handlers} />
        : <circle key={`h${p.seg}-${p.k}`} className="stroke-ruler-handle shape-knot path-handle" data-handle={`${p.seg}-${p.k}`} data-tip="Curve handle · drag to shape the curve" cx={c.x} cy={c.y} r={4} {...handlers} />;
    })}
  </svg>;
}
