import { useEffect, useRef, useState } from 'react';
import type { DesignDoc } from '../../engine/types';
import { setUi } from '../../store/store';
import { useObjectSelection } from '../../engine/design/objectSelection';
import { serializeSegs, type Pt } from '../../engine/design/pathNodes';
import { applyBuilder, builderModel, faceAt, pickedShapes } from '../../engine/design/shapeBuilder';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';
import { boardKey } from './boardKey';
import '../../styles/shape-builder.css';

/*
 * Shape Builder (Shift+M, Illustrator's tool): with two or more shapes picked, the regions they make are shown as you
 * hover them; click or drag across regions to merge them into one shape, hold Alt to delete them instead, Esc cancels
 * the drag. Faces come from engine/design/shapeBuilder.ts (computed once per set of shapes). It covers the canvas while
 * the tool is active, so the Stage never sees its pointer events (wheel zoom is passed on to the canvas).
 */
type Gesture = { start: Pt; startFace: number; touched: number[]; last: Pt; trail: Pt[]; layerId: string; ids: string[] };

export function ShapeBuilder({ view, sessionId, doc }: { view: View; sessionId: string; doc: DesignDoc }) {
  const pick = useObjectSelection((st) => st.byDoc[doc.id] ?? null);
  const got = pickedShapes(doc, pick);
  const model = got ? builderModel(got.shapes) : null;
  const ref = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [hover, setHover] = useState(-1);
  const [, redraw] = useState(0);
  const [del, setDel] = useState(false);
  const page = (e: { clientX: number; clientY: number }): Pt => { const p = screenToDocument({ x: e.clientX, y: e.clientY }, view, ref.current!.getBoundingClientRect()); return [p.x, p.y]; };
  const scr = (p: Pt): Pt => { const q = documentToScreen({ x: p[0], y: p[1] }, view, { left: 0, top: 0 }); return [q.x, q.y]; };
  const cancel = () => { gesture.current = null; redraw((n) => n + 1); };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Alt') { setDel(e.type === 'keydown'); return; }
      if (e.key !== 'Escape' || !boardKey(e)) return;
      e.stopImmediatePropagation();
      if (gesture.current) cancel(); else setUi({ tool: 'move' });
    };
    window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true); };
  }, []);
  useEffect(() => {
    // Wheel zoom and pan keep working: the Stage canvas under this overlay gets the event.
    const el = ref.current, canvas = el?.parentElement?.querySelector('canvas.stage-canvas');
    if (!el || !canvas) return;
    const pass = (e: WheelEvent) => { e.preventDefault(); canvas.dispatchEvent(new WheelEvent('wheel', e)); };
    el.addEventListener('wheel', pass, { passive: false });
    return () => el.removeEventListener('wheel', pass);
  }, [!!got]);

  const touch = (g: Gesture, to: Pt) => {
    // Sample the way between pointer events so a fast drag cannot skip a thin region.
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - g.last[0], to[1] - g.last[1]) / 2));
    for (let i = 1; i <= n; i++) {
      const f = faceAt(model!, [g.last[0] + ((to[0] - g.last[0]) * i) / n, g.last[1] + ((to[1] - g.last[1]) * i) / n]);
      if (f >= 0 && !g.touched.includes(f)) g.touched.push(f);
    }
    g.last = to; g.trail.push(to);
  };
  const done = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (g && g.touched.length) applyBuilder(sessionId, doc.id, g.layerId, g.ids, g.touched, e.altKey ? 'delete' : 'merge', g.startFace);
    redraw((n) => n + 1);
  };

  const note = !got ? 'Shape Builder: pick two or more shapes with the Edit tool first (Shift-click), then come back.'
    : model!.faces === null ? 'These shapes are too complex for the Shape Builder. Pick fewer or simpler shapes.'
    : model!.shapes.length < 2 ? 'Shape Builder needs two or more shapes with a fill.' : null;
  const g = gesture.current, touched = g?.touched ?? [];
  const faces = model?.faces ?? [];
  const mode = del ? 'delete' : 'merge';
  return <>
    <svg ref={ref} className="stroke-ruler shape-knots shape-builder is-placing" aria-label="Shape Builder"
      onPointerDown={(e) => {
        if (e.button !== 0 || !got || !model?.faces) return;
        e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
        const p = page(e), f = faceAt(model, p);
        gesture.current = { start: p, startFace: f, touched: f >= 0 ? [f] : [], last: p, trail: [p], layerId: got.layerId, ids: got.shapes.map((s) => s.id) };
        setDel(e.altKey); redraw((n) => n + 1);
      }}
      onPointerMove={(e) => {
        if (!model?.faces) return;
        setDel(e.altKey);
        const p = page(e), cur = gesture.current;
        if (cur) { touch(cur, p); redraw((n) => n + 1); } else setHover(faceAt(model, p));
      }}
      onPointerUp={done} onPointerCancel={cancel} onPointerLeave={() => setHover(-1)}>
      <defs>
        {['sb-hatch', 'sb-hatch-del'].map((id) => <pattern key={id} id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line className={id} x1="0" y1="0" x2="0" y2="6" /></pattern>)}
      </defs>
      {faces.map((f, i) => {
        const on = touched.includes(i), over = !g && hover === i;
        if (!on && !over) return null;
        const d = serializeSegs(f.segs.map((s) => ({ c: s.c, p: s.p.map(scr) })));
        return <path key={i} className={`sb-face ${on ? 'is-touched' : 'is-hover'}${mode === 'delete' ? ' is-delete' : ''}`} d={d} fillRule="evenodd" data-face={i} />;
      })}
      {g && g.trail.length > 1 && <polyline className={`sb-trail${mode === 'delete' ? ' is-delete' : ''}`} points={g.trail.map((q) => scr(q).join(',')).join(' ')} />}
    </svg>
    {note && <div className="stage-hint">{note}</div>}
  </>;
}
