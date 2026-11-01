import { useEffect, useMemo, useRef, useState } from 'react';
import type { VectorShape } from '../../engine/types';
import { moveSelectedNodes, serializeSegs, withSegs, type NodeType, type Pt, type Seg } from '../../engine/design/pathNodes';
import { edgesOf, facesOf, pickEdge, pickFace, pickSel, SELECT_MODES, type SelectMode } from '../../engine/design/selectMode';
import { setShapeEdit, type ShapeEdit } from '../../engine/design/objectSelection';
import { patchShape } from './ShapeLookFields';
import { boardKey } from './boardKey';
import { chooseSelectMode, currentSel, writeSel } from './selectModeActions';

/*
 * Segment and face select of the node editor, drawn and driven inside PathNodes' svg (engine/design/selectMode.ts):
 * the highlights, a hit layer that picks the segment or face under the pointer (anything else falls through to the
 * marquee), the drag that moves the picked element's nodes (one undo step), and the 1 / 2 / 3 keys.
 */
interface Props {
  svg: React.RefObject<SVGSVGElement | null>; sessionId: string; docId: string; layerId: string; shape: VectorShape; segs: Seg[]; types: NodeType[];
  edit: ShapeEdit | undefined; mode: SelectMode; /** Move mode: the layer picks; in Lasso it only shows and keeps the selection whole. */ interactive: boolean;
  scr: (p: Pt) => { x: number; y: number }; page: (e: { clientX: number; clientY: number }, sh?: VectorShape) => { x: number; y: number };
}
const PICK_PX = 8;

export function SelectLayer({ svg, sessionId, docId, layerId, shape, segs, types, edit, mode, interactive, scr, page }: Props) {
  const key = serializeSegs(segs);
  const edges = useMemo(() => (mode === 'segment' ? edgesOf(segs) : []), [key, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const faces = useMemo(() => (mode === 'face' ? facesOf(segs) : []), [key, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = edit?.shapeId === shape.id ? edit : undefined;
  const sel = useMemo(() => currentSel(shape, mine, mode), [key, mine, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ base: Seg[]; shape: VectorShape; nodes: number[]; from: { x: number; y: number }; client: { x: number; y: number }; moved: boolean } | null>(null);
  // Keep ShapeEdit whole: nodes are exactly the selected elements' nodes, and the elements are stored only in their own mode.
  useEffect(() => {
    if (!mine) return;
    if (mode === 'node') { if (mine.segs || mine.faces) setShapeEdit(docId, { ...mine, segs: undefined, faces: undefined }); return; }
    const same = (a: number[] | undefined, b: number[]) => [...(a ?? [])].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();
    if (!same(mine.nodes ?? (mine.node == null ? [] : [mine.node]), sel.nodes) || !same(mine.segs, sel.segs) || !same(mine.faces, sel.faces)) writeSel(docId, mine, sel);
  }, [mine, sel, mode, docId]);
  const pt = (e: { clientX: number; clientY: number }): Pt => { const r = svg.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toScr = (p: Pt): Pt => { const c = scr(p); return [c.x, c.y]; };
  const pickAt = (e: { clientX: number; clientY: number }): number | null => {
    if (mode === 'segment') return pickEdge(edges, toScr, pt(e), PICK_PX)?.id ?? null;
    const q = page(e);
    return pickFace(faces, [q.x, q.y])?.id ?? null;
  };
  const onDown = (e: React.PointerEvent<SVGRectElement>) => {
    if (e.button !== 0 || !interactive) return;
    const id = pickAt(e);
    if (id == null) return; // empty space: the marquee takes it
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const next = pickSel(edges, faces, mode, sel, id, e.shiftKey);
    writeSel(docId, mine ?? { layerId, shapeId: shape.id }, next);
    const keeps = mode === 'segment' ? next.segs.includes(id) : next.faces.includes(id);
    drag.current = keeps ? { base: segs, shape, nodes: next.nodes, from: page(e, shape), client: { x: e.clientX, y: e.clientY }, moved: false } : null;
  };
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const d = drag.current;
    if (!d) { if (interactive) setHover(pickAt(e)); return; }
    if (!d.moved && Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y) <= 2) return;
    const q = page(e, d.shape), next = withSegs(d.shape, moveSelectedNodes(d.base, d.nodes, q.x - d.from.x, q.y - d.from.y, types));
    patchShape(sessionId, docId, layerId, d.shape.id, { d: next.d, box0: next.box0, x: next.x, y: next.y, w: next.w, h: next.h }, { record: !d.moved });
    d.moved = true;
  };
  const end = () => { drag.current = null; };
  const edgePath = (id: number) => { const e = edges.find((x) => x.id === id); return e ? serializeSegs([{ c: 'M', p: [toScr(e.from)] }, { c: e.seg.c, p: e.seg.p.map(toScr) }]) : ''; };
  const facePath = (id: number) => { const f = faces.find((x) => x.id === id); return f ? serializeSegs(f.segs.map((g) => ({ c: g.c, p: g.p.map(toScr) }))) : ''; };
  return <g className="sel-layer">
    {interactive && mode !== 'node' && <rect className="node-marquee-hit sel-hit" x="0" y="0" width="100%" height="100%" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end} onPointerLeave={() => setHover(null)} />}
    {mode === 'segment' && hover != null && !sel.segs.includes(hover) && <path className="sel-seg is-hover" d={edgePath(hover)} />}
    {mode === 'segment' && sel.segs.map((id) => <path key={id} className="sel-seg" data-seg={id} d={edgePath(id)} />)}
    {mode === 'face' && hover != null && !sel.faces.includes(hover) && <path className="sel-face is-hover" d={facePath(hover)} />}
    {mode === 'face' && sel.faces.map((id) => <path key={id} className="sel-face" data-face={id} d={facePath(id)} />)}
  </g>;
}

/** Keys 1 / 2 / 3 pick node / segment / face while node editing on the board (Move or Lasso); the rest of the keys are untouched. */
export function useSelectKeys(docId: string, shape: VectorShape, on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !boardKey(e)) return;
      const i = ['1', '2', '3'].indexOf(e.key);
      if (i < 0) return;
      e.preventDefault(); e.stopImmediatePropagation();
      chooseSelectMode(docId, shape, SELECT_MODES[i]);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [on, docId, shape]);
}
