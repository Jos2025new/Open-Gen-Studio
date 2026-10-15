import { useState, type ReactNode } from 'react';
import { ChevronDown, LayoutDashboard, Sparkles, Wrench, type LucideIcon } from 'lucide-react';
import { useStore } from '../../store/store';
import { usePref } from '../ui/hooks';
import { Popover, usePopover } from '../ui/Popover';
import { CREATE, SPACES, TOOLS_MAIN, TOOLS_MORE, openCreate, openSpace, openTool } from './navModel';

/*
 * Sidebar destinations: Spaces, Create, Tools. Wide: collapsible sections with icon + text. Narrow: one icon per
 * section (no text); pressing it opens a flyout beside the bar with the section's items in a grid.
 */

const TOOLS_FIRST = 8;

interface Entry { key: string; label: string; hint?: string; icon: LucideIcon; active?: boolean; soon?: boolean; run: () => void }

function useEntries(): { spaces: Entry[]; create: Entry[]; tools: Entry[]; moreTools: Entry[] } {
  const workspace = useStore((s) => s.ui.workspace);
  const home = useStore((s) => !!s.ui.home);
  const toTool = (t: (typeof TOOLS_MAIN)[number]): Entry => ({ key: t.id, label: t.label, icon: t.icon, run: () => openTool(t) });
  const all = [...TOOLS_MAIN, ...TOOLS_MORE].map(toTool);
  return {
    spaces: SPACES.map((s) => ({ key: s.id, label: s.label, hint: s.hint, icon: s.icon, active: !home && s.workspace === workspace, run: () => openSpace(s) })),
    create: CREATE.map((c) => ({ key: c.id, label: c.label, hint: c.soon ? 'Soon' : c.hint, icon: c.icon, soon: c.soon, run: () => openCreate(c) })),
    tools: all.slice(0, TOOLS_FIRST),
    moreTools: all.slice(TOOLS_FIRST),
  };
}

function Item({ e, variant, after }: { e: Entry; variant: 'row' | 'tile'; after?: () => void }) {
  return <button type="button" className={`nav-item is-${variant} ${e.active ? 'is-active' : ''}`} disabled={e.soon} aria-label={e.soon ? `${e.label} — soon` : e.label} aria-current={e.active ? 'page' : undefined}
    data-tip={variant === 'row' ? undefined : e.hint} onClick={() => { e.run(); after?.(); }}>
    <e.icon size={variant === 'tile' ? 20 : 16} strokeWidth={1.7} />
    <span className="nav-item-label">{e.label}</span>
    {e.soon && variant === 'row' ? <span className="nav-soon">Soon</span> : null}
  </button>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [closed, setClosed] = usePref(`ogs:nav-${id}-closed`, false);
  return <section className="nav-section" aria-label={title}>
    <button type="button" className="nav-head" aria-expanded={!closed} onClick={() => setClosed(!closed)}>
      <span>{title}</span><ChevronDown size={12} className={closed ? 'is-closed' : ''} />
    </button>
    {closed ? null : children}
  </section>;
}

function WideNav() {
  const { spaces, create, tools, moreTools } = useEntries();
  const [more, setMore] = useState(false);
  return <>
    <Section id="spaces" title="Spaces"><div className="nav-list is-tall">{spaces.map((e) => <Item key={e.key} e={e} variant="row" />)}</div></Section>
    <Section id="create" title="Create"><div className="nav-grid">{create.map((e) => <Item key={e.key} e={e} variant="tile" />)}</div></Section>
    <Section id="tools" title="Tools">
      <div className="nav-list">
        {(more ? [...tools, ...moreTools] : tools).map((e) => <Item key={e.key} e={e} variant="row" />)}
        <button type="button" className="nav-item is-row nav-more" aria-expanded={more} onClick={() => setMore(!more)}><span className="nav-item-label">{more ? 'Less' : 'More'}</span></button>
      </div>
    </Section>
  </>;
}

/** One icon for a section; the flyout holds the items. */
function Flyout({ label, icon: Icon, active, items, cols }: { label: string; icon: LucideIcon; active?: boolean; items: Entry[]; cols: number }) {
  const pop = usePopover();
  return <>
    <button ref={pop.ref} type="button" className={`side-btn nav-icon ${active ? 'is-active' : ''} ${pop.open ? 'is-open' : ''}`} aria-label={label} aria-haspopup="menu" aria-expanded={pop.open} data-tip={label} data-tip-side="right" onClick={pop.toggle}>
      <Icon size={18} strokeWidth={1.7} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="right-start" width={cols * 92 + 16} label={label}>
      <div className="nav-flyout" role="menu" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {items.map((e) => <Item key={e.key} e={e} variant="tile" after={pop.close} />)}
      </div>
    </Popover>
  </>;
}

function NarrowNav() {
  const { spaces, create, tools, moreTools } = useEntries();
  return <>
    <Flyout label="Spaces" icon={LayoutDashboard} active={spaces.some((e) => e.active)} items={spaces} cols={3} />
    <Flyout label="Create" icon={Sparkles} items={create} cols={2} />
    <Flyout label="Tools" icon={Wrench} items={[...tools, ...moreTools]} cols={3} />
  </>;
}

export function SidebarNav({ wide }: { wide: boolean }) {
  return wide ? <WideNav /> : <NarrowNav />;
}
