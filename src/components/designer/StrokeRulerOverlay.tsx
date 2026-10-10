import { useRef } from 'react';
import { setUi, useStore } from '../../store/store';
import { InlineSelect, InlineToggle } from './InlineControls';
import { setRuler, type StrokeRuler } from '../../engine/design/strokeRuler';
import { documentToScreen, screenToDocument, type View } from '../../engine/design/viewCoordinates';

/*
 * The stroke ruler on the page (engine/design/strokeRuler.ts): a dashed guide, and with the Ruler tool, dragging on
 * the page places a new one and its round handles move its ends (line) or corners (ellipse).
 */
export function StrokeRulerOverlay({ view, docId, tool }: { view: View; docId: string; tool: string }) {
  const ruler = useStore((s) => s.ui.strokeRuler);
  const kind = useStore((s) => s.ui.strokeRulerKind ?? 'line');
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ end: 'a' | 'b'; base: StrokeRuler } | null>(null);
  const placing = tool === 'ruler';
  const r = ruler && ruler.docId === docId ? ruler : null;
  if (!r && !placing) return null;
  const at = (e: { clientX: number; clientY: number }) => screenToDocument({ x: e.clientX, y: e.clientY }, view, ref.current!.getBoundingClientRect());
  const s = r ? [documentToScreen(r.a, view, { left: 0, top: 0 }), documentToScreen(r.b, view, { left: 0, top: 0 })] : null;
  // Perspective: the horizon through the vanishing points, and faint rays from each so the space reads.
  const persp = r && s && r.kind === 'perspective' ? (() => {
    const vps = r.points === 1 ? [s[0]] : s, far = 4000;
    const hx = r.points === 1 ? 1 : s[1].x - s[0].x, hy = r.points === 1 ? 0 : s[1].y - s[0].y, hl = Math.hypot(hx, hy) || 1;
    return <>
      <line x1={s[0].x - (hx / hl) * far} y1={s[0].y - (hy / hl) * far} x2={s[0].x + (hx / hl) * far} y2={s[0].y + (hy / hl) * far} />
      {vps.flatMap((v, i) => Array.from({ length: 12 }, (_, k) => { const t = (k / 12) * Math.PI * 2; return <line key={`${i}-${k}`} className="ray" x1={v.x} y1={v.y} x2={v.x + Math.cos(t) * far} y2={v.y + Math.sin(t) * far} />; }))}
    </>;
  })() : null;
  const shape = persp ?? (r && s ? (r.kind === 'line'
    ? <line x1={s[0].x} y1={s[0].y} x2={s[1].x} y2={s[1].y} />
    : <ellipse cx={(s[0].x + s[1].x) / 2} cy={(s[0].y + s[1].y) / 2} rx={Math.abs(s[1].x - s[0].x) / 2} ry={Math.abs(s[1].y - s[0].y) / 2} />) : null);
  return <svg ref={ref} className={`stroke-ruler${placing ? ' is-placing' : ''}${r && !r.on ? ' is-off' : ''}`} aria-label="Stroke ruler"
    onPointerDown={placing ? (e) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = at(e);
      const base: StrokeRuler = { docId, kind, a: p, b: p, on: true, points: ruler?.points ?? 2 };
      setRuler(base);
      drag.current = { end: 'b', base };
    } : undefined}
    onPointerMove={(e) => { const d = drag.current; if (d) setRuler({ ...d.base, [d.end]: at(e) }); }}
    onPointerUp={() => { drag.current = null; }}>
    {shape && <g className="stroke-ruler-guide">{shape}</g>}
    {placing && r && s && (r.kind === 'perspective' && r.points === 1 ? ['a'] as const : ['a', 'b'] as const).map((end, i) => <circle key={end} className="stroke-ruler-handle" cx={s[i].x} cy={s[i].y} r={6}
      onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { end, base: r }; }}
      onPointerMove={(e) => { const d = drag.current; if (d) setRuler({ ...d.base, [d.end]: at(e) }); }}
      onPointerUp={() => { drag.current = null; }} />)}
  </svg>;
}

/** The Ruler tool's settings: which guide the next drag places, whether the brush follows it, and clearing it. */
export function RulerSettings({ docId }: { docId: string }) {
  const ruler = useStore((s) => s.ui.strokeRuler);
  const kind = useStore((s) => s.ui.strokeRulerKind ?? 'line');
  const r = ruler && ruler.docId === docId ? ruler : null;
  return <>
    <InlineSelect label="Ruler" value={kind} options={[{ value: 'line' as const, label: 'Straight' }, { value: 'ellipse' as const, label: 'Ellipse' }, { value: 'perspective' as const, label: 'Perspective' }]} onChange={(v) => { setUi({ strokeRulerKind: v }); if (r) setRuler({ ...r, kind: v }); }} />
    {kind === 'perspective' && <InlineSelect label="Vanishing points" value={r?.points ?? 2} options={[{ value: 1 as const, label: 'One' }, { value: 2 as const, label: 'Two' }]} onChange={(points) => r && setRuler({ ...r, points })} />}
    <InlineToggle label="Snap brush to ruler" tip="While on, brush strokes follow the guide: parallel lines, or ellipses around the same centre" checked={!!r?.on} onChange={(on) => r && setRuler({ ...r, on })} />
    <button type="button" className="opt" disabled={!r} onClick={() => setRuler(null)} data-tip="Removes the guide from the page">Clear ruler</button>
    <p className="opt-hint">{kind === 'perspective' ? 'Drag on the page from one vanishing point to the other (on the horizon); each stroke then heads to the point that matches its start, or runs vertical.' : 'Drag on the page to place the guide; drag its round handles to adjust it.'}</p>
  </>;
}
