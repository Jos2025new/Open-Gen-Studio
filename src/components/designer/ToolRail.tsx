import { Brush, Pipette, SquareDashed, Blend, Shapes, Spline, Pentagon, MoveUpRight, Circle, Eraser, Hand, Minus, MousePointer2, PaintBucket, PenTool, Square, Type, type LucideIcon } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import type { DesignDoc } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { setUi, useStore } from '../../store/store';
import { IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';

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
  { id: 'shapes', icon: Shapes, label: 'Shapes', after: 'eraser', tools: [
    { id: 'rect', icon: Square, label: 'Rectangle', key: 'R' }, { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' }, { id: 'polygon', icon: Pentagon, label: 'Polygon' },
  ] },
  { id: 'lines', icon: Spline, label: 'Lines', after: 'eraser', tools: [
    { id: 'line', icon: Minus, label: 'Straight line', key: 'L' }, { id: 'curve', icon: Spline, label: 'Curve' }, { id: 'arrow', icon: MoveUpRight, label: 'Arrow' },
  ] },
];

function ToolGroup({ group, tool, onPick }: { group: (typeof GROUPS)[number]; tool: DesignTool; onPick?: (button: HTMLButtonElement) => void }) {
  const pop = usePopover();
  const current = group.tools.find((t) => t.id === tool);
  return <>
    <IconButton ref={pop.ref} icon={group.icon} label={current ? `${group.label} · ${current.label}` : group.label} active={Boolean(current)} aria-pressed={Boolean(current)} aria-haspopup="menu" aria-expanded={pop.open} className="tool-group-btn" onClick={(e) => { if (e.detail < 2) pop.toggle(); }} onDoubleClick={(e) => { if (current) { pop.close(); onPick?.(e.currentTarget); } }} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={190} label={group.label}>
      <div className="menu" role="menu">
        {group.tools.map((t) => <MenuItem key={t.id} icon={t.icon} label={t.label} right={t.key ? <span className="kbd">{t.key}</span> : undefined} active={t.id === tool} onClick={() => { setUi({ tool: t.id }); pop.close(); }} />)}
      </div>
    </Popover>
  </>;
}

export function ToolRail({ doc, children, onPick }: { doc: DesignDoc; children?: ReactNode; onPick?: (button: HTMLButtonElement) => void }) {
  const tool = useStore((s) => s.ui.tool);
  return <div className="tool-rail" role="toolbar" aria-label="Design tools">
    {children}
    {[[0, 3], [3, 6], [6, TOOLS.length]].map(([start, end]) => <div className="tool-family" key={start}>{TOOLS.slice(start, end).map((t) => { const reason = toolBlockReason(t.id, activeLayer(doc)); return <Fragment key={t.id}><IconButton icon={t.icon} label={t.label} active={tool === t.id} aria-pressed={tool === t.id} disabled={!!reason} data-tip={reason ?? (t.id === 'text' ? 'Text (T) · settings for new text' : t.label)} onClick={() => setUi({ tool: t.id })} onDoubleClick={(e) => onPick?.(e.currentTarget)} />{GROUPS.filter((g) => g.after === t.id).map((g) => <ToolGroup key={g.id} group={g} tool={tool} onPick={onPick} />)}</Fragment>; })}</div>)}
  </div>;
}
