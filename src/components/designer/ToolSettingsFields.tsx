import { record } from '../../engine/design/history';
import type { ReactNode } from 'react';
import { AlignCenterVertical, ChevronDown, TrianglesCenterlineDashedVertical, TrianglesCenterlineDashedHorizontal, RefreshCw, RotateCcw, RotateCw } from '../ui/icons';
import { alignLayers, distributeLayers, fitLayer, turnLayers, turnProblem, type AlignTo, type RelativeTo, type Turn } from '../../engine/design/transform';
import { layerSelection, useLayerSelection } from '../../engine/design/selection';
import { MenuItem, Segmented } from '../ui/primitives';
import { useObjectSelection } from '../../engine/design/objectSelection';
import { layerObjects } from '../../engine/design/objectOps';
import { alignPicks, distributePicks, pickGroups, turnPicks } from '../../engine/design/multiObjectOps';
import { setUi, useStore, toast } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import type { DesignDoc, StrokeStyle, TextStyle } from '../../engine/types';
import { getDoc, mutateDoc } from '../../engine/design/actions';
import { getSelection, invertSelection, selectAll, selectionToLayer, setSelection, useSelectionVersion, type SelectCombine } from '../../engine/design/pixelSelection';
import { SelectionActions } from './SelectionActions';
import { tokenPatch, tokenOf } from '../../engine/design/tokenBind';
import { FontField, SizeTokenField } from './TokenFields';
import { InlineColor, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';
import { AlignControls } from './AlignControls';
import type { ToolSettingsProps } from './tools/types';

export function ContextField({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const pop = usePopover();
  return <>
    <button type="button" ref={pop.ref} className="tool-setting" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>{label}<ChevronDown size={12} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={230} label={typeof label === 'string' ? label : 'Tool setting'}>
      <div className="tool-setting-content"><div className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</div></div>
    </Popover>
  </>;
}

// Icons by their drawing, not by lucide's old alias names: in this lucide version "FlipHorizontal2" is the triangles
// split by a horizontal line (a top↔bottom mirror), so the names alone pointed at the wrong icon.
const TURN_ITEMS: Array<{ id: Turn; label: string; icon: typeof TrianglesCenterlineDashedVertical }> = [
  { id: 'flip-h', label: 'Mirror left ↔ right', icon: TrianglesCenterlineDashedVertical },
  { id: 'flip-v', label: 'Mirror top ↕ bottom', icon: TrianglesCenterlineDashedHorizontal },
  { id: 'rotate-cw', label: 'Rotate 90° right', icon: RotateCw },
  { id: 'rotate-ccw', label: 'Rotate 90° left', icon: RotateCcw },
  { id: 'rotate-180', label: 'Rotate 180°', icon: RefreshCw },
];


/** Edit tool snapping: on/off and what it sticks to (Alt while dragging moves freely). */
/** Edit acts on the objects inside a layer (default) or on whole layers. Also in the layer's Properties. */
/**
 * Object and Layer are always shown. A raster layer without editable strokes is one whole object.
 */
export function EditModeToggle({ objects = true }: { objects?: boolean }) {
  const mode = useStore((st) => st.ui.selectMode ?? 'objects');
  return <EditModeOptions mode={mode} objects={objects} />;
}

/** The view of the Edit mode choice, with the mode passed in (the store is read by EditModeToggle). */
export function EditModeOptions({ mode, objects = true }: { mode: 'objects' | 'layers'; objects?: boolean }) {
  return <span className="opt edit-mode"><span className="opt-label">Edit</span><Segmented size="sm" value={mode} onChange={(v) => setUi({ selectMode: v })} options={[
    { value: 'objects' as const, label: 'Object', disabled: !objects, tip: objects ? 'Move, align and transform picked objects; images, text and flattened paint count as whole objects' : 'No objects are available. Choose Layer to work with the whole layer.' },
    { value: 'layers' as const, label: 'Layer', tip: 'Move, scale, align and transform whole layers (Ctrl-click picks more layers)' },
  ]} /></span>;
}

/** Click acts on the topmost layer under the pointer (Auto-select, as Photoshop); off: the selected layer only. */
export function AutoSelectToggle() {
  const on = useStore((st) => st.ui.autoSelect ?? false);
  return <InlineToggle label="Auto-select" checked={on} tip="Click acts on the topmost layer under the pointer. Off: only the selected layer, and a click elsewhere keeps the selection" onChange={(v) => setUi({ autoSelect: v })} />;
}

/** Edit tool: align, distribute (3+), fit/fill one image, or transform picked objects/layers. */
export function EditOps({ sessionId, doc, alignOnly = false, turnOnly = false, panelOnly = false, alignPanel }: {
  sessionId: string; doc: DesignDoc; alignOnly?: boolean; turnOnly?: boolean; panelOnly?: boolean;
  alignPanel?: { relativeTo: RelativeTo | null; setRelativeTo: (value: RelativeTo) => void; alignAsGroup: boolean; setAlignAsGroup: (value: boolean) => void };
}) {
  const turn = usePopover();
  const activeTool = useStore((st) => st.ui.tool);
  useLayerSelection((st) => st.byDoc[doc.id]);
  const objPickNow = useObjectSelection((st) => st.byDoc[doc.id]);
  const mode = useStore((st) => st.ui.selectMode ?? 'objects');
  const layerIds = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));
  // A cross-layer group picked on the canvas in Objects mode remains the effective target set.
  const layerGroup = mode === 'layers' || (!objPickNow?.length && layerIds.length > 1);
  const active = doc.layers.find((l) => l.id === doc.activeLayerId);
  // Objects mode: the objects picked inside the active layer. A layer with no parts (an image, a text) is its own
  // object, so it acts on that layer; a layer with parts and none picked acts on nothing (it says so).
  // The pick may span layers: each object is edited in its own layer, in one undo step.
  const objGroups = pickGroups(doc, objPickNow ?? []);
  const objIds = objGroups.flatMap((g) => g.ids);
  const objLayer = objGroups[0]?.layer;
  const onObjects = mode === 'objects' && objIds.length > 0;
  const noParts = !layerGroup && !onObjects && active && !layerObjects(active).length && active.type !== 'vector';
  const ids = layerGroup ? layerIds : noParts ? [active!.id] : [];
  const layers = ids.map((id) => doc.layers.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => Boolean(l));
  // Nothing to act on: the buttons stay (disabled, with the reason) so the bar never changes width or shifts.
  const emptyPick = !onObjects && !layers.length;
  const count = onObjects ? objIds.length : layers.length;
  const many = count > 1;
  const relativeTo = alignPanel?.relativeTo ?? (many ? 'selection' : 'page');
  const alignAsGroup = alignPanel?.alignAsGroup ?? false;
  const groupReason = count < 2 ? 'Select at least two objects or layers to move them as a group.'
    : relativeTo === 'selection' ? 'Choose Page or an anchor; aligning a group to its own selection would not move it.' : undefined;
  const alignReason = alignAsGroup && relativeTo === 'selection' ? groupReason : undefined;
  const anchorEdgeNeedsPair = count < 2 && ['first', 'last', 'biggest', 'smallest'].includes(relativeTo);
  const one = layers[0];
  const locked = onObjects ? objGroups.some((g) => g.layer.locked) : layers.some((l) => l.locked);
  const noun = onObjects ? (objIds.length === 1 ? 'object' : 'objects') : layers.length === 1 ? 'layer' : 'layers';
  // What the menus act on, said at the top of each menu (not on the buttons).
  const target = `On ${count} ${noun}${onObjects ? (objGroups.length > 1 ? ` in ${objGroups.length} layers` : ` of ${objLayer!.name}`) : ''}`;
  const why = !emptyPick ? undefined : !layerGroup ? 'Pick objects on the canvas first (click; Ctrl-click for more), or switch Edit to Layer' : 'Select a layer first';
  const doAlign = (to: AlignTo) => (onObjects ? alignPicks(sessionId, doc.id, doc, objPickNow!, to, relativeTo, alignAsGroup) : alignLayers(sessionId, doc.id, ids, to, relativeTo, alignAsGroup));
  const doDistribute = (axis: 'h' | 'v') => (onObjects ? distributePicks(sessionId, doc.id, doc, objPickNow!, axis) : distributeLayers(sessionId, doc.id, ids, axis));
  const doTurn = (t: Turn) => (onObjects ? turnPicks(sessionId, doc.id, doc, objPickNow!, t) : turnLayers(sessionId, doc.id, ids, t));
  if (panelOnly) {
    if (!alignPanel) return null;
    return <AlignControls target={target} count={count} relativeTo={relativeTo} setRelativeTo={alignPanel.setRelativeTo} alignAsGroup={alignAsGroup}
      setAlignAsGroup={alignPanel.setAlignAsGroup} groupReason={groupReason} alignReason={alignReason} disabledReason={why ?? (locked ? 'Unlock selected layers before aligning or distributing them.' : undefined)} anchorEdgeNeedsPair={anchorEdgeNeedsPair}
      onAlign={doAlign} onDistribute={doDistribute}
      onFit={!onObjects && !many && one?.type === 'raster' ? () => fitLayer(sessionId, doc.id, one.id, 'contain') : undefined}
      onFill={!onObjects && !many && one?.type === 'raster' ? () => fitLayer(sessionId, doc.id, one.id, 'cover') : undefined} />;
  }
  const openAlign = () => window.dispatchEvent(new CustomEvent('ogs:designer-panel', { detail: 'tool' }));
  const alignUnavailable = alignOnly && activeTool !== 'move';
  return <>
    {!turnOnly && <button type="button" className="tool-setting" aria-controls="designer-align-panel" onClick={openAlign} disabled={locked || emptyPick || alignUnavailable} data-tip={alignUnavailable ? 'Switch to Edit to align the selection.' : why ?? 'Align settings in the Tool panel'} aria-label="Align"><AlignCenterVertical size={14} /></button>}
    {!alignOnly && <>
    <button type="button" ref={turn.ref} className="tool-setting" aria-expanded={turn.open} onClick={turn.toggle} disabled={locked || emptyPick} data-tip={why ?? 'Transform: mirror and rotate'} aria-label="Transform"><TrianglesCenterlineDashedVertical size={14} /><ChevronDown size={12} /></button>
    <Popover open={turn.open} anchor={turn.ref} onClose={turn.close} placement="bottom-start" width={220} label="Transform">
      <div className="menu">
        <div className="menu-target">{target}</div>
        {TURN_ITEMS.map((t) => { const no = onObjects ? null : layers.map((l) => turnProblem(l, t.id)).find(Boolean); return <MenuItem key={t.id} icon={t.icon} label={t.label} disabled={Boolean(no)} tip={no ?? undefined} onClick={() => doTurn(t.id)} />; })}
      </div>
    </Popover>
    </>}
  </>;
}

export const SELECT_MODES = [{ value: 'replace' as const, label: 'New' }, { value: 'add' as const, label: 'Add' }, { value: 'subtract' as const, label: 'Subtract' }, { value: 'intersect' as const, label: 'Intersect' }];
export const WAND_DEFAULT = { threshold: 24, expand: 0, smooth: 0, mode: 'replace' as SelectCombine, sample: 'all' as 'layer' | 'all' };

/** Pixel selection: its shape, and what to do with what is selected. */
export function SelectOps({ sessionId, doc, compact = false }: { sessionId: string; doc: DesignDoc; compact?: boolean }) {
  useSelectionVersion();
  const shape = useStore((s) => s.ui.selectShape ?? 'rect');
  const wand = useStore((s) => s.ui.wand) ?? WAND_DEFAULT;
  const setWand = (patch: Partial<typeof WAND_DEFAULT>) => setUi({ wand: { ...wand, ...patch } });
  const sel = getSelection(doc.id);
  const workspace = useStore((s) => s.ui.workspace);
  const run = (fn: () => string | null) => { const err = fn(); if (err) toast(err, 'error'); };
  const cur = () => getDoc(sessionId, doc.id)!;
  const wandOn = shape === 'wand';
  const shapeField = <InlineSelect label="Shape" value={shape} options={[{ value: 'rect' as const, label: 'Rectangle' }, { value: 'ellipse' as const, label: 'Ellipse' }, { value: 'lasso' as const, label: 'Lasso' }, { value: 'polygon' as const, label: 'Polygon' }, { value: 'wand' as const, label: 'Magic wand' }]} onChange={(v) => setUi({ selectShape: v })} />;
  if (compact) return <div className="tool-settings" role="toolbar" aria-label="Selection settings">
    {shapeField}
    {/* What finishes a selection stays at hand, also in the quick strip. */}
    <button type="button" className="opt" disabled={!sel} onClick={() => { record(cur()); setSelection(doc.id, null); }} data-tip="Ctrl+D">Deselect</button>
    <button type="button" className="opt" disabled={!sel} onClick={() => run(() => selectionToLayer(sessionId, cur()))} data-tip="Ctrl+J · copies the selected pixels of the active layer to a new layer">To layer</button>
  </div>;
  return <div className="tool-settings" role="toolbar" aria-label="Selection settings">
    <div className="brush-row select-row">{shapeField}<InlineSelect label="Mode" value={wand.mode} options={SELECT_MODES} onChange={(v) => setWand({ mode: v })} /></div>
    {wandOn ? <>
      <div className="brush-row select-row">
        <InlineSlider label="Tolerance" tip="How different a color can be and still be picked: low = only that color, high = a wider range" min={0} max={255} value={wand.threshold} onChange={(v) => setWand({ threshold: v })} />
        <InlineSelect label="Sample" value={wand.sample} options={[{ value: 'layer' as const, label: 'Active layer' }, { value: 'all' as const, label: 'All layers' }]} onChange={(v) => setWand({ sample: v })} />
      </div>
      <div className="brush-row select-row">
        <InlineSlider label="Grow / shrink" unit="px" tip="Widens each pick, or narrows it when negative" min={-50} max={50} value={wand.expand} onChange={(v) => setWand({ expand: v })} />
        <InlineSlider label="Smooth" unit="px" tip="Softens the jagged edge of each pick" min={0} max={4} step={0.5} value={wand.smooth} onChange={(v) => setWand({ smooth: v })} />
      </div>
    </> : null}
    <div className="brush-row select-row select-actions">
      <button type="button" className="opt" onClick={() => { record(cur()); selectAll(cur()); }} data-tip="Selects the whole page · Ctrl+A">All</button>
      <button type="button" className="opt" onClick={() => { record(cur()); invertSelection(cur()); }} data-tip="Selects everything else · Ctrl+Shift+I">{sel?.inverted ? 'Inverted' : 'Invert'}</button>
    </div>
    {/* In the Designer these float in the selection bar; Studio's board has no such bar. */}
    {workspace !== 'designer' && sel ? <div className="brush-row select-row select-actions"><SelectionActions sessionId={sessionId} doc={doc} /></div> : null}
  </div>;
}

/**
 * Text style fields, the same for the next text (ui.text) and for a selected text layer (its own properties): the
 * caller decides what they change. Compact keeps the essentials (font, size, weight, colour, alignment).
 */
export function TextStyleFields({ value, onChange, compact = false }: { value: TextStyle; onChange: (patch: Partial<TextStyle>) => void; compact?: boolean }) {
  return <>
    <FontField value={value} onChange={onChange} />
    <InlineSlider label="Size" unit="px" min={1} max={500} value={value.fontSize} onChange={(v) => onChange({ fontSize: v })} />
    <SizeTokenField value={value} onChange={onChange} />
    <InlineSelect label="Weight" value={value.fontWeight} options={[100, 200, 300, 400, 500, 600, 700, 800, 900]} onChange={(v) => onChange({ fontWeight: v })} />
    <InlineColor label="Color" value={value.color} alpha={{ value: value.colorOpacity ?? 1, onChange: (o) => onChange({ colorOpacity: o < 1 ? o : undefined }) }} token={tokenOf(value, 'color')} onChange={(c, t, p) => onChange(tokenPatch('color', c, t, p))} />
    <InlineSelect label="Align" value={value.align} options={['left', 'center', 'right'] as const as unknown as Array<TextStyle['align']>} onChange={(v) => onChange({ align: v })} />
    {!compact && <>
      <InlineSlider label="Line" min={0.5} max={3} step={0.1} value={value.lineHeight} onChange={(v) => onChange({ lineHeight: v })} />
      <InlineSlider label="Spacing" unit="px" min={-10} max={40} step={0.5} value={value.letterSpacing} onChange={(v) => onChange({ letterSpacing: v })} />
      <InlineSelect label="Case" value={value.textCase ?? 'none'} options={[{ value: 'none', label: 'As typed' }, { value: 'upper', label: 'UPPER' }, { value: 'lower', label: 'lower' }, { value: 'title', label: 'Title Case' }]} onChange={(v) => onChange({ textCase: v === 'none' ? undefined : v as TextStyle['textCase'] })} />
      <InlineToggle label="Italic" checked={!!value.italic} onChange={(on) => onChange({ italic: on || undefined })} />
      <InlineToggle label="Underline" checked={!!value.underline} onChange={(on) => onChange({ underline: on || undefined })} />
      <InlineToggle label="Strikethrough" checked={!!value.strike} onChange={(on) => onChange({ strike: on || undefined })} />
    </>}
  </>;
}

export function curveStyle(sessionId: string, doc: DesignDoc, selectedCurve: ToolSettingsProps['selectedCurve']) {
  const layer = doc.layers.find((l) => l.id === selectedCurve?.layerId && l.id === doc.activeLayerId);
  const curve = layer?.type === 'vector' && layer.visible && !layer.locked ? layer.strokes?.find((s) => s.id === selectedCurve?.strokeId) : undefined;
  const applyCurveStyle = (patch: Partial<StrokeStyle>) => {
    if (!selectedCurve) return;
    const current = getDoc(sessionId, doc.id);
    const target = current?.layers.find((l) => l.id === selectedCurve.layerId && l.id === current.activeLayerId);
    if (target?.type !== 'vector' || target.locked || !target.visible || !target.strokes?.some((s) => s.id === selectedCurve.strokeId)) return;
    mutateDoc(sessionId, doc.id, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => l.id === target.id && l.type === 'vector' ? { ...l, strokes: l.strokes?.map((s) => s.id === selectedCurve.strokeId ? { ...s, ...patch } : s) } : l) }));
  };
  return { curve, applyCurveStyle };
}
