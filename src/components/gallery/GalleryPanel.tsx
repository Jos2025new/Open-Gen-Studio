import { useState, type ReactNode } from 'react';
import { Box, ExternalLink, Eye, EyeOff, Funnel, Grid2X2, LayoutGrid, Maximize2, Minimize2, Palette, Shapes, Tag, Trash, UserRound, X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { setUserHidden } from '../../store/userHidden';
import { deleteSubject, SUBJECT_KINDS } from '../../engine/actions';
import { Button, IconButton } from '../ui/primitives';
import { AssetMedia } from '../ui/AssetMedia';
import type { Subject, SubjectKind } from '../../engine/types';
import { usePanelExpanded } from '../shell/panelEmbed';
import { usePref } from '../ui/hooks';
import { SearchToggle, CardMenu, GridSizeSlider, LayoutSegmented, MenuConfirm, MenuItem, PanelPopover, SortSegmented, SourceSelect, ToggleRow, asItemView, useTapReveal, type ItemView, type RailItem, type SortState } from '../ui/PanelControls';
import { JustifiedGrid } from '../ui/JustifiedGrid';
import { rowHeightFor } from '../../lib/justifiedRows';
import { GeneratedAssets } from './GeneratedAssets';
import './GalleryLayout.css';

type Category = 'all' | SubjectKind;
const SUBJECT_ICONS = { character: UserRound, object: Shapes, product: Tag, location: Box, style: Palette } as const;
/** All shows what was generated; each category shows the saved library items of that kind. */
const ORDER: SubjectKind[] = ['character', 'location', 'product', 'object', 'style'];
const SOURCES: RailItem<Category>[] = [{ id: 'all', label: 'All', icon: Grid2X2 }, ...ORDER.map((k) => ({ id: k, label: SUBJECT_KINDS.find((x) => x.value === k)!.label, icon: SUBJECT_ICONS[k] }))];

/** Assets: every generation and upload, and the library of saved characters, locations, products, objects and styles. */
export function GalleryPanel() {
  const { expanded, embedded } = usePanelExpanded();
  const [category, setCategory] = useState<Category>('all');
  const [stored, setStored] = usePref<ItemView>('ogs.libraryView', 'card');
  const view = asItemView(stored);
  const [cols, setCols] = useState(3);
  // Each view renders its top bar across the whole panel; the source selector is the first control of that bar.
  const chrome = embedded ? null : <div className="pc-chrome">
    <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Collapse' : 'Expand'} size="sm" onClick={() => setUi({ panelExpanded: !expanded })} />
    <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
  </div>;
  const library = useStore((st) => st.library);
  const counts = (k: SubjectKind) => library.filter((x) => (x.kind ?? 'character') === k && !x.userHidden).length;
  const source = <SourceSelect items={SOURCES.map((x) => (x.id === 'all' ? x : { ...x, count: counts(x.id as SubjectKind) }))} value={category} onChange={setCategory} label="Library source" separatorAfter="all" />;
  return (
    <div className="gallery" role="region" aria-label="Library">
      {category === 'all' ? <GeneratedAssets source={source} chrome={chrome} view={view} setView={setStored} cols={cols} setCols={setCols} /> : <LibraryAssets source={source} chrome={chrome} kind={category} view={view} setView={setStored} cols={cols} setCols={setCols} />}
    </div>
  );
}

function LibraryAssets({ source, chrome, kind, view, setView, cols, setCols }: { source: ReactNode; chrome: ReactNode; kind: SubjectKind; view: ItemView; setView: (v: ItemView) => void; cols: number; setCols: (c: number) => void }) {
  const library = useStore((s) => s.library);
  const assets = useStore((s) => s.assets);
  const { expanded } = usePanelExpanded();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortState>({ by: 'name', asc: true });
  const asc = sort.asc;
  const [showHidden, setShowHidden] = useState(false);
  const needle = q.trim().toLowerCase();
  const list = library.filter((x) => (x.kind ?? 'character') === kind && x.name.toLowerCase().includes(needle) && (showHidden || !x.userHidden)).sort((a, b) => (asc ? 1 : -1) * a.name.localeCompare(b.name));
  return (
    <>
      <div className="gallery-controls generated-controls">
        <div className="pc-bar">
          <div className="pc-grp pc-left">{source}</div>
          <div className="pc-grp pc-right">
            <div className="pc-icons">
              <PanelPopover icon={LayoutGrid} label="View">
                <div className="sv-row"><span className="sv-label">Layout</span><LayoutSegmented value={view} onChange={setView} /></div>
                <div className="sv-row"><span className="sv-label">Sort</span><SortSegmented sort={sort} onChange={setSort} nameOnly /></div>
                {view === 'card' ? <div className="sv-row"><span className="sv-label">Grid size</span><GridSizeSlider cols={cols} setCols={setCols} expanded={expanded} /></div> : null}
              </PanelPopover>
              <PanelPopover icon={Funnel} label="Filters" dot={showHidden}>
                <ToggleRow label="Show hidden" count={library.filter((x) => x.userHidden).length} checked={showHidden} onChange={setShowHidden} />
                <Button size="sm" variant="ghost" disabled={!showHidden} onClick={() => setShowHidden(false)}>Clear filters</Button>
              </PanelPopover>
              <SearchToggle value={q} onChange={setQ} placeholder="Search saved items" inputLabel="Search saved items" hint={`${list.length} item${list.length === 1 ? '' : 's'}`} />
            </div>
            {chrome}
          </div>
        </div>
      </div>
      <div className="pc-split">
        <div className="pc-main">
          <div className="gallery-scroll">
            {list.length ? (
              view === 'card'
                ? <JustifiedGrid className="gallery-grid library-layout-card" rowHeight={rowHeightFor((expanded ? 10 : 7) - cols)} items={list.map((x) => { const a = assets[x.frontalAssetId ?? x.videoAssetId ?? '']; return { id: x.id, ratio: a && a.width > 0 && a.height > 0 ? a.width / a.height : 1, node: <LibraryTile item={x} view={view} /> }; })} />
                : <div className="gallery-grid library-layout-list">{list.map((x) => <LibraryTile key={x.id} item={x} view={view} />)}</div>
            ) : (
              <div className="empty-block">
                <p>{library.some((x) => (x.kind ?? 'character') === kind) ? 'Nothing matches this search.' : 'Save a result with Send to → Save to library, or let the agent create references. Mention them as @Name in any prompt.'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function LibraryTile({ item, view }: { item: Subject; view: ItemView }) {
  const cover = item.frontalAssetId ?? item.videoAssetId;
  const open = () => cover && setUi({ lightbox: { assetIds: [cover, ...item.refAssetIds], index: 0 } });
  const tap = useTapReveal(open);
  const [confirming, setConfirming] = useState(false);
  const hiddenMark = item.userHidden ? <span className="pc-hidden-badge" title="Hidden"><EyeOff size={12} /></span> : null;
  const menu = <span className="pc-tools"><CardMenu label={`More actions for @${item.name}`} className="pc-hover">{(close) => confirming
    ? <MenuConfirm text={`Remove @${item.name} from the library? Its images stay in Generated.`} action="Remove" onCancel={() => setConfirming(false)} onConfirm={() => { deleteSubject(item.id); close(); }} />
    : <>
      <MenuItem icon={ExternalLink} disabled={!cover} onClick={() => { open(); close(); }}>{`Open @${item.name}`}</MenuItem>
      <MenuItem icon={item.userHidden ? Eye : EyeOff} onClick={() => { setUserHidden('subject', [item.id], !item.userHidden); close(); }}>{item.userHidden ? 'Unhide' : 'Hide'}</MenuItem>
      <MenuItem icon={Trash} tone="danger" onClick={() => setConfirming(true)}>{`Remove @${item.name} from the library`}</MenuItem>
    </>}</CardMenu></span>;
  if (view === 'list') {
    return <div className={`g-tile lib-tile pc-row${item.userHidden ? ' is-hidden-item' : ''}`}>
      <button type="button" className="g-open pc-thumb" aria-label={`Open @${item.name}`} onClick={open}>{cover ? <AssetMedia assetId={cover} hoverPlay={false} /> : null}</button>
      <span className="pc-text"><span className="pc-info-title">@{item.name}</span><span className="pc-info-sub">{item.description || SUBJECT_KINDS.find((k) => k.value === (item.kind ?? 'character'))?.label}</span></span>
      {hiddenMark}{menu}
    </div>;
  }
  return (
    <div className={`g-tile lib-tile pc-card${item.userHidden ? ' is-hidden-item' : ''}${tap.armed ? ' is-armed' : ''}`}>
      <button type="button" className="g-open" aria-label={`Open @${item.name}`} onPointerDown={tap.onPointerDown} onClick={tap.onClick}>
        {cover ? <AssetMedia assetId={cover} /> : null}
      </button>
      {menu}{hiddenMark}
      <div className="pc-info pc-hover"><span className="pc-info-title">@{item.name}</span></div>
    </div>
  );
}
