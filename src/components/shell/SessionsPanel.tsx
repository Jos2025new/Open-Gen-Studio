import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Box, Check, Image, LayoutGrid, LayoutList, List, Maximize2, MessageSquare, Minimize2, Music, Pencil, PenTool, Pin, PinOff, Plus, Search, ListFilter, ArrowUpDown, ChevronDown, Eye, EyeOff, Trash, Video, Workflow, X } from 'lucide-react';
import { newSession, renameSession, selectSession, setUi, togglePinSession, useStore } from '../../store/store';
import { deleteSession } from '../../engine/actions';
import { isRunning } from '../../engine/jobs';
import { formatRelative, formatUsd, groupByDate } from '../../lib/format';
import { Button, IconButton, Segmented, Toggle } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { AssetMedia } from '../ui/AssetMedia';
import type { Session, Workspace } from '../../engine/types';
import { usePanelExpanded } from './panelEmbed';
import { visibleSessions } from '../../store/spaceSession';
import { ResultsMenu } from '../ui/ResultsMenu';
import { setSessionsArchived } from '../../store/sessionArchive';
import { usePref } from '../ui/hooks';
import './SessionsLayout.css';

type CanvasFilter = 'all' | Workspace;
type QuickMode = 'all' | 'agent' | 'image' | 'video' | 'audio' | 'model3d';
type SessionView = 'cards' | 'list' | 'grid';
const SESSION_VIEWS = [{ id: 'cards', label: 'Cards', hint: 'Title, mode and actions', icon: LayoutList }, { id: 'list', label: 'List', hint: 'One compact row each', icon: List }, { id: 'grid', label: 'Grid', hint: 'Large previews', icon: LayoutGrid }] as const;
const QUICK_MODES = [{ id: 'agent', label: 'Agent', icon: Workflow }, { id: 'image', label: 'Images', icon: Image }, { id: 'video', label: 'Videos', icon: Video }, { id: 'audio', label: 'Audio', icon: Music }, { id: 'model3d', label: '3D', icon: Box }] as const;

const CANVAS: Record<Workspace, { label: string; icon: typeof MessageSquare }> = {
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

type Sort = 'recent' | 'created' | 'name';

function RunningNote({ ids }: { ids: string[] }) {
  const n = useStore((st) => Object.values(st.generations).filter((g) => ids.includes(g.sessionId) && isRunning(g.id)).length);
  if (!n) return null;
  return <p className="muted">{n} generation{n === 1 ? ' is' : 's are'} still running: {n === 1 ? 'it' : 'they'} will finish, any charge is recorded in Spending, and the results are discarded.</p>;
}

/** The confirmation for deleting several sessions at once: shared by the Sessions panel and the top bar's switcher. */
export function DeleteSessionsConfirm({ ids, onCancel, onDone }: { ids: string[]; onCancel: () => void; onDone: () => void }) {
  return (
    <div className="confirm">
      <p>Delete {ids.length} session{ids.length === 1 ? '' : 's'} with their conversations, nodes, designs and assets? Library items are kept.</p>
      <RunningNote ids={ids} />
      <div className="spend-actions">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={() => { ids.forEach((id) => deleteSession(id)); onDone(); }}>
          Delete {ids.length}
        </Button>
      </div>
    </div>
  );
}

export function SessionsPanel() {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeSessionId);
  const assets = useStore((s) => s.assets);
  const generations = useStore((s) => s.generations);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [reversed, setReversed] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [compact, setCompact] = useState(false);
  const [shelf, setShelf] = useState<'recent' | 'archived'>('recent');
  const [quickMode, setQuickMode] = useState<QuickMode>('all');
  const [layout, setLayout] = usePref<SessionView>('ogs.sessionsView', 'cards');
  const [canvas, setCanvas] = useState<CanvasFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selecting = selected.size > 0;
  const bulkDel = usePopover();
  const view = usePopover();
  const layoutMenu = usePopover();
  const newPop = usePopover();
  const { expanded, embedded } = usePanelExpanded();
  const currentView = SESSION_VIEWS.find((item) => item.id === layout) ?? SESSION_VIEWS[0];

  const stats = useMemo(() => {
    const m = new Map<string, Stats>();
    const entry = (id: string) => {
      const e: Stats = m.get(id) ?? { assets: [], gens: 0, spend: 0, modes: new Set() };
      m.set(id, e);
      return e;
    };
    for (const a of Object.values(assets).sort((x, y) => y.createdAt - x.createdAt)) {
      const e = entry(a.sessionId);
      e.assets.push(a.id);
      e.modes.add(a.kind);
      if (!e.cover && (a.kind === 'image' || a.kind === 'video')) e.cover = a.id;
    }
    for (const g of Object.values(generations)) {
      const e = entry(g.sessionId);
      e.gens++;
      if (g.kind !== 'text') e.modes.add(g.kind);
      if (g.mode) e.modes.add(g.mode);
      if (g.origin === 'agent') e.modes.add('agent');
      const mode = g.mode ?? (g.origin === 'agent' ? 'agent' : g.kind === 'text' ? undefined : g.kind);
      if (mode && (!e.latestModeAt || g.createdAt > e.latestModeAt)) { e.latestMode = mode; e.latestModeAt = g.createdAt; }
      if (g.status === 'done') e.spend += g.actualUsd ?? g.estimate.usd ?? 0;
    }
    return m;
  }, [assets, generations]);
  const matches = useSessionMatcher(q);

  const list = useMemo(() => {
    const arr = visibleSessions(sessions).filter((s) => Boolean(s.archived) === (shelf === 'archived') && (!pinnedOnly || s.pinned) && (canvas === 'all' || sessionCanvases(s).includes(canvas)) && (quickMode === 'all' || stats.get(s.id)?.modes.has(quickMode) || s.feed.some((f) => f.type === 'user' && f.mode === quickMode)) && matches(s));
    const dir = reversed ? -1 : 1;
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === 'name') return dir * a.title.localeCompare(b.title);
      if (sort === 'created') return dir * (b.createdAt - a.createdAt);
      return dir * (b.updatedAt - a.updatedAt);
    });
    return arr;
  }, [sessions, matches, sort, reversed, pinnedOnly, canvas, shelf, quickMode, stats]);

  const counts = useMemo(() => {
    const c: Record<CanvasFilter, number> = { all: 0, chat: 0, node: 0, designer: 0 };
    for (const sess of visibleSessions(sessions).filter((s) => Boolean(s.archived) === (shelf === 'archived'))) {
      c.all++;
      for (const w of sessionCanvases(sess)) c[w]++;
    }
    return c;
  }, [sessions, shelf]);
  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const stopSelecting = () => setSelected(new Set());
  const picked = list.filter((x) => selected.has(x.id));
  const allPinned = picked.length > 0 && picked.every((x) => x.pinned);
  const isEmpty = (x: Session) => !x.feed.length && !x.graph.nodes.length && !x.docs.some((d) => d.layers.length) && !stats.get(x.id)?.gens && !stats.get(x.id)?.assets.length;

  // Pinned sessions stay on top as their own group; the rest are grouped by date unless sorted by name.
  const groups = useMemo(() => {
    const pinned = list.filter((s) => s.pinned);
    const rest = list.filter((s) => !s.pinned);
    const dated = sort === 'name' ? [{ label: '', items: rest }] : groupByDate(rest, (s) => (sort === 'created' ? s.createdAt : s.updatedAt));
    return [...(pinned.length ? [{ label: 'Pinned', items: pinned }] : []), ...dated].filter((g) => g.items.length);
  }, [list, sort]);

  return (
    <div role="region" aria-label="Sessions" className={`sessions layout-${layout} ${compact ? 'is-compact' : ''}`}>
      <div className="sessions-controls">
        <div className="sessions-toolbar">
          {embedded ? null : <>
            <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
            <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Collapse' : 'Full view'} size="sm" onClick={() => setUi({ panelExpanded: !expanded })} />
          </>}
          <Button ref={newPop.ref} size="sm" variant="secondary" icon={Plus} onClick={newPop.toggle}>
            New
          </Button>
          <Popover open={newPop.open} anchor={newPop.ref} onClose={newPop.close} width={220} label="New session">
            <div className="new-session-menu">
              {(['chat', 'node', 'designer'] as const).map((w) => {
                const Icon = CANVAS[w].icon;
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => {
                      newPop.close();
                      newSession();
                      setUi({ panel: null, workspace: w, home: false, space: undefined });
                    }}
                  >
                    <Icon size={14} /> {CANVAS[w].label}
                  </button>
                );
              })}
            </div>
          </Popover>
        </div>
        <div className="sessions-filter-bar">
        <div className="search-input">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')}>
              <X size={13} />
            </button>
          ) : null}
        </div>
        <div className="results-controls">
          <button ref={view.ref} type="button" className={`results-menu-trigger${canvas !== 'all' || pinnedOnly || shelf === 'archived' ? ' is-active' : ''}`} onClick={view.toggle} aria-label="Filter by" aria-expanded={view.open}><ListFilter size={14} /><ChevronDown size={12} /></button>
        <Popover open={view.open} anchor={view.ref} onClose={view.close} placement="bottom-start" width={280} className="results-popover" label="Filter by">
          <div className="sessions-view">
            <div className="sv-row">
              <span className="sv-label">Sessions</span>
              <Segmented value={shelf} size="sm" onChange={(value) => { setShelf(value); setSelected(new Set()); }} options={[{ value: 'recent', label: 'Active' }, { value: 'archived', label: `Archived · ${visibleSessions(sessions).filter((s) => s.archived).length}` }]} />
            </div>
            <div className="sv-row">
              <span className="sv-label">Canvas</span>
              <div className="sv-canvas">
                {(['all', 'chat', 'node', 'designer'] as const).map((w) => {
                  const Icon = w === 'all' ? null : CANVAS[w].icon;
                  return (
                    <button key={w} type="button" className={`canvas-tab ${canvas === w ? 'is-on' : ''}`} onClick={() => setCanvas(w)} disabled={w !== 'all' && !counts[w]}>
                      {Icon ? <Icon size={12} /> : null}
                      {w === 'all' ? 'All' : CANVAS[w].label}
                      <span className="num faint">{counts[w]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="sv-switch"><span>Pinned only</span><Toggle checked={pinnedOnly} onChange={setPinnedOnly} label="Pinned only" /></label>
            {list.some(isEmpty) ? (
              <button type="button" className="sv-action" onClick={() => { setSelected(new Set(list.filter(isEmpty).map((x) => x.id))); view.close(); }}>
                Select the {list.filter(isEmpty).length} empty session{list.filter(isEmpty).length === 1 ? '' : 's'}
              </button>
            ) : null}
          </div>
        </Popover>
        <ResultsMenu label="Order by" icon={ArrowUpDown} iconOnly active={sort !== 'recent' || reversed}>
            <div className="sv-row">
              <span className="sv-label">Sort</span>
              <div className="sv-inline">
                <Segmented value={sort} size="sm" onChange={setSort} options={[{ value: 'recent', label: 'Recent' }, { value: 'created', label: 'Created' }, { value: 'name', label: 'Name' }]} />
                <IconButton icon={reversed ? ArrowUp : ArrowDown} label={sortLabel(sort, reversed)} size="sm" onClick={() => setReversed((v) => !v)} />
              </div>
            </div>
        </ResultsMenu>
        <span className="results-controls-spacer" />
          <>
            <button ref={layoutMenu.ref} type="button" className="session-view-trigger" aria-label="View" aria-haspopup="dialog" aria-expanded={layoutMenu.open} onClick={layoutMenu.toggle}>
              <currentView.icon size={14} />{currentView.label}<ChevronDown size={12} />
            </button>
            <Popover open={layoutMenu.open} anchor={layoutMenu.ref} onClose={layoutMenu.close} placement="bottom-start" width={220} label="Session view" className="session-view-popover">
              <div role="radiogroup" aria-label="Session view" className="session-view-options">
                {SESSION_VIEWS.map(({ id, label, hint, icon: Icon }, index) => <button key={id} type="button" role="radio" aria-checked={layout === id} className="session-view-option" onClick={() => { setLayout(id); layoutMenu.close(); }} onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + SESSION_VIEWS.length) % SESSION_VIEWS.length;
                  setLayout(SESSION_VIEWS[next].id);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                }}>
                  <Icon size={15} /><span className="session-view-option-text"><span>{label}</span><span className="session-view-hint">{hint}</span></span>{layout === id ? <Check size={13} className="session-view-check" /> : null}
                </button>)}
              </div>
            </Popover>
          </>
          <div className="sessions-quick-modes" role="group" aria-label="Filter sessions by mode">
            {QUICK_MODES.map(({ id, label, icon: Icon }) => <IconButton key={id} icon={Icon} label={label} size="sm" active={quickMode === id} aria-pressed={quickMode === id} onClick={() => { setQuickMode(quickMode === id ? 'all' : id); setSelected(new Set()); }} />)}
            <button type="button" className={`canvas-tab${quickMode === 'all' ? ' is-on' : ''}`} aria-pressed={quickMode === 'all'} onClick={() => { setQuickMode('all'); setSelected(new Set()); }}>All</button>
          </div>
        <IconButton icon={compact ? EyeOff : Eye} label={compact ? 'Show thumbnails' : 'Hide thumbnails'} size="sm" aria-pressed={!compact} onClick={() => setCompact(!compact)} />
        </div>
        </div>
        {canvas !== 'all' || pinnedOnly ? (
          <div className="sessions-active">
            {canvas !== 'all' ? <button type="button" className="active-chip" onClick={() => setCanvas('all')}>{CANVAS[canvas].label} <X size={11} /></button> : null}
            {pinnedOnly ? <button type="button" className="active-chip" onClick={() => setPinnedOnly(false)}>Pinned <X size={11} /></button> : null}
          </div>
        ) : null}
      </div>
      <div className="sessions-scroll">
        {groups.map((g) => (
          <section key={g.label} className="date-group">
            {g.label ? (
              <h4 className="date-head">
                <button type="button" className={`session-check group-check${g.items.every((s) => selected.has(s.id)) ? ' is-on' : ''}`} role="checkbox" aria-label={`Select ${g.label}`} aria-checked={g.items.every((s) => selected.has(s.id)) ? true : g.items.some((s) => selected.has(s.id)) ? 'mixed' : false} onClick={() => setSelected((current) => {
                  const next = new Set(current);
                  const all = g.items.every((s) => next.has(s.id));
                  for (const item of g.items) { if (all) next.delete(item.id); else next.add(item.id); }
                  return next;
                })}>{g.items.every((s) => selected.has(s.id)) ? <Check size={12} /> : null}</button>
                {g.label} <span className="faint num">{g.items.length}</span>
              </h4>
            ) : null}
            <div className="session-list">
              {g.items.map((s) => (
                <SessionRow key={s.id} session={s} active={s.id === activeId} stats={stats.get(s.id)} expanded={expanded} compact={compact} selecting={selecting} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} />
              ))}
            </div>
          </section>
        ))}
        {!list.length ? <div className="empty-block">No sessions match.</div> : null}
      </div>
      {selecting ? (
        <div className="session-bar">
          <span className="num">{selected.size} selected</span>
          <button type="button" className="sb-link" onClick={() => setSelected(new Set(list.map((x) => x.id)))}>Select all</button>
          <span className="spacer" />
          <IconButton icon={allPinned ? PinOff : Pin} label={allPinned ? 'Unpin' : 'Pin'} size="sm" onClick={() => picked.forEach((x) => { if (x.pinned === allPinned) togglePinSession(x.id); })} />
          <IconButton icon={shelf === 'archived' ? ArchiveRestore : Archive} label={shelf === 'archived' ? 'Restore selected' : 'Archive selected'} size="sm" onClick={() => { setSessionsArchived(picked.map((x) => x.id), shelf === 'recent'); stopSelecting(); }} />
          <IconButton ref={bulkDel.ref} icon={Trash} label="Delete" size="sm" tone="danger" onClick={bulkDel.toggle} />
          <IconButton icon={X} label="Cancel selection" size="sm" onClick={stopSelecting} />
          <Popover open={bulkDel.open} anchor={bulkDel.ref} onClose={bulkDel.close} width={300} label="Delete sessions">
            <DeleteSessionsConfirm ids={picked.map((x) => x.id)} onCancel={bulkDel.close} onDone={() => { bulkDel.close(); stopSelecting(); }} />
          </Popover>
        </div>
      ) : null}
    </div>
  );
}

interface Stats {
  assets: string[];
  gens: number;
  spend: number;
  cover?: string;
  modes: Set<Exclude<QuickMode, 'all'>>;
  latestMode?: Exclude<QuickMode, 'all'>;
  latestModeAt?: number;
}

/** Session search shared by the panel and the top-bar switcher: title, conversation text and generation prompts. */
export function useSessionMatcher(query: string): (s: Session) => boolean {
  const generations = useStore((s) => s.generations);
  const prompts = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of Object.values(generations)) m.set(g.sessionId, `${m.get(g.sessionId) ?? ''} ${g.prompt ?? ''}`.toLowerCase());
    return m;
  }, [generations]);
  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return () => true;
    return (s: Session) =>
      s.title.toLowerCase().includes(needle) ||
      s.feed.some((f) => 'text' in f && typeof f.text === 'string' && f.text.toLowerCase().includes(needle)) ||
      (prompts.get(s.id)?.includes(needle) ?? false);
  }, [query, prompts]);
}

function sortLabel(sort: Sort, reversed: boolean): string {
  if (sort === 'name') return reversed ? 'Z → A' : 'A → Z';
  return reversed ? 'Oldest first' : 'Newest first';
}

function SessionRow({ session, active, stats, expanded, compact, selecting, selected, onToggle }: { session: Session; active: boolean; stats?: Stats; expanded: boolean; compact: boolean; selecting: boolean; selected: boolean; onToggle: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const del = usePopover();
  const docs = session.docs.length;
  const nodes = session.graph.nodes.length;
  const meta = [
    formatRelative(session.updatedAt),
    stats?.gens ? `${stats.gens} gen` : null,
    nodes ? `${nodes} nodes` : null,
    docs ? `${docs} design${docs === 1 ? '' : 's'}` : null,
    stats?.spend ? formatUsd(stats.spend) : null,
  ].filter(Boolean);
  const canvases = sessionCanvases(session);
  const CoverIcon = CANVAS[canvases[0] ?? 'chat'].icon;
  const latestPrompt = session.feed.reduce<(typeof session.feed)[number] | undefined>((latest, item) => item.type === 'user' && (!latest || item.createdAt > latest.createdAt) ? item : latest, undefined);
  const latestPromptMode = latestPrompt?.type === 'user' ? latestPrompt.mode : undefined;
  const recentMode = stats?.latestModeAt && stats.latestModeAt > (latestPrompt?.createdAt ?? 0) ? stats.latestMode : latestPromptMode ?? stats?.latestMode;
  const modeInfo = QUICK_MODES.find((mode) => mode.id === recentMode);
  const ModeIcon = modeInfo?.icon;
  const modeLabel = recentMode ? { agent: 'Agent', image: 'Image', video: 'Video', audio: 'Audio', model3d: '3D' }[recentMode] : undefined;
  const shortDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const open = () => {
    if (selecting) return onToggle();
    if (editing) return;
    if (session.archived) setSessionsArchived([session.id], false);
    selectSession(session.id);
    setUi({ panel: null, home: false, space: undefined });
  };

  return (
    <div className={`session-row ${active ? 'is-active' : ''} ${selecting ? 'is-selecting' : ''} ${selected ? 'is-selected' : ''}`}>
      <button type="button" className={`session-check ${selected ? 'is-on' : ''}`} onClick={onToggle} aria-pressed={selected} aria-label={`Select ${session.title}`}>
        {selected ? <Check size={12} /> : null}
      </button>
      <span className={`session-cover${stats?.cover && !compact ? ' has-media' : ''}`} aria-hidden="true">
        {stats?.cover && !compact ? <span className="session-cover-media"><AssetMedia assetId={stats.cover} hoverPlay={false} draggable={false} /></span> : null}
        <CoverIcon size={18} className="session-cover-icon" />
      </span>
      <div
        role="button"
        tabIndex={0}
        className="session-main"
        onClick={open}
        onKeyDown={(e) => {
          if (!editing && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            open();
          }
        }}
        onDoubleClick={() => !selecting && setEditing(true)}
      >
        {editing ? (
          <input
            autoFocus
            className="title-input"
            value={draft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              renameSession(session.id, draft);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setDraft(session.title);
                setEditing(false);
              }
            }}
            aria-label="Session title"
          />
        ) : (
          <span className="session-title" title={session.title}>
            {session.pinned ? <Pin size={11} className="pin-mark" /> : null}
            <span className="truncate">{session.title}</span>
            {active ? <span className="session-open">Open</span> : null}
          </span>
        )}
        <span className="session-meta faint num">
          {canvases.length ? (
            <span className="session-canvases" aria-label={canvases.map((w) => CANVAS[w].label).join(', ')}>
              {canvases.map((w) => {
                const Icon = CANVAS[w].icon;
                return <span key={w} className="session-canvas" data-tip={CANVAS[w].label}><Icon size={10} /></span>;
              })}
            </span>
          ) : null}
          {meta.length > 1 || session.feed.length || stats?.assets.length ? meta.join(' · ') : `${meta[0]} · empty`}
        </span>
        <span className="session-card-meta" title={[modeLabel ? `Last mode: ${modeLabel}` : 'No recorded mode', ...meta.slice(1)].join(' · ')}>
          {ModeIcon ? <ModeIcon size={11} /> : null}
          <span>{modeLabel ?? '—'}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(session.updatedAt).toISOString()} title={`Updated: ${new Date(session.updatedAt).toLocaleString()}`}>{shortDate(session.updatedAt)}</time>
          {active ? <span className="session-card-open">· Open</span> : null}
        </span>
        <span className="session-list-meta">
          <span className="session-list-mode" title={[modeLabel ? `Last mode: ${modeLabel}` : 'No recorded mode', ...meta.slice(1)].join(' · ')}>{ModeIcon ? <ModeIcon size={11} /> : null}{modeLabel ?? '—'}</span>
          <time className="session-list-created" dateTime={new Date(session.createdAt).toISOString()} title={`Created: ${new Date(session.createdAt).toLocaleString()}`}>{shortDate(session.createdAt)}</time>
          <time className="session-list-updated" dateTime={new Date(session.updatedAt).toISOString()} title={`Updated: ${new Date(session.updatedAt).toLocaleString()}`}>{shortDate(session.updatedAt)}</time>
        </span>
      </div>
      {!expanded && !compact && stats?.assets.length ? (
        <span className="session-thumbs">
          {stats.assets.slice(0, 3).map((id) => (
            <span key={id} className="session-thumb">
              <AssetMedia assetId={id} hoverPlay={false} draggable={false} />
            </span>
          ))}
        </span>
      ) : null}
      <div className={`session-actions ${selecting ? 'is-hidden' : ''}`}>
        <IconButton icon={session.pinned ? PinOff : Pin} label={session.pinned ? 'Unpin' : 'Pin'} size="sm" onClick={() => togglePinSession(session.id)} />
        <IconButton
          icon={Pencil}
          label="Rename"
          size="sm"
          onClick={() => {
            setDraft(session.title);
            setEditing(true);
          }}
        />
        <IconButton icon={session.archived ? ArchiveRestore : Archive} label={session.archived ? 'Restore session' : 'Archive session'} size="sm" onClick={() => setSessionsArchived([session.id], !session.archived)} />
        <IconButton ref={del.ref} icon={Trash} label="Delete" size="sm" tone="danger" onClick={del.toggle} />
        <Popover open={del.open} anchor={del.ref} onClose={del.close} width={280} label="Delete session">
          <div className="confirm">
            <p>Delete “{session.title}” with its conversation, nodes, designs and assets?</p>
            <RunningNote ids={[session.id]} />
            <div className="spend-actions">
              <Button variant="ghost" onClick={del.close}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  del.close();
                  deleteSession(session.id);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </Popover>
      </div>
    </div>
  );
}
