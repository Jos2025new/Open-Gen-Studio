import { useRef } from 'react';
import type { DesignDoc, VectorShape } from '../../engine/types';
import type { GradientPaint } from '../../engine/shapeSpec';
import { getDoc } from '../../engine/design/actions';
import { primKnotDrag, primKnots, type PrimKnot, type Pt } from '../../engine/design/primKnots';
import { gradientKnots, moveGradientKnot } from '../../engine/design/gradientPaint';
import { toLocal, toPage } from '../../engine/design/shapeTransform';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';
import { patchShape, usePickedShape } from './ShapeLookFields';

/*
 * Handles for the two parametric things a shape can carry: a primitive's parameters (ShapeKnots shows them in
 * edit mode, as Rx/Ry are shown on a rectangle) and an editable gradient's points (shown on a selected shape). A
 * drag is one undo step: the first change records it, the rest of the drag joins it (as ShapeKnots does).
 */


const TIP: Record<PrimKnot, string> = {
  outer: 'Outer radius · drag to scale the shape from its centre',
  inner: 'Inner radius · the star points in or out',
  round: 'Corner rounding · drag along the edge (0 = sharp)',
  from: 'Start angle · Ctrl snaps to 15°',
  to: 'End angle · Ctrl snaps to 15°',
};

/** Handles of a primitive, in the shape's own coordinates (a turned shape turns them with it). */
export function PrimKnots({ view, sessionId, docId, layerId, shape }: { view: View; sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ knot: PrimKnot; moved: boolean } | null>(null);
  const page = (e: { clientX: number; clientY: number }) => screenToDocument({ x: e.clientX, y: e.clientY }, view, ref.current!.getBoundingClientRect());
  const scr = (p: Pt) => { const [x, y] = toPage(shape, p[0], p[1]); return documentToScreen({ x, y }, view, { left: 0, top: 0 }); };
  const own = (sh: VectorShape, e: { clientX: number; clientY: number }): Pt => { const q = page(e); return toLocal(sh, q.x, q.y); };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const cur = getDoc(sessionId, docId)?.layers.find((l) => l.id === layerId);
    const sh = cur?.type === 'vector' ? cur.shapes.find((x) => x.id === shape.id) : undefined;
    if (!sh) return;
    const patch = primKnotDrag(sh, d.knot, own(sh, e), e.ctrlKey || e.metaKey);
    if (!patch) return;
    patchShape(sessionId, docId, layerId, shape.id, patch, { record: !d.moved });
    d.moved = true;
  };
  return <svg ref={ref} className="stroke-ruler shape-knots" aria-label="Primitive handles">
    {primKnots(shape).map(({ k, p }) => {
      const c = scr(p);
      return <circle key={k} className="stroke-ruler-handle shape-knot" data-knot={k} data-tip={TIP[k]} cx={c.x} cy={c.y} r={5}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { knot: k, moved: false };
        }}
        onPointerMove={move}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }} />;
    })}
  </svg>;
}

/** Handles of the selected shape's gradients: start and end (linear) or centre and radius (radial), for fill and stroke. */
export function GradientKnots({ view, sessionId, doc }: { view: View; sessionId: string; doc: DesignDoc }) {
  const picked = usePickedShape(doc);
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ k: 'p1' | 'p2'; side: 'fill' | 'stroke'; layerId: string; id: string; moved: boolean } | null>(null);
  if (!picked) return null;
  const s = picked.shape;
  const sides: Array<['fill' | 'stroke', GradientPaint]> = [];
  if (s.fillGradient) sides.push(['fill', s.fillGradient]);
  if (s.strokeGradient) sides.push(['stroke', s.strokeGradient]);
  if (!sides.length) return null;
  const page = (e: { clientX: number; clientY: number }) => screenToDocument({ x: e.clientX, y: e.clientY }, view, ref.current!.getBoundingClientRect());
  const scr = (p: [number, number]) => documentToScreen({ x: p[0], y: p[1] }, view, { left: 0, top: 0 });
  const key = (side: 'fill' | 'stroke') => (side === 'fill' ? 'fillGradient' : 'strokeGradient') as 'fillGradient' | 'strokeGradient';
  return <svg ref={ref} className="stroke-ruler shape-knots" aria-label="Gradient handles">
    {sides.flatMap(([side, g]) => gradientKnots(g).map(({ k, p }) => {
      const c = scr(p);
      return <circle key={`${side}-${k}`} className="stroke-ruler-handle shape-knot" data-knot={`${side}-${k}`} data-tip={`${side === 'fill' ? 'Fill' : 'Stroke'} gradient ${k === 'p1' ? (g.kind === 'radial' ? 'centre' : 'start') : g.kind === 'radial' ? 'radius' : 'end'} · drag to move`} cx={c.x} cy={c.y} r={5}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { k, side, layerId: picked.layerId, id: s.id, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const cur = getDoc(sessionId, doc.id)?.layers.find((l) => l.id === d.layerId);
          const sh = cur?.type === 'vector' ? cur.shapes.find((x) => x.id === d.id) : undefined;
          const gg = sh?.[key(d.side)];
          if (!gg) return;
          const q = page(e);
          patchShape(sessionId, doc.id, d.layerId, d.id, { [key(d.side)]: moveGradientKnot(gg, d.k, [q.x, q.y]) }, { record: !d.moved });
          d.moved = true;
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }} />;
    }))}
  </svg>;
}
