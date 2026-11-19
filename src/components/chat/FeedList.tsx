import { memo, useState } from 'react';
import { resolveOwner } from '../../engine/agent/lanes';
import { useThread, useWorkingPhase } from '../../engine/agent/useThread';
import { ignoreExcess, openBudgetSettings } from '../../engine/budget';
import { ChevronDown, CircleAlert, Copy, Info, LoaderCircle, Pencil, RotateCw, Trash } from '../ui/icons';
import { buildMessageMetaSummary } from '../../engine/feedMeta';
import type { FeedItem, NoticeFeedItem } from '../../engine/types';
import { deleteGarbled, deleteUserMessage, editUserMessage, retryAgentTurn, undoNodeDeletion } from '../../engine/agent/runtime';
import { copyText } from '../../engine/actions';
import { useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';
import { AssetMedia } from '../ui/AssetMedia';
import { StudioGeneration } from './StudioGeneration';
import { GenerationCard } from './GenerationCard';
import { PlanCard } from './PlanCard';
import { CommandApprovalCard } from './CommandApprovalCard';
import { ActivityBlock } from './ActivityBlock';
import { QuestionsCard } from './QuestionsCard';
import { SettingsCard } from './SettingsCard';

type MetaFeedItem = Extract<FeedItem, { type: 'user' | 'assistant' | 'notice' | 'plan' | 'questions' | 'settings' | 'commands' }>;

function MessageMeta({ item, className = '' }: { item: MetaFeedItem; className?: string }) {
  const s = buildMessageMetaSummary(item);
  return (
    <div className={`msg-meta ${className}`.trim()} data-tip={s.tooltip}>
      <span className="ws-badge">{s.spaceLabel}</span>
      <time className="msg-time num" dateTime={new Date(item.createdAt).toISOString()}>
        {s.dateTime}
      </time>
      {s.detailParts.length ? <span className="msg-meta-detail">{s.detailParts.join(' · ')}</span> : null}
    </div>
  );
}

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
function UserMessage({ item, sessionId }: { item: Extract<FeedItem, { type: 'user' }>; sessionId: string }) {
  const busy = useThread(sessionId, resolveOwner(sessionId, item.meta?.agentNodeId), (a) => a.busy, false);
  const later = useStore((s) => {
    const feed = s.sessions[sessionId]?.feed ?? [];
    return feed.length - 1 - feed.findIndex((f) => f.id === item.id);
  });
  const current = useStore((s) => s.ui.workspace);
  // A message written in Studio's chat stays editable there, whatever the board shows (2026-10-24).
  const editable = item.workspace === current || current === 'chat';
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
        <div className="msg-foot">
          <MessageMeta item={item} />
          <div className="msg-actions">
            <IconButton icon={Copy} label="Copy" size="sm" onClick={() => void copyText(item.text)} />
            {editable ? (
              <IconButton icon={Pencil} label="Edit" size="sm" disabled={busy} onClick={() => { setDraft(item.text); setEditing(true); }} />
            ) : null}
            <IconButton icon={Trash} label="Delete" size="sm" tone="danger" disabled={busy} onClick={() => deleteUserMessage(sessionId, item.id)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function NoticeView({ item, sessionId }: { item: NoticeFeedItem; sessionId: string }) {
  // Retry only on the latest item: after a new message it would answer out of order.
  const isLast = useStore((s) => s.sessions[sessionId]?.feed.at(-1)?.id === item.id);
  const busy = useThread(sessionId, resolveOwner(sessionId, item.meta?.agentNodeId), (a) => a.busy, false);
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
      {item.overLimitFor && !item.overLimitFor.ignored ? (
        <>
          <button type="button" className="notice-retry" onClick={openBudgetSettings}>Review limit</button>
          <button type="button" className="notice-retry" onClick={() => ignoreExcess(sessionId, item.id)}>Ignore</button>
        </>
      ) : null}
      {item.retry && isLast ? (
        <button type="button" className="notice-retry" disabled={busy} onClick={() => void retryAgentTurn(sessionId, item.id)}>
          <RotateCw size={13} />
          Retry
        </button>
      ) : null}
      <MessageMeta item={item} className="notice-meta faint" />
    </div>
  );
}

/** One row. Memoized: while the agent writes only its own bubble changes, so the rest of the conversation is not redrawn. */
export const FeedItemView = memo(function FeedItemView({ item, sessionId, compact, studio }: { item: FeedItem; sessionId: string; compact?: boolean; studio?: boolean }) {
  switch (item.type) {
    case 'user':
      return <UserMessage item={item} sessionId={sessionId} />;
    case 'assistant':
      // A turn that ended with no words (only tool calls) leaves nothing to show.
      if (!item.streaming && !item.text.trim()) return null;
      return (
        <div className="msg msg-agent">
          <span className="agent-mark" aria-hidden />
          <div className="agent-text">
            <RichText text={item.text} />
            {item.streaming ? <span className="caret" /> : null}
            <MessageMeta item={item} className="agent-meta faint" />
          </div>
        </div>
      );
    case 'activity':
      return <ActivityBlock item={item} sessionId={sessionId} />;
    case 'questions':
      return (
        <div className="feed-card-wrap">
          <QuestionsCard item={item} sessionId={sessionId} />
          <MessageMeta item={item} className="card-meta faint" />
        </div>
      );
    case 'settings':
      return item.inline ? null : (
        <div className="feed-card-wrap">
          <SettingsCard item={item} sessionId={sessionId} />
          <MessageMeta item={item} className="card-meta faint" />
        </div>
      );
    case 'plan':
      return (
        <div className="feed-card-wrap">
          <PlanCard item={item} sessionId={sessionId} />
          <MessageMeta item={item} className="card-meta faint" />
        </div>
      );
    case 'commands':
      return (
        <div className="feed-card-wrap">
          <CommandApprovalCard item={item} sessionId={sessionId} />
          <MessageMeta item={item} className="card-meta faint" />
        </div>
      );
    case 'generation':
      if (studio) return <StudioGeneration generationId={item.generationId} fallback={<GenerationCard generationId={item.generationId} compact={compact} initialOutputIndex={item.outputIndex} mirroredFrom={item.mirroredFrom} />} />;
      return <GenerationCard generationId={item.generationId} compact={compact} initialOutputIndex={item.outputIndex} mirroredFrom={item.mirroredFrom} />;
    case 'notice':
      return <NoticeView item={item} sessionId={sessionId} />;
  }
});

/** `studio`: Studio's chat, where generations show as small inline results instead of cards. */
export function FeedList({ sessionId, compact, studio }: { sessionId: string; compact?: boolean; studio?: boolean }) {
  // The conversation is continuous across Spaces; every message carries its own Space badge instead of hiding others.
  const feed = useStore((s) => s.sessions[sessionId]?.feed ?? EMPTY);
  const phase = useWorkingPhase(sessionId);
  const last = feed[feed.length - 1];
  // While text streams, its caret already shows activity; an open activity block shows its own progress (L3).
  const liveActivity = feed.some((f) => f.type === 'activity' && !f.endedAt);
  const showStatus = phase && !liveActivity && !(last?.type === 'assistant' && last.streaming);
  return (
    <div className={`feed ${compact ? 'is-compact' : ''}`}>
      {(studio ? studioRuns(feed) : feed).map((row) =>
        Array.isArray(row) ? (
          <StudioRun key={row[0].id} items={row} />
        ) : (
          <FeedItemView key={row.id} item={row} sessionId={sessionId} compact={compact} studio={studio} />
        ),
      )}
      {showStatus ? (
        <div className="agent-status faint" role="status">
          <LoaderCircle size={13} className="spin" />
          <span>{PHASE_TEXT[phase]}</span>
        </div>
      ) : null}
    </div>
  );
}

/** A run of results, three to a row; each row folds as a whole. */
function StudioRun({ items }: { items: FeedItem[] }) {
  const rows = Array.from({ length: Math.ceil(items.length / 3) }, (_, i) => items.slice(i * 3, i * 3 + 3));
  return <div className="feed-gen-run">{rows.map((row) => <StudioRunRow key={row[0].id} items={row} />)}</div>;
}

function StudioRunRow({ items }: { items: FeedItem[] }) {
  const [open, setOpen] = useState(true);
  const files = useStore((s) => items.reduce((n, item) => n + (item.type === 'generation' ? s.generations[item.generationId]?.assetIds.length ?? 0 : 0), 0));
  return <div className="feed-gen-row">
    <button type="button" className="studio-gen-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      Created {files} file{files === 1 ? '' : 's'}
      <ChevronDown size={13} className={open ? '' : 'is-closed'} />
    </button>
    {open ? <div className="feed-gen-grid">
      {items.map((item) => item.type === 'generation' ? <StudioGeneration key={item.id} generationId={item.generationId} grouped fallback={<GenerationCard generationId={item.generationId} initialOutputIndex={item.outputIndex} mirroredFrom={item.mirroredFrom} />} /> : null)}
    </div> : null}
  </div>;
}

/** Studio's chat lays consecutive results side by side: each run of two or more generations becomes one row group. */
export function studioRuns(feed: FeedItem[]): Array<FeedItem | FeedItem[]> {
  const rows: Array<FeedItem | FeedItem[]> = [];
  let run: FeedItem[] = [];
  const flush = () => {
    if (run.length > 1) rows.push(run);
    else rows.push(...run);
    run = [];
  };
  for (const item of feed) {
    if (item.type === 'generation') run.push(item);
    else {
      flush();
      rows.push(item);
    }
  }
  flush();
  return rows;
}

const EMPTY: FeedItem[] = [];
const PHASE_TEXT = { working: 'Working on it…', drafting: 'Drafting the plan…', checking: 'Checking the plan…' } as const;
