import { useState, type ReactNode } from 'react';
import { ArrowDownAZ, ArrowUpZA, Box, ExternalLink, Grid2X2, Maximize2, Minimize2, Palette, Shapes, Tag, Trash, UserRound, X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { deleteSubject, SUBJECT_KINDS } from '../../engine/actions';
import { IconButton } from '../ui/primitives';
import { InlineSlider } from '../designer/InlineControls';
import { AssetMedia } from '../ui/AssetMedia';
import type { Subject, SubjectKind } from '../../engine/types';
import { usePanelExpanded } from '../shell/panelEmbed';
import { usePref } from '../ui/hooks';
import { SearchToggle, CardMenu, CategoryRail, MenuConfirm, MenuItem, Sep, ViewToggle, asItemView, useTapReveal, type ItemView, type RailItem } from '../ui/PanelControls';
import { GeneratedAssets } from './GeneratedAssets';
import './GalleryLayout.css';

type Category = 'all' | SubjectKind;
const SUBJECT_ICONS = { character: UserRound, object: Shapes, product: Tag, location: Box, style: Palette } as const;
/** All shows what was generated; each category shows the saved library items of that kind. */
const ORDER: SubjectKind[] = ['character', 'location', 'product', 'object', 'style'];
const RAIL: RailItem<Category>[] = [{ id: 'all', label: 'All', icon: Grid2X2 }, ...ORDER.map((k) => ({ id: k, label: SUBJECT_KINDS.find((x) => x.value === k)!.label, icon: SUBJECT_ICONS[k] }))];

/** Assets: every generation and upload, and the library of saved characters, locations, products, objects and styles. */
export function GalleryPanel() {
  const { expanded, embedded } = usePanelExpanded();
  const [category, setCategory] = useState<Category>('all');
  const [stored, setStored] = usePref<ItemView>('ogs.libraryView', 'card');
  const view = asItemView(stored);
  const [cols, setCols] = useState(3);
  // Each view renders its top bar across the whole panel, then this rail beside its results.
  const rail = <CategoryRail items={RAIL} value={category} onChange={setCategory} expanded={expanded} label="Library categories" />;
  return (
    <div className="gallery" role="region" aria-label="Library">
      {embedded ? null : (
        <div className="library-toolbar">
          <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
          <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Collapse' : 'Expand'} size="sm" onClick={() => setUi({ panelExpanded: !expanded })} />
        </div>
      )}
      {category === 'all' ? <GeneratedAssets rail={rail} view={view} setView={setStored} cols={cols} setCols={setCols} /> : <LibraryAssets rail={rail} kind={category} view={view} setView={setStored} cols={cols} setCols={setCols} />}
    </div>
  );
}

function LibraryAssets({ rail, kind, view, setView, cols, setCols }: { rail: ReactNode; kind: SubjectKind; view: ItemView; setView: (v: ItemView) => void; cols: number; setCols: (c: number) => void }) {
  const library = useStore((s) => s.library);
  const { expanded } = usePanelExpanded();
  const [q, setQ] = useState('');
  const [asc, setAsc] = useState(true);
  const needle = q.trim().toLowerCase();
  const list = library.filter((x) => (x.kind ?? 'character') === kind && x.name.toLowerCase().includes(needle)).sort((a, b) => (asc ? 1 : -1) * a.name.localeCompare(b.name));
  return (
    <>
      <div className="gallery-controls generated-controls">
        <div className="pc-bar">
          <div className="pc-grp">
            <SearchToggle value={q} onChange={setQ} placeholder="Search saved items" inputLabel="Search saved items" />
            <IconButton icon={asc ? ArrowDownAZ : ArrowUpZA} label="Sort by name" size="sm" active aria-pressed data-tip={`Sort by name · ${asc ? 'A → Z' : 'Z → A'}`} onClick={() => setAsc(!asc)} />
          </div>
          <div className="pc-grp pc-right">
            {view === 'card' ? <>
              <div className="pc-size"><InlineSlider label="Grid size" value={(expanded ? 10 : 7) - cols} min={2} max={expanded ? 8 : 5} onChange={(value) => setCols((expanded ? 10 : 7) - value)} /></div>
              <Sep />
            </> : null}
            <ViewToggle value={view} onChange={setView} />
          </div>
        </div>
      </div>
      <div className="pc-split">
        {rail}
        <div className="pc-main">
          <div className="gallery-scroll">
            {list.length ? (
              <div className={`gallery-grid library-layout-${view}`} style={{ ['--cols' as string]: cols }}>
                {list.map((x) => <LibraryTile key={x.id} item={x} view={view} />)}
              </div>
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
  const menu = <span className="pc-tools"><CardMenu label={`More actions for @${item.name}`} className="pc-hover">{(close) => confirming
    ? <MenuConfirm text={`Remove @${item.name} from the library? Its images stay in Generated.`} action="Remove" onCancel={() => setConfirming(false)} onConfirm={() => { deleteSubject(item.id); close(); }} />
    : <>
      <MenuItem icon={ExternalLink} disabled={!cover} onClick={() => { open(); close(); }}>{`Open @${item.name}`}</MenuItem>
      <MenuItem icon={Trash} tone="danger" onClick={() => setConfirming(true)}>{`Remove @${item.name} from the library`}</MenuItem>
    </>}</CardMenu></span>;
  if (view === 'list') {
    return <div className="g-tile lib-tile pc-row">
      <button type="button" className="g-open pc-thumb" aria-label={`Open @${item.name}`} onClick={open}>{cover ? <AssetMedia assetId={cover} hoverPlay={false} /> : null}</button>
      <span className="pc-text"><span className="pc-info-title">@{item.name}</span><span className="pc-info-sub">{item.description || SUBJECT_KINDS.find((k) => k.value === (item.kind ?? 'character'))?.label}</span></span>
      {menu}
    </div>;
  }
  return (
    <div className={`g-tile lib-tile pc-card${tap.armed ? ' is-armed' : ''}`}>
      <button type="button" className="g-open" aria-label={`Open @${item.name}`} onPointerDown={tap.onPointerDown} onClick={tap.onClick}>
        {cover ? <AssetMedia assetId={cover} /> : null}
      </button>
      {menu}
      <div className="pc-info pc-hover"><span className="pc-info-title">@{item.name}</span></div>
    </div>
  );
}
