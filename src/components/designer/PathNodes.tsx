import { useEffect, useRef } from 'react';
import type { VectorShape } from '../../engine/types';
import { deleteNode, insertNode, moveNodePoint, nearestOnPath, nodePoints, nodeSegs, pageSegs, readTypes, serializeSegs, setNodeType, withSegs, writeTypes, type NodePoint, type NodeType, type Seg } from '../../engine/design/pathNodes';
import { setShapeEdit, useShapeEdit } from '../../engine/design/objectSelection';
import { getDoc } from '../../engine/design/actions';
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
  const segs = pageSegs(shape), types = readTypes(segs, shape.nodeTypes);
  const edit = useShapeEdit((st) => st.byDoc[docId]), picked = edit?.shapeId === shape.id ? edit.node : undefined;
  // Inkscape's Shift+C / Shift+S / Shift+Y on the picked node; not while typing in a field.
  useEffect(() => {
    if (picked == null) return;
    const key = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const t = ({ c: 'c', s: 's', y: 'z' } as Record<string, NodeType>)[e.key.toLowerCase()];
      if (t) { e.preventDefault(); setPathNodeType(sessionId, docId, layerId, shape, picked, t); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [picked, sessionId, docId, layerId, shape]);
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
    const next = withSegs(d.shape, moveNodePoint(d.base, d.pt, q.x - d.from.x, q.y - d.from.y, types));
    patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h }, { record: !d.moved });
    d.moved = true;
  };
  // The outline on screen: double-click on it adds a node there (Inkscape), keeping the curve.
  const outline = serializeSegs(segs.map((g) => ({ c: g.c, p: g.p.map((q) => { const c = scr(q); return [c.x, c.y] as [number, number]; }) })));
  const addAt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const q = page(e), hit = nearestOnPath(segs, [q.x, q.y]);
    if (!hit || hit.dist * view.zoom > 8) return;
    const r = insertNode(segs, types, hit), next = withSegs(shape, r.segs);
    patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(r.segs, r.types) });
    if (edit) setShapeEdit(docId, { ...edit, node: r.node });
  };
  return <svg ref={ref} className="stroke-ruler shape-knots path-nodes" aria-label="Path nodes">
    <path className="path-outline" d={outline} data-tip="Double-click to add a node" onDoubleClick={addAt} />
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
          // Same spot in the path's own geometry (paths keep 2 decimals), not on screen: at low zoom distinct nodes
          // can share a screen pixel and must not cycle (review of f8d15c2).
          const at0 = nodes[0]?.at, same = nodes.filter((q) => at0 && Math.hypot(q.at[0] - at0[0], q.at[1] - at0[1]) < 0.01);
          const key = same.map((q) => q.seg).join(',');
          turn.current = { at: key, i: turn.current.at === key ? (turn.current.i + 1) % Math.max(1, same.length) : 0 };
          const pt = same[turn.current.i] ?? p;
          drag.current = { pt, base: segs, shape, from: page(e), moved: false };
          // A node pressed becomes the picked one (its type in the bar, Delete removes it).
          if (pt.kind === 'node' && edit) setShapeEdit(docId, { ...edit, node: nodeSegs(segs).seg.indexOf(pt.seg) });
        },
        onPointerMove: move, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; },
      };
      return p.kind === 'node'
        ? <rect key={`n${p.seg}`} className={`stroke-ruler-handle shape-knot path-node${nodeSegs(segs).seg.indexOf(p.seg) === picked ? ' is-picked' : ''}`} data-node={p.seg} data-tip="Node · drag to move it with its handles" x={c.x - 4.5} y={c.y - 4.5} width={9} height={9} {...handlers} />
        : <circle key={`h${p.seg}-${p.k}`} className="stroke-ruler-handle shape-knot path-handle" data-handle={`${p.seg}-${p.k}`} data-tip="Curve handle · drag to shape the curve" cx={c.x} cy={c.y} r={4} {...handlers} />;
    })}
  </svg>;
}

/** Make node `n` cusp, smooth or symmetric (handles realigned as Inkscape does), one undo step. */
export function setPathNodeType(sessionId: string, docId: string, layerId: string, shape: VectorShape, n: number, t: NodeType): void {
  const segs = pageSegs(shape), types = readTypes(segs, shape.nodeTypes);
  if (n < 0 || n >= types.length) return;
  types[n] = t;
  const next = withSegs(shape, setNodeType(segs, n, t));
  patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(segs, types) });
}

/** Delete the picked node of the path being edited (one undo step). True when a node was picked (the key is used
    for it even if the path cannot lose that node), so Delete never falls through to the layer. */
export function deletePickedNode(sessionId: string, docId: string): boolean {
  const edit = useShapeEdit.getState().byDoc[docId];
  if (edit?.node == null) return false;
  const l = getDoc(sessionId, docId)?.layers.find((x) => x.id === edit.layerId), shape = l?.type === 'vector' ? l.shapes.find((x) => x.id === edit.shapeId) : undefined;
  if (!shape || shape.type !== 'path') return false;
  const segs = pageSegs(shape), r = deleteNode(segs, readTypes(segs, shape.nodeTypes), edit.node);
  if (r) {
    const next = withSegs(shape, r.segs);
    patchShape(sessionId, docId, edit.layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(r.segs, r.types) });
  }
  setShapeEdit(docId, { ...edit, node: undefined });
  return true;
}
