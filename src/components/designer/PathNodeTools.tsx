import { useRef, useState } from 'react';
import type { VectorShape } from '../../engine/types';
import { pageSegs, serializeSegs, type Pt, type Seg } from '../../engine/design/pathNodes';
import { contoursOf, cutPathAcross, cutPathAt, edgePoint, nearestOnPath, type PathHit } from '../../engine/design/pathCut';
import { erasePath } from '../../engine/design/vectorErase';
import { nodesInLasso } from '../../engine/design/lassoNodes';
import { useNodeEditMode } from '../../engine/design/nodeEditMode';
import { setShapeEdit, useShapeEdit } from '../../engine/design/objectSelection';
import { toLocal, toPage } from '../../engine/design/shapeTransform';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';
import { layerShapes, replaceWithPieces, usablePieces } from './pathPieces';
import '../../styles/path-tools.css';

const CUT_REACH = 12; // screen px from the path that a hover or click still counts as on it
const MARK = 9; // half length of the cut mark, screen px

/** Cut a path at one point, or along a line: the pieces replace it in one undo step. False when nothing was cut. */
export function cutShape(sessionId: string, docId: string, layerId: string, shape: VectorShape, how: { at: PathHit } | { across: [Pt, Pt] }): boolean {
  const segs = pageSegs(shape), out = 'at' in how ? cutPathAt(segs, how.at.segmentIndex, how.at.t) : cutPathAcross(segs, how.across[0], how.across[1]);
  const pieces = usablePieces(out);
  if (pieces.length === 1 && out.length === 1 && serializeSegs(pieces[0]) === serializeSegs(segs)) return false;
  if (!pieces.length) return false;
  replaceWithPieces(sessionId, docId, layerId, layerShapes(sessionId, docId, layerId), shape, pieces);
  return true;
}

/** Live erase: each sample rubs a circle out of the current pieces; the first change records the undo step. */
export class EraseSession {
  private pieces: Seg[][];
  private ids: string[] = [];
  private moved = false;
  private last: Pt | null = null;
  constructor(private s: string, private d: string, private l: string, private shape: VectorShape, private base: VectorShape[]) { this.pieces = [pageSegs(shape)]; }
  /** Rub at `at` (own coordinates), filling the gap from the previous sample so a fast drag leaves no holes. */
  sample(at: Pt, radius: number): void {
    if (!this.pieces.length) return;
    const from = this.last ?? at, dist = Math.hypot(at[0] - from[0], at[1] - from[1]), n = Math.max(1, Math.ceil(dist / Math.max(0.5, radius / 2)));
    this.last = at;
    let next = this.pieces;
    for (let i = 1; i <= n; i++) next = usablePieces(next.flatMap((p) => erasePath(p, [from[0] + ((at[0] - from[0]) * i) / n, from[1] + ((at[1] - from[1]) * i) / n], radius)));
    if (next.length === this.pieces.length && next.every((p, i) => serializeSegs(p) === serializeSegs(this.pieces[i]))) return;
    this.pieces = next;
    this.ids = replaceWithPieces(this.s, this.d, this.l, this.base, this.shape, next, { record: !this.moved, ids: this.ids });
    this.moved = true;
  }
  get changed(): boolean { return this.moved; }
}

/** The overlay of the Cut, Erase and Lasso modes of the node editor (docs: nodeEditMode.ts). */
export function PathNodeTools({ mode, view, sessionId, docId, layerId, shape, selected }: { mode: 'cut' | 'erase' | 'lasso'; view: View; sessionId: string; docId: string; layerId: string; shape: VectorShape; selected: number[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const radiusPx = useNodeEditMode((s) => s.eraseRadius);
  const edit = useShapeEdit((s) => s.byDoc[docId]);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [trail, setTrail] = useState<Array<{ x: number; y: number }>>([]);
  const gesture = useRef<{ start: { x: number; y: number }; moved: boolean; erase?: EraseSession; shift: boolean; pts: Array<{ x: number; y: number }> } | null>(null);
  const rect = () => ref.current!.getBoundingClientRect();
  const local = (p: { x: number; y: number }): Pt => { const q = screenToDocument({ x: p.x + rect().left, y: p.y + rect().top }, view, rect()); return toLocal(shape, q.x, q.y); };
  const scr = (p: Pt) => { const [x, y] = toPage(shape, p[0], p[1]); return documentToScreen({ x, y }, view, { left: 0, top: 0 }); };
  const at = (e: React.PointerEvent) => ({ x: e.clientX - rect().left, y: e.clientY - rect().top });
  const near = (p: { x: number; y: number }): PathHit | null => { const h = nearestOnPath(pageSegs(shape), local(p)); return h && h.distance * view.zoom <= CUT_REACH ? h : null; };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    gesture.current = { start: p, moved: false, shift: e.shiftKey, pts: [p] };
    if (mode === 'erase') {
      gesture.current.erase = new EraseSession(sessionId, docId, layerId, shape, layerShapes(sessionId, docId, layerId));
      gesture.current.erase.sample(local(p), radiusPx / view.zoom);
    }
  };
  const move = (e: React.PointerEvent) => {
    const p = at(e), g = gesture.current;
    setHover(p);
    if (!g) return;
    if (mode === 'erase') { g.erase?.sample(local(p), radiusPx / view.zoom); return; }
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) <= 3) return;
    g.moved = true;
    if (mode === 'cut') setTrail([g.start, p]);
    else {
      const last = g.pts[g.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) { g.pts.push(p); setTrail([...g.pts]); }
    }
  };
  const up = (e: React.PointerEvent) => {
    const g = gesture.current, p = at(e);
    gesture.current = null; setTrail([]);
    if (!g) return;
    if (mode === 'cut') {
      if (g.moved) cutShape(sessionId, docId, layerId, shape, { across: [local(g.start), local(p)] });
      else { const h = near(p); if (h) cutShape(sessionId, docId, layerId, shape, { at: h }); }
    } else if (mode === 'lasso' && edit) {
      const hits = g.moved ? nodesInLasso(pageSegs(shape), g.pts.map(local)) : [];
      const nodes = g.shift ? [...new Set([...selected, ...hits])] : hits;
      setShapeEdit(docId, { ...edit, node: nodes[0], nodes });
    }
  };

  // Cut preview: a short mark across the path at the nearest point, perpendicular to the path there.
  let mark: { a: { x: number; y: number }; b: { x: number; y: number }; c: { x: number; y: number } } | null = null;
  if (mode === 'cut' && hover && !trail.length) {
    const h = near(hover), e = h && contoursOf(pageSegs(shape)).flatMap((c) => c.edges).find((x) => x.idx === h.segmentIndex);
    if (h && e) {
      const a = scr(edgePoint(e, Math.max(0, h.t - 0.02))), b = scr(edgePoint(e, Math.min(1, h.t + 0.02))), c = scr(h.point);
      const len = Math.hypot(b.x - a.x, b.y - a.y), tx = len > 1e-6 ? (b.x - a.x) / len : 1, ty = len > 1e-6 ? (b.y - a.y) / len : 0;
      mark = { a: { x: c.x + ty * MARK, y: c.y - tx * MARK }, b: { x: c.x - ty * MARK, y: c.y + tx * MARK }, c };
    }
  }
  return <svg ref={ref} className={`stroke-ruler shape-knots path-tools is-${mode}`} aria-label={`Path ${mode} tool`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { gesture.current = null; setTrail([]); }} onPointerLeave={() => setHover(null)}>
    <rect className="path-tools-hit" x="0" y="0" width="100%" height="100%" />
    {mark && <><line className="cut-mark" x1={mark.a.x} y1={mark.a.y} x2={mark.b.x} y2={mark.b.y} /><circle className="cut-dot" cx={mark.c.x} cy={mark.c.y} r={3.5} /></>}
    {mode === 'cut' && trail.length === 2 && <line className="cut-rubber" x1={trail[0].x} y1={trail[0].y} x2={trail[1].x} y2={trail[1].y} />}
    {mode === 'erase' && hover && <><circle className="erase-halo" cx={hover.x} cy={hover.y} r={radiusPx} /><circle className="erase-ring" cx={hover.x} cy={hover.y} r={radiusPx} data-erase-radius={radiusPx} /></>}
    {mode === 'lasso' && trail.length > 1 && <polygon className="lasso-loop" points={trail.map((q) => `${q.x},${q.y}`).join(' ')} />}
  </svg>;
}
