import { useRef, useState, type ReactNode } from 'react';
import {
  Box, ChevronLeft, Eye, EyeOff, Funnel, Grid2X2, History, Layers, LayoutGrid, Maximize2, MessageSquare,
  Minimize2, Palette, Pencil, PenTool, Plus, Shapes, Sparkles, Tag, Trash, Type, UserRound, Workflow, X, type LucideIcon,
} from '../ui/icons';
import { setComposer, setUi, toast, useStore } from '../../store/store';
import { setUserHidden } from '../../store/userHidden';
import { deleteSubject, SUBJECT_KINDS } from '../../engine/actions';
import { isKit, KIT_KINDS, KIT_KIND_LIST, type KitKind, type KitVersionRef } from '../../engine/libraryTypes';
import { kitUsedBy, subjectAssetIds } from '../../engine/libraryGraph';
import { createItem, deleteItem, libraryToDesigner, libraryToStudio, readKitVersion, restoreItemVersion, saveItem } from '../../engine/libraryVersions';
import { insertComponent } from '../../engine/libraryInsert';
import { kitImageAssetIds, libraryToNodes } from '../../engine/flow/fromLibrary';
import { focusNodes } from '../../engine/flow/selection';
import { KIT_META, newKitName, useNewKit } from './newKit';
import { KitTokens } from './KitTokens';
import { KitPage } from './KitPage';
import { hasSections } from '../../engine/librarySections';
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
import { FontTile, UploadFonts, useFontUses } from './FontTile';
import { GeneratedAssets } from './GeneratedAssets';
import './GalleryLayout.css';

type LibraryKind = SubjectKind | KitKind | 'font';
type Category = 'all' | LibraryKind;
type OpenSpace = 'studio' | 'designer' | 'nodes';
const SUBJECT_ICONS: Record<SubjectKind, LucideIcon> = { character: UserRound, object: Shapes, product: Tag, location: Box, style: Palette };
/** All shows everything; each category shows the saved library items of that kind. */
const ORDER: SubjectKind[] = ['character', 'location', 'product', 'object', 'style'];
const isKitKind = (k: string): k is KitKind => Object.prototype.hasOwnProperty.call(KIT_KINDS, k);
const itemKind = (x: Subject): LibraryKind => (isKit(x) ? (x.kind as KitKind) : ((x.kind as SubjectKind | 'font' | undefined) ?? 'character'));
const spaceOf = (w: Workspace): OpenSpace => (w === 'chat' ? 'studio' : w === 'node' ? 'nodes' : 'designer');
const SOURCES: RailItem<Category>[] = [
  { id: 'all', label: 'All', icon: Grid2X2 },
  ...ORDER.map((k) => ({ id: k, label: SUBJECT_KINDS.find((x) => x.value === k)!.label, icon: SUBJECT_ICONS[k] })),
  ...KIT_KIND_LIST.map((k) => ({ id: k, label: KIT_META[k].label, icon: KIT_META[k].icon })),
  { id: 'font', label: 'Fonts', icon: Type },
];
function coverOf(item: Subject, assets: Record<string, Asset>): string | undefined {
  if (!isKit(item)) return item.frontalAssetId ?? item.videoAssetId;
  const last = item.versions?.at(-1);
  const ver = last?.id === item.versionId ? last : item.versions?.find((v) => v.id === item.versionId) ?? last;
  const gAssets = (item.graph?.nodes ?? []).map((n) => (n.data.kind === 'asset' ? n.data.assetId ?? undefined : undefined));
  const hasImage = (id?: string): id is string => Boolean(id && assets[id]?.kind === 'image');
  return [item.frontalAssetId, ...gAssets, ...(ver?.assetIds ?? [])].find(hasImage) ?? subjectAssetIds(item).find(hasImage);
}
const entryRatio = (item: Subject, assets: Record<string, Asset>): number => { const a = assets[coverOf(item, assets) ?? '']; return a && a.width > 0 && a.height > 0 ? a.width / a.height : 1; };
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
  const [cols, setCols] = useState(3), [openKit, setOpenKit] = usePref<string | null>('ogs.libraryKit', null);
  const chrome = embedded ? null : <div className="pc-chrome">
    <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? 'Collapse' : 'Expand'} size="sm" onClick={() => setUi({ panelExpanded: !expanded })} />
    <IconButton icon={X} label="Close" size="sm" onClick={() => setUi({ panel: null })} />
  </div>;
  const library = useStore((st) => st.library), assets = useStore((st) => st.assets), sessionId = useStore((st) => st.activeSessionId), workspace = useStore((st) => st.ui.workspace);
  const uses = useFontUses(), others = otherFonts(library, uses);
  const counts = (k: LibraryKind) => [...library, ...others].filter((x) => itemKind(x) === k && !x.userHidden).length;
  const items = SOURCES.map((x) => (x.id === 'all' ? x : { ...x, count: counts(x.id as LibraryKind) }));
  const source = <SourceSelect items={items} value={category} onChange={setCategory} label="Library source" separatorAfter="all" allLabel="Library" />;
  const page = openKit ? library.find((x) => x.id === openKit && hasSections(x)) : undefined;
  if (page) {
    const inSpace = (s: Subject, space: OpenSpace) => void openKitIn(sessionId, s.id, space).catch((e) => toast((e as Error).message, 'error'));
    return <div className="gallery" role="region" aria-label="Library">
      <KitPage key={page.id} item={page} chrome={chrome} menu={<CardMenu label={`More actions for ${page.name}`}>{(close) => <KitMenuBody item={page} close={close} />}</CardMenu>} cover={(s) => coverOf(s, assets)}
        onBack={() => { setCategory(page.kind as KitKind); setOpenKit(null); }} onOpen={(s) => (hasSections(s) ? setOpenKit(s.id) : inSpace(s, spaceOf(workspace) === 'nodes' && !canOpenNodes(s, assets) ? 'designer' : spaceOf(workspace)))} onDesign={() => inSpace(page, 'designer')} />
    </div>;
  }
  return (
    <div className="gallery" role="region" aria-label="Library">
      {category === 'all'
        ? <GeneratedAssets showEntry={(x, v, cells) => ({ ratio: entryRatio(x, assets), node: x.kind === 'font' ? <FontTile item={x} uses={uses.get(x.name) ?? []} view={v} cells={cells} /> : <LibraryTile item={x} view={v} cells={cells} onOpenKit={setOpenKit} /> })} source={source} chrome={chrome} view={view} setView={setStored} cols={cols} setCols={setCols} />
        : <LibraryAssets onOpenKit={setOpenKit} source={source} chrome={chrome} kind={category} uses={uses} view={view} setView={setStored} cols={cols} setCols={setCols} />}
    </div>
  );
}

const otherFonts = (library: readonly Subject[], uses: ReturnType<typeof useFontUses>): Subject[] => [...new Set([...uses.keys(), ...library.flatMap((s) => (s.fonts ?? []).map((f) => f.family))])].filter((f) => !library.some((s) => s.kind === 'font' && s.name === f)).map((f) => ({ id: `font:${f}`, name: f, kind: 'font', refAssetIds: [] }));

function LibraryAssets({ onOpenKit, source, chrome, kind, uses, view, setView, cols, setCols }: {
  onOpenKit: (id: string) => void; source: ReactNode; chrome: ReactNode; kind: LibraryKind; uses: ReturnType<typeof useFontUses>; view: ItemView; setView: (v: ItemView) => void; cols: number; setCols: (c: number) => void;
}) {
  const library = useStore((s) => s.library), assets = useStore((s) => s.assets);
  const sessionId = useStore((s) => s.activeSessionId), workspace = useStore((s) => s.ui.workspace);
  const { expanded, embedded } = usePanelExpanded();
  const [q, setQ] = useState(''), [sort, setSort] = useState<SortState>({ by: 'name', asc: true });
  const [showHidden, setShowHidden] = useState(false), omni = useStore((s) => !!s.ui.omni);
  const needle = q.trim().toLowerCase(), kitKind = isKitKind(kind);
  // Fonts of designs and kits that are not entries of their own show as well.
  const listed = kind === 'font' ? [...library, ...otherFonts(library, uses)] : library;
  const list = listed.filter((x) => itemKind(x) === kind && x.name.toLowerCase().includes(needle) && (showHidden || !x.userHidden))
    .sort((a, b) => (sort.asc ? 1 : -1) * a.name.localeCompare(b.name));
  // Nodes has nothing to show for an empty entry: Library stays open with its new card.
  const space = omni ? 'nodes' : spaceOf(workspace);
  const { busy: creating, create } = useNewKit(sessionId, space, () => { if (space !== 'nodes') goSpace(space); });
  const emptyMsg = listed.some((x) => itemKind(x) === kind) ? 'Nothing matches this search.'
    : kitKind || kind === 'font' ? 'No saved items yet.' : 'Save a result with Send to → Save to Library, or let the agent create references. Mention them as @Name in any prompt.';
  const tile = (x: Subject) => (x.kind === 'font' ? <FontTile key={x.id} item={x} uses={uses.get(x.name) ?? []} view={view} /> : <LibraryTile key={x.id} item={x} view={view} onOpenKit={onOpenKit} />);
  const gridItems = list.map((x) => ({ id: x.id, ratio: entryRatio(x, assets), node: tile(x) }));
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
          {kind === 'font' ? <UploadFonts /> : null}
          {kitKind ? <div className="pc-flags"><Button size="sm" icon={Plus} disabled={creating} onClick={() => void create(kind as KitKind, hasSections({ kind }) ? onOpenKit : undefined)}>New</Button></div> : null}
          {chrome}
        </div>
      </div></div>
      <div className="pc-split"><div className="pc-main"><div className="gallery-scroll">
        {list.length ? (
          view === 'card'
            ? <JustifiedGrid className="gallery-grid library-layout-card" rowHeight={rowHeightFor((expanded ? 10 : 7) - cols + (embedded ? 1 : 0))} items={gridItems} />
            : <div className={`gallery-grid library-layout-${view}`}>{list.map(tile)}</div>
        ) : <div className="empty-block"><p>{emptyMsg}</p></div>}
      </div></div></div>
    </>
  );
}

type KitMenuView = 'menu' | 'versions' | 'components' | 'tokens' | 'into' | 'rename' | 'remove' | { restore: KitVersionRef };
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
  const brandKits = library.filter((s) => s.kind === 'brand-kit' && !s.userHidden), using = useStore((s) => s.composer.kitId === item.id);
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
  if (sub === 'tokens') return <>
    <MenuItem icon={ChevronLeft} onClick={() => setSub('menu')}>Tokens</MenuItem>
    <KitTokens item={item} onDone={close} />
  </>;
  if (sub === 'rename') return <>
    <MenuItem icon={ChevronLeft} onClick={() => setSub('menu')}>Rename</MenuItem>
    <form className="subject-new" onSubmit={(e) => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name') ?? '').trim(); if (name) void run(() => saveItem({ subjectId: item.id, mode: 'overwrite', space: 'library', by: 'user', name })); }}>
      <input name="name" autoFocus aria-label="Name" defaultValue={item.name} disabled={busy} />
      <Button size="sm" variant="primary" type="submit" disabled={busy}>Save</Button>
    </form>
  </>;
  if (sub === 'into') return <>
    <MenuItem icon={ChevronLeft} onClick={() => setSub('menu')}>Add to brand kit</MenuItem>
    {brandKits.map((k) => <MenuItem key={k.id} icon={KIT_META['brand-kit'].icon} disabled={busy} selected={k.kits?.includes(item.id)} onClick={() => void run(() => saveItem({ subjectId: k.id, mode: 'overwrite', space: 'library', by: 'user', kits: k.kits?.includes(item.id) ? k.kits.filter((x) => x !== item.id) : [...(k.kits ?? []), item.id] }))}>{k.name}</MenuItem>)}
    <MenuItem icon={Plus} disabled={busy} onClick={() => void run(() => createItem({ name: newKitName('brand-kit', library), kind: 'brand-kit', space: 'library', by: 'user', sessionId, kits: [item.id], draft: false, open: false }), 'Brand kit created.')}>New brand kit</MenuItem>
  </>;
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
    <MenuItem icon={Sparkles} selected={using} onClick={() => { setComposer({ kitId: using ? null : item.id }); close(); }}>Use with the agent</MenuItem>
    {KIT_KINDS[item.kind as KitKind].tokens ? <MenuItem icon={Palette} onClick={() => setSub('tokens')}>Tokens<span className="pc-count num">{Object.keys(item.tokens ?? {}).length}</span></MenuItem> : null}
    {item.kind !== 'brand-kit' ? <MenuItem icon={KIT_META['brand-kit'].icon} onClick={() => setSub('into')}>Add to brand kit</MenuItem> : null}
    <MenuItem icon={Pencil} onClick={() => setSub('rename')}>Rename</MenuItem>
    <MenuItem icon={History} disabled={!versions.length} onClick={() => setSub('versions')}>Versions<span className="pc-count num">{versions.length}</span></MenuItem>
    {designerDoc && compCount
      ? <MenuItem icon={Layers} disabled={busy} onClick={openComps}>Components<span className="pc-count num">{compCount}</span></MenuItem> : null}
    <MenuItem icon={item.userHidden ? Eye : EyeOff} onClick={() => { setUserHidden('subject', [item.id], !item.userHidden); close(); }}>{item.userHidden ? 'Unhide' : 'Hide'}</MenuItem>
    <MenuItem icon={Trash} tone="danger" onClick={() => setSub('remove')}>{`Remove ${item.name}`}</MenuItem>
  </>;
}

function LibraryTile({ item, view, cells, onOpenKit }: { item: Subject; view: ItemView; /** Its columns in a list that has them. */ cells?: ReactNode; onOpenKit: (id: string) => void }) {
  const assets = useStore((s) => s.assets), sessionId = useStore((s) => s.activeSessionId), workspace = useStore((s) => s.ui.workspace);
  const kit = isKit(item), cover = coverOf(item, assets), title = kit ? item.name : `@${item.name}`;
  const open = () => {
    if (hasSections(item)) onOpenKit(item.id);
    else if (kit) {
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
      {hiddenMark}{cells}<span className="pc-tools">{openButton('pc-go')}{menu}</span>
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
