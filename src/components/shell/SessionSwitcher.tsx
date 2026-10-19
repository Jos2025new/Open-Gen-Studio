import { useMemo, useState } from 'react';
import { Check, ChevronDown, ListChecks, Pin, Plus, Search, Trash } from 'lucide-react';
import { newSession, selectSession, setUi, useStore } from '../../store/store';
import { formatRelative } from '../../lib/format';
import { Popover, usePopover } from '../ui/Popover';
import { IconButton } from '../ui/primitives';
import { DeleteSessionsConfirm, useSessionMatcher } from './SessionsPanel';
import { visibleSessions } from '../../store/spaceSession';
import './SessionSwitcher.css';

/**
 * Quick session switcher: search · select several · new session on top, recent first below, "All sessions" at the foot.
 * With "Select several" on, rows tick instead of switching, and a trash at the foot deletes the ticked ones after the
 * same confirmation as the Sessions panel.
 */
export function SessionSwitcher({ activeId, title, onRename }: { activeId: string; title: string; onRename: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const pop = usePopover();
  const del = usePopover();
  const [q, setQ] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const matches = useSessionMatcher(q);
  const list = useMemo(
    () => visibleSessions(sessions).filter(matches).sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.updatedAt - a.updatedAt)),
    [sessions, matches],
  );
  const picked = [...selected].filter((id) => sessions[id]);
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  const go = (fn: () => void) => {
    fn();
    pop.close();
    setQ('');
    stopSelecting();
  };
  const tick = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <>
      <button type="button" ref={pop.ref} className={`title-btn session-title-btn ${pop.open ? 'is-open' : ''}`} onClick={(e) => { if (e.detail < 2) pop.toggle(); }} onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); pop.close(); onRename(); } }} aria-label="Switch session" aria-haspopup="dialog" aria-expanded={pop.open} data-tip="Switch session · double-click name to rename">
        <span className="truncate" onDoubleClick={() => { pop.close(); onRename(); }}>{title}</span>
        <ChevronDown size={14} />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={() => { pop.close(); stopSelecting(); }} width={320} label="Sessions">
        <div className="switch-head">
          <div className="ml-search">
            <Search size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" />
          </div>
          <IconButton icon={ListChecks} label={selecting ? 'Stop selecting' : 'Select several'} size="sm" active={selecting} aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))} />
          <button type="button" className="ml-foot-icon session-new" aria-label="New session" data-tip="New session" onClick={() => go(() => newSession())}>
            <Plus size={14} />
          </button>
        </div>
        <div className="switch-list">
          {list.slice(0, 50).map((s) => {
            const on = selected.has(s.id);
            return (
              <button key={s.id} type="button" className={`switch-row ${s.id === activeId && !selecting ? 'is-selected' : ''} ${selecting ? 'is-selecting' : ''}`} aria-pressed={selecting ? on : undefined} onClick={() => (selecting ? tick(s.id) : go(() => selectSession(s.id)))}>
                {selecting ? <span className={`session-check ${on ? 'is-on' : ''}`} aria-hidden>{on ? <Check size={12} /> : null}</span> : null}
                {s.pinned ? <Pin size={11} className="pin-mark" /> : null}
                <span className="switch-title">{s.title}</span>
                <span className="switch-time faint num">{formatRelative(s.updatedAt)}</span>
                {s.id === activeId && !selecting ? <Check size={13} className="ml-check" /> : null}
              </button>
            );
          })}
          {!list.length ? <div className="ml-empty">No sessions match.</div> : null}
        </div>
        <div className="ml-foot">
          <button type="button" className="ml-foot-main" onClick={() => go(() => setUi({ panel: 'sessions' }))}>
            All sessions ({visibleSessions(sessions).length})
          </button>
          {selecting && picked.length ? <IconButton ref={del.ref} icon={Trash} label={`Delete ${picked.length} selected`} size="sm" tone="danger" active={del.open} onClick={del.toggle} /> : null}
        </div>
        <Popover open={del.open} anchor={del.ref} onClose={del.close} width={300} label="Delete sessions">
          <DeleteSessionsConfirm ids={picked} onCancel={del.close} onDone={() => { del.close(); stopSelecting(); }} />
        </Popover>
      </Popover>
    </>
  );
}
