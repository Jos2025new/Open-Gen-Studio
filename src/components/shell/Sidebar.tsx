import { useEffect, useRef } from 'react';
import { FolderOpen, House, Wallet, MessageSquare, PanelLeftClose, PanelLeftOpen, PenTool, Plus, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { newSession, setUi, useStore } from '../../store/store';
import type { Workspace } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { ProviderPool } from './ProviderPool';
import { usePref } from '../ui/hooks';
import { MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';

const WORKSPACES: Array<{ id: Workspace; label: string; icon: LucideIcon; hint: string }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, hint: 'Conversation, questions and results' },
  { id: 'node', label: 'Node', icon: Workflow, hint: 'Connected flows of cards' },
  { id: 'designer', label: 'Designer', icon: PenTool, hint: 'Layers: raster, vector and text' },
];

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

/** Home: one button for the three canvases (Chat, Node, Designer); the one open is marked in its menu. */
function HomeMenu({ workspace }: { workspace: Workspace }) {
  const pop = usePopover();
  const current = WORKSPACES.find((w) => w.id === workspace);
  // Opens on hover (a click still toggles it, for touch); a short grace lets the pointer cross into the menu.
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = () => { if (closing.current) clearTimeout(closing.current); closing.current = null; };
  const show = () => { keep(); pop.setOpen(true); };
  const hide = () => { keep(); closing.current = setTimeout(pop.close, 220); };
  return <>
    <button
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') show(); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') hide(); }}
      ref={pop.ref}
      type="button"
      className={`side-btn is-active`}
      aria-label={`Home — ${current?.label ?? ''} canvas`}
      aria-haspopup="menu"
      aria-expanded={pop.open}
      onClick={pop.toggle}
    >
      <House size={18} strokeWidth={1.7} />
      <span className="side-label">Home</span>
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="right-start" width={240} label="Canvases">
      <div className="menu" role="menu" onPointerEnter={keep} onPointerLeave={(e) => { if (e.pointerType === 'mouse') hide(); }}>
        {WORKSPACES.map((w) => <MenuItem key={w.id} icon={w.icon} label={w.label} detail={w.hint} active={w.id === workspace} onClick={() => { setUi({ workspace: w.id }); pop.close(); }} />)}
      </div>
    </Popover>
  </>;
}

export function Sidebar() {
  const workspace = useStore((s) => s.ui.workspace);
  const panel = useStore((s) => s.ui.panel);
  const remaining = useStore((s) => (s.settings.budgetOn ? s.settings.budgetUsd - s.spentUsd : null));
  const spent = useStore((s) => s.spentUsd);
  const running = useStore((s) => Object.values(s.generations).filter((g) => g.status === 'running' || g.status === 'queued').length);
  const sidebarRef = useRef<HTMLElement>(null);
  const [wide, setWide] = usePref('ogs:sidebar-wide', false);

  // --sidebar-w drives the layout (side panels are anchored to it), so the mode lives on the root.
  useEffect(() => {
    document.documentElement.classList.toggle('sidebar-wide', wide);
  }, [wide]);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    const composer = document.querySelector('.composer');
    if (!sidebar || !composer) return;
    const alignBudget = () => {
      const add = composer.querySelector('.composer-add svg');
      const footer = sidebar.querySelector<HTMLElement>('.side-footer');
      const budget = footer?.querySelector('[aria-label="Provider pool"] svg, .pool-title');
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
  }, [workspace, wide]);

  const togglePanel = (p: 'gallery' | 'sessions' | 'spending') => setUi((u) => ({ panel: u.panel === p ? null : p }));

  return (
    <nav ref={sidebarRef} className="sidebar" aria-label="Main">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <span className="brand-name">Open Gen Studio</span>
        <button
          type="button"
          className="side-collapse"
          aria-label={wide ? 'Collapse panel' : 'Expand panel'}
          data-tip={wide ? 'Collapse panel' : 'Expand panel'}
          data-tip-side="right"
          onClick={() => setWide(!wide)}
        >
          {wide ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>
      </div>
      <div className="side-group">
        {/* New session first and accented: the quickest thing to find. */}
        <button type="button" className="side-btn side-new" data-tip="New session" data-tip-side="right" aria-label="New session" onClick={() => newSession()}>
          <Plus size={18} strokeWidth={2} />
          <span className="side-label wide-only">New session</span>
        </button>
        <HomeMenu workspace={workspace} />
      </div>
      <div className="side-sep" />
      <div className="side-group">
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
      </div>
      <div className="side-spacer" />
      <div className="side-group side-footer">
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
  );
}
