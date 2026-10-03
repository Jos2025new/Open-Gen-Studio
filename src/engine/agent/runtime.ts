import { shapeLabel } from '../delivery';
import { editGraphTool } from './nodeTools';
import { nodeIdsSchema } from './tools';
import { restoreNodeDeletion } from '../flow/actions';
import { prepareNodeRun, previewRun, runNodes } from '../flow/actions';
import { uid } from '../../lib/id';
import { isAbort, isTransient } from '../../lib/http';
import { logEvent } from '../../lib/log';
import { ratioOf } from '../params';
import { needsSpendCheck } from '../pricing';
import { parseToolMarkup, toolMarkupAt } from './toolMarkup';
import { chatToNodes } from '../flow/fromChat';
import { isCreditError, onAgentCredit } from '../credit';
import { pushAlert } from '../alerts';
import { chatToDesigner } from '../design/fromChat';
import { findAssets, viewTargets, VIEW_MAX } from './assetSearch';
import { normalizePlan, parseRef, pruneJoins, stepDeps, stepOutputKind, type RawPlan } from '../plan';
import { executeSteps, estimateSteps, type StepOutput } from '../executor';
import { canRecheck, recheckGeneration, retryGeneration } from '../jobs';
import { focusNodes } from '../flow/selection';
import { autoLayout, graphBounds, graphToSteps, planToGraph, nodeOutputAsset, runsGeneration } from '../flow/graph';
import { activeDoc, ensureDoc, getDoc, placeAsset } from '../design/actions';
import { activeSkill, workflowById } from '../skills';
import { chat, LLM_LABELS, type ChatResult } from '../providers/llm';
import { composerChosen, defaultModelChoice, defaultModelFor, loadLlmCatalog, resolveModel, modelSummary } from '../catalog';
import type {
  LlmContentPart,
  ActivityEntry,
  ActivityFeedItem,
  AgentQuestion,
  AgentState,
  FeedItem,
  LlmMessage,
  LlmProviderId,
  MediaKind,
  NoticeFeedItem,
  Estimate,
  Plan,
  PlanFeedItem,
  PlanStep,
  QuestionsFeedItem,
  SettingsChoice,
  SettingsFeedItem,
  SettingsSection,
  EditLogEntry,
  Session,
  StepState,
  Workspace,
} from '../types';
import {
  addSpend,
  appendFeed,
  autoTitleSession,
  patchSession,
  removeFeedItem,
  setComposer,
  setGraph,
  setUi,
  toast,
  updateFeedItem,
  useStore,
} from '../../store/store';
import { SYSTEM_PROMPT, WRAPUP_RULE, buildContext } from './context';
import { offlinePlan } from './offline';
import { findModelsResult, suggestModel } from './modelIndex';
import { agentSeesImages, attachmentParts, stripImages, trimReferenceResults, userMessage } from './attachments';
import { closeRequest, recordMetric, startRequest, turnClock } from './metrics';
import { overLimit, overLimitText } from '../budget';
import { readGuide, STAGED_GUIDE, guideWorkspaceProblem, skillById } from '../skills';
import { guideForModel, modelGuide } from '../guides';
import { buildSettings, describeChoice, sectionsOf } from './settingsCard';
import { lineKey, variantRoute } from '../variants';
import { readGraph } from '../flow/graphView';
import { canvasParts } from './canvasView';
import { nodeSelection } from '../flow/selection';
import { TOOLS, continueInDesignerSchema, findAssetsSchema, findModelsSchema, readGraphSchema, viewCanvasSchema, readGuideSchema, recoverPlanSchema, askQuestionsSchema, confirmSettingsSchema, formatZodError, parseToolArgs, proposePlanSchema, toRawPlan } from './tools';

const get = useStore.getState;
let controller: AbortController | null = null;

// ---------------------------------------------------------------------------
// Helpers

function session(id: string): Session {
  return get().sessions[id];
}

function patchAgent(sessionId: string, patch: Partial<AgentState> | ((a: AgentState) => Partial<AgentState>)): void {
  patchSession(sessionId, (s) => ({ ...s, agent: { ...s.agent, ...(typeof patch === 'function' ? patch(s.agent) : patch) } }));
}

function feedBase(workspace: Workspace) {
  return { id: uid('fd'), createdAt: Date.now(), workspace };
}

function notice(sessionId: string, workspace: Workspace, text: string, level: 'info' | 'error' = 'error', retry?: NoticeFeedItem['retry']): void {
  appendFeed(sessionId, { ...feedBase(workspace), type: 'notice', level, text, ...(retry ? { retry } : {}) });
  // Errors also show above the prompt box, where they are seen.
  if (level === 'error') pushAlert({ level: 'error', text });
  if (level === 'error' && get().ui.workspace !== 'chat') setThreadOpen(true);
}

function setThreadOpen(open: boolean): void {
  useStore.setState((st) => ({ ui: { ...st.ui, threadOpen: open } }));
}

export function agentEngine(): { kind: 'llm'; provider: 'openrouter' | 'nanogpt' | 'atlas'; model: string; key: string } | { kind: 'offline' } {
  const { agent, keys } = get().settings;
  if (agent.provider === 'offline') return { kind: 'offline' };
  const key = keys[agent.provider]?.trim();
  if (!key || !agent.model) return { kind: 'offline' };
  return { kind: 'llm', provider: agent.provider, model: agent.model, key };
}

export function engineLabel(): string {
  const e = agentEngine();
  return e.kind === 'offline' ? 'Local planner' : `${e.model.replace(/^[^/]+\//, '')} · ${LLM_LABELS[e.provider]}`;
}

/** Document size for a new design, from the composer's image aspect. */
export function designerDims(): { width: number; height: number } {
  const r = ratioOf(get().composer.image.settings.aspect) ?? 1;
  return r >= 1 ? { width: Math.round(1080 * r), height: 1080 } : { width: 1080, height: Math.round(1080 / r) };
}

/** What the app changed in the plan it showed (models, inputs, settings): the agent keeps it in mind for what follows. */
function adjustedNote(adjustments: string[] | undefined): string {
  return adjustments?.length ? `\nThe app adjusted your plan before showing it (keep this in mind for revisions and later plans): ${adjustments.join('; ')}.` : '';
}

/** The user's own words, marked off from everything the app adds (context, guides, notes), with the canvas they wrote on. */
function userBlock(text: string, canvas: Workspace): string {
  return `<user_message canvas="${canvas}">\n${text}\n</user_message>`;
}

/**
 * One agent conversation per session; the canvas only restricts what the agent may do there and which messages the
 * GUI shows. A session from before this keeps the conversation that was active; when that one is empty, the
 * conversation parked for this canvas comes back. Never while the agent is working.
 */
function toCanvas(sessionId: string, workspace: Workspace): void {
  const a = session(sessionId)?.agent;
  if (!a || a.busy || a.canvas === workspace) return;
  const there = a.parked?.[workspace];
  if (there && !a.history.length) {
    patchAgent(sessionId, { ...there, pending: there.pending, draft: there.draft, revising: there.revising, canvas: workspace, parked: { ...a.parked, [workspace]: undefined } });
    return;
  }
  patchAgent(sessionId, { canvas: workspace });
}

/** The conversation of the canvas a feed item belongs to. */
function toCanvasOfItem(sessionId: string, itemId: string): void {
  const item = session(sessionId)?.feed.find((f) => f.id === itemId);
  if (item) toCanvas(sessionId, item.workspace);
}

/** What the user wrote in this session (messages and answers): a model named there is the user's choice. */
function userWords(sessionId: string): string {
  const s = session(sessionId);
  const said = s.feed.flatMap((f) => (f.type === 'user' ? [f.text ?? ''] : f.type === 'questions' && f.answers ? Object.values(f.answers) : []));
  return [...said, s.agent.draft?.request ?? '', ...Object.values(s.agent.draft?.answers ?? {})].join('\n');
}

function planContext(sessionId: string, workspace: Workspace) {
  const doc = workspace === 'designer' ? activeDoc(sessionId) : null;
  return {
    workspace,
    getModel: resolveModel,
    defaultModel: (kind: MediaKind, needsImage: boolean) => defaultModelFor(kind, needsImage),
    defaultIsFallback: (kind: MediaKind, needsImage: boolean) => defaultModelChoice(kind, needsImage).source === 'fallback',
    defaultSettings: (kind: MediaKind) => get().composer[kind].settings,
    asset: (id: string) => get().assets[id],
    layer: (id: string) => doc?.layers.find((l) => l.id === id),
    suggestModel,
    composerChosen,
    routeModel: (mode: 'text' | 'image' | 'reference') => get().composer.videoRoutes?.[mode],
    subjectNames: () => get().library.map((x) => x.name),
    userText: () => userWords(sessionId),
    requestImages: () => (session(sessionId).agent.draft?.attachments ?? []).filter((id) => get().assets[id]?.kind === 'image'),
    // Phase 2: settings the user confirmed apply to every step of their kind (not on the node canvas).
    confirmed: (kind: MediaKind) => (workspace !== 'node' && (kind === 'video' || kind === 'image') ? session(sessionId).agent.settings?.[kind] : undefined),
  };
}

// ---------------------------------------------------------------------------
// Entry points

/** Send a message from the composer in agent mode. */
export async function sendAgentMessage(text: string, opts: { attachments?: string[] } = {}): Promise<void> {
  const st = get();
  const sessionId = st.activeSessionId;
  if (!session(sessionId) || session(sessionId).agent.busy) return;
  const workspace = st.ui.workspace;
  toCanvas(sessionId, workspace);
  const s = session(sessionId);
  // An edited message brings its own attachments and leaves the composer as it is.
  const attachments = [...(opts.attachments ?? st.composer.attachments)];
  const clean = text.trim();
  if (!clean && !attachments.length) return;

  autoTitleSession(sessionId, clean || 'Edit');
  appendFeed(sessionId, { ...feedBase(workspace), type: 'user', text: clean, mode: 'agent', attachments });
  if (!opts.attachments) setComposer({ text: '', attachments: [] });

  const pending = s.agent.pending;
  // A card waiting on another canvas is not what the user is answering here: it closes as superseded.
  const pendingItem = pending ? s.feed.find((f) => f.id === pending.feedItemId && f.workspace === workspace) : undefined;

  // Typing while questions are open answers them.
  if (pending?.kind === 'questions' && pendingItem?.type === 'questions' && pendingItem.status === 'pending') {
    await submitAnswers(sessionId, pendingItem.id, { note: clean }, 'typed');
    return;
  }
  // Typing while the settings card is open confirms what it shows, with the message as a note.
  if (pending?.kind === 'settings' && pendingItem?.type === 'settings' && pendingItem.status === 'pending') {
    await confirmSettings(sessionId, pendingItem.id, sectionsOf(pendingItem).map((x) => x.chosen ?? x.recommended), clean);
    return;
  }
  // Typing while a plan waits for approval: the agent revises it (only what was asked) or treats it as a new request.
  if (pending?.kind === 'plan' && pendingItem?.type === 'plan' && pendingItem.status === 'awaiting') {
    const engine = agentEngine();
    if (engine.kind === 'llm' && pending.toolCallId) {
      const ctx = buildContext(session(sessionId), contextOpts(sessionId, workspace, attachments));
      pushHistory(sessionId, {
        role: 'tool',
        tool_call_id: pending.toolCallId,
        content: `The user replied instead of approving:\n${userBlock(clean, workspace)}${adjustedNote(pendingItem.plan.adjustments)}\nIf the user asks something, answer it first in one or two sentences of text. If this adjusts the plan (a model, a step, duration, count, which steps to keep), also call propose_plan with revision true: keep every other step, prompt and setting exactly as they were and change only what was asked. If it is a different request, use revision false. Answering only with text leaves this plan waiting as it is (never say you left a new one).\n\n${ctx}`,
      });
      // Images attached to the comment: a user message right after the tool result (tool results carry no images).
      const parts = await visibleAttachments(sessionId, workspace, attachments);
      if (parts.length) pushHistory(sessionId, userMessage('Attached with this comment:', parts));
      // The card stays until the revision replaces it (or closes at the end of the turn); Run waits meanwhile.
      patchAgent(sessionId, { pending: undefined, notes: [], revising: pendingItem.id });
      await llmTurn(sessionId, workspace);
    } else {
      updateFeedItem<PlanFeedItem>(sessionId, pendingItem.id, { status: 'canceled' });
      removeDraftNodes(sessionId, pendingItem.plan.id);
      const draft = s.agent.draft;
      patchAgent(sessionId, { pending: undefined, draft: { request: `${draft?.request ?? ''} ${clean}`.trim(), answers: draft?.answers ?? {}, attachments: [...(draft?.attachments ?? []), ...attachments] } });
      await offlineTurn(sessionId, workspace);
    }
    return;
  }

  // A fresh request.
  if (pending) resolvePendingAsSuperseded(sessionId);
  // Confirmed settings belong to one request (its plan and its revisions): a new request shows the card again,
  // so old values (a sheet's 16:9 ×2) never silently apply to new work.
  patchAgent(sessionId, { questionRound: 0, draft: { request: clean, answers: {}, attachments }, settings: undefined });
  const engine = agentEngine();
  if (engine.kind === 'offline') {
    const { agent, keys } = get().settings;
    if (agent.provider !== 'offline') {
      const why = keys[agent.provider]?.trim() ? `No agent model is chosen for ${LLM_LABELS[agent.provider]}` : `There is no ${LLM_LABELS[agent.provider]} key`;
      notice(sessionId, workspace, `${why}, so the local planner answers. Fix it in Settings → Agent.`, 'info');
    }
    await offlineTurn(sessionId, workspace);
    return;
  }
  startRequest(sessionId, { request: clean, workspace, engine: engineLabel(), attachments: attachments.length });
  const ctx = buildContext(session(sessionId), contextOpts(sessionId, workspace, attachments));
  const parts = await visibleAttachments(sessionId, workspace, attachments);
  // The Designer page travels with a new request, so "draw on this" needs no extra round.
  if (workspace === 'designer' && agentSeesImages()) {
    const view = await canvasParts(sessionId).catch(() => 'The page could not be rendered.');
    if (typeof view !== 'string') parts.push(...view);
  }
  // A new request: images of earlier requests become a note instead of being sent again, and so do the results of
  // the reference tools (guides, model list, library): they can be asked for again, and they are what made the
  // history grow without bound (T6).
  patchAgent(sessionId, (a) => ({ history: trimReferenceResults(stripImages(a.history)) }));
  pushHistory(sessionId, userMessage(`${userBlock(clean || '(no text)', workspace)}\n\n<app_context>\n${ctx}${pickedWorkflowGuides(sessionId)}\n</app_context>`, parts));
  patchAgent(sessionId, { notes: [] });
  await llmTurn(sessionId, workspace);
}

/** Whether a text is already somewhere in the conversation sent to the model (guides go once). */
function inConversation(sessionId: string, t: string): boolean {
  return session(sessionId).agent.history.some((m) => {
    const c = m.content;
    return typeof c === 'string' ? c.includes(t) : Array.isArray(c) && c.some((p) => p.type === 'text' && p.text.includes(t));
  });
}

/** Model guides for the plan's image and video steps, as a block for a message; '' when none is new. */
function modelGuidesFor(sessionId: string, workflowGuideId: string): string {
  // Every workflow is a staged piece: its shared rules come in the same result, once per conversation. Model guides
  // do not: they come with the confirmed settings (phase 2), for the model the user actually chose.
  return workflowGuideId.startsWith('workflow:') && !inConversation(sessionId, STAGED_GUIDE) ? `\n\n---\n${STAGED_GUIDE}` : '';
}

/** Why a video model's guide cannot be loaded yet (phase 2 not confirmed, or another model was confirmed); undefined when it can. */
function earlyModelGuide(sessionId: string, id: string): string | undefined {
  const [type, gid] = id.trim().split(':');
  const guide = type === 'model' ? modelGuide(gid ?? '') : undefined;
  if (!guide || guide.optional || guide.id === 'video-edit') return undefined;
  const confirmed = session(sessionId).agent.settings?.video;
  const confirmedGuide = confirmed ? guideForModel(confirmed.modelRef.split('::')[1] ?? '')?.id : undefined;
  if (!confirmed) return `Not loaded: the video model is not confirmed yet. Call confirm_settings first; the prompting guide of the model the user confirms comes with the confirmation.`;
  if (confirmedGuide !== guide.id) return `Not loaded: the confirmed video model is ${modelSummary(confirmed.modelRef)?.name ?? confirmed.modelRef}${confirmedGuide ? ` (its guide is model:${confirmedGuide})` : ''}. To use another model, call confirm_settings again.`;
  return undefined;
}

/**
 * A workflow picked in the composer brings its shared rules and its image model's guide with the request. The video
 * model's guide comes later, with the confirmed settings (phase 2), so it is the model the user actually chose.
 */
function pickedWorkflowGuides(sessionId: string): string {
  const id = get().composer.workflowId;
  return id ? modelGuidesFor(sessionId, `workflow:${id}`) : '';
}

/** The attached images as the model sees them; with a model that has no vision, a notice and text only. */
async function visibleAttachments(sessionId: string, workspace: Workspace, attachments: string[]) {
  if (!attachments.some((id) => ['image', 'video'].includes(get().assets[id]?.kind ?? ''))) return [];
  if (!agentSeesImages()) {
    notice(sessionId, workspace, 'The selected agent model cannot see images: it only gets their size and type. Pick a model with vision in Settings.', 'info');
    return [];
  }
  return attachmentParts(attachments);
}

function contextOpts(sessionId: string, workspace: Workspace, attachments: string[]) {
  const s = session(sessionId);
  return { workspace, style: get().composer.agentStyle, round: s.agent.questionRound, maxRounds: get().settings.guidedRounds, attachments };
}

function resolvePendingAsSuperseded(sessionId: string): void {
  const s = session(sessionId);
  const p = s.agent.pending;
  if (!p) return;
  const item = s.feed.find((f) => f.id === p.feedItemId);
  if (item?.type === 'questions' && item.status === 'pending') updateFeedItem<QuestionsFeedItem>(sessionId, item.id, { status: 'skipped' });
  if (item?.type === 'settings' && item.status === 'pending') updateFeedItem<SettingsFeedItem>(sessionId, item.id, { status: 'skipped' });
  if (item?.type === 'plan' && item.status === 'awaiting') {
    updateFeedItem<PlanFeedItem>(sessionId, item.id, { status: 'canceled' });
    removeDraftNodes(sessionId, item.plan.id);
  }
  if (p.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: p.toolCallId, content: 'The user moved on to a new request without responding.' });
  patchAgent(sessionId, { pending: undefined });
}

function pushHistory(sessionId: string, msg: LlmMessage): void {
  patchAgent(sessionId, (a) => ({ history: [...a.history, msg] }));
}

/** Answers chosen in a questions card. */
export async function submitAnswers(sessionId: string, itemId: string, answers: Record<string, string>, how: 'chips' | 'typed' = 'chips'): Promise<void> {
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'questions' || item.status !== 'pending') return;
  updateFeedItem<QuestionsFeedItem>(sessionId, itemId, { status: 'answered', answers });
  const workspace = item.workspace;
  const pending = s.agent.pending;
  patchAgent(sessionId, { pending: undefined });
  const engine = agentEngine();
  if (engine.kind === 'llm' && pending?.toolCallId) {
    const lines = item.questions.map((q) => `- ${q.question}: ${answers[q.id] ?? '(no answer)'}`);
    if (answers.note) lines.push(`- User note: ${answers.note}`);
    const ctx = buildContext(session(sessionId), contextOpts(sessionId, workspace, s.agent.draft?.attachments ?? []));
    pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: `User answers (${how}):\n${lines.join('\n')}\n\n${ctx}` });
    patchAgent(sessionId, { notes: [] });
    await llmTurn(sessionId, workspace);
    return;
  }
  const draft = s.agent.draft ?? { request: '', answers: {}, attachments: [] };
  const merged = { ...draft.answers, ...answers };
  // A typed note on an offline card enriches the request itself.
  const request = answers.note ? `${draft.request} ${answers.note}`.trim() : draft.request;
  patchAgent(sessionId, { draft: { ...draft, request, answers: merged } });
  await offlineTurn(sessionId, workspace);
}

/** "Skip, plan now" on a questions card: no more questions, plan with sensible defaults. */
export async function skipQuestions(sessionId: string, itemId: string): Promise<void> {
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'questions' || item.status !== 'pending') return;
  updateFeedItem<QuestionsFeedItem>(sessionId, itemId, { status: 'skipped' });
  const pending = s.agent.pending;
  patchAgent(sessionId, { pending: undefined, questionRound: get().settings.guidedRounds });
  const engine = agentEngine();
  if (engine.kind === 'llm' && pending?.toolCallId) {
    const ctx = buildContext(session(sessionId), contextOpts(sessionId, item.workspace, s.agent.draft?.attachments ?? []));
    pushHistory(sessionId, {
      role: 'tool',
      tool_call_id: pending.toolCallId,
      content: `The user skipped the questions. Use sensible defaults and call propose_plan now.\n\n${ctx}`,
    });
    patchAgent(sessionId, { notes: [] });
    await llmTurn(sessionId, item.workspace);
    return;
  }
  await offlineTurn(sessionId, item.workspace);
}

/** The selection on an open settings card, kept so a typed message confirms what the user sees. */
export function selectSettings(sessionId: string, itemId: string, index: number, chosen: SettingsChoice): void {
  const item = session(sessionId)?.feed.find((f) => f.id === itemId);
  if (item?.type === 'settings' && item.status === 'pending') updateFeedItem<SettingsFeedItem>(sessionId, itemId, { sections: sectionsOf(item).map((x, i) => (i === index ? { ...x, chosen } : x)) });
}

/** "Continue" on the settings card (phase 2): the agent gets the confirmed values and each model's prompting guide. */
export async function confirmSettings(sessionId: string, itemId: string, chosen: SettingsChoice[], note?: string): Promise<void> {
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'settings' || item.status !== 'pending') return;
  const sections = sectionsOf(item).map((x, i) => ({ ...x, chosen: chosen[i] ?? x.chosen ?? x.recommended }));
  updateFeedItem<SettingsFeedItem>(sessionId, itemId, { status: 'confirmed', sections });
  const pending = s.agent.pending;
  patchAgent(sessionId, (a) => ({ pending: undefined, settings: { ...a.settings, ...Object.fromEntries(sections.map((x) => [x.kind, x.chosen])) } }));
  if (agentEngine().kind !== 'llm' || !pending?.toolCallId) return;
  const name = (ref: string) => modelSummary(ref)?.name ?? ref;
  const lines: string[] = [];
  let guides = '';
  for (const x of sections) {
    const c = x.chosen;
    const rec = x.recommended;
    const changes = [
      c.modelRef !== rec.modelRef ? `model ${name(rec.modelRef)} → ${name(c.modelRef)}` : '',
      c.resolution !== rec.resolution ? `resolution ${rec.resolution ?? 'default'} → ${c.resolution ?? 'default'}` : '',
      c.duration !== rec.duration ? `duration ${rec.duration ?? '?'} s → ${c.duration ?? '?'} s` : '',
      c.aspect !== rec.aspect ? `aspect ${rec.aspect ?? "the image's"} → ${c.aspect ?? "the image's"}` : '',
      c.count !== rec.count ? `images per step ${rec.count ?? 1} → ${c.count ?? 1}` : '',
    ].filter(Boolean);
    lines.push(`- ${x.kind}: ${describeChoice(name(c.modelRef), c)} (${c.modelRef}).${changes.length ? ` The user changed: ${changes.join('; ')}.` : ' As recommended.'} Write these prompts for ${name(c.modelRef)}, in its format${x.kind === 'video' && c.duration ? `; each clip lasts exactly ${c.duration} s: time its beats, shots and spoken lines to fill those seconds` : ''}${c.aspect ? `; frame for ${c.aspect}` : ''}${x.kind === 'image' && c.count ? (c.count > 1 ? `; ${c.count} candidates of the image being explored: ONE image step with ${c.count} "variations" (the shared prompt once, one short variation each), not one step per option` : '; one image per image step') : ''}.`);
    const guide = guideForModel(c.modelRef.split('::')[1] ?? '');
    const text = guide ? readGuide(`model:${guide.id}`) : undefined;
    if (text && !inConversation(sessionId, text) && !guides.includes(text)) guides += `\n\n---\nPrompting guide of ${name(c.modelRef)} (model:${guide!.id}); write its prompts in this format:\n${text}`;
  }
  const ctx = buildContext(session(sessionId), contextOpts(sessionId, item.workspace, s.agent.draft?.attachments ?? []));
  pushHistory(sessionId, {
    role: 'tool',
    tool_call_id: pending.toolCallId,
    content: `Settings confirmed by the user (the app applies them to every step of each kind):\n${lines.join('\n')}${note ? `\nUser note: ${note}` : ''}\nNow write the prompts and call propose_plan.${guides}\n\n${ctx}`,
  });
  patchAgent(sessionId, { notes: [] });
  await llmTurn(sessionId, item.workspace);
}

/**
 * Retry after a transient failure (the connection dropped, the provider was busy). A streamed answer cannot be
 * resumed mid-way, so the failed call runs again with the same history: steps that had finished (a guide read,
 * a model search) are kept and not repeated. The half-written answer and the error notice are removed.
 */
export async function retryAgentTurn(sessionId: string, noticeId: string): Promise<void> {
  toCanvasOfItem(sessionId, noticeId);
  const s = session(sessionId);
  const item = s?.feed.find((f) => f.id === noticeId);
  if (!s || s.agent.busy || item?.type !== 'notice' || !item.retry || agentEngine().kind !== 'llm') return;
  if (item.retry.partialItemId) removeFeedItem(sessionId, item.retry.partialItemId);
  removeFeedItem(sessionId, noticeId);
  await llmTurn(sessionId, item.workspace);
}

export function stopAgent(): void {
  controller?.abort();
}

// ---------------------------------------------------------------------------
// Offline planner

async function offlineTurn(sessionId: string, workspace: Workspace): Promise<void> {
  const s = session(sessionId);
  const draft = s.agent.draft ?? { request: '', answers: {}, attachments: [] };
  const st = get();
  const docDims = workspace === 'designer' ? activeDoc(sessionId) ?? designerDims() : undefined;
  const action = offlinePlan({
    request: draft.request,
    answers: draft.answers,
    round: s.agent.questionRound,
    maxRounds: st.settings.guidedRounds,
    style: st.composer.agentStyle,
    workspace,
    attachments: draft.attachments.map((id) => ({ id, kind: st.assets[id]?.kind ?? 'image' })).filter((a) => st.assets[a.id]),
    skillHint: activeSkill(st.composer.skillId, st.composer.workflowId)?.promptHint,
    workflow: workflowById(st.composer.workflowId),
    doc: docDims ? { width: docDims.width, height: docDims.height } : undefined,
  });
  if (action.kind === 'reply') {
    appendFeed(sessionId, { ...feedBase(workspace), type: 'assistant', text: action.text, engine: 'Local planner' });
    return;
  }
  if (action.kind === 'questions') {
    showQuestions(sessionId, workspace, action.intro, action.questions, null);
    return;
  }
  const result = await presentPlan(sessionId, workspace, action.plan, null);
  if (result.errors.length) notice(sessionId, workspace, `The plan could not be built: ${result.errors.join(' ')}`);
}

function showQuestions(sessionId: string, workspace: Workspace, intro: string | undefined, questions: AgentQuestion[], toolCallId: string | null): void {
  const s = session(sessionId);
  const round = s.agent.questionRound + 1;
  const item: QuestionsFeedItem = {
    ...feedBase(workspace),
    type: 'questions',
    intro,
    questions,
    round,
    maxRounds: get().composer.agentStyle === 'auto' ? 1 : get().settings.guidedRounds,
    status: 'pending',
    ...(toolCallId ? { toolCallId } : {}),
  };
  appendFeed(sessionId, item);
  patchAgent(sessionId, { questionRound: round, pending: { toolCallId, kind: 'questions', feedItemId: item.id } });
  if (get().ui.workspace !== 'chat') setThreadOpen(true);
}

/** Validate a raw plan and show it. Auto mode runs free plans immediately. */
async function presentPlan(
  sessionId: string,
  workspace: Workspace,
  raw: RawPlan,
  toolCallId: string | null,
  revision = false,
  /** Agent time so far, for the request's metrics (LLM turns only). */
  agentMs?: number,
): Promise<{ errors: string[]; itemId?: string }> {
  const started = Date.now();
  const planId = uid('pln');
  const { plan, errors } = await normalizePlan(raw, planContext(sessionId, workspace), planId);
  if (!plan) return { errors };
  const { total } = estimateSteps(plan.steps);
  const style = get().composer.agentStyle;
  const item: PlanFeedItem = {
    ...feedBase(workspace),
    type: 'plan',
    plan,
    style,
    status: 'awaiting',
    stepStates: Object.fromEntries(plan.steps.map((st) => [st.id, 'pending' as StepState])),
    stepGenerations: {},
    estimate: total,
  };
  const replaced = closeRevisedPlan(sessionId, revision);
  if (replaced) item.revised = true;
  appendFeed(sessionId, item);
  // Changes to a model the user picked also pop up for 5 s: the card alone is easy to miss.
  for (const a of plan.adjustments.filter((x) => /\byour [\w-]+ model\b/.test(x))) toast(a.replace(/^[\w-]+: /, ''), 'error', 5000);
  patchAgent(sessionId, { pending: { toolCallId, kind: 'plan', feedItemId: item.id } });
  if (workspace === 'node') {
    materializeNodes(sessionId, plan);
    const targets = plan.steps.filter(s => s.kind !== 'text').map(s => `${plan.id}_${s.id}`);
    const preview = await prepareNodeRun(sessionId, targets);
    updateFeedItem<PlanFeedItem>(sessionId, item.id, { nodeRun: { targets, force: true, signature: preview.signature }, plan: { ...plan, steps: preview.steps }, estimate: preview.estimate, error: preview.errors.join(' ') || undefined });
  }
  // Recorded before an auto-approval closes the request.
  if (agentMs != null) {
    const models = [...new Set(plan.steps.flatMap((st) => ('modelRef' in st && st.modelRef ? [st.modelRef] : [])))];
    recordMetric(sessionId, { type: 'plan', ms: agentMs, revision: replaced, models, usd: total.usd, checkMs: Date.now() - started });
  }
  if (style === 'auto' && !needsSpendCheck(total)) {
    void approvePlan(sessionId, item.id);
  } else if (get().ui.workspace !== 'chat') {
    setThreadOpen(true);
  }
  return { errors: [], itemId: item.id };
}

/**
 * The plan the user commented on: a revision replaces it (removed from the feed, the new card says "Revised");
 * any other outcome closes it as canceled, so two plans never mix. Returns whether it was replaced.
 */
function keepCommentedPlan(sessionId: string): void {
  const id = session(sessionId).agent.revising;
  if (!id) return;
  const plan = session(sessionId).feed.find((f) => f.id === id);
  patchAgent(sessionId, (a) => ({ revising: undefined, ...(plan?.type === 'plan' && plan.status === 'awaiting' && !a.pending ? { pending: { toolCallId: null, kind: 'plan', feedItemId: id } } : {}) }));
}

function closeRevisedPlan(sessionId: string, replace: boolean): boolean {
  const id = session(sessionId).agent.revising;
  if (!id) return false;
  patchAgent(sessionId, { revising: undefined });
  const old = session(sessionId).feed.find((f) => f.id === id);
  if (old?.type !== 'plan' || old.status !== 'awaiting') return false;
  removeDraftNodes(sessionId, old.plan.id);
  if (replace) patchSession(sessionId, (s) => ({ ...s, feed: s.feed.filter((f) => f.id !== id) }));
  else updateFeedItem<PlanFeedItem>(sessionId, id, { status: 'canceled' });
  return replace;
}

function materializeNodes(sessionId: string, plan: Plan): void {
  const graph = session(sessionId).graph;
  const st = get();
  const { nodes, edges } = planToGraph(plan, (id) => st.assets[id]?.kind, (id) => graph.nodes.find(n => nodeOutputAsset(n, st.generations) === id)?.id);
  const bounds = graphBounds(graph.nodes);
  const origin = bounds ? { x: bounds.x + bounds.w + 160, y: bounds.y } : { x: 0, y: 0 };
  const positions = autoLayout(nodes, edges, origin);
  setGraph(sessionId, (g) => ({
    ...g,
    nodes: [...g.nodes, ...nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position }))],
    edges: [...g.edges, ...edges],
  }));
  // Bring the new nodes into view, with what they connect to.
  focusNodes(sessionId, [...new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.source)])]);
}

// ---------------------------------------------------------------------------
// The user's own messages: edit (the answer is made again) and delete (it leaves the agent's context)

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
  if (get().ui.workspace !== item.workspace) setUi({ workspace: item.workspace });
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

function removeDraftNodes(sessionId: string, planId: string): void {
  setGraph(sessionId, (g) => {
    const drop = new Set(
      g.nodes
        .filter((n) => n.planId === planId && !(runsGeneration(n.data) && n.data.generationId))
        .map((n) => n.id),
    );
    if (!drop.size) return g;
    return { ...g, nodes: g.nodes.filter((n) => !drop.has(n.id)), edges: g.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)) };
  });
}

// ---------------------------------------------------------------------------
// Plan approval & execution


export async function approvePlan(sessionId: string, itemId: string): Promise<void> {
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan' || item.status !== 'awaiting') return;
  if (item.nodeRun) { await approveNodeRun(sessionId, item); return; }
  const { plan } = item;
  const off = new Set(item.skipped ?? []);
  // A join over clips the user unchecked joins only the clips that run (or is dropped when fewer than two remain).
  const pruned = pruneJoins(plan.steps.filter((st) => !off.has(st.id)), off);
  for (const id of pruned.dropped) off.add(id);
  const chosen = pruned.steps;
  if (!chosen.length) return;
  // Re-estimate: models or prices may have loaded since the plan was shown.
  const { total } = estimateSteps(chosen);
  // Over an active limit, the card asks first ("Continue anyway"); approving without that stops here.
  if (overLimit(total)) {
    toast(overLimitText(total), 'error');
    return;
  }
  const pending = s.agent.pending;
  if (pending?.feedItemId === itemId) {
    const note = off.size ? ` The user unchecked ${[...off].join(', ')}: they will not run. Running ${chosen.map((st) => st.id).join(', ')}.` : '';
    if (pending.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: `Approved by the user.${note}${adjustedNote(plan.adjustments)} The app is executing the plan now.` });
    closeRequest(sessionId, 'approved', total.usd);
    patchAgent(sessionId, { pending: undefined, questionRound: 0, draft: undefined });
  }
  updateFeedItem<PlanFeedItem>(sessionId, itemId, (it) => ({
    ...it,
    status: 'running',
    estimate: total,
    stepStates: { ...it.stepStates, ...Object.fromEntries([...off].map((sid) => [sid, 'skipped' as StepState])) },
  }));

  await runPlanItem(sessionId, itemId, chosen, off);
}

export async function presentNodeRun(sessionId: string, targets: string[], toolCallId: string | null = null): Promise<{ errors: string[]; itemId?: string }> {
  if (!targets.length) return { errors: ['Select at least one existing node.'] };
  const graph = session(sessionId).graph;
  const missing = targets.find(id => !graph.nodes.some(n => n.id === id && runsGeneration(n.data)));
  if (missing) return { errors: [`No runnable node: ${missing}.`] };
  const preview = await prepareNodeRun(sessionId, targets);
  if (preview.errors.length) return { errors: preview.errors };
  const item: PlanFeedItem = {
    ...feedBase('node'), type: 'plan', style: get().composer.agentStyle, status: 'awaiting',
    nodeRun: { targets, force: true, signature: preview.signature },
    plan: { id: uid('pln'), title: 'Run existing nodes', summary: 'Existing node IDs and required upstream updates. No new flow is created.', workspace: 'node', steps: preview.steps, adjustments: [] },
    estimate: preview.estimate, stepStates: {}, stepGenerations: {},
  };
  closeRevisedPlan(sessionId, false);
  appendFeed(sessionId, item);
  patchAgent(sessionId, { pending: { toolCallId, kind: 'plan', feedItemId: item.id } });
  setThreadOpen(true);
  return { errors: [], itemId: item.id };
}

export function undoNodeDeletion(sessionId: string, itemId: string): string | null {
  const error = restoreNodeDeletion(sessionId, itemId);
  if (error) toast(error, 'error');
  return error;
}

async function approveNodeRun(sessionId: string, item: PlanFeedItem): Promise<void> {
  const request = item.nodeRun!;
  const preview = await prepareNodeRun(sessionId, request.targets, request.force);
  if (preview.signature !== request.signature || preview.errors.length) {
    updateFeedItem<PlanFeedItem>(sessionId, item.id, {
      nodeRun: { ...request, signature: preview.signature }, plan: { ...item.plan, steps: preview.steps }, estimate: preview.estimate,
      error: preview.errors.join(' ') || 'The execution changed. Review this version and approve again.',
    });
    return;
  }
  if (overLimit(preview.estimate)) { toast(overLimitText(preview.estimate), 'error'); return; }
  updateFeedItem<PlanFeedItem>(sessionId, item.id, { status: 'running', error: undefined, stepStates: {} });
  const result = await runNodes(sessionId, request.targets, preview, request.force, (id, state, info) => {
    updateFeedItem<PlanFeedItem>(sessionId, item.id, it => ({ ...it, stepStates: { ...it.stepStates, [id]: state }, stepGenerations: info?.generationId ? { ...it.stepGenerations, [id]: info.generationId } : it.stepGenerations }));
  });
  if (!result) {
    const next = previewRun(sessionId, request.targets, request.force);
    updateFeedItem<PlanFeedItem>(sessionId, item.id, { status: 'awaiting', nodeRun: { ...request, signature: next.signature }, plan: { ...item.plan, steps: next.steps }, estimate: next.estimate, error: next.errors.join(' ') || 'The execution changed. Review and approve again.' });
    return;
  }
  const status = result.failed.length || result.skipped.length ? result.outputs.size ? 'partial' : 'error' : 'done';
  updateFeedItem<PlanFeedItem>(sessionId, item.id, { status, error: result.failed.map(f => `${f.stepId}: ${f.error}`).join(' · ') || undefined });
  const pending = session(sessionId).agent.pending;
  if (pending?.feedItemId === item.id) {
    if (pending.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: `User approved existing node execution. ${status}: ${[...result.outputs].map(([id, out]) => `${id}: ${out.assetIds.join(',')}`).join('; ')}` });
    closeRequest(sessionId, 'approved', preview.estimate.usd);
    patchAgent(sessionId, { pending: undefined, questionRound: 0, draft: undefined });
  }
  await wrapUpPlan(sessionId, item.id, item.plan.title, status, `${status}: ${preview.runIds.join(', ')}`);
}

/**
 * Execute a plan card's steps and report back to the card and the agent. Resuming (Check status / Retry failed):
 * `resume.prior` holds the steps already done, `resume.blocked` the ones that failed again.
 */
async function runPlanItem(
  sessionId: string,
  itemId: string,
  chosen: PlanStep[],
  off: Set<string>,
  resume?: { prior: Map<string, StepOutput>; blocked: Map<string, string> },
): Promise<void> {
  const item = session(sessionId).feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan') return;
  const { plan } = item;
  const workspace = plan.workspace;
  let steps = chosen;
  const nodeOf = (stepId: string) => `${plan.id}_${stepId}`;
  if (workspace === 'node') {
    // Run what is on the canvas now (the user may have edited the drafted nodes).
    const graph = session(sessionId).graph;
    const ids = graph.nodes.filter((n) => n.planId === plan.id && !off.has(n.id.replace(`${plan.id}_`, ''))).map((n) => n.id);
    const run = graphToSteps(graph, ids, get().generations, { assets: get().assets });
    if (run.errors.length) {
      updateFeedItem<PlanFeedItem>(sessionId, itemId, { status: 'error', error: run.errors.join(' ') });
      return;
    }
    steps = run.steps;
  }
  let docId: string | undefined;
  if (workspace === 'designer') docId = ensureDoc(sessionId, designerDims()).id;

  const result = await executeSteps(steps, {
    ...(resume ? { prior: resume.prior, blocked: resume.blocked } : {}),
    sessionId,
    planId: plan.id,
    workspace,
    origin: 'agent',
    docId,
    // Node runs use node ids as step ids.
    subjects: workspace === 'node' ? plan.subjects?.map((x) => (parseRef(x.from)?.type === 'step' ? { ...x, from: nodeOf(x.from) } : x)) : plan.subjects,
    onState: (stepId, state, info) => {
      // Node runs use node ids as step ids; map back to plan step ids for the card.
      const planStepId = workspace === 'node' ? stepId.replace(`${plan.id}_`, '') : stepId;
      updateFeedItem<PlanFeedItem>(sessionId, itemId, (it) => ({
        ...it,
        stepStates: { ...it.stepStates, [planStepId]: state },
        stepGenerations: info?.generationId ? { ...it.stepGenerations, [planStepId]: info.generationId } : it.stepGenerations,
      }));
      if (info?.generationId) {
        // The Designer shows each generation's card in its conversation too (it also lands on the page, below).
        if (workspace === 'chat' || workspace === 'designer') {
          appendFeed(sessionId, { ...feedBase(workspace), type: 'generation', generationId: info.generationId });
        } else if (workspace === 'node') {
          const nodeId = stepId.startsWith(`${plan.id}_`) ? stepId : nodeOf(stepId);
          setGraph(sessionId, (g) => ({
            ...g,
            nodes: g.nodes.map((n) =>
              n.id === nodeId && runsGeneration(n.data) ? { ...n, data: { ...n.data, generationId: info.generationId } } : n,
            ),
          }));
        }
      }
    },
  });

  // Designer: a final image the plan did not put on a layer goes on the page as a new layer (kept in Generations too).
  if (workspace === 'designer' && docId) {
    const used = new Set(steps.flatMap((st) => stepDeps(st)).map((r) => parseRef(r)).flatMap((p) => (p?.type === 'step' ? [p.id] : [])));
    for (const st of steps) {
      if (stepOutputKind(st) !== 'image' || used.has(st.id)) continue;
      for (const a of result.outputs.get(st.id)?.assetIds ?? []) {
        const doc = getDoc(sessionId, docId);
        if (!doc || doc.layers.some((l) => 'sourceAssetId' in l && l.sourceAssetId === a)) continue;
        // A result that never lands on the canvas is otherwise invisible (T5).
        await placeAsset(sessionId, docId, a, doc.layers.length ? 'new' : 'base', 'title' in st && st.title ? st.title : 'Image').catch((e: Error) => {
          logEvent('app', { session: sessionId, event: 'designer-place-failed', doc: docId, asset: a, message: e.message });
          return null;
        });
      }
    }
  }

  const failed = result.failed.length;
  const status: PlanFeedItem['status'] = failed === 0 && !result.skipped.length ? 'done' : result.outputs.size ? 'partial' : 'error';
  updateFeedItem<PlanFeedItem>(sessionId, itemId, { status, error: failed ? result.failed.map((f) => `${f.stepId}: ${f.error}`).join(' · ') : undefined });
  const summary = plan.steps
    .map((st) => {
      const key = workspace === 'node' ? nodeOf(st.id) : st.id;
      const out = result.outputs.get(key);
      const fail = result.failed.find((f) => f.stepId === key);
      if (fail) return `${st.id} failed (${fail.error})`;
      if (off.has(st.id)) return `${st.id} not run (unchecked by the user)`;
      if (!out) return `${st.id} skipped`;
      // O3: what came back different from what was asked, for the closing message.
      const genId = session(sessionId).feed.find((f): f is PlanFeedItem => f.id === itemId && f.type === 'plan')?.stepGenerations?.[st.id];
      const delivery = genId ? get().generations[genId]?.delivery : undefined;
      // The model that really ran, so the closing message never names one that was only asked for.
      const ran = genId ? get().generations[genId]?.modelRef : undefined;
      // …and what came out (read from the files: size, length), a few words in the message that already goes.
      const first = out.assetIds[0] ? get().assets[out.assetIds[0]] : undefined;
      // The confirmed model's own variant for these inputs (edit, image-to-video) is the same choice, said so.
      const conf = Object.values(session(sessionId).agent.settings ?? {}).find((c) => c && c.modelRef !== ran && modelSummary(c.modelRef) && modelSummary(ran ?? '') && lineKey(modelSummary(c.modelRef)!) === lineKey(modelSummary(ran!)!));
      const facts = [ran ? `made with ${modelSummary(ran)?.name ?? ran}${conf ? ` (the ${variantRoute(modelSummary(ran!)!)} variant of the confirmed ${modelSummary(conf.modelRef)!.name}: the same model, not a change)` : ''}` : '', first?.width && first.height ? `${shapeLabel(first.width, first.height)}, ${first.width}×${first.height}` : '', first?.duration ? `${Math.round(first.duration)}s` : ''].filter(Boolean);
      const by = facts.length ? ` (${facts.join(', ')})` : '';
      if (out.assetIds.length) return `${st.id}${by} → ${out.assetIds.length > 1 ? out.assetIds.map((a, i) => `#${i + 1} asset:${a}`).join(', ') : `asset:${out.assetIds[0]}`}${delivery?.length ? ` (delivered differs: ${delivery.join('; ')})` : ''}`;
      if (out.layerId) return `${st.id} → layer ${out.layerId}`;
      return `${st.id} done`;
    })
    .join('; ');
  patchAgent(sessionId, (a) => ({ notes: [...a.notes, `Plan "${plan.title}" (${plan.workspace} canvas) ${status}: ${summary}`].slice(-6) }));
  if (status === 'done') toast(`${plan.title} · done`, 'success');
  else if (status === 'partial') toast(`${plan.title} finished with ${failed} failed step${failed === 1 ? '' : 's'}`, 'error');
  else toast(`${plan.title} failed`, 'error');
  await wrapUpPlan(sessionId, itemId, plan.title, status, summary);
}

/**
 * S4 · After a plan runs, one short text-only call so the agent says it is ready and offers next steps.
 * ⚠️ Traceable (AGENTS.md, "social ad" plan): if the chat stops answering right after a plan, an unrequested
 * message appears, or agent spending rises, check this first. Skipped without an LLM, while the agent is busy,
 * with a pending card, or when the user already wrote something after this plan.
 */
async function wrapUpPlan(sessionId: string, itemId: string, title: string, status: PlanFeedItem['status'], summary: string): Promise<void> {
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  if (!s || agentEngine().kind !== 'llm' || s.agent.busy || s.agent.pending) return;
  const at = s.feed.findIndex((f) => f.id === itemId);
  if (at < 0 || s.feed.slice(at + 1).some((f) => f.type === 'user')) return;
  const item = s.feed[at];
  pushHistory(sessionId, userMessage(`[app] Plan "${title}" finished (${status}): ${summary}
${WRAPUP_RULE}`, []));
  await llmTurn(sessionId, item.workspace, { textOnly: true });
}

// ---------------------------------------------------------------------------
// Recovering a plan with failed steps (Check status / Retry failed)

export type PlanRecoveryMode = 'check' | 'retry';

/** The steps a plan card would run again, as approved (unchecked steps and the joins they dropped stay out). */
function approvedSteps(item: PlanFeedItem): { chosen: PlanStep[]; off: Set<string> } {
  const off = new Set(item.skipped ?? []);
  const pruned = pruneJoins(item.plan.steps.filter((st) => !off.has(st.id)), off);
  for (const id of pruned.dropped) off.add(id);
  return { chosen: pruned.steps, off };
}

/**
 * What a failed plan can do now: failed steps whose submitted job can still be fetched (Check status), and the
 * price of running the failed steps and the ones that waited for them again (Retry failed). Null when nothing applies.
 */
export function planRecovery(item: PlanFeedItem): { checkable: string[]; retry: PlanStep[]; estimate: Estimate } | null {
  if ((item.status !== 'error' && item.status !== 'partial') || item.plan.workspace === 'node') return null;
  const gens = get().generations;
  const { chosen } = approvedSteps(item);
  const retry = chosen.filter((st) => item.stepStates[st.id] === 'error' || item.stepStates[st.id] === 'skipped' || item.stepStates[st.id] === 'pending');
  if (!retry.length) return null;
  const checkable = retry.filter((st) => {
    const g = gens[item.stepGenerations[st.id] ?? ''];
    return item.stepStates[st.id] === 'error' && g && canRecheck(g);
  }).map((st) => st.id);
  return { checkable, retry, estimate: estimateSteps(retry).total };
}

/** Why a recovery cannot start, in words for the user or the agent; null when it can. */
export function planRecoveryProblem(item: PlanFeedItem, mode: PlanRecoveryMode): string | null {
  const r = planRecovery(item);
  if (!r) return item.plan.workspace === 'node' ? 'Plans on the Node canvas are rerun from their nodes.' : 'This plan has no failed steps.';
  if (mode === 'check' && !r.checkable.length) {
    return 'No failed step has a submitted job to check: the provider gave no job id (NanoGPT returns images in the same request, so a dropped connection leaves nothing to ask for). Retry runs them again.';
  }
  if (overLimit(r.estimate)) return overLimitText(r.estimate);
  return null;
}

/**
 * Resume a plan with failed steps, in the same card. "check" asks the providers again about the jobs they received
 * (no new charge for those); "retry" runs the failed steps again (charged again). Failed generations run again in
 * their own chat cards; steps done before are reused; the steps that waited for the failed ones run afterwards.
 * Returns a short summary for the agent.
 */
export async function resumePlan(sessionId: string, itemId: string, mode: PlanRecoveryMode): Promise<string> {
  toCanvasOfItem(sessionId, itemId);
  const item = session(sessionId)?.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan') return 'No such plan.';
  const problem = planRecoveryProblem(item, mode);
  if (problem) return problem;
  const { chosen, off } = approvedSteps(item);
  const failedIds = chosen.filter((st) => item.stepStates[st.id] === 'error').map((st) => st.id);
  const genOf = (id: string) => get().generations[item.stepGenerations[id] ?? ''];
  updateFeedItem<PlanFeedItem>(sessionId, itemId, (it) => ({
    ...it,
    status: 'running',
    error: undefined,
    stepStates: { ...it.stepStates, ...Object.fromEntries(failedIds.filter((id) => mode === 'retry' || (genOf(id) && canRecheck(genOf(id)))).map((id) => [id, 'running' as StepState])) },
  }));
  // The failed generations first, in their own cards: fetched again (check) or run again (retry).
  const blocked = new Map<string, string>();
  const recovered = new Set<string>();
  await Promise.all(
    failedIds.map(async (id) => {
      const g = genOf(id);
      if (!g) {
        // Failed before it could start a generation: a retry runs the step again; a check has nothing to ask.
        if (mode === 'check') blocked.set(id, item.error?.split(' · ').find((e) => e.startsWith(`${id}:`))?.slice(id.length + 2) ?? 'Failed');
        return;
      }
      if (mode === 'check' && !canRecheck(g)) {
        blocked.set(id, g.error ?? 'Failed');
        return;
      }
      // A step that fails again rejects here; its card already shows the error, the plan must still settle.
      await (mode === 'check' ? recheckGeneration(g.id) : retryGeneration(g.id)).catch(() => undefined);
      const after = get().generations[g.id];
      if (after?.status === 'done') recovered.add(id);
      else blocked.set(id, after?.error ?? 'Failed');
    }),
  );
  const prior = new Map<string, StepOutput>();
  for (const st of chosen) {
    if (item.stepStates[st.id] !== 'done' && !recovered.has(st.id)) continue;
    const g = genOf(st.id);
    prior.set(st.id, g ? { assetIds: g.assetIds, text: g.text } : st.kind === 'text' ? { assetIds: [], text: st.text } : { assetIds: [], layerId: null });
  }
  updateFeedItem<PlanFeedItem>(sessionId, itemId, (it) => ({
    ...it,
    stepStates: { ...it.stepStates, ...Object.fromEntries([...recovered].map((id) => [id, 'done' as StepState])), ...Object.fromEntries([...blocked.keys()].map((id) => [id, 'error' as StepState])) },
  }));
  await runPlanItem(sessionId, itemId, chosen, off, { prior, blocked });
  const done = session(sessionId).feed.find((f) => f.id === itemId);
  const status = done?.type === 'plan' ? done.status : 'error';
  return `${mode === 'check' ? 'Checked' : 'Retried'} "${item.plan.title}": ${status === 'done' ? 'all steps done' : status === 'partial' ? `finished with errors (${done?.type === 'plan' ? done.error : ''})` : `still failing (${done?.type === 'plan' ? done.error : ''})`}.`;
}

export function cancelPlan(sessionId: string, itemId: string): void {
  toCanvasOfItem(sessionId, itemId);
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan' || item.status !== 'awaiting') return;
  updateFeedItem<PlanFeedItem>(sessionId, itemId, { status: 'canceled' });
  removeDraftNodes(sessionId, item.plan.id);
  const pending = s.agent.pending;
  if (pending?.feedItemId === itemId) {
    if (pending.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: 'The user canceled this plan.' });
    closeRequest(sessionId, 'canceled');
    patchAgent(sessionId, { pending: undefined, questionRound: 0 });
  }
}

// ---------------------------------------------------------------------------
// LLM loop

/** Plain name of a guide for the activity block ("Seedance prompting guide", "Story / series workflow"). */
function guideLabel(id: string): string {
  const [type, rest = ''] = id.split(':');
  if (type === 'model') return rest === 'video-edit' ? 'Video edit and extend guide' : `${modelGuide(rest)?.name ?? rest} prompting guide`;
  if (type === 'workflow') return `${workflowById(rest.split('/')[0])?.name ?? rest} workflow`;
  if (type === 'skill') return `${skillById(rest)?.name ?? rest} skill`;
  return id;
}

/**
 * The turn's activity block (L3): created when the turn starts, it collects the streamed reasoning (store updates
 * throttled) and each action, and records when the turn ended.
 */
function activityLog(sessionId: string, workspace: Workspace) {
  const item: ActivityFeedItem = { ...feedBase(workspace), type: 'activity', startedAt: Date.now(), entries: [] };
  appendFeed(sessionId, item);
  const patch = (fn: (entries: ActivityEntry[]) => ActivityEntry[]) =>
    updateFeedItem<ActivityFeedItem>(sessionId, item.id, (it) => ({ ...it, entries: fn(it.entries) }));
  let thinking = -1;
  let latest = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const text = latest.length > 6000 ? `…${latest.slice(-6000)}` : latest;
    const at = thinking;
    if (at >= 0) patch((e) => e.map((x, i) => (i === at && x.kind === 'thinking' ? { ...x, text } : x)));
  };
  return {
    id: item.id,
    thinking(full: string) {
      if (thinking < 0) {
        patch((e) => {
          thinking = e.length;
          return [...e, { kind: 'thinking', text: '' }];
        });
      }
      latest = full;
      timer ??= setTimeout(flush, 150);
    },
    /** A model call ended: its reasoning (if any) gets its duration; the next call starts a new one. */
    callEnded(reasoningMs: number | undefined, totalMs: number) {
      if (thinking < 0) return;
      flush();
      const at = thinking;
      const ms = reasoningMs != null ? totalMs - reasoningMs : undefined;
      patch((e) => e.map((x, i) => (i === at && x.kind === 'thinking' ? { ...x, ms } : x)));
      thinking = -1;
      latest = '';
    },
    action(entry: Omit<Extract<ActivityEntry, { kind: 'action' }>, 'kind'>) {
      patch((e) => [...e, { kind: 'action', ...entry }]);
    },
    end() {
      flush();
      updateFeedItem<ActivityFeedItem>(sessionId, item.id, { endedAt: Date.now() });
    },
  };
}

/**
 * A failed turn only: in auto, the latest request asked to make something (not a question) and the agent ended
 * with text alone — no plan or questions card after that request.
 */
const MAKE_WORDS = /\b(crea|cre[aá]me|haz|hazle|hazme|genera|gen[eé]rala|gen[eé]ralo|dibuja|pinta|anima|edita|cambia|a[nñ]ade|agrega|quita|pon|ponle|convierte|mejora|rehaz|redise[nñ]a|render|create|make|generate|draw|paint|animate|edit|change|add|remove|turn|upscale|design)\w*/i;

function endedWithoutPlan(sessionId: string, workspace: Workspace): boolean {
  if (get().composer.agentStyle !== 'auto') return false;
  const feed = session(sessionId).feed.filter((f) => f.workspace === workspace);
  const at = feed.map((f) => f.type).lastIndexOf('user');
  const request = feed[at];
  // Only a request to make or change something (not a question, a greeting or "let's move to the canvas").
  if (request?.type !== 'user' || /[?¿]/.test(request.text) || !MAKE_WORDS.test(request.text)) return false;
  return !feed.slice(at + 1).some((f) => f.type === 'plan' || f.type === 'questions');
}

/** Delete under a garbled reply: removes it and the warning. */
export function deleteGarbled(sessionId: string, noticeId: string): void {
  const item = session(sessionId)?.feed.find((f) => f.id === noticeId);
  if (item?.type !== 'notice') return;
  if (item.garbledItemId) removeFeedItem(sessionId, item.garbledItemId);
  removeFeedItem(sessionId, noticeId);
}

/** "Propose the plan" under a reply without one: asks the agent for it as the user would. */
export function askForPlan(sessionId: string, noticeId: string): void {
  const s = session(sessionId);
  if (!s || s.agent.busy || get().activeSessionId !== sessionId) return;
  removeFeedItem(sessionId, noticeId);
  void sendAgentMessage('Propose the plan now.');
}

/** A turn that says nothing for a minute says so (a long reasoning is legitimate); one that reaches five minutes is cut. */
const SILENCE_MS = 60_000;
const TURN_CAP_MS = 5 * 60_000;

async function llmTurn(sessionId: string, workspace: Workspace, opts: { textOnly?: boolean; creditRetried?: boolean } = {}): Promise<void> {
  const engine = agentEngine();
  if (engine.kind !== 'llm') return;
  void loadLlmCatalog(engine.provider);
  patchAgent(sessionId, { busy: true, phase: 'working' });
  const log = activityLog(sessionId, workspace);
  const showThinking = get().settings.agent.showThinking !== false;
  controller = new AbortController();
  const signal = controller.signal;
  const clock = turnClock(sessionId);
  const turnStart = Date.now();
  const firstOutput = () => recordMetric(sessionId, { type: 'output', ms: clock.elapsed() });
  let planFailures = 0;
  let transferredToDesigner = false;
  // The turn is not mute: if nothing comes out for a minute the activity block says so, and Stop is in the composer.
  // Every piece of output re-arms it. The five-minute cap is the only thing that ends a turn by force (T3).
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let armedAt = 0;
  let cutTurn = false;
  const armSilence = () => {
    const now = Date.now();
    if (now - armedAt < 5_000) return; // a stream of deltas must not churn timers
    armedAt = now;
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => log.action({ icon: 'fix', label: `Still working — no answer for ${SILENCE_MS / 1000} s` }), SILENCE_MS);
  };
  const cut = () => {
    cutTurn = true;
    logEvent('agent', { session: sessionId, event: 'turn-cut', limit: 'turn', ms: TURN_CAP_MS });
    controller?.abort();
  };
  const capTimer = setTimeout(cut, TURN_CAP_MS);
  armSilence();
  try {
    for (let iteration = 0; iteration < 5; iteration++) {
      // The cap can also fall between two calls, where there is nothing to abort.
      if (cutTurn || Date.now() - turnStart > TURN_CAP_MS) {
        if (!cutTurn) logEvent('agent', { session: sessionId, event: 'turn-cut', limit: 'turn', ms: Date.now() - turnStart });
        notice(sessionId, workspace, `The agent reached the ${TURN_CAP_MS / 60_000} min limit for one turn and was stopped. Retry to continue.`, 'error', {});
        return;
      }
      let textItemId: string | null = null;
      let result: ChatResult;
      try {
        if (session(sessionId).agent.phase !== 'working') patchAgent(sessionId, { phase: 'working' });
        result = await chat({
          provider: engine.provider,
          apiKey: engine.key,
          model: engine.model,
          system: SYSTEM_PROMPT,
          messages: repairHistory(session(sessionId).agent.history),
          tools: TOOLS,
          effort: get().settings.agent.effort,
          showReasoning: showThinking,
          onReasoning: showThinking ? (_d, full) => (armSilence(), log.thinking(full)) : undefined,
          signal,
          onToolCall: () => {
            firstOutput();
            armSilence();
            patchAgent(sessionId, { phase: 'drafting' });
          },
          onText: (_delta, full) => {
            armSilence();
            if (!textItemId) {
              firstOutput();
              const item: FeedItem = { ...feedBase(workspace), type: 'assistant', text: full, streaming: true, engine: engineLabel() };
              textItemId = item.id;
              appendFeed(sessionId, item);
            } else {
              updateFeedItem(sessionId, textItemId, { text: full });
            }
          },
        });
      } catch (err) {
        if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false });
        if (isAbort(err)) {
          // Cut by the cap, or by the user pressing Stop: they are not the same thing and must not read the same.
          if (cutTurn) notice(sessionId, workspace, `The agent reached the ${TURN_CAP_MS / 60_000} min limit for one turn and was stopped. Retry to continue.`, 'error', {});
          else notice(sessionId, workspace, 'Stopped.', 'info');
          return;
        }
        // No credit for the agent's model: the same model elsewhere (same price or less) takes over and the call runs
        // again once; otherwise the choices are shown above the prompt box and the notice keeps Retry.
        if (isCreditError(err) && !opts.creditRetried) {
          if (textItemId) removeFeedItem(sessionId, textItemId);
          if (await onAgentCredit()) return llmTurn(sessionId, workspace, { ...opts, creditRetried: true });
        }
        // History only grows with completed calls, so a retry repeats just the call that failed.
        const retry = isTransient(err) || isCreditError(err) ? { ...(textItemId ? { partialItemId: textItemId } : {}) } : undefined;
        // The call happened and cost time: it is a call in the metrics even though it produced nothing (T2).
        recordMetric(sessionId, { type: 'failedCall', error: (err as Error).message, ms: clock.elapsed() });
        notice(sessionId, workspace, `${LLM_LABELS[engine.provider]}: ${(err as Error).message}`, 'error', retry);
        return;
      }
      log.callEnded(result.timing.reasoningMs, result.timing.outputMs ?? result.timing.totalMs);
      // A tool call written as text (the provider did not convert the model's native format): not kept in the
      // history, its markup hidden, and a warning with Retry (the same call again) and Delete.
      const garbled = !result.toolCalls.length ? toolMarkupAt(result.text) : -1;
      // Readable markup becomes the real calls; the reply keeps only the text before it.
      const converted = garbled >= 0 ? parseToolMarkup(result.text.slice(garbled)) : null;
      if (converted) {
        result = {
          ...result,
          text: result.text.slice(0, garbled).trim(),
          toolCalls: converted.map((c, i) => ({ ...c, id: `${CONVERTED_CALL}${Date.now().toString(36)}_${i}` })),
        };
        if (textItemId) {
          if (result.text) updateFeedItem(sessionId, textItemId, { streaming: false, text: result.text });
          else removeFeedItem(sessionId, textItemId);
        }
      } else if (garbled >= 0) {
        const shown = result.text.slice(0, garbled).trim();
        if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false, text: shown || '…' });
        appendFeed(sessionId, {
          ...feedBase(workspace),
          type: 'notice',
          level: 'error',
          text: 'The model wrote its action as text the app cannot read, so nothing ran.',
          retry: textItemId ? { partialItemId: textItemId } : {},
          ...(textItemId ? { garbledItemId: textItemId } : {}),
        });
        return;
      }
      if (textItemId) updateFeedItem(sessionId, textItemId, { streaming: false, text: result.text.trim() });
      // Every tier counts: the provider's reported cost, else tokens × the catalog price (marked estimated). Never blocks.
      const llmUsd = llmCallUsd(engine.provider, engine.model, result.usage);
      recordMetric(sessionId, {
        type: 'call',
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        usd: llmUsd,
        timing: { ...result.timing, reasoningTokens: result.usage?.reasoningTokens, cachedTokens: result.usage?.cachedTokens },
      });
      addSpend(llmUsd, { category: 'agent', provider: engine.provider, model: engine.model, sessionId, estimated: result.usage?.costUsd == null });
      if (result.usage) {
        const u = result.usage;
        patchSession(sessionId, (s) => ({
          ...s,
          usage: { inputTokens: s.usage.inputTokens + u.inputTokens, outputTokens: s.usage.outputTokens + u.outputTokens, llmUsd: s.usage.llmUsd + llmUsd },
        }));
      }
      // An empty answer stays out of the history: a Retry would otherwise end the request with an empty assistant message.
      if (result.text || result.toolCalls.length) pushHistory(sessionId, {
        role: 'assistant',
        content: result.text || null,
        tool_calls: result.toolCalls.length ? result.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) : undefined,
      });
      if (!result.toolCalls.length) {
        // Nothing to show and nothing to run (T2): say what actually happened, and leave the turn retryable.
        if (!result.text.trim()) {
          const cut = result.finishReason === 'length';
          notice(sessionId, workspace, cut ? 'The model spent its whole output budget thinking and answered nothing. Lower the reasoning in Settings or pick another model, then try again.' : 'The model returned an empty answer.', 'error', {});
        } else if (!opts.textOnly && !transferredToDesigner && endedWithoutPlan(sessionId, workspace)) {
          appendFeed(sessionId, { ...feedBase(workspace), type: 'notice', level: 'info', text: 'The agent replied without a plan.', proposePlan: true });
        }
        return;
      }
      // The wrap-up after a plan (S4) is text only: a tool call there is answered as ignored and nothing runs.
      if (opts.textOnly) {
        flushToolResults(sessionId, result.toolCalls.map((c) => ({ role: 'tool' as const, tool_call_id: c.id, content: 'Ignored: this reply is text only.' })));
        return;
      }

      const toolResults: LlmMessage[] = [];
      const afterTools: LlmMessage[] = [];
      // One action (questions or plan) per turn; later calls in the same message are answered as ignored.
      const ignoreRest = (fromIndex: number) => {
        for (const c of result.toolCalls.slice(fromIndex + 1)) {
          toolResults.push({ role: 'tool', tool_call_id: c.id, content: 'Ignored: only one action per turn is processed.' });
        }
      };
      for (const [index, call] of result.toolCalls.entries()) {
        const respond = (content: string) => toolResults.push({ role: 'tool', tool_call_id: call.id, content });
        if (result.finishReason === 'length') {
          respond('Your output was cut off (length limit). Send a shorter tool call.');
          continue;
        }
        const parsed = parseToolArgs(call.arguments);
        if (!parsed.ok) {
          respond(parsed.error);
          continue;
        }
        if (call.name === 'confirm_settings') {
          const v = confirmSettingsSchema.safeParse(parsed.value);
          if (!v.success) { respond(`Invalid confirm_settings input: ${formatZodError(v.error)}`); continue; }
          if (workspace === 'node') { respond('The node canvas has its own settings on each node: call propose_plan directly.'); continue; }
          // One card for the plan that comes now: images first, then video.
          const parts = [...v.data.parts].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'image' ? -1 : 1));
          const sections: SettingsSection[] = [];
          let failed = '';
          for (const d of parts) {
            if (sections.some((x) => x.kind === d.kind)) continue;
            const built = await buildSettings(
              { kind: d.kind, purpose: d.purpose ?? 'normal', startImage: d.start_image ?? false, refs: d.refs ?? 0, count: d.count ?? 1, duration: d.duration, aspect: d.aspect, model: d.model },
              { getModel: resolveModel, suggestModel, composerChosen, routeModel: (mode) => get().composer.videoRoutes?.[mode], defaultModel: (kind, needsImage) => defaultModelFor(kind, needsImage) },
            );
            if ('error' in built) { failed = `${d.kind}: ${built.error}`; break; }
            sections.push({ kind: d.kind, count: d.count ?? 1, recommended: built.recommended, alternatives: built.alternatives });
          }
          if (failed || !sections.length) { respond(failed || 'confirm_settings needs at least one part.'); continue; }
          log.action({ icon: 'questions', label: 'Asked to confirm the settings', detail: sections.map((x) => modelSummary(x.recommended.modelRef)?.name).join(' · ') });
          ignoreRest(index);
          flushToolResults(sessionId, toolResults);
          const item: SettingsFeedItem = { ...feedBase(workspace), type: 'settings', summary: v.data.summary, sections, status: 'pending', toolCallId: call.id };
          appendFeed(sessionId, item);
          patchAgent(sessionId, { pending: { toolCallId: call.id, kind: 'settings', feedItemId: item.id } });
          if (get().ui.workspace !== 'chat') setThreadOpen(true);
          return;
        }
        if (call.name === 'ask_questions') {
          const style = get().composer.agentStyle;
          const s = session(sessionId);
          // Auto allows one card for what changes the result or cost (F1); guided, the rounds set in Settings.
          if (s.agent.questionRound >= (style === 'auto' ? 1 : get().settings.guidedRounds)) {
            respond('Question rounds are used up. Use sensible defaults for anything still open and call propose_plan now.');
            continue;
          }
          const v = askQuestionsSchema.safeParse(parsed.value);
          if (!v.success) {
            respond(`Invalid ask_questions input: ${formatZodError(v.error)}`);
            continue;
          }
          log.action({ icon: 'questions', label: `Asked ${v.data.questions.length} question${v.data.questions.length === 1 ? '' : 's'}` });
          // This call's result is sent later, with the user's answers.
          ignoreRest(index);
          flushToolResults(sessionId, toolResults);
          recordMetric(sessionId, { type: 'questions' });
          showQuestions(
            sessionId,
            workspace,
            v.data.intro,
            v.data.questions.map((q) => ({
              id: q.id,
              question: q.question,
              options: q.options,
              allowCustom: q.allow_custom ?? true,
              multi: q.multi ?? false,
              default: q.default && q.options.includes(q.default) ? q.default : undefined,
            })),
            call.id,
          );
          return;
        }
        if (call.name === 'find_models') {
          // Local search in the app's refined catalog; the agent continues in the next round.
          const v = findModelsSchema.safeParse(parsed.value);
          recordMetric(sessionId, { type: 'findModels' });
          if (v.success) log.action({ icon: 'search', label: 'Explored models', detail: v.data.query });
          respond(v.success ? await findModelsResult(v.data.query, v.data.kind) : `Invalid find_models input: ${formatZodError(v.error)}`);
          continue;
        }
        if (call.name === 'recover_plan') {
          // Starts in the background: the plan card shows progress; the agent answers in the next round.
          const v = recoverPlanSchema.safeParse(parsed.value);
          if (!v.success) {
            respond(`Invalid recover_plan input: ${formatZodError(v.error)}`);
            continue;
          }
          const mode = v.data.action === 'check_status' ? 'check' : 'retry';
          const target = [...session(sessionId).feed].reverse().find((f): f is PlanFeedItem => f.type === 'plan' && (f.status === 'error' || f.status === 'partial'));
          const problem = target ? planRecoveryProblem(target, mode) : 'There is no failed plan in this chat.';
          if (target && !problem) {
            log.action({ icon: 'fix', label: mode === 'check' ? 'Checked the status of the failed steps' : 'Retried the failed steps', detail: target.plan.title });
            void resumePlan(sessionId, target.id, mode);
          }
          respond(problem ?? `${mode === 'check' ? 'Checking the providers' : 'Running the failed steps again'} for "${target!.plan.title}"; the plan card shows the progress. Tell the user in one short sentence.`);
          continue;
        }
        if (['edit_node', 'connect_nodes', 'disconnect_nodes', 'delete_nodes', 'restore_nodes'].includes(call.name)) {
          if (workspace !== 'node') { respond('Graph actions work only on the node canvas.'); continue; }
          try {
            const result = await editGraphTool(sessionId, call.name, parsed.value);
            respond(result.text);
          } catch (error) { respond(`Cannot ${call.name}: ${(error as Error).message}`); }
          continue;
        }
        if (call.name === 'run_nodes') {
          const v = nodeIdsSchema.safeParse(parsed.value);
          if (workspace !== 'node') { respond('run_nodes works only on the node canvas.'); continue; }
          if (!v.success) { respond(`Invalid run_nodes: ${v.error.message}`); continue; }
          const proposed = await presentNodeRun(sessionId, v.data.node_ids, call.id);
          if (proposed.errors.length) { respond(`Run blocked before spending: ${proposed.errors.join(' ')}`); continue; }
          log.action({ icon: 'plan', label: 'Proposed Run of existing nodes', detail: v.data.node_ids.join(', ') });
          ignoreRest(index); flushToolResults(sessionId, toolResults); return;
        }
        if (call.name === 'view_canvas') {
          // Read-only look at the page or one layer; the image follows the tool results (they carry no images).
          const v = viewCanvasSchema.safeParse(parsed.value);
          if (!v.success) respond(`Invalid view_canvas input: ${formatZodError(v.error)}`);
          else if (workspace !== 'designer') respond('view_canvas works only in the Designer.');
          else if (!agentSeesImages()) respond('The selected agent model cannot see images.');
          else {
            const view = await canvasParts(sessionId, v.data.layer_id).catch(() => 'The page could not be rendered.');
            if (typeof view === 'string') respond(view);
            else {
              log.action({ icon: 'search', label: 'Looked at the canvas', detail: v.data.layer_id });
              respond('The image follows in the next message.');
              afterTools.push(userMessage('Canvas view:', view));
            }
          }
          continue;
        }
        if (call.name === 'find_assets') {
          const v = findAssetsSchema.safeParse(parsed.value ?? {});
          if (!v.success) respond(`Invalid find_assets input: ${formatZodError(v.error)}`);
          else {
            const st = useStore.getState();
            const found = findAssets(session(sessionId), workspace, st.assets, st.generations, v.data);
            log.action({ icon: 'search', label: v.data.view ? 'Looked at results' : 'Searched results', detail: [v.data.kind?.join(','), v.data.query, v.data.since].filter(Boolean).join(' · ') || undefined });
            if (!v.data.view || !found.rows.length) respond(found.text);
            else if (!agentSeesImages()) respond(`${found.text}\n\nNone sent: the agent model the user picked (${get().settings.agent.model}) cannot see images, on any canvas. Tell the user exactly that, and that a model with vision (chosen in Settings → Agent) can look; never describe the results.`);
            else {
              const parts: LlmContentPart[] = [];
              for (const t of viewTargets(found.rows)) {
                if (!t.show) parts.push({ type: 'text', text: `${t.note}.` });
                else {
                  if (t.note !== `asset:${t.show}`) parts.push({ type: 'text', text: `${t.note}:` });
                  parts.push(...(await attachmentParts([t.show])));
                }
              }
              const shown = parts.some((p) => p.type === 'image_url');
              respond(`${found.text}\n\n${shown ? `The first ${Math.min(found.rows.length, VIEW_MAX)} follow as images in the next message.` : 'None of them could be shown as an image.'}`);
              if (shown) afterTools.push(userMessage('Results you asked to see:', parts));
            }
          }
          continue;
        }
        if (call.name === 'continue_in_designer') {
          const v = continueInDesignerSchema.safeParse(parsed.value ?? {});
          if (!v.success) respond(`Invalid continue_in_designer input: ${formatZodError(v.error)}`);
          else {
            const r = await chatToDesigner(sessionId, { assetIds: v.data.asset_ids, as: v.data.as });
            transferredToDesigner = r.docs.length > 0 || !!r.openedExisting;
            if (transferredToDesigner) setUi({ workspace: 'designer', panel: null, lightbox: null });
            log.action({ icon: 'guide', label: r.docs.length ? `Sent ${r.docs.reduce((n, d) => n + d.layers, 0)} images to the Designer` : 'Nothing sent to the Designer' });
            const lines = [
              r.docs.length ? `In the Designer now (nothing generated): ${r.docs.map((d) => `design ${d.id} "${d.name}" (${d.layers} raster layer${d.layers === 1 ? '' : 's'})`).join('; ')}.` : r.openedExisting ? `No duplicates added. Chat images are already imported; opened existing design ${r.openedExisting} in the Designer.` : 'No image was sent. Do not claim anything was imported.',
              r.skipped.length ? `Skipped, no such layers yet: ${r.skipped.join(', ')}.` : '',
              r.missing.length ? `Unknown ids: ${r.missing.join(', ')}.` : '',
            ];
            respond(lines.filter(Boolean).join('\n'));
          }
          continue;
        }
        if (call.name === 'continue_in_canvas') {
          {
            // From any canvas: the chat's work comes to Nodes and the user's view follows ("pasémonos al canvas").
            const { added } = chatToNodes(sessionId);
            if (get().ui.workspace !== 'node') setUi({ workspace: 'node', panel: null, lightbox: null });
            log.action({ icon: 'guide', label: added.length ? `Brought ${added.length} chat results to the node canvas` : 'Nothing new from chat' });
            respond(added.length
              ? `Added ${added.length} nodes from the chat (up to date, nothing ran): ${added.map((n) => `${n.id} ${n.data.kind} "${n.data.title}"`).join('; ')}. They are in the node index from now on.`
              : 'Every chat result is already on the node canvas; nothing added. The user\'s view is now the node canvas.');
          }
          continue;
        }
        if (call.name === 'read_graph') {
          // Read-only view of the node graph; the agent continues in the next round.
          const v = readGraphSchema.safeParse(parsed.value);
          if (!v.success) respond(`Invalid read_graph input: ${formatZodError(v.error)}`);
          else if (workspace !== 'node') respond('read_graph works only on the node canvas.');
          else {
            log.action({ icon: 'search', label: 'Read the node graph', detail: v.data.node_ids?.join(', ') });
            respond(readGraph(session(sessionId).graph, useStore.getState().generations, nodeSelection(sessionId), v.data));
          }
          continue;
        }
        if (call.name === 'read_guide') {
          // Loaded on demand from the index in the system prompt; the agent continues in the next round.
          const v = readGuideSchema.safeParse(parsed.value);
          // A workflow made for another canvas is refused with what to do instead (the index marks it too).
          const wrongCanvas = v.success ? guideWorkspaceProblem(v.data.id, workspace) : undefined;
          if (wrongCanvas) {
            respond(wrongCanvas);
            continue;
          }
          // A video model's prompting guide waits for phase 2: only the confirmed model's, which comes with the confirmation.
          const early = v.success && workspace !== 'node' ? earlyModelGuide(sessionId, v.data.id) : undefined;
          if (early) {
            respond(early);
            continue;
          }
          const text = v.success ? readGuide(v.data.id) : undefined;
          // Once per conversation: a guide already in the history is not sent again (C4).
          const seen = text != null && inConversation(sessionId, text);
          // A video workflow brings the guide of the video model the plan will use, in the same result (no extra round).
          // ... and of the image model for its image steps (sheets, key frames, renders).
          const attach = v.success && text && !seen ? modelGuidesFor(sessionId, v.data.id) : '';
          if (v.success && text && !seen) {
            recordMetric(sessionId, { type: 'guide', id: v.data.id });
            log.action({ icon: 'guide', label: `Read the ${guideLabel(v.data.id)}` });
          }
          respond(
            seen
              ? `Guide "${v.data?.id}" is already loaded earlier in this conversation; follow it.`
              : text != null ? text + attach : v.success ? `No guide "${v.data.id}". Use an id from the index.` : `Invalid read_guide input: ${formatZodError(v.error)}`,
          );
          continue;
        }
        if (call.name === 'propose_plan') {
          const v = proposePlanSchema.safeParse(parsed.value);
          if (!v.success) {
            respond(`Invalid propose_plan input: ${formatZodError(v.error)}`);
            recordMetric(sessionId, { type: 'rejected' });
            logEvent('harness', { session: sessionId, where: 'propose_plan', problems: formatZodError(v.error) });
            planFailures++;
            continue;
          }
          // Phase 2 first: prompts for video, or for 2+ images, are written only after the user confirms the settings.
          if (workspace !== 'node' && !v.data.revision) {
            const kinds = v.data.steps.map((st) => st.kind);
            const need = kinds.includes('video') && !session(sessionId).agent.settings?.video ? 'video' : kinds.includes('image') && !session(sessionId).agent.settings?.image ? 'image' : null;
            if (need) {
              recordMetric(sessionId, { type: 'rejected' });
              respond(`Not shown: call confirm_settings first (kind "${need}") so the user confirms the model, resolution${need === 'video' ? ', duration' : ', how many images'} and aspect; then write the prompts for the confirmed model and call propose_plan.`);
              continue;
            }
          }
          patchAgent(sessionId, { phase: 'checking' });
          const presented = await presentPlan(sessionId, workspace, toRawPlan(v.data), call.id, v.data.revision === true, clock.elapsed());
          if (presented.errors.length) {
            // What the agent wrote before a rejected plan promised it; the feed drops it (the history keeps it).
            if (textItemId) removeFeedItem(sessionId, textItemId);
            recordMetric(sessionId, { type: 'rejected' });
            log.action({ icon: 'fix', label: `Checked the plan: ${presented.errors.length} problem${presented.errors.length === 1 ? '' : 's'} to fix`, detail: presented.errors[0] });
            planFailures++;
            logEvent('harness', { session: sessionId, where: 'plan', problems: presented.errors });
            respond(`Plan rejected by the validator. Fix these problems and call propose_plan again:\n- ${presented.errors.join('\n- ')}`);
            continue;
          }
          log.action({ icon: 'plan', label: v.data.revision ? 'Revised the plan' : 'Drafted the plan', detail: v.data.title });
          // This call's result is sent when the user approves or cancels.
          ignoreRest(index);
          flushToolResults(sessionId, toolResults);
          return;
        }
        respond(`Unknown tool "${call.name}".`);
      }
      flushToolResults(sessionId, toolResults);
      for (const m of afterTools) pushHistory(sessionId, m);
      if (planFailures >= 3) {
        notice(sessionId, workspace, 'The agent could not produce a valid plan. Try rephrasing or pick another model.');
        return;
      }
    }
    notice(sessionId, workspace, 'The agent stopped after several attempts without a result.');
  } finally {
    clearTimeout(silenceTimer);
    clearTimeout(capTimer);
    // No revision came (a text answer, questions, an error or a stop): the commented plan stays as it was, waiting —
    // the user can still run it or comment again. Only a new plan replaces it.
    keepCommentedPlan(sessionId);
    log.end();
    clock.end();
    patchAgent(sessionId, { busy: false, phase: undefined });
    controller = null;
  }
}

/** Cost of one model call: what the provider reported, else tokens at the catalog's per-million prices. */
export function llmCallUsd(provider: LlmProviderId, model: string, usage: ChatResult['usage']): number {
  if (!usage) return 0;
  if (usage.costUsd != null) return usage.costUsd;
  const m = get().catalog.llm[provider]?.find((x) => x.id === model);
  return ((m?.inputPrice ?? 0) * usage.inputTokens + (m?.outputPrice ?? 0) * usage.outputTokens) / 1_000_000;
}

function flushToolResults(sessionId: string, results: LlmMessage[]): void {
  if (results.length) patchAgent(sessionId, (a) => ({ history: [...a.history, ...results] }));
  results.length = 0;
}

/** Id prefix of a tool call the app read from text markup (toolMarkup): its result carries a warning. */
const CONVERTED_CALL = 'call_txt_';
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

/**
 * After a reload, plans that were running have lost their executor. Their generations are resumed by
 * `resumeInterrupted`; follow them and close each card with its real outcome instead of "Running" forever.
 * Nothing is submitted again: steps that had not started before the reload are reported as not run.
 */
export function settleInterruptedPlans(): void {
  const open = new Set<string>();
  for (const s of Object.values(get().sessions)) for (const f of s.feed) if (f.type === 'plan' && f.status === 'running') open.add(`${s.id}|${f.id}`);
  if (!open.size) return;
  const check = () => {
    const gens = get().generations;
    for (const key of [...open]) {
      const [sessionId, itemId] = key.split('|');
      const item = get().sessions[sessionId]?.feed.find((f) => f.id === itemId);
      if (!item || item.type !== 'plan' || item.status !== 'running') {
        open.delete(key);
        continue;
      }
      const states: Record<string, StepState> = { ...item.stepStates };
      let pending = false;
      for (const st of item.plan.steps) {
        const gid = item.stepGenerations[st.id];
        const g = gid ? gens[gid] : undefined;
        if (g) states[st.id] = g.status === 'done' ? 'done' : g.status === 'error' || g.status === 'canceled' ? 'error' : ((pending = true), 'running');
        else if (states[st.id] !== 'done') states[st.id] = 'skipped';
      }
      if (pending) continue;
      open.delete(key);
      const done = Object.values(states).filter((v) => v === 'done').length;
      const all = item.plan.steps.length;
      updateFeedItem<PlanFeedItem>(sessionId, itemId, {
        stepStates: states,
        status: done === all ? 'done' : done ? 'partial' : 'error',
        error: done === all ? undefined : 'Interrupted by a page reload; some steps did not run.',
      });
    }
    if (!open.size) unsubscribe();
  };
  const unsubscribe = useStore.subscribe(check);
  check();
}
