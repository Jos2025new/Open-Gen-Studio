import { uid } from '../../lib/id';
import { isAbort, isTransient } from '../../lib/http';
import { ratioOf } from '../params';
import { needsSpendCheck } from '../pricing';
import { normalizePlan, parseRef, pruneJoins, type RawPlan } from '../plan';
import { executeSteps, estimateSteps, type StepOutput } from '../executor';
import { canRecheck, recheckGeneration, retryGeneration } from '../jobs';
import { autoLayout, graphBounds, graphToSteps, planToGraph, runsGeneration } from '../flow/graph';
import { activeDoc, ensureDoc } from '../design/actions';
import { activeSkill, workflowById } from '../skills';
import { chat, LLM_LABELS, type ChatResult } from '../providers/llm';
import { composerChosen, defaultModelFor, loadLlmCatalog, resolveModel } from '../catalog';
import type {
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
  toast,
  updateFeedItem,
  useStore,
} from '../../store/store';
import { SYSTEM_PROMPT, WRAPUP_RULE, buildContext } from './context';
import { offlinePlan } from './offline';
import { findModelsResult, suggestModel } from './modelIndex';
import { agentSeesImages, attachmentParts, stripImages, userMessage } from './attachments';
import { closeRequest, recordMetric, startRequest, turnClock } from './metrics';
import { overLimit, overLimitText } from '../budget';
import { readGuide, guideWorkspaceProblem, skillById } from '../skills';
import { modelGuide } from '../guides';
import { readGraph } from '../flow/graphView';
import { nodeSelection } from '../flow/selection';
import { TOOLS, findModelsSchema, readGraphSchema, readGuideSchema, recoverPlanSchema, askQuestionsSchema, formatZodError, parseToolArgs, proposePlanSchema, toRawPlan } from './tools';

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

function planContext(sessionId: string, workspace: Workspace) {
  const doc = workspace === 'designer' ? activeDoc(sessionId) : null;
  return {
    workspace,
    getModel: resolveModel,
    defaultModel: (kind: MediaKind, needsImage: boolean) => defaultModelFor(kind, needsImage),
    defaultSettings: (kind: MediaKind) => get().composer[kind].settings,
    asset: (id: string) => get().assets[id],
    layer: (id: string) => doc?.layers.find((l) => l.id === id),
    suggestModel,
    composerChosen,
    routeModel: (mode: 'text' | 'image' | 'reference') => get().composer.videoRoutes?.[mode],
    subjectNames: () => get().library.map((x) => x.name),
  };
}

// ---------------------------------------------------------------------------
// Entry points

/** Send a message from the composer in agent mode. */
export async function sendAgentMessage(text: string): Promise<void> {
  const st = get();
  const sessionId = st.activeSessionId;
  const s = session(sessionId);
  if (!s || s.agent.busy) return;
  const workspace = st.ui.workspace;
  const attachments = [...st.composer.attachments];
  const clean = text.trim();
  if (!clean && !attachments.length) return;

  autoTitleSession(sessionId, clean || 'Edit');
  appendFeed(sessionId, { ...feedBase(workspace), type: 'user', text: clean, mode: 'agent', attachments });
  setComposer({ text: '', attachments: [] });

  const pending = s.agent.pending;
  const pendingItem = pending ? s.feed.find((f) => f.id === pending.feedItemId) : undefined;

  // Typing while questions are open answers them.
  if (pending?.kind === 'questions' && pendingItem?.type === 'questions' && pendingItem.status === 'pending') {
    await submitAnswers(sessionId, pendingItem.id, { note: clean }, 'typed');
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
        content: `The user replied instead of approving: ${clean}\nIf this adjusts the plan (a model, a step, duration, count, which steps to keep), call propose_plan with revision true: keep every other step, prompt and setting exactly as they were and change only what was asked. If it is a different request, use revision false.\n\n${ctx}`,
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
  patchAgent(sessionId, { questionRound: 0, draft: { request: clean, answers: {}, attachments } });
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
  // A new request: images of earlier requests become a note instead of being sent again.
  patchAgent(sessionId, (a) => ({ history: stripImages(a.history) }));
  pushHistory(sessionId, userMessage(`${clean || '(no text)'}\n\n${ctx}`, parts));
  patchAgent(sessionId, { notes: [] });
  await llmTurn(sessionId, workspace);
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

/**
 * Retry after a transient failure (the connection dropped, the provider was busy). A streamed answer cannot be
 * resumed mid-way, so the failed call runs again with the same history: steps that had finished (a guide read,
 * a model search) are kept and not repeated. The half-written answer and the error notice are removed.
 */
export async function retryAgentTurn(sessionId: string, noticeId: string): Promise<void> {
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
  patchAgent(sessionId, { pending: { toolCallId, kind: 'plan', feedItemId: item.id } });
  if (workspace === 'node') materializeNodes(sessionId, plan);
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
  const { nodes, edges } = planToGraph(plan, (id) => get().assets[id]?.kind);
  const graph = session(sessionId).graph;
  const bounds = graphBounds(graph.nodes);
  const origin = bounds ? { x: bounds.x + bounds.w + 160, y: bounds.y } : { x: 0, y: 0 };
  const positions = autoLayout(nodes, edges, origin);
  setGraph(sessionId, (g) => ({
    ...g,
    nodes: [...g.nodes, ...nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position }))],
    edges: [...g.edges, ...edges],
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
  const s = session(sessionId);
  const item = s.feed.find((f) => f.id === itemId);
  if (!item || item.type !== 'plan' || item.status !== 'awaiting') return;
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
    if (pending.toolCallId) pushHistory(sessionId, { role: 'tool', tool_call_id: pending.toolCallId, content: `Approved by the user.${note} The app is executing the plan now.` });
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
    const run = graphToSteps(graph, ids, get().generations);
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
        if (workspace === 'chat') {
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
      if (out.assetIds.length) return `${st.id} → ${out.assetIds.map((a) => `asset:${a}`).join(', ')}`;
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
      await (mode === 'check' ? recheckGeneration(g.id) : retryGeneration(g.id));
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

async function llmTurn(sessionId: string, workspace: Workspace, opts: { textOnly?: boolean } = {}): Promise<void> {
  const engine = agentEngine();
  if (engine.kind !== 'llm') return;
  void loadLlmCatalog(engine.provider);
  patchAgent(sessionId, { busy: true, phase: 'working' });
  const log = activityLog(sessionId, workspace);
  const showThinking = get().settings.agent.showThinking !== false;
  controller = new AbortController();
  const signal = controller.signal;
  const clock = turnClock(sessionId);
  const firstOutput = () => recordMetric(sessionId, { type: 'output', ms: clock.elapsed() });
  let planFailures = 0;
  try {
    for (let iteration = 0; iteration < 5; iteration++) {
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
          onReasoning: showThinking ? (_d, full) => log.thinking(full) : undefined,
          signal,
          onToolCall: () => {
            firstOutput();
            patchAgent(sessionId, { phase: 'drafting' });
          },
          onText: (_delta, full) => {
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
          notice(sessionId, workspace, 'Stopped.', 'info');
          return;
        }
        // History only grows with completed calls, so a retry repeats just the call that failed.
        const retry = isTransient(err) ? { ...(textItemId ? { partialItemId: textItemId } : {}) } : undefined;
        notice(sessionId, workspace, `${LLM_LABELS[engine.provider]}: ${(err as Error).message}`, 'error', retry);
        return;
      }
      log.callEnded(result.timing.reasoningMs, result.timing.outputMs ?? result.timing.totalMs);
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
      pushHistory(sessionId, {
        role: 'assistant',
        content: result.text || null,
        tool_calls: result.toolCalls.length ? result.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) : undefined,
      });
      if (!result.toolCalls.length) {
        if (!result.text.trim()) notice(sessionId, workspace, 'The model returned an empty answer. Try rephrasing.');
        return;
      }
      // The wrap-up after a plan (S4) is text only: a tool call there is answered as ignored and nothing runs.
      if (opts.textOnly) {
        flushToolResults(sessionId, result.toolCalls.map((c) => ({ role: 'tool' as const, tool_call_id: c.id, content: 'Ignored: this reply is text only.' })));
        return;
      }

      const toolResults: LlmMessage[] = [];
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
          respond(v.success ? findModelsResult(v.data.query, v.data.kind) : `Invalid find_models input: ${formatZodError(v.error)}`);
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
          const text = v.success ? readGuide(v.data.id) : undefined;
          // Once per conversation: a guide already in the history is not sent again (C4).
          const seen = text != null && session(sessionId).agent.history.some((m) => m.role === 'tool' && m.content === text);
          if (v.success && text && !seen) {
            recordMetric(sessionId, { type: 'guide', id: v.data.id });
            log.action({ icon: 'guide', label: `Read the ${guideLabel(v.data.id)}` });
          }
          respond(
            seen
              ? `Guide "${v.data?.id}" is already loaded earlier in this conversation; follow it.`
              : (text ?? (v.success ? `No guide "${v.data.id}". Use an id from the index.` : `Invalid read_guide input: ${formatZodError(v.error)}`)),
          );
          continue;
        }
        if (call.name === 'propose_plan') {
          const v = proposePlanSchema.safeParse(parsed.value);
          if (!v.success) {
            respond(`Invalid propose_plan input: ${formatZodError(v.error)}`);
            recordMetric(sessionId, { type: 'rejected' });
            planFailures++;
            continue;
          }
          patchAgent(sessionId, { phase: 'checking' });
          const presented = await presentPlan(sessionId, workspace, toRawPlan(v.data), call.id, v.data.revision === true, clock.elapsed());
          if (presented.errors.length) {
            // What the agent wrote before a rejected plan promised it; the feed drops it (the history keeps it).
            if (textItemId) removeFeedItem(sessionId, textItemId);
            recordMetric(sessionId, { type: 'rejected' });
            log.action({ icon: 'fix', label: `Checked the plan: ${presented.errors.length} problem${presented.errors.length === 1 ? '' : 's'} to fix`, detail: presented.errors[0] });
            planFailures++;
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
      if (planFailures >= 3) {
        notice(sessionId, workspace, 'The agent could not produce a valid plan. Try rephrasing or pick another model.');
        return;
      }
    }
    notice(sessionId, workspace, 'The agent stopped after several attempts without a result.');
  } finally {
    // No revision came (text answer, questions, error or stop): the commented plan is closed.
    closeRevisedPlan(sessionId, false);
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
      out.push(...following);
      for (const id of ids) {
        if (!have.has(id)) out.push({ role: 'tool', tool_call_id: id, content: 'No result.' });
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
