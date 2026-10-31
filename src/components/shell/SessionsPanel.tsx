import { useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Check, Eye, EyeOff, Grid2X2, LayoutGrid, Maximize2, Minimize2, Pin, PinOff, Plus, Trash, X } from 'lucide-react';
import { newSession, setUi, togglePinSession, useStore } from '../../store/store';
import { deleteSession } from '../../engine/actions';
import { groupByDate } from '../../lib/format';
import { Button, IconButton, Segmented } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import type { Session, Workspace } from '../../engine/types';
import { usePanelExpanded } from './panelEmbed';
import { visibleSessions } from '../../store/spaceSession';
import { setSessionsArchived } from '../../store/sessionArchive';
import { setUserHidden } from '../../store/userHidden';
import { usePref } from '../ui/hooks';
import { GridSizeSlider, LayoutSegmented, PanelPopover, SearchToggle, SortSegmented, SourceSelect, asItemView, type RailItem } from '../ui/PanelControls';
import { ListHeader, widthVars, type ColumnWidths } from '../gallery/ListColumns';
import { CANVAS, QUICK_MODES, RunningNote, SESSION_HEADS, SessionRow, sessionCanvases, sessionMode, type QuickMode, type SessionSortKey, type Stats } from './SessionRow';
import './SessionsLayout.css';

export { sessionCanvases };
type CanvasFilter = 'all' | Workspace;
/** Canvas sources of the selector; the chat workspace is the Studio. */
const SOURCES: RailItem<CanvasFilter>[] = [{ id: 'all', label: 'All', icon: Grid2X2 }, { id: 'chat', label: 'Studio', icon: CANVAS.chat.icon }, { id: 'node', label: 'Nodes', icon: CANVAS.node.icon }, { id: 'designer', label: 'Designer', icon: CANVAS.designer.icon }];

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
  const [sort, setSort] = useState<{ by: SessionSortKey; asc: boolean }>({ by: 'date', asc: false });
  const [colWidths, setColWidths] = usePref<ColumnWidths>('ogs.sessionsColumns', {});
  const [basis, setBasis] = useState<'updated' | 'created'>('updated');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [shelf, setShelf] = useState<'recent' | 'archived'>('recent');
  const [quickMode, setQuickMode] = useState<QuickMode>('all');
  const [storedView, setLayout] = usePref<string>('ogs.sessionsView', 'card');
  const layout = asItemView(storedView);
  const [cols, setCols] = useState(3);
  const [canvas, setCanvas] = useState<CanvasFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selecting = selected.size > 0;
  const bulkDel = usePopover();
  const newPop = usePopover();
  const { expanded, embedded } = usePanelExpanded();
  useEffect(() => setCols((c) => (expanded ? Math.max(c, 5) : Math.min(c, 4))), [expanded]);

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
    const arr = visibleSessions(sessions).filter((s) => Boolean(s.archived) === (shelf === 'archived') && (!pinnedOnly || s.pinned) && (showHidden || !s.userHidden) && (canvas === 'all' || sessionCanvases(s).includes(canvas)) && (quickMode === 'all' || stats.get(s.id)?.modes.has(quickMode) || s.feed.some((f) => f.type === 'user' && f.mode === quickMode)) && matches(s));
    const dir = sort.asc ? 1 : -1;
    const stamp = (x: Session) => (basis === 'created' ? x.createdAt : x.updatedAt);
    // Columns compare by value; sessions without one (no mode, no spend…) always go last.
    const value = (x: Session): number | string | undefined => {
      const st = stats.get(x.id);
      switch (sort.by) {
        case 'mode': return sessionMode(x, st);
        case 'gens': return st?.gens || undefined;
        case 'nodes': return x.graph.nodes.length || undefined;
        case 'designs': return x.docs.length || undefined;
        case 'spend': return st?.spend || undefined;
        default: return undefined;
      }
    };
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort.by === 'name') return dir * a.title.localeCompare(b.title);
      if (sort.by === 'date') return dir * (stamp(a) - stamp(b));
      const x = value(a);
      const y = value(b);
      if ((x === undefined) !== (y === undefined)) return x === undefined ? 1 : -1;
      if (x === undefined || y === undefined) return dir * (stamp(a) - stamp(b));
      return dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
    });
    return arr;
  }, [sessions, matches, sort, basis, showHidden, pinnedOnly, canvas, shelf, quickMode, stats]);

  const hiddenCount = useMemo(() => visibleSessions(sessions).filter((s) => s.userHidden).length, [sessions]);
  const archivedCount = useMemo(() => visibleSessions(sessions).filter((s) => s.archived).length, [sessions]);
  const counts = useMemo(() => {
    const c: Record<CanvasFilter, number> = { all: 0, chat: 0, node: 0, designer: 0 };
    for (const sess of visibleSessions(sessions).filter((s) => Boolean(s.archived) === (shelf === 'archived') && (showHidden || !s.userHidden))) {
      c.all++;
      for (const w of sessionCanvases(sess)) c[w]++;
    }
    return c;
  }, [sessions, shelf, showHidden]);
  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const stopSelecting = () => setSelected(new Set());
  const picked = list.filter((x) => selected.has(x.id));
  const allHidden = picked.length > 0 && picked.every((x) => x.userHidden);
  const allPinned = picked.length > 0 && picked.every((x) => x.pinned);
  const isEmpty = (x: Session) => !x.feed.length && !x.graph.nodes.length && !x.docs.some((d) => d.layers.length) && !stats.get(x.id)?.gens && !stats.get(x.id)?.assets.length;

  // Pinned sessions stay on top as their own group; the rest are grouped by date when sorted by date.
  const groups = useMemo(() => {
    const pinned = list.filter((s) => s.pinned);
    const rest = list.filter((s) => !s.pinned);
    const dated = sort.by !== 'date' ? [{ label: '', items: rest }] : groupByDate(rest, (s) => (basis === 'created' ? s.createdAt : s.updatedAt));
    return [...(pinned.length ? [{ label: 'Pinned', items: pinned }] : []), ...dated].filter((g) => g.items.length);
  }, [list, sort, basis]);

  const clear = () => setSelected(new Set());
  const shelfToggles = <>
    <IconButton icon={showHidden ? Eye : EyeOff} label={`Show hidden · ${hiddenCount}`} size="sm" active={showHidden} aria-pressed={showHidden} onClick={() => { setShowHidden(!showHidden); clear(); }} />
    <IconButton icon={Archive} label={`Show archived · ${archivedCount}`} size="sm" active={shelf === 'archived'} aria-pressed={shelf === 'archived'} onClick={() => { setShelf(shelf === 'archived' ? 'recent' : 'archived'); clear(); }} />
  </>;
  const empties = list.filter(isEmpty);

  return (
    <div role="region" aria-label="Sessions" className={`sessions layout-${layout}`}>
      <div className="sessions-controls">
        <div className="sessions-filter-bar pc-bar">
        <div className="pc-grp pc-left">
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
          <SourceSelect items={SOURCES.map((r) => ({ ...r, count: counts[r.id] }))} value={canvas} onChange={(v) => { setCanvas(v); setSelected(new Set()); }} label="Session canvas" separatorAfter="all" allLabel="Sessions" />
          <div className="pc-icons">
            <PanelPopover icon={LayoutGrid} label="View">{(close) => <>
              <div className="sv-row"><span className="sv-label">Layout</span><LayoutSegmented value={layout} onChange={setLayout} /></div>
              <div className="sv-row"><span className="sv-label">Sort</span><SortSegmented sort={sort} onChange={setSort} /></div>
              <div className="sv-row">
                <span className="sv-label">Date means</span>
                <Segmented value={basis} size="sm" onChange={setBasis} options={[{ value: 'updated', label: 'Last activity' }, { value: 'created', label: 'Created' }]} />
              </div>
              {layout === 'card' ? <div className="sv-row"><span className="sv-label">Grid size</span><GridSizeSlider cols={cols} setCols={setCols} expanded={expanded} /></div> : null}
              {empties.length ? (
                <button type="button" className="sv-action" onClick={() => { setSelected(new Set(empties.map((x) => x.id))); close(); }}>
                  Select the {empties.length} empty session{empties.length === 1 ? '' : 's'}
                </button>
              ) : null}
            </>}</PanelPopover>
            <SearchToggle value={q} onChange={setQ} placeholder="Search sessions" inputLabel="Search sessions" hint={`${list.length} session${list.length === 1 ? '' : 's'}`} />
          </div>
        </div>
        <div className="pc-grp pc-right">
          <div className="pc-grp pc-center" role="group" aria-label="Filter sessions by mode">
            {QUICK_MODES.map(({ id, label, icon: Icon }) => <IconButton key={id} icon={Icon} label={label} size="sm" active={quickMode === id} aria-pressed={quickMode === id} onClick={() => { setQuickMode(quickMode === id ? 'all' : id); setSelected(new Set()); }} />)}
            <button type="button" className={`canvas-tab${quickMode === 'all' ? ' is-on' : ''}`} aria-pressed={quickMode === 'all'} onClick={() => { setQuickMode('all'); setSelected(new Set()); }}>All</button>
          </div>
          <div className="pc-flags"><IconButton icon={Pin} label="Pinned only" size="sm" active={pinnedOnly} aria-pressed={pinnedOnly} onClick={() => setPinnedOnly(!pinnedOnly)} /></div>
          {embedded ? null : <div className="pc-chrome">
            <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Collapse' : 'Full view'} size="sm" onClick={() => setUi({ panelExpanded: !expanded })} />
            <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
          </div>}
        </div>
        </div>
        {pinnedOnly ? (
          <div className="sessions-active">
            {pinnedOnly ? <button type="button" className="active-chip" onClick={() => setPinnedOnly(false)}>Pinned <X size={11} /></button> : null}
          </div>
        ) : null}
      </div>
      <div className="pc-split">
      <div className="pc-main">
      <div className="sessions-scroll" data-col-scope style={layout === 'list' ? widthVars(colWidths) : undefined}>
        {layout === 'list' ? <ListHeader heads={SESSION_HEADS} sort={sort} onSort={setSort} widths={colWidths} onResize={setColWidths} end={shelfToggles} /> : <ListHeader heads={SESSION_HEADS} sort={sort} onSort={setSort} strip end={shelfToggles} />}
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
            <div className={`session-list${layout === 'list' ? ' pc-cols' : ''}`} style={{ ['--cols' as string]: cols }}>
              {g.items.map((s) => (
                <SessionRow key={s.id} session={s} active={s.id === activeId} stats={stats.get(s.id)} view={layout} basis={basis} selecting={selecting} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} />
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
          <IconButton icon={allHidden ? Eye : EyeOff} label={allHidden ? 'Unhide' : 'Hide'} size="sm" onClick={() => { setUserHidden('session', picked.map((x) => x.id), !allHidden); stopSelecting(); }} />
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
      </div>
    </div>
  );
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
