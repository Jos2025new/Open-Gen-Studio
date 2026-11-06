import type { ReactNode } from 'react';
import { setUi, useStore } from '../../store/store';
import { InlineSelect, InlineSlider } from './InlineControls';
import { ColorPair } from './ColorPair';

const SOURCES = [{ value: 'all' as const, label: 'All layers' }, { value: 'layer' as const, label: 'Layer' }];
const AREAS = [{ value: 'connected', label: 'Connected' }, { value: 'similar', label: 'All similar' }];

/** What the Fill reads: everything visible, or the active layer (the fill then lands right under it). */
export function FillSourceField({ icon }: { icon?: ReactNode }) {
  const brush = useStore((s) => s.ui.brush);
  return <InlineSelect label="Source" icon={icon} value={brush.fillSource ?? 'all'} options={SOURCES} onChange={(v) => setUi({ brush: { ...brush, fillSource: v } })} />;
}

/** Openings in the outline up to this size do not let the fill leak. Not used by All similar. */
export function FillGapField() {
  const brush = useStore((s) => s.ui.brush);
  return <InlineSlider label="Close gaps" unit="px" min={0} max={16} disabled={!!brush.fillSimilar} tip={brush.fillSimilar ? 'Not used by All similar' : 'Seal openings in the outline up to this size'} value={brush.fillGap ?? 0} onChange={(v) => setUi({ brush: { ...brush, fillGap: v } })} />;
}

/** The Fill tool's card (the compact one is the row's short list). Shift+click flips Area for one click; Ctrl/⌘+click fills with the secondary color. */
export function FillSettings({ compact = false }: { compact?: boolean }) {
  const brush = useStore((s) => s.ui.brush);
  return <>
    <ColorPair />
    <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => setUi({ brush: { ...brush, opacity: v } })} />
    <InlineSlider label="Threshold" min={0} max={255} value={brush.fillThreshold ?? 24} onChange={(v) => setUi({ brush: { ...brush, fillThreshold: v } })} />
    <FillSourceField />
    <FillGapField />
    {!compact && <>
      <InlineSelect label="Area" value={brush.fillSimilar ? 'similar' : 'connected'} options={AREAS} onChange={(v) => setUi({ brush: { ...brush, fillSimilar: v === 'similar' } })} />
      <InlineSlider label="Expand" unit="px" min={0} max={12} value={brush.fillExpand ?? 0} onChange={(v) => setUi({ brush: { ...brush, fillExpand: v } })} />
      <InlineSlider label="Smooth" unit="px" min={0} max={4} step={0.5} value={brush.fillSmooth ?? 0} onChange={(v) => setUi({ brush: { ...brush, fillSmooth: v } })} />
    </>}
  </>;
}
