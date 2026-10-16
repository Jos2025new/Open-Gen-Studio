import { Brush as BrushIcon, Circle, Eraser, Hand, Layers as LayersIcon, PenTool, Type } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { setUi, useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { ContextStrip } from '../designer/ContextStrip';
import { InlineColor, InlineSlider } from '../designer/InlineControls';
import { SHAPE_TOOL_IDS, ToolGroup, SHAPES_GROUP } from '../designer/ToolRail';
import { EmbeddedLayers } from './EmbeddedLayers';

/** The tools Studio's board offers: pick and move, pan, line art, eraser, shapes and text. The rest stay in the full Designer. */
export const EMBEDDED_TOOLS: ReadonlySet<DesignTool> = new Set<DesignTool>(['move', 'hand', 'lineart', 'eraser', 'text', ...SHAPE_TOOL_IDS]);

/** The tools whose settings (fonts, fill and stroke…) the quick-settings strip above the bar shows (line art and eraser use the bar's own Color and Size). */
const STRIP_TOOLS = new Set<DesignTool>(['text', ...SHAPE_TOOL_IDS]);

/** Color and size of what the active tool draws, in the same fields and state the full Designer uses for it. */
function useToolPaint(tool: DesignTool) {
  const ui = useStore((s) => s.ui);
  if (tool === 'text') return {
    color: ui.text.color, onColor: (color: string) => setUi({ text: { ...ui.text, color } }),
    size: { label: 'Size', unit: 'px', min: 1, max: 500, value: ui.text.fontSize, set: (fontSize: number) => setUi({ text: { ...ui.text, fontSize } }) },
  };
  if (SHAPE_TOOL_IDS.includes(tool)) return {
    color: ui.shape.fill ?? '#d4f25a', onColor: (fill: string) => setUi({ shape: { ...ui.shape, fill } }),
    size: { label: 'Width', unit: 'px', min: 1, max: 40, value: ui.shape.strokeWidth, set: (strokeWidth: number) => setUi({ shape: { ...ui.shape, strokeWidth } }) },
  };
  if (tool === 'eraser') return { color: null, onColor: () => undefined, size: { label: 'Size', unit: 'px', min: 1, max: 240, value: ui.brush.size, set: (size: number) => setUi({ brush: { ...ui.brush, size } }) } };
  return {
    color: ui.lineart.color, onColor: (color: string) => setUi({ lineart: { ...ui.lineart, color } }),
    size: { label: 'Size', unit: 'px', min: 1, max: 120, value: ui.lineart.size, set: (size: number) => setUi({ lineart: { ...ui.lineart, size } }) },
  };
}

/** A small bar at the bottom of the board, as the full Designer's palette: tools, color, size and the layers list. */
export function EmbeddedDesignerBar({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const tool = useStore((s) => s.ui.tool);
  const sizePop = usePopover();
  const layersPop = usePopover();
  const paint = useToolPaint(tool);
  const layer = activeLayer(doc);
  const button = (id: DesignTool, icon: typeof Hand, label: string) => {
    const reason = toolBlockReason(id, layer);
    return <IconButton key={id} icon={icon} label={label} size="sm" active={tool === id} aria-pressed={tool === id} disabled={!!reason} data-design-tool={id} data-tip={reason ?? label} onClick={() => setUi({ tool: id })} />;
  };
  return <div className="designer-palette is-docked studio-palette">
    {STRIP_TOOLS.has(tool) && <ContextStrip sessionId={sessionId} doc={doc} />}
    <div className="tool-rail" role="toolbar" aria-label="Design tools">
      {button('lineart', PenTool, 'Line art')}
      {paint.color === null
        ? <IconButton icon={BrushIcon} label="Color" size="sm" disabled data-tip="The eraser has no color" />
        : <InlineColor label="Color" iconOnly value={paint.color} onChange={paint.onColor} />}
      <IconButton ref={sizePop.ref} icon={Circle} label="Size" size="sm" active={sizePop.open} aria-haspopup="dialog" aria-expanded={sizePop.open} onClick={sizePop.toggle} />
      <Popover open={sizePop.open} anchor={sizePop.ref} onClose={sizePop.close} width={240} label="Size">
        <div className="studio-size-pop"><InlineSlider label={paint.size.label} unit={paint.size.unit} min={paint.size.min} max={paint.size.max} value={paint.size.value} onChange={paint.size.set} /></div>
      </Popover>
      {button('eraser', Eraser, 'Eraser')}
      <ToolGroup doc={doc} group={SHAPES_GROUP} tool={tool} onSelect={(id) => setUi({ tool: id })} />
      {button('text', Type, 'Text')}
      <IconButton ref={layersPop.ref} icon={LayersIcon} label="Layers" size="sm" active={layersPop.open} aria-haspopup="dialog" aria-expanded={layersPop.open} onClick={layersPop.toggle} />
      <Popover open={layersPop.open} anchor={layersPop.ref} onClose={layersPop.close} width={260} label="Layers">
        <EmbeddedLayers sessionId={sessionId} doc={doc} />
      </Popover>
    </div>
  </div>;
}
