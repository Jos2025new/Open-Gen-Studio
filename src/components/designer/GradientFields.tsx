import type { GradientStop } from '../../engine/shapeSpec';
import type { VectorShape } from '../../engine/types';
import { defaultGradient } from '../../engine/design/gradientPaint';
import { InlineChoice, InlineColor, InlineSlider } from './InlineControls';
import { patchShape } from './ShapeLookFields';

/** The fill of a selected shape: Solid, or an editable linear or radial gradient with its first and last stops. */
export function GradientFields({ sessionId, docId, layerId, shape }: { sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const g = shape.fillGradient;
  const set = (patch: Partial<VectorShape>) => patchShape(sessionId, docId, layerId, shape.id, patch);
  const choose = (kind: 'solid' | 'linear' | 'radial') => {
    if (kind === 'solid') set({ fillGradient: undefined, fill: shape.fill ?? g?.stops[0]?.color ?? '#d4f25a' });
    else set({ fillGradient: g ? { ...g, kind } : defaultGradient(kind, shape, shape.fill ?? '#ffffff', '#000000'), fill: null });
  };
  // Only the first and last stops are edited here; stops in between (from imported files) are kept as they are.
  const stop = (end: 'first' | 'last', patch: Partial<GradientStop>) => {
    if (!g) return;
    const stops = g.stops.map((st, i) => ((end === 'first' ? i === 0 : i === g.stops.length - 1) ? { ...st, ...patch } : st));
    set({ fillGradient: { ...g, stops } });
  };
  const ends: Array<['first' | 'last', string]> = [['first', 'From'], ['last', 'To']];
  return <>
    <InlineChoice label="Fill" value={g ? g.kind : 'solid'} options={[{ value: 'solid' as const, label: 'Solid fill' }, { value: 'linear' as const, label: 'Linear gradient' }, { value: 'radial' as const, label: 'Radial gradient' }]} onChange={choose} />
    {g && ends.map(([end, label]) => {
      const st = end === 'first' ? g.stops[0] : g.stops[g.stops.length - 1];
      return <InlineColor key={end} label={label} value={st.color} showValue alpha={{ value: st.alpha, onChange: (a) => stop(end, { alpha: a }) }} onChange={(color) => stop(end, { color })} />;
    })}
    {g && <InlineSlider label="Opacity" unit="%" min={0} max={100} value={Math.round((g.stops[0].alpha) * 100)} onChange={(v) => stop('first', { alpha: v / 100 })} />}
  </>;
}
