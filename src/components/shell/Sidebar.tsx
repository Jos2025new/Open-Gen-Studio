import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Wallet, PanelLeftClose, PanelLeftOpen, PanelTopClose, PanelTopOpen, Plus } from 'lucide-react';
import { newSession, setUi, useStore } from '../../store/store';
import { formatUsd } from '../../lib/format';
import { ProviderPool } from './ProviderPool';
import { usePref } from '../ui/hooks';
import { SidebarNav } from './SidebarNav';
import { openHome } from './navModel';

/**
 * Library: a drawer (a rounded box, the line of its top, a handle below it), drawn here: lucide's archive box has a
 * lid wider than its body and reads as a bin.
 */
function LibraryIcon() {
  return <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3.5" y="4" width="17" height="16" rx="3" />
    <path d="M3.5 9h17" />
    <path d="M9.5 13.5h5" />
  </svg>;
}

function HomeIcon() {
  return <svg className="home-icon" width={18} height={18} viewBox="0 0 24 24" fill="none" aria-hidden>
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
    <nav ref={sidebarRef} className={`sidebar ${folded ? 'is-folded' : ''} ${wide && !narrow && !folded ? 'is-wide' : ''}`} aria-label="Main">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <span className="brand-name">Open Gen Studio</span>
        <button
          type="button"
          className="side-collapse"
          aria-label={folded ? 'Expand panel downward' : 'Collapse panel upward'}
          aria-expanded={!folded}
          data-tip={folded ? 'Expand panel downward' : 'Collapse panel upward'}
          data-tip-side="right"
          onClick={() => {
            if (!folded) setUi({ panel: null });
            setFolded(!folded);
          }}
        >
          {folded ? <PanelTopOpen size={15} /> : <PanelTopClose size={15} />}
        </button>
      </div>
      <div className="side-group">
        {/* New session first and accented: the quickest thing to find. */}
        <button type="button" className="side-btn side-new" data-tip="New session" data-tip-side="right" aria-label="New session" onClick={() => newSession()}>
          <Plus size={18} strokeWidth={2} />
          <span className="side-label wide-only">New session</span>
        </button>
        <HomeButton home={home} />
      </div>
      <div className="side-scroll"><SidebarNav wide={wide && !narrow && !folded} /></div>
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
          <FolderOpen size={18} strokeWidth={1.7} />
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
          <LibraryIcon />
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
      </div>
    </nav>
  );
}
