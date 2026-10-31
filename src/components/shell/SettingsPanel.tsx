import { useEffect } from 'react';
import { Bot, Database, Keyboard, Palette, Plug, Wallet, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { loadCatalogs } from '../../engine/catalog';
import { usePref } from '../ui/hooks';
import { PopoverHeader } from '../ui/Popover';
import { AppearanceSection } from './AppearanceSection';
import { AgentTab } from './settings/AgentTab';
import { BudgetTab } from './settings/BudgetTab';
import { DataTab, ShortcutsTab } from './settings/DataTab';
import { OpsTab } from './settings/OpsTab';
import { ProvidersTab } from './settings/ProvidersTab';
import './settings/Settings.css';

type Tab = 'providers' | 'agent' | 'ops' | 'budget' | 'look' | 'data' | 'keys';
const TABS: Array<{ value: Tab; label: string; icon: LucideIcon }> = [
  { value: 'providers', label: 'Providers', icon: Plug },
  { value: 'agent', label: 'Agent', icon: Bot },
  { value: 'ops', label: 'Operations', icon: Workflow },
  { value: 'budget', label: 'Budget', icon: Wallet },
  { value: 'look', label: 'Look', icon: Palette },
  { value: 'data', label: 'Data', icon: Database },
  { value: 'keys', label: 'Shortcuts', icon: Keyboard },
];

/** Settings: a side rail of sections (icon and name; icons only when the popover is narrow), and the chosen section's groups. */
export function SettingsPanel() {
  const [tab, setTab] = usePref<Tab>('ogs:settings-tab', 'providers');
  // Load missing catalogs when Settings opens.
  useEffect(() => {
    void loadCatalogs();
  }, []);

  return (
    <div className="settings set-shell">
      <PopoverHeader title="Settings" sub="Keys are kept on this computer and sent only to their provider." />
      <div className="set-body">
        <nav className="set-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
          {TABS.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} aria-controls="set-pane" title={label} className={tab === value ? 'is-on' : undefined} onClick={() => setTab(value)}>
              <Icon size={15} aria-hidden /><span className="set-nav-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="set-pane" id="set-pane" role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label}>
          {tab === 'providers' ? <ProvidersTab /> : null}
          {tab === 'agent' ? <AgentTab /> : null}
          {tab === 'ops' ? <OpsTab /> : null}
          {tab === 'budget' ? <BudgetTab /> : null}
          {tab === 'look' ? <AppearanceSection /> : null}
          {tab === 'data' ? <DataTab /> : null}
          {tab === 'keys' ? <ShortcutsTab /> : null}
        </div>
      </div>
    </div>
  );
}
