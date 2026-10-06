import type { StrokeStyle } from '../../engine/types';
import { STAMPS } from '../../engine/design/brushTextures';
import { randomSeed } from '../../lib/rng';
import { Field } from '../ui/primitives';
import { InlineColor, InlineSelect, InlineSlider } from './InlineControls';

/** Shared controls; callers choose whether edits affect new strokes or selected strokes. */
export function StrokeStyleFields({ value, onChange }: { value: StrokeStyle; onChange: (patch: Partial<StrokeStyle>) => void }) {
  const range = (key: 'thinning' | 'smoothing' | 'streamline', label: string, min = 0) =>
    <InlineSlider label={label} min={min} max={1} step={0.01} value={value[key]} onChange={(v) => onChange({ [key]: v })} />;
  return <div className="stroke-controls">
    <InlineSlider label="Size" unit="px" min={1} max={120} value={value.size} onChange={(size) => onChange({ size })} />
    <InlineColor label="Color" showValue value={value.color} onChange={(color) => onChange({ color })} />
    <InlineSlider label="Opacity" unit="%" scale={100} min={0.05} max={1} step={0.01} value={value.opacity} onChange={(opacity) => onChange({ opacity })} />
    {range('thinning', 'Pressure thinning', -1)}
    {range('smoothing', 'Smoothing')}
    {range('streamline', 'Streamline')}
    <InlineSelect label="Texture" value={value.texture?.stamp ?? ''} options={[{ value: '', label: 'Solid ink' }, ...STAMPS.map((s) => ({ value: s.id, label: s.label }))]} onChange={(stamp) => onChange({ texture: stamp ? { spacing: 0.15, jitter: 0.4, seed: randomSeed(), ...value.texture, stamp } : undefined })} />
    {value.texture ? <>
      <InlineSlider label="Spacing" unit="%" scale={100} min={0.05} max={1} step={0.01} value={value.texture.spacing} onChange={(spacing) => onChange({ texture: { ...value.texture!, spacing } })} />
      <InlineSlider label="Jitter" unit="%" scale={100} min={0} max={1} step={0.01} value={value.texture.jitter} onChange={(jitter) => onChange({ texture: { ...value.texture!, jitter } })} />
      <Field label="Seed" hint="Same seed, same grain"><input type="number" min={0} value={value.texture.seed} onChange={(e) => onChange({ texture: { ...value.texture!, seed: Math.max(0, Math.floor(+e.target.value)) } })} /></Field>
    </> : null}
    <InlineSlider label="Taper start" allowManualOverflow unit="px" min={0} max={500} value={value.taperStart} onChange={(taperStart) => onChange({ taperStart })} />
    <InlineSlider label="Taper end" allowManualOverflow unit="px" min={0} max={500} value={value.taperEnd} onChange={(taperEnd) => onChange({ taperEnd })} />
  </div>;
}
