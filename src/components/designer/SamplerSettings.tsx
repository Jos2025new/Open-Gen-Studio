import { setUi, useStore } from '../../store/store';
import { InlineColor, InlineSelect, InlineSlider } from './InlineControls';
import { SAMPLE_RADIUS_MAX, clampRadius } from '../../engine/design/swatches';

const SOURCES = [{ value: 'all' as const, label: 'All layers' }, { value: 'layer' as const, label: 'Layer' }];

/** How wide the eyedropper averages: 0 = one pixel, r = a square of (2r+1)² pixels. */
export function SampleRadiusField() {
  const brush = useStore((s) => s.ui.brush);
  return <InlineSlider label="Radius" unit="px" min={0} max={SAMPLE_RADIUS_MAX} tip="Sample radius: average the pixels around the point (0 = one pixel)" value={clampRadius(brush.sampleRadius)} onChange={(v) => setUi({ brush: { ...brush, sampleRadius: clampRadius(v) } })} />;
}

/** What the eyedropper reads: everything visible, or only the active layer's own pixels. */
export function SampleSourceField() {
  const brush = useStore((s) => s.ui.brush);
  return <InlineSelect label="Sample" value={brush.sampleSource ?? 'all'} options={SOURCES} onChange={(v) => setUi({ brush: { ...brush, sampleSource: v } })} />;
}

/** The eyedropper's card: what it picked, radius and source. Drag to sample live; Shift picks the secondary color. */
export function SamplerSettings({ compact = false }: { compact?: boolean }) {
  const brush = useStore((s) => s.ui.brush);
  return <div className="tool-settings" role="toolbar" aria-label="Eyedropper settings">
    <InlineColor label="Picked" value={brush.color} onChange={(v) => setUi({ brush: { ...brush, color: v } })} />
    <SampleRadiusField />
    <SampleSourceField />
    {!compact && <span className="opt-hint">Click or drag the page to pick; Shift picks the secondary color</span>}
  </div>;
}
