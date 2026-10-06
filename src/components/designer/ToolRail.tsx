import { ChevronLeft, ChevronRight, Ruler, Brush, Pipette, SquareDashed, Blend, Shapes, Spline, Pentagon, MoveUpRight, Circle, Eraser, Hand, Minus, MousePointer2, PaintBucket, PenTool, Square, Type, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DesignDoc } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { setUi, useStore } from '../../store/store';
import { IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { InlineColor, InlineSlider } from './InlineControls';
import { EditOps, SnapControl, ToolSettings } from './ToolSettings';

const TOOLS: Array<{ id: DesignTool; icon: LucideIcon; label: string }> = [
  { id: 'move', icon: MousePointer2, label: 'Edit (V) · drag to move and select objects' }, { id: 'hand', icon: Hand, label: 'Pan (H)' },
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

function ToolGroup({ group, tool, doc }: { doc: DesignDoc; group: (typeof GROUPS)[number]; tool: DesignTool }) {
  const pop = usePopover();
  const current = group.tools.find((t) => t.id === tool);
  return <>
    <IconButton ref={pop.ref} icon={current?.icon ?? group.icon} label={current ? `${group.label} · ${current.label}` : group.label} active={Boolean(current)} aria-pressed={Boolean(current)} aria-haspopup="menu" aria-expanded={pop.open} className="tool-group-btn" onClick={(e) => { if (e.detail < 2) pop.toggle(); }} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={190} label={group.label}>
      <div className="menu" role="menu">
        {group.tools.map((t) => <MenuItem key={t.id} icon={t.icon} label={t.label.split(' · ')[0]} right={t.key ? <span className="kbd">{t.key}</span> : undefined} active={t.id === tool} disabled={!!toolBlockReason(t.id, activeLayer(doc))} tip={toolBlockReason(t.id, activeLayer(doc)) ?? t.label} onClick={() => { setUi({ tool: t.id }); pop.close(); }} />)}
      </div>
    </Popover>
  </>;
}

function ContextControls({ tool, children }: { tool: DesignTool; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const next = { overflow: el.scrollWidth > el.clientWidth + 1, left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 };
    setEdges((old) => old.overflow === next.overflow && old.left === next.left && old.right === next.right ? old : next);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft = 0;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, [tool]);
  return <div className="tool-family palette-quick">
    {edges.overflow && <button type="button" className="context-scroll" aria-label="Scroll tool settings left" data-tip="Previous tool settings" disabled={!edges.left} onClick={() => ref.current?.scrollBy({ left: -180, behavior: 'smooth' })}><ChevronLeft size={12} /></button>}
    <div ref={ref} className="palette-quick-scroll" onScroll={measure}><div className="palette-quick-content">{children}</div></div>
    {edges.overflow && <button type="button" className="context-scroll" aria-label="Scroll tool settings right" data-tip="More tool settings" disabled={!edges.right} onClick={() => ref.current?.scrollBy({ left: 180, behavior: 'smooth' })}><ChevronRight size={12} /></button>}
  </div>;
}

export function ToolRail({ sessionId, doc }: { sessionId: string; doc: DesignDoc; children?: ReactNode }) {
  const ui = useStore((s) => s.ui);
  const tool = ui.tool;
  const shapeTool = ['rect', 'ellipse', 'polygon', 'line', 'curve', 'arrow'].includes(tool);
  const strokeTool = ['line', 'curve', 'arrow'].includes(tool);
  const color = tool === 'text' ? ui.text.color : tool === 'lineart' ? ui.lineart.color : shapeTool ? (strokeTool ? ui.shape.stroke ?? '#ffffff' : ui.shape.fill ?? '#d4f25a') : ui.brush.color;
  const setColor = (color: string) => setUi(tool === 'text' ? { text: { ...ui.text, color } } : tool === 'lineart' ? { lineart: { ...ui.lineart, color } } : shapeTool ? { shape: { ...ui.shape, [strokeTool ? 'stroke' : 'fill']: color } } : { brush: { ...ui.brush, color } });
  const influence = tool === 'move' || (tool === 'lineart' && ui.lineartMode === 'edit');
  const contextualSettings = ['select', 'fill', 'gradient'].includes(tool);
  const size = influence ? ui.lineartInfluence ?? 80 : tool === 'text' ? ui.text.fontSize : tool === 'lineart' ? ui.lineart.size : shapeTool ? ui.shape.strokeWidth : ui.brush.size;
  const setSize = (v: number) => setUi(influence ? { lineartInfluence: v } : tool === 'text' ? { text: { ...ui.text, fontSize: v } } : tool === 'lineart' ? { lineart: { ...ui.lineart, size: v } } : shapeTool ? { shape: { ...ui.shape, strokeWidth: v } } : { brush: { ...ui.brush, size: v } });
  const button = (id: DesignTool) => {
    const t = TOOLS.find((t) => t.id === id)!;
    const reason = toolBlockReason(id, activeLayer(doc));
    return <IconButton key={id} icon={t.icon} label={t.label} active={tool === id} aria-pressed={tool === id} disabled={!!reason} data-tip={reason ?? t.label} onClick={() => setUi({ tool: id })} />;
  };
  const shapes = { ...GROUPS[0], tools: [...GROUPS[0].tools, ...GROUPS[1].tools] };
  return <div className="tool-rail" role="toolbar" aria-label="Design tools">
    <div className="palette-fixed"><div className="tool-family">{button('move')}{button('hand')}<span className="palette-snap"><SnapControl /></span><span className="palette-snap"><EditOps sessionId={sessionId} doc={doc} alignOnly /></span><IconButton icon={Ruler} label={`${ui.rulers ? 'Hide' : 'Show'} rulers and guides (Shift+R)`} active={ui.rulers ?? false} aria-pressed={ui.rulers ?? false} size="sm" onClick={() => setUi({ rulers: !ui.rulers })} /></div>
    <div className="tool-family"><InlineColor label="Active color" value={color} onChange={setColor} />{button('brush')}{button('eraser')}<ToolGroup doc={doc} group={shapes} tool={tool} />{button('lineart')}{button('select')}{button('text')}{button('fill')}{button('gradient')}</div>
    </div>
    <ContextControls tool={tool}>
      {contextualSettings ? <>{button('eyedropper')}<ToolSettings sessionId={sessionId} doc={doc} selectedCurve={null} compact /></> : <>
      {button('eyedropper')}
      {!['hand', 'select', 'eyedropper', 'fill', 'gradient'].includes(tool) && <InlineSlider label={influence ? 'Influence' : 'Size'} unit="px" min={1} max={influence || tool === 'text' ? 500 : tool === 'lineart' ? 120 : shapeTool ? 40 : 240} value={size} onChange={setSize} />}
      </>}
    </ContextControls>

  </div>;
}
