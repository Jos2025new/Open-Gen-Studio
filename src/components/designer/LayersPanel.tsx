import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Eye, EyeOff, Image, Lock, PanelRightClose, PanelRightOpen, Shapes, Sparkles, Trash, Type, Unlock } from 'lucide-react';
import type { DesignDoc, Layer, OpId } from '../../engine/types';
import { activeLayer, FONT_NAMES } from '../../engine/design/doc';
import { restyleStrokes } from '../../engine/design/strokes';
import { StrokeStyleFields } from './StrokeStyleFields';
import { addEmptyLayer, deleteLayer, duplicateLayer, moveLayer, patchLayer, setActiveLayer } from '../../engine/design/actions';
import { OPS } from '../../engine/ops';
import { Button, Field, IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { OpForm } from '../assets/OpForm';
import { usePref } from '../ui/hooks';

const MIN_W = 200;
const MAX_W = 520;

function Section({ title, open, onToggle, extra, children }: { title: string; open: boolean; onToggle: () => void; extra?: ReactNode; children: ReactNode }) {
  return <section className="panel-section">
    <div className="panel-head"><button type="button" className="section-toggle" aria-expanded={open} onClick={onToggle}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<strong>{title}</strong></button>{extra}</div>
    {open && children}
  </section>;
}

export function LayersPanel({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const layer = activeLayer(doc);
  const pop = usePopover();
  const [op, setOp] = useState<OpId | null>(null);
  const [width, setWidth] = usePref('ogs:layers-width', 260);
  const [collapsed, setCollapsed] = usePref('ogs:layers-collapsed', false);
  const [sections, setSections] = usePref('ogs:layers-sections', { layers: true, props: true });
  const resize = useRef<{ x: number; w: number } | null>(null);
  const patch = (value: Partial<Layer>) => { if (layer && !layer.locked) patchLayer(sessionId, doc.id, layer.id, value); };
  const index = doc.layers.findIndex((l) => l.id === layer?.id);

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
      extra={<div className="panel-head-actions"><span className="faint num">{doc.width} × {doc.height}</span><IconButton icon={PanelRightClose} label="Collapse layers panel" size="sm" onClick={() => setCollapsed(true)} /></div>}>
    <div className="layer-add">
      <Button size="sm" icon={Image} onClick={() => addEmptyLayer(sessionId, doc.id, 'raster')}>Raster</Button>
      <Button size="sm" icon={Shapes} onClick={() => addEmptyLayer(sessionId, doc.id, 'vector')}>Vector</Button>
      <Button size="sm" icon={Type} onClick={() => addEmptyLayer(sessionId, doc.id, 'text')}>Text</Button>
    </div>
    <div className="layer-list">
      {[...doc.layers].reverse().map((l) => { const Icon = l.type === 'raster' ? Image : l.type === 'text' ? Type : Shapes; return <div key={l.id} className={`layer-row ${layer?.id === l.id ? 'is-active' : ''}`}>
        <button className="layer-select" aria-pressed={layer?.id === l.id} onClick={() => { setActiveLayer(sessionId, doc.id, l.id); pop.close(); }}><Icon size={14} /><span>{l.name}</span><small>{l.type}</small></button>
        <IconButton icon={l.visible ? Eye : EyeOff} label={`${l.visible ? 'Hide' : 'Show'} ${l.name}`} size="sm" onClick={() => patchLayer(sessionId, doc.id, l.id, { visible: !l.visible })} />
        <IconButton icon={l.locked ? Lock : Unlock} label={`${l.locked ? 'Unlock' : 'Lock'} ${l.name}`} size="sm" onClick={() => patchLayer(sessionId, doc.id, l.id, { locked: !l.locked })} />
      </div>; })}
      {!doc.layers.length && <p className="empty-block">Add a layer, draw a shape, or drag an image here.</p>}
    </div>
    {layer && <div className="layer-actions">
        <IconButton icon={ArrowUp} label="Move layer up" size="sm" disabled={layer.locked || index === doc.layers.length - 1} onClick={() => moveLayer(sessionId, doc.id, layer.id, 1)} />
        <IconButton icon={ArrowDown} label="Move layer down" size="sm" disabled={layer.locked || index === 0} onClick={() => moveLayer(sessionId, doc.id, layer.id, -1)} />
        <IconButton icon={Copy} label="Duplicate layer" size="sm" onClick={() => duplicateLayer(sessionId, doc.id, layer.id)} />
        <IconButton icon={Trash} label="Delete layer" size="sm" tone="danger" disabled={layer.locked} onClick={() => deleteLayer(sessionId, doc.id, layer.id)} />
        {layer.type === 'raster' && <IconButton ref={pop.ref} icon={Sparkles} label="Layer operations" size="sm" disabled={layer.locked} onClick={() => { setOp(null); pop.toggle(); }} />}
      </div>}
    </Section>
    {layer && <>
      <Section title="Properties" open={sections.props} onToggle={() => setSections({ ...sections, props: !sections.props })} extra={layer.locked ? <span className="faint">Locked</span> : null}>
      <fieldset className="layer-properties form-stack" disabled={layer.locked} aria-label="Layer properties">
        <Field label="Name"><input key={layer.id + layer.name} defaultValue={layer.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== layer.name) patch({ name: e.target.value.trim() }); }} /></Field>
        <Field label={`Opacity · ${Math.round(layer.opacity * 100)}%`}><input type="number" min={0} max={100} value={Math.round(layer.opacity * 100)} onChange={(e) => patch({ opacity: Math.min(100, Math.max(0, +e.target.value)) / 100 })} /></Field>
        <Field label="Blend"><select value={layer.blend} onChange={(e) => patch({ blend: e.target.value as Layer['blend'] })}>{['normal', 'multiply', 'screen', 'overlay'].map((b) => <option key={b}>{b}</option>)}</select></Field>
        {layer.type !== 'vector' && <div className="property-grid">{(['x', 'y', 'width'] as const).map((key) => <Field label={key} key={key}><input type="number" value={Math.round(layer[key])} min={key === 'width' ? 1 : undefined} onChange={(e) => patch({ [key]: key === 'width' ? Math.max(layer.type === 'text' ? 0 : 1, +e.target.value) : +e.target.value })} /></Field>)}</div>}
        {layer.type === 'text' && <p className="faint">Width 0 = automatic, the box follows the text.</p>}
        {layer.type === 'raster' && <Field label="Height"><input type="number" min={1} value={Math.round(layer.height)} onChange={(e) => patch({ height: Math.max(1, +e.target.value) })} /></Field>}
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
