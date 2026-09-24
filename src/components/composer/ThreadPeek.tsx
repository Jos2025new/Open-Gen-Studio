import { useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronDown, MessageSquare } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { FeedList } from '../chat/FeedList';

/** The session conversation, above the composer, in the Node and Designer workspaces. */
export function ThreadPeek() {
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
    if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [open, lastKey]);

  return (
    <div className={`thread-peek ${open ? 'is-open' : ''}`}>
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
    </div>
  );
}
