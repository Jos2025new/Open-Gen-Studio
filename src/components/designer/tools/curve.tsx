import { useStore, setUi } from '../../../store/store';
import { InlineSlider } from '../InlineControls';
import { shapeTool } from './shape';

function BendField() {
  const shape = useStore((s) => s.ui.shape);
  return <span data-tip="How far the curve bows from the straight line; negative bows to the other side"><InlineSlider label="Bend" unit="%" min={-100} max={100} value={shape.bend ?? 30} onChange={(v) => setUi({ shape: { ...shape, bend: v } })} /></span>;
}

export const curve = shapeTool('curve', {
  strokeOnly: true,
  fill: false,
  customPath: 'curve',
  fields: BendField,
});
