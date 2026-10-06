import { record } from '../../engine/design/history';
import type { ReactNode } from 'react';
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, ChevronDown, TrianglesCenterlineDashedVertical, TrianglesCenterlineDashedHorizontal, Magnet, Maximize, Minimize, RefreshCw, RotateCcw, RotateCw } from 'lucide-react';
import { alignLayers, distributeLayers, fitLayer, turnLayers, turnProblem, type AlignTo, type RelativeTo, type Turn } from '../../engine/design/transform';
import { layerSelection, useLayerSelection } from '../../engine/design/selection';
import { useState } from 'react';
import { SNAP_DEFAULT } from '../../engine/design/snap';
import { MenuItem, Segmented } from '../ui/primitives';
import { useObjectSelection } from '../../engine/design/objectSelection';
import { alignPickedObjects, distributePickedObjects, layerObjects, turnPickedObjects } from '../../engine/design/objectOps';
import { setUi, useStore } from '../../store/store';
import { FONT_NAMES } from '../../engine/design/doc';
import { Popover, usePopover } from '../ui/Popover';
import { StrokeStyleFields } from './StrokeStyleFields';
import type { DesignDoc, StrokeStyle } from '../../engine/types';
import { getDoc, mutateDoc } from '../../engine/design/actions';
import { clearSelected, fillSelection, getSelection, invertSelection, selectAll, selectionToLayer, setSelection, useSelectionVersion } from '../../engine/design/pixelSelection';
import { toast } from '../../store/store';
import { InlineColor, InlineSelect, InlineSlider } from './InlineControls';

export function ContextField({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const pop = usePopover();
  return <>
    <button type="button" ref={pop.ref} className="tool-setting" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>{label}<ChevronDown size={12} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={230} label={typeof label === 'string' ? label : 'Tool setting'}>
      <div className="tool-setting-content"><div className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</div></div>
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
// Icons by their drawing, not by lucide's old alias names: in this lucide version "FlipHorizontal2" is the triangles
// split by a horizontal line (a top↔bottom mirror), so the names alone pointed at the wrong icon.
const TURN_ITEMS: Array<{ id: Turn; label: string; icon: typeof TrianglesCenterlineDashedVertical }> = [
  { id: 'flip-h', label: 'Mirror left ↔ right', icon: TrianglesCenterlineDashedVertical },
  { id: 'flip-v', label: 'Mirror top ↕ bottom', icon: TrianglesCenterlineDashedHorizontal },
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
/** Edit acts on the objects inside a layer (default) or on whole layers. Also in the layer's Properties. */
export function EditModeToggle() {
  const mode = useStore((st) => st.ui.selectMode ?? 'objects');
  return <span className="opt edit-mode"><span className="opt-label">Edit</span><Segmented size="sm" value={mode} onChange={(v) => setUi({ selectMode: v })} options={[
    { value: 'objects', label: 'Objects', tip: 'Move, align and transform the strokes and shapes you pick inside a layer; the layer stays put' },
    { value: 'layers', label: 'Layer', tip: 'Move, scale, align and transform whole layers (Ctrl-click picks more layers)' },
  ]} /></span>;
}

function SnapControl() {
  const pop = usePopover();
  const snap = useStore((s) => s.ui.snap) ?? SNAP_DEFAULT;
  const set = (patch: Partial<typeof snap>) => setUi({ snap: { ...snap, ...patch } });
  return <>
    <button type="button" ref={pop.ref} className={`tool-setting ${snap.on ? 'is-on' : ''}`} aria-expanded={pop.open} onClick={pop.toggle} data-tip={`Snap while moving · ${snap.on ? "on" : "off"}`} aria-label="Snap"><Magnet size={14} /><ChevronDown size={12} /></button>
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
  const objPickNow = useObjectSelection((st) => st.byDoc[doc.id]);
  const mode = useStore((st) => st.ui.selectMode ?? 'objects');
  const layerIds = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));
  const active = doc.layers.find((l) => l.id === doc.activeLayerId);
  // Objects mode: the objects picked inside the active layer. A layer with no parts (an image, a text) is its own
  // object, so it acts on that layer; a layer with parts and none picked acts on nothing (it says so).
  const objLayer = objPickNow && doc.layers.find((l) => l.id === objPickNow.layerId);
  const objIds = objLayer ? objPickNow!.ids.filter((id) => layerObjects(objLayer).some((o) => o.id === id)) : [];
  const onObjects = mode === 'objects' && Boolean(objLayer && objIds.length);
  const noParts = mode === 'objects' && !onObjects && active && !layerObjects(active).length && active.type !== 'vector';
  const ids = mode === 'layers' ? layerIds : noParts ? [active!.id] : [];
  const layers = ids.map((id) => doc.layers.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => Boolean(l));
  // Nothing to act on: the buttons stay (disabled, with the reason) so the bar never changes width or shifts.
  const emptyPick = !onObjects && !layers.length;
  const count = onObjects ? objIds.length : layers.length;
  const many = count > 1;
  const one = layers[0];
  const locked = onObjects ? Boolean(objLayer?.locked) : layers.some((l) => l.locked);
  const noun = onObjects ? (objIds.length === 1 ? 'object' : 'objects') : layers.length === 1 ? 'layer' : 'layers';
  // What the menus act on, said at the top of each menu (not on the buttons).
  const target = `On ${count} ${noun}${onObjects ? ` of ${objLayer!.name}` : ''}`;
  const why = !emptyPick ? undefined : mode === 'objects' ? 'Pick objects on the canvas first (click; Ctrl-click for more), or switch Edit to Layer' : 'Select a layer first';
  const doAlign = (to: AlignTo) => (onObjects ? alignPickedObjects(sessionId, doc.id, objLayer!.id, objIds, to, many ? rel : 'page') : alignLayers(sessionId, doc.id, ids, to, many ? rel : 'page'));
  const doDistribute = (axis: 'h' | 'v') => (onObjects ? distributePickedObjects(sessionId, doc.id, objLayer!.id, objIds, axis) : distributeLayers(sessionId, doc.id, ids, axis));
  const doTurn = (t: Turn) => (onObjects ? turnPickedObjects(sessionId, doc.id, objLayer!.id, objIds, t) : turnLayers(sessionId, doc.id, ids, t));
  return <>
    <button type="button" ref={align.ref} className="tool-setting" aria-expanded={align.open} onClick={align.toggle} disabled={locked || emptyPick} data-tip={why ?? 'Align'} aria-label="Align"><AlignCenterVertical size={14} /><ChevronDown size={12} /></button>
    <Popover open={align.open} anchor={align.ref} onClose={align.close} placement="bottom-start" width={230} label="Align">
      <div className="menu">
        <div className="menu-target">{target}</div>
        {many ? (
          <label className="menu-field"><span>Relative to</span><select value={rel} onChange={(e) => setRel(e.target.value as RelativeTo)}>{RELATIVE.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
        ) : <div className="menu-sep-label">To the page</div>}
        {ALIGN_ITEMS.map((a) => <MenuItem key={a.id} icon={a.icon} label={a.label} onClick={() => doAlign(a.id)} />)}
        {count >= 3 ? <>
          <div className="menu-sep-label">Distribute</div>
          <MenuItem icon={AlignHorizontalDistributeCenter} label="Even horizontal gaps" onClick={() => doDistribute('h')} />
          <MenuItem icon={AlignVerticalDistributeCenter} label="Even vertical gaps" onClick={() => doDistribute('v')} />
        </> : null}
        {!onObjects && !many && one?.type === 'raster' ? <>
          <div className="menu-sep-label">Size</div>
          <MenuItem icon={Minimize} label="Fit inside the page" onClick={() => { fitLayer(sessionId, doc.id, one.id, 'contain'); align.close(); }} />
          <MenuItem icon={Maximize} label="Fill the page" onClick={() => { fitLayer(sessionId, doc.id, one.id, 'cover'); align.close(); }} />
        </> : null}
      </div>
    </Popover>
    <button type="button" ref={turn.ref} className="tool-setting" aria-expanded={turn.open} onClick={turn.toggle} disabled={locked || emptyPick} data-tip={why ?? 'Transform: mirror and rotate'} aria-label="Transform"><TrianglesCenterlineDashedVertical size={14} /><ChevronDown size={12} /></button>
    <Popover open={turn.open} anchor={turn.ref} onClose={turn.close} placement="bottom-start" width={220} label="Transform">
      <div className="menu">
        <div className="menu-target">{target}</div>
        {TURN_ITEMS.map((t) => { const no = onObjects ? null : layers.map((l) => turnProblem(l, t.id)).find(Boolean); return <MenuItem key={t.id} icon={t.icon} label={t.label} disabled={Boolean(no)} tip={no ?? undefined} onClick={() => doTurn(t.id)} />; })}
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

const WAND_DEFAULT = { threshold: 24, expand: 0, smooth: 0, mode: 'replace' as 'replace' | 'add' | 'subtract', sample: 'all' as 'layer' | 'all' };

/** Pixel selection: its shape, and what to do with what is selected. */
function SelectOps({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  useSelectionVersion();
  const shape = useStore((s) => s.ui.selectShape ?? 'rect');
  const wand = useStore((s) => s.ui.wand) ?? WAND_DEFAULT;
  const setWand = (patch: Partial<typeof WAND_DEFAULT>) => setUi({ wand: { ...wand, ...patch } });
  const brush = useStore((s) => s.ui.brush);
  const sel = getSelection(doc.id);
  const run = (fn: () => string | null) => { const err = fn(); if (err) toast(err, 'error'); };
  const cur = () => getDoc(sessionId, doc.id)!;
  return <div className="tool-settings" role="toolbar" aria-label="Selection settings">
    <InlineSelect label="Shape" value={shape} options={[{ value: 'rect' as const, label: 'Rectangle' }, { value: 'lasso' as const, label: 'Lasso' }, { value: 'wand' as const, label: 'Magic wand' }]} onChange={(v) => setUi({ selectShape: v })} />
    {shape === 'wand' ? <>
      <span data-tip="How different a color can be and still be picked: low = only that color, high = a wider range"><InlineSlider label="Tolerance" min={0} max={255} value={wand.threshold} onChange={(v) => setWand({ threshold: v })} /></span>
      <InlineSlider label="Expand" unit="px" min={0} max={12} value={wand.expand} onChange={(v) => setWand({ expand: v })} />
      <InlineSlider label="Smooth" unit="px" min={0} max={4} step={0.5} value={wand.smooth} onChange={(v) => setWand({ smooth: v })} />
      <span data-tip="New replaces the selection; Add and Subtract change it (Shift adds, Alt subtracts with any shape)"><InlineSelect label="Mode" value={wand.mode} options={[{ value: 'replace' as const, label: 'New' }, { value: 'add' as const, label: 'Add' }, { value: 'subtract' as const, label: 'Subtract' }]} onChange={(v) => setWand({ mode: v })} /></span>
      <span data-tip="Active layer: only its own pixels and elements decide · All layers: the whole visible picture"><InlineSelect label="Sample" value={wand.sample} options={[{ value: 'layer' as const, label: 'Active layer' }, { value: 'all' as const, label: 'All layers' }]} onChange={(v) => setWand({ sample: v })} /></span>
    </> : null}
    <button type="button" className="opt" onClick={() => { record(cur()); selectAll(cur()); }} data-tip="Ctrl+A">All</button>
    <button type="button" className="opt" onClick={() => { record(cur()); invertSelection(cur()); }} data-tip="Ctrl+Shift+I">{sel?.inverted ? 'Inverted' : 'Invert'}</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => { record(cur()); setSelection(doc.id, null); }} data-tip="Ctrl+D">Deselect</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => run(() => clearSelected(sessionId, cur()))} data-tip="Delete · erases the selected pixels of the active raster layer">Delete</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => run(() => fillSelection(sessionId, cur(), brush.color, brush.opacity))} data-tip="Fills the selection with the brush color, on a new layer">Fill</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => run(() => selectionToLayer(sessionId, cur()))} data-tip="Ctrl+J · copies the selected pixels of the active layer to a new layer">To layer</button>
  </div>;
}

export function ToolSettings({ sessionId, doc, selectedCurve }: { sessionId: string; doc: DesignDoc; selectedCurve: { layerId: string; strokeId: string } | null }) {
  const tool = useStore((s) => s.ui.tool);
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
  if (tool === 'move') return <div className="tool-settings" role="toolbar" aria-label="Edit settings"><EditModeToggle /><SnapControl /><EditOps sessionId={sessionId} doc={doc} /><InlineSlider label="Influence" unit="px" min={1} max={500} value={influence} onChange={(v) => setUi({ lineartInfluence: v })} />{curve && <StrokeStyleFields value={curve} onChange={applyCurveStyle} />}</div>;
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
          {lineartMode === 'edit' ? <><InlineSlider label="Influence" unit="px" min={1} max={500} value={influence} onChange={(v) => setUi({ lineartInfluence: v })} />{curve && <StrokeStyleFields value={curve} onChange={applyCurveStyle} />}</> : <StrokeStyleFields value={lineart} onChange={(p) => setUi({ lineart: { ...lineart, ...p } })} />}
        </> : paint ? <>
          <InlineSlider label="Size" unit="px" min={1} max={240} value={brush.size} onChange={(v) => setUi({ brush: { ...brush, size: v } })} />
          {tool !== 'eraser' && <InlineColor label="Color" value={brush.color} onChange={(v) => setUi({ brush: { ...brush, color: v } })} />}
          <InlineSlider label="Opacity" unit="%" scale={100} min={0.01} max={1} step={0.01} value={brush.opacity} onChange={(v) => setUi({ brush: { ...brush, opacity: v } })} />
          <InlineSlider label="Smoothing" min={0} max={10} value={brush.smoothing ?? 0} onChange={(v) => setUi({ brush: { ...brush, smoothing: v } })} />
          <InlineSlider label="Stabilize" min={0} max={10} value={brush.stabilization ?? 0} onChange={(v) => setUi({ brush: { ...brush, stabilization: v } })} />
        </> : <>
          {tool !== 'line' && tool !== 'curve' && tool !== 'arrow' && <ContextField label={shape.fill === null ? "Fill · none" : "Fill"}><input type="color" value={shape.fill ?? '#d4f25a'} onChange={(e) => setUi({ shape: { ...shape, fill: e.target.value } })} /><label className="check-row"><input type="checkbox" checked={shape.fill === null} onChange={(e) => setUi({ shape: { ...shape, fill: e.target.checked ? null : '#d4f25a' } })} />No fill</label></ContextField>}
          <ContextField label={shape.stroke === null ? "Stroke · none" : "Stroke"}><input type="color" value={shape.stroke ?? '#ffffff'} onChange={(e) => setUi({ shape: { ...shape, stroke: e.target.value } })} /><label className="check-row"><input type="checkbox" checked={shape.stroke === null} onChange={(e) => setUi({ shape: { ...shape, stroke: e.target.checked ? null : '#ffffff' } })} />No stroke</label></ContextField>
          <InlineSlider label="Width" unit="px" min={1} max={40} value={shape.strokeWidth} onChange={(v) => setUi({ shape: { ...shape, strokeWidth: v } })} />
          {tool === 'polygon' && <InlineSlider label="Sides" min={3} max={12} value={shape.sides ?? 5} onChange={(v) => setUi({ shape: { ...shape, sides: v } })} />}
          {tool === 'curve' && <span data-tip="How far the curve bows from the straight line; negative bows to the other side"><InlineSlider label="Bend" unit="%" min={-100} max={100} value={shape.bend ?? 30} onChange={(v) => setUi({ shape: { ...shape, bend: v } })} /></span>}
          {tool === 'rect' && <InlineSlider label="Radius" unit="px" min={0} max={200} value={shape.radius} onChange={(v) => setUi({ shape: { ...shape, radius: v } })} />}
        </>}

  </div>;
}
