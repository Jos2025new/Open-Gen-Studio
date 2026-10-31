import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Folder, Minus, Plus, type LucideIcon } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import type { AssetKind } from '../../engine/types';
import { connectedProviders, modelsOf } from '../../engine/catalog';
import { groupVariants } from '../../engine/variants';
import { AssetMedia } from '../ui/AssetMedia';
import { CREATE, SPACES, TOOLS_MAIN, TOOLS_MORE, isListed, openCreate, openSpace, openTool, type CreateItem, type ToolItem } from './navModel';
import { PanelEmbed } from './panelEmbed';
import { SessionsPanel } from './SessionsPanel';
import { GalleryPanel } from '../gallery/GalleryPanel';
import { HomeHero } from './HomeHero';
import { visibleSessions } from '../../store/spaceSession';
import { SessionRow, sessionStats } from './SessionRow';

/** A section head: one title size for every section, a quiet line beside it, and its link on the right. */
function Head({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <header className="home-head">
    <h2 className="home-title">{title}</h2>{hint ? <span className="home-hint">{hint}</span> : null}
    {action}
  </header>;
}

const SeeAll = ({ label, onClick }: { label: string; onClick: () => void }) => <button type="button" className="home-link" onClick={onClick}>{label}<ArrowRight size={12} /></button>;

const APP_BLURB: Record<CreateItem['id'], string> = { image: 'Generate and edit', video: 'Text or image to clip', audio: 'Voice, music, effects', model3d: 'Models from images' };

/** An app: the user's latest result of its kind as the cover (its tint when there is none), fading into the card's ink
 *  like Sessions and Library cards; a tinted icon box, its name and one line; a muted count of model families the
 *  user's keys reach (none when zero). */
function AppCard({ item, families, cover }: { item: CreateItem; families: number; cover?: string }) {
  return <button type="button" className={`home-app pc-inked t-${item.id}${cover ? ' has-cover' : ''}`} disabled={item.soon} onClick={() => openCreate(item)} aria-label={item.soon ? `${item.label} — soon` : item.label} title={item.hint}>
    {cover ? <span className="home-app-cover" aria-hidden><AssetMedia assetId={cover} hoverPlay={false} autoPlay={false} draggable={false} /></span> : null}
    <span className="home-app-icon"><item.icon size={22} strokeWidth={1.6} aria-hidden /></span>
    <span className="home-app-text">
      <span className="home-app-title">{item.label}{item.soon ? <span className="home-pill">Soon</span> : null}</span>
      <span className="home-app-hint">{APP_BLURB[item.id]}</span>
    </span>
    {!item.soon && families > 0 && <span className="home-app-count" title="Models you can use">{families}</span>}
  </button>;
}

/** A deeper workspace: its latest result as the preview (its icon when there is none), its name, a hint and its action. */
function SpaceCard({ icon: Icon, title, hint, cover, disabled, onClick }: { icon: LucideIcon; title: string; hint: string; cover?: string; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" className="home-space pc-inked" disabled={disabled} onClick={onClick} aria-label={disabled ? `${title} — soon` : title}>
    <span className={`home-space-preview${cover ? ' has-cover' : ''}`} aria-hidden>{cover ? <AssetMedia assetId={cover} hoverPlay={false} autoPlay={false} draggable={false} /> : null}<Icon size={cover ? 20 : 40} strokeWidth={1.4} /></span>
    <span className="home-space-text"><span className="home-space-title">{title}</span><span className="home-space-hint">{hint}</span></span>
    <span className="home-space-action">{disabled ? <span className="home-pill">Soon</span> : <>Open <ArrowRight size={12} /></>}</span>
  </button>;
}

const TOOL_SLOT = 156; // matches .home-tool width
const TOOL_GAP = 8; // matches the row's column gap

/** The tools as tiles (icon and name) in one row: as many main tools as fit, with "More" always last. "More" expands the row downward, with the rest, into "Less". */
export function ToolsRow({ defaultMore = false }: { defaultMore?: boolean }) {
  const [more, setMore] = useState(defaultMore);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Slots for main tools beside "More": before the first measurement, all of them.
  const fit = width === undefined ? TOOLS_MAIN.length : Math.max(0, Math.min(TOOLS_MAIN.length, Math.floor((width + TOOL_GAP) / (TOOL_SLOT + TOOL_GAP)) - 1));
  const items: ToolItem[] = more ? [...TOOLS_MAIN, ...TOOLS_MORE] : TOOLS_MAIN.slice(0, fit);
  return <div ref={row} className={`home-tools ${more ? 'is-expanded' : ''}`}>
    {items.map((t) => <button key={t.id} type="button" className="home-tool" onClick={() => openTool(t)}>
      <span className="home-tool-icon"><t.icon size={18} strokeWidth={1.6} /></span>
      <span className="home-tool-label">{t.label}</span>
    </button>)}
    <button type="button" className="home-tool home-tool-more" onClick={() => setMore(!more)} aria-expanded={more}>
      <span className="home-tool-icon">{more ? <Minus size={18} strokeWidth={1.6} /> : <Plus size={18} strokeWidth={1.6} />}</span>
      <span className="home-tool-label">{more ? 'Less' : 'More'}</span>
    </button>
  </div>;
}

type HomeTab = NonNullable<ReturnType<typeof useStore.getState>['ui']['homeTab']>;
const TABS: Array<[HomeTab, string]> = [['home', 'Home'], ['projects', 'Projects'], ['sessions', 'Sessions'], ['gallery', 'Library']];

export function HomeView() {
  const assets = useStore((s) => s.assets);
  const generations = useStore((s) => s.generations);
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeSessionId);
  // The catalog and the keys decide which models count: re-count when either changes.
  const catalog = useStore((s) => s.catalog.models);
  const keys = useStore((s) => s.settings.keys);
  const tab: HomeTab = useStore((s) => s.ui.homeTab) ?? 'home';
  const setTab = (t: HomeTab) => setUi({ homeTab: t });
  const listed = useMemo(() => Object.values(assets).filter(isListed), [assets]);
  const recentSessions = useMemo(() => visibleSessions(sessions).filter((s) => !s.archived).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [sessions]);
  const byDate = useMemo(() => [...listed].sort((a, b) => b.createdAt - a.createdAt), [listed]);
  const recentAssets = byDate.slice(0, 6);
  const stats = useMemo(() => sessionStats(assets, generations), [assets, generations]);
  // Covers: the newest picture (image or video) of each kind, and the newest from Canvas and from Designer.
  const covers = useMemo(() => {
    const visual = byDate.filter((a) => a.kind === 'image' || a.kind === 'video');
    const from = (origin: 'node' | 'designer') => visual.find((a) => generations[a.generationId ?? '']?.origin === origin || (origin === 'designer' && a.origin === 'design'))?.id;
    return { image: visual.find((a) => a.kind === 'image')?.id, video: visual.find((a) => a.kind === 'video')?.id, node: from('node'), designer: from('designer') };
  }, [byDate, generations]);
  // Families, as the model picker groups its variants: one entry per model the user's keys reach.
  const families = useMemo(() => Object.fromEntries(CREATE.map((c) => [c.kind as AssetKind, groupVariants(modelsOf(c.kind), connectedProviders()).length])) as Record<AssetKind, number>, [catalog, keys]);

  return <div className="home" role="region" aria-label="Home"><div className="home-inner">
    <nav className="home-tabs" aria-label="Home sections">
      {TABS.map(([id, label]) => <button key={id} type="button" className={`home-tab ${tab === id ? 'is-active' : ''}`} aria-current={tab === id ? 'page' : undefined} disabled={id === 'projects'} title={id === 'projects' ? 'Coming soon' : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {tab === 'sessions' || tab === 'gallery' ? <PanelEmbed.Provider value><div className={`side-panel is-expanded home-embed panel-${tab}`}>{tab === 'sessions' ? <SessionsPanel /> : <GalleryPanel />}</div></PanelEmbed.Provider> : <>
    <HomeHero />

    <section className="home-section" aria-label="Latest">
      <Head title="Pick up where you left off" hint={recentSessions.length ? `${recentSessions.length} recent` : undefined} action={<SeeAll label="All sessions" onClick={() => setTab('sessions')} />} />
      {recentSessions.length ? <div className="home-continue">
        {recentSessions.map((s) => <SessionRow key={s.id} session={s} active={s.id === activeId} stats={stats.get(s.id)} view="card" basis="updated" selecting={false} selected={false} />)}
      </div> : <p className="home-empty">No sessions yet. Describe something above to start one.</p>}
      <div className="home-sub"><span>Latest in Library</span><SeeAll label="Library" onClick={() => setTab('gallery')} /></div>
      <div className="home-thumbs">
        {recentAssets.length ? recentAssets.map((a) => <button key={a.id} type="button" className="home-thumb" aria-label={a.name || `Open ${a.kind}`} onClick={() => setUi({ lightbox: { assetIds: recentAssets.map((x) => x.id), index: recentAssets.indexOf(a) } })}>
          <AssetMedia assetId={a.id} hoverPlay={false} autoPlay={false} draggable={false} />
        </button>) : <p className="home-empty">Nothing generated yet.</p>}
      </div>
    </section>

    <section className="home-section" aria-label="Apps">
      <Head title="Apps ready to go" hint="Start with one kind of media" />
      <div className="home-apps">
        {CREATE.map((c) => <AppCard key={c.id} item={c} families={families[c.kind] ?? 0} cover={covers[c.kind as 'image' | 'video']} />)}
      </div>
    </section>

    <section className="home-section" aria-label="Tools">
      <Head title="Make more with AI tools" hint="Edit what you already have" />
      <ToolsRow />
    </section>

    <section className="home-section" aria-label="For deeper work">
      <Head title="For deeper work" hint="Spaces for longer projects" />
      <div className="home-deep">
        <SpaceCard icon={SPACES[1].icon} title="Canvas" hint={SPACES[1].hint} cover={covers.node} onClick={() => openSpace(SPACES[1])} />
        <SpaceCard icon={SPACES[2].icon} title="Designer" hint={SPACES[2].hint} cover={covers.designer} onClick={() => openSpace(SPACES[2])} />
        <SpaceCard icon={Folder} title="Projects" hint="Group sessions and files" disabled />
      </div>
    </section>
  </>}
  </div></div>;
}
