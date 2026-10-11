import { useEffect, useRef, useState } from 'react';
import type { VectorShape } from '../../engine/types';
import { deleteSelectedNodes, insertNode, marqueeNodeSelection, moveNodePoint, moveSelectedNodes, nearestOnPath, nodePoints, nodeSegs, pageSegs, readTypes, serializeSegs, setNodeType, toggleNodeSelection, withSegs, writeTypes, type NodePoint, type NodeType, type Seg } from '../../engine/design/pathNodes';
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
  const drag = useRef<{ pt?: NodePoint; base: Seg[]; shape: VectorShape; from: { x: number; y: number }; moved: boolean; selected: number[]; initialSelected: number[]; types: NodeType[]; mods: { shift: boolean; ctrl: boolean }; start?: { x: number; y: number }; screenStart?: { x: number; y: number } } | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Nodes on the same spot (an arrow's tip): each press there picks the next one, as Inkscape cycles with Alt.
  const turn = useRef<{ at: string; i: number }>({ at: '', i: 0 });
  // Segments in the path's own coordinates; a converted shape's turn (rot) maps them to the page, both ways.
  const segs = pageSegs(shape), types = readTypes(segs, shape.nodeTypes);
  const edit = useShapeEdit((st) => st.byDoc[docId]), selected = edit?.shapeId === shape.id ? (edit.nodes ?? (edit.node == null ? [] : [edit.node])) : [], picked = selected[0];
  // Inkscape's Shift+C / Shift+S / Shift+Y on the picked node; not while typing in a field.
  useEffect(() => {
    if (!edit || edit.shapeId !== shape.id) return;
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.popover:not(.designer-context), .lightbox')) return;
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === 'Escape') {
        stop();
        if (selected.length) setShapeEdit(docId, { ...edit, node: undefined, nodes: [] });
        else setShapeEdit(docId, null);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'a') { stop(); const all = nodeSegs(segs).seg.map((_, i) => i); setShapeEdit(docId, { ...edit, node: all[0], nodes: all }); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        stop();
        if (selected.length) deletePathNodes(sessionId, docId, layerId, shape, selected, mod ? 'line' : 'auto');
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        stop();
        if (!selected.length) return;
        const step = e.altKey ? (e.shiftKey ? 10 : 1) / view.zoom : e.shiftKey ? 20 : 2;
        const pageDx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const pageDy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const a = toLocal(shape, 0, 0), b = toLocal(shape, pageDx, pageDy);
        patchNodeGroup(sessionId, docId, layerId, shape, selected, b[0] - a[0], b[1] - a[1], types);
        return;
      }
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = ({ c: 'c', s: 's', y: 'z' } as Record<string, NodeType>)[e.key.toLowerCase()];
      if (t && picked != null) { stop(); setPathNodeType(sessionId, docId, layerId, shape, picked, t); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [edit, selected.join(','), picked, sessionId, docId, layerId, shape, segs, types, view.zoom]);
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
    if (d.start) {
      const x = e.clientX - ref.current!.getBoundingClientRect().left, y = e.clientY - ref.current!.getBoundingClientRect().top;
      if (Math.hypot(x - d.start.x, y - d.start.y) > 2) { d.moved = true; setBox({ x: Math.min(d.start.x, x), y: Math.min(d.start.y, y), w: Math.abs(x - d.start.x), h: Math.abs(y - d.start.y) }); }
      return;
    }
    if (!d.pt) return;
    if (!d.moved && d.pt.kind === 'node' && d.screenStart && Math.hypot(e.clientX - d.screenStart.x, e.clientY - d.screenStart.y) <= 2) return;
    // Each frame from the segments at the start of the drag: no drift; the first change records the undo step.
    // From the shape at the start of the drag (review of 480cfc3: the current one compounded the turn correction).
    const nextSegs = d.pt.kind === 'node' && d.selected.length > 1 ? moveSelectedNodes(d.base, d.selected, q.x - d.from.x, q.y - d.from.y, d.types) : moveNodePoint(d.base, d.pt, q.x - d.from.x, q.y - d.from.y, d.types);
    const next = withSegs(d.shape, nextSegs);
    patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h }, { record: !d.moved });
    d.moved = true;
  };
  const finish = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d?.start) {
      if (d.moved) {
        const left = Math.min(d.start.x, e.clientX - ref.current!.getBoundingClientRect().left), right = Math.max(d.start.x, e.clientX - ref.current!.getBoundingClientRect().left);
        const top = Math.min(d.start.y, e.clientY - ref.current!.getBoundingClientRect().top), bottom = Math.max(d.start.y, e.clientY - ref.current!.getBoundingClientRect().top);
        const hits = marqueeNodeSelection(d.selected, nodeSegs(d.base).seg.map((seg) => { const p = scr(d.base[seg].p[d.base[seg].p.length - 1]); return [p.x, p.y] as [number, number]; }), { left, right, top, bottom }, d.mods);
        setShapeEdit(docId, { ...edit!, node: hits[0], nodes: hits });
      } else setShapeEdit(docId, { ...edit!, node: undefined, nodes: [] });
    } else if (d?.pt?.kind === 'node' && !d.moved) {
      const n = nodeSegs(d.base).seg.indexOf(d.pt.seg), nodes = d.mods.shift ? toggleNodeSelection(d.initialSelected, n) : [n];
      setShapeEdit(docId, { ...edit!, node: nodes[0], nodes });
    }
    drag.current = null; setBox(null);
  };
  // The outline on screen: double-click on it adds a node there (Inkscape), keeping the curve.
  const outline = serializeSegs(segs.map((g) => ({ c: g.c, p: g.p.map((q) => { const c = scr(q); return [c.x, c.y] as [number, number]; }) })));
  const addAt = (e: React.MouseEvent) => {
    e.stopPropagation();
    const q = page(e), hit = nearestOnPath(segs, [q.x, q.y]);
    if (!hit || hit.dist * view.zoom > 8) return;
    const r = insertNode(segs, types, hit), next = withSegs(shape, r.segs);
    patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(r.segs, r.types) });
    if (edit) setShapeEdit(docId, { ...edit, node: r.node, nodes: [r.node] });
  };
  return <svg ref={ref} className="stroke-ruler shape-knots path-nodes" aria-label="Path nodes" onPointerDown={(e) => {
    if (e.button !== 0 || !(e.target instanceof SVGRectElement && e.target.classList.contains('node-marquee-hit'))) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { base: segs, shape, from: page(e), moved: false, selected: [...selected], initialSelected: [...selected], types: [...types], mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }, start: { x: e.clientX - ref.current!.getBoundingClientRect().left, y: e.clientY - ref.current!.getBoundingClientRect().top } };
  }} onDoubleClick={(e) => { if (!(e.target instanceof Element && e.target.closest('.path-node, .path-handle'))) addAt(e); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null; setBox(null); }}>
    <rect className="node-marquee-hit" x="0" y="0" width="100%" height="100%" />
    {box && <rect className="node-marquee" x={box.x} y={box.y} width={box.w} height={box.h} />}
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
          const n = pt.kind === 'node' ? nodeSegs(segs).seg.indexOf(pt.seg) : -1;
          const group = pt.kind === 'node' && selected.includes(n) ? selected : pt.kind === 'node' ? (e.shiftKey ? toggleNodeSelection(selected, n) : [n]) : [];
          drag.current = { pt, base: segs, shape, from: page(e), moved: false, selected: group, initialSelected: [...selected], types: [...types], mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }, screenStart: { x: e.clientX, y: e.clientY } };
          if (pt.kind === 'node' && edit && !selected.includes(n)) setShapeEdit(docId, { ...edit, node: group[0], nodes: group });
        },
        onPointerCancel: () => { drag.current = null; setBox(null); },
      };
      return p.kind === 'node'
        ? <rect key={`n${p.seg}`} className={`stroke-ruler-handle shape-knot path-node${selected.includes(nodeSegs(segs).seg.indexOf(p.seg)) ? ' is-picked' : ''}`} data-node={p.seg} data-tip="Node · Shift-click to add or remove · drag selected nodes together" x={c.x - 4.5} y={c.y - 4.5} width={9} height={9} {...handlers} />
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
export function deletePickedNode(sessionId: string, docId: string, mode: 'auto' | 'line' = 'auto'): boolean {
  const edit = useShapeEdit.getState().byDoc[docId];
  const selected = edit?.nodes ?? (edit?.node == null ? [] : [edit.node]);
  if (!edit || !selected.length) return false;
  const l = getDoc(sessionId, docId)?.layers.find((x) => x.id === edit.layerId), shape = l?.type === 'vector' ? l.shapes.find((x) => x.id === edit.shapeId) : undefined;
  if (!shape || shape.type !== 'path') return false;
  deletePathNodes(sessionId, docId, edit.layerId, shape, selected, mode);
  return true;
}

function deletePathNodes(sessionId: string, docId: string, layerId: string, shape: VectorShape, selected: number[], mode: 'auto' | 'line'): void {
  const edit = useShapeEdit.getState().byDoc[docId];
  const segs = pageSegs(shape), r = deleteSelectedNodes(segs, readTypes(segs, shape.nodeTypes), selected, mode);
  if (r) {
    const next = withSegs(shape, r.segs);
    patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(r.segs, r.types) });
  }
  if (edit) setShapeEdit(docId, { ...edit, node: undefined, nodes: [] });
}

function patchNodeGroup(sessionId: string, docId: string, layerId: string, shape: VectorShape, selected: number[], dx: number, dy: number, types: NodeType[]): void {
  const next = withSegs(shape, moveSelectedNodes(pageSegs(shape), selected, dx, dy, types));
  patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h });
}
