import { modelSummary } from '../catalog';
import type { FeedItem, LlmMessage, QuestionsFeedItem, SettingsFeedItem, EditLogEntry } from '../types';
import { patchSession, removeFeedItem, setUi, updateFeedItem } from '../../store/store';
import { describeChoice, sectionsOf } from './settingsCard';
import { get, patchAgent, session } from './runtimeShared';
import { sendAgentMessage } from './conversation';
import { removeDraftNodes } from './planRun';

const DELETED_MESSAGE = '[The user deleted this message. Ignore it and anything that only answered it.]';

function messageText(m: LlmMessage): string {
  return typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n') : '';
}

/**
 * The history message that carries a user feed message (its words inside <user_message>), or -1. Identical texts
 * are told apart by order, counted from the end (the feed can hold copies the history does not, e.g. offline turns).
 */
function historyIndexOf(sessionId: string, itemId: string): number {
  const s = session(sessionId);
  const users = s.feed.filter((f): f is Extract<FeedItem, { type: 'user' }> => f.type === 'user');
  const item = users.find((f) => f.id === itemId);
  if (!item) return -1;
  const same = users.filter((f) => f.text === item.text);
  const needle = `\n${item.text || '(no text)'}\n</user_message>`;
  const hits = s.agent.history.flatMap((m, i) => ((m.role === 'user' || m.role === 'tool') && messageText(m).includes(needle) ? [i] : []));
  const k = hits.length - (same.length - same.indexOf(item));
  return k >= 0 ? hits[k] : -1;
}

/** Delete one of the user's messages: gone from the chat, and from what the agent reads (a short note keeps the turn order valid). */
export function deleteUserMessage(sessionId: string, itemId: string): void {
  const s = session(sessionId);
  const item = s?.feed.find((f) => f.id === itemId);
  if (!s || s.agent.busy || item?.type !== 'user') return;
  const i = historyIndexOf(sessionId, itemId);
  if (i >= 0) patchAgent(sessionId, (a) => ({ history: a.history.map((m, j) => (j === i ? { ...m, content: DELETED_MESSAGE } : m)) }));
  else if (item.text) patchAgent(sessionId, (a) => ({ notes: [...a.notes, `The user deleted an earlier message of theirs ("${item.text.slice(0, 80)}"): ignore it.`] }));
  removeFeedItem(sessionId, itemId);
}

/**
 * Edit one of the user's messages: it and everything after it in the conversation (every canvas) are dropped — the
 * old answer is not kept; results stay in Assets — and the edited text is sent again with its attachments.
 */
export async function editUserMessage(sessionId: string, itemId: string, text: string): Promise<void> {
  const s = session(sessionId);
  const item = s?.feed.find((f) => f.id === itemId);
  if (!s || s.agent.busy || item?.type !== 'user' || (!text.trim() && !item.attachments.length)) return;
  const i = historyIndexOf(sessionId, itemId);
  const at = s.feed.indexOf(item);
  logEdit(sessionId, { kind: 'message', itemId, before: item.text, removed: s.feed.length - at - 1 });
  for (const f of s.feed.slice(at)) {
    if (f.type === 'plan' && f.status === 'awaiting') removeDraftNodes(sessionId, f.plan.id);
    removeFeedItem(sessionId, f.id);
  }
  patchAgent(sessionId, (a) => ({
    history: i >= 0 ? a.history.slice(0, i) : a.history,
    notes: i >= 0 ? [] : [...a.notes, 'The user edited an earlier message; the answers after it were discarded.'],
    pending: undefined,
    revising: undefined,
    questionRound: 0,
    draft: undefined,
    phase: undefined,
  }));
  if (get().ui.workspace !== 'chat' && get().ui.workspace !== item.workspace) setUi({ workspace: item.workspace });
  await sendAgentMessage(text, { attachments: item.attachments });
}

/** What the user changed back in the conversation: kept in the session for us, never sent to the agent. */
function logEdit(sessionId: string, e: Omit<EditLogEntry, 'at'>): void {
  patchSession(sessionId, (s) => ({ ...s, editLog: [...(s.editLog ?? []), { at: Date.now(), ...e }].slice(-100) }));
}

/** Whether an answered questions card or confirmed settings card can be opened again (the agent's call is known). */
export function canReopenCard(sessionId: string, itemId: string): boolean {
  const s = session(sessionId);
  const item = s?.feed.find((f) => f.id === itemId);
  if (!s || s.agent.busy || !item || (item.type !== 'questions' && item.type !== 'settings') || item.status === 'pending') return false;
  const id = cardCallId(sessionId, item);
  return Boolean(id) && s.agent.history.some((m) => m.role === 'tool' && m.tool_call_id === id);
}

/**
 * The agent's call a card answers. Cards made before it was stored: matched by order with the calls of that tool in
 * the conversation, only when both counts agree (otherwise the card cannot be reopened).
 */
function cardCallId(sessionId: string, item: QuestionsFeedItem | SettingsFeedItem): string | undefined {
  if (item.toolCallId) return item.toolCallId;
  const s = session(sessionId);
  const tool = item.type === 'questions' ? 'ask_questions' : 'confirm_settings';
  const calls = s.agent.history.flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []).filter((c) => c.function.name === tool).map((c) => c.id) : []));
  const cards = s.feed.filter((f) => f.type === item.type && f.workspace === item.workspace && f.status !== 'pending');
  return calls.length === cards.length ? calls[cards.indexOf(item)] : undefined;
}

/**
 * Edit an earlier answer (questions or settings card): like editing a message, the card and the conversation go
 * back to that point — everything after it leaves the chat and what the agent sees — and the card opens again with
 * the earlier choices preselected. Results already made stay in Assets. The edit is logged for us (editLog).
 */
export function reopenCard(sessionId: string, itemId: string): void {
  if (!canReopenCard(sessionId, itemId)) return;
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId)! as QuestionsFeedItem | SettingsFeedItem;
  const at = s.feed.indexOf(item);
  const callId = cardCallId(sessionId, item)!;
  const cut = s.agent.history.findIndex((m) => m.role === 'tool' && m.tool_call_id === callId);
  const before = item.type === 'questions'
    ? Object.entries(item.answers ?? {}).map(([k, v]) => `${item.questions.find((q) => q.id === k)?.question ?? k}: ${v}`).join(' | ')
    : sectionsOf(item).map((x) => `${x.kind}: ${describeChoice(modelSummary((x.chosen ?? x.recommended).modelRef)?.name ?? '', x.chosen ?? x.recommended)}`).join(' | ');
  logEdit(sessionId, { kind: item.type, itemId, before, removed: s.feed.length - at - 1 });
  for (const f of s.feed.slice(at + 1)) {
    if (f.type === 'plan' && f.status === 'awaiting') removeDraftNodes(sessionId, f.plan.id);
    removeFeedItem(sessionId, f.id);
  }
  if (item.type === 'questions') updateFeedItem<QuestionsFeedItem>(sessionId, itemId, { status: 'pending', toolCallId: callId });
  else updateFeedItem<SettingsFeedItem>(sessionId, itemId, { status: 'pending', toolCallId: callId });
  patchAgent(sessionId, (a) => ({
    history: a.history.slice(0, cut),
    pending: { toolCallId: callId, kind: item.type, feedItemId: itemId },
    // Settings confirmed after this point no longer hold; a reopened settings card drops its own kinds too.
    settings: item.type === 'questions' ? undefined : Object.fromEntries(Object.entries(a.settings ?? {}).filter(([k]) => !sectionsOf(item).some((x) => x.kind === k))),
    questionRound: item.type === 'questions' ? item.round : a.questionRound,
    revising: undefined,
    notes: [],
    phase: undefined,
  }));
}

export function deleteGarbled(sessionId: string, noticeId: string): void {
  const item = session(sessionId)?.feed.find((f) => f.id === noticeId);
  if (item?.type !== 'notice') return;
  if (item.garbledItemId) removeFeedItem(sessionId, item.garbledItemId);
  removeFeedItem(sessionId, noticeId);
}
