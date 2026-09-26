import type { StrokeStyle } from '../../engine/types';
import { STAMPS } from '../../engine/design/brushTextures';
import { randomSeed } from '../../lib/rng';
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
    <Field label="Texture">
      <select value={value.texture?.stamp ?? ''} onChange={(e) => onChange({ texture: e.target.value ? { spacing: 0.15, jitter: 0.4, seed: randomSeed(), ...value.texture, stamp: e.target.value } : undefined })}>
        <option value="">Solid ink</option>
        {STAMPS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </Field>
    {value.texture ? <>
      <Field label={`Spacing · ${Math.round(value.texture.spacing * 100)}% of size`}><input type="range" min={0.05} max={1} step={0.01} value={value.texture.spacing} onChange={(e) => onChange({ texture: { ...value.texture!, spacing: +e.target.value } })} /></Field>
      <Field label={`Jitter · ${Math.round(value.texture.jitter * 100)}%`}><input type="range" min={0} max={1} step={0.01} value={value.texture.jitter} onChange={(e) => onChange({ texture: { ...value.texture!, jitter: +e.target.value } })} /></Field>
      <Field label="Seed (same seed, same grain)"><input type="number" min={0} value={value.texture.seed} onChange={(e) => onChange({ texture: { ...value.texture!, seed: Math.max(0, Math.floor(+e.target.value)) } })} /></Field>
    </> : null}
    <div className="property-grid">
      <Field label="Taper start"><input type="number" min={0} max={500} value={Math.round(value.taperStart)} onChange={(e) => onChange({ taperStart: Math.max(0, +e.target.value) })} /></Field>
      <Field label="Taper end"><input type="number" min={0} max={500} value={Math.round(value.taperEnd)} onChange={(e) => onChange({ taperEnd: Math.max(0, +e.target.value) })} /></Field>
    </div>
  </>;
}
