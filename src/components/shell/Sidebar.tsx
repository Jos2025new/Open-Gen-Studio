import { useEffect, useRef } from 'react';
import { FolderClock, Images, Wallet, MessageSquare, PanelLeftClose, PanelLeftOpen, PenTool, Plus, Settings, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { newSession, setUi, useStore } from '../../store/store';
import type { Workspace } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { Popover } from '../ui/Popover';
import { SettingsPanel } from './SettingsPanel';
import { ProviderPool } from './ProviderPool';
import { usePref } from '../ui/hooks';

const WORKSPACES: Array<{ id: Workspace; label: string; icon: LucideIcon; hint: string }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare, hint: 'Conversation, questions and results' },
  { id: 'node', label: 'Node', icon: Workflow, hint: 'Connected flows of cards' },
  { id: 'designer', label: 'Designer', icon: PenTool, hint: 'Layers: raster, vector and text' },
];

export function Sidebar() {
  const workspace = useStore((s) => s.ui.workspace);
  const panel = useStore((s) => s.ui.panel);
  const settingsOpen = useStore((s) => s.ui.settingsOpen);
  const remaining = useStore((s) => (s.settings.budgetOn ? s.settings.budgetUsd - s.spentUsd : null));
  const spent = useStore((s) => s.spentUsd);
  const running = useStore((s) => Object.values(s.generations).filter((g) => g.status === 'running' || g.status === 'queued').length);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const [wide, setWide] = usePref('ogs:sidebar-wide', false);

  // --sidebar-w drives the layout (side panels are anchored to it), so the mode lives on the root.
  useEffect(() => {
    document.documentElement.classList.toggle('sidebar-wide', wide);
  }, [wide]);

  const togglePanel = (p: 'gallery' | 'sessions' | 'spending') => setUi((u) => ({ panel: u.panel === p ? null : p }));

  return (
    <nav className="sidebar" aria-label="Main">
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
        {WORKSPACES.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`side-btn ${workspace === w.id ? 'is-active' : ''}`}
            data-tip={`${w.label} — ${w.hint}`}
            data-tip-side="right"
            aria-label={w.label}
            aria-current={workspace === w.id ? 'page' : undefined}
            onClick={() => setUi({ workspace: w.id })}
          >
            <w.icon size={18} strokeWidth={1.7} />
            <span className="side-label">{w.label}</span>
          </button>
        ))}
      </div>
      <div className="side-sep" />
      <div className="side-group">
        <button
          type="button"
          className={`side-btn ${panel === 'gallery' ? 'is-open' : ''}`}
          data-tip="Gallery — every image and video"
          data-tip-side="right"
          aria-label="Gallery"
          aria-expanded={panel === 'gallery'}
          onClick={() => togglePanel('gallery')}
        >
          <Images size={18} strokeWidth={1.7} />
          <span className="side-label">Gallery</span>
          {running ? <span className="side-badge num">{running}</span> : null}
        </button>
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
      </div>
      <div className="side-spacer" />
      <div className="side-group">
        <button type="button" className="side-btn" data-tip="New session" data-tip-side="right" aria-label="New session" onClick={() => newSession()}>
          <Plus size={18} strokeWidth={1.7} />
          <span className="side-label wide-only">New session</span>
        </button>
        <ProviderPool wide={wide} />
        <button
          ref={settingsRef}
          type="button"
          className={`side-btn ${settingsOpen ? 'is-open' : ''}`}
          data-tip={remaining == null ? 'Settings' : `Settings · budget left ${formatUsd(Math.max(0, remaining))}`}
          data-tip-side="right"
          aria-label="Settings"
          aria-expanded={settingsOpen}
          onClick={() => setUi((u) => ({ settingsOpen: !u.settingsOpen }))}
        >
          <Settings size={18} strokeWidth={1.7} />
          <span className="side-label wide-only">Settings</span>
        </button>
      </div>
      <Popover open={settingsOpen} anchor={settingsRef} onClose={() => setUi({ settingsOpen: false })} placement="right-end" width={400} label="Settings" className="pop-scroll">
        <SettingsPanel />
      </Popover>
    </nav>
  );
}
