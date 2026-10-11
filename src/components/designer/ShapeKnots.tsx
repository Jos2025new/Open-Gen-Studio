import { useEffect, useRef } from 'react';
import type { DesignDoc, VectorShape } from '../../engine/types';
import { BLUR_MARGIN, blurKnots, clickKnot, cornerKnots, cornerRadii, dragBlur, dragRx, dragRy } from '../../engine/design/shapeLook';
import { getDoc } from '../../engine/design/actions';
import { toLocal, toPage } from '../../engine/design/shapeTransform';
import { useStore } from '../../store/store';
import { setShapeEdit, useShapeEdit } from '../../engine/design/objectSelection';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';
import { patchShape, usePickedShape } from './ShapeLookFields';

/*
 * Shape edit mode (docs/plan-edicion-formas.md): after a double-click or «Edit shape», the edited shape shows its own
 * knots and the transform handles hide (Stage). Rectangle: Rx on the top edge, Ry on the right edge (Ctrl: equal,
 * Ctrl-click: copy, Shift-click: sharp, double-click: its exact value in the bar). Rectangle and ellipse: two blur
 * knots out from the top and right edges, also at 0 so blur can start on the canvas. One undo step per drag.
 * Esc leaves the mode. Formulas: engine/design/shapeLook.ts.
 */
type Knot = 'rx' | 'ry' | 'top' | 'right';
const NUDGE = 10; // screen px: a zero radius knot sits beside the corner, so Rx and Ry never share one spot
const BLUR_GAP = 20; // screen px from the edge, so the blur knots stay apart from the corner knots

export function ShapeKnots({ view, sessionId, doc }: { view: View; sessionId: string; doc: DesignDoc }) {
  const picked = usePickedShape(doc);
  const edit = useShapeEdit((st) => st.byDoc[doc.id]);
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ knot: Knot; layerId: string; shape: VectorShape; from: [number, number]; at: [number, number]; moved: boolean } | null>(null);
  const editing = !!picked && edit?.shapeId === picked.shape.id && (picked.shape.type === 'rect' || picked.shape.type === 'ellipse');
  useEffect(() => {
    if (!editing) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) setShapeEdit(doc.id, null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [editing, doc.id]);
  if (!picked || !editing) return null;
  const s = picked.shape, rect = s.type === 'rect';
  const scr = (p: [number, number]) => documentToScreen({ x: p[0], y: p[1] }, view, { left: 0, top: 0 });
  const page = (e: { clientX: number; clientY: number }) => screenToDocument({ x: e.clientX, y: e.clientY }, view, ref.current!.getBoundingClientRect());
  // Knots live in the shape's own coordinates (Inkscape: knot_get in item space); a turned shape turns them with it.
  const own = (sh: VectorShape, e: { clientX: number; clientY: number }) => { const q = page(e); return toLocal(sh, q.x, q.y); };
  const at = (p: [number, number], dx = 0, dy = 0) => scr(toPage(s, p[0] + dx / view.zoom, p[1] + dy / view.zoom));
  const ck = rect ? cornerKnots(s) : null, bk = blurKnots(s);
  const knots: Array<{ knot: Knot; p: [number, number]; dx?: number; dy?: number; tip: string }> = [];
  if (ck) {
    const r = cornerRadii(s), near = (v: number) => v * view.zoom < NUDGE;
    const tip = ' corner radius · alone; Ctrl or «Lock radii»: both together · Ctrl-click: copy to the other · Shift-click: sharp corners · double-click: exact value';
    knots.push({ knot: 'rx', p: ck.rx, dx: near(r.rx) ? -NUDGE : 0, tip: `Horizontal${tip}` });
    knots.push({ knot: 'ry', p: ck.ry, dy: near(r.ry) ? NUDGE : 0, tip: `Vertical${tip}` });
  }
  // At least BLUR_GAP screen px out (the drag stays relative, so the value never jumps).
  const out = Math.max(0, BLUR_GAP - BLUR_MARGIN * (s.blur ?? 0) * view.zoom);
  knots.push({ knot: 'top', p: bk.top, dy: -out, tip: 'Blur · drag out for more, in for less' });
  knots.push({ knot: 'right', p: bk.right, dx: out, tip: 'Blur · drag out for more, in for less' });
  // Ctrl, or the «Lock radii» switch in the bar, moves both radii together.
  const lock = (e: React.PointerEvent) => e.ctrlKey || e.metaKey || !!useStore.getState().ui.shapeLockRadii;
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const q = own(d.shape, e), x = d.at[0] + q[0] - d.from[0], y = d.at[1] + q[1] - d.from[1];
    const patch = d.knot === 'rx' ? dragRx(d.shape, x, lock(e)) : d.knot === 'ry' ? dragRy(d.shape, y, lock(e)) : { blur: dragBlur(d.shape, d.knot, x, y) };
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
    {<g className="shape-knot-lines">
      {knots.filter((k) => k.knot === 'top' || k.knot === 'right').map((k) => { const A = at(k.knot === 'top' ? bk.edgeTop : bk.edgeRight), B = at(k.p, k.dx, k.dy); return <line key={k.knot} x1={A.x} y1={A.y} x2={B.x} y2={B.y} />; })}
    </g>}
    {knots.map((k) => { const c = at(k.p, k.dx, k.dy); return <circle key={k.knot} className="stroke-ruler-handle shape-knot" data-knot={k.knot} data-tip={k.tip} cx={c.x} cy={c.y} r={5}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const cur = getDoc(sessionId, doc.id)?.layers.find((l) => l.id === picked.layerId);
        const shape = cur?.type === 'vector' ? cur.shapes.find((x) => x.id === s.id) : undefined;
        if (!shape) return;
        drag.current = { knot: k.knot, layerId: picked.layerId, shape, from: own(shape, e), at: k.p, moved: false };
      }}
      onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={(e) => { e.stopPropagation(); focusField(k.knot === 'rx' ? 'Rx' : k.knot === 'ry' ? 'Ry' : 'Blur'); }} />; })}
  </svg>;
}

/** The bar's exact-value field for a knot, focused and selected (Illustrator: double-click a widget for its value). */
function focusField(label: string): void {
  const input = document.querySelector<HTMLInputElement>(`.context-strip input[aria-label="${label} value"]`);
  input?.focus();
  input?.select();
}
