import type { ReactNode } from 'react';
import { useStore, setUi } from '../../store/store';
import { BRUSH_MAX_SIZE } from '../../engine/design/brushEngine';
import type { BrushUi } from '../../engine/design/brushPresets';
import { InlineSlider } from './InlineControls';

export type SizeRange = NonNullable<BrushUi['sizeRange']>;
const RANGES: Record<SizeRange, { min: number; max: number; step: number }> = { 1: { min: 1, max: 100, step: 1 }, 10: { min: 10, max: BRUSH_MAX_SIZE, step: 10 } };
const label = (r: SizeRange) => `${RANGES[r].min}–${RANGES[r].max} px`;

/** The range a size shows in: the chosen one while it fits, otherwise the only one that holds it. */
export const sizeRangeOf = (size: number, chosen: BrushUi['sizeRange']): SizeRange => (size > RANGES[1].max ? 10 : size < RANGES[10].min ? 1 : chosen ?? 1);

/**
 * The brush's Size, as SAI's: a linear track over one range at a time, so no stretch of it jumps. The badge changes
 * the range, and typing or a preset outside it moves there on its own. Fine sizes are one click away in SizePresets.
 */
export function BrushSizeField({ icon }: { icon?: ReactNode }) {
  const size = useStore((s) => s.ui.brush.size), chosen = useStore((s) => s.ui.brush.sizeRange);
  const range = sizeRangeOf(size, chosen), { min, max, step } = RANGES[range];
  const set = (patch: Pick<BrushUi, 'size' | 'sizeRange'>) => setUi({ brush: { ...useStore.getState().ui.brush, ...patch } });
  const next: SizeRange = range === 1 ? 10 : 1;
  return <InlineSlider label="Size" icon={icon} unit="px" min={min} max={max} step={step} typedRange={[RANGES[1].min, BRUSH_MAX_SIZE]} value={size}
    onChange={(v) => { const s = Math.round(v); set({ size: s, sizeRange: sizeRangeOf(s, range) }); }}
    badge={<button type="button" className="opt-size-range" aria-label={`Size range ${label(range)}: switch to ${label(next)}`} data-tip={`Size range ${label(range)} · click for ${label(next)}`}
      onClick={(e) => { e.preventDefault(); set({ size: Math.min(RANGES[next].max, Math.max(RANGES[next].min, size)), sizeRange: next }); }}>×{range}</button>} />;
}
