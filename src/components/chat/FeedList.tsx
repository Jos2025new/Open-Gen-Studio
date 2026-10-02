import { useMemo } from 'react';
import { CircleAlert, Info, LoaderCircle, RotateCw } from 'lucide-react';
import type { FeedItem, NoticeFeedItem } from '../../engine/types';
import { askForPlan, retryAgentTurn, undoNodeDeletion } from '../../engine/agent/runtime';
import { useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { GenerationCard } from './GenerationCard';
import { PlanCard } from './PlanCard';
import { ActivityBlock } from './ActivityBlock';
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

function NoticeView({ item, sessionId }: { item: NoticeFeedItem; sessionId: string }) {
  // Retry only on the latest item: after a new message it would answer out of order.
  const isLast = useStore((s) => s.sessions[sessionId]?.feed.at(-1)?.id === item.id);
  const busy = useStore((s) => Boolean(s.sessions[sessionId]?.agent.busy));
  return (
    <div className={`notice notice-${item.level}`}>
      {item.level === 'error' ? <CircleAlert size={14} /> : <Info size={14} />}
      <span>{item.text}</span>
      {item.undoNodes && !item.undone ? <button type="button" className="notice-retry" onClick={() => undoNodeDeletion(sessionId, item.id)}>Undo</button> : null}
      {item.proposePlan && isLast ? (
        <button type="button" className="notice-retry" disabled={busy} onClick={() => askForPlan(sessionId, item.id)}>
          Propose the plan
        </button>
      ) : null}
      {item.retry && isLast ? (
        <button type="button" className="notice-retry" disabled={busy} onClick={() => void retryAgentTurn(sessionId, item.id)}>
          <RotateCw size={13} />
          Retry
        </button>
      ) : null}
    </div>
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
      // A turn that ended with no words (only tool calls) leaves nothing to show.
      if (!item.streaming && !item.text.trim()) return null;
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
    case 'activity':
      return <ActivityBlock item={item} sessionId={sessionId} />;
    case 'questions':
      return <QuestionsCard item={item} sessionId={sessionId} />;
    case 'plan':
      return <PlanCard item={item} sessionId={sessionId} />;
    case 'generation':
      return <GenerationCard generationId={item.generationId} compact={compact} />;
    case 'notice':
      return <NoticeView item={item} sessionId={sessionId} />;
  }
}

export function FeedList({ sessionId, compact }: { sessionId: string; compact?: boolean }) {
  // Each canvas shows only its own conversation with the agent.
  const all = useStore((s) => s.sessions[sessionId]?.feed ?? EMPTY);
  const canvas = useStore((s) => s.ui.workspace);
  const feed = useMemo(() => all.filter((f) => f.workspace === canvas), [all, canvas]);
  const phase = useStore((s) => (s.sessions[sessionId]?.agent.busy ? s.sessions[sessionId]?.agent.phase ?? 'working' : null));
  const last = feed[feed.length - 1];
  // While text streams, its caret already shows activity; an open activity block shows its own progress (L3).
  const liveActivity = feed.some((f) => f.type === 'activity' && !f.endedAt);
  const showStatus = phase && !liveActivity && !(last?.type === 'assistant' && last.streaming);
  return (
    <div className={`feed ${compact ? 'is-compact' : ''}`}>
      {feed.map((item) => (
        <FeedItemView key={item.id} item={item} sessionId={sessionId} compact={compact} />
      ))}
      {showStatus ? (
        <div className="agent-status faint" role="status">
          <LoaderCircle size={13} className="spin" />
          <span>{PHASE_TEXT[phase]}</span>
        </div>
      ) : null}
    </div>
  );
}

const EMPTY: FeedItem[] = [];
const PHASE_TEXT = { working: 'Working on it…', drafting: 'Drafting the plan…', checking: 'Checking the plan…' } as const;
