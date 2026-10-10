import { useState, type RefObject } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Contrast, Layers as LayersIcon, Sparkles, Trash } from 'lucide-react';
import type { DesignDoc, Layer } from '../../engine/types';
import type { FxGroup, FxLayer, FxOp } from '../../engine/fx/types';
import { FX_DEFS, fxKindsOf, type FxParam } from '../../engine/fx/defs';
import { fxTarget } from '../../engine/fx/plan';
import type { FxCommand } from '../../engine/fx/commands';
import { runFx } from '../../engine/design/fx';
import { Field, IconButton, MenuItem, Segmented, Toggle } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { InlineColor, InlineSlider } from './InlineControls';
import { toast } from '../../store/store';

/* FX in the layers panel (ADR 0011): the FX menu next to Operations and the editor of an FX layer. */

export const fxIcon = (group: FxGroup) => (group === 'filter' ? Contrast : Sparkles);

function run(sessionId: string, docId: string, commands: FxCommand[]) {
  const r = runFx(sessionId, docId, commands);
  if (r?.error) toast(r.error, 'error');
}

/** Where a new FX goes: on the active layer alone, stacked with the active FX, or over everything. */
function placement(layer: Layer | null): Pick<Extract<FxCommand, { do: 'add' }>, 'scope' | 'above'> {
  if (!layer) return { scope: 'below' };
  return { scope: layer.type === 'fx' ? layer.scope : 'layer', above: layer.id };
}

/** FX button: a new filter or effect layer, or one filter or effect on its own (an FX layer underneath). */
export function FxMenu({ sessionId, doc, layer }: { sessionId: string; doc: DesignDoc; layer: Layer | null }) {
  const pop = usePopover();
  const add = (cmd: Extract<FxCommand, { do: 'add' }>) => { run(sessionId, doc.id, [cmd]); pop.close(); };
  const where = layer && layer.type !== 'fx' ? `on "${layer.name}"` : layer?.type === 'fx' && layer.scope === 'layer' ? 'with this FX' : 'on everything below';
  return <>
    <IconButton ref={pop.ref} size="sm" icon={Sparkles} label="Filters and effects" className="layer-fx-btn" aria-haspopup="menu" aria-expanded={pop.open} disabled={layer?.locked} data-tip="Filters and effects · non-destructive, editable later (double-click the FX layer)" onClick={pop.toggle} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} label="Filters and effects" width={260}>
      <div className="menu fx-menu" role="menu">
        <MenuItem icon={Contrast} label="New filter layer" detail="Several filters, over everything below" onClick={() => add({ do: 'add', group: 'filter', scope: 'below', above: layer?.id })} />
        <MenuItem icon={Sparkles} label="New effect layer" detail="Several effects, over everything below" onClick={() => add({ do: 'add', group: 'effect', scope: 'below', above: layer?.id })} />
        {(['filter', 'effect'] as const).map((group) => <div key={group}>
          <div className="menu-sep" />
          <div className="menu-sep-label">{group === 'filter' ? 'Filter' : 'Effect'} {where}</div>
          {fxKindsOf(group).map((kind) => <MenuItem key={kind} label={FX_DEFS[kind].label} tip={FX_DEFS[kind].description} onClick={() => add({ do: 'add', group, ...placement(layer), ops: [{ kind }], simple: true })} />)}
        </div>)}
      </div>
    </Popover>
  </>;
}

function ParamField({ p, value, disabled, onChange }: { p: FxParam; value: unknown; disabled?: boolean; onChange: (v: number | string) => void }) {
  // The app's own fields, as every tool uses them (InlineControls.tsx).
  if (p.type === 'color') return <InlineColor label={p.label} value={String(value)} showValue onChange={onChange} />;
  return <InlineSlider label={p.label} unit={p.unit ?? ''} min={p.min} max={p.max} step={p.step} value={Number(value)} disabled={disabled} onChange={onChange} />;
}

function OpRow({ sessionId, doc, layer, op, index, open, onOpen }: { sessionId: string; doc: DesignDoc; layer: FxLayer; op: FxOp; index: number; open: boolean; onOpen: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const d = FX_DEFS[op.kind], cmd = (c: FxCommand) => run(sessionId, doc.id, [c]);
  return <div className={`fx-op ${op.enabled ? '' : 'is-off'}`}>
    <div className="fx-op-head">
      <Toggle checked={op.enabled} label={`${op.enabled ? 'Turn off' : 'Turn on'} ${d.label}`} onChange={(enabled) => cmd({ do: 'set_op', layer: layer.id, op: op.id, enabled })} />
      <button type="button" className="fx-op-name" aria-expanded={open} onClick={onOpen}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{d.label}</button>
      {confirm
        ? <span className="fx-op-confirm">Remove?<button type="button" className="is-danger" onClick={() => cmd({ do: 'remove_op', layer: layer.id, op: op.id })}>Remove</button><button type="button" onClick={() => setConfirm(false)}>Cancel</button></span>
        : <>
          <IconButton icon={ArrowUp} size="sm" label={`Move ${d.label} up (applied later)`} disabled={index === layer.ops.length - 1} onClick={() => cmd({ do: 'move_op', layer: layer.id, op: op.id, to: index + 1 })} />
          <IconButton icon={ArrowDown} size="sm" label={`Move ${d.label} down (applied earlier)`} disabled={index === 0} onClick={() => cmd({ do: 'move_op', layer: layer.id, op: op.id, to: index - 1 })} />
          <IconButton icon={Trash} size="sm" tone="danger" label={`Remove ${d.label}`} onClick={() => setConfirm(true)} />
        </>}
    </div>
    {open && <div className="fx-op-params">{d.params.map((p) => <ParamField key={p.key} p={p} value={op.params[p.key]} onChange={(v) => cmd({ do: 'set_op', layer: layer.id, op: op.id, params: { [p.key]: v } })} />)}</div>}
  </div>;
}

/** The FX layer's settings: what it acts on, and its filters or effects (a single one, or the editable stack). */
export function FxEditor({ sessionId, doc, layer }: { sessionId: string; doc: DesignDoc; layer: FxLayer }) {
  // Each filter opens and closes on its own: opening one leaves the others as they are.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(layer.ops.length ? [layer.ops[layer.ops.length - 1].id] : []));
  const set = (c: Omit<Extract<FxCommand, { do: 'set' }>, 'do' | 'layer'>) => run(sessionId, doc.id, [{ do: 'set', layer: layer.id, ...c }]);
  const target = layer.scope === 'layer' ? fxTarget(doc.layers, layer.id) : null;
  const single = layer.simple && layer.ops.length === 1 ? layer.ops[0] : null;
  return <fieldset className="fx-editor form-stack" disabled={layer.locked} aria-label={`${layer.name} settings`}>
    <Field label="Applies to" hint={layer.scope === 'layer' ? (target ? `Only "${target.name}".` : 'No layer under it: move it above one.') : 'Everything under this layer, background included.'}>
      <Segmented size="sm" value={layer.scope} onChange={(scope) => set({ scope })} options={[{ value: 'layer', label: 'Layer below', tip: 'Only the nearest layer under it' }, { value: 'below', label: 'Everything below', tip: 'All layers under it' }]} />
    </Field>
    {single ? <>
      <div className="fx-op-params">{FX_DEFS[single.kind].params.map((p) => <ParamField key={p.key} p={p} value={single.params[p.key]} onChange={(v) => run(sessionId, doc.id, [{ do: 'set_op', layer: layer.id, op: single.id, params: { [p.key]: v } }])} />)}</div>
      <button type="button" className="btn btn-sm fx-expose" onClick={() => set({ simple: false })}><LayersIcon size={13} />Edit as {layer.group} layer</button>
    </> : <>
      <div className="fx-ops" aria-label={layer.group === 'filter' ? 'Filters, last applied on top' : 'Effects, last applied on top'}>
        {[...layer.ops].map((op, i) => ({ op, i })).reverse().map(({ op, i }) => <OpRow key={op.id} sessionId={sessionId} doc={doc} layer={layer} op={op} index={i} open={open.has(op.id)} onOpen={() => setOpen((o) => { const n = new Set(o); if (!n.delete(op.id)) n.add(op.id); return n; })} />)}
        {!layer.ops.length && <p className="field-hint">No {layer.group === 'filter' ? 'filters' : 'effects'} yet: add one below.</p>}
      </div>
      <Field label={`Add ${layer.group}`}>
        <select value="" onChange={(e) => { if (e.target.value) run(sessionId, doc.id, [{ do: 'add_op', layer: layer.id, kind: e.target.value }]); }} aria-label={`Add ${layer.group}`}>
          <option value="">Choose…</option>
          {fxKindsOf(layer.group).map((k) => <option key={k} value={k}>{FX_DEFS[k].label}</option>)}
        </select>
      </Field>
    </>}
  </fieldset>;
}

/** Double-click on an FX layer's row: its editor next to the row. */
export function FxEditorPopover({ sessionId, doc, layer, anchor, onClose }: { sessionId: string; doc: DesignDoc; layer: FxLayer; anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  return <Popover open anchor={anchor} onClose={onClose} label={`${layer.name} settings`} width={300} placement="bottom-start">
    <div className="fx-pop-head">{(() => { const Icon = fxIcon(layer.group); return <Icon size={14} />; })()}<strong>{layer.name}</strong></div>
    <FxEditor sessionId={sessionId} doc={doc} layer={layer} />
  </Popover>;
}
