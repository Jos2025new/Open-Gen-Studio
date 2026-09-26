import type { StrokeStyle } from '../../engine/types';
import { Field } from '../ui/primitives';

/** Lineart stroke controls: the tool settings (new strokes) and a Lineart layer's properties (its strokes). */
export function StrokeStyleFields({ value, onChange }: { value: StrokeStyle; onChange: (patch: Partial<StrokeStyle>) => void }) {
  const range = (key: 'thinning' | 'smoothing' | 'streamline', label: string, min = 0) => (
    <Field label={`${label} · ${value[key].toFixed(2)}`}>
      <input type="range" min={min} max={1} step={0.01} value={value[key]} onChange={(e) => onChange({ [key]: +e.target.value })} />
    </Field>
  );
  return <>
    <Field label={`Size · ${Math.round(value.size)}px`}><input type="range" min={1} max={120} value={value.size} onChange={(e) => onChange({ size: +e.target.value })} /></Field>
    <Field label="Color"><input type="color" value={value.color} onChange={(e) => onChange({ color: e.target.value })} /></Field>
    <Field label={`Opacity · ${Math.round(value.opacity * 100)}%`}><input type="range" min={0.05} max={1} step={0.01} value={value.opacity} onChange={(e) => onChange({ opacity: +e.target.value })} /></Field>
    {range('thinning', 'Pressure thinning', -1)}
    {range('smoothing', 'Smoothing')}
    {range('streamline', 'Streamline')}
    <div className="property-grid">
      <Field label="Taper start"><input type="number" min={0} max={500} value={Math.round(value.taperStart)} onChange={(e) => onChange({ taperStart: Math.max(0, +e.target.value) })} /></Field>
      <Field label="Taper end"><input type="number" min={0} max={500} value={Math.round(value.taperEnd)} onChange={(e) => onChange({ taperEnd: Math.max(0, +e.target.value) })} /></Field>
    </div>
  </>;
}
