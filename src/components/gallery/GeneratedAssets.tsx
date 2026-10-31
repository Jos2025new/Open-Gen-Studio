import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AudioLines, Box, Download, Film, Folder, Image, ListFilter, MessageSquare, Paperclip, Search, Trash, X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { deleteAssets, downloadAsset, useAsReference } from '../../engine/actions';
import { groupByDate } from '../../lib/format';
import { IconButton, Button, Segmented, Toggle } from '../ui/primitives';
import { InlineSlider } from '../designer/InlineControls';
import { Popover, usePopover } from '../ui/Popover';
import { CanvasFilter, CANVAS_LABEL, type CanvasFilterValue } from '../ui/CanvasFilter';
import { canvasLookup } from '../../engine/canvas';
import type { Asset } from '../../engine/types';
import { usePanelExpanded } from '../shell/panelEmbed';
import { PlaceModeFilter, matchesMode, matchesPlace, type ModeFilter, type PlaceFilter } from '../ui/PlaceModeFilter';
import { MODE_LABEL, PLACE_LABEL } from '../../engine/placeTypes';
import { ResultsMenu } from '../ui/ResultsMenu';
import { Sep, SortToggles, ViewToggle, type ItemView, type SortState } from '../ui/PanelControls';
import { generationTitle } from '../assets/GenerationInfo';
import { GalleryTile, LibraryTextTile, assetTitle } from './GalleryTiles';

type KindFilter = 'all' | 'image' | 'video' | 'audio' | 'model3d' | 'text';
type Scope = 'session' | 'all';
const KINDS = [{ id: 'image', label: 'Images', icon: Image }, { id: 'video', label: 'Videos', icon: Film }, { id: 'audio', label: 'Audio', icon: AudioLines }, { id: 'model3d', label: '3D', icon: Box }, { id: 'text', label: 'Text', icon: MessageSquare }] as const;

/** Everything generated or uploaded: the "All" category of the Library. */
export function GeneratedAssets({ rail, view, setView, cols, setCols }: { rail: ReactNode; view: ItemView; setView: (v: ItemView) => void; cols: number; setCols: (c: number) => void }) {
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
  const [sort, setSort] = useState<SortState>({ by: 'date', asc: false });
  const [group, setGroup] = useState<'date' | 'session'>('date');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const del = usePopover();

  useEffect(() => setCols(expanded ? Math.max(cols, 5) : Math.min(cols, 4)), [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessions = useStore((s) => s.sessions);
  const [canvas, setCanvas] = useState<CanvasFilterValue>('all');
  const where = useMemo(() => canvasLookup(sessions, generations), [sessions, generations]);
  const inScope = useMemo(() => Object.values(assets).filter((a) => a.origin !== 'sketch' && a.origin !== 'mask' && a.origin !== 'view3d' && (scope === 'session' ? a.sessionId === sessionId : true)), [assets, scope, sessionId]);
  const dir = sort.asc ? 1 : -1;
  const order = <T extends { title: string; createdAt: number }>(a: T, b: T) => sort.by === 'name' ? dir * a.title.localeCompare(b.title) : dir * (a.createdAt - b.createdAt);
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
      .map((a) => ({ a, title: assetTitle(a, a.generationId ? generations[a.generationId] : undefined), createdAt: a.createdAt }))
      .sort(order).map((x) => x.a);
  }, [inScope, canvas, where, generations, q, kind, favOnly, sort, place, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const texts = useMemo(() => Object.values(generations).filter((g) => g.kind === 'text' && g.status === 'done' && !g.discard
    && (scope === 'all' || g.sessionId === sessionId)), [generations, scope, sessionId]);
  const canvasCounts = useMemo(() => {
    const c = { all: inScope.length + texts.length, chat: 0, node: 0, designer: 0 };
    for (const a of inScope) c[where.asset(a)]++;
    for (const g of texts) c[where.generation(g) ?? 'chat']++;
    return c;
  }, [inScope, texts, where]);
  const textBase = texts.filter((g) => canvas === 'all' || where.generation(g) === canvas);
  const results = [...list.map((a) => ({ type: 'asset' as const, id: a.id, title: assetTitle(a, a.generationId ? generations[a.generationId] : undefined), createdAt: a.createdAt, asset: a })),
    ...textBase.filter((g) => !favOnly && (kind === 'all' || kind === 'text') && matchesPlace(g.place, place) && matchesMode(g.mode, mode)
      && `${g.prompt} ${g.modelName} ${g.text ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
      .map((g) => ({ type: 'text' as const, id: g.id, title: generationTitle(g), createdAt: g.createdAt, generation: g }))]
    .sort(order);
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

  // Date groups only make sense in date order; sorted by name the results are one list.
  const groups = group === 'session' ? Array.from(results.reduce((map, item) => {
    const id = item.type === 'asset' ? item.asset.sessionId : item.generation.sessionId;
    map.set(id, [...(map.get(id) ?? []), item]);
    return map;
  }, new Map<string, typeof results>())).map(([id, items]) => ({ label: sessions[id]?.title ?? 'Unknown session', id, items }))
    : sort.by === 'name' ? [{ label: '', id: 'name', items: results }] : groupByDate(results, (a) => a.createdAt).map((g) => ({ ...g, id: g.label }));

  const ids = [...selected].filter((id) => assets[id]);
  const selecting = ids.length > 0;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const open = (a: Asset) => {
    if (selecting) return toggle(a.id);
    setUi({ lightbox: { assetIds: list.map((x) => x.id), index: list.findIndex((x) => x.id === a.id) } });
  };
  const filtered = canvas !== 'all' || scope !== 'session' || place !== 'all' || mode !== 'all';
  const allPicked = list.length > 0 && list.every((a) => selected.has(a.id));

  return (
    <>
      <div className="gallery-controls generated-controls">
        <div className="pc-bar">
          <div className="search-input">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search prompts and models" aria-label="Search assets" />
            {q ? <button type="button" aria-label="Clear search" onClick={() => setQ('')}><X size={13} /></button> : null}
          </div>
          <div className="results-controls">
            <ResultsMenu label="Filter by" icon={ListFilter} iconOnly width={280} active={filtered || group !== 'date' || favOnly}>
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
                <span className="sv-label"><Folder size={12} /> Group by</span>
                <Segmented value={group} size="sm" onChange={setGroup} options={[{ value: 'date', label: 'Date' }, { value: 'session', label: 'Sessions' }]} />
              </div>
              <label className="sv-switch"><span>Favorites only</span><Toggle checked={favOnly} onChange={setFavOnly} label="Favorites only" /></label>
            </ResultsMenu>
          </div>
          <SortToggles sort={sort} onChange={setSort} />
          <Sep />
          <div className="pc-group" role="group" aria-label="Filter assets by type">
            {KINDS.map(({ id, label, icon }) => <IconButton key={id} icon={icon} label={label} size="sm" active={kind === id} aria-pressed={kind === id} onClick={() => setKind(kind === id ? 'all' : id)} />)}
            <button type="button" className={`canvas-tab${kind === 'all' ? ' is-on' : ''}`} aria-pressed={kind === 'all'} onClick={() => setKind('all')}>All</button>
          </div>
          {view === 'card' ? <>
            <Sep />
            <div className="pc-size"><InlineSlider label="Grid size" value={(expanded ? 10 : 7) - cols} min={2} max={expanded ? 8 : 5} onChange={(value) => setCols((expanded ? 10 : 7) - value)} /></div>
          </> : null}
          <Sep />
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>
      <div className="pc-split">
      {rail}
      <div className="pc-main">
      <div className="pc-sub">
        <div className="gallery-count faint num">
          {results.length} {results.length === 1 ? 'result' : 'results'}
          {running ? <span className="running-pill num">{running} running</span> : null}
        </div>
        {kind !== 'all' || filtered || favOnly ? (
          <div className="sessions-active">
            {canvas !== 'all' ? <button type="button" className="active-chip" onClick={() => setCanvas('all')}>{CANVAS_LABEL[canvas]} <X size={11} /></button> : null}
            {scope !== 'session' ? <button type="button" className="active-chip" onClick={() => setScope('session')}>All sessions <X size={11} /></button> : null}
            {kind !== 'all' ? <button type="button" className="active-chip" onClick={() => setKind('all')}>{KINDS.find((k) => k.id === kind)?.label} <X size={11} /></button> : null}
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
            <Button size="sm" variant="ghost" onClick={() => setSelected(allPicked ? new Set() : new Set(list.map((a) => a.id)))}>{allPicked ? 'None' : 'All'}</Button>
            <IconButton icon={Paperclip} label="Use as references" size="sm" onClick={() => ids.forEach((id) => useAsReference(id))} />
            <IconButton icon={Download} label="Download" size="sm" onClick={() => ids.forEach((id) => void downloadAsset(id))} />
            <IconButton ref={del.ref} icon={Trash} label="Delete" size="sm" tone="danger" onClick={del.toggle} />
            <IconButton icon={X} label="Clear selection" size="sm" onClick={() => setSelected(new Set())} />
            <Popover open={del.open} anchor={del.ref} onClose={del.close} width={280} label="Delete assets">
              <div className="confirm">
                <p>Delete {ids.length} asset{ids.length === 1 ? '' : 's'}? Files are removed from this browser.</p>
                <div className="spend-actions">
                  <Button variant="ghost" onClick={del.close}>Cancel</Button>
                  <Button variant="danger" onClick={() => { deleteAssets(ids); setSelected(new Set()); del.close(); }}>Delete</Button>
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
              {g.label ? <h4 className="date-head">{g.label} <span className="faint num">{g.items.length}</span></h4> : null}
              <div className={`gallery-grid library-layout-${view}`} style={{ ['--cols' as string]: cols }}>
                {g.items.map((a) => (
                  a.type === 'text' ? <LibraryTextTile key={a.id} g={a.generation} view={view} /> : <GalleryTile key={a.id} asset={a.asset} view={view} selected={selected.has(a.id)} selecting={selecting} onToggle={() => toggle(a.id)} onOpen={() => open(a.asset)} />
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
      </div>
      </div>
    </>
  );
}
