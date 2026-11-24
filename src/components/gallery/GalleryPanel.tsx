import { useRef, useState, type ReactNode } from 'react';
import {
  BookOpen, Box, ChevronLeft, Eye, EyeOff, Funnel, Grid2X2, History, Images, Layers, LayoutGrid, Maximize2, MessageSquare,
  Minimize2, Palette, PenTool, Plus, Shapes, SwatchBook, Tag, Trash, UserRound, Workflow, X, type LucideIcon,
} from '../ui/icons';
import { setUi, toast, useStore } from '../../store/store';
import { setUserHidden } from '../../store/userHidden';
import { deleteSubject, SUBJECT_KINDS } from '../../engine/actions';
import { isKit, KIT_KINDS, type KitKind, type KitVersionRef } from '../../engine/libraryTypes';
import { kitUsedBy, subjectAssetIds } from '../../engine/libraryGraph';
import { createItem, deleteItem, libraryToDesigner, libraryToStudio, readKitVersion, restoreItemVersion } from '../../engine/libraryVersions';
import { insertComponent } from '../../engine/libraryInsert';
import { kitImageAssetIds, libraryToNodes } from '../../engine/flow/fromLibrary';
import { focusNodes } from '../../engine/flow/selection';
import { setStudioBoard } from '../../lib/studioBoard';
import { formatDateTime } from '../../lib/format';
import { Button, IconButton } from '../ui/primitives';
import { AssetMedia } from '../ui/AssetMedia';
import type { Asset, Subject, SubjectKind, Workspace } from '../../engine/types';
import { usePanelExpanded } from '../shell/panelEmbed';
import { usePref } from '../ui/hooks';
import { CardActions, Figures } from './GalleryTiles';
import { SearchToggle, CardMenu, GridSizeSlider, LayoutSegmented, MenuConfirm, MenuItem, PanelPopover, SortSegmented, SourceSelect, ToggleRow, asItemView, useTapReveal, type ItemView, type RailItem, type SortState } from '../ui/PanelControls';
import { JustifiedGrid } from '../ui/JustifiedGrid';
import { rowHeightFor } from '../../lib/justifiedRows';
import { GeneratedAssets } from './GeneratedAssets';
import './GalleryLayout.css';

type LibraryKind = SubjectKind | KitKind;
type Category = 'all' | LibraryKind;
type OpenSpace = 'studio' | 'designer' | 'nodes';
const SUBJECT_ICONS: Record<SubjectKind, LucideIcon> = { character: UserRound, object: Shapes, product: Tag, location: Box, style: Palette };
const KIT_META: Record<KitKind, { label: string; singular: string; icon: LucideIcon }> = {
  moodboard: { label: 'Moodboards', singular: 'Moodboard', icon: Images },
  'design-system': { label: 'Design systems', singular: 'Design system', icon: SwatchBook },
  'brand-kit': { label: 'Brand kits', singular: 'Brand kit', icon: BookOpen },
};
/** All shows what was generated; each category shows the saved library items of that kind. */
const ORDER: SubjectKind[] = ['character', 'location', 'product', 'object', 'style'];
const KIT_ORDER: KitKind[] = ['moodboard', 'design-system', 'brand-kit'];
const isKitKind = (k: string): k is KitKind => Object.prototype.hasOwnProperty.call(KIT_KINDS, k);
const itemKind = (x: Subject): LibraryKind => (isKit(x) ? (x.kind as KitKind) : ((x.kind as SubjectKind | undefined) ?? 'character'));
const spaceOf = (w: Workspace): OpenSpace => (w === 'chat' ? 'studio' : w === 'node' ? 'nodes' : 'designer');
const SOURCES: RailItem<Category>[] = [
  { id: 'all', label: 'All', icon: Grid2X2 },
  ...ORDER.map((k) => ({ id: k, label: SUBJECT_KINDS.find((x) => x.value === k)!.label, icon: SUBJECT_ICONS[k] })),
  ...KIT_ORDER.map((k) => ({ id: k, label: KIT_META[k].label, icon: KIT_META[k].icon })),
];
function coverOf(item: Subject, assets: Record<string, Asset>): string | undefined {
  if (!isKit(item)) return item.frontalAssetId ?? item.videoAssetId;
  const ver = item.versions?.find((v) => v.id === item.versionId) ?? item.versions?.at(-1);
  const gAssets = (item.graph?.nodes ?? []).map((n) => (n.data.kind === 'asset' ? n.data.assetId ?? undefined : undefined));
  return [item.frontalAssetId, ...gAssets, ...(ver?.assetIds ?? []), ...subjectAssetIds(item)].find((id): id is string => Boolean(id && assets[id]?.kind === 'image'));
}
const canOpenNodes = (item: Subject, assets: Record<string, Asset>) => Boolean(item.graph?.nodes.length || kitImageAssetIds(item, assets).length);
function goSpace(space: OpenSpace) {
  if (space === 'studio') setStudioBoard({ open: true, view: 'designer' });
  setUi({ workspace: space === 'studio' ? 'chat' : space === 'nodes' ? 'node' : 'designer', home: false, space: undefined, omni: false, panel: null });
}
async function openKitIn(sessionId: string, id: string, space: OpenSpace) {
  const added = space === 'nodes' ? libraryToNodes(sessionId, id).added : [];
  if (space !== 'nodes') await (space === 'studio' ? libraryToStudio : libraryToDesigner)(sessionId, id);
  goSpace(space);
  focusNodes(sessionId, added.map((n) => n.id));
}

/** Assets: every generation and upload, and the library of saved characters, locations, products, objects, styles and kits. */
export function GalleryPanel() {
  const { expanded, embedded } = usePanelExpanded();
  const [category, setCategory] = useState<Category>('all');
  const [stored, setStored] = usePref<ItemView>('ogs.libraryView', 'card');
  const view = asItemView(stored);
  const [cols, setCols] = useState(3);
  const chrome = embedded ? null : <div className="pc-chrome">
    <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Collapse' : 'Expand'} size="sm" onClick={() => setUi({ panelExpanded: !expanded })} />
    <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
  </div>;
  const library = useStore((st) => st.library);
  const counts = (k: LibraryKind) => library.filter((x) => itemKind(x) === k && !x.userHidden).length;
  const items = SOURCES.map((x) => (x.id === 'all' ? x : { ...x, count: counts(x.id as LibraryKind) }));
  const source = <SourceSelect items={items} value={category} onChange={setCategory} label="Library source" separatorAfter="all" allLabel="Library" />;
  return (
    <div className="gallery" role="region" aria-label="Library">
      {category === 'all'
        ? <GeneratedAssets source={source} chrome={chrome} view={view} setView={setStored} cols={cols} setCols={setCols} />
        : <LibraryAssets source={source} chrome={chrome} kind={category} view={view} setView={setStored} cols={cols} setCols={setCols} />}
    </div>
  );
}

function LibraryAssets({ source, chrome, kind, view, setView, cols, setCols }: {
  source: ReactNode; chrome: ReactNode; kind: LibraryKind; view: ItemView; setView: (v: ItemView) => void; cols: number; setCols: (c: number) => void;
}) {
  const library = useStore((s) => s.library), assets = useStore((s) => s.assets);
  const sessionId = useStore((s) => s.activeSessionId), workspace = useStore((s) => s.ui.workspace);
  const { expanded, embedded } = usePanelExpanded();
  const [q, setQ] = useState(''), [sort, setSort] = useState<SortState>({ by: 'name', asc: true });
  const [showHidden, setShowHidden] = useState(false), [creating, setCreating] = useState(false);
  const creatingRef = useRef(false), needle = q.trim().toLowerCase(), kitKind = isKitKind(kind);
  const list = library.filter((x) => itemKind(x) === kind && x.name.toLowerCase().includes(needle) && (showHidden || !x.userHidden))
    .sort((a, b) => (sort.asc ? 1 : -1) * a.name.localeCompare(b.name));
  const createNew = async () => {
    if (!kitKind || creatingRef.current) return;
    creatingRef.current = true; setCreating(true);
    try { const sp = spaceOf(workspace); await createItem({ name: `${KIT_META[kind].singular} ${library.filter((x) => itemKind(x) === kind).length + 1}`, kind, space: sp, by: 'user', sessionId }); goSpace(sp); }
    catch (e) { toast((e as Error).message, 'error'); } finally { creatingRef.current = false; setCreating(false); }
  };
  const emptyMsg = library.some((x) => itemKind(x) === kind) ? 'Nothing matches this search.'
    : kitKind ? 'No saved items yet.' : 'Save a result with Send to → Save to library, or let the agent create references. Mention them as @Name in any prompt.';
  const gridItems = list.map((x) => {
    const a = assets[coverOf(x, assets) ?? ''];
    return { id: x.id, ratio: a && a.width > 0 && a.height > 0 ? a.width / a.height : 1, node: <LibraryTile item={x} view={view} /> };
  });
  return (
    <>
      <div className="gallery-controls generated-controls"><div className="pc-bar">
        <div className="pc-grp pc-left">{source}
          <div className="pc-icons">
            <PanelPopover icon={LayoutGrid} label="View">
              <div className="sv-row"><span className="sv-label">Layout</span><LayoutSegmented value={view} onChange={setView} tiles /></div>
              <div className="sv-row"><span className="sv-label">Sort</span><SortSegmented sort={sort} onChange={setSort} nameOnly /></div>
              {view === 'card' ? <div className="sv-row"><span className="sv-label">Grid size</span><GridSizeSlider cols={cols} setCols={setCols} expanded={expanded} /></div> : null}
            </PanelPopover>
            <PanelPopover icon={Funnel} label="Filters" dot={showHidden}>
              <ToggleRow label="Show hidden" count={library.filter((x) => x.userHidden).length} checked={showHidden} onChange={setShowHidden} />
              <Button size="sm" variant="ghost" disabled={!showHidden} onClick={() => setShowHidden(false)}>Clear filters</Button>
            </PanelPopover>
            <SearchToggle value={q} onChange={setQ} placeholder="Search saved items" inputLabel="Search saved items" hint={`${list.length} item${list.length === 1 ? '' : 's'}`} />
          </div>
        </div>
        <div className="pc-grp pc-right">
          {kitKind ? <div className="pc-flags"><Button size="sm" icon={Plus} disabled={creating} onClick={() => void createNew()}>New</Button></div> : null}
          {chrome}
        </div>
      </div></div>
      <div className="pc-split"><div className="pc-main"><div className="gallery-scroll">
        {list.length ? (
          view === 'card'
            ? <JustifiedGrid className="gallery-grid library-layout-card" rowHeight={rowHeightFor((expanded ? 10 : 7) - cols + (embedded ? 1 : 0))} items={gridItems} />
            : <div className={`gallery-grid library-layout-${view}`}>{list.map((x) => <LibraryTile key={x.id} item={x} view={view} />)}</div>
        ) : <div className="empty-block"><p>{emptyMsg}</p></div>}
      </div></div></div>
    </>
  );
}

type KitMenuView = 'menu' | 'versions' | 'components' | 'remove' | { restore: KitVersionRef };
function KitMenuBody({ item, close }: { item: Subject; close: () => void }) {
  const sessionId = useStore((s) => s.activeSessionId), library = useStore((s) => s.library), assets = useStore((s) => s.assets);
  const session = useStore((s) => s.sessions[s.activeSessionId]), ui = useStore((s) => s.ui);
  const [sub, setSub] = useState<KitMenuView>('menu'), [busy, setBusy] = useState(false), [comps, setComps] = useState<Array<{ id: string; name: string }>>([]);
  const busyRef = useRef(false);
  const run = async (fn: () => Promise<unknown>, ok?: string, stay?: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await fn(); if (ok) toast(ok, 'success'); if (!stay) close(); } catch (e) { toast((e as Error).message, 'error'); } finally { busyRef.current = false; setBusy(false); }
  };
  const visible = session?.docs.filter((d) => d.view !== 'studio' && d.library?.view !== 'studio') ?? [];
  const designerDoc = ui.workspace === 'designer' && !ui.home ? (visible.find((d) => d.id === session?.activeDocId) ?? visible[0]) : undefined;
  const compCount = (item.kind === 'design-system' || item.kind === 'brand-kit') && item.versionId ? (item.groupIds?.length ?? 0) : 0;
  const openComps = () => void run(async () => {
    const snap = await readKitVersion(item.versionId!);
    setComps((snap?.doc?.groups ?? []).filter((g) => snap!.doc!.layers.some((l) => l.groupId === g.id)).map((g) => ({ id: g.id, name: g.name })));
    setSub('components');
  }, undefined, true);
  const versions = [...(item.versions ?? [])].reverse(), usedBy = kitUsedBy(item.id, library);
  if (sub === 'remove') {
    const why = usedBy.length ? `Used by: ${usedBy.map((u) => u.name).join(', ')}.` : 'Its images stay in Generated.';
    return <MenuConfirm text={`Remove "${item.name}" from the library? ${why}`} action="Remove" onCancel={() => setSub('menu')} onConfirm={() => void run(() => deleteItem(item.id))} />;
  }
  if (typeof sub === 'object') {
    const v = sub.restore;
    const doRestore = () => void run(() => restoreItemVersion({ subjectId: item.id, versionId: v.id, space: 'library', by: 'user' }), 'Version restored.');
    return <MenuConfirm text={`Restore version from ${formatDateTime(v.at)} (${v.by})? This creates a new version.`} action="Restore" onCancel={() => setSub('versions')} onConfirm={doRestore} />;
  }
  if (sub === 'versions') return <>
    <MenuItem icon={ChevronLeft} onClick={() => setSub('menu')}>Versions</MenuItem>
    {versions.map((v) => <MenuItem key={v.id} disabled={busy} onClick={() => setSub({ restore: v })}>{`${formatDateTime(v.at)} · ${v.by}${v.label ? ` · ${v.label}` : ''}`}</MenuItem>)}
  </>;
  if (sub === 'components' && designerDoc) return <>
    <MenuItem icon={ChevronLeft} onClick={() => setSub('menu')}>Components</MenuItem>
    {comps.map((c) => {
      const insert = () => void run(() => insertComponent(sessionId, designerDoc.id, item.id, c.id), 'Component inserted.');
      return <MenuItem key={c.id} icon={Layers} disabled={busy} onClick={insert}>{c.name}</MenuItem>;
    })}
  </>;
  return <>
    <MenuItem icon={MessageSquare} disabled={busy} onClick={() => void run(() => openKitIn(sessionId, item.id, 'studio'))}>Open in Studio</MenuItem>
    <MenuItem icon={PenTool} disabled={busy} onClick={() => void run(() => openKitIn(sessionId, item.id, 'designer'))}>Open in Designer</MenuItem>
    {canOpenNodes(item, assets) ? <MenuItem icon={Workflow} disabled={busy} onClick={() => void run(() => openKitIn(sessionId, item.id, 'nodes'))}>Open in Nodes</MenuItem> : null}
    <MenuItem icon={History} disabled={!versions.length} onClick={() => setSub('versions')}>Versions<span className="pc-count num">{versions.length}</span></MenuItem>
    {designerDoc && compCount
      ? <MenuItem icon={Layers} disabled={busy} onClick={openComps}>Components<span className="pc-count num">{compCount}</span></MenuItem> : null}
    <MenuItem icon={item.userHidden ? Eye : EyeOff} onClick={() => { setUserHidden('subject', [item.id], !item.userHidden); close(); }}>{item.userHidden ? 'Unhide' : 'Hide'}</MenuItem>
    <MenuItem icon={Trash} tone="danger" onClick={() => setSub('remove')}>{`Remove ${item.name}`}</MenuItem>
  </>;
}

function LibraryTile({ item, view }: { item: Subject; view: ItemView }) {
  const assets = useStore((s) => s.assets), sessionId = useStore((s) => s.activeSessionId), workspace = useStore((s) => s.ui.workspace);
  const kit = isKit(item), cover = coverOf(item, assets), title = kit ? item.name : `@${item.name}`;
  const open = () => {
    if (kit) {
      const sp = spaceOf(workspace);
      void openKitIn(sessionId, item.id, sp === 'nodes' && !canOpenNodes(item, assets) ? 'designer' : sp).catch((e) => toast((e as Error).message, 'error'));
    } else if (cover) setUi({ lightbox: { assetIds: [cover, ...item.refAssetIds], index: 0 } });
  };
  const tap = useTapReveal(open), [confirming, setConfirming] = useState(false);
  const kindLabel = kit ? KIT_META[item.kind as KitKind].singular : SUBJECT_KINDS.find((k) => k.value === (item.kind ?? 'character'))?.label;
  const KindIcon = kit ? KIT_META[item.kind as KitKind].icon : SUBJECT_ICONS[(item.kind as SubjectKind | undefined) ?? 'character'];
  const hiddenMark = item.userHidden ? <span className="pc-hidden-badge" title="Hidden"><EyeOff size={12} /></span> : null;
  const subRemoveText = `Remove @${item.name} from the library? Its images stay in Generated.`;
  const menu = <CardMenu label={`More actions for ${title}`} className="pc-hover">{(close) => kit ? <KitMenuBody item={item} close={close} />
    : confirming ? <MenuConfirm text={subRemoveText} action="Remove" onCancel={() => setConfirming(false)} onConfirm={() => { deleteSubject(item.id); close(); }} />
      : <>
        <MenuItem icon={item.userHidden ? Eye : EyeOff} onClick={() => { setUserHidden('subject', [item.id], !item.userHidden); close(); }}>{item.userHidden ? 'Unhide' : 'Hide'}</MenuItem>
        <MenuItem icon={Trash} tone="danger" onClick={() => setConfirming(true)}>{`Remove @${item.name} from the library`}</MenuItem>
      </>}</CardMenu>;
  const openButton = (className?: string) => (
    <Button size="sm" variant="secondary" className={className} disabled={!kit && !cover} onClick={(e) => { e.stopPropagation(); open(); }}>Open</Button>
  );
  const glyphStyle = !cover && kit && view !== 'tile' ? { display: 'grid', placeItems: 'center', color: 'var(--text-3)' } : undefined;
  const thumb = cover ? <AssetMedia assetId={cover} hoverPlay={view !== 'list'} /> : kit ? <KindIcon size={view === 'list' ? 16 : 24} /> : null;
  if (view === 'list') {
    return <div className={`g-tile lib-tile pc-row${item.userHidden ? ' is-hidden-item' : ''}`}>
      <button type="button" className="g-open pc-thumb" style={glyphStyle} aria-label={`Open ${title}`} onClick={open}>{thumb}</button>
      <span className="pc-text"><span className="pc-info-title">{title}</span><span className="pc-info-sub">{item.description || kindLabel}</span></span>
      {hiddenMark}<span className="pc-tools">{openButton('pc-go')}{menu}</span>
    </div>;
  }
  const figures = <Figures items={kit
    ? [...(item.graph?.nodes.length ? [[String(item.graph.nodes.length), 'Items'] as [string, string]] : []), [String(item.versions?.length ?? 0), 'Versions']]
    : [[String(item.refAssetIds.length), 'References'], [item.videoAssetId ? '1' : '0', 'Videos'], [kindLabel ?? '', 'Kind']]} />;
  const openCls = `g-open pc-open${!cover && kit ? ' pc-glyph-cover' : ''}`;
  return (
    <div className={`g-tile lib-tile pc-card ${view === 'tile' ? 'pc-tile' : 'pc-fade'}${item.userHidden ? ' is-hidden-item' : ''}${tap.armed ? ' is-armed' : ''}`}>
      <button type="button" className={openCls} style={glyphStyle} aria-label={`Open ${title}`} onPointerDown={tap.onPointerDown} onClick={tap.onClick}>{thumb}</button>
      {hiddenMark}
      <div className={`pc-info${view === 'card' ? ' pc-hover' : ''}`}>
        <span className="pc-info-title">{title}</span>
        {item.description ? <span className="pc-info-sub">{item.description}</span> : null}
        {figures}
        <CardActions main={openButton()}>{menu}</CardActions>
      </div>
    </div>
  );
}
