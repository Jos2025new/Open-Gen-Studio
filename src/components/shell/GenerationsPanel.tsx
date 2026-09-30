import { useMemo, useState } from 'react';
import { LayoutList, List, Search, X } from 'lucide-react';
import { useStore } from '../../store/store';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { formatDateTime } from '../../lib/format';
import type { Generation } from '../../engine/types';
import { GenerationCard } from '../chat/GenerationCard';
import { generationTitle } from '../assets/GenerationInfo';
import { IconButton } from '../ui/primitives';

type Sort = 'newest' | 'oldest' | 'cost';

export function GenerationsPanel({ onClose }: { onClose: () => void }) {
  const generations = useStore((s) => s.generations);
  const sessionId = useStore((s) => s.activeSessionId);
  const [scope, setScope] = useState('session');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [compact, setCompact] = useState(false);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cost = (g: Generation) => g.actualUsd ?? g.estimate.usd;
    return Object.values(generations)
      .filter((g) => scope === 'all' || g.sessionId === sessionId)
      .filter((g) => kind === 'all' || g.kind === kind)
      .filter((g) => !needle || `${generationTitle(g)} ${g.modelName}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (sort === 'cost') {
          const ac = cost(a), bc = cost(b);
          if (ac == null && bc != null) return 1;
          if (bc == null && ac != null) return -1;
          if (ac != null && bc != null && ac !== bc) return bc - ac;
        }
        return sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
      });
  }, [generations, sessionId, scope, kind, q, sort]);

  return (
    <div className={`generations-panel ${compact ? 'is-compact' : ''}`}>
      <div className="panel-head">
        <div className="panel-title">Generations <span className="faint num">{list.length}</span></div>
        <IconButton icon={X} label="Close generations" size="sm" onClick={onClose} />
      </div>
      <div className="gallery-controls">
        <div className="search-input">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names and models" aria-label="Search generations" />
          {q ? <IconButton icon={X} label="Clear search" size="sm" onClick={() => setQ('')} /> : null}
        </div>
        <div className="generations-filters">
          <select className="select" aria-label="Show sessions" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="session">This session</option><option value="all">All sessions</option>
          </select>
          <select className="select" aria-label="Generation type" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All types</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option><option value="model3d">3D</option><option value="text">Text</option>
          </select>
          <select className="select" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="cost">Highest cost</option>
          </select>
          <IconButton icon={compact ? List : LayoutList} label={compact ? 'Compact list · show thumbnails' : 'With thumbnails · compact list'} size="sm" active={compact} onClick={() => setCompact((v) => !v)} />
        </div>
      </div>
      <div className="generations-list">
        {list.map((g) => (
          <div key={g.id} className="generation-entry">
            <div className="generation-entry-meta faint num"><span className={`generation-entry-status status-${g.status}`}>{g.status === 'done' ? 'Completed' : g.status === 'running' ? 'Generating' : g.status === 'queued' ? 'Queued' : g.status === 'error' ? 'Failed' : 'Canceled'}</span> · {formatDateTime(g.createdAt)} · {PROVIDER_LABELS[g.provider]}</div>
            <GenerationCard generationId={g.id} compact />
          </div>
        ))}
        {!list.length ? <div className="empty-block">No generations match.</div> : null}
      </div>
    </div>
  );
}
