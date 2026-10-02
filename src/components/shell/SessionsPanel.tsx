import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Maximize2, MessageSquare, Minimize2, Pencil, PenTool, Pin, PinOff, Plus, Search, SlidersHorizontal, Trash, Workflow, X } from 'lucide-react';
import { newSession, renameSession, selectSession, setUi, togglePinSession, useStore } from '../../store/store';
import { deleteSession } from '../../engine/actions';
import { formatRelative, formatUsd, groupByDate } from '../../lib/format';
import { Button, IconButton, Segmented, Toggle } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { AssetMedia } from '../ui/AssetMedia';
import type { Session, Workspace } from '../../engine/types';

type CanvasFilter = 'all' | Workspace;

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
  const [canvas, setCanvas] = useState<CanvasFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const selecting = selected.size > 0;
  const bulkDel = usePopover();
  const view = usePopover();
  const expanded = useStore((s) => s.ui.panelExpanded);

  const stats = useMemo(() => {
    const m = new Map<string, Stats>();
    const entry = (id: string) => {
      const e = m.get(id) ?? { assets: [], gens: 0, spend: 0 };
      m.set(id, e);
      return e;
    };
    for (const a of Object.values(assets).sort((x, y) => y.createdAt - x.createdAt)) entry(a.sessionId).assets.push(a.id);
    for (const g of Object.values(generations)) {
      const e = entry(g.sessionId);
      e.gens++;
      if (g.status === 'done') e.spend += g.actualUsd ?? g.estimate.usd ?? 0;
    }
    return m;
  }, [assets, generations]);
  const matches = useSessionMatcher(q);

  const list = useMemo(() => {
    const arr = Object.values(sessions).filter((s) => (!pinnedOnly || s.pinned) && (canvas === 'all' || sessionCanvases(s).includes(canvas)) && matches(s));
    const dir = reversed ? -1 : 1;
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === 'name') return dir * a.title.localeCompare(b.title);
      if (sort === 'created') return dir * (b.createdAt - a.createdAt);
      return dir * (b.updatedAt - a.updatedAt);
    });
    return arr;
  }, [sessions, matches, sort, reversed, pinnedOnly, canvas]);

  const counts = useMemo(() => {
    const c: Record<CanvasFilter, number> = { all: 0, chat: 0, node: 0, designer: 0 };
    for (const sess of Object.values(sessions)) {
      c.all++;
      for (const w of sessionCanvases(sess)) c[w]++;
    }
    return c;
  }, [sessions]);
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
    <div className={`sessions ${compact ? 'is-compact' : ''}`}>
      <div className="panel-head">
        <div className="panel-title">
          Sessions <span className="faint num">{Object.keys(sessions).length}</span>
        </div>
        <div className="panel-head-actions">
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            onClick={() => {
              newSession();
              setUi({ panel: null });
            }}
          >
            New
          </Button>
          <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Collapse' : 'Full view'} size="sm" onClick={() => setUi({ panelExpanded: !expanded })} />
          <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
        </div>
      </div>
      <div className="sessions-controls">
        <div className="search-input">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')}>
              <X size={13} />
            </button>
          ) : null}
          <button ref={view.ref} type="button" className={`search-view ${view.open ? 'is-open' : ''}`} onClick={view.toggle} aria-label="Filter, sort and view" data-tip="Filter, sort and view">
            <SlidersHorizontal size={14} />
            {canvas !== 'all' || pinnedOnly || sort !== 'recent' || reversed ? <span className="dot" /> : null}
          </button>
        </div>
        <Popover open={view.open} anchor={view.ref} onClose={view.close} width={300} label="Filter, sort and view">
          <div className="sessions-view">
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
            <div className="sv-row">
              <span className="sv-label">Sort</span>
              <div className="sv-inline">
                <Segmented value={sort} size="sm" onChange={setSort} options={[{ value: 'recent', label: 'Recent' }, { value: 'created', label: 'Created' }, { value: 'name', label: 'Name' }]} />
                <IconButton icon={reversed ? ArrowUp : ArrowDown} label={sortLabel(sort, reversed)} size="sm" onClick={() => setReversed((v) => !v)} />
              </div>
            </div>
            <label className="sv-switch"><span>Pinned only</span><Toggle checked={pinnedOnly} onChange={setPinnedOnly} label="Pinned only" /></label>
            <label className="sv-switch"><span>Thumbnails</span><Toggle checked={!compact} onChange={(v) => setCompact(!v)} label="Thumbnails" /></label>
            {list.some(isEmpty) ? (
              <button type="button" className="sv-action" onClick={() => { setSelected(new Set(list.filter(isEmpty).map((x) => x.id))); view.close(); }}>
                Select the {list.filter(isEmpty).length} empty session{list.filter(isEmpty).length === 1 ? '' : 's'}
              </button>
            ) : null}
          </div>
        </Popover>
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
                {g.label} <span className="faint num">{g.items.length}</span>
              </h4>
            ) : null}
            <div className="session-list">
              {g.items.map((s) => (
                <SessionRow key={s.id} session={s} active={s.id === activeId} stats={stats.get(s.id)} selecting={selecting} selected={selected.has(s.id)} onToggle={() => toggle(s.id)} />
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
          <IconButton ref={bulkDel.ref} icon={Trash} label="Delete" size="sm" tone="danger" onClick={bulkDel.toggle} />
          <IconButton icon={X} label="Cancel selection" size="sm" onClick={stopSelecting} />
          <Popover open={bulkDel.open} anchor={bulkDel.ref} onClose={bulkDel.close} width={300} label="Delete sessions">
            <div className="confirm">
              <p>Delete {picked.length} session{picked.length === 1 ? '' : 's'} with their conversations, nodes, designs and assets? Library items are kept.</p>
              <div className="spend-actions">
                <Button variant="ghost" onClick={bulkDel.close}>Cancel</Button>
                <Button variant="danger" onClick={() => { bulkDel.close(); picked.forEach((x) => deleteSession(x.id)); stopSelecting(); }}>
                  Delete {picked.length}
                </Button>
              </div>
            </div>
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

function SessionRow({ session, active, stats, selecting, selected, onToggle }: { session: Session; active: boolean; stats?: Stats; selecting: boolean; selected: boolean; onToggle: () => void }) {
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
  const open = () => {
    if (selecting) return onToggle();
    if (editing) return;
    selectSession(session.id);
    setUi({ panel: null });
  };

  return (
    <div className={`session-row ${active ? 'is-active' : ''} ${selecting ? 'is-selecting' : ''} ${selected ? 'is-selected' : ''}`}>
      <button type="button" className={`session-check ${selected ? 'is-on' : ''}`} onClick={onToggle} aria-pressed={selected} aria-label={`Select ${session.title}`}>
        {selected ? <Check size={12} /> : null}
      </button>
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
      </div>
      {stats?.assets.length ? (
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
        <IconButton ref={del.ref} icon={Trash} label="Delete" size="sm" tone="danger" onClick={del.toggle} />
        <Popover open={del.open} anchor={del.ref} onClose={del.close} width={280} label="Delete session">
          <div className="confirm">
            <p>Delete “{session.title}” with its conversation, nodes, designs and assets?</p>
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
