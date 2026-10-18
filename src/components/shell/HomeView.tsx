import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Folder, Minus, Plus, type LucideIcon } from 'lucide-react';
import { selectSession, setUi, useStore } from '../../store/store';
import type { AssetKind } from '../../engine/types';
import { formatRelative } from '../../lib/format';
import { connectedProviders, modelsOf } from '../../engine/catalog';
import { groupVariants } from '../../engine/variants';
import { AssetMedia } from '../ui/AssetMedia';
import { CREATE, SPACES, TOOLS_MAIN, TOOLS_MORE, isListed, openCreate, openSpace, openTool, type CreateItem, type ToolItem } from './navModel';
import { PanelEmbed } from './panelEmbed';
import { SessionsPanel } from './SessionsPanel';
import { GalleryPanel } from '../gallery/GalleryPanel';
import { HomeHero } from './HomeHero';

function Head({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) {
  return <header className="home-head">
    <div><div className="plan-kicker">{kicker}</div><h2 className="home-title">{title}</h2></div>
    {action}
  </header>;
}

const APP_BLURB: Record<CreateItem['id'], string> = { image: 'Generate and edit', video: 'Text or image to clip', audio: 'Voice, music, effects', model3d: 'Models from images' };

/** An app: a 76 px tinted icon box, its name and one line on the right; a muted count of model families the user's keys reach (none when zero). */
function AppCard({ item, families }: { item: CreateItem; families: number }) {
  return <button type="button" className={`home-app t-${item.id}`} disabled={item.soon} onClick={() => openCreate(item)} aria-label={item.soon ? `${item.label} — soon` : item.label} title={item.hint}>
    <span className="home-app-icon"><item.icon size={34} strokeWidth={1.6} aria-hidden /></span>
    <span className="home-app-text">
      <span className="home-app-title">{item.label}{item.soon ? <span className="home-pill">Soon</span> : null}</span>
      <span className="home-app-hint">{APP_BLURB[item.id]}</span>
    </span>
    {!item.soon && families > 0 && <span className="home-app-count" title="Models you can use">{families}</span>}
  </button>;
}

/** A deeper workspace: a neutral placeholder preview (no screenshots), its name, a hint and its action. */
function SpaceCard({ icon: Icon, title, hint, disabled, onClick }: { icon: LucideIcon; title: string; hint: string; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" className="home-space" disabled={disabled} onClick={onClick} aria-label={disabled ? `${title} — soon` : title}>
    <span className="home-space-preview" aria-hidden><Icon size={40} strokeWidth={1.4} /></span>
    <span className="home-space-text"><span className="home-space-title">{title}</span><span className="home-space-hint">{hint}</span></span>
    <span className="home-space-action">{disabled ? <span className="home-pill">Soon</span> : <>Open <ArrowRight size={12} /></>}</span>
  </button>;
}

/** The tools as 58 px circles. "+ More" expands the row downward into "− Less"; the list is local state. */
export function ToolsRow({ defaultMore = false }: { defaultMore?: boolean }) {
  const [more, setMore] = useState(defaultMore);
  const items: ToolItem[] = more ? [...TOOLS_MAIN, ...TOOLS_MORE] : TOOLS_MAIN;
  return <div className="home-tools">
    {items.map((t) => <button key={t.id} type="button" className="home-tool" onClick={() => openTool(t)}>
      <span className="home-tool-icon"><t.icon size={22} strokeWidth={1.6} /></span>
      <span className="home-tool-label">{t.label}</span>
    </button>)}
    <button type="button" className="home-tool home-tool-more" onClick={() => setMore(!more)} aria-expanded={more}>
      <span className="home-tool-icon">{more ? <Minus size={22} strokeWidth={1.6} /> : <Plus size={22} strokeWidth={1.6} />}</span>
      <span className="home-tool-label">{more ? '− Less' : '+ More'}</span>
    </button>
  </div>;
}

type HomeTab = NonNullable<ReturnType<typeof useStore.getState>['ui']['homeTab']>;
const TABS: Array<[HomeTab, string]> = [['home', 'Home'], ['projects', 'Projects'], ['sessions', 'Sessions'], ['gallery', 'Library']];

export function HomeView() {
  const assets = useStore((s) => s.assets);
  const sessions = useStore((s) => s.sessions);
  // The catalog and the keys decide which models count: re-count when either changes.
  const catalog = useStore((s) => s.catalog.models);
  const keys = useStore((s) => s.settings.keys);
  const tab: HomeTab = useStore((s) => s.ui.homeTab) ?? 'home';
  const setTab = (t: HomeTab) => setUi({ homeTab: t });
  const listed = useMemo(() => Object.values(assets).filter(isListed), [assets]);
  const recentSessions = useMemo(() => Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [sessions]);
  const recentAssets = useMemo(() => [...listed].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4), [listed]);
  // Families, as the model picker groups its variants: one entry per model the user's keys reach.
  const families = useMemo(() => Object.fromEntries(CREATE.map((c) => [c.kind as AssetKind, groupVariants(modelsOf(c.kind), connectedProviders()).length])) as Record<AssetKind, number>, [catalog, keys]);

  return <div className="home" role="region" aria-label="Home"><div className="home-inner">
    <nav className="home-tabs" aria-label="Home sections">
      {TABS.map(([id, label]) => <button key={id} type="button" className={`home-tab ${tab === id ? 'is-active' : ''}`} aria-current={tab === id ? 'page' : undefined} disabled={id === 'projects'} title={id === 'projects' ? 'Coming soon' : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {tab === 'sessions' || tab === 'gallery' ? <PanelEmbed.Provider value><div className={`side-panel is-expanded home-embed panel-${tab}`}>{tab === 'sessions' ? <SessionsPanel /> : <GalleryPanel />}</div></PanelEmbed.Provider> : <>
    <HomeHero />

    <section className="home-section" aria-label="Apps">
      <Head kicker="Apps" title="Apps ready to go" />
      <div className="home-apps">
        {CREATE.map((c) => <AppCard key={c.id} item={c} families={families[c.kind] ?? 0} />)}
      </div>
    </section>

    <section className="home-section" aria-label="Tools">
      <Head kicker="Tools" title="Work on what you have" />
      <ToolsRow />
    </section>

    <section className="home-section" aria-label="For deeper work">
      <Head kicker="Spaces" title="For deeper work" />
      <div className="home-deep">
        <SpaceCard icon={SPACES[1].icon} title="Canvas" hint={SPACES[1].hint} onClick={() => openSpace(SPACES[1])} />
        <SpaceCard icon={SPACES[2].icon} title="Designer" hint={SPACES[2].hint} onClick={() => openSpace(SPACES[2])} />
        <SpaceCard icon={Folder} title="Projects" hint="Group sessions and files" disabled />
      </div>
    </section>

    <section className="home-section" aria-label="Latest">
      <Head kicker="Latest" title="Pick up where you left off" />
      <div className="home-latest">
        <div>
          <div className="home-sub"><span>Sessions</span><button type="button" className="home-link" onClick={() => setTab('sessions')}>See all<ArrowRight size={12} /></button></div>
          <div className="home-list">
            {recentSessions.map((s) => <button key={s.id} type="button" className="home-row" onClick={() => { selectSession(s.id); setUi({ home: false, panel: null }); }}>
              <span className="home-row-title">{s.title || 'Untitled'}</span><span className="home-row-meta">{formatRelative(s.updatedAt)}</span>
            </button>)}
          </div>
        </div>
        <div>
          <div className="home-sub"><span>Library</span><button type="button" className="home-link" onClick={() => setTab('gallery')}>See all<ArrowRight size={12} /></button></div>
          <div className="home-thumbs">
            {recentAssets.length ? recentAssets.map((a) => <button key={a.id} type="button" className="home-thumb" aria-label={a.name || `Open ${a.kind}`} onClick={() => setUi({ lightbox: { assetIds: recentAssets.map((x) => x.id), index: recentAssets.indexOf(a) } })}>
              <AssetMedia assetId={a.id} hoverPlay={false} autoPlay={false} draggable={false} />
            </button>) : <p className="home-empty">Nothing generated yet.</p>}
          </div>
        </div>
      </div>
    </section>
  </>}
  </div></div>;
}
