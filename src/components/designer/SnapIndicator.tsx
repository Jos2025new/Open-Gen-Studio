import type { Measure } from '../../engine/design/snap';
import type { AlignmentGuide } from '../../engine/design/snapSession';
import { documentToScreen, type View } from '../../engine/design/viewCoordinates';

/*
 * The equal-spacing indicator while a layer snaps: the gaps it makes equal, measured between the boxes they come from,
 * each with its length in page units (Inkscape shows the same measures when distributing). Pointer events pass through.
 */
const INK = '#ff4fd8';

export function SnapIndicator({ view, measures, alignments }: { view: View; measures?: Measure[]; alignments?: AlignmentGuide[] }) {
  if (!measures?.length && !alignments?.length) return null;
  const at = (p: [number, number]) => documentToScreen({ x: p[0], y: p[1] }, view, { left: 0, top: 0 });
  return <svg className="stroke-ruler snap-indicator" aria-label="Snap alignment and spacing guides" aria-hidden="true">
    {alignments?.map((g, i) => {
      const a = at(g.a), b = at(g.b);
      return <line key={`alignment-${i}`} data-snap-alignment="true" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={INK} strokeWidth={1.5} />;
    })}
    {measures?.map((m, i) => {
      const a = at(m.a), b = at(m.b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const horizontal = Math.abs(a.y - b.y) < 1e-6;
      const tick = (p: { x: number; y: number }) => (horizontal ? <line x1={p.x} y1={p.y - 5} x2={p.x} y2={p.y + 5} stroke={INK} strokeWidth={1} /> : <line x1={p.x - 5} y1={p.y} x2={p.x + 5} y2={p.y} stroke={INK} strokeWidth={1} />);
      return <g key={i}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={INK} strokeWidth={1} />
        {tick(a)}{tick(b)}
        <text x={mx} y={horizontal ? my - 6 : my} fontSize={11} fill={INK} textAnchor="middle" dominantBaseline={horizontal ? 'auto' : 'middle'}>{m.label.toFixed(1)}</text>
      </g>;
    })}
  </svg>;
}
