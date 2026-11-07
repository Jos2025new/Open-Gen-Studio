import { ArrowLeftRight } from '../ui/icons';
import { setUi, useStore } from '../../store/store';
import { secondaryOf, setSecondary, swapColors } from '../../engine/design/colorPair';
import { InlineColor } from './InlineControls';

/**
 * Primary and secondary color side by side with a swap between them (X swaps, D resets). `compact`: round swatches in
 * the quick row's pill; otherwise labelled fields for a card. `dimSecondary`: the secondary is not used right now
 * (a gradient fading to transparent), so it shows faded.
 */
export function ColorPair({ compact = false, dimSecondary = false }: { compact?: boolean; dimSecondary?: boolean }) {
  const brush = useStore((s) => s.ui.brush), gradient = useStore((s) => s.ui.gradient);
  const secondary = secondaryOf(brush, gradient);
  const parts = <>
    <InlineColor label="Color" value={brush.color} iconOnly={compact} onChange={(v) => setUi({ brush: { ...useStore.getState().ui.brush, color: v } })} />
    <button type="button" className="opt" aria-label="Swap colors" data-tip="Swap the two colors (X)" onClick={swapColors}><ArrowLeftRight size={13} /></button>
    <span style={dimSecondary ? { opacity: 0.45 } : undefined} data-tip={dimSecondary ? 'Not used while the gradient fades to transparent' : undefined}>
      <InlineColor label="Second color" value={secondary} iconOnly={compact} onChange={setSecondary} />
    </span>
  </>;
  return compact ? <span className="quick-color-pair">{parts}</span> : parts;
}
