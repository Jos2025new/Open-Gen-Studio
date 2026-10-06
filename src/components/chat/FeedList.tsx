import { memo, useMemo, useState } from 'react';
import { CircleAlert, Copy, Info, LoaderCircle, Pencil, RotateCw, Trash } from 'lucide-react';
import type { FeedItem, NoticeFeedItem } from '../../engine/types';
import { askForPlan, deleteGarbled, deleteUserMessage, editUserMessage, retryAgentTurn, undoNodeDeletion } from '../../engine/agent/runtime';
import { copyText } from '../../engine/actions';
import { useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';
import { AssetMedia } from '../ui/AssetMedia';
import { GenerationCard } from './GenerationCard';
import { PlanCard } from './PlanCard';
import { ActivityBlock } from './ActivityBlock';
import { QuestionsCard } from './QuestionsCard';
import { SettingsCard } from './SettingsCard';

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

/** One of the user's messages; copy, edit and delete show on hover or focus. Editing makes the answer again. */
function UserMessage({ item, sessionId, tag }: { item: Extract<FeedItem, { type: 'user' }>; sessionId: string; tag: React.ReactNode }) {
  const busy = useStore((s) => Boolean(s.sessions[sessionId]?.agent.busy));
  const later = useStore((s) => {
    const feed = s.sessions[sessionId]?.feed ?? [];
    return feed.length - 1 - feed.findIndex((f) => f.id === item.id);
  });
  const current = useStore((s) => s.ui.workspace);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const save = () => {
    if (!draft.trim() && !item.attachments.length) return;
    setEditing(false);
    void editUserMessage(sessionId, item.id, draft);
  };
  return (
    <div className="msg msg-user">
      <div className={`bubble ${item.text.includes('\n') ? 'is-multiline' : ''}`}>
        {item.attachments.length ? (
          <div className="bubble-attachments">
            {item.attachments.map((id) => (
              <span key={id} className="attach-thumb small">
                <AssetMedia assetId={id} hoverPlay={false} />
              </span>
            ))}
          </div>
        ) : null}
        {editing ? (
          <div className="msg-edit">
            <textarea
              autoFocus
              value={draft}
              rows={Math.min(10, draft.split('\n').length + 1)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
              }}
            />
            {later ? <span className="faint">Everything after this message is replaced by the new answer; results stay in Assets.</span> : null}
            <div className="msg-edit-actions">
              <button type="button" className="notice-retry" onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className="notice-retry is-primary" disabled={busy} onClick={save}>Send</button>
            </div>
          </div>
        ) : item.text ? (
          <p>{item.text}</p>
        ) : null}
      </div>
      {!editing ? (
        <div className="msg-actions">
          {tag}
          <IconButton icon={Copy} label="Copy" size="sm" onClick={() => void copyText(item.text)} />
          {item.workspace === current ? (
            <IconButton icon={Pencil} label="Edit" size="sm" disabled={busy} onClick={() => { setDraft(item.text); setEditing(true); }} />
          ) : null}
          <IconButton icon={Trash} label="Delete" size="sm" tone="danger" disabled={busy} onClick={() => deleteUserMessage(sessionId, item.id)} />
        </div>
      ) : null}
    </div>
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
      {item.garbledItemId !== undefined && isLast ? (
        <button type="button" className="notice-retry" disabled={busy} onClick={() => deleteGarbled(sessionId, item.id)}>
          Delete
        </button>
      ) : null}
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

/** One row. Memoized: while the agent writes only its own bubble changes, so the rest of the conversation is not redrawn. */
export const FeedItemView = memo(function FeedItemView({ item, sessionId, compact }: { item: FeedItem; sessionId: string; compact?: boolean }) {
  const current = useStore((s) => s.ui.workspace);
  const tag = item.workspace !== current ? <span className="ws-badge">{WS[item.workspace]}</span> : null;
  switch (item.type) {
    case 'user':
      return <UserMessage item={item} sessionId={sessionId} tag={tag} />;
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
    case 'settings':
      return <SettingsCard item={item} sessionId={sessionId} />;
    case 'plan':
      return <PlanCard item={item} sessionId={sessionId} />;
    case 'generation':
      return <GenerationCard generationId={item.generationId} compact={compact} initialOutputIndex={item.outputIndex} mirroredFrom={item.mirroredFrom} />;
    case 'notice':
      return <NoticeView item={item} sessionId={sessionId} />;
  }
});

export function FeedList({ sessionId, compact }: { sessionId: string; compact?: boolean }) {
  // Each canvas shows its own messages; the agent's conversation is one per session, so the others can be shown too.
  const all = useStore((s) => s.sessions[sessionId]?.feed ?? EMPTY);
  const canvas = useStore((s) => s.ui.workspace);
  const [everywhere, setEverywhere] = useState(false);
  const others = useMemo(() => all.filter((f) => f.workspace !== canvas).length, [all, canvas]);
  const feed = useMemo(() => (everywhere ? all : all.filter((f) => f.workspace === canvas)), [all, canvas, everywhere]);
  const phase = useStore((s) => (s.sessions[sessionId]?.agent.busy ? s.sessions[sessionId]?.agent.phase ?? 'working' : null));
  const last = feed[feed.length - 1];
  // While text streams, its caret already shows activity; an open activity block shows its own progress (L3).
  const liveActivity = feed.some((f) => f.type === 'activity' && !f.endedAt);
  const showStatus = phase && !liveActivity && !(last?.type === 'assistant' && last.streaming);
  return (
    <div className={`feed ${compact ? 'is-compact' : ''}`}>
      {others ? (
        <button type="button" className="feed-everywhere faint" onClick={() => setEverywhere((v) => !v)}>
          {everywhere ? 'Show only this canvas' : `Show the other canvases too (${others})`}
        </button>
      ) : null}
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
