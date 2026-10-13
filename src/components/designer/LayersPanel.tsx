import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Eye, Grid2x2, Merge, Layers as LayersIcon, SlidersHorizontal, Plus, RotateCcw, Wrench, MoreHorizontal, Folder, FolderInput, FolderOutput, EyeOff, Image, Lock, PanelRightClose, PanelRightOpen, Shapes, Sparkles, Trash, Type, Unlock } from 'lucide-react';
import type { DesignDoc, Layer, OpId, VectorShape } from '../../engine/types';
import { activeLayer, dropIndex, FONT_NAMES } from '../../engine/design/doc';
import { paintOpacity, paintOpacityPatch } from '../../engine/design/shapeLook';
import { StrokeStyleFields } from './StrokeStyleFields';
import { addEmptyLayer, deleteLayers, duplicateLayer, mergeDown, moveLayer, rasterizeLayer, patchLayer, reorderLayer, setActiveLayer } from '../../engine/design/actions';
import { OPS } from '../../engine/ops';
import { BLEND_MODES, drawLayer } from '../../engine/design/render';
import { layerSelection, pickLayer, pickLayerRange, useLayerSelection } from '../../engine/design/selection';
import { ensureBuffers, rasterVersion, subscribeRaster } from '../../engine/design/raster';
import { Field, IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { OpForm } from '../assets/OpForm';
import { usePref } from '../ui/hooks';
import { toast, useStore } from '../../store/store';
import { LayerGeometry } from './LayerGeometry';
import { ToolSettings } from './ToolSettings';
import { ShapeLookFields } from './ShapeLookFields';
import { InlineColor, InlineSlider } from './InlineControls';
import { useObjectSelection } from '../../engine/design/objectSelection';
import { groupLayers, groupMembers, liveGroups, patchGroup, selectGroup, setGroupFlag, ungroup } from '../../engine/design/groups';
import { FxEditor, FxEditorPopover, FxMenu, fxIcon } from './FxPanel';
import { fxTarget } from '../../engine/fx/plan';
import { pendingRasterPaintLayer, subscribeRasterPaintGate } from '../../engine/design/rasterLimit';
import { RasterLimitApproval, RasterLimitControls } from './RasterLimitControls';
import { hasEditableStrokes, paintModeOf } from '../../engine/design/paintMode';

const MIN_W = 200;
const MAX_W = 520;


const BLENDS: Layer['blend'][] = BLEND_MODES;

/** The layer alone, small, over a checkerboard: what it holds at a glance (drawn with the editor's renderer). */
function LayerThumb({ doc, layer }: { doc: DesignDoc; layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = useSyncExternalStore(subscribeRaster, rasterVersion);
  useEffect(() => {
    void ensureBuffers([layer]);
  }, [layer]);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const W = 64, H = 40;
    ctx.clearRect(0, 0, W, H);
    const k = Math.min(W / doc.width, H / doc.height);
    ctx.save();
    ctx.translate((W - doc.width * k) / 2, (H - doc.height * k) / 2);
    ctx.scale(k, k);
    drawLayer(ctx, { ...layer, visible: true, opacity: 1, blend: 'normal' } as Layer);
    ctx.restore();
  }, [doc.width, doc.height, layer, version]);
  return <canvas ref={ref} width={64} height={40} className="layer-thumb" aria-hidden="true" />;
}

/** Layer name: double-click to rename in place (Enter keeps it, Esc cancels). */
function LayerName({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft != null) return <input autoFocus className="layer-name-edit" value={draft} aria-label="Layer name" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setDraft(e.target.value)} onClick={(e) => e.stopPropagation()}
    onBlur={() => { if (draft.trim() && draft.trim() !== name) onRename(draft.trim()); setDraft(null); }}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(null); e.stopPropagation(); }} />;
  return <span className="layer-name" title="Double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); setDraft(name); }}>{name}</span>;
}

/** A folder's header: collapse, name (double-click to rename), its layers' eye and lock, and ungroup. */
function GroupRow({ sessionId, doc, group, onSelect }: { sessionId: string; doc: DesignDoc; group: NonNullable<DesignDoc['groups']>[number]; onSelect: () => void }) {
  const members = groupMembers(doc, group.id);
  const visible = members.some((l) => l.visible);
  const locked = members.every((l) => l.locked);
  return <div className={`layer-row layer-group-row ${visible ? '' : 'is-hidden'} ${locked ? 'is-locked' : ''}`}>
    <IconButton className="layer-toggle" icon={group.collapsed ? ChevronRight : ChevronDown} label={group.collapsed ? 'Expand folder' : 'Collapse folder'} size="sm" onClick={() => patchGroup(sessionId, doc.id, group.id, { collapsed: !group.collapsed }, false)} />
    <button className="layer-select" onClick={onSelect} title="Click to select every layer in the folder (Edit moves them together)">
      <Folder size={14} className="layer-group-icon" />
      <LayerName name={group.name} onRename={(name) => patchGroup(sessionId, doc.id, group.id, { name })} />
      <span className="faint num">{members.length}</span>
    </button>
    <IconButton className={`layer-toggle ${visible ? '' : 'is-on'}`} icon={visible ? Eye : EyeOff} label={`${visible ? 'Hide' : 'Show'} ${group.name}`} size="sm" onClick={() => setGroupFlag(sessionId, doc.id, group.id, 'visible', !visible)} />
    <IconButton className={`layer-toggle ${locked ? 'is-on' : ''}`} icon={locked ? Lock : Unlock} label={`${locked ? 'Unlock' : 'Lock'} ${group.name}`} size="sm" onClick={() => setGroupFlag(sessionId, doc.id, group.id, 'locked', !locked)} />
  </div>;
}

export function LayersPanel({ sessionId, doc, selectedCurve }: { sessionId: string; doc: DesignDoc; selectedCurve: { layerId: string; strokeId: string } | null }) {
  const layer = activeLayer(doc);
  const pendingPaintId = useSyncExternalStore(subscribeRasterPaintGate, pendingRasterPaintLayer);
  const pendingPaintLayer = doc.layers.find((item): item is Extract<Layer, { type: 'raster' }> => item.id === pendingPaintId && item.type === 'raster');
  const tool = useStore((s) => s.ui.tool);
  const pop = usePopover();
  const addPop = usePopover();
  const [op, setOp] = useState<OpId | null>(null);
  // The FX layer whose editor is open next to its row (double-click), and that row.
  const [fxEdit, setFxEdit] = useState<string | null>(null);
  const fxRow = useRef<HTMLElement | null>(null);
  const [width, setWidth] = usePref('ogs:layers-width', 260);
  // The layer list's height under the inspector (dragged on the split); double-click or Restore layout resets it.
  const [listH, setListH] = usePref('ogs:layers-list-h', 240);
  const morePop = usePopover();
  const split = useRef<{ y: number; h: number } | null>(null);
  const [collapsed, setCollapsed] = usePref('ogs:layers-collapsed', false);
  // Three destinations: Properties (what is selected), Tool (the active tool's full settings), Layers (the list alone).
  const [tab, setTab] = usePref<'layers' | 'props' | 'tool'>('ogs:layers-tab', 'props');
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  useEffect(() => {
    const toggle = () => setCollapsed(!collapsedRef.current);
    window.addEventListener('ogs:layers-toggle', toggle);
    return () => window.removeEventListener('ogs:layers-toggle', toggle);
  }, [setCollapsed]);
  // Changing tools keeps the panel as the user left it (closed, or on Layers); only Settings… opens the Tool tab.
  // "Settings…" in the context strip opens this panel on the tool's full settings.
  useEffect(() => {
    const open = (e: Event) => { setTab((e as CustomEvent<'layers' | 'props' | 'tool'>).detail); setCollapsed(false); };
    window.addEventListener('ogs:designer-panel', open);
    return () => window.removeEventListener('ogs:designer-panel', open);
  }, [setTab, setCollapsed]);
  const resize = useRef<{ x: number; w: number } | null>(null);
  const patch = (value: Partial<Layer>) => { if (layer && !layer.locked) patchLayer(sessionId, doc.id, layer.id, value); };
  const index = doc.layers.findIndex((l) => l.id === layer?.id);
  // Several layers picked with Ctrl/Shift-click (Edit's Align and Transform act on all of them).
  useLayerSelection((st) => st.byDoc[doc.id]);
  const picked = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));
  const objPick = useObjectSelection((st) => st.byDoc[doc.id]);
  const groups = liveGroups(doc);
  // Drag to reorder: press and move a row; a line shows where it lands. Locked layers stay put.
  const rows = useRef<Array<HTMLDivElement | null>>([]);
  const [drag, setDrag] = useState<{ id: string; from: number; y: number; active: boolean; slot: number; locked?: boolean } | null>(null);
  const lockedNote = (name: string) => toast(`"${name}" is locked. Unlock it to move it.`, 'error');
  const slotAt = (y: number) => {
    const els = rows.current.slice(0, doc.layers.length);
    const i = els.findIndex((el) => el && y < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2);
    return i < 0 ? doc.layers.length : i;
  };
  const endDrag = () => {
    if (drag?.active) {
      const to = dropIndex(doc.layers.length, drag.from, drag.slot);
      if (to != null) reorderLayer(sessionId, doc.id, drag.id, to);
    }
    setDrag(null);
  };

  // The composer dock centers itself on the free canvas area using this variable.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--layers-w', collapsed ? '40px' : `${width}px`);
    root.setProperty('--layers-list-h', `${listH}px`);
    return () => { root.removeProperty('--layers-w'); root.removeProperty('--layers-list-h'); };
  }, [width, collapsed, listH]);

  if (collapsed) return <aside className="layers-panel is-collapsed" aria-label="Layers">
    <IconButton icon={PanelRightOpen} label="Show layers panel" size="sm" onClick={() => setCollapsed(false)} />
    {pendingPaintLayer && <IconButton icon={AlertTriangle} label="Open layers panel to confirm painting" size="sm" onClick={() => setCollapsed(false)} />}
  </aside>;

  return <aside className={`layers-panel${tab === 'layers' ? ' is-layers-only' : ''}`} aria-label="Layers">
    <div className="layers-split" role="separator" aria-orientation="horizontal" aria-label="Resize the layer list" data-tip="Drag to give the layers more or less room · double-click resets"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); split.current = { y: e.clientY, h: listH }; }}
      onPointerMove={(e) => { const r = split.current; if (r) setListH(Math.round(Math.min(window.innerHeight * 0.75, Math.max(96, r.h + r.y - e.clientY)))); }}
      onPointerUp={() => { split.current = null; }} onPointerCancel={() => { split.current = null; }}
      onDoubleClick={() => setListH(240)} />
    <div className="layers-resize" role="separator" aria-orientation="vertical" aria-label="Resize layers panel"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); resize.current = { x: e.clientX, w: width }; }}
      onPointerMove={(e) => { const r = resize.current; if (r) setWidth(Math.round(Math.min(MAX_W, Math.max(MIN_W, r.w + r.x - e.clientX)))); }}
      onPointerUp={() => { resize.current = null; }} onPointerCancel={() => { resize.current = null; }}
      onDoubleClick={() => setWidth(260)} />
    <div className="panel-tabs" role="tablist" aria-label="Layers panel">
      {([['props', SlidersHorizontal, 'Properties', 'Properties of the selected layer'], ['tool', Wrench, 'Tool', 'All the settings of the active tool'], ['layers', LayersIcon, 'Layers', `Layers only · page ${doc.width} × ${doc.height}`]] as const).map(([id, Icon, name, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} aria-label={label} data-tip={tab === id ? undefined : label} className={`panel-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
          {/* Only the active tab spells its name: three tabs fit the panel; the others say it on hover. */}
          <Icon size={14} />{tab === id && <span>{name}</span>}
        </button>
      ))}
      <span className="panel-tabs-gap" />
      <div className="panel-head-actions">{picked.length > 1 && <span className="layers-picked num"><span className="layers-picked-n">{picked.length} selected</span><button type="button" onClick={() => pickLayer(doc.id, doc.activeLayerId ?? picked[picked.length - 1], false, picked)}>clear</button></span>}<RasterLimitApproval layer={pendingPaintLayer} /><IconButton icon={PanelRightClose} label="Collapse layers panel" size="sm" onClick={() => setCollapsed(true)} /></div>
    </div>
    {layer && <fieldset className="layer-appearance" disabled={layer.locked} aria-label="Selected layer appearance">
        <legend className="layer-appearance-title">Layer · {layer.name}</legend>
        <div className="prop-row">
          <InlineSlider label="Opacity" unit="%" scale={100} min={0} max={1} step={0.01} value={layer.opacity} onChange={(v) => patch({ opacity: v })} />
          <Field label="Blend"><select value={layer.blend} onChange={(e) => patch({ blend: e.target.value as Layer['blend'] })}>{BLENDS.map((b) => <option key={b} value={b}>{b.replace('-', ' ')}</option>)}</select></Field>
        </div>
    </fieldset>}
    <section className="layer-shelf">
    <div className="layer-list">
      {[...doc.layers].reverse().map((l, d, shown) => { const Icon = l.type === 'fx' ? fxIcon(l.group) : l.type === 'raster' ? Image : l.type === 'text' ? Type : Shapes;
        // A folder's header sits above its topmost layer; a collapsed folder hides its layers' rows.
        const group = l.groupId ? groups.find((g) => g.id === l.groupId) : undefined;
        const header = group && shown.findIndex((x) => x.groupId === group.id) === d ? <GroupRow key={`g:${group.id}`} sessionId={sessionId} doc={doc} group={group} onSelect={() => { const top = selectGroup(doc, group.id); if (top) setActiveLayer(sessionId, doc.id, top); }} /> : null;
        if (group?.collapsed) { rows.current[d] = null; return header; }
        return <Fragment key={l.id}>{header}<div ref={(el) => { rows.current[d] = el; }}
        className={`layer-row ${group ? 'in-group' : ''} ${layer?.id === l.id ? 'is-active' : ''} ${l.visible ? '' : 'is-hidden'} ${l.locked ? 'is-locked' : ''} ${picked.length > 1 && picked.includes(l.id) ? 'is-picked' : ''} ${drag?.active && drag.id === l.id ? 'is-dragging' : ''} ${drag?.active && drag.slot === d ? 'drop-before' : ''} ${drag?.active && drag.slot === doc.layers.length && d === doc.layers.length - 1 ? 'drop-after' : ''}`}
        onPointerDown={(e) => { if (e.button !== 0 || (e.target as HTMLElement).closest('input, .layer-toggle')) return; setDrag({ id: l.id, from: d, y: e.clientY, active: false, slot: d, locked: l.locked }); }}
        onPointerMove={(e) => {
          if (!drag || drag.id !== l.id) return;
          if (!(e.buttons & 1)) { setDrag(null); return; }
          if (!drag.active && Math.abs(e.clientY - drag.y) < 5) return;
          // A locked layer does not move: say why, once, instead of ignoring the drag.
          if (drag.locked) { lockedNote(l.name); setDrag(null); return; }
          // Captured only once it really drags, so clicks and double-clicks (rename) still reach the name.
          if (!drag.active) e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ ...drag, active: true, slot: slotAt(e.clientY) });
        }}
        onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}
        onDoubleClick={l.type === 'fx' ? (e) => { if ((e.target as HTMLElement).closest('input, .layer-name, .layer-toggle')) return; fxRow.current = e.currentTarget; setFxEdit(l.id); } : undefined}>
        <button className="layer-select" aria-label={`Select ${l.name}`} aria-pressed={layer?.id === l.id} onClick={(e) => {
          if (drag?.active) return;
          // Shift: the whole run from the active layer to this one (the active layer stays the anchor). Ctrl: add or take out one.
          if (e.shiftKey && !(e.ctrlKey || e.metaKey)) { pickLayerRange(doc.id, doc.activeLayerId, l.id, doc.layers.map((x) => x.id)); pop.close(); return; }
          pickLayer(doc.id, l.id, e.ctrlKey || e.metaKey, picked); setActiveLayer(sessionId, doc.id, l.id); pop.close();
          // Choosing where to paint keeps the brush settings in view; an FX layer is chosen to edit it, so its settings open.
          if (tab === 'tool' && l.type === 'fx') setTab('props');
        }} title="Ctrl-click to add or remove a layer · Shift-click to select every layer up to this one">
          <span className={`layer-thumb-wrap${l.type === 'fx' ? ' is-fx' : ''}`} title={l.type === 'fx' ? 'Double-click to edit' : undefined}>{l.type === 'fx' ? <Icon size={16} /> : <LayerThumb doc={doc} layer={l} />}</span>
          {l.type === 'fx' && <span className="layer-fx-target" data-tip="What this FX layer acts on">→ {l.scope === 'layer' ? fxTarget(doc.layers, l.id)?.name ?? 'no layer under it' : 'everything below'}</span>}
          {layer?.id !== l.id && <LayerName name={l.name} onRename={(name) => { if (!l.locked) patchLayer(sessionId, doc.id, l.id, { name }); }} />}
        </button>
        {layer?.id === l.id && <input key={l.id + l.name} className="layer-name-inline" aria-label="Name" defaultValue={l.name} disabled={l.locked} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== l.name && !l.locked) patchLayer(sessionId, doc.id, l.id, { name: e.target.value.trim() }); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = l.name; e.currentTarget.blur(); } e.stopPropagation(); }} />}
        <span className="layer-kind" data-tip={l.type === 'fx' ? `${l.group} layer · ${l.scope === 'layer' ? 'layer below' : 'everything below'}` : `${l.type} layer`} aria-label={l.type === 'fx' ? `${l.group} layer` : `${l.type} layer`}><Icon size={13} /></span>
        <IconButton className={`layer-toggle ${l.visible ? '' : 'is-on'}`} icon={l.visible ? Eye : EyeOff} label={`${l.visible ? 'Hide' : 'Show'} ${l.name}`} size="sm" onClick={() => patchLayer(sessionId, doc.id, l.id, { visible: !l.visible })} />
        <IconButton className={`layer-toggle ${l.locked ? 'is-on' : ''}`} icon={l.locked ? Lock : Unlock} label={`${l.locked ? 'Unlock' : 'Lock'} ${l.name}`} size="sm" onClick={() => patchLayer(sessionId, doc.id, l.id, { locked: !l.locked })} />
      </div>{l.type === 'raster' && (paintModeOf(doc) === 'design' || hasEditableStrokes(l) || l.paintFlattened) && <RasterLimitControls sessionId={sessionId} docId={doc.id} layer={l} />}</Fragment>; })}
      {!doc.layers.length && <p className="empty-block">Add a layer, draw a shape, or drag an image here.</p>}
    </div>
    <div className="layer-actions">
      <IconButton ref={addPop.ref} icon={Plus} label="New layer" size="sm" className="layer-new-btn" aria-haspopup="menu" aria-expanded={addPop.open} onClick={addPop.toggle} />
      <Popover open={addPop.open} anchor={addPop.ref} onClose={addPop.close} placement="bottom-start" width={180} label="New layer">
        <div className="menu" role="menu">
          <MenuItem icon={Image} label="Raster" detail="Pixels: paint, images" onClick={() => { addEmptyLayer(sessionId, doc.id, 'raster'); addPop.close(); }} />
          <MenuItem icon={Shapes} label="Vector" detail="Shapes and lineart" onClick={() => { addEmptyLayer(sessionId, doc.id, 'vector'); addPop.close(); }} />
          <MenuItem icon={Type} label="Text" onClick={() => { addEmptyLayer(sessionId, doc.id, 'text'); addPop.close(); }} />
        </div>
      </Popover>
      <FxMenu sessionId={sessionId} doc={doc} layer={layer} />
      {layer && <>
        <IconButton icon={Copy} label="Duplicate layer" size="sm" onClick={() => duplicateLayer(sessionId, doc.id, layer.id)} />
        {layer.type === 'raster' && <IconButton ref={pop.ref} size="sm" icon={Sparkles} label="Operations" className="layer-ops-btn" disabled={layer.locked} data-tip="Operations · relight, upscale, remove background… the result is a new layer above" onClick={() => { setOp(null); pop.toggle(); }} />}
        <IconButton icon={ArrowUp} label="Move layer up" size="sm" disabled={index === doc.layers.length - 1} onClick={() => { if (layer.locked) lockedNote(layer.name); else moveLayer(sessionId, doc.id, layer.id, 1); }} />
        <IconButton icon={ArrowDown} label="Move layer down" size="sm" disabled={index === 0} onClick={() => { if (layer.locked) lockedNote(layer.name); else moveLayer(sessionId, doc.id, layer.id, -1); }} />
        <IconButton icon={Trash} label={picked.length > 1 ? `Delete ${picked.length} layers` : 'Delete layer'} size="sm" tone="danger" disabled={picked.every((id) => doc.layers.find((l) => l.id === id)?.locked)} onClick={() => deleteLayers(sessionId, doc.id, picked)} />
        <IconButton ref={morePop.ref} icon={MoreHorizontal} label="More layer actions" size="sm" aria-haspopup="menu" aria-expanded={morePop.open} data-tip="Merge down, rasterize, group · panel layout" onClick={morePop.toggle} />
        <Popover open={morePop.open} anchor={morePop.ref} onClose={morePop.close} placement="top-start" width={220} label="More layer actions">
          <div className="menu" role="menu">
            <MenuItem icon={Merge} label="Merge down" right={<span className="kbd">Ctrl+E</span>} detail="This layer and the one under it become one raster layer" disabled={index === 0 || layer.locked} onClick={() => { void mergeDown(sessionId, doc.id, layer.id); morePop.close(); }} />
            {layer.type !== 'raster' && layer.type !== 'fx' && <MenuItem icon={Grid2x2} label="Rasterize layer" detail="Turn it into pixels you can paint on" disabled={layer.locked} onClick={() => { void rasterizeLayer(sessionId, doc.id, layer.id); morePop.close(); }} />}
            {layer.groupId && picked.every((id) => doc.layers.find((l) => l.id === id)?.groupId === layer.groupId)
              ? <MenuItem icon={FolderOutput} label="Ungroup this folder" onClick={() => { ungroup(sessionId, doc.id, layer.groupId!); morePop.close(); }} />
              : <MenuItem icon={FolderInput} label="Group layers" right={<span className="kbd">Ctrl+G</span>} disabled={picked.length < 2} onClick={() => { groupLayers(sessionId, doc.id, picked); morePop.close(); }} />}
            <MenuItem icon={RotateCcw} label="Restore panel layout" detail={`Width, layer list and tab · page ${doc.width} × ${doc.height}`} onClick={() => { setWidth(260); setListH(240); setTab('props'); morePop.close(); }} />
          </div>
        </Popover>
      </>}
    </div>
    </section>
    <div className="layers-body">
    {tab === 'tool' && <section className={`sidebar-tool-settings settings-${tool}`} aria-label="Active tool settings">
      {tool === 'hand' ? <p className="field-hint">Pan has no additional settings.</p> : <ToolSettings sessionId={sessionId} doc={doc} selectedCurve={selectedCurve} />}
    </section>}
    {tab === 'props' && !layer && <p className="empty-block">Select a layer to see its properties.</p>}
    {layer && <>
      {tab === 'props' && <details className="layer-details" open={propertiesOpen} onToggle={(e) => setPropertiesOpen(e.currentTarget.open)}>
      <summary>Layer properties</summary>
      <fieldset className="layer-properties form-stack" disabled={layer.locked} aria-label="Layer properties">
        {layer.type === 'fx' ? <FxEditor key={layer.id} sessionId={sessionId} doc={doc} layer={layer} /> : <LayerGeometry sessionId={sessionId} doc={doc} layer={layer} />}
        {layer.type === 'raster' && layer.sourceAssetId && <label className="check-row"><input type="checkbox" checked={!!layer.allowPaint} onChange={(e) => patch({ allowPaint: e.target.checked })} />Allow painting on this image</label>}
        {layer.type === 'text' && <>
          <Field label="Text"><textarea rows={3} value={layer.text} onChange={(e) => patch({ text: e.target.value })} /></Field>
          <Field label="Font"><select value={layer.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })}>{FONT_NAMES.map((f) => <option key={f}>{f}</option>)}</select></Field>
          <div className="property-grid"><Field label="Size"><input type="number" min={4} max={1000} value={layer.fontSize} onChange={(e) => patch({ fontSize: Math.min(1000, Math.max(4, +e.target.value)) })} /></Field><Field label="Weight"><select value={layer.fontWeight} onChange={(e) => patch({ fontWeight: +e.target.value })}>{[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w}>{w}</option>)}</select></Field></div>
          <Field label="Text color"><InlineColor label="Text color" value={layer.color} onChange={(color) => patch({ color })} /></Field>
          <Field label="Alignment"><select value={layer.align} onChange={(e) => patch({ align: e.target.value as 'left' | 'center' | 'right' })}>{['left', 'center', 'right'].map((a) => <option key={a}>{a}</option>)}</select></Field>
        </>}
        {layer.type === 'vector' && layer.strokes?.length ? (() => {
          // The strokes picked on the canvas (Edit, Objects mode) are the ones restyled; with none picked, all of them.
          const pickedHere = objPick?.layerId === layer.id ? layer.strokes.filter((st) => objPick.ids.includes(st.id)) : [];
          const targets = pickedHere.length ? pickedHere : layer.strokes;
          const ids = new Set(targets.map((st) => st.id));
          return <>
            <p className="muted">{pickedHere.length
              ? `Styling ${pickedHere.length} picked stroke${pickedHere.length === 1 ? '' : 's'} of ${layer.strokes.length}.`
              : `No stroke picked: changes apply to all ${layer.strokes.length} strokes. Pick one with Edit (click; Ctrl-click for more) to style it alone.`}</p>
            <StrokeStyleFields value={targets[targets.length - 1]} onChange={(p) => patch({ strokes: layer.strokes!.map((st) => (ids.has(st.id) ? { ...st, ...p } : st)) })} />
          </>;
        })() : null}
        {layer.type === 'vector' && (layer.shapes.length > 0 || !layer.strokes?.length) && (() => {
          // A shape picked with Edit: only its section, so its fields fit without scrolling (docs/plan-edicion-formas.md).
          const pickedShapes = objPick?.layerId === layer.id ? layer.shapes.filter((s) => objPick.ids.includes(s.id)) : [];
          const set = (id: string, p: Partial<VectorShape>) => patch({ shapes: layer.shapes.map((x) => (x.id === id ? { ...x, ...p } : x)) });
          return <><p className="muted">{pickedShapes.length ? `Picked shape ${pickedShapes.length === 1 ? '' : `(${pickedShapes.length}) `}of ${layer.shapes.length}.` : `${layer.shapes.length} shapes · draw on the canvas to add more.`}</p>{(pickedShapes.length ? pickedShapes : layer.shapes).map((s) => <div className="shape-properties" key={s.id}><strong>{s.type} {layer.shapes.indexOf(s) + 1}</strong>
            <InlineColor label="Fill" value={s.fill ?? '#d4f25a'} showValue onChange={(fill) => set(s.id, { fill })} alpha={{ value: paintOpacity(s, 'fill'), onChange: (o) => set(s.id, paintOpacityPatch('fill', o)) }} />
            <InlineColor label="Stroke" value={s.stroke ?? '#ffffff'} showValue onChange={(stroke) => set(s.id, { stroke })} alpha={{ value: paintOpacity(s, 'stroke'), onChange: (o) => set(s.id, paintOpacityPatch('stroke', o)) }} />
            <InlineSlider label="Stroke width" unit="px" min={0} max={40} allowManualOverflow value={s.strokeWidth} onChange={(strokeWidth) => set(s.id, { strokeWidth })} />
            <ShapeLookFields value={s} corners={s.type === 'rect'} blur onChange={(p) => set(s.id, p)} /></div>)}</>;
        })()}
      </fieldset>
      </details>}
      <Popover open={pop.open && layer.type === 'raster' && !layer.locked} anchor={pop.ref} onClose={pop.close} label="Layer operations" width={320}>
        {op ? <OpForm key={`${layer.id}:${op}`} op={op} target={{ kind: 'layer', sessionId, docId: doc.id, layerId: layer.id }} onClose={pop.close} onBack={() => setOp(null)} /> : Object.values(OPS).filter((o) => o.input === 'image' && o.output === 'image' && o.id !== 'fx').map((o) => <MenuItem key={o.id} label={o.label} detail={o.description} onClick={() => setOp(o.id)} />)}
      </Popover>
    </>}
    {(() => { const f = doc.layers.find((l) => l.id === fxEdit); return f?.type === 'fx' ? <FxEditorPopover sessionId={sessionId} doc={doc} layer={f} anchor={fxRow} onClose={() => setFxEdit(null)} /> : null; })()}
    </div>
  </aside>;
}
