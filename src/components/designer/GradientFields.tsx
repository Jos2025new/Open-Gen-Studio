import type { GradientStop } from '../../engine/shapeSpec';
import type { VectorShape } from '../../engine/types';
import { defaultGradient } from '../../engine/design/gradientPaint';
import { InlineChoice, InlineColor, InlineSlider } from './InlineControls';
import { patchShape } from './ShapeLookFields';

/** The fill or the stroke of a selected shape: Solid, or an editable linear or radial gradient with its first and last stops. */
export function GradientFields({ sessionId, docId, layerId, shape, side = 'fill' }: { sessionId: string; docId: string; layerId: string; shape: VectorShape; side?: 'fill' | 'stroke' }) {
  const stroke = side === 'stroke';
  const field = stroke ? 'strokeGradient' : 'fillGradient';
  const g = shape[field];
  const solid = stroke ? shape.stroke : shape.fill;
  const set = (patch: Partial<VectorShape>) => patchShape(sessionId, docId, layerId, shape.id, patch);
  const choose = (kind: 'solid' | 'linear' | 'radial') => {
    if (kind === 'solid') set({ [field]: undefined, [stroke ? 'stroke' : 'fill']: solid ?? g?.stops[0]?.color ?? (stroke ? '#ffffff' : '#d4f25a') });
    else set({ [field]: g ? { ...g, kind } : defaultGradient(kind, shape, solid ?? (stroke ? '#ffffff' : '#ffffff'), '#000000'), [stroke ? 'stroke' : 'fill']: null });
  };
  // Only the first and last stops are edited here; stops in between (from imported files) are kept as they are.
  const stop = (end: 'first' | 'last', patch: Partial<GradientStop>) => {
    if (!g) return;
    const stops = g.stops.map((st, i) => ((end === 'first' ? i === 0 : i === g.stops.length - 1) ? { ...st, ...patch } : st));
    set({ [field]: { ...g, stops } });
  };
  const ends: Array<['first' | 'last', string]> = [['first', 'From'], ['last', 'To']];
  const name = stroke ? 'Stroke' : 'Fill';
  return <>
    <InlineChoice label={name} value={g ? g.kind : 'solid'} options={[{ value: 'solid' as const, label: `${name}: solid` }, { value: 'linear' as const, label: `${name}: linear gradient` }, { value: 'radial' as const, label: `${name}: radial gradient` }]} onChange={choose} />
    {g && ends.map(([end, label]) => {
      const st = end === 'first' ? g.stops[0] : g.stops[g.stops.length - 1];
      return <InlineColor key={end} label={`${label} ${name.toLowerCase()}`} value={st.color} showValue alpha={{ value: st.alpha, onChange: (a) => stop(end, { alpha: a }) }} onChange={(color) => stop(end, { color })} />;
    })}
    {g && <InlineSlider label={`${name} opacity`} unit="%" min={0} max={100} value={Math.round(g.stops[0].alpha * 100)} onChange={(v) => stop('first', { alpha: v / 100 })} />}
  </>;
}
