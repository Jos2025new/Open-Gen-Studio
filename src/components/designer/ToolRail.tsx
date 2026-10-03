import { Brush, Pipette, SquareDashed, Blend, Circle, Eraser, Hand, Minus, MousePointer2, PaintBucket, PenTool, Square, Type, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DesignDoc } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { setUi, useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';

const TOOLS: Array<{ id: DesignTool; icon: LucideIcon; label: string }> = [
  { id: 'move', icon: MousePointer2, label: 'Edit (V) · drag to move, double-click to edit' }, { id: 'hand', icon: Hand, label: 'Pan (H)' },
  { id: 'select', icon: SquareDashed, label: 'Select pixels (M) · rectangle or lasso; Delete, Ctrl+C/X, Ctrl+J to a layer' },
  { id: 'eyedropper', icon: Pipette, label: 'Eyedropper (I) · picks the visible color; Alt-click does it with Brush or Fill' },
  { id: 'fill', icon: PaintBucket, label: 'Fill (G) · contiguous visible color, on a new layer' },
  { id: 'gradient', icon: Blend, label: 'Gradient (U) · drag a line; on a new layer, inside the selection if there is one' },
  { id: 'brush', icon: Brush, label: 'Brush (B)' }, { id: 'lineart', icon: PenTool, label: 'Lineart (P) · editable pressure strokes; Alt-drag bends a stroke' }, { id: 'eraser', icon: Eraser, label: 'Eraser (E)' },
  { id: 'rect', icon: Square, label: 'Rectangle (R)' }, { id: 'ellipse', icon: Circle, label: 'Ellipse (O)' },
  { id: 'line', icon: Minus, label: 'Line (L)' }, { id: 'text', icon: Type, label: 'Text (T)' },
];

export function ToolRail({ doc, children }: { doc: DesignDoc; children?: ReactNode }) {
  const tool = useStore((s) => s.ui.tool);
  return <div className="tool-rail" role="toolbar" aria-label="Design tools">
    {TOOLS.map((t) => { const reason = toolBlockReason(t.id, activeLayer(doc)); return <IconButton key={t.id} icon={t.icon} label={t.label} active={tool === t.id} aria-pressed={tool === t.id} disabled={!!reason} data-tip={reason ?? t.label} onClick={() => setUi({ tool: t.id })} />; })}
    <div className="side-sep" />
    {children}
  </div>;
}
