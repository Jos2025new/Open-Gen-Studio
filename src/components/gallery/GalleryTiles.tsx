import { useState } from 'react';
import { AudioLines, Bot, Box, Clock, Copy, Download, Eye, EyeOff, FileText, Film, Maximize2, MessageSquare, Paperclip, RotateCcw, Star, Trash } from 'lucide-react';
import { setComposer, setUi, toast, useStore } from '../../store/store';
import { AGENT_ATTACHABLE, copyText, deleteAssets, downloadAsset, toggleAgentAttachment, toggleFavorite, useAsReference } from '../../engine/actions';
import { canReuse, reuseGeneration } from '../../store/reuse';
import { setUserHidden } from '../../store/userHidden';
import { formatDuration, formatRelative } from '../../lib/format';
import { IconButton } from '../ui/primitives';
import { AssetMedia } from '../ui/AssetMedia';
import { AgentAttachToggle } from '../assets/AgentAttachToggle';
import { CardCheck, CardMenu, MenuConfirm, MenuItem, useTapReveal, type ItemView } from '../ui/PanelControls';
import { generationTitle } from '../assets/GenerationInfo';
import { TextResult } from '../assets/TextResult';
import type { Asset, Generation } from '../../engine/types';
import '../assets/text-result.css';

/** "Seedance · 1:1 · 1k": the model and the parameters the generation recorded (aspect, resolution, duration). */
export function tileDetails(asset: Asset | undefined, g: Generation | undefined): string {
  const duration = g?.settings.duration ?? asset?.duration;
  const size = g?.settings.aspect || g?.settings.resolution ? null : asset && asset.width > 0 && asset.height > 0 ? `${asset.width} × ${asset.height}` : null;
  return [g?.modelName, g?.settings.aspect, g?.settings.resolution, duration ? formatDuration(duration * 1000) : null, size].filter(Boolean).join(' · ');
}
export const assetTitle = (asset: Asset, g?: Generation) => g?.prompt || asset.name || asset.kind;

function AssetMenuItems({ asset, g, close }: { asset: Asset; g?: Generation; close: () => void }) {
  const inContext = useStore((s) => s.composer.attachments.includes(asset.id));
  useStore((s) => s.assets);
  useStore((s) => s.catalog.models);
  const [confirming, setConfirming] = useState(false);
  if (confirming) return <MenuConfirm text="Delete this asset? The file is removed from this browser." action="Delete" onCancel={() => setConfirming(false)} onConfirm={() => { deleteAssets([asset.id]); close(); }} />;
  const run = (f: () => void) => () => { f(); close(); };
  return <>
    <MenuItem icon={Download} onClick={run(() => void downloadAsset(asset.id))}>Download</MenuItem>
    <MenuItem icon={Paperclip} onClick={run(() => useAsReference(asset.id))}>Use as reference</MenuItem>
    {AGENT_ATTACHABLE.includes(asset.kind) ? <MenuItem icon={Bot} onClick={run(() => toggleAgentAttachment(asset.id))}>{inContext ? 'Remove from the agent context' : 'Add to the agent context'}</MenuItem> : null}
    {g && canReuse(g) ? <MenuItem icon={RotateCcw} onClick={run(() => void reuseGeneration(g))}>Reusar</MenuItem> : null}
    <MenuItem icon={asset.userHidden ? Eye : EyeOff} onClick={run(() => setUserHidden('asset', [asset.id], !asset.userHidden))}>{asset.userHidden ? 'Unhide' : 'Hide'}</MenuItem>
    <MenuItem icon={Trash} tone="danger" onClick={() => setConfirming(true)}>Delete</MenuItem>
  </>;
}

const KindIcon = ({ kind }: { kind: Asset['kind'] }) => kind === 'audio' ? <AudioLines size={11} /> : kind === 'model3d' ? <Box size={11} /> : <Film size={11} />;

/** A generated asset: an image-first card (details on hover, focus or first tap) or a compact row. */
export function GalleryTile({ asset, selected, selecting, view, onOpen, onToggle }: { asset: Asset; selected: boolean; selecting: boolean; view: ItemView; onOpen: () => void; onToggle: () => void }) {
  const g = useStore((s) => asset.generationId ? s.generations[asset.generationId] : undefined);
  const tap = useTapReveal(onOpen);
  const title = assetTitle(asset, g);
  const details = tileDetails(asset, g);
  const tools = <span className="pc-tools">
    <IconButton icon={Star} label={asset.favorite ? 'Remove from favorites' : 'Add to favorites'} size="sm" aria-pressed={Boolean(asset.favorite)} className={`pc-fav pc-hover${asset.favorite ? ' is-on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleFavorite(asset.id); }} />
    <CardMenu label="More actions" className="pc-hover">{(close) => <AssetMenuItems asset={asset} g={g} close={close} />}</CardMenu>
  </span>;
  const hiddenMark = asset.userHidden ? <span className="pc-hidden-badge" title="Hidden"><EyeOff size={12} /></span> : null;
  const remote = !asset.stored ? <span className="g-remote" data-tip="Stored at the provider only; it may expire"><Clock size={11} /></span> : null;
  const when = <time className="pc-when" dateTime={new Date(asset.createdAt).toISOString()}>{formatRelative(asset.createdAt)}</time>;
  if (view === 'list') {
    return <div className={`g-tile pc-row${asset.userHidden ? ' is-hidden-item' : ''}${selected ? ' is-selected' : ''}`}>
      <CardCheck checked={selected} label={`Select ${title}`} onToggle={onToggle} />
      <button type="button" className="g-open pc-thumb" onClick={onOpen} aria-label="Open"><AssetMedia assetId={asset.id} hoverPlay={false} /></button>
      <span className="pc-text"><span className="pc-info-title" title={title}>{title}</span><span className="pc-info-sub">{details}</span></span>
      <AgentAttachToggle assetId={asset.id} glyph={Paperclip} />
      {remote}{hiddenMark}{when}{tools}
    </div>;
  }
  return <div className={`g-tile pc-card${asset.userHidden ? ' is-hidden-item' : ''}${selected ? ' is-selected' : ''}${selecting ? ' is-selecting' : ''}${tap.armed ? ' is-armed' : ''}`}>
    <button type="button" className="g-open" onPointerDown={tap.onPointerDown} onClick={tap.onClick} aria-label="Open" title={title}>
      <AssetMedia assetId={asset.id} />
    </button>
    <CardCheck checked={selected} label={`Select ${title}`} onToggle={onToggle} />
    <AgentAttachToggle assetId={asset.id} glyph={Paperclip} />
    {tools}
    {asset.kind === 'video' || asset.kind === 'audio' || asset.kind === 'model3d' ? (
      <span className="g-badge pc-badge num"><KindIcon kind={asset.kind} />{asset.kind === 'model3d' ? '3D' : asset.duration ? formatDuration(asset.duration * 1000) : ''}</span>
    ) : null}
    {remote}{hiddenMark}
    <div className="pc-info pc-hover"><span className="pc-info-title">{details || title}</span><span className="pc-info-sub">{when}</span></div>
  </div>;
}

/** A finished text result in the same pattern: no select or favorite (text has no asset), the rest behind ⋮. */
export function LibraryTextTile({ g, view }: { g: Generation; view: ItemView }) {
  const open = () => setUi({ textView: g.id });
  const tap = useTapReveal(open);
  const title = generationTitle(g) || 'Text';
  const reusable = useStore((s) => { void s.assets; void s.catalog.models; return canReuse(g); });
  const menu = <span className="pc-tools"><CardMenu label="More actions" className="pc-hover">{(close) => <>
    <MenuItem icon={Maximize2} onClick={() => { open(); close(); }}>Open text</MenuItem>
    <MenuItem icon={Copy} disabled={!g.text} onClick={() => { void copyText(g.text ?? ''); close(); }}>Copy</MenuItem>
    <MenuItem icon={MessageSquare} disabled={!g.text} onClick={() => { setComposer({ text: g.text ?? '' }); setUi((u) => ({ focusComposer: u.focusComposer + 1, textView: null })); toast('Text placed in the composer.', 'info'); close(); }}>Use as prompt</MenuItem>
    {reusable ? <MenuItem icon={RotateCcw} onClick={() => { void reuseGeneration(g); close(); }}>Reusar</MenuItem> : null}
  </>}</CardMenu></span>;
  const when = <time className="pc-when" dateTime={new Date(g.createdAt).toISOString()}>{formatRelative(g.createdAt)}</time>;
  if (view === 'list') {
    return <article className="space-card text-result-tile pc-row">
      <span className="pc-thumb" aria-hidden="true"><FileText size={16} /></span>
      <button type="button" className="pc-text" aria-label="Open text" onClick={open}><span className="pc-info-title" title={title}>{title}</span><span className="pc-info-sub">{[g.modelName, g.text].filter(Boolean).join(' · ')}</span></button>
      {when}{menu}
    </article>;
  }
  return <article className={`space-card text-result-tile pc-card pc-text-card${tap.armed ? ' is-armed' : ''}`} onPointerDown={tap.onPointerDown} onClick={(e) => { if (!(e.target as Element).closest('button')) tap.onClick(); }}>
    <TextResult g={g} compact />
    {menu}
    <div className="pc-info pc-hover"><span className="pc-info-title">{g.modelName || title}</span><span className="pc-info-sub">{when}</span></div>
  </article>;
}
