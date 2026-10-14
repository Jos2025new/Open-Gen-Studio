import { useEffect, useRef, useState } from 'react';
import { marqueeNodeSelection, nodeSegs, serializeSegs, toggleNodeSelection } from '../../engine/design/pathNodes';
import { editablePageSegs, movePathNodeSelections, type MultiPathTarget, type PathNodeSelection } from '../../engine/design/multiPathEdit';
import { mutateDoc } from '../../engine/design/actions';
import { setShapeEdit, useShapeEdit } from '../../engine/design/objectSelection';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';

type Drag = { kind: 'node'; start: { x: number; y: number }; screen: { x: number; y: number }; shapeId: string; node: number; paths: PathNodeSelection[]; base: MultiPathTarget[]; moved: boolean; shift: boolean }
  | { kind: 'marquee'; start: { x: number; y: number }; screen: { x: number; y: number }; paths: PathNodeSelection[]; base: MultiPathTarget[]; moved: boolean; shift: boolean; ctrl: boolean };

/** One shared node canvas avoids stacked per-path hit areas while reusing the path-node geometry and selection rules. */
export function MultiPathNodes({ view, sessionId, docId, targets }: { view: View; sessionId: string; docId: string; targets: MultiPathTarget[] }) {
  const ref = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const edit = useShapeEdit((st) => st.byDoc[docId]);
  const paths = edit?.paths ?? [];
  const screen = (p: [number, number]) => documentToScreen({ x: p[0], y: p[1] }, view, { left: 0, top: 0 });
  const page = (e: { clientX: number; clientY: number }) => screenToDocument({ x: e.clientX, y: e.clientY }, view, ref.current!.getBoundingClientRect());
  const selection = (): PathNodeSelection[] => targets.map((t) => ({ layerId: t.layerId, shapeId: t.shapeId, nodes: [...(paths.find((p) => p.shapeId === t.shapeId && p.layerId === t.layerId)?.nodes ?? [])] }));
  const setSelection = (next: PathNodeSelection[]) => setShapeEdit(docId, { ...edit!, node: undefined, nodes: [], paths: next });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (paths.some((p) => p.nodes.length)) setSelection(paths.map((p) => ({ ...p, nodes: [] })));
        else setShapeEdit(docId, null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault(); e.stopImmediatePropagation();
        setSelection(targets.map((t) => ({ layerId: t.layerId, shapeId: t.shapeId, nodes: nodeSegs(editablePageSegs(t.shape)).seg.map((_, i) => i) })));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Multi-path topology edits remain explicit per-path operations; never let Delete remove the picked objects.
        e.preventDefault(); e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [docId, paths.map((p) => `${p.shapeId}:${p.nodes.join(',')}`).join('|'), targets]);

  const commit = (d: Drag, dx: number, dy: number) => {
    const updated = movePathNodeSelections(d.base.map((t) => ({ shape: t.shape, nodes: d.paths.find((p) => p.shapeId === t.shapeId && p.layerId === t.layerId)?.nodes ?? [] })), dx, dy);
    const byId = new Map(d.base.map((t, i) => [`${t.layerId}:${t.shapeId}`, updated[i]]));
    mutateDoc(sessionId, docId, (doc) => ({ ...doc, layers: doc.layers.map((layer) => layer.type === 'vector' ? {
      ...layer, shapes: layer.shapes.map((shape) => byId.get(`${layer.id}:${shape.id}`) ?? shape),
    } : layer) }), { record: !d.moved });
    d.moved = true;
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const sc = { x: e.clientX - ref.current!.getBoundingClientRect().left, y: e.clientY - ref.current!.getBoundingClientRect().top };
    if (!d.moved && Math.hypot(sc.x - d.screen.x, sc.y - d.screen.y) <= 2) return;
    if (d.kind === 'marquee') {
      d.moved = true;
      setBox({ left: Math.min(d.screen.x, sc.x), right: Math.max(d.screen.x, sc.x), top: Math.min(d.screen.y, sc.y), bottom: Math.max(d.screen.y, sc.y) });
    } else {
      const now = page(e);
      commit(d, now.x - d.start.x, now.y - d.start.y);
    }
  };
  const finish = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d?.kind === 'marquee') {
      const sc = { x: e.clientX - ref.current!.getBoundingClientRect().left, y: e.clientY - ref.current!.getBoundingClientRect().top };
      const bounds = { left: Math.min(d.screen.x, sc.x), right: Math.max(d.screen.x, sc.x), top: Math.min(d.screen.y, sc.y), bottom: Math.max(d.screen.y, sc.y) };
      const next = d.base.map((t) => {
        const existing = d.paths.find((p) => p.shapeId === t.shapeId && p.layerId === t.layerId)?.nodes ?? [];
        const segs = editablePageSegs(t.shape), points = nodeSegs(segs).seg.map((i) => { const end = segs[i].p.at(-1)!; const p = screen(end); return [p.x, p.y] as [number, number]; });
        return { layerId: t.layerId, shapeId: t.shapeId, nodes: d.moved ? marqueeNodeSelection(existing, points, bounds, { shift: d.shift, ctrl: d.ctrl }) : [] };
      });
      setSelection(next);
    } else if (d?.kind === 'node') {
      if (d.moved) setSelection(d.paths);
      else setSelection(d.paths);
    }
    drag.current = null; setBox(null);
  };

  return <svg ref={ref} className="stroke-ruler shape-knots path-nodes multi-path-nodes" aria-label={`Nodes in ${targets.length} paths`}
    onPointerDown={(e) => {
      if (e.button !== 0 || !(e.target instanceof SVGRectElement && e.target.classList.contains('node-marquee-hit'))) return;
      e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
      const p = page(e), sc = { x: e.clientX - ref.current!.getBoundingClientRect().left, y: e.clientY - ref.current!.getBoundingClientRect().top };
      drag.current = { kind: 'marquee', start: p, screen: sc, paths: selection(), base: targets, moved: false, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    }} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null; setBox(null); }}>
    <rect className="node-marquee-hit" x="0" y="0" width="100%" height="100%" />
    {box && <rect className="node-marquee" x={box.left} y={box.top} width={box.right - box.left} height={box.bottom - box.top} />}
    {targets.flatMap((t) => {
      const segs = editablePageSegs(t.shape), indices = nodeSegs(segs).seg, selected = paths.find((p) => p.layerId === t.layerId && p.shapeId === t.shapeId)?.nodes ?? [];
      const outline = serializeSegs(segs.map((g) => ({ c: g.c, p: g.p.map((q) => { const c = screen(q); return [c.x, c.y] as [number, number]; }) })));
      return <g key={`${t.layerId}:${t.shapeId}`} data-path-id={t.shapeId}>
        <path className="path-outline" d={outline} />
        {indices.map((i, node) => { const pt = segs[i].p.at(-1)!; const c = screen(pt); return <rect key={`${t.shapeId}:${node}`} className={`stroke-ruler-handle shape-knot path-node${selected.includes(node) ? ' is-picked' : ''}`} data-node={node} data-multi-path-node={t.shapeId} x={c.x - 4.5} y={c.y - 4.5} width={9} height={9}
          onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); const p = page(e), sc = { x: e.clientX - ref.current!.getBoundingClientRect().left, y: e.clientY - ref.current!.getBoundingClientRect().top }; const snapshot = selection(), item = snapshot.find((v) => v.layerId === t.layerId && v.shapeId === t.shapeId), nodes = item?.nodes ?? []; if (!nodes.includes(node)) { if (!e.shiftKey) snapshot.forEach((v) => { v.nodes = []; }); if (item) item.nodes = e.shiftKey ? toggleNodeSelection(nodes, node) : [node]; } drag.current = { kind: 'node', start: p, screen: sc, shapeId: t.shapeId, node, paths: snapshot, base: targets, moved: false, shift: e.shiftKey }; }} />; })}
      </g>;
    })}
  </svg>;
}
