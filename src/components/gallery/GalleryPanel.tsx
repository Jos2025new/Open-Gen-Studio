import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Download, Maximize2, Minimize2, Paperclip, Search, Star, Trash, X, Film, Clock, ArrowDownUp } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { deleteAssets, downloadAsset, useAsReference } from '../../engine/actions';
import { formatDuration } from '../../lib/format';
import { IconButton, Button, Segmented } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { AssetMedia } from '../ui/AssetMedia';
import type { Asset } from '../../engine/types';

type KindFilter = 'all' | 'image' | 'video';
type Scope = 'session' | 'all';

export function GalleryPanel() {
  const assets = useStore((s) => s.assets);
  const generations = useStore((s) => s.generations);
  const sessionId = useStore((s) => s.activeSessionId);
  const expanded = useStore((s) => s.ui.galleryExpanded);
  const running = useStore((s) => Object.values(s.generations).filter((g) => g.status === 'running' || g.status === 'queued').length);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [scope, setScope] = useState<Scope>('session');
  const [favOnly, setFavOnly] = useState(false);
  const [newest, setNewest] = useState(true);
  const [cols, setCols] = useState(3);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const del = usePopover();

  useEffect(() => setCols((c) => (expanded ? Math.max(c, 5) : Math.min(c, 4))), [expanded]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(assets)
      .filter((a) => (scope === 'session' ? a.sessionId === sessionId : true))
      .filter((a) => kind === 'all' || a.kind === kind)
      .filter((a) => !favOnly || a.favorite)
      .filter((a) => {
        if (!needle) return true;
        const g = a.generationId ? generations[a.generationId] : undefined;
        return (g?.prompt ?? '').toLowerCase().includes(needle) || (g?.modelName ?? '').toLowerCase().includes(needle) || a.origin.includes(needle);
      })
      .sort((a, b) => (newest ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [assets, generations, q, kind, scope, favOnly, newest, sessionId]);

  const open = (a: Asset) => {
    if (selecting) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(a.id)) n.delete(a.id);
        else n.add(a.id);
        return n;
      });
      return;
    }
    setUi({ lightbox: { assetIds: list.map((x) => x.id), index: list.findIndex((x) => x.id === a.id) } });
  };

  const ids = [...selected].filter((id) => assets[id]);

  return (
    <div className="gallery">
      <div className="panel-head">
        <div className="panel-title">
          Gallery <span className="faint num">{list.length}</span>
          {running ? <span className="running-pill num">{running} running</span> : null}
        </div>
        <div className="panel-head-actions">
          <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Collapse' : 'Expand'} size="sm" onClick={() => setUi({ galleryExpanded: !expanded })} />
          <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
        </div>
      </div>
      <div className="gallery-controls">
        <div className="search-input">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompts and models" aria-label="Search gallery" />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')}>
              <X size={13} />
            </button>
          ) : null}
        </div>
        <div className="gallery-row">
          <Segmented
            value={kind}
            size="sm"
            onChange={setKind}
            options={[
              { value: 'all', label: 'All' },
              { value: 'image', label: 'Images' },
              { value: 'video', label: 'Videos' },
            ]}
          />
          <Segmented
            value={scope}
            size="sm"
            onChange={setScope}
            options={[
              { value: 'session', label: 'Session', tip: 'Only this session' },
              { value: 'all', label: 'All', tip: 'Every session' },
            ]}
          />
        </div>
        <div className="gallery-row">
          <IconButton icon={Star} label={favOnly ? 'Showing favorites' : 'Favorites only'} size="sm" active={favOnly} onClick={() => setFavOnly((v) => !v)} />
          <IconButton icon={ArrowDownUp} label={newest ? 'Newest first' : 'Oldest first'} size="sm" onClick={() => setNewest((v) => !v)} />
          <label className="density" data-tip="Grid density">
            <input type="range" min={2} max={expanded ? 8 : 5} value={cols} onChange={(e) => setCols(Number(e.target.value))} aria-label="Columns" />
          </label>
          <IconButton
            icon={CheckSquare}
            label={selecting ? 'Done selecting' : 'Select'}
            size="sm"
            active={selecting}
            onClick={() => {
              setSelecting((v) => !v);
              setSelected(new Set());
            }}
          />
        </div>
        {selecting ? (
          <div className="gallery-bulk">
            <span className="num">{ids.length} selected</span>
            <span className="spacer" />
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(list.map((a) => a.id)))}>
              All
            </Button>
            <IconButton icon={Paperclip} label="Use as references" size="sm" disabled={!ids.length} onClick={() => ids.forEach((id) => useAsReference(id))} />
            <IconButton icon={Download} label="Download" size="sm" disabled={!ids.length} onClick={() => ids.forEach((id) => void downloadAsset(id))} />
            <IconButton ref={del.ref} icon={Trash} label="Delete" size="sm" tone="danger" disabled={!ids.length} onClick={del.toggle} />
            <Popover open={del.open} anchor={del.ref} onClose={del.close} width={280} label="Delete assets">
              <div className="confirm">
                <p>
                  Delete {ids.length} asset{ids.length === 1 ? '' : 's'}? Files are removed from this browser.
                </p>
                <div className="spend-actions">
                  <Button variant="ghost" onClick={del.close}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      deleteAssets(ids);
                      setSelected(new Set());
                      del.close();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Popover>
          </div>
        ) : null}
      </div>
      <div className="gallery-scroll">
        {list.length ? (
          <div className="gallery-grid" style={{ ['--cols' as string]: cols }}>
            {list.map((a) => (
              <GalleryTile key={a.id} asset={a} selected={selected.has(a.id)} selecting={selecting} onOpen={() => open(a)} />
            ))}
          </div>
        ) : (
          <div className="empty-block">
            <p>{Object.keys(assets).length ? 'Nothing matches these filters.' : 'Your generations will appear here.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function GalleryTile({ asset, selected, selecting, onOpen }: { asset: Asset; selected: boolean; selecting: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className={`g-tile ${selected ? 'is-selected' : ''}`}>
      <button ref={ref} type="button" className="g-open" onClick={onOpen} aria-label="Open">
        <AssetMedia assetId={asset.id} />
      </button>
      {asset.kind === 'video' ? (
        <span className="g-badge num">
          <Film size={11} />
          {asset.duration ? formatDuration(asset.duration * 1000) : ''}
        </span>
      ) : null}
      {asset.favorite ? <Star size={12} className="g-fav" fill="currentColor" /> : null}
      {selecting ? <span className={`g-check ${selected ? 'is-on' : ''}`} /> : null}
      {!asset.stored ? (
        <span className="g-remote" data-tip="Stored at the provider only; it may expire">
          <Clock size={11} />
        </span>
      ) : null}
    </div>
  );
}
