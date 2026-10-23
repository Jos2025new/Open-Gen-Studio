import { Brush as BrushIcon, Circle, Layers as LayersIcon } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import type { DesignTool } from '../../engine/design/rules';
import { IconButton } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { ToolDock } from '../designer/ToolDock';
import { InlineColor, InlineSlider } from '../designer/InlineControls';
import { setUi, useStore } from '../../store/store';
import { EmbeddedLayers } from './EmbeddedLayers';

/** The tools Studio's board offers: pick and move, pan, line art, eraser, shapes and text. The rest stay in the full Designer. */
export const EMBEDDED_TOOLS: ReadonlySet<DesignTool> = new Set<DesignTool>(['move', 'hand', 'lineart', 'eraser', 'text', 'rect', 'ellipse', 'line', 'curve', 'arrow', 'polygon', 'star', 'sector', 'arc', 'chord']);

const SHAPE_TOOLS: DesignTool[] = ['rect', 'ellipse', 'line', 'curve', 'arrow', 'polygon', 'star', 'sector', 'arc', 'chord'];
/** Select and Pan are in the board's top bar, so the dock leaves them out. */
const DOCK_TOOLS: ReadonlySet<DesignTool> = new Set([...EMBEDDED_TOOLS].filter((t) => t !== 'move' && t !== 'hand'));

/** Color and size of what the active tool draws, in the same fields and state the full Designer uses for it. */
function useToolPaint(tool: DesignTool) {
  const ui = useStore((s) => s.ui);
  if (tool === 'text') return {
    color: ui.text.color, onColor: (color: string) => setUi({ text: { ...ui.text, color } }),
    size: { label: 'Size', unit: 'px', min: 1, max: 500, value: ui.text.fontSize, set: (fontSize: number) => setUi({ text: { ...ui.text, fontSize } }) },
  };
  if (SHAPE_TOOLS.includes(tool)) return {
    color: ui.shape.fill ?? '#d4f25a', onColor: (fill: string) => setUi({ shape: { ...ui.shape, fill } }),
    size: { label: 'Width', unit: 'px', min: 1, max: 40, value: ui.shape.strokeWidth, set: (strokeWidth: number) => setUi({ shape: { ...ui.shape, strokeWidth } }) },
  };
  if (tool === 'eraser') return { color: null, onColor: () => undefined, size: { label: 'Size', unit: 'px', min: 1, max: 240, value: ui.brush.size, set: (size: number) => setUi({ brush: { ...ui.brush, size } }) } };
  return {
    color: ui.lineart.color, onColor: (color: string) => setUi({ lineart: { ...ui.lineart, color } }),
    size: { label: 'Size', unit: 'px', min: 1, max: 120, value: ui.lineart.size, set: (size: number) => setUi({ lineart: { ...ui.lineart, size } }) },
  };
}

/** The bottom bar of the board: the same ToolDock as the full Designer (its drawing tools), the quick color and size it always had, and the layers list. */
export function EmbeddedDesignerBar({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const layersPop = usePopover();
  const sizePop = usePopover();
  const paint = useToolPaint(useStore((s) => s.ui.tool));
  return <div className="designer-palette is-docked studio-palette">
    <div className="studio-dock-row">
      <ToolDock sessionId={sessionId} doc={doc} tools={DOCK_TOOLS} />
      {paint.color === null
        ? <IconButton icon={BrushIcon} label="Color" size="md" disabled data-tip="The eraser has no color" />
        : <InlineColor label="Color" iconOnly value={paint.color} onChange={paint.onColor} />}
      <IconButton ref={sizePop.ref} icon={Circle} label="Size" size="md" active={sizePop.open} aria-haspopup="dialog" aria-expanded={sizePop.open} onClick={sizePop.toggle} />
      <Popover open={sizePop.open} anchor={sizePop.ref} onClose={sizePop.close} width={240} label="Size">
        <div className="studio-size-pop"><InlineSlider label={paint.size.label} unit={paint.size.unit} min={paint.size.min} max={paint.size.max} value={paint.size.value} onChange={paint.size.set} /></div>
      </Popover>
      <IconButton ref={layersPop.ref} icon={LayersIcon} label="Layers" size="md" active={layersPop.open} aria-haspopup="dialog" aria-expanded={layersPop.open} onClick={layersPop.toggle} />
      <Popover open={layersPop.open} anchor={layersPop.ref} onClose={layersPop.close} width={260} label="Layers">
        <EmbeddedLayers sessionId={sessionId} doc={doc} />
      </Popover>
    </div>
  </div>;
}
