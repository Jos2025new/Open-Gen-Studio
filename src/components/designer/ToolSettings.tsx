import type { ReactNode } from 'react';
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, ChevronDown, FlipHorizontal2, Magnet, FlipVertical2, Maximize, Minimize, RefreshCw, RotateCcw, RotateCw } from 'lucide-react';
import { alignLayers, distributeLayers, fitLayer, turnLayers, turnProblem, type AlignTo, type RelativeTo, type Turn } from '../../engine/design/transform';
import { layerSelection, useLayerSelection } from '../../engine/design/selection';
import { useState } from 'react';
import { SNAP_DEFAULT } from '../../engine/design/snap';
import { MenuItem } from '../ui/primitives';
import { setUi, useStore } from '../../store/store';
import { FONT_NAMES } from '../../engine/design/doc';
import { Popover, usePopover } from '../ui/Popover';
import { StrokeStyleFields } from './StrokeStyleFields';
import type { DesignDoc, StrokeStyle } from '../../engine/types';
import { getDoc, mutateDoc } from '../../engine/design/actions';
import { rememberColor, removeSwatch, saveSwatch } from '../../engine/design/swatches';
import { clearSelected, fillSelection, getSelection, invertSelection, selectAll, selectionToLayer, setSelection, useSelectionVersion } from '../../engine/design/pixelSelection';
import { toast } from '../../store/store';

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

/**
 * A color in the bar: click for the picker, a hex field, the recent colors and the saved ones (shared by every tool).
 * The color is remembered as recent when the panel closes, so dragging in the picker does not fill the list.
 */
export function InlineColor({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const pop = usePopover();
  const sw = useStore((s) => s.ui.swatches) ?? { recent: [], saved: [] };
  const [hex, setHex] = useState(value);
  const close = () => { rememberColor(value); pop.close(); };
  const pick = (c: string) => { onChange(c); setHex(c); };
  const chip = (c: string, saved: boolean) => (
    <button key={`${saved}${c}`} type="button" className={`swatch${c === value.toLowerCase() ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} data-tip={saved ? `${c} · right-click to remove` : c}
      onClick={() => pick(c)} onContextMenu={saved ? (e) => { e.preventDefault(); removeSwatch(c); } : undefined} />
  );
  return <>
    <button type="button" ref={pop.ref} className="opt opt-color" data-tip={label} aria-haspopup="dialog" aria-expanded={pop.open} onClick={() => { setHex(value); pop.toggle(); }}>
      <span className="opt-label">{label}</span><span className="opt-swatch" style={{ background: value }} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={close} placement="bottom-start" width={232} label={label}>
      <div className="swatch-panel">
        <div className="swatch-row">
          <input type="color" value={value} aria-label={label} onChange={(e) => pick(e.target.value)} />
          <input className="swatch-hex" value={hex} aria-label="Hex" spellCheck={false} onChange={(e) => { setHex(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()); }} />
          <button type="button" className="sb-link" onClick={() => saveSwatch(value)} disabled={sw.saved.includes(value.toLowerCase())}>Save</button>
        </div>
        {sw.recent.length > 0 && <><span className="field-label">Recent</span><div className="swatch-grid">{sw.recent.map((c) => chip(c, false))}</div></>}
        <span className="field-label">Saved</span>
        {sw.saved.length ? <div className="swatch-grid">{sw.saved.map((c) => chip(c, true))}</div> : <span className="field-hint">Save colors here to reuse them in any design.</span>}
      </div>
    </Popover>
  </>;
}

/** A short list in the bar: the value with a chevron; the choices open in the app's own menu. */
export function InlineSelect<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<T | { value: T; label: string }>; onChange: (v: T) => void }) {
  const pop = usePopover();
  const items = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
  const current = items.find((o) => o.value === value)?.label ?? String(value);
  return <>
    <button type="button" ref={pop.ref} className="opt opt-pick" aria-haspopup="listbox" aria-expanded={pop.open} onClick={pop.toggle}>
      <span className="opt-label">{label}</span><span className="opt-value">{current}</span><ChevronDown size={12} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={170} label={label}>
      <div className="menu" role="listbox">
        {items.map((o) => <MenuItem key={String(o.value)} label={o.label} active={o.value === value} onClick={() => { onChange(o.value); pop.close(); }} />)}
      </div>
    </Popover>
  </>;
}

const ALIGN_ITEMS: Array<{ id: AlignTo; label: string; icon: typeof AlignStartVertical }> = [
  { id: 'left', label: 'Align left', icon: AlignStartVertical },
  { id: 'center', label: 'Center horizontally', icon: AlignCenterVertical },
  { id: 'right', label: 'Align right', icon: AlignEndVertical },
  { id: 'top', label: 'Align top', icon: AlignStartHorizontal },
  { id: 'middle', label: 'Center vertically', icon: AlignCenterHorizontal },
  { id: 'bottom', label: 'Align bottom', icon: AlignEndHorizontal },
];
const TURN_ITEMS: Array<{ id: Turn; label: string; icon: typeof FlipHorizontal2 }> = [
  { id: 'flip-h', label: 'Flip horizontal', icon: FlipHorizontal2 },
  { id: 'flip-v', label: 'Flip vertical', icon: FlipVertical2 },
  { id: 'rotate-cw', label: 'Rotate 90° right', icon: RotateCw },
  { id: 'rotate-ccw', label: 'Rotate 90° left', icon: RotateCcw },
  { id: 'rotate-180', label: 'Rotate 180°', icon: RefreshCw },
];

const RELATIVE: Array<{ value: RelativeTo; label: string }> = [
  { value: 'page', label: 'Page' },
  { value: 'selection', label: 'Selection' },
  { value: 'first', label: 'First selected' },
  { value: 'last', label: 'Last selected' },
  { value: 'biggest', label: 'Biggest' },
  { value: 'smallest', label: 'Smallest' },
];

/** Edit tool snapping: on/off and what it sticks to (Alt while dragging moves freely). */
function SnapControl() {
  const pop = usePopover();
  const snap = useStore((s) => s.ui.snap) ?? SNAP_DEFAULT;
  const set = (patch: Partial<typeof snap>) => setUi({ snap: { ...snap, ...patch } });
  return <>
    <button type="button" ref={pop.ref} className={`tool-setting ${snap.on ? 'is-on' : ''}`} aria-expanded={pop.open} onClick={pop.toggle} data-tip="Snap while moving"><Magnet size={13} />Snap<ChevronDown size={12} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={220} label="Snap">
      <div className="snap-pop">
        <label className="check-row"><input type="checkbox" checked={snap.on} onChange={(e) => set({ on: e.target.checked })} />Snap while moving</label>
        <label className="check-row is-sub"><input type="checkbox" disabled={!snap.on} checked={snap.page} onChange={(e) => set({ page: e.target.checked })} />Page edges and center</label>
        <label className="check-row is-sub"><input type="checkbox" disabled={!snap.on} checked={snap.layers} onChange={(e) => set({ layers: e.target.checked })} />Other layers</label>
        <p className="faint">Hold Alt while dragging to move freely.</p>
      </div>
    </Popover>
  </>;
}

/**
 * Edit tool: Align (to the page, or with several layers picked relative to the selection, the first or last picked,
 * the biggest or smallest; distribute with 3+; fit or fill for one image) and Transform (flip, quarter turns, each
 * picked layer about its own center).
 */
function EditOps({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const align = usePopover();
  const turn = usePopover();
  const [rel, setRel] = useState<RelativeTo>('selection');
  useLayerSelection((st) => st.byDoc[doc.id]);
  const ids = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));
  const layers = ids.map((id) => doc.layers.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => Boolean(l));
  if (!layers.length) return null;
  const many = layers.length > 1;
  const one = layers[0];
  const locked = layers.some((l) => l.locked);
  return <>
    <button type="button" ref={align.ref} className="tool-setting" aria-expanded={align.open} onClick={align.toggle} disabled={locked}><AlignCenterVertical size={13} />Align{many ? ` · ${layers.length}` : ''}<ChevronDown size={12} /></button>
    <Popover open={align.open} anchor={align.ref} onClose={align.close} placement="bottom-start" width={230} label="Align">
      <div className="menu">
        {many ? (
          <label className="menu-field"><span>Relative to</span><select value={rel} onChange={(e) => setRel(e.target.value as RelativeTo)}>{RELATIVE.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
        ) : <div className="menu-sep-label">To the page</div>}
        {ALIGN_ITEMS.map((a) => <MenuItem key={a.id} icon={a.icon} label={a.label} onClick={() => alignLayers(sessionId, doc.id, ids, a.id, many ? rel : 'page')} />)}
        {layers.length >= 3 ? <>
          <div className="menu-sep-label">Distribute</div>
          <MenuItem icon={AlignHorizontalDistributeCenter} label="Even horizontal gaps" onClick={() => distributeLayers(sessionId, doc.id, ids, 'h')} />
          <MenuItem icon={AlignVerticalDistributeCenter} label="Even vertical gaps" onClick={() => distributeLayers(sessionId, doc.id, ids, 'v')} />
        </> : null}
        {!many && one.type === 'raster' ? <>
          <div className="menu-sep-label">Size</div>
          <MenuItem icon={Minimize} label="Fit inside the page" onClick={() => { fitLayer(sessionId, doc.id, one.id, 'contain'); align.close(); }} />
          <MenuItem icon={Maximize} label="Fill the page" onClick={() => { fitLayer(sessionId, doc.id, one.id, 'cover'); align.close(); }} />
        </> : null}
      </div>
    </Popover>
    <button type="button" ref={turn.ref} className="tool-setting" aria-expanded={turn.open} onClick={turn.toggle} disabled={locked}><FlipHorizontal2 size={13} />Transform{many ? ` · ${layers.length}` : ''}<ChevronDown size={12} /></button>
    <Popover open={turn.open} anchor={turn.ref} onClose={turn.close} placement="bottom-start" width={220} label="Transform">
      <div className="menu">
        {TURN_ITEMS.map((t) => { const why = layers.map((l) => turnProblem(l, t.id)).find(Boolean); return <MenuItem key={t.id} icon={t.icon} label={t.label} disabled={Boolean(why)} tip={why ?? undefined} onClick={() => turnLayers(sessionId, doc.id, ids, t.id)} />; })}
      </div>
    </Popover>
  </>;
}

/** With another tool active, a pixel selection still shows in the bar (it still clips Delete, copy and the gradient). */
export function SelectionChip({ docId }: { docId: string }) {
  useSelectionVersion();
  const tool = useStore((s) => s.ui.tool);
  const sel = getSelection(docId);
  if (!sel || tool === 'select') return null;
  return <span className="opt selection-chip" data-tip="Delete, copy, cut and the gradient act inside it">
    <span className="opt-label">{sel.inverted ? 'Selection · inverted' : 'Selection'}</span>
    <button type="button" className="sb-link" onClick={() => setSelection(docId, null)}>Deselect</button>
  </span>;
}

/** Pixel selection: its shape, and what to do with what is selected. */
function SelectOps({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  useSelectionVersion();
  const shape = useStore((s) => s.ui.selectShape ?? 'rect');
  const brush = useStore((s) => s.ui.brush);
  const sel = getSelection(doc.id);
  const run = (fn: () => string | null) => { const err = fn(); if (err) toast(err, 'error'); };
  const cur = () => getDoc(sessionId, doc.id)!;
  return <div className="tool-settings" role="toolbar" aria-label="Selection settings">
    <InlineSelect label="Shape" value={shape} options={[{ value: 'rect' as const, label: 'Rectangle' }, { value: 'lasso' as const, label: 'Lasso' }]} onChange={(v) => setUi({ selectShape: v })} />
    <button type="button" className="opt" onClick={() => selectAll(cur())} data-tip="Ctrl+A">All</button>
    <button type="button" className="opt" onClick={() => invertSelection(cur())} data-tip="Ctrl+Shift+I">{sel?.inverted ? 'Inverted' : 'Invert'}</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => setSelection(doc.id, null)} data-tip="Ctrl+D">Deselect</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => run(() => clearSelected(sessionId, cur()))} data-tip="Delete · erases the selected pixels of the active raster layer">Delete</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => run(() => fillSelection(sessionId, cur(), brush.color, brush.opacity))} data-tip="Fills the selection with the brush color, on a new layer">Fill</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => run(() => selectionToLayer(sessionId, cur()))} data-tip="Ctrl+J · copies the selected pixels of the active layer to a new layer">To layer</button>
  </div>;
}

export function ToolSettings({ sessionId, doc, selectedCurve }: { sessionId: string; doc: DesignDoc; selectedCurve: { layerId: string; strokeId: string } | null }) {
  const tool = useStore((s) => s.ui.tool);
  const selectMode = useStore((s) => s.ui.selectMode ?? 'objects');
  const brush = useStore((s) => s.ui.brush);
  const lineart = useStore((s) => s.ui.lineart);
  const lineartMode = useStore((s) => s.ui.lineartMode ?? 'draw');
  const influence = useStore((s) => s.ui.lineartInfluence ?? 80);
  const shape = useStore((s) => s.ui.shape);
  const text = useStore((s) => s.ui.text);
  const gradient = useStore((s) => s.ui.gradient);
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
  if (tool === 'select') return <SelectOps sessionId={sessionId} doc={doc} />;
  if (tool === 'eyedropper') return <div className="tool-settings" role="toolbar" aria-label="Eyedropper settings"><InlineColor label="Picked" value={brush.color} onChange={(v) => setUi({ brush: { ...brush, color: v } })} /><span className="opt-hint">Click the page to pick its visible color</span></div>;
  if (tool === 'gradient') {
    const g = gradient ?? { shape: 'linear' as const, mode: 'two' as const, color2: '#000000', opacity: 1 };
    const set = (patch: Partial<typeof g>) => setUi({ gradient: { ...g, ...patch } });
    return <div className="tool-settings" role="toolbar" aria-label="Gradient settings">
      <InlineSelect label="Shape" value={g.shape} options={[{ value: 'linear' as const, label: 'Linear' }, { value: 'radial' as const, label: 'Radial' }]} onChange={(v) => set({ shape: v })} />
      <InlineColor label="Color" value={brush.color} onChange={(v) => setUi({ brush: { ...brush, color: v } })} />
      <InlineSelect label="To" value={g.mode} options={[{ value: 'two' as const, label: 'Second color' }, { value: 'fade' as const, label: 'Transparent' }]} onChange={(v) => set({ mode: v })} />
      {g.mode === 'two' && <InlineColor label="Second" value={g.color2} onChange={(v) => set({ color2: v })} />}
      <button type="button" className="opt" onClick={() => setUi({ brush: { ...brush, color: g.color2 }, gradient: { ...g, color2: brush.color } })} data-tip="Swap the two colors">⇄</button>
      <label className="opt check-row"><input type="checkbox" checked={!!g.reverse} onChange={(e) => set({ reverse: e.target.checked })} />Reverse</label>
      <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={g.opacity} onChange={(v) => set({ opacity: v })} />
    </div>;
  }
  if (tool === 'move') return <div className="tool-settings" role="toolbar" aria-label="Edit settings"><span data-tip="Ctrl-click picks more strokes of the active layer (Objects) or more layers (Layers)"><InlineSelect label="Select" value={selectMode} options={[{ value: 'objects' as const, label: 'Objects' }, { value: 'layers' as const, label: 'Layers' }]} onChange={(v) => setUi({ selectMode: v })} /></span><SnapControl /><EditOps sessionId={sessionId} doc={doc} /><InlineSlider label="Influence" unit="px" min={1} max={500} value={influence} onChange={(v) => setUi({ lineartInfluence: v })} />{curve && <StrokeStyleFields fieldComponent={ContextField} value={curve} onChange={applyCurveStyle} />}</div>;
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
