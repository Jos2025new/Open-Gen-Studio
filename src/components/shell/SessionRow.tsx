import { useState } from 'react';
import { Archive, ArchiveRestore, Box, Eye, EyeOff, Image, MessageSquare, Music, Pencil, PenTool, Pin, PinOff, Trash, Video, Workflow } from 'lucide-react';
import { renameSession, selectSession, setUi, togglePinSession, useStore } from '../../store/store';
import { deleteSession } from '../../engine/actions';
import { isRunning } from '../../engine/jobs';
import { formatRelative, formatUsd } from '../../lib/format';
import { Button, IconButton } from '../ui/primitives';
import { AssetMedia } from '../ui/AssetMedia';
import { CardCheck, CardMenu, MenuConfirm, MenuItem, useTapReveal, type ItemView } from '../ui/PanelControls';
import { setUserHidden } from '../../store/userHidden';
import { setSessionsArchived } from '../../store/sessionArchive';
import type { Session, Workspace } from '../../engine/types';
import type { HeadDef } from '../gallery/ListColumns';

export type QuickMode = 'all' | 'agent' | 'image' | 'video' | 'audio' | 'model3d';
export const QUICK_MODES = [{ id: 'agent', label: 'Agent', icon: Workflow }, { id: 'image', label: 'Images', icon: Image }, { id: 'video', label: 'Videos', icon: Video }, { id: 'audio', label: 'Audio', icon: Music }, { id: 'model3d', label: '3D', icon: Box }] as const;
const MODE_NAME = { agent: 'Agent', image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D' } as const;
const MODE_ICON: Record<string, typeof Workflow> = Object.fromEntries(QUICK_MODES.map((m) => [MODE_NAME[m.id], m.icon]));

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

/** The session's most recent mode: its latest generation's, unless a newer prompt asked for another. */
export function sessionMode(session: Session, stats?: Stats): string | undefined {
  const latestPrompt = session.feed.reduce<(typeof session.feed)[number] | undefined>((latest, item) => item.type === 'user' && (!latest || item.createdAt > latest.createdAt) ? item : latest, undefined);
  const latestPromptMode = latestPrompt?.type === 'user' ? latestPrompt.mode : undefined;
  const recentMode = stats?.latestModeAt && stats.latestModeAt > (latestPrompt?.createdAt ?? 0) ? stats.latestMode : latestPromptMode ?? stats?.latestMode;
  return recentMode ? MODE_NAME[recentMode as keyof typeof MODE_NAME] : undefined;
}

/** Sessions' list columns beyond the name; each one sorts from its header. */
export const SESSION_HEADS: HeadDef<SessionSortKey>[] = [
  { by: 'name', label: 'Name' },
  { by: 'mode', label: 'Mode', width: true },
  { by: 'gens', label: 'Generations', width: true },
  { by: 'nodes', label: 'Nodes', width: true },
  { by: 'designs', label: 'Designs', width: true },
  { by: 'spend', label: 'Spend', width: true },
  { by: 'date', label: 'Date', width: true },
];
export type SessionSortKey = 'name' | 'mode' | 'gens' | 'nodes' | 'designs' | 'spend' | 'date';


/** A session as an image-first card (cover fills it; details on hover, focus or first tap) or as a compact row. */
export function SessionRow({ session, active, stats, selecting, selected, view, basis, onToggle }: { session: Session; active: boolean; stats?: Stats; selecting: boolean; selected: boolean; view: ItemView; basis: 'updated' | 'created'; onToggle: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [confirming, setConfirming] = useState(false);
  const docs = session.docs.length;
  const nodes = session.graph.nodes.length;
  const canvases = sessionCanvases(session);
  const CoverIcon = CANVAS[canvases[0] ?? 'chat'].icon;
  const modeLabel = sessionMode(session, stats);
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
  const rename = () => { if (selecting) return; setDraft(session.title); setEditing(true); };
  const hiddenMark = session.userHidden ? <span className="pc-hidden-badge" title="Hidden"><EyeOff size={12} /></span> : null;
  const keys = (e: React.KeyboardEvent) => { if (!editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } };
  const when = <time className="pc-when" dateTime={new Date(stamp).toISOString()} title={`${basis === 'created' ? 'Created' : 'Updated'}: ${new Date(stamp).toLocaleString()}`}>{formatRelative(stamp)}</time>;
  const ModeIcon = modeLabel ? MODE_ICON[modeLabel] : undefined;
  const mode = <span className="pc-mode">{ModeIcon ? <ModeIcon size={12} /> : null}{modeLabel ?? '—'}</span>;
  const openTag = active ? <span className="pc-open-tag">Open</span> : null;
  const meta = <span className="pc-info-sub num" title={[modeLabel ? `Last mode: ${modeLabel}` : 'No recorded mode', ...details, formatRelative(stamp)].join(' · ')}>{mode}<span aria-hidden="true">·</span>{when}</span>;
  const pin = <IconButton icon={session.pinned ? PinOff : Pin} label={session.pinned ? 'Unpin' : 'Pin'} size="sm" aria-pressed={Boolean(session.pinned)} className={`pc-fav pc-hover${session.pinned ? ' is-on' : ''}`} onClick={(e) => { e.stopPropagation(); togglePinSession(session.id); }} />;
  // List rows show Hide and Archive on the row, so their menu keeps only Rename and Delete; cards keep them in the menu.
  const inRow = view === 'list';
  const hide = () => setUserHidden('session', [session.id], !session.userHidden);
  const archive = () => setSessionsArchived([session.id], !session.archived);
  const shelfButtons = <>
    <IconButton icon={session.userHidden ? Eye : EyeOff} label={session.userHidden ? 'Unhide' : 'Hide'} size="sm" onClick={(e) => { e.stopPropagation(); hide(); }} />
    <IconButton icon={session.archived ? ArchiveRestore : Archive} label={session.archived ? 'Restore session' : 'Archive session'} size="sm" onClick={(e) => { e.stopPropagation(); archive(); }} />
  </>;
  const menu = <CardMenu label="Session actions" className="pc-hover">{(close) => confirming
    ? <MenuConfirm text={`Delete “${session.title}” with its conversation, nodes, designs and assets?`} extra={<RunningNote ids={[session.id]} />} action="Delete" onCancel={() => setConfirming(false)} onConfirm={() => { close(); deleteSession(session.id); }} />
    : <>
      <MenuItem icon={Pencil} onClick={() => { close(); setDraft(session.title); window.setTimeout(() => setEditing(true), 0); }}>Rename</MenuItem>
      {inRow ? null : <>
        <MenuItem icon={session.archived ? ArchiveRestore : Archive} onClick={() => { close(); archive(); }}>{session.archived ? 'Restore session' : 'Archive session'}</MenuItem>
        <MenuItem icon={session.userHidden ? Eye : EyeOff} onClick={() => { close(); hide(); }}>{session.userHidden ? 'Unhide' : 'Hide'}</MenuItem>
      </>}
      <MenuItem icon={Trash} tone="danger" onClick={() => setConfirming(true)}>Delete</MenuItem>
    </>}</CardMenu>;
  const title = editing ? (
    <input autoFocus className="title-input" value={draft} onClick={(e) => e.stopPropagation()} onChange={(e) => setDraft(e.target.value)} aria-label="Session title"
      onBlur={() => { setEditing(false); renameSession(session.id, draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(session.title); setEditing(false); } }} />
  ) : <span className="pc-info-title" title={session.title}>{session.title}</span>;
  const cover = <>
    {stats?.cover ? <AssetMedia assetId={stats.cover} hoverPlay={false} draggable={false} /> : null}
    {!stats?.cover ? <CoverIcon size={view === 'card' ? 28 : 16} className="session-cover-icon" /> : null}
  </>;

  const flags = `${session.userHidden ? ' is-hidden-item' : ''}${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}${selecting ? ' is-selecting' : ''}`;

  if (view === 'list') {
    return (
      <div className={`sess-row pc-row${flags}`}>
        <CardCheck checked={selected} label={`Select ${session.title}`} onToggle={onToggle} />
        <span className="pc-thumb sess-cover" aria-hidden="true">{cover}</span>
        <div role="button" tabIndex={0} className="session-main pc-text" onClick={open} onDoubleClick={rename} onKeyDown={keys}>
          <span className="pc-title-line">{title}{openTag}</span>
          <span className="pc-info-sub num pc-cols-alt">{[modeLabel, ...details].filter(Boolean).join(' · ') || 'empty'}</span>
        </div>
        {hiddenMark}
        <span className="pc-col pc-col-mode">{mode}</span>
        <span className="pc-col pc-col-gens num">{stats?.gens || '—'}</span>
        <span className="pc-col pc-col-nodes num">{nodes || '—'}</span>
        <span className="pc-col pc-col-designs num">{docs || '—'}</span>
        <span className="pc-col pc-col-spend num">{stats?.spend ? formatUsd(stats.spend) : '—'}</span>
        {when}
        <span className="pc-tools">
          {active ? null : <Button size="sm" variant="secondary" className="sess-continue" onClick={(e) => { e.stopPropagation(); open(); }}>Continue</Button>}
          {shelfButtons}{pin}{menu}
        </span>
      </div>
    );
  }
  // Both card views carry the same details: three figures (generations, nodes, designs) and the actions: Continue
  // (Current when open), pin and menu.
  const stat = (value: number, label: string) => <span className="sess-stat"><b className="num">{value}</b><small>{label}</small></span>;
  const figures = <div className="sess-stats">{stat(stats?.gens ?? 0, 'Generations')}{stat(nodes, 'Nodes')}{stat(docs, 'Designs')}</div>;
  const actions = <div className="sess-card-actions">
    <Button size="sm" variant="secondary" disabled={active} onClick={(e) => { e.stopPropagation(); open(); }}>{active ? 'Current' : 'Continue'}</Button>
    <span className="pc-tools">{pin}{menu}</span>
  </div>;
  const coverButton = <div role="button" tabIndex={0} className="session-main pc-open sess-cover" aria-label={session.title} onPointerDown={tap.onPointerDown} onClick={tap.onClick} onDoubleClick={rename} onKeyDown={keys}>{cover}</div>;
  const check = <CardCheck checked={selected} label={`Select ${session.title}`} onToggle={onToggle} />;

  if (view === 'tile') {
    // Cards: the cover fills the left side and fades into the dark right side, which holds the same details.
    return (
      <div className={`sess-tile pc-card${flags}${tap.armed ? ' is-armed' : ''}${editing ? ' is-editing' : ''}`}>
        {coverButton}{check}{hiddenMark}
        <div className="pc-info">{title}{meta}{figures}{actions}</div>
      </div>
    );
  }
  // Grid: the cover fills a portrait card; a dark fade over its lower part carries the details.
  return (
    <div className={`sess-card pc-card${flags}${tap.armed ? ' is-armed' : ''}${editing ? ' is-editing' : ''}`}>
      {coverButton}{check}{hiddenMark}
      <div className="pc-info">{title}{meta}{figures}{actions}</div>
    </div>
  );
}
