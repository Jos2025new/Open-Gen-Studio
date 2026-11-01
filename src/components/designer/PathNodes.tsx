import { useEffect, useRef, useState } from 'react';
import type { VectorShape } from '../../engine/types';
import { marqueeNodeSelection, moveNodePoint, moveSelectedNodes, nodePoints, nodeSegs, pageSegs, readTypes, serializeSegs, toggleNodeSelection, withSegs, writeTypes, type NodePoint, type NodeType, type Seg } from '../../engine/design/pathNodes';
import { alignNode, focusNodes, nodePosition, pullHandle } from '../../engine/design/nodeTypes';
import { bendSegment } from '../../engine/design/bendSegment';
import { roundNode, sharpenNode } from '../../engine/design/bendNode';
import { useNodeEditMode } from '../../engine/design/nodeEditMode';
import { dragSegment, nearestSegment } from '../../engine/design/segmentDrag';
import { breakNodes, deleteSegments, joinEnds, segmentsTo, deleteSelectedNodes, insertNode, nearestOnPath } from '../../engine/design/pathNodeOps';
import { setShapeEdit, useShapeEdit } from '../../engine/design/objectSelection';
import { getDoc, patchLayer } from '../../engine/design/actions';
import { toLocal, toPage } from '../../engine/design/shapeTransform';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';
import { patchShape } from './ShapeLookFields';
import { snapOptsFor } from '../../engine/design/snap';
import { pathNodeTargets, PathNodeSnapSession } from '../../engine/design/snapNodes';
import { useStore } from '../../store/store';
import { snapIdleFeed, snapIdleStart, snapIdleStop } from './snapIdle';
import { boardKey } from './boardKey';
import { PathNodeTools } from './PathNodeTools';
import { SelectLayer, useSelectKeys } from './SelectLayer';
import { deleteBySelection } from './selectModeActions';

/*
 * Inkscape's Node tool on a path shape in edit mode (docs/plan-edicion-formas.md): square nodes, round handles on
 * thin lines to their node. Dragging a node carries its handles; dragging a handle shapes the curve. One undo step
 * per drag. Formulas: engine/design/pathNodes.ts.
 */
export function PathNodes({ view, sessionId, docId, layerId, shape }: { view: View; sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind?: 'pathNode'; pt?: NodePoint; base: Seg[]; shape: VectorShape; from: { x: number; y: number }; moved: boolean; selected: number[]; initialSelected: number[]; types: NodeType[]; mods: { shift: boolean; ctrl: boolean }; start?: { x: number; y: number }; screenStart?: { x: number; y: number }; snapNode?: PathNodeSnapSession } | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Nodes on the same spot (an arrow's tip): each press there picks the next one, as Inkscape cycles with Alt.
  const turn = useRef<{ at: string; i: number }>({ at: '', i: 0 });
  // A drag on a segment bends it (segmentDrag.ts); a Shift-drag from a node pulls one of its handles out (nodeTypes.ts).
  const [hoverSeg, setHoverSeg] = useState<number | null>(null); // Bend mode: the segment under the pointer (or being bent)
  const segDrag = useRef<{ i: number; t: number; base: Seg[]; shape: VectorShape; moved: boolean } | null>(null);
  // Segments in the path's own coordinates; a converted shape's turn (rot) maps them to the page, both ways.
  const mode = useNodeEditMode((st) => st.mode), bend = mode === 'bend', pickMode = useNodeEditMode((st) => st.select), selMode = mode === 'move' || mode === 'lasso' ? pickMode : 'node', picking = mode === 'move' && selMode !== 'node';
  const segs = pageSegs(shape), types = readTypes(segs, shape.nodeTypes);
  const edit = useShapeEdit((st) => st.byDoc[docId]), selected = edit?.shapeId === shape.id ? (edit.nodes ?? (edit.node == null ? [] : [edit.node])) : [], picked = selected[0];
  useSelectKeys(docId, shape, !!edit && edit.shapeId === shape.id && (mode === 'move' || mode === 'lasso'));
  // Inkscape's Shift+C / Shift+S / Shift+Y on the picked node; not while typing in a field.
  useEffect(() => {
    if (!edit || edit.shapeId !== shape.id) return;
    const key = (e: KeyboardEvent) => {
      if (!boardKey(e)) return;
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
        if (selected.length && !deleteBySelection(sessionId, docId, layerId, shape, selMode, (ids) => setDeleteSegments(sessionId, docId, layerId, shape, selected, ids))) deletePathNodes(sessionId, docId, layerId, shape, selected, mod ? 'line' : 'auto');
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
      // Alt+J: join selected ends with a segment; Shift+J (below): merge them (Inkscape).
      if (e.altKey && !e.shiftKey && !mod && e.key.toLowerCase() === 'j') { stop(); setJoinEnds(sessionId, docId, layerId, shape, selected, 'segment'); return; }
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 'j') { stop(); setJoinEnds(sessionId, docId, layerId, shape, selected, 'merge'); return; }
      // Shift+B: break at the selected nodes (the B tool key never fires here).
      if (e.key.toLowerCase() === 'b') { stop(); setBreakNodes(sessionId, docId, layerId, shape, selected); return; }
      // Shift+L / Shift+U: segments to line / curve; taken here so the L and U tool keys never fire.
      const seg = ({ l: 'line', u: 'curve' } as Record<string, 'line' | 'curve'>)[e.key.toLowerCase()];
      if (seg) { stop(); setSegmentsTo(sessionId, docId, layerId, shape, selected, seg); return; }
      const t = ({ c: 'c', s: 's', y: 'z' } as Record<string, NodeType>)[e.key.toLowerCase()];
      if (t && picked != null) { stop(); setPathNodeType(sessionId, docId, layerId, shape, picked, t); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [edit, selected.join(','), picked, sessionId, docId, layerId, shape, segs, types, view.zoom]);
  const scrT = (p: [number, number]): [number, number] => { const c = scr(p); return [c.x, c.y]; };
  const scr = (p: [number, number]) => { const [x, y] = toPage(shape, p[0], p[1]); return documentToScreen({ x, y }, view, { left: 0, top: 0 }); };
  // Pointer → own coordinates of `sh`: during a drag always the shape at its start (review: mixing it with the
  // current one drifted the other nodes).
  const page = (e: { clientX: number; clientY: number }, sh: VectorShape = shape) => { const q = screenToDocument({ x: e.clientX, y: e.clientY }, view, ref.current!.getBoundingClientRect()); const [x, y] = toLocal(sh, q.x, q.y); return { x, y }; };
  // Handles under nodes, and none that sit on their node (Inkscape hides zero-length handles): a node is always
  // what a click on it picks.
  // The handles of the selected nodes and their neighbours always show, even when retracted (Inkscape); the others
  // show when they stick out (≥ 6 px).
  const focus = focusNodes(segs, selected).map((n) => nodePosition(segs, n));
  const focused = (q: NodePoint) => focus.some((f) => Math.hypot(f[0] - q.from![0], f[1] - q.from![1]) < 1e-6);
  const all = nodePoints(segs).filter((p) => p.kind === 'node' || focused(p) || (() => { const a = scr(p.at), b = scr(p.from!); return Math.hypot(a.x - b.x, a.y - b.y) >= 6; })());
  const pts = [...all.filter((p) => p.kind === 'handle'), ...all.filter((p) => p.kind === 'node')];
  const move = (e: React.PointerEvent) => {
    const sd = segDrag.current;
    if (sd) {
      const q = page(e, sd.shape), next = withSegs(sd.shape, (bend ? bendSegment : dragSegment)(sd.base, sd.i, sd.t, [q.x, q.y]));
      patchShape(sessionId, docId, layerId, sd.shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h }, { record: !sd.moved });
      sd.moved = true; setHoverSeg(sd.i);
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (bend && d.pt && d.pt.kind !== 'node') return; // Bend mode: only nodes respond (they round); handles stay put
    const q = page(e, d.shape);
    if (d.start) {
      const x = e.clientX - ref.current!.getBoundingClientRect().left, y = e.clientY - ref.current!.getBoundingClientRect().top;
      if (Math.hypot(x - d.start.x, y - d.start.y) > 2) { d.moved = true; setBox({ x: Math.min(d.start.x, x), y: Math.min(d.start.y, y), w: Math.abs(x - d.start.x), h: Math.abs(y - d.start.y) }); }
      return;
    }
    if (!d.pt) return;
    if (!d.moved && d.pt.kind === 'node' && d.screenStart && Math.hypot(e.clientX - d.screenStart.x, e.clientY - d.screenStart.y) <= 2) return;
    if (bend) { // Bend mode: pull mirrored handles out of the node (it turns smooth), from the segments at the start
      const n = nodeSegs(d.base).seg.indexOf(d.pt.seg), r = roundNode(d.base, n, q.x - d.from.x, q.y - d.from.y), tp = [...d.types];
      tp[n] = r.type;
      const next = withSegs(d.shape, r.segs);
      patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(r.segs, tp) }, { record: !d.moved });
      d.moved = true;
      return;
    }
    if (d.pt.kind === 'node' && d.snapNode) {
      if (e.altKey) snapIdleStop();
      else snapIdleFeed(d, e, (replay) => move(replay as React.PointerEvent));
    }
    // Each frame from the segments at the start of the drag: no drift; the first change records the undo step.
    // From the shape at the start of the drag (review of 480cfc3: the current one compounded the turn correction).
    const n0 = d.pt.kind === 'node' ? nodeSegs(d.base).seg.indexOf(d.pt.seg) : -1;
    let dx = q.x - d.from.x, dy = q.y - d.from.y;
    if (d.pt.kind === 'node' && d.snapNode && !e.altKey) {
      const target = d.snapNode.step([d.pt.at[0] + dx, d.pt.at[1] + dy], { x: e.clientX, y: e.clientY }, e.timeStamp);
      if (target) { dx = target[0] - d.pt.at[0]; dy = target[1] - d.pt.at[1]; }
    }
    const nextSegs = d.mods.shift && n0 >= 0 ? pullHandle(d.base, n0, n0 === nodeSegs(d.base).seg.length - 1 ? 'in' : 'out', dx, dy)
      : d.pt.kind === 'node' && d.selected.length > 1 ? moveSelectedNodes(d.base, d.selected, dx, dy, d.types) : moveNodePoint(d.base, d.pt, dx, dy, d.types);
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
      const n = nodeSegs(d.base).seg.indexOf(d.pt.seg);
      if (bend) { // a click on a node with handles makes it a sharp corner (one undo step; none when it is sharp already)
        const sharp = sharpenNode(d.base, n), tp = [...d.types];
        if (sharp) { tp[n] = 'c'; const next = withSegs(d.shape, sharp); patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(sharp, tp) }); }
      }
      const nodes = d.mods.shift ? toggleNodeSelection(d.initialSelected, n) : [n];
      setShapeEdit(docId, { ...edit!, node: nodes[0], nodes });
    }
    drag.current = null; snapIdleStop(); setBox(null);
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
  return <><svg ref={ref} className={`stroke-ruler shape-knots path-nodes${bend ? ' is-bend' : ''}${picking ? ' is-sel' : ''}`} aria-label="Path nodes" onPointerDown={(e) => {
    if (e.button !== 0 || !(e.target instanceof SVGRectElement && e.target.classList.contains('node-marquee-hit'))) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { base: segs, shape, from: page(e), moved: false, selected: [...selected], initialSelected: [...selected], types: [...types], mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }, start: { x: e.clientX - ref.current!.getBoundingClientRect().left, y: e.clientY - ref.current!.getBoundingClientRect().top } };
  }} onDoubleClick={(e) => { if (!(e.target instanceof Element && e.target.closest('.path-node, .path-handle'))) addAt(e); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null; snapIdleStop(); setBox(null); }}>
    <rect className="node-marquee-hit" x="0" y="0" width="100%" height="100%" />
    {(mode === 'move' || mode === 'lasso') && <SelectLayer svg={ref} sessionId={sessionId} docId={docId} layerId={layerId} shape={shape} segs={segs} types={types} edit={edit} mode={selMode} interactive={picking} scr={scr} page={page} />}
    {box && <rect className="node-marquee" x={box.x} y={box.y} width={box.w} height={box.h} />}
    <path className="path-outline" d={outline} data-tip="Double-click to add a node" onDoubleClick={addAt} />
    {/* A wide invisible band over the outline: grab any point of a segment to bend it (the cursor says so). */}
    {bend && hoverSeg != null && segs[hoverSeg - 1] && segs[hoverSeg] && ['L', 'C'].includes(segs[hoverSeg].c) && <path className="bend-hl" d={serializeSegs([{ c: 'M', p: [scrT(segs[hoverSeg - 1].p[segs[hoverSeg - 1].p.length - 1])] }, { c: segs[hoverSeg].c, p: segs[hoverSeg].p.map(scrT) }])} />}
    <path className="segment-hit" d={outline} fill="none" stroke="transparent" strokeWidth={bend ? 14 : 10} style={bend ? undefined : picking ? { pointerEvents: 'none' } : { cursor: 'move' }} data-tip={bend ? 'Drag so the curve passes through the pointer' : 'Drag to bend this segment · double-click to add a node'}
      onPointerMove={(e) => { if (!bend) return; if (segDrag.current) return setHoverSeg(segDrag.current.i); const q = page(e), r = nearestSegment(segs, [q.x, q.y]); setHoverSeg(r ? r.i : null); }}
      onPointerLeave={() => { if (!segDrag.current) setHoverSeg(null); }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const q = page(e), r = nearestSegment(segs, [q.x, q.y]);
        if (!r) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        segDrag.current = { i: r.i, t: r.t, base: segs, shape, moved: false };
      }}
      onPointerUp={() => { segDrag.current = null; }} onPointerCancel={() => { segDrag.current = null; setHoverSeg(null); }} />
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
          const doc = getDoc(sessionId, docId), snap = doc && snapOptsFor(doc, useStore.getState().ui.snapByMode);
          const snapNode = doc && pt.kind === 'node' && snap?.on && snap.nodes !== false && !e.altKey && !e.shiftKey
            ? new PathNodeSnapSession(pathNodeTargets(doc, shape.id, pt.at), view.zoom, { x: e.clientX, y: e.clientY, t: e.timeStamp }) : undefined;
          drag.current = { kind: snapNode ? 'pathNode' : undefined, pt, base: segs, shape, from: page(e), moved: false, selected: group, initialSelected: [...selected], types: [...types], mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }, screenStart: { x: e.clientX, y: e.clientY }, snapNode };
          if (snapNode) snapIdleStart(drag.current, e);
          if (pt.kind === 'node' && edit && !selected.includes(n)) setShapeEdit(docId, { ...edit, node: group[0], nodes: group });
        },
        onPointerCancel: () => { drag.current = null; snapIdleStop(); setBox(null); },
      };
      return p.kind === 'node'
        ? <rect key={`n${p.seg}`} className={`stroke-ruler-handle shape-knot path-node${selected.includes(nodeSegs(segs).seg.indexOf(p.seg)) ? ' is-picked' : ''}${selMode !== 'node' ? ' is-dim' : ''}`} data-node={p.seg} data-tip="Node · Shift-click to add or remove · drag selected nodes together" x={c.x - (selMode === 'node' ? 4.5 : 3)} y={c.y - (selMode === 'node' ? 4.5 : 3)} width={selMode === 'node' ? 9 : 6} height={selMode === 'node' ? 9 : 6} {...handlers} />
        : <circle key={`h${p.seg}-${p.k}`} className="stroke-ruler-handle shape-knot path-handle" data-handle={`${p.seg}-${p.k}`} data-tip="Curve handle · drag to shape the curve" cx={c.x} cy={c.y} r={4} {...handlers} />;
    })}
  </svg>{(mode === 'cut' || mode === 'erase' || mode === 'lasso') && <PathNodeTools mode={mode} view={view} sessionId={sessionId} docId={docId} layerId={layerId} shape={shape} selected={selected} />}</>;
}

/** Make node `n` cusp, smooth or symmetric (handles realigned as Inkscape does), one undo step. */
export function setPathNodeType(sessionId: string, docId: string, layerId: string, shape: VectorShape, n: number, t: NodeType): void {
  const segs = pageSegs(shape), types = readTypes(segs, shape.nodeTypes);
  if (n < 0 || n >= types.length) return;
  types[n] = t;
  const next = withSegs(shape, alignNode(segs, n, t));
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

/** Segments between selected neighbouring nodes to line or curve (Shift+L / Shift+U), one undo step. */
export function setSegmentsTo(sessionId: string, docId: string, layerId: string, shape: VectorShape, selected: number[], to: 'line' | 'curve'): void {
  const segs = pageSegs(shape), r = segmentsTo(segs, readTypes(segs, shape.nodeTypes), selected, to);
  if (!r) return;
  const next = withSegs(shape, r.segs);
  patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(r.segs, r.types) });
}

/** Join selected ends, or weld adjacent nodes if there are no end pairs (Shift+J; Alt+J only joins ends), one undo step; the joined nodes stay selected. */
export function setJoinEnds(sessionId: string, docId: string, layerId: string, shape: VectorShape, selected: number[], how: 'merge' | 'segment'): void {
  const segs = pageSegs(shape), r = joinEnds(segs, readTypes(segs, shape.nodeTypes), selected, how);
  if (!r) return;
  const next = withSegs(shape, r.segs);
  patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(r.segs, r.types) });
  const edit = useShapeEdit.getState().byDoc[docId];
  if (edit) setShapeEdit(docId, { ...edit, node: r.nodes[0], nodes: r.nodes });
}

/** Break the path at the selected nodes (Shift+B), one undo step; the new pieces' first nodes stay selected. */
export function setBreakNodes(sessionId: string, docId: string, layerId: string, shape: VectorShape, selected: number[]): void {
  const segs = pageSegs(shape), r = breakNodes(segs, readTypes(segs, shape.nodeTypes), selected);
  if (!r) return;
  const next = withSegs(shape, r.segs);
  patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(r.segs, r.types) });
  const edit = useShapeEdit.getState().byDoc[docId];
  if (edit) setShapeEdit(docId, { ...edit, node: r.nodes[0], nodes: r.nodes });
}

/** Delete selected segments as one undo step; retain the selected surviving endpoints by their new indices. */
export function setDeleteSegments(sessionId: string, docId: string, layerId: string, shape: VectorShape, selected: number[], only?: number[]): void {
  const segs = pageSegs(shape), r = deleteSegments(segs, readTypes(segs, shape.nodeTypes), selected, only);
  if (!r) return;
  if (!r.segs.length) {
    const layer = getDoc(sessionId, docId)?.layers.find((l) => l.id === layerId);
    if (layer?.type === 'vector') patchLayer(sessionId, docId, layerId, { shapes: layer.shapes.filter((s) => s.id !== shape.id) });
    setShapeEdit(docId, null);
    return;
  }
  const next = withSegs(shape, r.segs);
  patchShape(sessionId, docId, layerId, shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h, nodeTypes: writeTypes(r.segs, r.types) });
  const edit = useShapeEdit.getState().byDoc[docId];
  if (edit) setShapeEdit(docId, { ...edit, node: r.nodes[0], nodes: r.nodes });
}
