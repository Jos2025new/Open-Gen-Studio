import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Image, Lock, Shapes, Sparkles, Trash, Type, Unlock } from 'lucide-react';
import type { DesignDoc, Layer, OpId } from '../../engine/types';
import { activeLayer, FONT_NAMES } from '../../engine/design/doc';
import { addEmptyLayer, deleteLayer, duplicateLayer, moveLayer, patchLayer, setActiveLayer } from '../../engine/design/actions';
import { OPS } from '../../engine/ops';
import { Button, Field, IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { OpForm } from '../assets/OpForm';

export function LayersPanel({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const layer = activeLayer(doc);
  const pop = usePopover();
  const [op, setOp] = useState<OpId | null>(null);
  const patch = (value: Partial<Layer>) => { if (layer && !layer.locked) patchLayer(sessionId, doc.id, layer.id, value); };
  const index = doc.layers.findIndex((l) => l.id === layer?.id);
  return <aside className="layers-panel" aria-label="Layers">
    <div className="panel-head"><strong>Layers</strong><span className="faint num">{doc.width} × {doc.height}</span></div>
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
    {layer && <>
      <div className="layer-actions">
        <IconButton icon={ArrowUp} label="Move layer up" size="sm" disabled={layer.locked || index === doc.layers.length - 1} onClick={() => moveLayer(sessionId, doc.id, layer.id, 1)} />
        <IconButton icon={ArrowDown} label="Move layer down" size="sm" disabled={layer.locked || index === 0} onClick={() => moveLayer(sessionId, doc.id, layer.id, -1)} />
        <IconButton icon={Copy} label="Duplicate layer" size="sm" onClick={() => duplicateLayer(sessionId, doc.id, layer.id)} />
        <IconButton icon={Trash} label="Delete layer" size="sm" tone="danger" disabled={layer.locked} onClick={() => deleteLayer(sessionId, doc.id, layer.id)} />
        {layer.type === 'raster' && <IconButton ref={pop.ref} icon={Sparkles} label="Layer operations" size="sm" disabled={layer.locked} onClick={() => { setOp(null); pop.toggle(); }} />}
      </div>
      <fieldset className="layer-properties form-stack" disabled={layer.locked}>
        <legend>{layer.locked ? 'Locked layer' : 'Properties'}</legend>
        <Field label="Name"><input key={layer.id + layer.name} defaultValue={layer.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== layer.name) patch({ name: e.target.value.trim() }); }} /></Field>
        <Field label={`Opacity · ${Math.round(layer.opacity * 100)}%`}><input type="number" min={0} max={100} value={Math.round(layer.opacity * 100)} onChange={(e) => patch({ opacity: Math.min(100, Math.max(0, +e.target.value)) / 100 })} /></Field>
        <Field label="Blend"><select value={layer.blend} onChange={(e) => patch({ blend: e.target.value as Layer['blend'] })}>{['normal', 'multiply', 'screen', 'overlay'].map((b) => <option key={b}>{b}</option>)}</select></Field>
        {layer.type !== 'vector' && <div className="property-grid">{(['x', 'y', 'width'] as const).map((key) => <Field label={key} key={key}><input type="number" value={Math.round(layer[key])} min={key === 'width' ? 1 : undefined} onChange={(e) => patch({ [key]: key === 'width' ? Math.max(1, +e.target.value) : +e.target.value })} /></Field>)}</div>}
        {layer.type === 'raster' && <Field label="Height"><input type="number" min={1} value={Math.round(layer.height)} onChange={(e) => patch({ height: Math.max(1, +e.target.value) })} /></Field>}
        {layer.type === 'text' && <>
          <Field label="Text"><textarea rows={3} value={layer.text} onChange={(e) => patch({ text: e.target.value })} /></Field>
          <Field label="Font"><select value={layer.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })}>{FONT_NAMES.map((f) => <option key={f}>{f}</option>)}</select></Field>
          <div className="property-grid"><Field label="Size"><input type="number" min={4} max={1000} value={layer.fontSize} onChange={(e) => patch({ fontSize: Math.min(1000, Math.max(4, +e.target.value)) })} /></Field><Field label="Weight"><select value={layer.fontWeight} onChange={(e) => patch({ fontWeight: +e.target.value })}>{[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w}>{w}</option>)}</select></Field></div>
          <Field label="Text color"><input type="color" value={layer.color} onChange={(e) => patch({ color: e.target.value })} /></Field>
          <Field label="Alignment"><select value={layer.align} onChange={(e) => patch({ align: e.target.value as 'left' | 'center' | 'right' })}>{['left', 'center', 'right'].map((a) => <option key={a}>{a}</option>)}</select></Field>
        </>}
        {layer.type === 'vector' && <><p className="muted">{layer.shapes.length} shapes · draw on the canvas to add more.</p>{layer.shapes.map((s, i) => <div className="shape-properties" key={s.id}><strong>{s.type} {i + 1}</strong><Field label="Fill"><input type="color" value={s.fill ?? '#d4f25a'} onChange={(e) => patch({ shapes: layer.shapes.map((x) => x.id === s.id ? { ...x, fill: e.target.value } : x) })} /></Field><Field label="Stroke"><input type="color" value={s.stroke ?? '#ffffff'} onChange={(e) => patch({ shapes: layer.shapes.map((x) => x.id === s.id ? { ...x, stroke: e.target.value } : x) })} /></Field><Field label="Stroke width"><input type="number" min={0} value={s.strokeWidth} onChange={(e) => patch({ shapes: layer.shapes.map((x) => x.id === s.id ? { ...x, strokeWidth: Math.max(0, +e.target.value) } : x) })} /></Field></div>)}</>}
      </fieldset>
      <Popover open={pop.open && layer.type === 'raster' && !layer.locked} anchor={pop.ref} onClose={pop.close} label="Layer operations" width={320}>
        {op ? <OpForm key={`${layer.id}:${op}`} op={op} target={{ kind: 'layer', sessionId, docId: doc.id, layerId: layer.id }} onClose={pop.close} onBack={() => setOp(null)} /> : Object.values(OPS).filter((o) => o.input === 'image' && o.output === 'image').map((o) => <MenuItem key={o.id} label={o.label} detail={o.description} onClick={() => setOp(o.id)} />)}
      </Popover>
    </>}
  </aside>;
}
