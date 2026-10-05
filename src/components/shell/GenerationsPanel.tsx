import { useMemo, useState } from 'react';
import { Box, CornerDownRight, FileText, Film, Image as ImageIcon, Music, Search, SlidersHorizontal, X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { formatDateTime, formatUsd } from '../../lib/format';
import type { Generation } from '../../engine/types';
import { generationTitle } from '../assets/GenerationInfo';
import { AssetMedia } from '../ui/AssetMedia';
import { Popover, usePopover } from '../ui/Popover';
import { Button, IconButton, Segmented, Toggle } from '../ui/primitives';
import { generationPlace, goToGeneration } from '../../engine/goTo';
import { CanvasFilter, CANVAS_LABEL, type CanvasFilterValue } from '../ui/CanvasFilter';
import { canvasLookup } from '../../engine/canvas';

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
const STATUS_LABEL: Record<Generation['status'], string> = { done: 'Done', running: 'Generating', queued: 'Queued', error: 'Failed', canceled: 'Canceled', review: 'Needs review' };

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
  const filters = usePopover();
  const sessions = useStore((s) => s.sessions);
  const [canvas, setCanvas] = useState<CanvasFilterValue>('all');
  const where = useMemo(() => canvasLookup(sessions, generations), [sessions, generations]);
  const inScope = useMemo(() => Object.values(generations).filter((g) => scope === 'all' || g.sessionId === sessionId), [generations, scope, sessionId]);
  const canvasCounts = useMemo(() => {
    const c = { all: inScope.length, chat: 0, node: 0, designer: 0 };
    for (const g of inScope) c[where.generation(g)]++;
    return c;
  }, [inScope, where]);
  const scoped = useMemo(() => inScope.filter((g) => canvas === 'all' || where.generation(g) === canvas), [inScope, canvas, where]);
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
      <div className="sessions-controls">
        <div className="search-input">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search generations" aria-label="Search generations" />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')}>
              <X size={13} />
            </button>
          ) : null}
          <button ref={filters.ref} type="button" className={`search-view ${filters.open ? 'is-open' : ''}`} onClick={filters.toggle} aria-label="Filter, sort and view" data-tip="Filter, sort and view">
            <SlidersHorizontal size={14} />
            {scope !== 'session' || canvas !== 'all' || kind !== 'all' || status !== 'all' || sort !== 'newest' || view !== 'thumbs' ? <span className="dot" /> : null}
          </button>
        </div>
        <Popover open={filters.open} anchor={filters.ref} onClose={filters.close} width={300} label="Filter, sort and view">
          <div className="sessions-view">
            <div className="sv-row">
              <span className="sv-label">Show</span>
              <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: 'session', label: 'This session' }, { value: 'all', label: 'All sessions' }]} />
            </div>
            <div className="sv-row">
              <span className="sv-label">Canvas</span>
              <CanvasFilter value={canvas} counts={canvasCounts} onChange={setCanvas} />
            </div>
            <div className="sv-row">
              <span className="sv-label">Type</span>
              <div className="sv-canvas">
                {KINDS.map((k) => {
                  const KIcon = k.id === 'all' ? null : KIND_ICON[k.id];
                  return (
                    <button key={k.id} type="button" className={`canvas-tab ${kind === k.id ? 'is-on' : ''}`} onClick={() => setKind(k.id)} disabled={k.id !== 'all' && !count(k.id)}>
                      {KIcon ? <KIcon size={12} /> : null}
                      {k.label}
                      <span className="num faint">{count(k.id)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="sv-row">
              <span className="sv-label">Status</span>
              <Segmented size="sm" value={status} onChange={setStatus} options={STATUSES.map((x) => ({ value: x.id, label: x.id === 'all' ? 'Any' : x.label }))} />
            </div>
            <div className="sv-row">
              <span className="sv-label">Sort</span>
              <Segmented size="sm" value={sort} onChange={setSort} options={[{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }, { value: 'cost', label: 'Cost' }]} />
            </div>
            <label className="sv-switch"><span>Thumbnails</span><Toggle checked={view === 'thumbs'} onChange={(v) => setView(v ? 'thumbs' : 'list')} label="Thumbnails" /></label>
          </div>
        </Popover>
        {scope !== 'session' || canvas !== 'all' || kind !== 'all' || status !== 'all' ? (
          <div className="sessions-active">
            {canvas !== 'all' ? <button type="button" className="active-chip" onClick={() => setCanvas('all')}>{CANVAS_LABEL[canvas]} <X size={11} /></button> : null}
            {scope !== 'session' ? <button type="button" className="active-chip" onClick={() => setScope('session')}>All sessions <X size={11} /></button> : null}
            {kind !== 'all' ? <button type="button" className="active-chip" onClick={() => setKind('all')}>{KINDS.find((k) => k.id === kind)?.label} <X size={11} /></button> : null}
            {status !== 'all' ? <button type="button" className="active-chip" onClick={() => setStatus('all')}>{STATUSES.find((x) => x.id === status)?.label} <X size={11} /></button> : null}
          </div>
        ) : null}
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
          <IconButton ref={jump.ref} icon={CornerDownRight} label="Go to where it was made" size="sm" className="gen-row-go" active={jump.open} onClick={jump.toggle} />
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
