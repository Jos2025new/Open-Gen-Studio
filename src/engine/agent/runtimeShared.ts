import { costAskMessage, needsConfirmation, roundsFor } from '../procedure';
import { prepareNodeRun } from '../flow/actions';
import { uid } from '../../lib/id';
import { journeyIdFor, recordJourneyEvent } from '../../lib/journeyTrace';
import { ratioOf } from '../params';
import { needsSpendCheck } from '../pricing';
import { pushAlert } from '../alerts';
import { normalizePlan, type RawPlan } from '../plan';
import { carryOverRevision } from '../planRevision';
import { offerRequest, userRequest } from '../modelNamed';
import { estimateSteps } from '../executor';
import { focusNodes } from '../flow/selection';
import { autoLayout, graphBounds, planToGraph, nodeOutputAsset } from '../flow/graph';
import { activeDoc } from '../design/actions';
import { LLM_LABELS, type ChatResult } from '../providers/llm';
import { composerChosen, defaultModelChoice, defaultModelFor, resolveModel, lineRoutes } from '../catalog';
import type { AgentQuestion, AgentState, LlmProviderId, MediaKind, NoticeFeedItem, Plan, PlanFeedItem, PlanStep, QuestionsFeedItem, Session, StepState, Workspace } from '../types';
import { appendFeed, patchSession, setGraph, toast, updateFeedItem, useStore } from '../../store/store';
import { suggestModel } from './modelIndex';
import { recordMetric } from './metrics';
import { gateOps } from './force';
import { agentCanvas } from './agentCanvas';
import { watchModel } from './turnStop';
import { approvePlan, removeDraftNodes } from './planRun';

export const get = useStore.getState;
/** One controller per turn, by session: a turn in one session never stops or clears another's. */
export const controllers = new Map<string, AbortController>();
/** Ends a turn at once (Stop, the cap), without waiting for what it awaits. */
export const ending = new WeakMap<AbortController, () => void>();

// ---------------------------------------------------------------------------
// Helpers

export function session(id: string): Session {
  return get().sessions[id];
}

/** The operations the current request names, fired or not by its attachments and parameters (agent/force.ts). */
export function requestGate(sessionId: string) {
  const draft = session(sessionId).agent.draft;
  const inputs = (draft?.attachments ?? []).flatMap((id) => (get().assets[id] ? [get().assets[id]] : []));
  return gateOps(draft?.request ?? '', inputs, get().composer.agentStyle === 'direct');
}


export function patchAgent(sessionId: string, patch: Partial<AgentState> | ((a: AgentState) => Partial<AgentState>)): void {
  patchSession(sessionId, (s) => ({ ...s, agent: { ...s.agent, ...(typeof patch === 'function' ? patch(s.agent) : patch) } }));
}

/** Where a row is shown: Studio's chat keeps every row as chat, also while the agent works on a canvas it opened in the board. */
export const rowCanvas = (workspace: Workspace): Workspace => (get().ui.workspace === 'chat' ? 'chat' : workspace);
/** Where a turn resumed from a row works: a chat row, the workspace the user is in (Studio is the chat canvas). */
export const turnCanvas = (workspace: Workspace): Workspace => (workspace === 'chat' ? agentCanvas() : get().ui.workspace === 'chat' ? 'chat' : workspace);

export function feedBase(workspace: Workspace) {
  return { id: uid('fd'), createdAt: Date.now(), workspace: rowCanvas(workspace) };
}

export function notice(sessionId: string, workspace: Workspace, text: string, level: 'info' | 'error' = 'error', retry?: NoticeFeedItem['retry']): void {
  appendFeed(sessionId, { ...feedBase(workspace), type: 'notice', level, text, ...(retry ? { retry } : {}) });
  // Errors also show above the prompt box, where they are seen.
  if (level === 'error') pushAlert({ level: 'error', text });
  if (level === 'error' && get().ui.workspace !== 'chat') setThreadOpen(true);
}

export function setThreadOpen(open: boolean): void {
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

/** The user's own words, marked off from what the app adds (context, guides, notes), with the canvas they wrote on. */
export function userBlock(text: string, canvas: Workspace): string {
  return `<user_message canvas="${canvas}">\n${text}\n</user_message>`;
}

/**
 * One conversation per session; restore an older parked canvas only when history is empty and the agent idle.
 */
export function toCanvas(sessionId: string, workspace: Workspace): void {
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
export function toCanvasOfItem(sessionId: string, itemId: string): void {
  const item = session(sessionId)?.feed.find((f) => f.id === itemId);
  if (item) toCanvas(sessionId, turnCanvas(item.workspace));
}

/** What the user wrote in this session (messages and answers): a model named there is the user's choice. */
function userWords(sessionId: string): string {
  const s = session(sessionId);
  const said = s.feed.flatMap((f) => (f.type === 'user' ? [f.text ?? ''] : f.type === 'questions' && f.answers ? Object.values(f.answers) : []));
  return [...said, s.agent.draft?.request ?? '', ...Object.values(s.agent.draft?.answers ?? {})].join('\n');
}

function planContext(sessionId: string, workspace: Workspace, strict = false) {
  const doc = workspace === 'designer' ? activeDoc(sessionId) : null;
  return {
    workspace,
    getModel: watchModel(sessionId, resolveModel),
    variantModel: (ref: string, route: import('../variants').VariantRoute) => {
      const routes = lineRoutes(ref);
      return routes[route] ?? (route === 'edit' ? routes.reference : undefined);
    },
    defaultModel: (kind: MediaKind, needsImage: boolean) => {
      const ref = (kind === 'image' || kind === 'video') && session(sessionId).agent.settings?.[kind]?.modelRef;
      return ref ? (needsImage ? lineRoutes(ref)[kind === 'image' ? 'edit' : 'image'] ?? ref : lineRoutes(ref).text ?? ref) : defaultModelFor(kind, needsImage);
    },
    defaultIsFallback: (kind: MediaKind, needsImage: boolean) => defaultModelChoice(kind, needsImage).source === 'fallback',
    defaultSettings: (kind: MediaKind) => get().composer[kind].settings,
    asset: (id: string) => get().assets[id],
    layer: (id: string) => doc?.layers.find((l) => l.id === id),
    suggestModel,
    // Direct keeps session model precedence.
    composerChosen: (kind: MediaKind) => get().composer.agentStyle === 'direct' || Boolean((kind === 'image' || kind === 'video') && session(sessionId).agent.settings?.[kind]) || composerChosen(kind),
    routeModel: (mode: 'text' | 'image' | 'reference') => get().composer.videoRoutes?.[mode],
    librarySubjects:()=>get().library,
    strictContinuity:strict,
    userText: () => userWords(sessionId),
    // This request only (an old "un ángulo diferente" must not fit a new one), user words only; the agent's reply is in offerText.
    requestText: () => userRequest(session(sessionId).agent),
    offerText: () => offerRequest(session(sessionId).agent),
    // Angles already made from this source image, by finished angle operations on it.
    usedAngles: (assetId: string) => Object.values(get().generations)
      .filter((g) => g.status === 'done' && g.op?.id === 'angle' && g.op.sourceAssetId === assetId)
      .map((g) => String(g.op?.params.angle ?? ''))
      .filter(Boolean),
    requestImages: () => (session(sessionId).agent.draft?.attachments ?? []).filter((id) => get().assets[id]?.kind === 'image'),
    direct: () => get().composer.agentStyle === 'direct',
    canAsk: () => session(sessionId).agent.questionRound < roundsFor(get().composer.agentStyle, get().settings.guidedRounds),
    answered: () => Object.keys(session(sessionId).agent.draft?.answers ?? {}).length > 0,
    opModel: () => (workspace === 'node' ? undefined : get().composer.agentStyle === 'direct' ? get().composer.image.modelRef : session(sessionId).agent.settings?.image?.modelRef),
    // Direct inherits the session model without forcing the other settings.
    confirmed: (kind: MediaKind) => (workspace !== 'node' && get().composer.agentStyle !== 'direct' && (kind === 'video' || kind === 'image') ? session(sessionId).agent.settings?.[kind] : undefined),
    switchedTo: (kind: MediaKind) => (workspace !== 'node' && get().composer.agentStyle === 'auto' && (kind === 'video' || kind === 'image') ? session(sessionId).agent.switchedTo?.[kind] : undefined),
    confirmedParts: (kind: MediaKind) => (workspace !== 'node' && get().composer.agentStyle !== 'direct' ? (session(sessionId).agent.settingsParts ?? []).filter((p) => p.kind === kind) : []),
  };
}

// ---------------------------------------------------------------------------
// Entry points

/** A reply to a waiting card is part of the request: what the app reads for a model or provider the user named (userRequest) includes it. */
export function addReplyToRequest(sessionId: string, text: string, attachments: string[]): void {
  const draft = session(sessionId).agent.draft;
  patchAgent(sessionId, { draft: { request: `${draft?.request ?? ''} ${text}`.trim(), answers: draft?.answers ?? {}, attachments: [...(draft?.attachments ?? []), ...attachments.filter((id) => !draft?.attachments?.includes(id))] } });
}

/** Send a message from the composer in agent mode. */
export function showQuestions(sessionId: string, workspace: Workspace, intro: string | undefined, questions: AgentQuestion[], toolCallId: string | null): void {
  const s = session(sessionId);
  const round = s.agent.questionRound + 1;
  const item: QuestionsFeedItem = {
    ...feedBase(workspace),
    type: 'questions',
    intro,
    questions,
    round,
    maxRounds: roundsFor(get().composer.agentStyle, get().settings.guidedRounds),
    status: 'pending',
    ...(toolCallId ? { toolCallId } : {}),
  };
  appendFeed(sessionId, item);
  recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'settings-response', event: 'questions.presented', reason: 'agent asked for user information', sessionId, approvalId: item.id, after: { questionIds: questions.map((q) => q.id), round, maxRounds: item.maxRounds } });
  patchAgent(sessionId, { questionRound: round, pending: { toolCallId, kind: 'questions', feedItemId: item.id } });
  if (get().ui.workspace !== 'chat') setThreadOpen(true);
}

/** Validate a raw plan and show it. Auto mode runs free plans immediately. */
export async function presentPlan(
  sessionId: string,
  workspace: Workspace,
  raw: RawPlan,
  toolCallId: string | null,
  revision = false,
  /** Agent time so far, for the request's metrics (LLM turns only). */
  agentMs?: number,
  /** The turn's signal: a plan checked after Stop is dropped */
  signal?: AbortSignal,
): Promise<{ errors: string[]; itemId?: string; settingsNeeded?: string }> {
  const started = Date.now();
  const planId = uid('pln');
  const carried = revision ? carryOverRevision(raw, session(sessionId)) : [];
  const { plan, errors } = await normalizePlan(raw, planContext(sessionId, workspace, !!toolCallId), planId);
  if (plan && carried.length) plan.agentNotes = carried;
  if (signal?.aborted) return { errors: [] };
  const journey = revision ? 'plan-revision' : 'settings-correction';
  const summarizeInputs = (step: PlanStep) => step.kind === 'video'
    ? { references: step.refs, firstFrame: step.firstFrame, lastFrame: step.lastFrame }
    : step.kind === 'image' || step.kind === 'model3d' ? { references: step.refs }
      : undefined;
  recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey, event: plan ? 'plan.normalized' : 'plan.rejected', reason: plan ? 'normalizer accepted resolved steps' : 'normalizer rejected plan', sessionId, planId, before: (raw.steps ?? []).map((step) => ({ stepId: step.id, kind: step.kind, model: step.model, references: step.refs, firstFrame: step.first_frame, lastFrame: step.last_frame })), after: plan ? plan.steps.map((step) => ({ stepId: step.id, kind: step.kind, modelRef: 'modelRef' in step ? step.modelRef : undefined, inputs: summarizeInputs(step), settings: 'settings' in step ? step.settings : undefined, adjustments: plan.adjustments.filter((a) => a.startsWith(`${step.id}:`)) })) : { errors } });
  if (!plan) return { errors };
  const { total } = estimateSteps(plan.steps);
  // Automation policy (§11) on the normalized plan: cost and candidates are known only here.
  // Nothing is shown before this check: a plan that needs the settings card is not presented.
  const settingKinds = plan.steps.map((st) => st.kind).filter((k): k is 'image' | 'video' => k === 'image' || k === 'video');
  // Direct mode decides nothing before the plan card: the composer picks the models, the card approves the cost.
  if (workspace !== 'node' && settingKinds.length && get().composer.agentStyle !== 'direct') {
    const action = needsConfirmation({
      workspace,
      kinds: settingKinds,
      settings: session(sessionId).agent.settings,
      style: get().composer.agentStyle,
      userChoseModel: (raw.steps ?? []).some((s) => Boolean(s.model)),
      estimatedCost: total.usd,
      hasMultipleCandidates: plan.steps.some((st) => 'settings' in st && (st.settings.count ?? 1) > 1),
    });
    // The card just confirmed in this request already covers the cost: asking again looped (4 cards for one video).
    const confirmedNow = settingKinds.every((k) => (session(sessionId).agent.settingsParts ?? []).some((p) => p.kind === k));
    if (action === 'ask' && !confirmedNow) return { errors: [], settingsNeeded: costAskMessage([...new Set(settingKinds)], total.usd) };
  }
  const style = get().composer.agentStyle;
  const item: PlanFeedItem = {
    ...feedBase(workspace),
    type: 'plan',
    plan,
    style,
    comparisonKinds: (['image', 'video'] as const).filter((k) => new Set(plan.steps.flatMap((s) => s.kind === k && 'modelRef' in s ? [lineRoutes(s.modelRef).text ?? s.modelRef] : [])).size > 1),
    status: 'awaiting',
    stepStates: Object.fromEntries(plan.steps.map((st) => [st.id, 'pending' as StepState])),
    stepGenerations: {},
    estimate: total,
  };
  const replaced = closeRevisedPlan(sessionId, revision);
  if (replaced) item.revised = true;
  appendFeed(sessionId, item);
  for (const a of plan.adjustments.filter((x) => /\byour [\w-]+ model\b/.test(x))) toast(a.replace(/^[\w-]+: /, ''), 'error', 5000);
  patchAgent(sessionId, { pending: { toolCallId, kind: 'plan', feedItemId: item.id } });
  if (workspace === 'node') {
    materializeNodes(sessionId, plan);
    const targets = plan.steps.filter(s => s.kind !== 'text').map(s => `${plan.id}_${s.id}`);
    const preview = await prepareNodeRun(sessionId, targets);
    updateFeedItem<PlanFeedItem>(sessionId, item.id, { nodeRun: { targets, force: true, signature: preview.signature }, plan: { ...plan, steps: preview.steps }, estimate: preview.estimate, error: preview.errors.join(' ') || undefined });
  }
  // Recorded before auto-approval closes the request.
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
export function keepCommentedPlan(sessionId: string): void {
  const id = session(sessionId).agent.revising;
  if (!id) return;
  const plan = session(sessionId).feed.find((f) => f.id === id);
  patchAgent(sessionId, (a) => ({ revising: undefined, ...(plan?.type === 'plan' && plan.status === 'awaiting' && !a.pending ? { pending: { toolCallId: null, kind: 'plan', feedItemId: id } } : {}) }));
}

export function closeRevisedPlan(sessionId: string, replace: boolean): boolean {
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

export function llmCallUsd(provider: LlmProviderId, model: string, usage: ChatResult['usage']): number {
  if (!usage) return 0;
  if (usage.costUsd != null) return usage.costUsd;
  const m = get().catalog.llm[provider]?.find((x) => x.id === model);
  return ((m?.inputPrice ?? 0) * usage.inputTokens + (m?.outputPrice ?? 0) * usage.outputTokens) / 1_000_000;
}
