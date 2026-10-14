import { DraftingCompass, Brush, Pipette, SquareDashed, Blend, Shapes, Spline, Pentagon, Star, PieChart, MoveUpRight, Circle, Eraser, Hand, Minus, MousePointer2, PaintBucket, PenTool, Square, Type, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DesignDoc } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { setUi, useStore } from '../../store/store';
import { IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { EditOps } from './ToolSettings';
import { SnapControl } from './SnapControl';
import { ContextStrip } from './ContextStrip';

const TOOLS: Array<{ id: DesignTool; icon: LucideIcon; label: string }> = [
  { id: 'move', icon: MousePointer2, label: 'Edit (V) · drag to move and select objects' }, { id: 'hand', icon: Hand, label: 'Pan (H)' },
  { id: 'select', icon: SquareDashed, label: 'Select pixels (M) · rectangle, lasso or magic wand; Shift adds, Alt subtracts; Delete, Ctrl+C/X, Ctrl+J to a layer' },
  { id: 'eyedropper', icon: Pipette, label: 'Eyedropper (I) · picks the visible color; Alt-click does it with Brush or Fill' },
  { id: 'fill', icon: PaintBucket, label: 'Fill (G) · contiguous visible color, on a new layer' },
  { id: 'gradient', icon: Blend, label: 'Gradient (U) · drag a line; on a new layer, inside the selection if there is one' },
  { id: 'brush', icon: Brush, label: 'Brush (B)' }, { id: 'lineart', icon: PenTool, label: 'Lineart (P) · editable pressure strokes; Alt-drag bends a stroke' }, { id: 'eraser', icon: Eraser, label: 'Eraser (E)' },
  { id: 'ruler', icon: DraftingCompass, label: 'Ruler (K) · place a straight or ellipse guide; the brush follows it while it is on' },
  { id: 'text', icon: Type, label: 'Text (T)' },
];

/*
 * Where every tool lives in the rail, by family (2026-10-10, docs/plan-designer-ux.md): the rail is drawn from this
 * list and tests/designer-inventory.test.ts fails if a tool has no place in it, so none can get lost when the rail
 * changes. Frequent tools stay one click away; only variants (shapes and lines, fill and gradient) share a button.
 */
export type RailItem = DesignTool | 'group:shapes' | 'group:fill';
export const RAIL: Array<{ family: string; items: RailItem[] }> = [
  { family: 'Edit', items: ['move', 'hand'] },
  { family: 'Select', items: ['select'] },
  { family: 'Paint', items: ['brush', 'eraser', 'lineart', 'group:fill'] },
  { family: 'Shapes and text', items: ['group:shapes', 'text'] },
  { family: 'Guides and color', items: ['ruler', 'eyedropper'] },
];

/** Tools that share one rail button: it shows the family's icon and opens its choices. */
const GROUPS: Array<{ id: string; icon: LucideIcon; label: string; after: DesignTool; tools: Array<{ id: DesignTool; icon: LucideIcon; label: string; key?: string }> }> = [
  { id: 'shapes', icon: Shapes, label: 'Shapes', after: 'eyedropper', tools: [
    { id: 'rect', icon: Square, label: 'Rectangle', key: 'R' }, { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' }, { id: 'polygon', icon: Pentagon, label: 'Polygon' }, { id: 'star', icon: Star, label: 'Star' }, { id: 'sector', icon: PieChart, label: 'Sector' }, { id: 'arc', icon: Spline, label: 'Arc' }, { id: 'chord', icon: Circle, label: 'Chord' },
  ] },
  { id: 'lines', icon: Spline, label: 'Lines', after: 'eyedropper', tools: [
    { id: 'line', icon: Minus, label: 'Straight line', key: 'L' }, { id: 'curve', icon: Spline, label: 'Curve' }, { id: 'arrow', icon: MoveUpRight, label: 'Arrow' },
  ] },
];
const FILL_GROUP = { id: 'fill', icon: PaintBucket, label: 'Fill and gradient', after: 'eyedropper' as DesignTool, tools: [
  { id: 'fill' as DesignTool, icon: PaintBucket, label: 'Fill', key: 'G' }, { id: 'gradient' as DesignTool, icon: Blend, label: 'Gradient', key: 'U' },
] };
const SHAPES_GROUP = { ...GROUPS[0], label: 'Shapes and lines', tools: [...GROUPS[0].tools, ...GROUPS[1].tools] };
/** Every tool the rail offers, directly or inside a group: what the inventory test checks. */
export function railTools(): DesignTool[] {
  return RAIL.flatMap((f) => f.items).flatMap((i) => (i === 'group:shapes' ? SHAPES_GROUP.tools.map((t) => t.id) : i === 'group:fill' ? FILL_GROUP.tools.map((t) => t.id) : [i]));
}

function ToolGroup({ group, tool, doc, onSelect }: { doc: DesignDoc; group: { id: string; icon: LucideIcon; label: string; tools: Array<{ id: DesignTool; icon: LucideIcon; label: string; key?: string }> }; tool: DesignTool; onSelect: (tool: DesignTool) => void }) {
  const pop = usePopover();
  const current = group.tools.find((t) => t.id === tool);
  return <>
    <IconButton ref={pop.ref} icon={current?.icon ?? group.icon} label={current ? `${group.label} · ${current.label}` : group.label} active={Boolean(current)} aria-pressed={Boolean(current)} aria-haspopup="menu" aria-expanded={pop.open} className="tool-group-btn" onClick={(e) => { if (e.detail < 2) pop.toggle(); }} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={190} label={group.label}>
      <div className="menu" role="menu">
        {group.tools.map((t) => <MenuItem key={t.id} icon={t.icon} label={t.label.split(' · ')[0]} right={t.key ? <span className="kbd">{t.key}</span> : undefined} active={t.id === tool} disabled={!!toolBlockReason(t.id, activeLayer(doc))} tip={toolBlockReason(t.id, activeLayer(doc)) ?? t.label} onClick={() => { onSelect(t.id); pop.close(); }} />)}
      </div>
    </Popover>
  </>;
}

export function ToolRail({ sessionId, doc }: { sessionId: string; doc: DesignDoc; children?: ReactNode }) {
  const ui = useStore((s) => s.ui);
  const tool = ui.tool;
  const rail = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(false); }, [tool, doc.id]);
  useEffect(() => {
    // Auxiliary menus replace the strip; its own fields and drawing on the canvas keep it open.
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const palette = rail.current?.closest('.composer-tools-bar') ?? rail.current?.closest('.designer-palette');
      if (target?.closest('button') && palette?.contains(target) && !target.closest('.context-strip, [data-design-tool]')) setHidden(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  const select = (id: DesignTool) => { setHidden(false); setUi({ tool: id }); };
  const button = (id: DesignTool) => {
    const t = TOOLS.find((t) => t.id === id)!;
    const reason = toolBlockReason(id, activeLayer(doc));
    return <IconButton key={id} icon={t.icon} label={t.label} active={tool === id} aria-pressed={tool === id} aria-expanded={tool === id && id !== 'hand' && !hidden} disabled={!!reason} data-design-tool={id} data-tip={reason ?? t.label} onClick={() => { if (tool === id) setHidden((v) => !v); else select(id); }} />;
  };
  const item = (i: RailItem) => (i === 'group:shapes' ? <ToolGroup key={i} doc={doc} group={SHAPES_GROUP} tool={tool} onSelect={select} /> : i === 'group:fill' ? <ToolGroup key={i} doc={doc} group={FILL_GROUP} tool={tool} onSelect={select} /> : button(i));
  return <>{!hidden && <ContextStrip sessionId={sessionId} doc={doc} />}<div ref={rail} className="tool-rail" role="toolbar" aria-label="Design tools">
    <div className="palette-fixed">
      {RAIL.map((f) => <div key={f.family} className="tool-family" role="group" aria-label={f.family}>
        {f.items.map(item)}
        {f.family === 'Edit' && <><span className="palette-snap"><SnapControl /></span><span className="palette-snap"><EditOps sessionId={sessionId} doc={doc} alignOnly /></span></>}
      </div>)}
    </div>


  </div></>;
}
