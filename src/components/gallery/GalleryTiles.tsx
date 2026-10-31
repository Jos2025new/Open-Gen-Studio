import { useState, type MouseEvent, type ReactNode } from 'react';
import { AudioLines, Box, ImagePlus, Clock, Copy, Download, Eye, EyeOff, FileText, Film, MessageSquare, Paperclip, RotateCcw, Star, Trash } from 'lucide-react';
import { setComposer, setUi, toast, useStore } from '../../store/store';
import { copyText, deleteAssets, downloadAsset, toggleFavorite, useAsReference } from '../../engine/actions';
import { canReuse, reuseGeneration } from '../../store/reuse';
import { setUserHidden } from '../../store/userHidden';
import { formatDuration, formatRelative } from '../../lib/format';
import { Button, IconButton } from '../ui/primitives';
import { AssetMedia } from '../ui/AssetMedia';
import { AgentAttachToggle } from '../assets/AgentAttachToggle';
import { CardCheck, CardMenu, MenuConfirm, MenuItem, useTapReveal, type ItemView } from '../ui/PanelControls';
import { generationTitle } from '../assets/GenerationInfo';
import { TextResult } from '../assets/TextResult';
import type { Asset, Generation } from '../../engine/types';
import { ColumnCells, columnValues } from './ListColumns';
import '../assets/text-result.css';

/** "Seedance · 1:1 · 1k": the model and the parameters the generation recorded (aspect, resolution, duration). */
export function tileDetails(asset: Asset | undefined, g: Generation | undefined): string {
  const duration = g?.settings.duration ?? asset?.duration;
  const size = g?.settings.aspect || g?.settings.resolution ? null : asset && asset.width > 0 && asset.height > 0 ? `${asset.width} × ${asset.height}` : null;
  return [g?.modelName, g?.settings.aspect, g?.settings.resolution, duration ? formatDuration(duration * 1000) : null, size].filter(Boolean).join(' · ');
}
export const assetTitle = (asset: Asset, g?: Generation) => g?.prompt || asset.name || asset.kind;

/** Use as reference and the agent context sit on every view; in the list Download and Hide sit on the row too, so the
 *  menu keeps only what is not visible. */
function AssetMenuItems({ asset, g, close, inRow }: { asset: Asset; g?: Generation; close: () => void; inRow: boolean }) {
  useStore((s) => s.assets);
  useStore((s) => s.catalog.models);
  const [confirming, setConfirming] = useState(false);
  if (confirming) return <MenuConfirm text="Delete this asset? The file is removed from this browser." action="Delete" onCancel={() => setConfirming(false)} onConfirm={() => { deleteAssets([asset.id]); close(); }} />;
  const run = (f: () => void) => () => { f(); close(); };
  return <>
    {g && canReuse(g) ? <MenuItem icon={RotateCcw} onClick={run(() => void reuseGeneration(g))}>Reusar</MenuItem> : null}
    {inRow ? null : <>
      <MenuItem icon={Download} onClick={run(() => void downloadAsset(asset.id))}>Download</MenuItem>
      <MenuItem icon={asset.userHidden ? Eye : EyeOff} onClick={run(() => setUserHidden('asset', [asset.id], !asset.userHidden))}>{asset.userHidden ? 'Unhide' : 'Hide'}</MenuItem>
    </>}
    <MenuItem icon={Trash} tone="danger" onClick={() => setConfirming(true)}>Delete</MenuItem>
  </>;
}

const KindIcon = ({ kind }: { kind: Asset['kind'] }) => kind === 'audio' ? <AudioLines size={11} /> : kind === 'model3d' ? <Box size={11} /> : <Film size={11} />;
const KIND_LABEL: Record<Asset['kind'], string> = { image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D' } as Record<Asset['kind'], string>;
/** Three figures, value over label, as on the Sessions cards. */
export const Figures = ({ items }: { items: Array<[string, string]> }) => <div className="pc-stats">{items.map(([value, label]) => <span key={label} className="pc-stat"><b className="num">{value || '—'}</b><small>{label}</small></span>)}</div>;
/** The cards' action row: the main action stretches; the icon buttons follow. */
export const CardActions = ({ main, children }: { main: ReactNode; children: ReactNode }) => <div className="pc-card-actions">{main}<span className="pc-tools">{children}</span></div>;
const stop = (f: () => void) => (e: MouseEvent) => { e.stopPropagation(); f(); };

/** A generated asset as a Grid card (the image fills it; details, figures and actions on hover, focus or first tap),
 *  a Cards tile (image on the left fading into the details) or a list row. */
export function GalleryTile({ asset, selected, selecting, view, onOpen, onToggle }: { asset: Asset; selected: boolean; selecting: boolean; view: ItemView; onOpen: () => void; onToggle: () => void }) {
  const g = useStore((s) => asset.generationId ? s.generations[asset.generationId] : undefined);
  const tap = useTapReveal(onOpen);
  const title = assetTitle(asset, g);
  const details = tileDetails(asset, g);
  const v = columnValues(asset, g);
  const timed = asset.kind === 'video' || asset.kind === 'audio';
  const use = (className?: string) => <Button size="sm" variant="secondary" icon={ImagePlus} className={className} aria-label="Use as reference" data-tip="Use as reference" onClick={stop(() => useAsReference(asset.id))}><span className="btn-label">Use as reference</span></Button>;
  const fav = <IconButton icon={Star} label={asset.favorite ? 'Remove from favorites' : 'Add to favorites'} size="sm" aria-pressed={Boolean(asset.favorite)} className={`pc-fav pc-hover${asset.favorite ? ' is-on' : ''}`} onClick={stop(() => toggleFavorite(asset.id))} />;
  const menu = <CardMenu label="More actions" className="pc-hover">{(close) => <AssetMenuItems asset={asset} g={g} close={close} inRow={view === 'list'} />}</CardMenu>;
  const hiddenMark = asset.userHidden ? <span className="pc-hidden-badge" title="Hidden"><EyeOff size={12} /></span> : null;
  const remote = !asset.stored ? <span className="g-remote" data-tip="Stored at the provider only; it may expire"><Clock size={11} /></span> : null;
  const when = <time className="pc-when" dateTime={new Date(asset.createdAt).toISOString()}>{formatRelative(asset.createdAt)}</time>;
  const flags = `${asset.userHidden ? ' is-hidden-item' : ''}${selected ? ' is-selected' : ''}${selecting ? ' is-selecting' : ''}`;
  if (view === 'list') {
    return <div className={`g-tile pc-row${flags}`}>
      <CardCheck checked={selected} label={`Select ${title}`} onToggle={onToggle} />
      <button type="button" className="g-open pc-thumb" onClick={onOpen} aria-label="Open"><AssetMedia assetId={asset.id} hoverPlay={false} /></button>
      <span className="pc-text"><span className="pc-info-title" title={title}>{title}</span><span className="pc-info-sub pc-cols-alt">{details}</span></span>
      {remote}{hiddenMark}<ColumnCells v={v} />{when}
      <span className="pc-tools">
        {use('pc-go')}
        <IconButton icon={Download} label="Download" size="sm" className="pc-hover" onClick={stop(() => void downloadAsset(asset.id))} />
        <IconButton icon={asset.userHidden ? Eye : EyeOff} label={asset.userHidden ? 'Unhide' : 'Hide'} size="sm" className="pc-hover" onClick={stop(() => setUserHidden('asset', [asset.id], !asset.userHidden))} />
        <AgentAttachToggle assetId={asset.id} glyph={Paperclip} />
        {fav}{menu}
      </span>
    </div>;
  }
  const info = <div className={`pc-info${view === 'card' ? ' pc-hover' : ''}`}>
    <span className="pc-info-title" title={title}>{title}</span>
    {/* The Grid card leaves the image room: the model and parameters fit one line; the Cards tile shows them as figures. */}
    {view === 'card' ? <span className="pc-info-sub num">{[details, formatRelative(asset.createdAt)].filter(Boolean).join(' · ')}</span> : <>
      <span className="pc-info-sub num">{g?.modelName ? <><span>{g.modelName}</span><span aria-hidden="true">·</span></> : null}{when}</span>
      <Figures items={[[v.aspect, 'Aspect'], [v.resolution, 'Resolution'], timed ? [v.duration, 'Duration'] : [KIND_LABEL[asset.kind] ?? asset.kind, 'Kind']]} />
    </>}
    <CardActions main={use()}><AgentAttachToggle assetId={asset.id} glyph={Paperclip} />{fav}{menu}</CardActions>
  </div>;
  return <div className={`g-tile pc-card ${view === 'tile' ? 'pc-tile' : 'pc-fade'}${flags}${tap.armed ? ' is-armed' : ''}`}>
    <button type="button" className="g-open pc-open" onPointerDown={tap.onPointerDown} onClick={tap.onClick} aria-label="Open" data-title={title}>
      <AssetMedia assetId={asset.id} />
    </button>
    <CardCheck checked={selected} label={`Select ${title}`} onToggle={onToggle} />
    {view === 'card' && (timed || asset.kind === 'model3d') ? (
      <span className="g-badge pc-badge num"><KindIcon kind={asset.kind} />{asset.kind === 'model3d' ? '3D' : asset.duration ? formatDuration(asset.duration * 1000) : ''}</span>
    ) : null}
    {remote}{hiddenMark}{info}
  </div>;
}

/** A finished text result in the same pattern: no select or favorite (text has no asset); Open text is the main action. */
export function LibraryTextTile({ g, view }: { g: Generation; view: ItemView }) {
  const open = () => setUi({ textView: g.id });
  const tap = useTapReveal(open);
  const title = generationTitle(g) || 'Text';
  const reusable = useStore((s) => { void s.assets; void s.catalog.models; return canReuse(g); });
  const menu = <CardMenu label="More actions" className="pc-hover">{(close) => <>
    <MenuItem icon={Copy} disabled={!g.text} onClick={() => { void copyText(g.text ?? ''); close(); }}>Copy</MenuItem>
    <MenuItem icon={MessageSquare} disabled={!g.text} onClick={() => { setComposer({ text: g.text ?? '' }); setUi((u) => ({ focusComposer: u.focusComposer + 1, textView: null })); toast('Text placed in the composer.', 'info'); close(); }}>Use as prompt</MenuItem>
    {reusable ? <MenuItem icon={RotateCcw} onClick={() => { void reuseGeneration(g); close(); }}>Reusar</MenuItem> : null}
  </>}</CardMenu>;
  const openButton = (className?: string) => <Button size="sm" variant="secondary" className={className} onClick={stop(open)}>Open text</Button>;
  const when = <time className="pc-when" dateTime={new Date(g.createdAt).toISOString()}>{formatRelative(g.createdAt)}</time>;
  if (view === 'list') {
    return <article className="space-card text-result-tile pc-row">
      <span className="pc-thumb" aria-hidden="true"><FileText size={16} /></span>
      <button type="button" className="pc-text" aria-label="Open text" onClick={open}><span className="pc-info-title" title={title}>{title}</span><span className="pc-info-sub">{g.modelName ? <span className="pc-cols-alt">{g.modelName}{g.text ? ' · ' : ''}</span> : null}{g.text}</span></button>
      <ColumnCells v={columnValues(undefined, g)} />{when}<span className="pc-tools">{openButton('pc-go')}{menu}</span>
    </article>;
  }
  if (view === 'tile') {
    return <article className="text-result-tile pc-card pc-tile">
      <button type="button" className="pc-open pc-glyph-cover" aria-label="Open text" onClick={open}><FileText size={24} /></button>
      <div className="pc-info">
        <span className="pc-info-title" title={title}>{title}</span>
        <span className="pc-info-sub num">{g.modelName ? <><span>{g.modelName}</span><span aria-hidden="true">·</span></> : null}{when}</span>
        {g.text ? <span className="pc-excerpt">{g.text}</span> : null}
        <CardActions main={openButton()}>{menu}</CardActions>
      </div>
    </article>;
  }
  return <article className={`space-card text-result-tile pc-card pc-text-card${tap.armed ? ' is-armed' : ''}`} onPointerDown={tap.onPointerDown} onClick={(e) => { if (!(e.target as Element).closest('button')) tap.onClick(); }}>
    <TextResult g={g} compact />
    <span className="pc-tools">{menu}</span>
    <div className="pc-info pc-hover"><span className="pc-info-title">{g.modelName || title}</span><span className="pc-info-sub">{when}</span></div>
  </article>;
}
