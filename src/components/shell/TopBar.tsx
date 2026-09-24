import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Pencil, Pin, Plus, Search } from 'lucide-react';
import { newSession, renameSession, selectSession, setUi, useStore } from '../../store/store';
import { engineLabel } from '../../engine/agent/runtime';
import { formatRelative } from '../../lib/format';
import { Popover, usePopover } from '../ui/Popover';
import { useSessionMatcher } from './SessionsPanel';

export const TopbarSlotContext = createContext<HTMLDivElement | null>(null);

/** Workspaces render their contextual actions into the top bar through this. */
export function TopbarActions({ children }: { children: ReactNode }) {
  const slot = useContext(TopbarSlotContext);
  return slot ? createPortal(children, slot) : null;
}

const WS_LABEL = { chat: 'Chat', node: 'Node', designer: 'Designer' } as const;

export function TopBar({ slotRef }: { slotRef: (el: HTMLDivElement | null) => void }) {
  const sessionId = useStore((s) => s.activeSessionId);
  const title = useStore((s) => s.sessions[s.activeSessionId]?.title ?? '');
  const workspace = useStore((s) => s.ui.workspace);
  const engine = useStore(() => engineLabel());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

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
        <span className="ws-tag">{WS_LABEL[workspace]}</span>
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
          <button type="button" className="title-btn" onClick={() => setEditing(true)} data-tip="Rename session">
            <span className="truncate">{title}</span>
            <Pencil size={12} className="title-pencil" />
          </button>
        )}
        <SessionSwitcher activeId={sessionId} />
      </div>
      <div className="topbar-right">
        <div className="topbar-slot" ref={slotRef} />
        <span className="engine-tag" data-tip="Agent engine (change it in Settings)">
          {engine}
        </span>
      </div>
    </header>
  );
}

/** Quick session switcher: recent first, with search over names, chats and prompts. */
function SessionSwitcher({ activeId }: { activeId: string }) {
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
      <button type="button" ref={pop.ref} className={`switch-btn ${pop.open ? 'is-open' : ''}`} onClick={pop.toggle} aria-label="Switch session" data-tip="Switch session">
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
