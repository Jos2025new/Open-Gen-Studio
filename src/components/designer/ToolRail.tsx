import { Brush, Circle, Eraser, Hand, Minus, MousePointer2, SlidersHorizontal, Square, Type, type LucideIcon } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { setUi, useStore } from '../../store/store';
import { Field, IconButton } from '../ui/primitives';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';

const TOOLS: Array<{ id: DesignTool; icon: LucideIcon; label: string }> = [
  { id: 'move', icon: MousePointer2, label: 'Move (V)' }, { id: 'hand', icon: Hand, label: 'Pan (H)' },
  { id: 'brush', icon: Brush, label: 'Brush (B)' }, { id: 'eraser', icon: Eraser, label: 'Eraser (E)' },
  { id: 'rect', icon: Square, label: 'Rectangle (R)' }, { id: 'ellipse', icon: Circle, label: 'Ellipse (O)' },
  { id: 'line', icon: Minus, label: 'Line (L)' }, { id: 'text', icon: Type, label: 'Text (T)' },
];

export function ToolRail({ doc }: { doc: DesignDoc }) {
  const tool = useStore((s) => s.ui.tool);
  const brush = useStore((s) => s.ui.brush);
  const shape = useStore((s) => s.ui.shape);
  const pop = usePopover();
  const paint = tool === 'brush' || tool === 'eraser';
  return <div className="tool-rail" role="toolbar" aria-label="Design tools">
    {TOOLS.map((t) => { const reason = toolBlockReason(t.id, activeLayer(doc)); return <IconButton key={t.id} icon={t.icon} label={t.label} active={tool === t.id} aria-pressed={tool === t.id} disabled={!!reason} data-tip={reason ?? t.label} onClick={() => setUi({ tool: t.id })} />; })}
    <div className="side-sep" />
    <IconButton ref={pop.ref} icon={SlidersHorizontal} label="Tool settings" onClick={pop.toggle} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="top-start" label="Tool settings" width={260}>
      <PopoverHeader title={paint ? 'Brush settings' : 'Shape settings'} />
      <div className="form-stack">
        {paint ? <>
          <Field label={`Size · ${brush.size}px`}><input type="range" min={1} max={240} value={brush.size} onChange={(e) => setUi({ brush: { ...brush, size: +e.target.value } })} /></Field>
          <Field label="Color"><input type="color" value={brush.color} onChange={(e) => setUi({ brush: { ...brush, color: e.target.value } })} /></Field>
          <Field label={`Opacity · ${Math.round(brush.opacity * 100)}%`}><input type="range" min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(e) => setUi({ brush: { ...brush, opacity: +e.target.value } })} /></Field>
        </> : <>
          <Field label="Fill"><input type="color" value={shape.fill ?? '#d4f25a'} onChange={(e) => setUi({ shape: { ...shape, fill: e.target.value } })} /></Field>
          <label className="check-row"><input type="checkbox" checked={shape.fill === null} onChange={(e) => setUi({ shape: { ...shape, fill: e.target.checked ? null : '#d4f25a' } })} />No fill</label>
          <Field label="Stroke"><input type="color" value={shape.stroke ?? '#ffffff'} onChange={(e) => setUi({ shape: { ...shape, stroke: e.target.value } })} /></Field>
          <label className="check-row"><input type="checkbox" checked={shape.stroke === null} onChange={(e) => setUi({ shape: { ...shape, stroke: e.target.checked ? null : '#ffffff' } })} />No stroke</label>
          <Field label={`Stroke width · ${shape.strokeWidth}px`}><input type="range" min={1} max={40} value={shape.strokeWidth} onChange={(e) => setUi({ shape: { ...shape, strokeWidth: +e.target.value } })} /></Field>
          <Field label="Corner radius"><input type="number" min={0} max={500} value={shape.radius} onChange={(e) => setUi({ shape: { ...shape, radius: Math.max(0, +e.target.value) } })} /></Field>
        </>}
      </div>
    </Popover>
  </div>;
}
