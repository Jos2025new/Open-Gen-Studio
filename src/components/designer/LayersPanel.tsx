import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Eye, Plus, Folder, FolderInput, FolderOutput, EyeOff, Image, Lock, PanelRightClose, PanelRightOpen, Shapes, Sparkles, Trash, Type, Unlock } from 'lucide-react';
import type { DesignDoc, Layer, OpId } from '../../engine/types';
import { activeLayer, dropIndex, FONT_NAMES } from '../../engine/design/doc';
import { restyleStrokes } from '../../engine/design/strokes';
import { StrokeStyleFields } from './StrokeStyleFields';
import { addEmptyLayer, deleteLayer, duplicateLayer, moveLayer, patchLayer, reorderLayer, setActiveLayer } from '../../engine/design/actions';
import { OPS } from '../../engine/ops';
import { drawLayer } from '../../engine/design/render';
import { layerSelection, pickLayer, useLayerSelection } from '../../engine/design/selection';
import { ensureBuffers, rasterVersion, subscribeRaster } from '../../engine/design/raster';
import { Button, Field, IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { OpForm } from '../assets/OpForm';
import { usePref } from '../ui/hooks';
import { toast } from '../../store/store';
import { groupLayers, groupMembers, liveGroups, patchGroup, selectGroup, setGroupFlag, ungroup } from '../../engine/design/groups';

const MIN_W = 200;
const MAX_W = 520;

function Section({ title, open, onToggle, extra, children }: { title: ReactNode; open: boolean; onToggle: () => void; extra?: ReactNode; children: ReactNode }) {
  return <section className="panel-section">
    <div className="panel-head"><button type="button" className="section-toggle" aria-expanded={open} onClick={onToggle}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<strong>{title}</strong></button>{extra}</div>
    {open && children}
  </section>;
}

const BLENDS: Layer['blend'][] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light', 'difference', 'color', 'luminosity'];

/** The layer alone, small, over a checkerboard: what it holds at a glance (drawn with the editor's renderer). */
function LayerThumb({ doc, layer }: { doc: DesignDoc; layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = useSyncExternalStore(subscribeRaster, rasterVersion);
  useEffect(() => {
    if (layer.type === 'raster') void ensureBuffers([layer]);
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

export function LayersPanel({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const layer = activeLayer(doc);
  const pop = usePopover();
  const addPop = usePopover();
  const [op, setOp] = useState<OpId | null>(null);
  const [width, setWidth] = usePref('ogs:layers-width', 260);
  const [collapsed, setCollapsed] = usePref('ogs:layers-collapsed', false);
  const [sections, setSections] = usePref('ogs:layers-sections', { layers: true, props: true });
  const resize = useRef<{ x: number; w: number } | null>(null);
  const patch = (value: Partial<Layer>) => { if (layer && !layer.locked) patchLayer(sessionId, doc.id, layer.id, value); };
  const index = doc.layers.findIndex((l) => l.id === layer?.id);
  // Several layers picked with Ctrl/Shift-click (Edit's Align and Transform act on all of them).
  useLayerSelection((st) => st.byDoc[doc.id]);
  const picked = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));
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
    return () => { root.removeProperty('--layers-w'); };
  }, [width, collapsed]);

  if (collapsed) return <aside className="layers-panel is-collapsed" aria-label="Layers">
    <IconButton icon={PanelRightOpen} label="Show layers panel" size="sm" onClick={() => setCollapsed(false)} />
  </aside>;

  return <aside className="layers-panel" aria-label="Layers">
    <div className="layers-resize" role="separator" aria-orientation="vertical" aria-label="Resize layers panel"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); resize.current = { x: e.clientX, w: width }; }}
      onPointerMove={(e) => { const r = resize.current; if (r) setWidth(Math.round(Math.min(MAX_W, Math.max(MIN_W, r.w + r.x - e.clientX)))); }}
      onPointerUp={() => { resize.current = null; }} onPointerCancel={() => { resize.current = null; }}
      onDoubleClick={() => setWidth(260)} />
    <div className="layers-body">
    <Section title="Layers" open={sections.layers} onToggle={() => setSections({ ...sections, layers: !sections.layers })}
      extra={<div className="panel-head-actions">{picked.length > 1 ? <span className="layers-picked num"><span className="layers-picked-n">{picked.length} selected</span><button type="button" onClick={() => pickLayer(doc.id, doc.activeLayerId ?? picked[picked.length - 1], false, picked)}>clear</button></span> : <span className="faint num">{doc.width} × {doc.height}</span>}<IconButton icon={PanelRightClose} label="Collapse layers panel" size="sm" onClick={() => setCollapsed(true)} /></div>}>
    <div className="layer-add">
      {/* One "+" for a new layer (its kind in the menu); the order and folder tools sit beside it. */}
      <IconButton ref={addPop.ref} icon={Plus} label="New layer" size="sm" aria-haspopup="menu" aria-expanded={addPop.open} onClick={addPop.toggle} />
      <Popover open={addPop.open} anchor={addPop.ref} onClose={addPop.close} placement="bottom-start" width={180} label="New layer">
        <div className="menu" role="menu">
          <MenuItem icon={Image} label="Raster" detail="Pixels: paint, images" onClick={() => { addEmptyLayer(sessionId, doc.id, 'raster'); addPop.close(); }} />
          <MenuItem icon={Shapes} label="Vector" detail="Shapes and lineart" onClick={() => { addEmptyLayer(sessionId, doc.id, 'vector'); addPop.close(); }} />
          <MenuItem icon={Type} label="Text" onClick={() => { addEmptyLayer(sessionId, doc.id, 'text'); addPop.close(); }} />
        </div>
      </Popover>
      <span className="layer-actions-gap" />
      {layer && <>
        {layer.groupId && picked.every((id) => doc.layers.find((l) => l.id === id)?.groupId === layer.groupId)
          ? <IconButton icon={FolderOutput} label="Ungroup this folder" size="sm" onClick={() => ungroup(sessionId, doc.id, layer.groupId!)} />
          : <IconButton icon={FolderInput} label={picked.length > 1 ? `Group ${picked.length} layers (Ctrl+G)` : 'Group layers · Ctrl or Shift-click two or more layers first'} size="sm" disabled={picked.length < 2} onClick={() => groupLayers(sessionId, doc.id, picked)} />}
        <IconButton icon={ArrowUp} label="Move layer up" size="sm" disabled={index === doc.layers.length - 1} onClick={() => (layer.locked ? lockedNote(layer.name) : moveLayer(sessionId, doc.id, layer.id, 1))} />
        <IconButton icon={ArrowDown} label="Move layer down" size="sm" disabled={index === 0} onClick={() => (layer.locked ? lockedNote(layer.name) : moveLayer(sessionId, doc.id, layer.id, -1))} />
      </>}
    </div>
    <div className="layer-list">
      {[...doc.layers].reverse().map((l, d, shown) => { const Icon = l.type === 'raster' ? Image : l.type === 'text' ? Type : Shapes;
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
        onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
        <button className="layer-select" aria-pressed={layer?.id === l.id} onClick={(e) => { if (drag?.active) return; pickLayer(doc.id, l.id, e.ctrlKey || e.metaKey || e.shiftKey, picked); setActiveLayer(sessionId, doc.id, l.id); pop.close(); }} title="Ctrl or Shift-click to select several">
          <span className="layer-thumb-wrap"><LayerThumb doc={doc} layer={l} /></span>
          <LayerName name={l.name} onRename={(name) => { if (!l.locked) patchLayer(sessionId, doc.id, l.id, { name }); }} />
        </button>
        <span className="layer-kind" data-tip={`${l.type} layer`} aria-label={`${l.type} layer`}><Icon size={13} /></span>
        <IconButton className={`layer-toggle ${l.visible ? '' : 'is-on'}`} icon={l.visible ? Eye : EyeOff} label={`${l.visible ? 'Hide' : 'Show'} ${l.name}`} size="sm" onClick={() => patchLayer(sessionId, doc.id, l.id, { visible: !l.visible })} />
        <IconButton className={`layer-toggle ${l.locked ? 'is-on' : ''}`} icon={l.locked ? Lock : Unlock} label={`${l.locked ? 'Unlock' : 'Lock'} ${l.name}`} size="sm" onClick={() => patchLayer(sessionId, doc.id, l.id, { locked: !l.locked })} />
      </div></Fragment>; })}
      {!doc.layers.length && <p className="empty-block">Add a layer, draw a shape, or drag an image here.</p>}
    </div>
    {layer && <div className="layer-actions">
        {layer.type === 'raster' && <Button ref={pop.ref} size="sm" variant="ghost" icon={Sparkles} className="layer-ops-btn" disabled={layer.locked} aria-label="Operations" data-tip="Operations · relight, upscale, remove background… the result is a new layer above" onClick={() => { setOp(null); pop.toggle(); }}><span className="layer-ops-label">Operations</span></Button>}
        <span className="layer-actions-gap" />
        <IconButton icon={Copy} label="Duplicate layer" size="sm" onClick={() => duplicateLayer(sessionId, doc.id, layer.id)} />
        <IconButton icon={Trash} label="Delete layer" size="sm" tone="danger" disabled={layer.locked} onClick={() => deleteLayer(sessionId, doc.id, layer.id)} />
      </div>}
    </Section>
    {layer && <>
      <Section title={<>Properties <span className="props-kind">— {layer.type === 'raster' ? 'Raster' : layer.type === 'text' ? 'Text' : 'Vector'}</span></>} open={sections.props} onToggle={() => setSections({ ...sections, props: !sections.props })} extra={layer.locked ? <span className="faint">Locked</span> : null}>
      <fieldset className="layer-properties form-stack" disabled={layer.locked} aria-label="Layer properties">
        <Field label="Name"><input key={layer.id + layer.name} defaultValue={layer.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== layer.name) patch({ name: e.target.value.trim() }); }} /></Field>
        <div className="prop-row">
          <Field label="Opacity"><div className="opacity-field"><input type="range" min={0} max={100} value={Math.round(layer.opacity * 100)} onChange={(e) => patch({ opacity: +e.target.value / 100 })} aria-label="Opacity" /><input type="number" min={0} max={100} value={Math.round(layer.opacity * 100)} onChange={(e) => patch({ opacity: Math.min(100, Math.max(0, +e.target.value)) / 100 })} aria-label="Opacity percent" /></div></Field>
          <Field label="Blend"><select value={layer.blend} onChange={(e) => patch({ blend: e.target.value as Layer['blend'] })}>{BLENDS.map((b) => <option key={b} value={b}>{b.replace('-', ' ')}</option>)}</select></Field>
        </div>
        {layer.type !== 'vector' && <div className="xywh">{(['x', 'y', 'width', ...(layer.type === 'raster' ? ['height'] as const : [])] as const).map((key) => <label key={key} className="xywh-cell"><span>{key === 'width' ? 'W' : key === 'height' ? 'H' : key.toUpperCase()}</span><input type="number" value={Math.round((layer as unknown as Record<string, number>)[key])} min={key === 'width' || key === 'height' ? 1 : undefined} onChange={(e) => patch({ [key]: key === 'width' ? Math.max(layer.type === 'text' ? 0 : 1, +e.target.value) : key === 'height' ? Math.max(1, +e.target.value) : +e.target.value })} /></label>)}</div>}
        {layer.type === 'text' && <p className="faint">W 0 = automatic, the box follows the text.</p>}
        {layer.type === 'raster' && layer.sourceAssetId && <label className="check-row"><input type="checkbox" checked={!!layer.allowPaint} onChange={(e) => patch({ allowPaint: e.target.checked })} />Allow painting on this image</label>}
        {layer.type === 'text' && <>
          <Field label="Text"><textarea rows={3} value={layer.text} onChange={(e) => patch({ text: e.target.value })} /></Field>
          <Field label="Font"><select value={layer.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })}>{FONT_NAMES.map((f) => <option key={f}>{f}</option>)}</select></Field>
          <div className="property-grid"><Field label="Size"><input type="number" min={4} max={1000} value={layer.fontSize} onChange={(e) => patch({ fontSize: Math.min(1000, Math.max(4, +e.target.value)) })} /></Field><Field label="Weight"><select value={layer.fontWeight} onChange={(e) => patch({ fontWeight: +e.target.value })}>{[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w}>{w}</option>)}</select></Field></div>
          <Field label="Text color"><input type="color" value={layer.color} onChange={(e) => patch({ color: e.target.value })} /></Field>
          <Field label="Alignment"><select value={layer.align} onChange={(e) => patch({ align: e.target.value as 'left' | 'center' | 'right' })}>{['left', 'center', 'right'].map((a) => <option key={a}>{a}</option>)}</select></Field>
        </>}
        {layer.type === 'vector' && layer.strokes?.length ? <>
          <p className="muted">{layer.strokes.length} strokes · changes restyle every stroke in this layer. Alt-drag a stroke with Lineart to bend it.</p>
          <StrokeStyleFields value={layer.strokes[layer.strokes.length - 1]} onChange={(p) => patch({ strokes: restyleStrokes(layer.strokes ?? [], p) })} />
        </> : null}
        {layer.type === 'vector' && (layer.shapes.length > 0 || !layer.strokes?.length) && <><p className="muted">{layer.shapes.length} shapes · draw on the canvas to add more.</p>{layer.shapes.map((s, i) => <div className="shape-properties" key={s.id}><strong>{s.type} {i + 1}</strong><Field label="Fill"><input type="color" value={s.fill ?? '#d4f25a'} onChange={(e) => patch({ shapes: layer.shapes.map((x) => x.id === s.id ? { ...x, fill: e.target.value } : x) })} /></Field><Field label="Stroke"><input type="color" value={s.stroke ?? '#ffffff'} onChange={(e) => patch({ shapes: layer.shapes.map((x) => x.id === s.id ? { ...x, stroke: e.target.value } : x) })} /></Field><Field label="Stroke width"><input type="number" min={0} value={s.strokeWidth} onChange={(e) => patch({ shapes: layer.shapes.map((x) => x.id === s.id ? { ...x, strokeWidth: Math.max(0, +e.target.value) } : x) })} /></Field></div>)}</>}
      </fieldset>
      </Section>
      <Popover open={pop.open && layer.type === 'raster' && !layer.locked} anchor={pop.ref} onClose={pop.close} label="Layer operations" width={320}>
        {op ? <OpForm key={`${layer.id}:${op}`} op={op} target={{ kind: 'layer', sessionId, docId: doc.id, layerId: layer.id }} onClose={pop.close} onBack={() => setOp(null)} /> : Object.values(OPS).filter((o) => o.input === 'image' && o.output === 'image').map((o) => <MenuItem key={o.id} label={o.label} detail={o.description} onClick={() => setOp(o.id)} />)}
      </Popover>
    </>}
    </div>
  </aside>;
}
