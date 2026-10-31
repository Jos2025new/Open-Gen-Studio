import { ReuseButton } from '../assets/ReuseButton';
import { TextTile } from '../assets/TextTile';
import { AgentAttachToggle } from '../assets/AgentAttachToggle';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Box, CheckSquare, Clock, Download, Film, Folder, Image, MessageSquare, Maximize2, Minimize2, Paperclip, Search, ListFilter, ArrowUpDown, LayoutGrid, LayoutList, List, ChevronDown, Check, Grid2X2, UserRound, Tag, Shapes, Palette, Star, Trash, X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { deleteAssets, deleteSubject, downloadAsset, SUBJECT_KINDS, useAsReference } from '../../engine/actions';
import { formatDuration, formatRelative, groupByDate } from '../../lib/format';
import { IconButton, Button, Segmented } from '../ui/primitives';
import { InlineSlider } from '../designer/InlineControls';
import { Popover, usePopover } from '../ui/Popover';
import { AssetMedia } from '../ui/AssetMedia';
import { CanvasFilter, CANVAS_LABEL, type CanvasFilterValue } from '../ui/CanvasFilter';
import { canvasLookup } from '../../engine/canvas';
import type { Asset, Subject, SubjectKind } from '../../engine/types';
import { usePanelExpanded } from '../shell/panelEmbed';
import { PlaceModeFilter, matchesMode, matchesPlace, type ModeFilter, type PlaceFilter } from '../ui/PlaceModeFilter';
import { MODE_LABEL, PLACE_LABEL } from '../../engine/placeTypes';
import { ResultsMenu } from '../ui/ResultsMenu';
import './GalleryLayout.css';

type KindFilter = 'all' | 'image' | 'video' | 'audio' | 'model3d' | 'text';
type Scope = 'session' | 'all';
const SUBJECT_ICONS = { character: UserRound, object: Shapes, product: Tag, location: Box, style: Palette } as const;

/** Assets: every generation and upload, and the library of saved characters, objects, products and styles. */
export function GalleryPanel() {
  const [tab, setTab] = useState<'generated' | 'library'>('generated');
  const { expanded, embedded } = usePanelExpanded();
  const libraryCount = useStore((s) => s.library.length);
  return (
    <div className="gallery" role="region" aria-label="Library">
      <div className="library-toolbar">
        {embedded ? null : <>
          <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
          <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Collapse' : 'Expand'} size="sm" onClick={() => setUi({ panelExpanded: !expanded })} />
        </>}
        <Segmented
          value={tab}
          size="sm"
          onChange={setTab}
          options={[
            { value: 'generated', label: 'Generated' },
            { value: 'library', label: `Saved${libraryCount ? ` · ${libraryCount}` : ''}`, tip: 'Saved as @Name, for every session' },
          ]}
        />
      </div>
      {tab === 'generated' ? <GeneratedAssets /> : <LibraryAssets />}
    </div>
  );
}

function LibraryAssets() {
  const library = useStore((s) => s.library);
  const [kind, setKind] = useState<'all' | SubjectKind>('all');
  const list = library.filter((x) => kind === 'all' || (x.kind ?? 'character') === kind);
  return (
    <>
      <div className="gallery-controls">
        <div className="results-controls"><ResultsMenu label="Filter by" icon={ListFilter} iconOnly width={280} active={kind !== 'all'}>
          <div className="sv-row"><span className="sv-label">Category</span><div className="sv-canvas" role="radiogroup" aria-label="Category">
            <button type="button" role="radio" aria-checked={kind === 'all'} className={`canvas-tab ${kind === 'all' ? 'is-on' : ''}`} onClick={() => setKind('all')}><Grid2X2 size={12} /> All</button>
            {SUBJECT_KINDS.map((k) => { const Icon = SUBJECT_ICONS[k.value]; return <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} className={`canvas-tab ${kind === k.value ? 'is-on' : ''}`} onClick={() => setKind(k.value)}><Icon size={12} /> {k.label}s</button>; })}
          </div></div>
        </ResultsMenu></div>
      </div>
      <div className="gallery-scroll">
        {list.length ? (
          <div className="gallery-grid" style={{ ['--cols' as string]: 3 }}>
            {list.map((x) => (
              <LibraryTile key={x.id} item={x} />
            ))}
          </div>
        ) : (
          <div className="empty-block">
            <p>Save a result with Send to → Save to library, or let the agent create references. Mention them as @Name in any prompt.</p>
          </div>
        )}
      </div>
    </>
  );
}

function LibraryTile({ item }: { item: Subject }) {
  const cover = item.frontalAssetId ?? item.videoAssetId;
  const del = usePopover();
  return (
    <div className="g-tile lib-tile">
      <button
        type="button"
        className="g-open"
        aria-label={`Open @${item.name}`}
        onClick={() => cover && setUi({ lightbox: { assetIds: [cover, ...item.refAssetIds], index: 0 } })}
      >
        {cover ? <AssetMedia assetId={cover} /> : null}
      </button>
      <span className="lib-name">@{item.name}</span>
      <span className="lib-del">
        <IconButton ref={del.ref} icon={Trash} label={`Remove @${item.name} from the library`} size="sm" tone="danger" active={del.open} onClick={del.toggle} />
      </span>
      <Popover open={del.open} anchor={del.ref} onClose={del.close} width={280} label={`Remove @${item.name}`}>
        <div className="confirm">
          <p>Remove @{item.name} from the library? Its images stay in Generated.</p>
          <div className="spend-actions">
            <Button variant="ghost" onClick={del.close}>Cancel</Button>
            <Button variant="danger" onClick={() => { deleteSubject(item.id); del.close(); }}>Remove</Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}

function GeneratedAssets() {
  const assets = useStore((s) => s.assets);
  const generations = useStore((s) => s.generations);
  const sessionId = useStore((s) => s.activeSessionId);
  const { expanded } = usePanelExpanded();
  const running = useStore((s) => Object.values(s.generations).filter((g) => g.status === 'running' || g.status === 'queued').length);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [scope, setScope] = useState<Scope>(() => (useStore.getState().ui.home || useStore.getState().ui.space ? 'all' : 'session'));
  const [place, setPlace] = useState<PlaceFilter>('all');
  const [mode, setMode] = useState<ModeFilter>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [newest, setNewest] = useState(true);
  const [group, setGroup] = useState<'date' | 'session'>('date');
  const [cols, setCols] = useState(3);
  const [layout, setLayout] = useState<'cards' | 'list' | 'grid'>('grid');
  const layoutMenu = usePopover();
  const views = [{ id: 'cards', label: 'Cards', icon: LayoutList }, { id: 'list', label: 'List', icon: List }, { id: 'grid', label: 'Grid', icon: LayoutGrid }] as const;
  const currentView = views.find((view) => view.id === layout)!;
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const del = usePopover();

  useEffect(() => setCols((c) => (expanded ? Math.max(c, 5) : Math.min(c, 4))), [expanded]);

  const sessions = useStore((s) => s.sessions);
  const [canvas, setCanvas] = useState<CanvasFilterValue>('all');
  const where = useMemo(() => canvasLookup(sessions, generations), [sessions, generations]);
  const inScope = useMemo(() => Object.values(assets).filter((a) => a.origin !== 'sketch' && a.origin !== 'mask' && a.origin !== 'view3d' && (scope === 'session' ? a.sessionId === sessionId : true)), [assets, scope, sessionId]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inScope
      .filter((a) => canvas === 'all' || where.asset(a) === canvas)
      .filter((a) => kind === 'all' || a.kind === kind)
      .filter((a) => matchesPlace(a.place, place) && matchesMode(a.mode, mode))
      .filter((a) => !favOnly || a.favorite)
      .filter((a) => {
        if (!needle) return true;
        const g = a.generationId ? generations[a.generationId] : undefined;
        return (g?.prompt ?? '').toLowerCase().includes(needle) || (g?.modelName ?? '').toLowerCase().includes(needle) || a.origin.includes(needle);
      })
      .sort((a, b) => (newest ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [inScope, canvas, where, generations, q, kind, favOnly, newest, place, mode]);
  const texts = useMemo(() => Object.values(generations).filter((g) => g.kind === 'text' && g.status === 'done' && !g.discard
    && (scope === 'all' || g.sessionId === sessionId)), [generations, scope, sessionId]);
  const canvasCounts = useMemo(() => {
    const c = { all: inScope.length + texts.length, chat: 0, node: 0, designer: 0 };
    for (const a of inScope) c[where.asset(a)]++;
    for (const g of texts) c[where.generation(g) ?? 'chat']++;
    return c;
  }, [inScope, texts, where]);
  const textBase = texts.filter((g) => canvas === 'all' || where.generation(g) === canvas);
  const results = [...list.map((a) => ({ type: 'asset' as const, id: a.id, createdAt: a.createdAt, asset: a })),
    ...textBase.filter((g) => !favOnly && (kind === 'all' || kind === 'text') && matchesPlace(g.place, place) && matchesMode(g.mode, mode)
      && `${g.prompt} ${g.modelName} ${g.text ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
      .map((g) => ({ type: 'text' as const, id: g.id, createdAt: g.createdAt, generation: g }))]
    .sort((a, b) => newest ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);
  const facets = useMemo(() => {
    const base = [...inScope.filter((a) => canvas === 'all' || where.asset(a) === canvas), ...texts.filter((g) => canvas === 'all' || where.generation(g) === canvas)];
    const places: Record<string, number> = { all: base.length, none: 0 };
    const modes: Record<string, number> = { all: base.length, none: 0 };
    for (const a of base) {
      if (a.place) places[a.place] = (places[a.place] ?? 0) + 1; else places.none++;
      if (a.mode) modes[a.mode] = (modes[a.mode] ?? 0) + 1; else modes.none++;
    }
    return { places, modes };
  }, [inScope, texts, canvas, where]);

  const groups = group === 'date' ? groupByDate(results, (a) => a.createdAt).map((g) => ({ ...g, id: g.label })) : Array.from(results.reduce((map, item) => {
    const id = item.type === 'asset' ? item.asset.sessionId : item.generation.sessionId;
    const entries = map.get(id) ?? [];
    entries.push(item);
    map.set(id, entries);
    return map;
  }, new Map<string, typeof results>())).map(([id, items]) => ({ label: sessions[id]?.title ?? 'Unknown session', id, items }));

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
    <>
      <div className="gallery-controls generated-controls">
        <div className="gallery-count faint num">
          {results.length} {results.length === 1 ? 'result' : 'results'}
          {running ? <span className="running-pill num">{running} running</span> : null}
        </div>
        <div className="gallery-search-row">
        <div className="search-input">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompts and models" aria-label="Search assets" />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')}>
              <X size={13} />
            </button>
          ) : null}
        </div>
        </div>
        <div className="results-controls">
        <ResultsMenu label="Filter by" icon={ListFilter} iconOnly width={280} active={kind !== 'all' || canvas !== 'all' || scope !== 'session' || place !== 'all' || mode !== 'all'}>
            <div className="sv-row">
              <span className="sv-label">Show</span>
              <Segmented value={scope} size="sm" onChange={setScope} options={[{ value: 'session', label: 'This session' }, { value: 'all', label: 'All sessions' }]} />
            </div>
            <div className="sv-row">
              <span className="sv-label">Canvas</span>
              <CanvasFilter value={canvas} counts={canvasCounts} onChange={setCanvas} />
            </div>
            <PlaceModeFilter place={place} mode={mode} placeCounts={facets.places} modeCounts={facets.modes} onPlace={setPlace} onMode={setMode} />
            <div className="sv-row">
              <span className="sv-label">Type</span>
              <Segmented value={kind} size="sm" onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'image', label: 'Images' }, { value: 'video', label: 'Videos' }, { value: 'audio', label: 'Audio' }, { value: 'model3d', label: '3D' }, { value: 'text', label: 'Text' }]} />
            </div>
        </ResultsMenu>
        <ResultsMenu label="Group by" icon={Folder} iconOnly active={group !== 'date'}>
          <Segmented value={group} size="sm" onChange={setGroup} options={[{ value: 'date', label: 'Date' }, { value: 'session', label: 'Sessions' }]} />
        </ResultsMenu>
        <ResultsMenu label="Order by" icon={ArrowUpDown} iconOnly active={!newest}>
          <Segmented value={newest ? 'new' : 'old'} size="sm" onChange={(v) => setNewest(v === 'new')} options={[{ value: 'new', label: 'Newest' }, { value: 'old', label: 'Oldest' }]} />
        </ResultsMenu>
        <span className="results-controls-spacer" />
        {layout !== 'list' ? <div className="library-size"><InlineSlider label="Grid size" value={(expanded ? 10 : 7) - cols} min={2} max={expanded ? 8 : 5} onChange={(value) => setCols((expanded ? 10 : 7) - value)} /></div> : null}
        <button ref={layoutMenu.ref} type="button" className="session-view-trigger" aria-label="View" aria-haspopup="dialog" aria-expanded={layoutMenu.open} onClick={layoutMenu.toggle}>
          <currentView.icon size={14} />{currentView.label}<ChevronDown size={12} />
        </button>
        <Popover open={layoutMenu.open} anchor={layoutMenu.ref} onClose={layoutMenu.close} placement="bottom-start" width={180} label="Library view">
          <div className="session-view-options" role="radiogroup" aria-label="Library view">
            {views.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="radio" aria-checked={layout === id} className="session-view-option" onClick={() => { setLayout(id); layoutMenu.close(); }}><Icon size={15} /><span className="session-view-option-text">{label}</span>{layout === id ? <Check size={13} className="session-view-check" /> : null}</button>)}
          </div>
        </Popover>
        <div className="library-quick-kinds" role="group" aria-label="Filter assets by type">
          {([{ id: 'image', label: 'Images', icon: Image }, { id: 'video', label: 'Videos', icon: Film }, { id: 'audio', label: 'Audio', icon: AudioLines }, { id: 'model3d', label: '3D', icon: Box }, { id: 'text', label: 'Text', icon: MessageSquare }] as const).map(({ id, label, icon }) => <IconButton key={id} icon={icon} label={label} size="sm" active={kind === id} aria-pressed={kind === id} onClick={() => setKind(kind === id ? 'all' : id)} />)}
          <button type="button" className={`canvas-tab${kind === 'all' ? ' is-on' : ''}`} aria-pressed={kind === 'all'} onClick={() => setKind('all')}>All</button>
        </div>
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
        <IconButton icon={Star} label="Favorites only" size="sm" active={favOnly} aria-pressed={favOnly} onClick={() => setFavOnly(!favOnly)} />
        </div>
        {kind !== 'all' || canvas !== 'all' || scope !== 'session' || place !== 'all' || mode !== 'all' || favOnly ? (
          <div className="sessions-active">
            {canvas !== 'all' ? <button type="button" className="active-chip" onClick={() => setCanvas('all')}>{CANVAS_LABEL[canvas]} <X size={11} /></button> : null}
            {scope !== 'session' ? <button type="button" className="active-chip" onClick={() => setScope('session')}>All sessions <X size={11} /></button> : null}
            {kind !== 'all' ? <button type="button" className="active-chip" onClick={() => setKind('all')}>{({ image: 'Images', video: 'Videos', audio: 'Audio', model3d: '3D', text: 'Text' } as Record<string, string>)[kind]} <X size={11} /></button> : null}
            {place !== 'all' ? <button type="button" className="active-chip" onClick={() => setPlace('all')}>{place === 'none' ? 'No place' : PLACE_LABEL[place]} <X size={11} /></button> : null}
            {mode !== 'all' ? <button type="button" className="active-chip" onClick={() => setMode('all')}>{mode === 'none' ? 'No mode' : MODE_LABEL[mode]} <X size={11} /></button> : null}
            {favOnly ? <button type="button" className="active-chip" onClick={() => setFavOnly(false)}>Favorites <X size={11} /></button> : null}
          </div>
        ) : null}
        {selecting ? (
          <div className="gallery-bulk">
            <span className="num">{ids.length} selected</span>
            <span className="spacer" />
            {/* All selects everything; pressed again with everything selected, it clears the selection. */}
            <Button size="sm" variant="ghost" onClick={() => setSelected(list.length && list.every((a) => selected.has(a.id)) ? new Set() : new Set(list.map((a) => a.id)))}>
              {list.length && list.every((a) => selected.has(a.id)) ? 'None' : 'All'}
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
        {results.length ? (
          groups.map((g) => (
            <section key={g.id} className="date-group">
              <h4 className="date-head">
                {g.label} <span className="faint num">{g.items.length}</span>
              </h4>
              <div className={`gallery-grid library-layout-${layout}`} style={{ ['--cols' as string]: cols }}>
                {g.items.map((a) => (
                  a.type === 'text' ? <TextTile key={a.id} g={a.generation} /> : <GalleryTile key={a.id} asset={a.asset} selected={selected.has(a.id)} selecting={selecting} onOpen={() => open(a.asset)} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="empty-block">
            <p>{Object.keys(assets).length ? 'Nothing matches these filters.' : 'Your generations will appear here.'}</p>
          </div>
        )}
      </div>
    </>
  );
}

function GalleryTile({ asset, selected, selecting, onOpen }: { asset: Asset; selected: boolean; selecting: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const g = useStore((s) => asset.generationId ? s.generations[asset.generationId] : undefined);
  return (
    <div className={`g-tile ${selected ? 'is-selected' : ''}`}>
      <button ref={ref} type="button" className="g-open" onClick={onOpen} aria-label="Open">
        <AssetMedia assetId={asset.id} />
      </button>
      <div className="library-item-meta">
        <span className="library-item-title" title={g?.prompt || asset.name || asset.kind}>{g?.prompt || asset.name || asset.kind}</span>
        {g?.modelName ? <span className="library-item-subtitle" title={g.modelName}>{g.modelName}</span> : null}
        <span className="library-item-details">
          <time dateTime={new Date(asset.createdAt).toISOString()}>{formatRelative(asset.createdAt)}</time>
          {asset.width > 0 && asset.height > 0 ? <span>{asset.width} × {asset.height}</span> : null}
          {asset.duration ? <span>{formatDuration(asset.duration * 1000)}</span> : null}
        </span>
      </div>
      {asset.kind === 'video' || asset.kind === 'audio' || asset.kind === 'model3d' ? (
        <span className="g-badge num">
          {asset.kind === 'audio' ? <AudioLines size={11} /> : asset.kind === 'model3d' ? <Box size={11} /> : <Film size={11} />}
          {asset.kind === 'model3d' ? '3D' : asset.duration ? formatDuration(asset.duration * 1000) : ''}
        </span>
      ) : null}
      {asset.favorite ? <Star size={12} className="g-fav" fill="currentColor" /> : null}
      {selecting ? <span className={`g-check ${selected ? 'is-on' : ''}`} /> : <AgentAttachToggle assetId={asset.id} />}
      {!selecting ? <ReuseButton g={g} /> : null}
      {!asset.stored ? (
        <span className="g-remote" data-tip="Stored at the provider only; it may expire">
          <Clock size={11} />
        </span>
      ) : null}
    </div>
  );
}
