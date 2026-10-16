import { useState, type ReactNode } from 'react';
import { ChevronDown, Copy, CopyPlus, Info, LoaderCircle, Play, RefreshCw, CircleStop } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { copyText, editInComposer, regenerate, regenerateEstimate } from '../../engine/actions';
import { cancelGeneration } from '../../engine/jobs';
import { OPS } from '../../engine/ops';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { IconButton } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { DownloadButton, FavoriteButton } from '../assets/AssetActions';
import { GenerationInfo } from '../assets/GenerationInfo';

/**
 * A generation in Studio's chat: a "Created N files" line that folds, the results as small inline thumbnails (click
 * opens the viewer) and a row of small icon actions. Running ones show a small placeholder; the board's Ongoing row
 * follows them too. Failures, text, sound and 3D keep the full card (its retry and recovery actions).
 */
export function StudioGeneration({ generationId, fallback }: { generationId: string; fallback: ReactNode }) {
  const g = useStore((s) => s.generations[generationId]);
  const [open, setOpen] = useState(true);
  const regen = usePopover();
  const info = usePopover();
  if (!g || (g.kind !== 'image' && g.kind !== 'video') || !['done', 'running', 'queued'].includes(g.status)) return <>{fallback}</>;
  const busy = g.status !== 'done';
  const outputs = g.assetIds;
  const slots = busy ? Math.max(0, (g.op ? 1 : g.settings.count) - outputs.length) : 0;
  const first = outputs[0];
  return <div className="studio-gen" aria-label={busy ? 'Generating' : 'Generated'}>
    <button type="button" className="studio-gen-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      {busy ? <><LoaderCircle size={13} className="spin" />{g.status === 'queued' ? 'Queued' : g.statusText ?? 'Creating'}…</> : <>Created {outputs.length} file{outputs.length === 1 ? '' : 's'}</>}
      <ChevronDown size={13} className={open ? '' : 'is-closed'} />
    </button>
    {open ? <div className="studio-gen-row">
      {outputs.map((id, i) => <button key={id} type="button" className="studio-thumb" aria-label={g.kind === 'video' ? 'Open video' : 'Open image'} onClick={() => setUi({ lightbox: { assetIds: outputs, index: i } })}>
        <AssetMedia assetId={id} hoverPlay={false} autoPlay={false} draggable={false} />
        {g.kind === 'video' ? <span className="studio-thumb-play" aria-hidden><Play size={16} fill="currentColor" /></span> : null}
      </button>)}
      {Array.from({ length: slots }, (_, i) => <div key={`p${i}`} className="studio-thumb is-pending"><div className="shimmer" /></div>)}
    </div> : null}
    <div className="studio-gen-actions">
      {g.prompt ? <IconButton icon={Copy} label="Copy prompt" size="sm" onClick={() => void copyText(g.prompt)} /> : null}
      {!g.op && !busy ? <IconButton icon={CopyPlus} label="Reuse: prompt, inputs, model and settings in the composer" size="sm" onClick={() => void editInComposer(g.id)} /> : null}
      {!busy ? <IconButton ref={regen.ref} icon={RefreshCw} label="Regenerate" size="sm" active={regen.open} onClick={regen.toggle} /> : null}
      {first && !busy ? <><FavoriteButton assetId={first} /><DownloadButton assetId={first} /></> : null}
      <IconButton ref={info.ref} icon={Info} label="Details" size="sm" active={info.open} onClick={info.toggle} />
      {busy && !g.remoteJob ? <IconButton icon={CircleStop} label="Stop" size="sm" tone="danger" onClick={() => cancelGeneration(g.id)} /> : null}
    </div>
    <Popover open={regen.open} anchor={regen.ref} onClose={regen.close} width={300} label="Regenerate">
      <SpendConfirm title={g.op ? `Run ${OPS[g.op.id].label} again` : 'Regenerate with a new seed'} estimate={regen.open ? regenerateEstimate(g.id) ?? g.estimate : g.estimate} confirmLabel="Regenerate" onConfirm={() => { regen.close(); void regenerate(g.id); }} onCancel={regen.close} />
    </Popover>
    <Popover open={info.open} anchor={info.ref} onClose={info.close} width={340} label="Details" className="pop-scroll">
      <PopoverHeader title="Details" sub={g.kind === 'video' ? 'Video' : 'Image'} />
      <GenerationInfo generation={g} asset={first ? useStore.getState().assets[first] : undefined} />
    </Popover>
  </div>;
}
