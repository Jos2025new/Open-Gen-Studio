import { SaveIndicator } from './SaveIndicator';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Settings } from 'lucide-react';
import { renameSession, setUi, useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { SettingsPanel } from './SettingsPanel';
import { SessionSwitcher } from './SessionSwitcher';
import { GenerationsPanel } from './GenerationsPanel';
import { REMOTE_PROVIDERS } from '../../engine/providers/registry';
import { ConnectedProviders } from './ConnectedProviders';
import type { RemoteProviderId } from '../../engine/types';
import { IconButton } from '../ui/primitives';
import { WORKSPACES, WorkspaceMenuItems } from './WorkspaceMenu';

export const TopbarSlotContext = createContext<HTMLDivElement | null>(null);

/** Workspaces render their contextual actions into the top bar through this. */
export function TopbarActions({ children }: { children: ReactNode }) {
  const slot = useContext(TopbarSlotContext);
  const [destination, setDestination] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    setDestination(document.querySelector<HTMLDivElement>('#workspace-actions'));
  }, [slot]);
  const target = slot?.isConnected ? slot : destination;
  return target ? createPortal(children, target) : null;
}

export function TopBar({ slotRef }: { slotRef: (el: HTMLDivElement | null) => void }) {
  const sessionId = useStore((s) => s.activeSessionId);
  const title = useStore((s) => s.sessions[s.activeSessionId]?.title ?? '');
  const workspace = useStore((s) => s.ui.workspace);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const keys = useStore((s) => s.settings.keys);
  const settingsOpen = useStore((s) => s.ui.settingsOpen);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const workspacePop = usePopover();
  const connectedPop = usePopover();
  const [addedProviders, setAddedProviders] = useState<RemoteProviderId[]>([]);
  const generationsPop = usePopover();
  const connected = REMOTE_PROVIDERS.filter((p) => keys[p]?.trim());
  const shownProviders = [...new Set([...addedProviders, ...connected])];

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== title) renameSession(sessionId, draft);
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" ref={workspacePop.ref} className="ws-tag title-btn" aria-label="Switch workspace" aria-haspopup="menu" aria-expanded={workspacePop.open} onClick={workspacePop.toggle}>
          {WORKSPACES.find((w) => w.id === workspace)?.label}<ChevronDown size={12} />
        </button>
        <Popover open={workspacePop.open} anchor={workspacePop.ref} onClose={workspacePop.close} placement="bottom-start" width={240} label="Canvases">
          <div className="menu" role="menu"><WorkspaceMenuItems workspace={workspace} onClose={workspacePop.close} /></div>
        </Popover>
        <span className="topbar-sep">/</span>
        {editing ? (
          <input
            ref={inputRef}
            className="title-input"
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(title);
                setEditing(false);
              }
            }}
            aria-label="Session title"
          />
        ) : (
          <SessionSwitcher activeId={sessionId} title={title} onRename={() => setEditing(true)} />
        )}
      </div>
      <div className="topbar-right">
        <div id="workspace-actions" className="topbar-slot" ref={slotRef} />
        {workspace === 'designer' && <SaveIndicator />}
        <button type="button" ref={connectedPop.ref} className={`topbar-menu ${connectedPop.open ? 'is-open' : ''}`} aria-expanded={connectedPop.open} onClick={() => { generationsPop.close(); setUi({ settingsOpen: false }); connectedPop.toggle(); }}>
          <span className={`pool-dot ${connected.length ? 'is-on' : ''}`} /> Connected
        </button>
        <button type="button" ref={generationsPop.ref} className={`topbar-menu ${generationsPop.open ? 'is-open' : ''}`} aria-expanded={generationsPop.open} onClick={() => { connectedPop.close(); setUi({ settingsOpen: false }); generationsPop.toggle(); }}>Generations</button>
        <IconButton ref={settingsRef} icon={Settings} label="Settings" active={settingsOpen} aria-expanded={settingsOpen} onClick={() => { connectedPop.close(); generationsPop.close(); setUi((u) => ({ settingsOpen: !u.settingsOpen })); }} />
      </div>
      <Popover open={connectedPop.open} anchor={connectedPop.ref} onClose={connectedPop.close} width={shownProviders.length ? 340 : 180} label="Connected providers" className="provider-connections-popover">
        <ConnectedProviders providers={shownProviders} onAdd={(p) => setAddedProviders((prev) => prev.includes(p) ? prev : [...prev, p])} />
      </Popover>
      <Popover open={generationsPop.open} anchor={generationsPop.ref} onClose={generationsPop.close} width={680} label="Generations" className="generations-popover">
        <GenerationsPanel onClose={generationsPop.close} />
      </Popover>
      <Popover open={settingsOpen} anchor={settingsRef} onClose={() => setUi({ settingsOpen: false })} width={400} label="Settings" className="pop-scroll">
        <SettingsPanel />
      </Popover>
    </header>
  );
}
