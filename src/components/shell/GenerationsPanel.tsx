import { useMemo, useState } from 'react';
import { Box, CornerDownRight, FileText, Film, Image as ImageIcon, Music, Search, X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { formatDateTime, formatUsd } from '../../lib/format';
import type { Generation } from '../../engine/types';
import { generationTitle } from '../assets/GenerationInfo';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, usePopover } from '../ui/Popover';
import { Button, IconButton, Segmented } from '../ui/primitives';
import { generationPlace, goToGeneration } from '../../engine/goTo';

type Sort = 'newest' | 'oldest' | 'cost';
type Kind = 'all' | Generation['kind'];
type Status = 'all' | 'done' | 'error' | 'running';

const KINDS: Array<{ id: Kind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'model3d', label: '3D' },
  { id: 'text', label: 'Text' },
];
const STATUSES: Array<{ id: Status; label: string }> = [
  { id: 'all', label: 'Any status' },
  { id: 'done', label: 'Done' },
  { id: 'error', label: 'Failed' },
  { id: 'running', label: 'Running' },
];
const CANVAS = { chat: 'Chat', node: 'Nodes', designer: 'Designer' } as const;
const KIND_ICON = { image: ImageIcon, video: Film, audio: Music, model3d: Box, text: FileText } as const;
const statusOf = (g: Generation): Status => (g.status === 'done' ? 'done' : g.status === 'error' || g.status === 'canceled' ? 'error' : 'running');
const STATUS_LABEL: Record<Generation['status'], string> = { done: 'Done', running: 'Generating', queued: 'Queued', error: 'Failed', canceled: 'Canceled' };

/**
 * Every generation as a record: what it was, where and when, what it cost. Filters stay in sight (scope, type,
 * status); from here you go to where it was made — retrying happens there, not in this list.
 */
export function GenerationsPanel({ onClose }: { onClose: () => void }) {
  const generations = useStore((s) => s.generations);
  const sessionId = useStore((s) => s.activeSessionId);
  const [scope, setScope] = useState<'session' | 'all'>('session');
  const [kind, setKind] = useState<Kind>('all');
  const [status, setStatus] = useState<Status>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [view, setView] = useState<'thumbs' | 'list'>('thumbs');
  const scoped = useMemo(() => Object.values(generations).filter((g) => scope === 'all' || g.sessionId === sessionId), [generations, scope, sessionId]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cost = (g: Generation) => g.actualUsd ?? g.estimate.usd;
    return scoped
      .filter((g) => kind === 'all' || g.kind === kind)
      .filter((g) => status === 'all' || statusOf(g) === status)
      .filter((g) => !needle || `${generationTitle(g)} ${g.modelName} ${PROVIDER_LABELS[g.provider]}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (sort === 'cost') {
          const ac = cost(a), bc = cost(b);
          if (ac == null && bc != null) return 1;
          if (bc == null && ac != null) return -1;
          if (ac != null && bc != null && ac !== bc) return bc - ac;
        }
        return sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
      });
  }, [scoped, kind, status, q, sort]);
  const count = (k: Kind) => scoped.filter((g) => k === 'all' || g.kind === k).length;

  return (
    <div className={`generations-panel ${view === 'list' ? 'is-compact' : ''}`}>
      <div className="panel-head">
        <div className="panel-title">Generations <span className="faint num">{list.length}</span></div>
        <IconButton icon={X} label="Close generations" size="sm" onClick={onClose} />
      </div>
      <div className="gallery-controls gen-filters">
        <div className="search-input">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, models, providers" aria-label="Search generations" />
          {q ? <IconButton icon={X} label="Clear search" size="sm" onClick={() => setQ('')} /> : null}
        </div>
        <div className="gen-filter-row">
          <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: 'session', label: 'This session' }, { value: 'all', label: 'All sessions' }]} />
          <span className="gen-filter-gap" />
          <select className="gen-sort" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="cost">Highest cost</option>
          </select>
          <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'thumbs', label: 'Thumbnails' }, { value: 'list', label: 'List' }]} />
        </div>
        <div className="gen-chips" role="group" aria-label="Type">
          {KINDS.filter((k) => k.id === 'all' || count(k.id)).map((k) => (
            <button key={k.id} type="button" className={`gen-chip ${kind === k.id ? 'is-on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label} <span className="num">{count(k.id)}</span>
            </button>
          ))}
        </div>
        <div className="gen-chips" role="group" aria-label="Status">
          {STATUSES.map((s) => (
            <button key={s.id} type="button" className={`gen-chip ${status === s.id ? 'is-on' : ''} ${s.id === 'error' ? 'is-error' : ''}`} aria-pressed={status === s.id} onClick={() => setStatus(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="generations-list">
        {list.map((g) => <GenerationRow key={g.id} g={g} thumbs={view === 'thumbs'} showSession={scope === 'all'} onGo={onClose} />)}
        {!list.length ? <div className="empty-block">No generations match.</div> : null}
      </div>
    </div>
  );
}

function GenerationRow({ g, thumbs, showSession, onGo }: { g: Generation; thumbs: boolean; showSession: boolean; onGo: () => void }) {
  const jump = usePopover();
  const place = generationPlace(g);
  const sessions = useStore((s) => s.sessions);
  const asset = g.assetIds[0];
  const cost = g.actualUsd ?? g.estimate.usd;
  const Icon = KIND_ICON[g.kind] ?? ImageIcon;
  return (
    <div className={`gen-row status-${statusOf(g)}`}>
      {thumbs && asset ? (
        <button type="button" className="gen-row-thumb" aria-label="Open" onClick={() => setUi({ lightbox: { assetIds: g.assetIds, index: 0 } })}>
          <AssetMedia assetId={asset} hoverPlay={false} />
          {g.assetIds.length > 1 ? <span className="gen-row-count num">{g.assetIds.length}</span> : null}
        </button>
      ) : thumbs ? (
        <span className="gen-row-thumb is-empty" aria-hidden="true"><Icon size={18} /></span>
      ) : null}
      <div className="gen-row-body">
        <div className="gen-row-title" title={generationTitle(g)}>{generationTitle(g)}</div>
        <div className="gen-row-meta faint">
          <span className={`gen-row-status status-${statusOf(g)}`}>{STATUS_LABEL[g.status]}</span>
          <span>{g.modelName} · {PROVIDER_LABELS[g.provider]}</span>
          <span className="num">{formatDateTime(g.createdAt)}</span>
          {place ? <span>{CANVAS[place.canvas]}{showSession ? ` · ${sessions[place.sessionId]?.title ?? ''}` : ''}</span> : null}
          {cost != null ? <span className="num">{g.actualUsd == null ? '≈' : ''}{formatUsd(cost)}</span> : null}
        </div>
        {g.status === 'error' && g.error ? <div className="gen-row-error" title={g.error}>{g.error}</div> : null}
      </div>
      {place ? (
        <>
          <Button ref={jump.ref} size="sm" variant="ghost" icon={CornerDownRight} className="gen-row-go" onClick={jump.toggle}>Go to</Button>
          <Popover open={jump.open} anchor={jump.ref} onClose={jump.close} width={260} label="Go to generation">
            <div className="confirm-pop">
              <p>
                Go to where this was made: <strong>{CANVAS[place.canvas]}</strong>
                {place.sessionId !== useStore.getState().activeSessionId ? <> in <strong>{place.sessionTitle}</strong></> : null}
                {place.target.kind === 'node' ? ', its node' : place.target.kind === 'layer' ? ', its layer' : place.target.kind === 'card' ? ', its card' : ''}?
              </p>
              <div className="confirm-pop-actions">
                <Button size="sm" variant="ghost" onClick={jump.close}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={() => { jump.close(); onGo(); goToGeneration(g); }}>Go</Button>
              </div>
            </div>
          </Popover>
        </>
      ) : null}
    </div>
  );
}
