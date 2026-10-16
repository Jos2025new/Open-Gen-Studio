import { useRef, useState } from 'react';
import { ImagePlus, Zap } from 'lucide-react';
import { toast, setUi, useStore } from '../../store/store';
import { uploadFiles } from '../../engine/actions';
import { OPS } from '../../engine/ops';
import type { AssetKind, OpId } from '../../engine/types';
import { OpFields, ViaPick, useOpRun } from '../assets/opRun';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, usePopover } from '../ui/Popover';
import { costLabel } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { overLimit } from '../../engine/budget';
import { ALL_TOOLS, isListed } from '../shell/navModel';
import { SpaceHead } from './SpaceFrame';

const KINDS: Array<{ id: AssetKind; label: string }> = [{ id: 'image', label: 'Image' }, { id: 'video', label: 'Video' }, { id: 'audio', label: 'Audio' }];
const NOUN: Record<string, string> = { image: 'an image', video: 'a video', audio: 'an audio clip', model3d: 'a 3D model' };

/** The selected operation; the first tool when none was chosen yet. */
export function useToolOp(): OpId {
  return useStore((s) => s.ui.toolOp) ?? ALL_TOOLS[0].id;
}
const choose = (op: OpId) => setUi({ toolOp: op });

/** The Space Panel of Tools: kind tabs, the chosen tool, its input asset, its fields, Generate pinned below. */
export function ToolsPanel() {
  const op = useToolOp();
  const def = OPS[op];
  const change = usePopover();
  const Icon = ALL_TOOLS.find((t) => t.id === op)?.icon;
  const sameKind = ALL_TOOLS.filter((t) => t.kind === def.input);
  return <aside className="space-panel" aria-label="Tool settings">
    <SpaceHead title="Tools" />
    <div className="space-tabs" role="tablist" aria-label="Media type">
      {KINDS.map((k) => <button key={k.id} type="button" role="tab" aria-selected={k.id === def.input} className={`space-tab ${k.id === def.input ? 'is-active' : ''}`}
        onClick={() => { const first = ALL_TOOLS.find((t) => t.kind === k.id); if (first && k.id !== def.input) choose(first.id); }}>{k.label}</button>)}
    </div>
    <ToolBody key={op} op={op} header={<div className="space-card space-tool">
      <div className="space-tool-row">
        <span className="space-tool-icon">{Icon ? <Icon size={18} strokeWidth={1.7} /> : null}</span>
        <div className="space-tool-text"><span className="space-card-label">Tool</span><span className="space-tool-name">{def.label}</span></div>
        <button ref={change.ref} type="button" className="space-add" aria-haspopup="menu" aria-expanded={change.open} onClick={change.toggle}>Change</button>
      </div>
      <p className="space-hint">{def.description}</p>
      <Popover open={change.open} anchor={change.ref} onClose={change.close} width={320} label="Tools">
        <div className="space-tool-grid" role="menu">
          {sameKind.map((t) => <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === op} className={`space-tool-pick ${t.id === op ? 'is-active' : ''}`} onClick={() => { choose(t.id); change.close(); }}>
            <t.icon size={18} strokeWidth={1.6} /><span>{t.label}</span>
          </button>)}
        </div>
      </Popover>
    </div>} />
  </aside>;
}

function ToolBody({ op, header }: { op: OpId; header: React.ReactNode }) {
  const def = OPS[op];
  const [assetId, setAssetId] = useState<string | undefined>();
  const exists = useStore((s) => (assetId ? Boolean(s.assets[assetId]) : false));
  const target = assetId && exists ? assetId : undefined;
  const state = useOpRun(op, target ? { kind: 'asset', assetId: target } : null);
  const pop = usePopover();
  const unknown = state.estimate.usd == null;
  const generate = () => {
    if (!target) { toast(`Add ${NOUN[def.input]} first.`, 'error'); return; }
    if (state.blocked) { toast(state.blocked, 'error'); return; }
    if (unknown || overLimit(state.estimate)) pop.toggle();
    else state.run();
  };
  return <>
    <div className="space-panel-body">
      {header}
      <InputSlot kind={def.input} verb={def.label.toLowerCase()} value={target} onChange={setAssetId} />
      <div className="space-opfields"><OpFields op={op} state={state} className="space-card" /></div>
      {target && state.via ? <div className="space-card"><span className="space-card-label">Model</span><span className="space-card-value"><ViaPick op={op} state={state} /></span></div> : null}
    </div>
    <footer className="space-panel-foot">
      <button ref={pop.ref} type="button" className={`send-btn is-generate ${target && !state.blocked ? '' : 'is-blocked'}`} aria-disabled={!target || Boolean(state.blocked)} onClick={generate}>
        <Zap size={14} strokeWidth={2} /><span>Generate</span>{target ? <span className="send-cost num">{costLabel(state.estimate, { short: true })}</span> : null}
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={300} label="Confirm cost">
        <SpendConfirm title={<ViaPick op={op} state={state} />} estimate={state.estimate} confirmLabel="Generate" onConfirm={() => { pop.close(); state.run(); }} onCancel={pop.close} blocked={state.blocked} />
      </Popover>
    </footer>
  </>;
}

/** The input asset: pick from what exists (newest first), drop one, or upload. */
export function InputSlot({ kind, verb, value, onChange }: { kind: AssetKind; verb: string; value: string | undefined; onChange: (id: string | undefined) => void }) {
  const assets = useStore((s) => s.assets);
  const pop = usePopover();
  const file = useRef<HTMLInputElement>(null);
  const recent = Object.values(assets).filter((a) => a.kind === kind && isListed(a)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  const upload = async (files: FileList | File[] | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith(`${kind}/`));
    if (!list.length) { toast(`This tool needs ${NOUN[kind]}.`, 'error'); return; }
    const ids = await uploadFiles(list);
    const id = ids.find((i) => useStore.getState().assets[i]?.kind === kind);
    if (id) onChange(id);
  };
  const accept = kind === 'image' ? 'image/png,image/jpeg,image/webp' : kind === 'video' ? 'video/mp4,video/webm' : 'audio/*';
  return <div className="space-card space-slot" aria-label="Input"
    onDragOver={(e) => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-ogs-asset')) e.preventDefault(); }}
    onDrop={(e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('application/x-ogs-asset');
      if (id) { if (assets[id]?.kind === kind) onChange(id); else toast(`This tool needs ${NOUN[kind]}.`, 'error'); }
      else void upload(e.dataTransfer.files);
    }}>
    <span className="space-card-label">Input · {kind}</span>
    {value ? <div className="space-slot-row"><span className="space-slot-thumb"><AssetMedia assetId={value} hoverPlay={false} autoPlay={false} draggable={false} /></span>
      <button ref={pop.ref} type="button" className="space-add" onClick={pop.toggle}>Change</button></div>
      : <button ref={pop.ref} type="button" className="space-add space-slot-empty" onClick={pop.toggle}><ImagePlus size={14} />Add {NOUN[kind]} to {verb}</button>}
    <input ref={file} type="file" hidden accept={accept} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={340} label="Pick input">
      <div className="space-pick">
        {recent.length ? <div className="space-pick-grid">{recent.map((a) => <button key={a.id} type="button" className="space-pick-tile" aria-label={a.name || `Use ${kind}`} onClick={() => { onChange(a.id); pop.close(); }}><AssetMedia assetId={a.id} hoverPlay={false} autoPlay={false} draggable={false} /></button>)}</div> : <p className="space-empty">No {kind} yet.</p>}
        <button type="button" className="space-add" onClick={() => { pop.close(); file.current?.click(); }}>Upload from this computer</button>
      </div>
    </Popover>
  </div>;
}
