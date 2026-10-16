import { useState, type ReactNode } from 'react';
import { ChevronDown, Copy, CopyPlus, Info, Play, RefreshCw, CircleStop } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { copyText, editInComposer, regenerate, regenerateEstimate } from '../../engine/actions';
import { cancelGeneration, checkStatusNow } from '../../engine/jobs';
import { OPS } from '../../engine/ops';
import { KindBackdrop } from '../ui/KindBackdrop';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { IconButton } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { DownloadButton, FavoriteButton } from '../assets/AssetActions';
import { GenerationInfo } from '../assets/GenerationInfo';
import { AgentAttachToggle } from '../assets/AgentAttachToggle';
import { StopFollowingPopover } from './StopFollowing';

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
  const stopFollowing = usePopover();
  if (!g || (g.kind !== 'image' && g.kind !== 'video') || !['done', 'running', 'queued'].includes(g.status)) return <>{fallback}</>;
  const busy = g.status !== 'done';
  const outputs = g.assetIds;
  const first = outputs[0];
  return <div className="studio-gen" id={`gen-${g.id}`} aria-label={busy ? 'Generating' : 'Generated'}>
    {busy ? (() => {
      const total = g.op ? 1 : g.settings.count;
      const p = g.progress == null ? null : Math.min(1, Math.max(0, g.progress > 1 ? g.progress / 100 : g.progress));
      return <div className="studio-gen-row"><div className="studio-thumb is-pending" role="status"><div className="shimmer" />
        <div className="studio-pending-text"><span>{g.status === 'queued' ? 'Queued' : g.statusText ?? 'Creating'}</span><span className="faint">{outputs.length}/{total}</span></div>
        {p != null ? <div className="space-run-bar" role="progressbar" aria-valuenow={Math.round(p * 100)}><span style={{ width: `${p * 100}%` }} /></div> : null}
      </div></div>;
    })() : <>
    <button type="button" className="studio-gen-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      Created {outputs.length} file{outputs.length === 1 ? '' : 's'}
      <ChevronDown size={13} className={open ? '' : 'is-closed'} />
    </button>
    {open ? <div className="studio-gen-row">
      {outputs.map((id, i) => <div key={id} className="attach-host"><button type="button" className="studio-thumb" aria-label={g.kind === 'video' ? 'Open video' : 'Open image'} onClick={() => setUi({ lightbox: { assetIds: outputs, index: i } })}>
        <KindBackdrop kind={g.kind === 'video' ? 'video' : 'image'} />
        <AssetMedia assetId={id} hoverPlay={false} autoPlay={false} draggable={false} />
        {g.kind === 'video' ? <span className="studio-thumb-play" aria-hidden><Play size={16} fill="currentColor" /></span> : null}
      </button><AgentAttachToggle assetId={id} /></div>)}
    </div> : null}
    </>}
    <div className="studio-gen-actions">
      {g.prompt ? <IconButton icon={Copy} label="Copy prompt" size="sm" onClick={() => void copyText(g.prompt)} /> : null}
      {!g.op && !busy ? <IconButton icon={CopyPlus} label="Reuse: prompt, inputs, model and settings in the composer" size="sm" onClick={() => void editInComposer(g.id)} /> : null}
      {!busy ? <IconButton ref={regen.ref} icon={RefreshCw} label="Regenerate" size="sm" active={regen.open} onClick={regen.toggle} /> : null}
      {first && !busy ? <><FavoriteButton assetId={first} /><DownloadButton assetId={first} /></> : null}
      <IconButton ref={info.ref} icon={Info} label="Details" size="sm" active={info.open} onClick={info.toggle} />
      {g.status === 'running' && g.remoteJob ? <IconButton icon={RefreshCw} label="Check status" size="sm" data-tip={`Ask ${g.remoteJob.provider} about this job now`} onClick={() => checkStatusNow(g.id)} /> : null}
      {busy && g.remoteJob ? <IconButton ref={stopFollowing.ref} icon={CircleStop} label="Dejar de seguir" size="sm" tone="danger" active={stopFollowing.open} onClick={stopFollowing.toggle} /> : busy ? <IconButton icon={CircleStop} label="Stop" size="sm" tone="danger" onClick={() => cancelGeneration(g.id)} /> : null}
    </div>
    <Popover open={regen.open} anchor={regen.ref} onClose={regen.close} width={300} label="Regenerate">
      <SpendConfirm title={g.op ? `Run ${OPS[g.op.id].label} again` : 'Regenerate with a new seed'} estimate={regen.open ? regenerateEstimate(g.id) ?? g.estimate : g.estimate} confirmLabel="Regenerate" onConfirm={() => { regen.close(); void regenerate(g.id); }} onCancel={regen.close} />
    </Popover>
    <StopFollowingPopover g={g} pop={stopFollowing} />
    <Popover open={info.open} anchor={info.ref} onClose={info.close} width={340} label="Details" className="pop-scroll">
      <PopoverHeader title="Details" sub={g.kind === 'video' ? 'Video' : 'Image'} />
      <GenerationInfo generation={g} asset={first ? useStore.getState().assets[first] : undefined} />
    </Popover>
  </div>;
}
