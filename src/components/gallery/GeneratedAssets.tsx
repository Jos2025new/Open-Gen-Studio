import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Archive, AudioLines, Box, Download, Eye, EyeOff, Film, Folder, Funnel, Image, LayoutGrid, MessageSquare, Paperclip, Star, Trash, X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { deleteAssets, downloadAsset, useAsReference } from '../../engine/actions';
import { groupByDate } from '../../lib/format';
import { IconButton, Button } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { CanvasFilter, CANVAS_LABEL, type CanvasFilterValue } from '../ui/CanvasFilter';
import { canvasLookup } from '../../engine/canvas';
import type { Asset } from '../../engine/types';
import { usePanelExpanded } from '../shell/panelEmbed';
import { PlaceModeFilter, matchesMode, matchesPlace, type ModeFilter, type PlaceFilter } from '../ui/PlaceModeFilter';
import { MODE_LABEL, PLACE_LABEL } from '../../engine/placeTypes';
import { JustifiedGrid } from '../ui/JustifiedGrid';
import { rowHeightFor } from '../../lib/justifiedRows';
import { GridSizeSlider, GroupCheck, LayoutSegmented, PanelPopover, SearchToggle, SortSegmented, type ItemView } from '../ui/PanelControls';
import { setUserHidden } from '../../store/userHidden';
import { generationTitle } from '../assets/GenerationInfo';
import { usePref } from '../ui/hooks';
import { GalleryTile, LibraryTextTile, assetTitle } from './GalleryTiles';
import { LIBRARY_HEADS, ListHeader, columnValues, compareColumn, widthVars, type ColumnValues, type ColumnWidths, type ListSort } from './ListColumns';

type KindFilter = 'all' | 'image' | 'video' | 'audio' | 'model3d' | 'text';
const KINDS = [{ id: 'image', label: 'Images', icon: Image }, { id: 'video', label: 'Videos', icon: Film }, { id: 'audio', label: 'Audio', icon: AudioLines }, { id: 'model3d', label: '3D', icon: Box }, { id: 'text', label: 'Text', icon: MessageSquare }] as const;

/** Everything generated or uploaded: the "All" category of the Library. */
export function GeneratedAssets({ source, chrome, view, setView, cols, setCols }: { source: ReactNode; chrome: ReactNode; view: ItemView; setView: (v: ItemView) => void; cols: number; setCols: (c: number) => void }) {
  const assets = useStore((s) => s.assets);
  const generations = useStore((s) => s.generations);
  const { expanded } = usePanelExpanded();
  const running = useStore((s) => Object.values(s.generations).filter((g) => g.status === 'running' || g.status === 'queued').length);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [place, setPlace] = useState<PlaceFilter>('all');
  const [mode, setMode] = useState<ModeFilter>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [sort, setSort] = useState<ListSort>({ by: 'date', asc: false });
  const [colWidths, setColWidths] = usePref<ColumnWidths>('ogs.libraryColumns', {});
  const [group, setGroup] = useState<'date' | 'session'>('date');
  const [showHidden, setShowHidden] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const del = usePopover();

  useEffect(() => setCols(expanded ? Math.max(cols, 5) : Math.min(cols, 4)), [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessions = useStore((s) => s.sessions);
  const [canvas, setCanvas] = useState<CanvasFilterValue>('all');
  const where = useMemo(() => canvasLookup(sessions, generations), [sessions, generations]);
  const inScope = useMemo(() => Object.values(assets).filter((a) => a.origin !== 'sketch' && a.origin !== 'mask' && a.origin !== 'view3d' && (showHidden || !a.userHidden) && (showArchived || !sessions[a.sessionId]?.archived)), [assets, showHidden, showArchived, sessions]);
  const dir = sort.asc ? 1 : -1;
  const order = <T extends { title: string; createdAt: number; cols: ColumnValues }>(a: T, b: T) => sort.by === 'name' ? dir * a.title.localeCompare(b.title) : sort.by === 'date' ? dir * (a.createdAt - b.createdAt) : compareColumn(sort.by, sort.asc, a.cols, b.cols);
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
      .map((a) => { const g = a.generationId ? generations[a.generationId] : undefined; return { a, title: assetTitle(a, g), createdAt: a.createdAt, cols: columnValues(a, g) }; })
      .sort(order).map((x) => x.a);
  }, [inScope, canvas, where, generations, q, kind, favOnly, sort, place, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const texts = useMemo(() => Object.values(generations).filter((g) => g.kind === 'text' && g.status === 'done' && !g.discard
    && (showArchived || !sessions[g.sessionId]?.archived)), [generations, showArchived, sessions]);
  const canvasCounts = useMemo(() => {
    const c = { all: inScope.length + texts.length, chat: 0, node: 0, designer: 0 };
    for (const a of inScope) c[where.asset(a)]++;
    for (const g of texts) c[where.generation(g) ?? 'chat']++;
    return c;
  }, [inScope, texts, where]);
  const textBase = texts.filter((g) => canvas === 'all' || where.generation(g) === canvas);
  const results = [...list.map((a) => ({ type: 'asset' as const, id: a.id, title: assetTitle(a, a.generationId ? generations[a.generationId] : undefined), createdAt: a.createdAt, cols: columnValues(a, a.generationId ? generations[a.generationId] : undefined), asset: a })),
    ...textBase.filter((g) => !favOnly && (kind === 'all' || kind === 'text') && matchesPlace(g.place, place) && matchesMode(g.mode, mode)
      && `${g.prompt} ${g.modelName} ${g.text ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
      .map((g) => ({ type: 'text' as const, id: g.id, title: generationTitle(g), createdAt: g.createdAt, cols: columnValues(undefined, g), generation: g }))]
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
    : sort.by !== 'date' ? [{ label: '', id: 'name', items: results }] : groupByDate(results, (a) => a.createdAt).map((g) => ({ ...g, id: g.label }));

  const hiddenCount = useMemo(() => Object.values(assets).filter((a) => a.userHidden).length, [assets]);
  const archivedCount = useMemo(() => Object.values(assets).filter((a) => sessions[a.sessionId]?.archived).length, [assets, sessions]);
  const ids = [...selected].filter((id) => assets[id]);
  const selecting = ids.length > 0;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const open = (a: Asset) => {
    if (selecting) return toggle(a.id);
    setUi({ lightbox: { assetIds: list.map((x) => x.id), index: list.findIndex((x) => x.id === a.id) } });
  };
  const filtered = canvas !== 'all' || place !== 'all' || mode !== 'all';
  // Show hidden / Show archived: visible toggles at the far end of the sort row, so their state is always in sight.
  const shelfToggles = <>
    <IconButton icon={showHidden ? Eye : EyeOff} label={`Show hidden · ${hiddenCount}`} size="sm" active={showHidden} aria-pressed={showHidden} onClick={() => { setShowHidden(!showHidden); setSelected(new Set()); }} />
    <IconButton icon={Archive} label={`Show archived · ${archivedCount}`} size="sm" active={showArchived} aria-pressed={showArchived} onClick={() => { setShowArchived(!showArchived); setSelected(new Set()); }} />
  </>;
  const allHidden = ids.length > 0 && ids.every((id) => assets[id]?.userHidden);
  const allPicked = list.length > 0 && list.every((a) => selected.has(a.id));

  return (
    <>
      <div className="gallery-controls generated-controls">
        <div className="pc-bar">
          <div className="pc-grp pc-left">
            {source}
            <div className="pc-icons">
              <PanelPopover icon={LayoutGrid} label="View">
                <div className="sv-row"><span className="sv-label">Layout</span><LayoutSegmented value={view} onChange={setView} tiles /></div>
                <div className="sv-row"><span className="sv-label">Sort</span><SortSegmented sort={sort} onChange={setSort} /></div>
                {view === 'card' ? <div className="sv-row"><span className="sv-label">Grid size</span><GridSizeSlider cols={cols} setCols={setCols} expanded={expanded} /></div> : null}
              </PanelPopover>
              <PanelPopover icon={Funnel} label="Filters" dot={filtered}>
                <div className="sv-row">
                  <span className="sv-label">Canvas</span>
                  <CanvasFilter value={canvas} counts={canvasCounts} onChange={setCanvas} />
                </div>
                <PlaceModeFilter place={place} mode={mode} placeCounts={facets.places} modeCounts={facets.modes} onPlace={setPlace} onMode={setMode} />
                <Button size="sm" variant="ghost" disabled={!filtered} onClick={() => { setCanvas('all'); setPlace('all'); setMode('all'); setSelected(new Set()); }}>Clear filters</Button>
              </PanelPopover>
              <SearchToggle value={q} onChange={setQ} placeholder="Search prompts and models" inputLabel="Search assets" hint={`${results.length} ${results.length === 1 ? 'result' : 'results'}`} />
            </div>
          </div>
          <div className="pc-grp pc-right">
            <div className="pc-grp pc-center" role="group" aria-label="Filter assets by type">
              {KINDS.map(({ id, label, icon }) => <IconButton key={id} icon={icon} label={label} size="sm" active={kind === id} aria-pressed={kind === id} onClick={() => setKind(kind === id ? 'all' : id)} />)}
              <button type="button" className={`canvas-tab${kind === 'all' ? ' is-on' : ''}`} aria-pressed={kind === 'all'} onClick={() => setKind('all')}>All</button>
            </div>
            <div className="pc-flags"><button type="button" className={`canvas-tab${group === 'session' ? ' is-on' : ''}`} aria-pressed={group === 'session'} onClick={() => setGroup(group === 'session' ? 'date' : 'session')}><Folder size={14} strokeWidth={1.75} />Sessions</button><IconButton icon={Star} label="Favorites only" size="sm" active={favOnly} aria-pressed={favOnly} onClick={() => setFavOnly(!favOnly)} /></div>
            {chrome}
          </div>
        </div>
      </div>
      <div className="pc-split">
      <div className="pc-main">
      <div className="pc-sub">
        {running ? <div className="gallery-count faint num"><span className="running-pill num">{running} running</span></div> : null}
        {kind !== 'all' || filtered || favOnly ? (
          <div className="sessions-active">
            {canvas !== 'all' ? <button type="button" className="active-chip" onClick={() => setCanvas('all')}>{CANVAS_LABEL[canvas]} <X size={11} /></button> : null}
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
            <IconButton icon={allHidden ? Eye : EyeOff} label={allHidden ? 'Unhide' : 'Hide'} size="sm" onClick={() => { setUserHidden('asset', ids, !allHidden); setSelected(new Set()); }} />
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
      <div className="gallery-scroll" data-col-scope style={view === 'list' ? widthVars(colWidths) : undefined}>
        {results.length || hiddenCount || archivedCount || showHidden || showArchived ? view === 'list' ? <ListHeader heads={LIBRARY_HEADS} sort={sort} onSort={setSort} widths={colWidths} onResize={setColWidths} end={shelfToggles} /> : <ListHeader heads={LIBRARY_HEADS} sort={sort} onSort={setSort} strip end={shelfToggles} /> : null}
        {results.length ? (
          groups.map((g) => {
            const gids = g.items.flatMap((x) => (x.type === 'asset' ? [x.id] : []));
            const picked = gids.filter((id) => selected.has(id)).length;
            const tiles = g.items.map((a) => ({
              id: a.id,
              ratio: a.type === 'asset' && a.asset.width > 0 && a.asset.height > 0 ? a.asset.width / a.asset.height : 1,
              node: a.type === 'text' ? <LibraryTextTile g={a.generation} view={view} /> : <GalleryTile asset={a.asset} view={view} selected={selected.has(a.id)} selecting={selecting} onToggle={() => toggle(a.id)} onOpen={() => open(a.asset)} />,
            }));
            return (
              <section key={g.id} className="date-group">
                {g.label ? (
                  <h4 className="date-head">
                    {gids.length ? <GroupCheck label={g.label} state={picked === 0 ? 'none' : picked === gids.length ? 'all' : 'some'} onToggle={() => setSelected((cur) => { const n = new Set(cur); for (const id of gids) { if (picked === gids.length) n.delete(id); else n.add(id); } return n; })} /> : null}
                    {g.label} <span className="faint num">{g.items.length}</span>
                  </h4>
                ) : null}
                {view === 'card'
                  ? <JustifiedGrid className="gallery-grid library-layout-card" items={tiles} rowHeight={rowHeightFor((expanded ? 10 : 7) - cols)} />
                  : <div className={`gallery-grid library-layout-${view}${view === 'list' ? ' pc-cols' : ''}`}>{tiles.map((t) => <Fragment key={t.id}>{t.node}</Fragment>)}</div>}
              </section>
            );
          })
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
