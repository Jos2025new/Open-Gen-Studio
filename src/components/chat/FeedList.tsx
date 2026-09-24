import { CircleAlert, Info } from 'lucide-react';
import type { FeedItem } from '../../engine/types';
import { useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { GenerationCard } from './GenerationCard';
import { PlanCard } from './PlanCard';
import { QuestionsCard } from './QuestionsCard';

const WS = { chat: 'Chat', node: 'Node', designer: 'Designer' } as const;

/** Minimal inline formatting: paragraphs, **bold**, `code` and "- " lists. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string, key: number) => {
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
      <span key={key}>
        {parts.map((p, i) =>
          p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith('`') && p.endsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p,
        )}
      </span>
    );
  };
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''), j)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{lines.map((l, j) => (j ? [<br key={`b${j}`} />, inline(l, j)] : inline(l, j)))}</p>;
      })}
    </>
  );
}

export function FeedItemView({ item, sessionId, compact }: { item: FeedItem; sessionId: string; compact?: boolean }) {
  const current = useStore((s) => s.ui.workspace);
  const tag = item.workspace !== current ? <span className="ws-badge">{WS[item.workspace]}</span> : null;
  switch (item.type) {
    case 'user':
      return (
        <div className="msg msg-user">
          <div className="bubble">
            {item.attachments.length ? (
              <div className="bubble-attachments">
                {item.attachments.map((id) => (
                  <span key={id} className="attach-thumb small">
                    <AssetMedia assetId={id} hoverPlay={false} />
                  </span>
                ))}
              </div>
            ) : null}
            {item.text ? <p>{item.text}</p> : null}
          </div>
          {tag}
        </div>
      );
    case 'assistant':
      return (
        <div className="msg msg-agent">
          <span className="agent-mark" aria-hidden />
          <div className="agent-text">
            <RichText text={item.text} />
            {item.streaming ? <span className="caret" /> : null}
            <span className="agent-meta faint">
              {item.engine}
              {tag}
            </span>
          </div>
        </div>
      );
    case 'questions':
      return <QuestionsCard item={item} sessionId={sessionId} />;
    case 'plan':
      return <PlanCard item={item} sessionId={sessionId} />;
    case 'generation':
      return <GenerationCard generationId={item.generationId} compact={compact} />;
    case 'notice':
      return (
        <div className={`notice notice-${item.level}`}>
          {item.level === 'error' ? <CircleAlert size={14} /> : <Info size={14} />}
          <span>{item.text}</span>
        </div>
      );
  }
}

export function FeedList({ sessionId, compact }: { sessionId: string; compact?: boolean }) {
  const feed = useStore((s) => s.sessions[sessionId]?.feed ?? EMPTY);
  return (
    <div className={`feed ${compact ? 'is-compact' : ''}`}>
      {feed.map((item) => (
        <FeedItemView key={item.id} item={item} sessionId={sessionId} compact={compact} />
      ))}
    </div>
  );
}

const EMPTY: FeedItem[] = [];
