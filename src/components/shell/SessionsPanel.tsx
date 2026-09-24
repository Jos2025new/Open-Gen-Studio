import { useMemo, useState } from 'react';
import { Pencil, Pin, PinOff, Plus, Search, Trash, X } from 'lucide-react';
import { newSession, renameSession, selectSession, setUi, togglePinSession, useStore } from '../../store/store';
import { deleteSession } from '../../engine/actions';
import { formatRelative, formatUsd } from '../../lib/format';
import { Button, IconButton, Segmented } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { AssetMedia } from '../ui/AssetMedia';
import type { Session } from '../../engine/types';

type Sort = 'recent' | 'created' | 'name';

export function SessionsPanel() {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeSessionId);
  const assets = useStore((s) => s.assets);
  const generations = useStore((s) => s.generations);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');

  const stats = useMemo(() => {
    const m = new Map<string, { assets: string[]; gens: number; spend: number }>();
    for (const a of Object.values(assets).sort((x, y) => y.createdAt - x.createdAt)) {
      const e = m.get(a.sessionId) ?? { assets: [], gens: 0, spend: 0 };
      e.assets.push(a.id);
      m.set(a.sessionId, e);
    }
    for (const g of Object.values(generations)) {
      const e = m.get(g.sessionId) ?? { assets: [], gens: 0, spend: 0 };
      e.gens++;
      if (g.status === 'done') e.spend += g.actualUsd ?? g.estimate.usd ?? 0;
      m.set(g.sessionId, e);
    }
    return m;
  }, [assets, generations]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const arr = Object.values(sessions).filter((s) => !needle || s.title.toLowerCase().includes(needle));
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === 'name') return a.title.localeCompare(b.title);
      if (sort === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
    return arr;
  }, [sessions, q, sort]);

  return (
    <div className="sessions">
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
          <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
        </div>
      </div>
      <div className="gallery-controls">
        <div className="search-input">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" />
        </div>
        <Segmented
          value={sort}
          size="sm"
          onChange={setSort}
          options={[
            { value: 'recent', label: 'Recent' },
            { value: 'created', label: 'Created' },
            { value: 'name', label: 'Name' },
          ]}
        />
      </div>
      <div className="sessions-scroll">
        {list.map((s) => (
          <SessionRow key={s.id} session={s} active={s.id === activeId} stats={stats.get(s.id)} />
        ))}
        {!list.length ? <div className="empty-block">No sessions match.</div> : null}
      </div>
    </div>
  );
}

function SessionRow({ session, active, stats }: { session: Session; active: boolean; stats?: { assets: string[]; gens: number; spend: number } }) {
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

  return (
    <div className={`session-row ${active ? 'is-active' : ''}`}>
      <div
        role="button"
        tabIndex={0}
        className="session-main"
        onClick={() => {
          if (editing) return;
          selectSession(session.id);
          setUi({ panel: null });
        }}
        onKeyDown={(e) => {
          if (!editing && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            selectSession(session.id);
            setUi({ panel: null });
          }
        }}
        onDoubleClick={() => setEditing(true)}
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
          <span className="session-title">
            {session.pinned ? <Pin size={11} className="pin-mark" /> : null}
            {session.title}
          </span>
        )}
        <span className="session-meta faint num">{meta.join(' · ')}</span>
        {stats?.assets.length ? (
          <span className="session-thumbs">
            {stats.assets.slice(0, 4).map((id) => (
              <span key={id} className="session-thumb">
                <AssetMedia assetId={id} hoverPlay={false} draggable={false} />
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <div className="session-actions">
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
