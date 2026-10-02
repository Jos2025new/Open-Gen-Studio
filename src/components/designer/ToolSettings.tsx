import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { FONT_NAMES } from '../../engine/design/doc';
import { Popover, usePopover } from '../ui/Popover';
import { StrokeStyleFields } from './StrokeStyleFields';

export function ContextField({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const pop = usePopover();
  return <>
    <button type="button" ref={pop.ref} className="tool-setting" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>{label}<ChevronDown size={12} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={230} label={typeof label === 'string' ? label : 'Tool setting'}>
      <div className="tool-setting-content"><div className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</div></div>
    </Popover>
  </>;
}

export function ToolSettings() {
  const tool = useStore((s) => s.ui.tool);
  const brush = useStore((s) => s.ui.brush);
  const lineart = useStore((s) => s.ui.lineart);
  const lineartMode = useStore((s) => s.ui.lineartMode ?? 'draw');
  const influence = useStore((s) => s.ui.lineartInfluence ?? 80);
  const shape = useStore((s) => s.ui.shape);
  const text = useStore((s) => s.ui.text);
  const paint = tool === 'brush' || tool === 'eraser';
  if (tool === 'move' || tool === 'hand') return null;
  return <div className="tool-settings" key={tool} role="toolbar" aria-label={`${tool} settings`}>
        {tool === 'text' ? <>
          <ContextField label={`Font · ${text.fontFamily}`}><select aria-label="Font" value={text.fontFamily} onChange={(e) => setUi({ text: { ...text, fontFamily: e.target.value } })}>{FONT_NAMES.map((name) => <option key={name}>{name}</option>)}</select></ContextField>
          <ContextField label={`Size · ${text.fontSize}px`}><input aria-label="Font size" type="number" min={1} max={500} value={text.fontSize} onChange={(e) => setUi({ text: { ...text, fontSize: Math.max(1, +e.target.value) } })} /></ContextField>
          <ContextField label={`Weight · ${text.fontWeight}`}><select aria-label="Font weight" value={text.fontWeight} onChange={(e) => setUi({ text: { ...text, fontWeight: +e.target.value } })}>{[100,200,300,400,500,600,700,800,900].map((n) => <option key={n}>{n}</option>)}</select></ContextField>
          <ContextField label="Color"><input aria-label="Text color" type="color" value={text.color} onChange={(e) => setUi({ text: { ...text, color: e.target.value } })} /></ContextField>
          <ContextField label={`Align · ${text.align}`}><select aria-label="Text alignment" value={text.align} onChange={(e) => setUi({ text: { ...text, align: e.target.value as typeof text.align } })}>{['left','center','right'].map((n) => <option key={n}>{n}</option>)}</select></ContextField>
          <ContextField label={`Line height · ${text.lineHeight}`}><input aria-label="Line height" type="number" min={0.1} step={0.1} value={text.lineHeight} onChange={(e) => setUi({ text: { ...text, lineHeight: Math.max(0.1, +e.target.value) } })} /></ContextField>
          <ContextField label={`Spacing · ${text.letterSpacing}px`}><input aria-label="Letter spacing" type="number" step={0.5} value={text.letterSpacing} onChange={(e) => setUi({ text: { ...text, letterSpacing: +e.target.value } })} /></ContextField>
        </> : tool === 'fill' ? <>
          <ContextField label="Color"><input type="color" value={brush.color} onChange={(e) => setUi({ brush: { ...brush, color: e.target.value } })} /></ContextField>
          <ContextField label={`Opacity · ${Math.round(brush.opacity * 100)}%`}><input type="range" min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(e) => setUi({ brush: { ...brush, opacity: +e.target.value } })} /></ContextField>
          <ContextField label={`Threshold · ${brush.fillThreshold ?? 24}`}><input aria-label="Fill threshold" type="range" min={0} max={255} step={1} value={brush.fillThreshold ?? 24} onChange={(e) => setUi({ brush: { ...brush, fillThreshold: +e.target.value } })} /></ContextField>
          <ContextField label={`Expand · ${brush.fillExpand ?? 0}px`}><input aria-label="Fill expansion" type="range" min={0} max={12} step={1} value={brush.fillExpand ?? 0} onChange={(e) => setUi({ brush: { ...brush, fillExpand: +e.target.value } })} /></ContextField>
          <ContextField label={`Smooth · ${brush.fillSmooth ?? 0}px`}><input aria-label="Fill smoothing" type="range" min={0} max={4} step={0.5} value={brush.fillSmooth ?? 0} onChange={(e) => setUi({ brush: { ...brush, fillSmooth: +e.target.value } })} /></ContextField>
          
        </> : tool === 'lineart' ? <>
          <ContextField label={lineartMode === 'draw' ? 'Mode · Draw' : 'Mode · Edit'}><select aria-label="Lineart mode" value={lineartMode} onChange={(e) => setUi({ lineartMode: e.target.value as 'draw' | 'edit' })}><option value="draw">Draw</option><option value="edit">Edit</option></select></ContextField>
          {lineartMode === 'edit' ? <ContextField label={`Influence · ${influence}px`} hint="Distance along the stroke affected by dragging a point."><input aria-label="Curve influence" type="range" min={1} max={500} value={influence} onChange={(e) => setUi({ lineartInfluence: +e.target.value })} /></ContextField> : <StrokeStyleFields fieldComponent={ContextField} value={lineart} onChange={(p) => setUi({ lineart: { ...lineart, ...p } })} />}
        </> : paint ? <>
          <ContextField label={`Size · ${brush.size}px`}><input type="range" min={1} max={240} value={brush.size} onChange={(e) => setUi({ brush: { ...brush, size: +e.target.value } })} /></ContextField>
          {tool !== 'eraser' && <ContextField label="Color"><input type="color" value={brush.color} onChange={(e) => setUi({ brush: { ...brush, color: e.target.value } })} /></ContextField>}
          <ContextField label={`Opacity · ${Math.round(brush.opacity * 100)}%`}><input type="range" min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(e) => setUi({ brush: { ...brush, opacity: +e.target.value } })} /></ContextField>
          <ContextField label={`Smoothing · ${brush.smoothing ?? 0}`}><input aria-label="Brush smoothing" type="range" min={0} max={10} step={1} value={brush.smoothing ?? 0} onChange={(e) => setUi({ brush: { ...brush, smoothing: +e.target.value } })} /></ContextField>
          <ContextField label={`Stabilization · ${brush.stabilization ?? 0}`}><input aria-label="Brush stabilization" type="range" min={0} max={10} step={1} value={brush.stabilization ?? 0} onChange={(e) => setUi({ brush: { ...brush, stabilization: +e.target.value } })} /></ContextField>
        </> : <>
          {tool !== 'line' && <ContextField label={shape.fill === null ? "Fill · none" : "Fill"}><input type="color" value={shape.fill ?? '#d4f25a'} onChange={(e) => setUi({ shape: { ...shape, fill: e.target.value } })} /><label className="check-row"><input type="checkbox" checked={shape.fill === null} onChange={(e) => setUi({ shape: { ...shape, fill: e.target.checked ? null : '#d4f25a' } })} />No fill</label></ContextField>}
          <ContextField label={shape.stroke === null ? "Stroke · none" : "Stroke"}><input type="color" value={shape.stroke ?? '#ffffff'} onChange={(e) => setUi({ shape: { ...shape, stroke: e.target.value } })} /><label className="check-row"><input type="checkbox" checked={shape.stroke === null} onChange={(e) => setUi({ shape: { ...shape, stroke: e.target.checked ? null : '#ffffff' } })} />No stroke</label></ContextField>
          <ContextField label={`Stroke width · ${shape.strokeWidth}px`}><input type="range" min={1} max={40} value={shape.strokeWidth} onChange={(e) => setUi({ shape: { ...shape, strokeWidth: +e.target.value } })} /></ContextField>
          {tool === 'rect' && <ContextField label="Corner radius"><input type="number" min={0} max={500} value={shape.radius} onChange={(e) => setUi({ shape: { ...shape, radius: Math.max(0, +e.target.value) } })} /></ContextField>}
        </>}

  </div>;
}
