import { useEffect, useRef, useState } from 'react';
import { FolderClock, Images, Wallet, PanelLeftClose, PanelLeftOpen, PanelTopClose, PanelTopOpen, Plus } from 'lucide-react';
import { newSession, setUi, useStore } from '../../store/store';
import { formatUsd } from '../../lib/format';
import { ProviderPool } from './ProviderPool';
import { usePref } from '../ui/hooks';
import { SidebarNav } from './SidebarNav';
import { openHome } from './navModel';
import '../../styles/sidebar-peek.css';

/** The house icon, shared by the sidebar's Home item and the top bar's Home button. */
export function HomeIcon({ size = 18 }: { size?: number }) {
  return <svg className="home-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>;
}

/** Home: opens the Home view (the three workspaces live under Spaces). */
function HomeButton({ home }: { home: boolean }) {
  return <button type="button" className={`side-btn ${home ? 'is-active' : ''}`} aria-label="Home" aria-current={home ? 'page' : undefined} data-tip="Home" data-tip-side="right" onClick={openHome}>
    <HomeIcon />
    <span className="side-label">Home</span>
  </button>;
}

/** The bar shows its icon-only form below this width whatever the saved preference. */
function useNarrowScreen(): boolean {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function Sidebar() {
  const workspace = useStore((s) => s.ui.workspace);
  const panel = useStore((s) => s.ui.panel);
  const remaining = useStore((s) => (s.settings.budgetOn ? s.settings.budgetUsd - s.spentUsd : null));
  const spent = useStore((s) => s.spentUsd);
  const running = useStore((s) => Object.values(s.generations).filter((g) => g.status === 'running' || g.status === 'queued').length);
  const home = useStore((s) => !!s.ui.home);
  const narrow = useNarrowScreen();
  const sidebarRef = useRef<HTMLElement>(null);
  const [wide, setWide] = usePref('ogs:sidebar-wide', false);
  const [folded, setFolded] = usePref('ogs:sidebar-folded', false);
  // Folded, the bar peeks: hovering or focusing its icon (or the left edge) shows it floating over the workspace, in
  // the chosen width, without moving anything; leaving hides it after a short pause; clicking the icon pins it.
  const [peek, setPeek] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const showPeek = () => { window.clearTimeout(hideTimer.current); if (folded) setPeek(true); };
  const hidePeek = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      // A flyout opened from the bar (Create, Tools) keeps it out until it closes.
      if (sidebarRef.current?.querySelector('[aria-haspopup][aria-expanded="true"]')) return hidePeek();
      setPeek(false);
    }, 280);
  };
  useEffect(() => { if (!folded) setPeek(false); }, [folded]);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  const peeking = folded && peek;

  // --sidebar-w drives the layout (side panels are anchored to it), so both modes live on the root.
  useEffect(() => {
    document.documentElement.classList.toggle('sidebar-wide', wide);
    document.documentElement.classList.toggle('sidebar-folded', folded);
    return () => {
      document.documentElement.classList.remove('sidebar-wide', 'sidebar-folded');
    };
  }, [wide, folded]);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    const composer = document.querySelector('.composer');
    if (!sidebar || !composer) return;
    const alignBudget = () => {
      const add = composer.querySelector('.composer-add svg');
      const footer = sidebar.querySelector<HTMLElement>('.side-footer');
      const budget = footer?.querySelector('[aria-label="Provider pool"] .provider-key-mark, .pool-title');
      if (!add || !footer || !budget) return;
      const a = add.getBoundingClientRect(), b = budget.getBoundingClientRect();
      const current = parseFloat(getComputedStyle(footer).marginBottom) || 0;
      const margin = Math.max(0, current + b.top + b.height / 2 - a.top - a.height / 2);
      footer.style.marginBottom = `${margin}px`;
    };
    const observer = new ResizeObserver(alignBudget);
    observer.observe(composer);
    observer.observe(sidebar);
    const footer = sidebar.querySelector('.side-footer');
    if (footer) observer.observe(footer);
    window.addEventListener('resize', alignBudget);
    alignBudget();
    return () => { observer.disconnect(); window.removeEventListener('resize', alignBudget); };
  }, [workspace, wide, folded, home]);

  const togglePanel = (p: 'gallery' | 'sessions' | 'spending') => setUi((u) => ({ panel: u.panel === p ? null : p }));

  return (
    <>
    {folded && !peeking ? <div className="side-peek-edge" aria-hidden onMouseEnter={showPeek} /> : null}
    <nav ref={sidebarRef} className={`sidebar ${folded && !peeking ? 'is-folded' : ''} ${peeking ? 'is-peek' : ''} ${wide && !narrow && (!folded || peeking) ? 'is-wide' : ''}`} aria-label="Main"
      onMouseEnter={peeking ? showPeek : undefined} onMouseLeave={peeking ? hidePeek : undefined}
      onBlur={peeking ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hidePeek(); } : undefined}>
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <span className="brand-name">Open Gen Studio</span>
        <button
          type="button"
          className="side-collapse"
          aria-label={folded ? 'Pin panel' : 'Collapse panel upward'}
          aria-expanded={!folded}
          data-tip={folded ? 'Pin panel' : 'Collapse panel upward'}
          data-tip-side="right"
          onMouseEnter={folded ? showPeek : undefined}
          onFocus={folded ? showPeek : undefined}
          onClick={() => {
            if (!folded) setUi({ panel: null });
            setPeek(false);
            setFolded(!folded);
          }}
        >
          {folded ? <PanelTopOpen size={15} /> : <PanelTopClose size={15} />}
        </button>
      </div>
      <div className="side-group">
        {/* Expand or collapse the bar sits above New session, at the top of the bar. */}
        <button
          type="button"
          className="side-btn side-width-toggle"
          aria-label={wide ? 'Collapse panel to the left' : 'Expand panel to the right'}
          data-tip={wide ? 'Collapse panel to the left' : 'Expand panel to the right'}
          data-tip-side="right"
          onClick={() => setWide(!wide)}
        >
          {wide ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          <span className="side-label wide-only">Collapse panel</span>
        </button>
        {/* New session first among the actions, and accented: the quickest thing to find. */}
        <button type="button" className="side-btn side-new" data-tip="New session" data-tip-side="right" aria-label="New session" onClick={() => newSession()}>
          <Plus size={18} strokeWidth={2} />
          <span className="side-label wide-only">New session</span>
        </button>
        <HomeButton home={home} />
      </div>
      <div className="side-scroll"><SidebarNav wide={wide && !narrow && (!folded || peeking)} /></div>
      <div className="side-group side-footer">
        <button
          type="button"
          className={`side-btn ${panel === 'sessions' ? 'is-open' : ''}`}
          data-tip="Sessions"
          data-tip-side="right"
          aria-label="Sessions"
          aria-expanded={panel === 'sessions'}
          onClick={() => togglePanel('sessions')}
        >
          <FolderClock size={18} strokeWidth={1.7} />
          <span className="side-label">Sessions</span>
        </button>
        <button
          type="button"
          className={`side-btn ${panel === 'gallery' ? 'is-open' : ''}`}
          data-tip="Library — your generations, uploads and saved subjects"
          data-tip-side="right"
          aria-label="Library"
          aria-expanded={panel === 'gallery'}
          onClick={() => togglePanel('gallery')}
        >
          <Images size={18} strokeWidth={1.7} />
          <span className="side-label">Library</span>
          {running ? <span className="side-badge num">{running}</span> : null}
        </button>
        <button
          type="button"
          className={`side-btn ${panel === 'spending' ? 'is-open' : ''}`}
          data-tip={`Spending — ${formatUsd(spent)} spent${remaining == null ? '' : remaining < 0 ? ', over the limit' : `, ${formatUsd(remaining)} left`}`}
          data-tip-side="right"
          aria-label="Spending"
          aria-expanded={panel === 'spending'}
          onClick={() => togglePanel('spending')}
        >
          <Wallet size={18} strokeWidth={1.7} />
          <span className="side-label">Spending</span>
          {remaining != null && remaining < 0 ? <span className="side-badge is-warn" aria-label="Over the limit">!</span> : null}
        </button>
        <ProviderPool wide={wide} />
      </div>
    </nav>
    </>
  );
}
