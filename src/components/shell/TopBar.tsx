import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { renameSession, useStore } from '../../store/store';
import { engineLabel } from '../../engine/agent/runtime';

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
            {title}
          </button>
        )}
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
