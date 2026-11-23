import { hasLlmPossibleCharge } from '../money/storeBridge';
import { dismissAlert, pushAlert } from '../alerts';
import { carried, confirmedSections } from './draftActions';
import { agentAccepts } from './sendGate';
import { beginJourney, journeyIdFor, recordJourneyEvent } from '../../lib/journeyTrace';
import { adjustedNote } from '../planRevision';
import { workflowById, refreshLoadedGuides } from '../skills';
import { LLM_LABELS } from '../providers/llm';
import { VIEWABLE_MEDIA_KINDS, type LlmMessage, type PlanFeedItem, type QuestionsFeedItem, type SettingsChoice, type SettingsFeedItem, type SettingsSection, type Workspace } from '../types';
import { appendFeed, autoTitleSession, removeFeedItem, setComposer, updateFeedItem } from '../../store/store';
import { buildContext } from './context';
import { agentSeesImages, attachmentParts, stripImages, trimReferenceResults, userMessage } from './attachments';
import { startRequest } from './metrics';
import { skillById } from '../skills';
import { modelGuide } from '../guides';
import { confirmedState } from './switchModel';
import { settingsResultText } from './settingsResult';
import { inConversation, pickedWorkflowGuides } from './requestGuides';
import { steerNote } from './force';
import { OPS } from '../ops';
import { sectionsOf } from './settingsCard';
import { rememberSessionModel } from './sessionModel';
import { agentCanvas } from './agentCanvas';
import { canvasParts } from './canvasView';
import { promptsWiredToAgent } from '../nodes/spec';
import { addReplyToRequest, agentEngine, agentOf, agentNodeOf, chatNodeOf, controllers, turnKey, engineLabel, feedBase, get, messageMeta, notice, patchAgent, requestGate, session, setTurnChat, toCanvas, toCanvasOfItem, turnCanvas, userBlock } from './runtimeShared';
import { uid } from '../../lib/id';
import { offlineTurn } from './offlineTurn';
import { removeDraftNodes } from './planRun';
import { llmTurn } from './llmTurn';
import { claimLaneOfItem, enterLane, laneOfItem, laneState } from './lanes';
import { MAIN_THREAD } from './threads';
import { recipientOf } from './recipient';

export async function sendAgentMessage(text: string, opts: { attachments?: string[]; agentNodeId?: string; chatNodeId?: string } = {}): Promise<void> {
  const st = get();
  const sessionId = st.activeSessionId;
  const canvas = agentCanvas();
  // The recipient is explicit end to end (ADR 0031, strip 2): this agent's own state, history, cards and model.
  const to = recipientOf(sessionId, opts.agentNodeId, opts.chatNodeId);
  if (!to.error && !agentAccepts(sessionId, to.id)) return;
  if (to.error) { notice(sessionId, canvas, to.error, 'error'); return; }
  if (!text.trim() && ![...(opts.attachments ?? st.composer.attachments)].length) return;
  enterLane(sessionId, to.id);
  // The turn is reserved before the first wait (attachments, the Designer page): nothing else can enter this session meanwhile.
  setTurnChat(sessionId, opts.chatNodeId ?? chatNodeOf(sessionId), to.id);
  toCanvas(sessionId, canvas, to.id); // switching canvas loads that canvas's parked state: it must happen before the reservation
  patchAgent(sessionId, { busy: true, phase: 'working' }, to.id);
  // Stop works from the first moment: until the turn has its own controller, this one is what Stop aborts.
  const key = turnKey(sessionId, to.id);
  const reservation = new AbortController();
  controllers.set(key, reservation);
  try {
    await deliver(text, opts, sessionId, to, st, reservation.signal);
  } finally {
    if (controllers.get(key) === reservation) controllers.delete(key);
    // A turn that ran clears its own flag; one that stopped before starting must not leave the agent reserved.
    if (!controllers.has(key) && laneState(sessionId, to.id)?.busy) patchAgent(sessionId, { busy: false, phase: undefined }, to.id);
  }
}

async function deliver(text: string, opts: { attachments?: string[]; agentNodeId?: string; chatNodeId?: string }, sessionId: string, to: { id: string }, st: ReturnType<typeof get>, stop: AbortSignal): Promise<void> {
  // Studio is the chat canvas whatever its board shows (agentCanvas).
  const workspace = agentCanvas();
  toCanvas(sessionId, workspace, to.id);
  const s = session(sessionId);
  // An edited message brings its own attachments.
  const attachments = [...(opts.attachments ?? st.composer.attachments)];
  const clean = text.trim();
  if (!clean && !attachments.length) return;
  // Independent prompt nodes wired into the agent add their text to what the model reads (the chat shows only what was typed).
  const agentNode = agentNodeOf(sessionId, to.id);
  const wired = agentNode ? promptsWiredToAgent(sessionId, agentNode.id) : [];

  const runId = uid('turn');
  autoTitleSession(sessionId, clean || 'Edit');
  appendFeed(sessionId, { ...feedBase(workspace), type: 'user', text: clean, mode: 'agent', attachments, meta: messageMeta(workspace, { runId, agent: undefined, ...(opts.chatNodeId ? { chatNodeId: opts.chatNodeId } : {}), ...(to.id !== MAIN_THREAD ? { agentNodeId: to.id, toAgentNodeIds: [to.id] } : {}) }, sessionId, to.id) });
  if (!opts.attachments) setComposer({ text: '', attachments: [] });

  const pending = agentOf(sessionId, to.id).pending;
  // A card waiting on another canvas closes as superseded.
  const pendingItem = pending ? s.feed.find((f) => f.id === pending.feedItemId && (workspace === 'chat' || f.workspace === workspace)) : undefined;

  // Typing while questions are open answers them.
  if (pending?.kind === 'questions' && pendingItem?.type === 'questions' && pendingItem.status === 'pending') {
    // Typing keeps what the card shows selected (the user's pick, else each recommended option), plus the user's words as the note.
    const pick = agentOf(sessionId, to.id).cardPick;
    const shown = pick?.itemId === pendingItem.id ? pick.answers : Object.fromEntries(pendingItem.questions.flatMap((q) => (q.default ? [[q.id, q.default]] : [])));
    await submitAnswers(sessionId, pendingItem.id, { ...shown, note: clean }, 'typed', runId);
    return;
  }
  // Typing while the settings card is open never confirms it: it closes unconfirmed and the agent answers.
  if (pending?.kind === 'settings' && pendingItem?.type === 'settings' && pendingItem.status === 'pending') {
    recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'settings-response', event: 'settings.reply_received', reason: 'typed message is not confirmation', sessionId, approvalId: pendingItem.id, before: { status: pendingItem.status, confirmed: false }, after: { status: 'skipped', confirmed: false } });
    updateFeedItem<SettingsFeedItem>(sessionId, pendingItem.id, { status: 'skipped' });
    const engine = agentEngine(sessionId, to.id);
    if (engine.kind === 'llm') {
      addReplyToRequest(sessionId, clean, attachments, to.id);
      const ctx = buildContext(session(sessionId), contextOpts(sessionId, to.id, workspace, attachments));
      replyToCard(sessionId, pending.toolCallId, `The user wrote instead of confirming the settings card. Nothing was confirmed; the card is closed:\n${userBlock(clean, workspace)}\nAnswer what they ask first, in text. If the work still stands, call confirm_settings again with any change they asked for (a model they named stays). Never say the settings were confirmed.\n\n${ctx}`, to.id);
      patchAgent(sessionId, { pending: undefined }, to.id);
      await llmTurn(sessionId, workspace, { route: 'settings-reply', runId, agentNodeId: to.id });
      return;
    }
    patchAgent(sessionId, { pending: undefined }, to.id);
  }
  // Typing while a plan waits: the agent revises it (only what was asked) or treats it as a new request.
  if (pending?.kind === 'plan' && pendingItem?.type === 'plan' && pendingItem.status === 'awaiting') {
    recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'plan-revision', event: 'plan.comment_received', reason: 'user replied while plan awaits approval', sessionId, planId: pendingItem.plan.id, approvalId: pendingItem.id, before: { status: pendingItem.status, adjustments: pendingItem.plan.adjustments } });
    const engine = agentEngine(sessionId, to.id);
    // The engine decides who answers; a plan kept after a text-only reply has no open tool call, so it gets a user message.
    if (engine.kind === 'llm') {
      // The old plan stops being approvable before the first wait; nothing that follows a wait publishes after Stop.
      patchAgent(sessionId, { revising: pendingItem.id }, to.id);
      const parts = await visibleAttachments(sessionId, workspace, attachments, runId, to.id);
      if (stop.aborted) { patchAgent(sessionId, { revising: undefined }, to.id); return; }
      addReplyToRequest(sessionId, clean, attachments, to.id);
      const ctx = buildContext(session(sessionId), contextOpts(sessionId, to.id, workspace, attachments));
      replyToCard(sessionId, pending.toolCallId, `The user replied instead of approving:\n${userBlock(clean, workspace)}${adjustedNote(pendingItem.plan)}\nIf the user asks something, answer it first in one or two sentences of text. If this adjusts the plan (a model, a step, duration, count, which steps to keep), also call propose_plan with revision true: keep every other step, prompt and setting exactly as they were and change only what was asked. If it is a different request, use revision false. Answering only with text leaves this plan waiting as it is (never say you left a new one).\n\n${ctx}`, to.id);
      if (parts.length) pushHistory(sessionId, userMessage('Attached with this comment:', parts), to.id);
      // The card stays until the revision replaces it (or closes at the end of the turn); Run waits meanwhile.
      patchAgent(sessionId, { pending: undefined }, to.id);
      await llmTurn(sessionId, workspace, { route: 'plan-comment', runId, agentNodeId: to.id });
    } else {
      updateFeedItem<PlanFeedItem>(sessionId, pendingItem.id, { status: 'canceled' });
      removeDraftNodes(sessionId, pendingItem.plan.id);
      addReplyToRequest(sessionId, clean, attachments, to.id);
      patchAgent(sessionId, { pending: undefined }, to.id);
      await offlineTurn(sessionId, to.id, workspace, 'plan-comment', runId);
    }
    return;
  }

  // A fresh request.
  if (pending) resolvePendingAsSuperseded(sessionId, to.id);
  beginJourney(sessionId, 'settings-response');
  // Guided confirms its settings in every request; Auto inherits what was confirmed once in the session.
  patchAgent(sessionId, { questionRound: 0, draftMode: carried(sessionId, to.id), draft: { request: clean, answers: {}, attachments }, settingsParts: undefined }, to.id);
  const engine = agentEngine(sessionId, to.id);
  if (engine.kind === 'offline') {
    const { agent, keys } = get().settings;
    if (agent.provider !== 'offline') {
      const why = keys[agent.provider]?.trim() ? `No agent model is chosen for ${LLM_LABELS[agent.provider]}` : `There is no ${LLM_LABELS[agent.provider]} key`;
      notice(sessionId, workspace, `${why}, so the local planner answers. Fix it in Settings → Agent.`, 'info', undefined, { runId });
    }
    await offlineTurn(sessionId, to.id, workspace, 'new', runId);
    return;
  }
  startRequest(sessionId, { request: clean, workspace, engine: engineLabel(sessionId, to.id), attachments: attachments.length });
  const ctx = buildContext(session(sessionId), contextOpts(sessionId, to.id, workspace, attachments));
  const parts = await visibleAttachments(sessionId, workspace, attachments, runId, to.id);
  if (stop.aborted) return;
  // The Designer page travels with a new request, so "draw on this" needs no extra round.
  if (workspace === 'designer' && agentSeesImages(sessionId, to.id)) {
    const view = await canvasParts(sessionId).catch(() => 'The page could not be rendered.');
    if (typeof view !== 'string') parts.push(...view);
    if (stop.aborted) return;
  }
  // New requests retain earlier images/reference results as notes; tools can reload them (T6).
  patchAgent(sessionId, (a) => ({ history: trimReferenceResults(refreshLoadedGuides(stripImages(a.history))) }), to.id);
  // The keyword gate (force.ts): a request that fires mapped operations carries the signal to follow their route.
  // In the Designer filters and effects are FX layers (designer_fx), not the fx operation that makes a new image.
  const gate = workspace === 'node' ? [] : requestGate(sessionId, to.id).filter((g) => workspace !== 'designer' || g.op !== 'fx');
  // Auto and Guided confirm the image model of an image-model operation first (Auto once per session; Guided each request).
  const confirmFirst = get().composer.agentStyle !== 'direct' && !agentOf(sessionId, to.id).settings?.image && gate.some((g) => g.fired && (OPS as Record<string, { engine: string }>)[g.op]?.engine === 'edit');
  const forced = steerNote(gate, confirmFirst);
  // The route goes first: one buried after the context was followed after the prompt's own steps.
  const askFirst = agentOf(sessionId, to.id).questionRound === 0;
  pushHistory(sessionId, userMessage(`${forced}${userBlock([clean, ...wired].filter(Boolean).join('\n\n') || '(no text)', workspace)}\n\n<app_context>\n${ctx}${pickedWorkflowGuides(sessionId, to.id, askFirst)}\n</app_context>`, parts), to.id);
  await llmTurn(sessionId, workspace, { route: 'new', runId, agentNodeId: to.id });
}

/** The attached images as the model sees them; with a model that has no vision, a notice and text only. */
async function visibleAttachments(sessionId: string, workspace: Workspace, attachments: string[], runId?: string, agentNodeId?: string) {
  if (!attachments.some((id) => (VIEWABLE_MEDIA_KINDS as readonly string[]).includes(get().assets[id]?.kind ?? ''))) return [];
  if (!agentSeesImages(sessionId, agentNodeId)) {
    notice(sessionId, workspace, 'The selected agent model cannot see images: it only gets their size and type. Pick a model with vision in Settings.', 'info', undefined, runId ? { runId } : undefined);
    return [];
  }
  return attachmentParts(attachments);
}

function contextOpts(sessionId: string, owner: string, workspace: Workspace, attachments: string[]) {
  const agent = agentOf(sessionId, owner);
  return { workspace, style: get().composer.agentStyle, round: agent.questionRound, maxRounds: get().settings.guidedRounds, attachments, agent };
}

function resolvePendingAsSuperseded(sessionId: string, owner: string): void {
  const s = session(sessionId);
  const p = agentOf(sessionId, owner).pending;
  if (!p) return;
  const item = s.feed.find((f) => f.id === p.feedItemId);
  if (item?.type === 'questions' && item.status === 'pending') updateFeedItem<QuestionsFeedItem>(sessionId, item.id, { status: 'skipped' });
  if (item?.type === 'settings' && item.status === 'pending') updateFeedItem<SettingsFeedItem>(sessionId, item.id, { status: 'skipped' });
  if (item?.type === 'plan' && item.status === 'awaiting') {
    updateFeedItem<PlanFeedItem>(sessionId, item.id, { status: 'canceled' });
    removeDraftNodes(sessionId, item.plan.id);
  }
  if (p.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: p.toolCallId, content: 'The user moved on to a new request without responding.' }, owner);
  patchAgent(sessionId, { pending: undefined }, owner);
}

/** The answer to a card: the tool result when its call is open, else a user message (a plan kept after a text-only reply has no call). */
function replyToCard(sessionId: string, toolCallId: string | null | undefined, content: string, owner: string): void {
  pushHistory(sessionId, toolCallId ? { role: 'tool', tool_call_id: toolCallId, content } : userMessage(`[app] ${content}`, []), owner);
}

/** The one way into an agent's history: it names the agent. */
export function pushHistory(sessionId: string, msg: LlmMessage, agentNodeId: string): void {
  patchAgent(sessionId, (a) => ({ history: [...a.history, msg] }), agentNodeId);
}

/** The card reports what it shows selected, so typing instead of pressing Continue sends it. */
export function pickAnswers(sessionId: string, itemId: string, answers: Record<string, string>): void {
  claimLaneOfItem(sessionId, itemId);
  const owner = laneOfItem(sessionId, itemId);
  const s = get().sessions[sessionId];
  if (!s) return;
  const cur = agentOf(sessionId, owner).cardPick;
  if (cur?.itemId === itemId && JSON.stringify(cur.answers) === JSON.stringify(answers)) return;
  patchAgent(sessionId, { cardPick: { itemId, answers } }, owner);
}

/** Answers chosen in a questions card. */
export async function submitAnswers(sessionId: string, itemId: string, answers: Record<string, string>, how: 'chips' | 'typed' = 'chips', runId?: string): Promise<void> {
  claimLaneOfItem(sessionId, itemId);
  const owner = laneOfItem(sessionId, itemId);
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'questions' || item.status !== 'pending') return;
  updateFeedItem<QuestionsFeedItem>(sessionId, itemId, { status: 'answered', answers });
  recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'settings-response', event: 'questions.answered', reason: `answers submitted via ${how}`, sessionId, approvalId: itemId, before: { status: 'pending' }, after: { status: 'answered', answeredIds: item.questions.filter((q) => answers[q.id]?.trim()).map((q) => q.id), hasNote: Boolean(answers.note?.trim()) } });
  const workspace = turnCanvas(item.workspace);
  const pending = agentOf(sessionId, owner).pending;
  patchAgent(sessionId, { pending: undefined, cardPick: undefined }, owner);
  const engine = agentEngine(sessionId, owner);
  if (engine.kind === 'llm') {
    const lines = item.questions.map((q) => `- ${q.question}: ${answers[q.id] ?? '(no answer)'}`);
    if (answers.note) lines.push(`- User note: ${answers.note}`);
    const ctx = buildContext(session(sessionId), contextOpts(sessionId, owner, workspace, agentOf(sessionId, owner).draft?.attachments ?? []));
    replyToCard(sessionId, pending?.toolCallId, `User answers (${how}):\n${lines.join('\n')}\n\n${ctx}`, owner);
    await llmTurn(sessionId, workspace, { route: 'answers', runId, agentNodeId: owner });
    return;
  }
  const draft = agentOf(sessionId, owner).draft ?? { request: '', answers: {}, attachments: [] };
  const merged = { ...draft.answers, ...answers };
  // A typed note on an offline card enriches the request itself.
  const request = answers.note ? `${draft.request} ${answers.note}`.trim() : draft.request;
  patchAgent(sessionId, { draft: { ...draft, request, answers: merged } }, owner);
  await offlineTurn(sessionId, owner, workspace, 'answers', runId);
}

/** "Skip, plan now" on a questions card: no more questions, plan with sensible defaults. */
export async function skipQuestions(sessionId: string, itemId: string): Promise<void> {
  claimLaneOfItem(sessionId, itemId);
  const owner = laneOfItem(sessionId, itemId);
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'questions' || item.status !== 'pending') return;
  updateFeedItem<QuestionsFeedItem>(sessionId, itemId, { status: 'skipped' });
  const pending = agentOf(sessionId, owner).pending;
  patchAgent(sessionId, { pending: undefined, cardPick: undefined, questionRound: get().settings.guidedRounds }, owner);
  const engine = agentEngine(sessionId, owner);
  if (engine.kind === 'llm') {
    const ctx = buildContext(session(sessionId), contextOpts(sessionId, owner, turnCanvas(item.workspace), agentOf(sessionId, owner).draft?.attachments ?? []));
    replyToCard(sessionId, pending?.toolCallId, `The user skipped the questions. Use sensible defaults and call propose_plan now.\n\n${ctx}`, owner);
    await llmTurn(sessionId, turnCanvas(item.workspace), { route: 'skip', agentNodeId: owner });
    return;
  }
  await offlineTurn(sessionId, owner, turnCanvas(item.workspace), 'skip');
}

/** The selection on an open settings card, kept so a typed message confirms what the user sees. */
export function selectSettings(sessionId: string, itemId: string, index: number, chosen: SettingsChoice): void {
  claimLaneOfItem(sessionId, itemId);
  const item = session(sessionId)?.feed.find((f) => f.id === itemId);
  if (item?.type === 'settings' && item.status === 'pending') updateFeedItem<SettingsFeedItem>(sessionId, itemId, { sections: sectionsOf(item).map((x, i) => (i === index ? { ...x, chosen } : x)) });
}

/** "Continue" on the settings card (phase 2): the agent gets the confirmed values and each model's prompting guide. */
export async function confirmSettings(sessionId: string, itemId: string, chosen: SettingsChoice[], note?: string): Promise<void> {
  claimLaneOfItem(sessionId, itemId);
  const owner = laneOfItem(sessionId, itemId);
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'settings' || item.status !== 'pending') return;
  const sections = confirmedSections(item, sectionsOf(item).map((x, i) => ({ ...x, chosen: chosen[i] ?? x.chosen ?? x.recommended })));
  updateFeedItem<SettingsFeedItem>(sessionId, itemId, { status: 'confirmed', sections });
  recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'settings-response', event: 'settings.confirmed', reason: 'user selected and continued', sessionId, approvalId: itemId, before: { status: item.status, choices: sections.map((x) => ({ kind: x.kind, modelRef: x.recommended.modelRef, count: x.recommended.count, duration: x.recommended.duration })) }, after: { status: 'confirmed', choices: sections.map((x) => ({ kind: x.kind, modelRef: x.chosen!.modelRef, needsImage: x.chosen!.needsImage, count: x.chosen!.count, resolution: x.chosen!.resolution, duration: x.chosen!.duration, aspect: x.chosen!.aspect })) } });
  const pending = agentOf(sessionId, owner).pending;
  // The first part of each kind is that kind's settings; every part is kept, so a plan comparing two models keeps both.
  patchAgent(sessionId, (a) => confirmedState(a, item, sections), owner);
  for (const x of sections) if (x.chosen && sections.filter((p) => p.kind === x.kind).length === 1) rememberSessionModel(sessionId, owner, x.kind, x.chosen, true);
  if (agentEngine(sessionId, owner).kind !== 'llm' || !pending?.toolCallId) return;
  const ctx = buildContext(session(sessionId), contextOpts(sessionId, owner, turnCanvas(item.workspace), agentOf(sessionId, owner).draft?.attachments ?? []));
  pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: `${settingsResultText(item, sections as Array<SettingsSection & { chosen: SettingsChoice }>, (t) => inConversation(sessionId, owner, t), note)}\n\n${ctx}` }, owner);
  await llmTurn(sessionId, turnCanvas(item.workspace), { route: 'settings-confirm', agentNodeId: owner });
}

/**
 * Retry after a transient failure (the connection dropped, the provider was busy). A streamed answer cannot be
 * resumed mid-way, so the failed call runs again with the same history: steps that had finished (a guide read,
 * a model search) are kept and not repeated. The half-written answer and the error notice are removed.
 */
export async function retryAgentTurn(sessionId: string, noticeId: string, confirmedCharge = false): Promise<void> {
  claimLaneOfItem(sessionId, noticeId);
  const owner = laneOfItem(sessionId, noticeId);
  toCanvasOfItem(sessionId, noticeId);
  const s = session(sessionId);
  const item = s?.feed.find((f) => f.id === noticeId);
  if (!s || agentOf(sessionId, owner).busy || item?.type !== 'notice' || !item.retry || agentEngine(sessionId, owner).kind !== 'llm') return;
  if ((item.retry.possibleCharge || hasLlmPossibleCharge(item.meta?.runId)) && !confirmedCharge) {
    const id = pushAlert({ level: 'warn', text: 'The previous request may have been charged. Sending again may charge you again.', actions: [
      { label: 'Resend anyway', run: () => { dismissAlert(id); void retryAgentTurn(sessionId, noticeId, true); } },
      { label: 'Cancel', run: () => dismissAlert(id) },
    ] });
    return;
  }
  if (item.retry.partialItemId) removeFeedItem(sessionId, item.retry.partialItemId);
  removeFeedItem(sessionId, noticeId);
  await llmTurn(sessionId, turnCanvas(item.workspace), { route: 'retry', agentNodeId: owner });
}

// ---------------------------------------------------------------------------
// Offline planner

export function guideLabel(id: string): string {
  const [type, rest = ''] = id.split(':');
  if (type === 'model') return rest === 'video-edit' ? 'Video edit and extend guide' : `${modelGuide(rest)?.name ?? rest} prompting guide`;
  if (type === 'workflow') return `${workflowById(rest.split('/')[0])?.name ?? rest} workflow`;
  if (type === 'skill') return `${skillById(rest)?.name ?? rest} skill`;
  return id;
}

/** Delete under a garbled reply: removes it and the warning. */
export function flushToolResults(sessionId: string, results: LlmMessage[], owner: string): void {
  if (results.length) patchAgent(sessionId, (a) => ({ history: [...a.history, ...results] }), owner);
  results.length = 0;
}

/** Id prefix of a tool call the app read from text markup (toolMarkup): its result carries a warning. */
export const CONVERTED_CALL = 'call_txt_';
const CONVERTED_WARNING =
  'Warning: you wrote this call as text markup (DSML / <tool_call>) inside your reply, so the app had to convert it; markup it cannot read runs nothing. Call tools only through the tool-calling interface, never as text.';

/** The result of a converted call tells the model, on its next call, what went wrong. */
function warnConverted(m: LlmMessage): LlmMessage {
  if (m.role !== 'tool' || !m.tool_call_id?.startsWith(CONVERTED_CALL) || typeof m.content !== 'string') return m;
  return { ...m, content: `${CONVERTED_WARNING}\n\n${m.content}` };
}

/** Keeps OpenAI-format history valid: every assistant tool call gets exactly one tool message. */
export function repairHistory(history: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    out.push(m);
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const ids = m.tool_calls.map((c) => c.id);
      const following: LlmMessage[] = [];
      let j = i + 1;
      while (j < history.length && history[j].role === 'tool') {
        following.push(history[j]);
        j++;
      }
      const have = new Set(following.map((f) => f.tool_call_id));
      out.push(...following.map(warnConverted));
      for (const id of ids) {
        if (!have.has(id)) out.push(warnConverted({ role: 'tool', tool_call_id: id, content: 'No result.' }));
      }
      i = j - 1;
    }
  }
  return out;
}
