import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Pin, Plus, Search, Settings } from 'lucide-react';
import { newSession, renameSession, selectSession, setUi, useStore } from '../../store/store';
import { formatRelative } from '../../lib/format';
import { Popover, usePopover } from '../ui/Popover';
import { useSessionMatcher } from './SessionsPanel';
import { SettingsPanel } from './SettingsPanel';
import { GenerationsPanel } from './GenerationsPanel';
import { REMOTE_PROVIDERS } from '../../engine/providers/registry';
import { PROVIDER_LABELS } from '../../engine/providers/types';
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
  const generationsPop = usePopover();
  const connected = REMOTE_PROVIDERS.filter((p) => keys[p]?.trim());

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
        <button type="button" ref={connectedPop.ref} className={`topbar-menu ${connectedPop.open ? 'is-open' : ''}`} aria-expanded={connectedPop.open} onClick={() => { generationsPop.close(); setUi({ settingsOpen: false }); connectedPop.toggle(); }}>
          <span className={`pool-dot ${connected.length ? 'is-on' : ''}`} /> Connected
        </button>
        <button type="button" ref={generationsPop.ref} className={`topbar-menu ${generationsPop.open ? 'is-open' : ''}`} aria-expanded={generationsPop.open} onClick={() => { connectedPop.close(); setUi({ settingsOpen: false }); generationsPop.toggle(); }}>Generations</button>
        <IconButton ref={settingsRef} icon={Settings} label="Settings" active={settingsOpen} aria-expanded={settingsOpen} onClick={() => { connectedPop.close(); generationsPop.close(); setUi((u) => ({ settingsOpen: !u.settingsOpen })); }} />
      </div>
      <Popover open={connectedPop.open} anchor={connectedPop.ref} onClose={connectedPop.close} width={220} label="Connected providers">
        <div className="pool-details">
          {connected.map((p) => <div key={p} className="pool-row">{PROVIDER_LABELS[p]}</div>)}
          {!connected.length ? <div className="pool-row faint">No providers connected</div> : null}
        </div>
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

/** Quick session switcher: recent first, with search over names, chats and prompts. */
function SessionSwitcher({ activeId, title, onRename }: { activeId: string; title: string; onRename: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const pop = usePopover();
  const [q, setQ] = useState('');
  const matches = useSessionMatcher(q);
  const list = useMemo(
    () => Object.values(sessions).filter(matches).sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.updatedAt - a.updatedAt)),
    [sessions, matches],
  );
  const go = (fn: () => void) => {
    fn();
    pop.close();
    setQ('');
  };
  return (
    <>
      <button type="button" ref={pop.ref} className={`title-btn ${pop.open ? 'is-open' : ''}`} onClick={(e) => { if (e.detail < 2) pop.toggle(); }} onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); pop.close(); onRename(); } }} aria-label="Switch session" aria-haspopup="dialog" aria-expanded={pop.open} data-tip="Switch session · double-click name to rename">
        <span className="truncate" onDoubleClick={() => { pop.close(); onRename(); }}>{title}</span>
        <ChevronDown size={14} />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={320} label="Sessions">
        <div className="ml-search">
          <Search size={14} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" />
        </div>
        <div className="switch-list">
          {list.slice(0, 50).map((s) => (
            <button key={s.id} type="button" className={`switch-row ${s.id === activeId ? 'is-selected' : ''}`} onClick={() => go(() => selectSession(s.id))}>
              {s.pinned ? <Pin size={11} className="pin-mark" /> : null}
              <span className="switch-title">{s.title}</span>
              <span className="switch-time faint num">{formatRelative(s.updatedAt)}</span>
              {s.id === activeId ? <Check size={13} className="ml-check" /> : null}
            </button>
          ))}
          {!list.length ? <div className="ml-empty">No sessions match.</div> : null}
        </div>
        <div className="ml-foot">
          <button type="button" className="ml-foot-main" onClick={() => go(() => setUi({ panel: 'sessions' }))}>
            All sessions ({Object.keys(sessions).length})
          </button>
          <button type="button" className="ml-foot-icon" aria-label="New session" data-tip="New session" onClick={() => go(() => newSession())}>
            <Plus size={14} />
          </button>
        </div>
      </Popover>
    </>
  );
}
