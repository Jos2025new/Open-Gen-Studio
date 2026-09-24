import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { setComposer, setUi, useStore } from '../../store/store';
import { FeedList } from './FeedList';

const SUGGESTIONS = [
  { text: 'Hero product shot of a matte black perfume bottle on wet stone, then animate a slow orbit', mode: 'agent' as const },
  { text: 'Storyboard of 4 shots: a lighthouse keeper at dawn during a storm', mode: 'agent' as const },
  { text: 'Editorial portrait of a ceramic artist in her studio, soft window light', mode: 'image' as const },
];

export function ChatWorkspace() {
  const sessionId = useStore((s) => s.activeSessionId);
  const count = useStore((s) => s.sessions[s.activeSessionId]?.feed.length ?? 0);
  const lastKey = useStore((s) => {
    const f = s.sessions[s.activeSessionId]?.feed;
    const last = f?.[f.length - 1];
    if (!last) return '';
    return last.type === 'assistant' ? `${last.id}:${last.text.length}` : last.id;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastKey, sessionId]);

  useEffect(() => {
    stick.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = atBottom;
    setShowJump(!atBottom);
  };

  return (
    <div className="chat" ref={scrollRef} onScroll={onScroll}>
      {count ? (
        <div className="chat-column">
          <FeedList sessionId={sessionId} />
        </div>
      ) : (
        <div className="chat-empty">
          <div className="hero-mark" aria-hidden />
          <h1>What are we making?</h1>
          <p className="faint">Images, video, node flows and layered designs — the agent plans it and asks before spending.</p>
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.text}
                type="button"
                className="suggestion"
                onClick={() => {
                  setComposer({ text: s.text, mode: s.mode });
                  setUi((u) => ({ focusComposer: u.focusComposer + 1 }));
                }}
              >
                <span className="faint">{s.mode === 'agent' ? 'Agent' : 'Image'}</span>
                {s.text}
              </button>
            ))}
          </div>
        </div>
      )}
      {showJump ? (
        <button
          type="button"
          className="jump-btn"
          aria-label="Jump to latest"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
        >
          <ArrowDown size={15} />
        </button>
      ) : null}
    </div>
  );
}
