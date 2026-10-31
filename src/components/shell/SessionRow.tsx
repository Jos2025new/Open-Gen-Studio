import { useState } from 'react';
import { Archive, ArchiveRestore, Box, Image, MessageSquare, Music, Pencil, PenTool, Pin, PinOff, Trash, Video, Workflow } from 'lucide-react';
import { renameSession, selectSession, setUi, togglePinSession, useStore } from '../../store/store';
import { deleteSession } from '../../engine/actions';
import { isRunning } from '../../engine/jobs';
import { formatRelative, formatUsd } from '../../lib/format';
import { IconButton } from '../ui/primitives';
import { AssetMedia } from '../ui/AssetMedia';
import { CardCheck, CardMenu, MenuConfirm, MenuItem, useTapReveal, type ItemView } from '../ui/PanelControls';
import { setSessionsArchived } from '../../store/sessionArchive';
import type { Session, Workspace } from '../../engine/types';

export type QuickMode = 'all' | 'agent' | 'image' | 'video' | 'audio' | 'model3d';
export const QUICK_MODES = [{ id: 'agent', label: 'Agent', icon: Workflow }, { id: 'image', label: 'Images', icon: Image }, { id: 'video', label: 'Videos', icon: Video }, { id: 'audio', label: 'Audio', icon: Music }, { id: 'model3d', label: '3D', icon: Box }] as const;
const MODE_NAME = { agent: 'Agent', image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D' } as const;

export const CANVAS: Record<Workspace, { label: string; icon: typeof MessageSquare }> = {
  chat: { label: 'Chat', icon: MessageSquare },
  node: { label: 'Nodes', icon: Workflow },
  designer: { label: 'Designer', icon: PenTool },
};

/** The canvases a session has work on: its messages there, its nodes, its designs. */
export function sessionCanvases(s: Session): Workspace[] {
  const on = new Set<Workspace>(s.feed.map((f) => f.workspace));
  if (s.graph.nodes.length) on.add('node');
  if (s.docs.some((d) => d.layers.length)) on.add('designer');
  return (['chat', 'node', 'designer'] as const).filter((w) => on.has(w));
}

export interface Stats {
  assets: string[];
  gens: number;
  spend: number;
  cover?: string;
  modes: Set<Exclude<QuickMode, 'all'>>;
  latestMode?: Exclude<QuickMode, 'all'>;
  latestModeAt?: number;
}

export function RunningNote({ ids }: { ids: string[] }) {
  const n = useStore((st) => Object.values(st.generations).filter((g) => ids.includes(g.sessionId) && isRunning(g.id)).length);
  if (!n) return null;
  return <p className="muted">{n} generation{n === 1 ? ' is' : 's are'} still running: {n === 1 ? 'it' : 'they'} will finish, any charge is recorded in Spending, and the results are discarded.</p>;
}

const shortDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** A session as an image-first card (cover fills it; details on hover, focus or first tap) or as a compact row. */
export function SessionRow({ session, active, stats, compact, selecting, selected, view, basis, onToggle }: { session: Session; active: boolean; stats?: Stats; compact: boolean; selecting: boolean; selected: boolean; view: ItemView; basis: 'updated' | 'created'; onToggle: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [confirming, setConfirming] = useState(false);
  const docs = session.docs.length;
  const nodes = session.graph.nodes.length;
  const canvases = sessionCanvases(session);
  const CoverIcon = CANVAS[canvases[0] ?? 'chat'].icon;
  const latestPrompt = session.feed.reduce<(typeof session.feed)[number] | undefined>((latest, item) => item.type === 'user' && (!latest || item.createdAt > latest.createdAt) ? item : latest, undefined);
  const latestPromptMode = latestPrompt?.type === 'user' ? latestPrompt.mode : undefined;
  const recentMode = stats?.latestModeAt && stats.latestModeAt > (latestPrompt?.createdAt ?? 0) ? stats.latestMode : latestPromptMode ?? stats?.latestMode;
  const modeLabel = recentMode ? MODE_NAME[recentMode as keyof typeof MODE_NAME] : undefined;
  const stamp = basis === 'created' ? session.createdAt : session.updatedAt;
  const details = [stats?.gens ? `${stats.gens} gen` : null, nodes ? `${nodes} nodes` : null, docs ? `${docs} design${docs === 1 ? '' : 's'}` : null, stats?.spend ? formatUsd(stats.spend) : null].filter(Boolean);
  const open = () => {
    if (selecting) return onToggle();
    if (editing) return;
    if (session.archived) setSessionsArchived([session.id], false);
    selectSession(session.id);
    setUi({ panel: null, home: false, space: undefined });
  };
  const tap = useTapReveal(open);
  const keys = (e: React.KeyboardEvent) => { if (!editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } };
  const when = <time className="pc-when" dateTime={new Date(stamp).toISOString()} title={`${basis === 'created' ? 'Created' : 'Updated'}: ${new Date(stamp).toLocaleString()}`}>{shortDate(stamp)}</time>;
  const pin = <IconButton icon={session.pinned ? PinOff : Pin} label={session.pinned ? 'Unpin' : 'Pin'} size="sm" aria-pressed={Boolean(session.pinned)} className={`pc-fav pc-hover${session.pinned ? ' is-on' : ''}`} onClick={(e) => { e.stopPropagation(); togglePinSession(session.id); }} />;
  const menu = <CardMenu label="Session actions" className="pc-hover">{(close) => confirming
    ? <MenuConfirm text={`Delete “${session.title}” with its conversation, nodes, designs and assets?`} extra={<RunningNote ids={[session.id]} />} action="Delete" onCancel={() => setConfirming(false)} onConfirm={() => { close(); deleteSession(session.id); }} />
    : <>
      <MenuItem icon={Pencil} onClick={() => { close(); setDraft(session.title); window.setTimeout(() => setEditing(true), 0); }}>Rename</MenuItem>
      <MenuItem icon={session.archived ? ArchiveRestore : Archive} onClick={() => { close(); setSessionsArchived([session.id], !session.archived); }}>{session.archived ? 'Restore session' : 'Archive session'}</MenuItem>
      <MenuItem icon={Trash} tone="danger" onClick={() => setConfirming(true)}>Delete</MenuItem>
    </>}</CardMenu>;
  const title = editing ? (
    <input autoFocus className="title-input" value={draft} onClick={(e) => e.stopPropagation()} onChange={(e) => setDraft(e.target.value)} aria-label="Session title"
      onBlur={() => { setEditing(false); renameSession(session.id, draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(session.title); setEditing(false); } }} />
  ) : <span className="pc-info-title" title={session.title}>{session.title}</span>;
  const cover = <>
    {stats?.cover && !compact ? <AssetMedia assetId={stats.cover} hoverPlay={false} draggable={false} /> : null}
    {!(stats?.cover && !compact) ? <CoverIcon size={view === 'list' ? 16 : 28} className="session-cover-icon" /> : null}
  </>;

  if (view === 'list') {
    return (
      <div className={`sess-row pc-row${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}>
        <CardCheck checked={selected} label={`Select ${session.title}`} onToggle={onToggle} />
        <span className="pc-thumb sess-cover" aria-hidden="true">{cover}</span>
        <div role="button" tabIndex={0} className="session-main pc-text" onClick={open} onKeyDown={keys}>
          {title}
          <span className="pc-info-sub num">{[modeLabel, ...details].filter(Boolean).join(' · ') || 'empty'}{active ? ' · Open' : ''}</span>
        </div>
        {when}
        <span className="pc-tools">{pin}{menu}</span>
      </div>
    );
  }
  return (
    <div className={`sess-card pc-card${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}${selecting ? ' is-selecting' : ''}${tap.armed ? ' is-armed' : ''}${editing ? ' is-editing' : ''}`}>
      <div role="button" tabIndex={0} className="session-main pc-open sess-cover" aria-label={session.title} onPointerDown={tap.onPointerDown} onClick={tap.onClick} onKeyDown={keys}>{cover}</div>
      <CardCheck checked={selected} label={`Select ${session.title}`} onToggle={onToggle} />
      <span className="pc-tools">{pin}{menu}</span>
      {active ? <span className="sess-open">Open</span> : null}
      <div className="pc-info pc-hover">
        {title}
        <span className="pc-info-sub num" title={[modeLabel ? `Last mode: ${modeLabel}` : 'No recorded mode', ...details, formatRelative(stamp)].join(' · ')}>{modeLabel ?? '—'} · {when}</span>
      </div>
    </div>
  );
}
