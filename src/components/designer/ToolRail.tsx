import { Ruler, Brush, Pipette, SquareDashed, Blend, Shapes, Spline, Pentagon, MoveUpRight, Circle, Eraser, Hand, Minus, MousePointer2, PaintBucket, PenTool, Square, Type, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DesignDoc } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { setUi, useStore } from '../../store/store';
import { IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { InlineColor, InlineSlider } from './InlineControls';
import { SnapControl } from './ToolSettings';

const TOOLS: Array<{ id: DesignTool; icon: LucideIcon; label: string }> = [
  { id: 'move', icon: MousePointer2, label: 'Edit (V) · drag to move, double-click to edit' }, { id: 'hand', icon: Hand, label: 'Pan (H)' },
  { id: 'select', icon: SquareDashed, label: 'Select pixels (M) · rectangle, lasso or magic wand; Shift adds, Alt subtracts; Delete, Ctrl+C/X, Ctrl+J to a layer' },
  { id: 'eyedropper', icon: Pipette, label: 'Eyedropper (I) · picks the visible color; Alt-click does it with Brush or Fill' },
  { id: 'fill', icon: PaintBucket, label: 'Fill (G) · contiguous visible color, on a new layer' },
  { id: 'gradient', icon: Blend, label: 'Gradient (U) · drag a line; on a new layer, inside the selection if there is one' },
  { id: 'brush', icon: Brush, label: 'Brush (B)' }, { id: 'lineart', icon: PenTool, label: 'Lineart (P) · editable pressure strokes; Alt-drag bends a stroke' }, { id: 'eraser', icon: Eraser, label: 'Eraser (E)' },
  { id: 'text', icon: Type, label: 'Text (T)' },
];

/** Tools that share one rail button: it shows the family's icon and opens its choices. */
const GROUPS: Array<{ id: string; icon: LucideIcon; label: string; after: DesignTool; tools: Array<{ id: DesignTool; icon: LucideIcon; label: string; key?: string }> }> = [
  { id: 'shapes', icon: Shapes, label: 'Shapes', after: 'eyedropper', tools: [
    { id: 'rect', icon: Square, label: 'Rectangle', key: 'R' }, { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' }, { id: 'polygon', icon: Pentagon, label: 'Polygon' },
  ] },
  { id: 'lines', icon: Spline, label: 'Lines', after: 'eyedropper', tools: [
    { id: 'line', icon: Minus, label: 'Straight line', key: 'L' }, { id: 'curve', icon: Spline, label: 'Curve' }, { id: 'arrow', icon: MoveUpRight, label: 'Arrow' },
  ] },
];

function ToolGroup({ group, tool, doc, onPick }: { doc: DesignDoc; group: (typeof GROUPS)[number]; tool: DesignTool; onPick?: (button: HTMLButtonElement) => void }) {
  const pop = usePopover();
  const current = group.tools.find((t) => t.id === tool);
  return <>
    <IconButton ref={pop.ref} icon={current?.icon ?? group.icon} label={current ? `${group.label} · ${current.label}` : group.label} active={Boolean(current)} aria-pressed={Boolean(current)} aria-haspopup="menu" aria-expanded={pop.open} className="tool-group-btn" onClick={(e) => { if (e.detail < 2) pop.toggle(); }} onDoubleClick={(e) => { if (current) { pop.close(); onPick?.(e.currentTarget); } }} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={190} label={group.label}>
      <div className="menu" role="menu">
        {group.tools.map((t) => <MenuItem key={t.id} icon={t.icon} label={t.label} right={t.key ? <span className="kbd">{t.key}</span> : undefined} active={t.id === tool} disabled={!!toolBlockReason(t.id, activeLayer(doc))} tip={toolBlockReason(t.id, activeLayer(doc)) ?? undefined} onClick={() => { setUi({ tool: t.id }); pop.close(); }} />)}
      </div>
    </Popover>
  </>;
}

export function ToolRail({ doc, onPick }: { doc: DesignDoc; children?: ReactNode; onPick?: (button: HTMLButtonElement) => void }) {
  const ui = useStore((s) => s.ui);
  const tool = ui.tool;
  const shapeTool = ['rect', 'ellipse', 'polygon', 'line', 'curve', 'arrow'].includes(tool);
  const color = tool === 'text' ? ui.text.color : tool === 'lineart' ? ui.lineart.color : shapeTool ? ui.shape.fill ?? ui.brush.color : ui.brush.color;
  const setColor = (color: string) => setUi(tool === 'text' ? { text: { ...ui.text, color } } : tool === 'lineart' ? { lineart: { ...ui.lineart, color } } : shapeTool ? { shape: { ...ui.shape, fill: color } } : { brush: { ...ui.brush, color } });
  const influence = tool === 'move' || (tool === 'lineart' && ui.lineartMode === 'edit');
  const size = influence ? ui.lineartInfluence ?? 80 : tool === 'text' ? ui.text.fontSize : tool === 'lineart' ? ui.lineart.size : shapeTool ? ui.shape.strokeWidth : ui.brush.size;
  const setSize = (v: number) => setUi(influence ? { lineartInfluence: v } : tool === 'text' ? { text: { ...ui.text, fontSize: v } } : tool === 'lineart' ? { lineart: { ...ui.lineart, size: v } } : shapeTool ? { shape: { ...ui.shape, strokeWidth: v } } : { brush: { ...ui.brush, size: v } });
  const button = (id: DesignTool) => {
    const t = TOOLS.find((t) => t.id === id)!;
    const reason = toolBlockReason(id, activeLayer(doc));
    return <IconButton key={id} icon={t.icon} label={t.label} active={tool === id} aria-pressed={tool === id} disabled={!!reason} data-tip={reason ?? t.label} onClick={() => setUi({ tool: id })} onDoubleClick={(e) => onPick?.(e.currentTarget)} />;
  };
  const shapes = { ...GROUPS[0], tools: [...GROUPS[0].tools, ...GROUPS[1].tools] };
  const paint = { id: 'paint', icon: Brush, label: 'Paint', after: 'hand' as DesignTool, tools: TOOLS.filter((t) => ['brush', 'eraser', 'select'].includes(t.id)) };
  return <div className="tool-rail" role="toolbar" aria-label="Design tools">
    <div className="tool-family">{button('move')}{button('hand')}<span className="palette-snap"><SnapControl /></span><IconButton icon={Ruler} label={`${ui.rulers ? 'Hide' : 'Show'} rulers and guides (Shift+R)`} active={ui.rulers ?? false} aria-pressed={ui.rulers ?? false} size="sm" onClick={() => setUi({ rulers: !ui.rulers })} /></div>
    <div className="tool-family palette-quick">
      <InlineColor label="Active color" value={color} onChange={setColor} />{button('eyedropper')}
      {!['hand', 'select', 'eyedropper', 'fill', 'gradient'].includes(tool) && <InlineSlider label={influence ? 'Influence' : 'Size'} unit="px" min={1} max={influence || tool === 'text' ? 500 : tool === 'lineart' ? 120 : shapeTool ? 40 : 240} value={size} onChange={setSize} />}
    </div>
    <div className="tool-family"><ToolGroup doc={doc} group={shapes} tool={tool} onPick={onPick} /><ToolGroup doc={doc} group={paint} tool={tool} onPick={onPick} />{button('lineart')}{button('text')}{button('fill')}{button('gradient')}</div>
  </div>;
}
