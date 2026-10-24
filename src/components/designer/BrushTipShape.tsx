import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { clampRoundness, wrapAngle } from '../../engine/design/brushTipShape';
import { InlineSlider } from './InlineControls';

const C = 32, R = 24;

/**
 * Photoshop's Brush Tip Shape widget: the tip as an ellipse, two dots on its short axis (drag to squeeze: Roundness)
 * and an arrow on its long axis (drag to turn: Angle). The numeric fields beside it say the same, to the unit.
 */
export function BrushTipShape({ angle, roundness, angleOnly, onChange }: { angle: number; roundness: number; /** Only the angle is editable (the Lineart nib): no squeeze handles or Roundness field. */ angleOnly?: boolean; onChange: (patch: { angle?: number; roundness?: number }) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const at = (e: ReactPointerEvent) => {
    const b = ref.current!.getBoundingClientRect(), k = 64 / b.width;
    return { x: (e.clientX - b.left) * k - C, y: (e.clientY - b.top) * k - C };
  };
  const drag = (kind: 'angle' | 'roundness') => ({
    onPointerDown: (e: ReactPointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const { x, y } = at(e);
      if (kind === 'angle') { onChange({ angle: Math.round(wrapAngle((Math.atan2(-y, x) * 180) / Math.PI)) }); return; }
      // The short axis is the long one turned a quarter: the pointer's distance along it is the short radius.
      const a = (angle * Math.PI) / 180, across = Math.abs(x * Math.sin(a) + y * Math.cos(a));
      onChange({ roundness: Math.round(clampRoundness(across / R) * 100) / 100 });
    },
  });
  const short = R * roundness;
  return <div className="brush-tip-shape">
    <svg ref={ref} viewBox="0 0 64 64" width="64" height="64" role="img" aria-label={`Tip shape: angle ${angle}°, roundness ${Math.round(roundness * 100)} %`}>
      <g transform={`rotate(${-angle} ${C} ${C})`}>
        <ellipse cx={C} cy={C} rx={R} ry={Math.max(short, 0.5)} fill="currentColor" fillOpacity=".25" stroke="currentColor" strokeWidth="1" />
        <line x1={C} y1={C} x2={C + R} y2={C} stroke="currentColor" strokeWidth="1" />
        <path d={`M${C + R - 5} ${C - 3}L${C + R + 1} ${C}L${C + R - 5} ${C + 3}`} fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle className="tip-handle" cx={C + R} cy={C} r="5" fill="transparent" data-tip="Drag to turn the tip" {...drag('angle')} />
        {!angleOnly && <>
          <circle className="tip-handle" cx={C} cy={C - short} r="3.2" fill="currentColor" data-tip="Drag to squeeze the tip" {...drag('roundness')} />
          <circle className="tip-handle" cx={C} cy={C + short} r="3.2" fill="currentColor" data-tip="Drag to squeeze the tip" {...drag('roundness')} />
        </>}
      </g>
    </svg>
    <div className="brush-tip-fields">
      <InlineSlider label="Angle" unit="°" min={-180} max={180} value={angle} onChange={(v) => onChange({ angle: Math.round(v) })} />
      {!angleOnly && <InlineSlider label="Roundness" unit="%" scale={100} min={0.01} max={1} step={0.01} value={roundness} onChange={(v) => onChange({ roundness: v })} />}
    </div>
  </div>;
}
