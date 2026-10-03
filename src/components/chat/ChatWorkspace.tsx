import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { setComposer, setUi, useStore } from '../../store/store';
import { nodeWorkNotInChat, nodesToChat } from '../../engine/flow/fromNodes';
import { ImportFromNodes } from '../ui/ImportFromChat';
import { FeedList } from './FeedList';
import { useShallow } from 'zustand/react/shallow';

const SUGGESTIONS = [
  { text: 'Hero product shot of a matte black perfume bottle on wet stone, then animate a slow orbit', mode: 'agent' as const },
  { text: 'Storyboard of 4 shots: a lighthouse keeper at dawn during a storm', mode: 'agent' as const },
  { text: 'Editorial portrait of a ceramic artist in her studio, soft window light', mode: 'image' as const },
];

export function ChatWorkspace() {
  const sessionId = useStore((s) => s.activeSessionId);
  const [session, generations, assets] = useStore(useShallow((s) => [s.sessions[s.activeSessionId], s.generations, s.assets]));
  const fromNodes = useMemo(
    () => nodeWorkNotInChat(sessionId).map((item) => ({ id: item.nodeId, assetId: item.assetId, label: item.label })),
    [sessionId, session, generations, assets],
  );
  const count = useStore((s) => s.sessions[s.activeSessionId]?.feed.filter((f) => f.workspace === 'chat').length ?? 0);
  const lastKey = useStore((s) => {
    const f = s.sessions[s.activeSessionId]?.feed.filter((x) => x.workspace === 'chat');
    const last = f?.[f.length - 1];
    if (!last) return '';
    if (last.type === 'assistant') return `${last.id}:${last.text.length}`;
    // The activity block keeps its id while the reasoning grows: follow its size too.
    if (last.type === 'activity') return `${last.id}:${last.entries.length}:${last.entries.reduce((n, e) => n + (e.kind === 'thinking' ? e.text.length : 0), 0)}:${last.endedAt ?? ''}`;
    return last.id;
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

  return <>
    <ImportFromNodes sessionId={sessionId} items={fromNodes} noun="result" onImport={(ids) => nodesToChat(sessionId, ids)} />
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
  </>;
}
