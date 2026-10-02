import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { FONT_NAMES } from '../../engine/design/doc';
import { Popover, usePopover } from '../ui/Popover';
import { StrokeStyleFields } from './StrokeStyleFields';
import type { DesignDoc, StrokeStyle } from '../../engine/types';
import { getDoc, mutateDoc } from '../../engine/design/actions';

export function ContextField({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const pop = usePopover();
  return <>
    <button type="button" ref={pop.ref} className="tool-setting" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>{label}<ChevronDown size={12} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={230} label={typeof label === 'string' ? label : 'Tool setting'}>
      <div className="tool-setting-content"><div className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</div></div>
    </Popover>
  </>;
}

/**
 * A number set right in the bar: short label, a small slider and the value (type it, or scroll the wheel over it).
 * No menu to open: what it is and what it holds stay in sight.
 */
export function InlineSlider({ label, value, min, max, step = 1, unit = '', scale = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; scale?: number; onChange: (v: number) => void }) {
  const shown = Math.round(value * scale * 100) / 100;
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return <label className="opt" onWheel={(e) => { set(+(value + (e.deltaY < 0 ? step : -step)).toFixed(4)); }}>
    <span className="opt-label">{label}</span>
    <input className="opt-range" type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => set(+e.target.value)} />
    <input className="opt-num num" style={{ width: `${Math.max(1, String(shown).length) + 0.6}ch` }} type="number" min={min * scale} max={max * scale} step={step * scale} value={shown} aria-label={`${label} value`} onChange={(e) => set(+e.target.value / scale)} />
    {unit && <span className="opt-unit">{unit}</span>}
  </label>;
}

/** A color swatch in the bar: click to pick. */
export function InlineColor({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="opt opt-color" data-tip={label}><span className="opt-label">{label}</span><input type="color" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} /></label>;
}

/** A short list in the bar. */
export function InlineSelect<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<T | { value: T; label: string }>; onChange: (v: T) => void }) {
  return <label className="opt"><span className="opt-label">{label}</span><select className="opt-select" aria-label={label} value={String(value)} onChange={(e) => { const hit = options.map((o) => (typeof o === 'object' ? o.value : o)).find((o) => String(o) === e.target.value); if (hit !== undefined) onChange(hit); }}>{options.map((o) => { const v = typeof o === 'object' ? o.value : o; return <option key={String(v)} value={String(v)}>{typeof o === 'object' ? o.label : String(o)}</option>; })}</select></label>;
}

export function ToolSettings({ sessionId, doc, selectedCurve }: { sessionId: string; doc: DesignDoc; selectedCurve: { layerId: string; strokeId: string } | null }) {
  const tool = useStore((s) => s.ui.tool);
  const brush = useStore((s) => s.ui.brush);
  const lineart = useStore((s) => s.ui.lineart);
  const lineartMode = useStore((s) => s.ui.lineartMode ?? 'draw');
  const influence = useStore((s) => s.ui.lineartInfluence ?? 80);
  const shape = useStore((s) => s.ui.shape);
  const text = useStore((s) => s.ui.text);
  const paint = tool === 'brush' || tool === 'eraser';
  const layer = doc.layers.find((l) => l.id === selectedCurve?.layerId && l.id === doc.activeLayerId);
  const curve = layer?.type === 'vector' && layer.visible && !layer.locked ? layer.strokes?.find((s) => s.id === selectedCurve?.strokeId) : undefined;
  const applyCurveStyle = (patch: Partial<StrokeStyle>) => {
    if (!selectedCurve) return;
    const current = getDoc(sessionId, doc.id);
    const target = current?.layers.find((l) => l.id === selectedCurve.layerId && l.id === current.activeLayerId);
    if (target?.type !== 'vector' || target.locked || !target.visible || !target.strokes?.some((s) => s.id === selectedCurve.strokeId)) return;
    mutateDoc(sessionId, doc.id, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => l.id === target.id && l.type === 'vector' ? { ...l, strokes: l.strokes?.map((s) => s.id === selectedCurve.strokeId ? { ...s, ...patch } : s) } : l) }));
  };
  if (tool === 'hand') return null;
  if (tool === 'move') return <div className="tool-settings" role="toolbar" aria-label="Edit settings"><InlineSlider label="Influence" unit="px" min={1} max={500} value={influence} onChange={(v) => setUi({ lineartInfluence: v })} />{curve && <StrokeStyleFields fieldComponent={ContextField} value={curve} onChange={applyCurveStyle} />}</div>;
  return <div className="tool-settings" key={tool} role="toolbar" aria-label={`${tool} settings`}>
        {tool === 'text' ? <>
          <InlineSelect label="Font" value={text.fontFamily} options={FONT_NAMES} onChange={(v) => setUi({ text: { ...text, fontFamily: v } })} />
          <InlineSlider label="Size" unit="px" min={1} max={500} value={text.fontSize} onChange={(v) => setUi({ text: { ...text, fontSize: v } })} />
          <InlineSelect label="Weight" value={text.fontWeight} options={[100, 200, 300, 400, 500, 600, 700, 800, 900]} onChange={(v) => setUi({ text: { ...text, fontWeight: v } })} />
          <InlineColor label="Color" value={text.color} onChange={(v) => setUi({ text: { ...text, color: v } })} />
          <InlineSelect label="Align" value={text.align} options={['left', 'center', 'right'] as const as unknown as Array<typeof text.align>} onChange={(v) => setUi({ text: { ...text, align: v } })} />
          <InlineSlider label="Line" min={0.5} max={3} step={0.1} value={text.lineHeight} onChange={(v) => setUi({ text: { ...text, lineHeight: v } })} />
          <InlineSlider label="Spacing" unit="px" min={-10} max={40} step={0.5} value={text.letterSpacing} onChange={(v) => setUi({ text: { ...text, letterSpacing: v } })} />
        </> : tool === 'fill' ? <>
          <InlineColor label="Color" value={brush.color} onChange={(v) => setUi({ brush: { ...brush, color: v } })} />
          <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => setUi({ brush: { ...brush, opacity: v } })} />
          <InlineSlider label="Threshold" min={0} max={255} value={brush.fillThreshold ?? 24} onChange={(v) => setUi({ brush: { ...brush, fillThreshold: v } })} />
          <InlineSlider label="Expand" unit="px" min={0} max={12} value={brush.fillExpand ?? 0} onChange={(v) => setUi({ brush: { ...brush, fillExpand: v } })} />
          <InlineSlider label="Smooth" unit="px" min={0} max={4} step={0.5} value={brush.fillSmooth ?? 0} onChange={(v) => setUi({ brush: { ...brush, fillSmooth: v } })} />
        </> : tool === 'lineart' ? <>
          <InlineSelect label="Mode" value={lineartMode} options={[{ value: 'draw' as const, label: 'Draw' }, { value: 'edit' as const, label: 'Edit' }]} onChange={(v) => setUi({ lineartMode: v })} />
          {lineartMode === 'edit' ? <><InlineSlider label="Influence" unit="px" min={1} max={500} value={influence} onChange={(v) => setUi({ lineartInfluence: v })} />{curve && <StrokeStyleFields fieldComponent={ContextField} value={curve} onChange={applyCurveStyle} />}</> : <StrokeStyleFields fieldComponent={ContextField} value={lineart} onChange={(p) => setUi({ lineart: { ...lineart, ...p } })} />}
        </> : paint ? <>
          <InlineSlider label="Size" unit="px" min={1} max={240} value={brush.size} onChange={(v) => setUi({ brush: { ...brush, size: v } })} />
          {tool !== 'eraser' && <InlineColor label="Color" value={brush.color} onChange={(v) => setUi({ brush: { ...brush, color: v } })} />}
          <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => setUi({ brush: { ...brush, opacity: v } })} />
          <InlineSlider label="Smoothing" min={0} max={10} value={brush.smoothing ?? 0} onChange={(v) => setUi({ brush: { ...brush, smoothing: v } })} />
          <InlineSlider label="Stabilize" min={0} max={10} value={brush.stabilization ?? 0} onChange={(v) => setUi({ brush: { ...brush, stabilization: v } })} />
        </> : <>
          {tool !== 'line' && <ContextField label={shape.fill === null ? "Fill · none" : "Fill"}><input type="color" value={shape.fill ?? '#d4f25a'} onChange={(e) => setUi({ shape: { ...shape, fill: e.target.value } })} /><label className="check-row"><input type="checkbox" checked={shape.fill === null} onChange={(e) => setUi({ shape: { ...shape, fill: e.target.checked ? null : '#d4f25a' } })} />No fill</label></ContextField>}
          <ContextField label={shape.stroke === null ? "Stroke · none" : "Stroke"}><input type="color" value={shape.stroke ?? '#ffffff'} onChange={(e) => setUi({ shape: { ...shape, stroke: e.target.value } })} /><label className="check-row"><input type="checkbox" checked={shape.stroke === null} onChange={(e) => setUi({ shape: { ...shape, stroke: e.target.checked ? null : '#ffffff' } })} />No stroke</label></ContextField>
          <InlineSlider label="Width" unit="px" min={1} max={40} value={shape.strokeWidth} onChange={(v) => setUi({ shape: { ...shape, strokeWidth: v } })} />
          {tool === 'rect' && <InlineSlider label="Radius" unit="px" min={0} max={200} value={shape.radius} onChange={(v) => setUi({ shape: { ...shape, radius: v } })} />}
        </>}

  </div>;
}
