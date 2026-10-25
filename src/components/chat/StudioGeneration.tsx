import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Copy, CopyPlus, Download, Info, Star, X, Play, RefreshCw, CircleStop } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { ImproveShotButton } from './ImproveShotButton';
import { copyText, downloadAsset, editInComposer, toggleFavorite, regenerate, regenerateEstimate } from '../../engine/actions';
import { cancelGeneration, checkStatusNow } from '../../engine/jobs';
import { OPS } from '../../engine/ops';
import { KindBackdrop } from '../ui/KindBackdrop';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Button, IconButton } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { DownloadButton, FavoriteButton } from '../assets/AssetActions';
import { GenerationInfo } from '../assets/GenerationInfo';
import { AgentAttachToggle } from '../assets/AgentAttachToggle';
import { StopFollowingPopover } from './StopFollowing';
import { setStudioBoard } from '../../lib/studioBoard';
import { GenerationNotices } from './GenerationNotices';
import { chatResults } from './GenerationCard';

/** A running placeholder opens the Generations board on Ongoing. */
function showOngoing() {
  setStudioBoard({ open: true, view: 'assets' });
  window.setTimeout(() => document.querySelector('.space-ongoing')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
}

/**
 * A generation in Studio's chat: a "Created N files" line that folds, the results as small inline thumbnails (click
 * opens the viewer) and a row of small icon actions. Running ones show a small placeholder; the board's Ongoing row
 * follows them too. Failures, text, sound and 3D keep the full card (its retry and recovery actions).
 */
type PickKind = 'fav' | 'dl' | 'info' | 'copy' | 'reuse';
const SINGLE: PickKind[] = ['info', 'copy', 'reuse'];

/** `grouped`: one of a row of results that folds as a whole, so it shows no fold of its own. */
export function StudioGeneration({ generationId, fallback, grouped }: { generationId: string; fallback: ReactNode; grouped?: boolean }) {
  const g = useStore((s) => s.generations[generationId]);
  const [open, setOpen] = useState(true);
  const regen = usePopover();
  const info = usePopover();
  const stopFollowing = usePopover();
  const [pick, setPick] = useState<PickKind | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [infoId, setInfoId] = useState<string | null>(null);
  if (!g || (g.kind !== 'image' && g.kind !== 'video') || !['done', 'running', 'queued'].includes(g.status)) return <>{fallback}</>;
  const busy = g.status !== 'done';
  const outputs = g.assetIds;
  const first = outputs[0];
  const multi = !busy && outputs.length > 1;
  const cancelPick = () => { setPick(null); setPicked([]); };
  const startPick = (k: PickKind) => { setPick(k); setPicked([]); };
  const confirmPick = () => {
    if (pick === 'dl') picked.forEach((id) => void downloadAsset(id));
    else if (pick === 'fav') { const all = useStore.getState().assets; const target = picked.some((id) => !all[id]?.favorite); picked.forEach((id) => { if (Boolean(all[id]?.favorite) !== target) toggleFavorite(id); }); }
    else if (pick === 'info') { setInfoId(picked[0]); info.toggle(); }
    else if (pick === 'copy') void copyText([g.prompt, g.variants?.[outputs.indexOf(picked[0])]].filter(Boolean).join(' '));
    else if (pick === 'reuse') void editInComposer(g.id);
    cancelPick();
  };
  const toggleId = (id: string) => setPicked(SINGLE.includes(pick!) ? (picked[0] === id ? [] : [id]) : picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const pickBtn = (k: PickKind, noun: string) => pick === k
    ? <span className="studio-pick-hint" role="status">
        {picked.length ? <Button variant="primary" size="sm" icon={Check} className="studio-pick-go" onClick={confirmPick}>{noun}{SINGLE.includes(k) ? '' : ` ${picked.length}`}</Button> : <span>{SINGLE.includes(k) ? 'Select an image' : 'Select images first'}</span>}
        <IconButton icon={X} label="Cancel selection" size="sm" onClick={cancelPick} />
      </span> : null;
  // The viewer steps through every result of this chat, as the full card does.
  const openViewer = (id: string, i: number) => {
    const all = chatResults(g.sessionId);
    const at = all.indexOf(id);
    setUi({ lightbox: at >= 0 ? { assetIds: all, index: at } : { assetIds: outputs, index: i } });
  };
  return <div className="studio-gen" id={`gen-${g.id}`} aria-label={busy ? 'Generating' : 'Generated'}>
    {busy ? <div className="studio-gen-row"><div className="studio-thumb is-pending" role="status" tabIndex={0} aria-label="Show in Ongoing" onClick={showOngoing} onKeyDown={(e) => { if (e.key === 'Enter') showOngoing(); }}><KindBackdrop kind={g.kind === 'video' ? 'video' : 'image'} />
        <div className="studio-pending-text is-quiet"><span>Ongoing</span></div>
      </div></div> : <>
    {grouped ? null : <button type="button" className="studio-gen-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      Created {outputs.length} file{outputs.length === 1 ? '' : 's'}
      <ChevronDown size={13} className={open ? '' : 'is-closed'} />
    </button>}
    {open || grouped ? <div className="studio-gen-row">
      {outputs.map((id, i) => <div key={id} className="attach-host"><button type="button" className="studio-thumb" aria-label={g.kind === 'video' ? 'Open video' : 'Open image'} onClick={() => pick ? toggleId(id) : openViewer(id, i)}>
        <KindBackdrop kind={g.kind === 'video' ? 'video' : 'image'} />
        <AssetMedia assetId={id} hoverPlay={false} autoPlay={false} draggable={false} />
        {g.kind === 'video' ? <span className="studio-thumb-play" aria-hidden><Play size={16} fill="currentColor" /></span> : null}
      </button>{pick ? <span className={`studio-pick-box ${picked.includes(id) ? 'is-on' : ''}`} role="checkbox" aria-checked={picked.includes(id)} aria-label="Select image" onClick={() => toggleId(id)}>{picked.includes(id) ? picked.indexOf(id) + 1 : null}</span> : <AgentAttachToggle assetId={id} />}</div>)}
    </div> : null}
    <GenerationNotices g={g} />
    </>}
    <div className="studio-gen-actions">
      {g.prompt ? <IconButton icon={Copy} label="Copy prompt" size="sm" active={pick === 'copy'} onClick={multi ? () => startPick('copy') : () => void copyText(g.prompt)} /> : null}{multi ? pickBtn('copy', 'Copy') : null}
      {!g.op && !busy ? <IconButton icon={CopyPlus} label="Reuse: prompt, inputs, model and settings in the composer" size="sm" active={pick === 'reuse'} onClick={multi ? () => startPick('reuse') : () => void editInComposer(g.id)} /> : null}{multi ? pickBtn('reuse', 'Reuse') : null}
      {!busy ? <IconButton ref={regen.ref} icon={RefreshCw} label="Regenerate" size="sm" active={regen.open} onClick={regen.toggle} /> : null}
      {first && !multi ? <><FavoriteButton assetId={first} /><DownloadButton assetId={first} /></> : null}
      {multi ? <><IconButton icon={Star} label="Favorite" size="sm" active={pick === 'fav'} onClick={() => startPick('fav')} />{pickBtn('fav', 'Favorite')}
        <IconButton icon={Download} label="Download" size="sm" active={pick === 'dl'} onClick={() => startPick('dl')} />{pickBtn('dl', 'Download')}</> : null}
      {!busy ? <ImproveShotButton g={g} /> : null}
      <IconButton ref={info.ref} icon={Info} label="Details" size="sm" active={info.open || pick === 'info'} onClick={multi ? () => startPick('info') : info.toggle} />{multi ? pickBtn('info', 'Details') : null}
      {g.status === 'running' && g.remoteJob ? <IconButton icon={RefreshCw} label="Check status" size="sm" data-tip={`Ask ${g.remoteJob.provider} about this job now`} onClick={() => checkStatusNow(g.id)} /> : null}
      {busy && g.remoteJob ? <IconButton ref={stopFollowing.ref} icon={CircleStop} label="Dejar de seguir" size="sm" tone="danger" active={stopFollowing.open} onClick={stopFollowing.toggle} /> : busy ? <IconButton icon={CircleStop} label="Stop" size="sm" tone="danger" onClick={() => cancelGeneration(g.id)} /> : null}
    </div>
    <Popover open={regen.open} anchor={regen.ref} onClose={regen.close} width={300} label="Regenerate">
      <SpendConfirm title={g.op ? `Run ${OPS[g.op.id].label} again` : 'Regenerate with a new seed'} estimate={regen.open ? regenerateEstimate(g.id) ?? g.estimate : g.estimate} confirmLabel="Regenerate" onConfirm={() => { regen.close(); void regenerate(g.id); }} onCancel={regen.close} />
    </Popover>
    <StopFollowingPopover g={g} pop={stopFollowing} />
    <Popover open={info.open} anchor={info.ref} onClose={info.close} width={340} label="Details" className="pop-scroll">
      <PopoverHeader title="Details" sub={g.kind === 'video' ? 'Video' : 'Image'} />
      <GenerationInfo generation={g} asset={(multi ? infoId ?? first : first) ? useStore.getState().assets[(multi ? infoId ?? first : first)!] : undefined} />
    </Popover>
  </div>;
}
