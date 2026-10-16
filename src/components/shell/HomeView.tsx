import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Minus, Plus, type LucideIcon } from 'lucide-react';
import { selectSession, setUi, useStore } from '../../store/store';
import type { AssetKind } from '../../engine/types';
import { formatRelative } from '../../lib/format';
import { AssetMedia } from '../ui/AssetMedia';
import { CREATE, SPACES, TOOLS_MAIN, TOOLS_MORE, isListed, openCreate, openSpace, openTool, type CreateItem, type ToolItem } from './navModel';


function Head({ kicker, title, action }: { kicker: string; title: string; action?: ReactNode }) {
  return <header className="home-head">
    <div><div className="plan-kicker">{kicker}</div><h2 className="home-title">{title}</h2></div>
    {action}
  </header>;
}

/** Fixed card anatomy: icon square, title, subtitle, optional count pill. `area` places it in the bento. */
function Card({ icon: Icon, title, hint, count, disabled, area, onClick }: {
  icon: LucideIcon; title: string; hint: string; count?: string; disabled?: boolean; area: string; onClick: () => void;
}) {
  return <button type="button" className="home-card" style={{ gridArea: area }} disabled={disabled} onClick={onClick} aria-label={disabled ? `${title} — soon` : title}>
    <span className="home-card-top">
      <span className="home-card-icon"><Icon size={18} strokeWidth={1.7} /></span>
      {disabled ? <span className="home-pill">Soon</span> : count ? <span className="home-pill">{count}<ArrowRight size={12} /></span> : null}
    </span>
    <span className="home-card-text">
      <span className="home-card-title">{title}</span>
      <span className="home-card-hint">{hint}</span>
    </span>
  </button>;
}

function ToolGrid({ items }: { items: ToolItem[] }) {
  return <>{items.map((t) => <button key={t.id} type="button" className="home-tool" onClick={() => openTool(t)}>
    <span className="home-tool-icon"><t.icon size={22} strokeWidth={1.6} /></span>
    <span className="home-tool-label">{t.label}</span>
  </button>)}</>;
}

export function HomeView() {
  const assets = useStore((s) => s.assets);
  const sessions = useStore((s) => s.sessions);
  const [more, setMore] = useState(false);
  const listed = useMemo(() => Object.values(assets).filter(isListed), [assets]);
  const count = (kind: AssetKind) => listed.filter((a) => a.kind === kind).length;
  const recentSessions = useMemo(() => Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4), [sessions]);
  const recentAssets = useMemo(() => [...listed].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4), [listed]);
  const sessionCount = Object.keys(sessions).length;
  const countOf = (c: CreateItem) => (c.soon || !count(c.kind) ? undefined : `${count(c.kind)}`);

  return <div className="home" role="region" aria-label="Home"><div className="home-inner">
    <nav className="home-tabs" aria-label="Home sections">
      <button type="button" className="home-tab is-active" aria-current="page">Home</button>
      <button type="button" className="home-tab" disabled title="Coming soon">Projects</button>
      <button type="button" className="home-tab" onClick={() => setUi({ panel: 'sessions' })}>Sessions</button>
      <button type="button" className="home-tab" onClick={() => setUi({ panel: 'gallery' })}>Library</button>
    </nav>
    <section className="home-section" aria-label="Create">
      <Head kicker="Create" title="What do you want to make?" />
      <div className="home-bento">
        <Card area="studio" icon={SPACES[0].icon} title="Studio" hint={SPACES[0].hint} count={`${sessionCount} session${sessionCount === 1 ? '' : 's'}`} onClick={() => openSpace(SPACES[0])} />
        {CREATE.map((c) => <button key={c.id} type="button" className={`home-tile t-${c.id}`} style={{ gridArea: c.id }} disabled={c.soon} onClick={() => openCreate(c)} aria-label={c.soon ? `${c.label} — soon` : c.label} title={c.hint}>
          <c.icon size={34} strokeWidth={1.6} aria-hidden />
          <span className="home-tile-label">{c.label}{c.soon ? <span className="home-pill">Soon</span> : countOf(c) ? <span className="home-tile-count">{countOf(c)}</span> : null}</span>
        </button>)}
        <Card area="canvas" icon={SPACES[1].icon} title="Node Canvas" hint={SPACES[1].hint} onClick={() => openSpace(SPACES[1])} />
        <Card area="designer" icon={SPACES[2].icon} title="Designer" hint={SPACES[2].hint} onClick={() => openSpace(SPACES[2])} />
      </div>
    </section>

    <section className="home-section" aria-label="Tools">
      <Head kicker="Tools" title="Work on what you have" />
      <div className="home-tools">
        <ToolGrid items={more ? [...TOOLS_MAIN, ...TOOLS_MORE] : TOOLS_MAIN} />
        <button type="button" className="home-tool" onClick={() => setMore(!more)} aria-expanded={more}>
          <span className="home-tool-icon">{more ? <Minus size={22} strokeWidth={1.6} /> : <Plus size={22} strokeWidth={1.6} />}</span>
          <span className="home-tool-label">{more ? 'Less' : 'More'}</span>
        </button>
      </div>
    </section>

    <section className="home-section" aria-label="Latest">
      <Head kicker="Latest" title="Pick up where you left off" />
      <div className="home-latest">
        <div>
          <div className="home-sub"><span>Sessions</span><button type="button" className="home-link" onClick={() => setUi({ panel: 'sessions' })}>See all<ArrowRight size={12} /></button></div>
          <div className="home-list">
            {recentSessions.map((s) => <button key={s.id} type="button" className="home-row" onClick={() => { selectSession(s.id); setUi({ home: false, panel: null }); }}>
              <span className="home-row-title">{s.title || 'Untitled'}</span><span className="home-row-meta">{formatRelative(s.updatedAt)}</span>
            </button>)}
          </div>
        </div>
        <div>
          <div className="home-sub"><span>Library</span><button type="button" className="home-link" onClick={() => setUi({ panel: 'gallery' })}>See all<ArrowRight size={12} /></button></div>
          <div className="home-thumbs">
            {recentAssets.length ? recentAssets.map((a) => <button key={a.id} type="button" className="home-thumb" aria-label={a.name || `Open ${a.kind}`} onClick={() => setUi({ lightbox: { assetIds: recentAssets.map((x) => x.id), index: recentAssets.indexOf(a) } })}>
              <AssetMedia assetId={a.id} hoverPlay={false} autoPlay={false} draggable={false} />
            </button>) : <p className="home-empty">Nothing generated yet.</p>}
          </div>
        </div>
      </div>
    </section>
  </div></div>;
}
