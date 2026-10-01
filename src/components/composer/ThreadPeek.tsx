import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, MessageSquare } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { FeedList } from '../chat/FeedList';

/** The session conversation in the Node and Designer workspaces: a foldable card on the right, clear of the canvas centre. */
export function ThreadPeek({ workspace }: { workspace: string }) {
  const open = useStore((s) => s.ui.threadOpen);
  const sessionId = useStore((s) => s.activeSessionId);
  const count = useStore((s) => s.sessions[s.activeSessionId]?.feed.length ?? 0);
  const pending = useStore((s) => {
    const sess = s.sessions[s.activeSessionId];
    return Boolean(sess?.agent.pending) || Boolean(sess?.agent.busy);
  });
  const lastKey = useStore((s) => {
    const f = s.sessions[s.activeSessionId]?.feed;
    const last = f?.[f.length - 1];
    return last ? (last.type === 'assistant' ? `${last.id}:${last.text.length}` : last.id) : '';
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pending) setUi({ threadOpen: true });
  }, [pending]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    el.scrollTop = el.scrollHeight;
    // Images in the thread load after the first layout; follow them to the newest message.
    const id = requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    return () => cancelAnimationFrame(id);
  }, [open, lastKey]);

  return createPortal(
    <div className={`thread-peek thread-${workspace} ${open ? 'is-open' : ''}`}>
      <button type="button" className="thread-toggle" onClick={() => setUi({ threadOpen: !open })} aria-expanded={open}>
        <MessageSquare size={13} />
        <span>Conversation</span>
        {count ? <span className="num faint">{count}</span> : null}
        {pending ? <span className="pulse-dot" /> : null}
        <ChevronDown size={13} className={open ? '' : 'rot-180'} />
      </button>
      {open ? (
        <div className="thread-body" ref={ref}>
          {count ? <FeedList sessionId={sessionId} compact /> : <p className="faint thread-empty">Ask the agent to build something here.</p>}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
